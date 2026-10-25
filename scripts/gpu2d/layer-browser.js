'use strict';
// Deterministic Leaflet integration checks. Real browser/GPU; fake elevation
// and engine only. No production mock hook or live service is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'output/playwright/gpu2d-layer');fs.mkdirSync(OUT,{recursive:true});
const which=process.env.B||'chrome';
const pw=require(which==='webkit'?'/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core':'/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
function png(){
 const crc=data=>{let c=0xffffffff;for(const b of data){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const type=Buffer.from(name),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([head,type,data,tail]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=6;
 const rows=Buffer.alloc((256*4+1)*256);
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=y*1025+1+x*4;rows.set([129,96,0,255],i);}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const BASE=process.env.CSP_GPU2D_URL||'http://127.0.0.1:8812';
const image=png(),mock=fs.readFileSync(path.join(__dirname,'layer-mock-engine.js'),'utf8');
const expose='\nwindow.__layerApp={snapshotDomMatrix,snapshotSpec,composeSnapshot,composeSnapshotStream,snapshotDomItems,enterTerrain3d,exitTerrain3d,researchElevationSource,researchElevationGrid,cursorLoadedElevation,gpuTerrainState,syncGpuTerrain};\n';
const baselineExpose='\nwindow.__layerApp={snapshotDomMatrix};\n';
async function prepare(browser,{mocked=true,flag='1',baseline=false,ui='',dpr=2,startup=false,features=[],viewport={width:1100,height:760}}={}){
 const context=await browser.newContext({viewport,deviceScaleFactor:dpr,reducedMotion:'reduce',serviceWorkers:'block'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 // Compare this repair with its current parent, not an obsolete UI snapshot.
 const html=baseline?cp.execFileSync('git',['show',`${process.env.CSP_GPU2D_BASELINE_REF||'HEAD'}:index.html`],{cwd:ROOT,encoding:'utf8',timeout:60000}):fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==BASE){
   if(/\.(png|jpg)|tile|exportImage|MapServer/.test(u.href))return route.fulfill({contentType:'image/png',body:image});
   return route.abort();
  }
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html.replace('})();\n</script>\n<script src="markup-3d',(baseline?baselineExpose:expose)+'})();\n</script>\n<script src="markup-3d')});
  if(u.pathname==='/gpu-terrain-engine.js'&&!baseline&&mocked!=='real')return route.fulfill({contentType:'text/javascript',body:mocked?mock:'window.CSPGpuTerrainEngine={create:()=>null};'});
  if(u.pathname==='/api/health')return route.fulfill({json:{ok:true,features}});
  if(/\/api\/(elev|usgs\/elev|wadnr\/elev|terrain)/.test(u.pathname))return route.fulfill({contentType:'image/png',body:image});
  if(u.pathname.startsWith('/api/'))return route.fulfill({json:{ok:true,layers:[],areas:[],features:[]}});
  return route.continue();
 });
 await page.goto(`${BASE}/?gpu2d=${flag}${ui?`&ui=${ui}`:''}`);
 await page.waitForFunction(()=>!!window.ClearSkiesPortalBridge);
 if(startup)return {context,page,errors};
 await page.evaluate(()=>{
  const m=ClearSkiesPortalBridge.map;m.setView([47.858,-118.33],15,{animate:false});
  for(const [id,value] of [['terSrc','3dep'],['terStyle','hs']]){const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}
  const el=document.getElementById('elevSh');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.waitForTimeout(900);
 return {context,page,errors};
}
function measureAlignment(view){
 const m=window.__alignmentMap||ClearSkiesPortalBridge.map,g=window.__alignmentLayer||ClearSkiesPortalBridge.gpuTerrain(),v=view||g.getEngine().stats().lastView;
 // Capture each ancestor once. Re-reading a CSS transition separately for
 // hundreds of tiles compares different compositor times in WebKit.
 const cache=new Map([[m.getContainer(),new DOMMatrix()]]);
 const domMatrix=node=>{
  if(cache.has(node))return cache.get(node);
  const cs=getComputedStyle(node),[ox,oy]=cs.transformOrigin.split(' ').map(v=>parseFloat(v)||0);
  let local=new DOMMatrix().translate(node.offsetLeft||0,node.offsetTop||0);
  if(cs.transform&&cs.transform!=='none')local=local.translate(ox,oy).multiply(new DOMMatrix(cs.transform)).translate(-ox,-oy);
  const matrix=domMatrix(node.parentElement).multiply(local);cache.set(node,matrix);return matrix;
 };
 const canvasMatrix=domMatrix(g._canvas);
 let max=0,count=0;
 for(const tile of Object.values(window.__debugGrid._tiles||{})){
  if(tile.current===false)continue;
  const coords=tile.coords,z=coords.z+v.dz,n=2**z,size=window.__debugGrid.getTileSize().x;
  const matrix=domMatrix(tile.el);
  for(const [dx,dy] of [[0,0],[size,0],[0,size],[size,size]]){
   const actual=matrix.transformPoint(new DOMPoint(dx,dy));
   if(actual.x<30||actual.y<30||actual.x>v.cssSize[0]-30||actual.y>v.cssSize[1]-30)continue;
   const expected=__gpuLayerMock.screen(v,[(coords.x+dx/size)/n,(coords.y+dy/size)/n]);
   const drawn=canvasMatrix.transformPoint(new DOMPoint(...expected));
   max=Math.max(max,Math.hypot(drawn.x-actual.x,drawn.y-actual.y));count++;
  }
 }
 const matrix=canvasMatrix;
 return {max,count,zoom:v.zoom,bearing:v.bearing,dz:v.dz,canvasMatrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],frame:g.getEngine().stats().frames+(view?1:0)};
}
async function alignment(page){return page.evaluate(measureAlignment);}
async function run(){
 const browser=which==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
 const report={browser:which,alignment:[],errors:[]};
 try{
  const {page,context,errors}=await prepare(browser);
  assert.equal(await page.locator('html').getAttribute('data-gpu2d'),'on');
  report.renderer=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
   return gl?{renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),float:!!gl.getExtension('EXT_color_buffer_float')}:null;});
  assert(report.renderer,'real WebGL2 context required');
  await page.evaluate(()=>{
   const dz=devicePixelRatio>=1.5?1:0;
   window.__debugGrid=new (L.GridLayer.extend({createTile(){const c=document.createElement('canvas');c.width=c.height=256;
    const g=c.getContext('2d');g.strokeStyle='#00ffff';g.lineWidth=1;g.strokeRect(.5,.5,255,255);return c;}}))({tileSize:256/2**dz,zIndex:460,maxZoom:28,updateWhenZooming:false}).addTo(ClearSkiesPortalBridge.map);
  });
  for(const bearing of [0,37,90,180]){
   await page.evaluate(b=>ClearSkiesPortalBridge.map.setBearing(b),bearing);await page.waitForTimeout(120);
   await page.screenshot({path:path.join(OUT,`${which}-bearing-${bearing}.png`)});
   const r=await alignment(page);report.alignment.push({phase:'rest',...r});assert(r.count>0);assert(r.max<1.1,JSON.stringify(r));
  }
  // Sample in the same task's microtask checkpoint, after the camera's atomic
  // preview/commit batch. No additional animation frame may hide a canvas that
  // lags the pane paint; a next-rAF render still fails this comparison.
  await page.evaluate(()=>{
   window.__gestureSamples=[];
   ClearSkiesPortalBridge.map.on('zoomanim',e=>{if(!e.noUpdate)return;
    queueMicrotask(()=>{
      const g=ClearSkiesPortalBridge.gpuTerrain(),v=g.getEngine().stats().lastView;
      __gestureSamples.push({painted:e.zoom,rendered:v.zoom,center:[...v.centerMerc]});
    });
   });
  });
  const box=await page.locator('#map').boundingBox();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.5);
  for(let i=0;i<5;i++){await page.mouse.wheel(0,-45);await page.waitForTimeout(35);report.alignment.push({phase:'wheel',...await alignment(page)});}
  await page.waitForTimeout(700);
  report.gesture=await page.evaluate(()=>__gestureSamples);
  assert(report.gesture.length>3);assert(report.gesture.every(s=>Math.abs(s.painted-s.rendered)<1e-9));
  assert(report.alignment.filter(s=>s.phase==='wheel').every(s=>s.max<1.1));
  await page.setViewportSize({width:1370,height:880});await page.evaluate(()=>ClearSkiesPortalBridge.map.invalidateSize({pan:false}));await page.waitForTimeout(160);
  report.alignment.push({phase:'resize',...await alignment(page)});
  await page.evaluate(()=>document.getElementById('sideToggle')?.click());await page.waitForTimeout(700);
  report.alignment.push({phase:'sidebar',...await alignment(page)});
  // Drive the app's actual pinchFrame hook, including live rotation/pan.
  for(let i=1;i<=12;i++){
   await page.evaluate(async i=>{await new Promise(requestAnimationFrame);const m=ClearSkiesPortalBridge.map;
    if(i===1)window.__pinchBase={center:m.getCenter(),zoom:m.getZoom()};
    m.setBearing(37+i*2);m._move(L.latLng(__pinchBase.center.lat+i*.00001,__pinchBase.center.lng+i*.00002),__pinchBase.zoom+i/30,{pinch:true});
   },i);
   report.alignment.push({phase:'pinch',...await alignment(page)});
  }
  await page.evaluate(()=>{const m=ClearSkiesPortalBridge.map;m._animateZoom(L.latLng(__pinchBase.center.lat+12*.00001,__pinchBase.center.lng+12*.00002),__pinchBase.zoom+.4);});
  await page.waitForTimeout(300);
  // A separate map tests native Leaflet CSS zoom without the app's gesture
  // accumulator or pending wheel settle influencing the native animation.
  await page.evaluate(async code=>{
   const css=document.createElement('style');css.id='nativeZoomCss';css.textContent='#nativeZoomTest .leaflet-zoom-anim .leaflet-zoom-animated{transition:transform .25s cubic-bezier(0,0,.25,1)!important}';document.head.append(css);
   const div=document.createElement('div');div.id='nativeZoomTest';div.style.cssText='position:absolute;inset:0;z-index:9999';document.body.append(div);
   const m=window.__alignmentMap=L.map(div,{rotate:true,bearing:37,zoomAnimation:true,zoomSnap:0}).setView([47.858,-118.33],15);
   window.__mainDebugGrid=__debugGrid;
   window.__debugGrid=new (L.GridLayer.extend({createTile(){const c=document.createElement('canvas');c.width=c.height=256;return c;}}))({tileSize:128,maxZoom:28,updateWhenZooming:false}).addTo(m);
   window.__alignmentLayer=L.cspGpuTerrainLayer({store:new CSPGpuTerrainStore.ElevationTileStore({}),state:__layerApp.gpuTerrainState()}).addTo(m);
   await new Promise(r=>setTimeout(r,100));
   // WebKit advances compositor time between successive getComputedStyle
   // calls, even within one JS callback. Hold the isolated native map's CSS
   // transitions during each geometry comparison so the layer and independent
   // oracle observe the same instant. The app's actual wheel/drag tests above
   // run without this instrumentation; this check isolates native view math.
    const measure=(0,eval)('('+code+')');window.__nativeSamples=[];
    const derive=__alignmentLayer._deriveView;
    __alignmentLayer._deriveView=function(){
      this.__heldAnimations=div.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&/transform$/.test(a.transitionProperty||''));
      for(const animation of this.__heldAnimations){const time=animation.currentTime;animation.pause();animation.currentTime=time;}
      if(this.__heldAnimations.length)this._nativeZoom=true;
      return derive.call(this);
    };
    const engine=__alignmentLayer.getEngine(),render=engine.render;
    engine.render=function(view){
      try{
        const start=performance.now(),sample=measure(view),result=render.call(this,view);
        const grid=__debugGrid,level=grid._levels[grid._tileZoom];
        __nativeSamples.push({phase:'native-zoom',sampling:'held compositor time',...sample,paintMs:performance.now()-start,postPaintMax:measure(view).max,
         nativeAnimating:m._animatingZoom,tileZoom:grid._tileZoom,animations:level.el.getAnimations().map(a=>({time:a.currentTime,state:a.playState}))});return result;
      }finally{
        if(__alignmentLayer.__heldAnimations?.length)__alignmentLayer._nativeZoom=true;
        for(const animation of __alignmentLayer.__heldAnimations||[])animation.play();
      }
    };
   m.setZoom(16,{animate:true});
   // The geometry oracle is not an FPS benchmark. Exercise known positions
   // in the same real CSS transition even when a busy WebKit compositor skips
   // most of its 250 ms wall-clock interval. Natural animation/idle checks
   // below remain in place; the app gesture checks use no held clock.
   const started=performance.now();
   await new Promise((resolve,reject)=>{
    const sample=()=>{
      const animations=div.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&/transform$/.test(a.transitionProperty||''));
      if(!animations.length){if(performance.now()-started>1500)return reject(new Error('Native CSS transition did not start'));requestAnimationFrame(sample);return;}
      const times=animations.map(a=>a.currentTime);
      try{
        for(const animation of animations)animation.pause();
        for(const time of [25,75,125,175,225]){
          for(const animation of animations)animation.currentTime=time;
          __alignmentLayer._nativeZoom=true;__alignmentLayer._dirty=true;__alignmentLayer._draw();
        }
      }finally{animations.forEach((a,i)=>{a.currentTime=times[i];a.play();});}
      __alignmentLayer._nativeZoom=true;__alignmentLayer.redraw();resolve();
    };requestAnimationFrame(sample);
   });
  },measureAlignment.toString());
  await page.waitForFunction(()=>__nativeSamples.length>=3&&!__alignmentMap._animatingZoom&&!__alignmentLayer._nativeZoom&&
    !__alignmentLayer._dirty&&!__alignmentLayer._frame,null,{timeout:2000});
  const nativeSamples=await page.evaluate(()=>__nativeSamples);report.alignment.push(...nativeSamples);
  assert(nativeSamples.filter(s=>s.zoom>15.001&&s.zoom<15.999).length>=3,'native transition must produce interpolated frames');
  report.nativeZoom=await page.evaluate(async()=>{
   const before=__alignmentLayer.getEngine().stats().frames;await new Promise(r=>setTimeout(r,120));
   return {enabled:__alignmentMap._zoomAnimated,animating:__alignmentMap._animatingZoom,tracking:__alignmentLayer._nativeZoom,
    before,after:__alignmentLayer.getEngine().stats().frames};
  });
  assert(report.nativeZoom.enabled);assert.equal(report.nativeZoom.animating,false);assert.equal(report.nativeZoom.tracking,false);
  assert.equal(report.nativeZoom.before,report.nativeZoom.after,'completed native transition must return to idle');
  await page.evaluate(()=>{__alignmentLayer.destroy();__alignmentMap.remove();document.getElementById('nativeZoomTest').remove();document.getElementById('nativeZoomCss').remove();window.__alignmentLayer=null;window.__alignmentMap=null;window.__debugGrid=__mainDebugGrid;});
  await page.waitForTimeout(250);
  // Real drag pan: move callbacks must leave the canvas covering the whole
  // viewport in the same painted frame, including at a rotated bearing.
  await page.mouse.move(1000,450);await page.mouse.down();
  for(let i=1;i<=5;i++){await page.mouse.move(1000-i*25,450+i*8);await page.waitForTimeout(25);report.alignment.push({phase:'pan',...await alignment(page)});}
  await page.mouse.up();await page.waitForTimeout(350);
  // Settings update the single engine without asking for elevation again.
  let elevationRequests=0;const countRequest=req=>{if(/elev|terrarium/.test(req.url()))elevationRequests++;};page.on('request',countRequest);
  await page.evaluate(async()=>{
   for(const [id,value,event] of [['terStyle','aspect','change'],['terOp',63,'input'],['terContrast',112,'input'],['terSaturation',82,'input'],['terBrightness',106,'input'],['terSunAz',123,'input'],['elevAlpha',37,'input']]){
    const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event(event,{bubbles:true}));
   }
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  });
  report.settings=await page.evaluate(()=>({state:ClearSkiesPortalBridge.gpuTerrain().getEngine().stats().state,
   perTileLayers:Object.values(ClearSkiesPortalBridge.map._layers).filter(l=>l._store instanceof Map).length,
   filter:getComputedStyle(ClearSkiesPortalBridge.gpuTerrain().getContainer()).filter,status:document.getElementById('terrainLoadStatus').textContent}));
  page.off('request',countRequest);report.settings.elevationRequests=elevationRequests;
  assert.equal(report.settings.state.terrain.style,'aspect');assert.equal(report.settings.state.terrain.opacity,.63);assert.equal(report.settings.state.terrain.lighting.azimuth,123);
  assert.equal(report.settings.state.terrain.look.contrast,112);assert.equal(report.settings.state.terrain.look.saturation,82);assert.equal(report.settings.state.terrain.look.brightness,106);
  assert.equal(report.settings.perTileLayers,0);assert.equal(report.settings.filter,'none');assert.equal(elevationRequests,0);
  // Removal/addition must reuse the engine; idle must not repaint.
  assert(report.alignment.every(s=>s.max<1.1),JSON.stringify(report.alignment.filter(s=>s.max>=1.1)));
  report.lifecycle=await page.evaluate(async()=>{
   const layer=ClearSkiesPortalBridge.gpuTerrain(),engine=layer.getEngine(),map=ClearSkiesPortalBridge.map;
   map.removeLayer(layer);layer.addTo(map);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   await new Promise(r=>setTimeout(r,400));const before=engine.stats().frames;await new Promise(r=>setTimeout(r,120));
   const store=layer.getStore(),getGrid=store.gridForView,arrayBounds=[[47,-119],[48,-118]],leafletBounds=L.latLngBounds(arrayBounds);
   store.gridForView=()=>({bounds:arrayBounds});const converted=layer.gridForView().bounds;
   store.gridForView=()=>({bounds:leafletBounds});const preservesBounds=layer.gridForView().bounds===leafletBounds;store.gridForView=getGrid;
   return {same:engine===layer.getEngine(),before,after:engine.stats().frames,canvases:document.querySelectorAll('.csp-gpu-terrain').length,
    sample:__layerApp.cursorLoadedElevation(map.getCenter()),grid:__layerApp.researchElevationGrid(layer).width,
    bounds:{preservesBounds,south:converted.getSouthWest().lat,west:converted.getSouthWest().lng,north:converted.getNorthEast().lat,east:converted.getNorthEast().lng}};
  });
  assert(report.lifecycle.same);assert.equal(report.lifecycle.canvases,1);assert.equal(report.lifecycle.before,report.lifecycle.after);assert(report.lifecycle.sample);assert(report.lifecycle.grid);
  assert.deepEqual(report.lifecycle.bounds,{preservesBounds:true,south:47,west:-119,north:48,east:-118});
  report.exports=[];
  await page.evaluate(()=>ClearSkiesPortalBridge.map.removeLayer(__debugGrid));
  for(const bearing of [0,37,90])for(const scale of [1,2,4]){
   await page.evaluate(b=>ClearSkiesPortalBridge.map.setBearing(b),bearing);await page.waitForTimeout(60);
   const r=await page.evaluate(async scale=>{
    const spec=__layerApp.snapshotSpec({x:150,y:120,w:220,h:140},scale),g=ClearSkiesPortalBridge.gpuTerrain();
    const entry=g.snapshotEntry(spec),bitmap=await entry.canvas();
    const pixels=bitmap.getContext('2d').getImageData(0,0,bitmap.width,bitmap.height).data;
    let alpha=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])alpha++;
    const result=await __layerApp.composeSnapshot({...spec,plans:[],tiles:0});
    return {kind:entry.kind,width:bitmap.width,height:bitmap.height,alpha,drawn:result.drawn,bytes:result.blob.size,domIncludesLive:__layerApp.snapshotDomItems(spec.sel).includes(g._canvas)};
   },scale);
   report.exports.push({bearing,scale,...r});assert(r.alpha>0);assert(r.drawn>0);assert(!r.domIncludesLive);assert.equal(r.width,220*scale);
  }
  report.stream=await page.evaluate(async()=>{
   const spec={...__layerApp.snapshotSpec({x:170,y:90,w:180,h:110},2),plans:[],tiles:0},chunks=[];
   const normal=await __layerApp.composeSnapshot(spec);await __layerApp.composeSnapshotStream(spec,chunk=>{chunks.push(chunk);});
   const pixels=async blob=>{const img=new Image(),url=URL.createObjectURL(blob);img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const g=c.getContext('2d');g.drawImage(img,0,0);URL.revokeObjectURL(url);return g.getImageData(0,0,c.width,c.height).data;};
   const a=await pixels(normal.blob),b=await pixels(new Blob(chunks,{type:'image/png'}));let different=0,max=0,alphaDifferent=0;
   for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d){different++;if(i%4===3)alphaDifferent++;}max=Math.max(max,d);}
   // Verify the fixture's GPU-entry pixels exactly before composition. WebKit
   // can round its translucent Canvas2D fixture one color code differently
   // when drawing into the stream path's alpha:false destination canvas.
   const layer=ClearSkiesPortalBridge.gpuTerrain(),first=await layer.snapshotEntry(spec).canvas(),second=await layer.snapshotEntry({...spec,width:spec.width,height:spec.height}).canvas();
   const x=first.getContext('2d').getImageData(0,0,first.width,first.height).data,y=second.getContext('2d').getImageData(0,0,second.width,second.height).data;
   let entryDifferent=0;for(let i=0;i<x.length;i++)if(x[i]!==y[i])entryDifferent++;
   return {different,max,alphaDifferent,entryDifferent,bytes:chunks.reduce((sum,c)=>sum+c.length,0)};
  });assert.equal(report.stream.entryDifferent,0,'full and block terrain-entry pixels must match exactly');
  assert.equal(report.stream.alphaDifferent,0,'stream and regular export alpha must match exactly');
  assert(report.stream.max<=1,'mock Canvas2D stream color quantization exceeded one code value: '+JSON.stringify(report.stream));
  // The real MapLibre module runs with fixture raster responses.
  await page.evaluate(()=>__layerApp.enterTerrain3d().catch(e=>window.__3dError=String(e)));
  await page.waitForFunction(()=>window.__3dError||ClearSkiesPortalBridge.map3d()&&getComputedStyle(ClearSkiesPortalBridge.gpuTerrain()._canvas).visibility==='hidden');
  report.mode3d=await page.evaluate(()=>({error:window.__3dError||null,map:!!ClearSkiesPortalBridge.map3d(),hidden:getComputedStyle(ClearSkiesPortalBridge.gpuTerrain()._canvas).visibility}));
  assert(report.mode3d.map,JSON.stringify(report.mode3d));assert.equal(report.mode3d.hidden,'hidden');
  await page.evaluate(()=>__layerApp.exitTerrain3d());await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>getComputedStyle(ClearSkiesPortalBridge.gpuTerrain()._canvas).visibility),'visible');
  await page.screenshot({path:path.join(OUT,`${which}-aligned.png`)});
  report.errors.push(...errors);await context.close();
  // Stub-engine failure must choose the exact same old path as flag-off.
  const screens=[];
  for(const setup of [{flag:'0',mocked:true},{flag:'1',mocked:false},{flag:'0',mocked:false,baseline:true}]){
   const {page,context,errors}=await prepare(browser,setup);
   if(!setup.baseline)assert.equal(await page.locator('html').getAttribute('data-gpu2d'),'off');
   await page.waitForFunction(()=>{const layers=Object.values(ClearSkiesPortalBridge.map._layers).filter(l=>l._store instanceof Map);return layers.length===2&&layers.every(l=>l._store.size>0&&l._pending.size===0&&!l._cspPending);});
   await page.waitForTimeout(400);
   const dom=await page.evaluate(()=>({gpu:document.querySelectorAll('.csp-gpu-terrain').length,
    elevation:Object.values(ClearSkiesPortalBridge.map._layers).filter(l=>l._store instanceof Map).map(l=>({canvases:Object.keys(l._tiles||{}).length,loaded:l._store.size}))}));
   assert.equal(dom.gpu,0);assert.equal(dom.elevation.length,2);assert(dom.elevation.every(l=>l.loaded>0));
   await page.locator('#map').screenshot({path:path.join(OUT,`${which}-fallback-${screens.length}.png`)});
   screens.push({setup,dom,png:(await page.locator('#map').screenshot()).toString('base64')});report.errors.push(...errors);await context.close();
  }
  report.fallback=screens.map(({setup,dom})=>({setup,dom}));
  const comparePage=await browser.newPage();
  report.fallbackPixelDiff=await comparePage.evaluate(async screens=>{
   const arrays=[];
   for(const base64 of screens){const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);arrays.push(g.getImageData(0,0,c.width,c.height).data);}
   return arrays.slice(1).map(data=>{let different=0,max=0;for(let i=0;i<data.length;i++){const d=Math.abs(data[i]-arrays[0][i]);if(d)different++;max=Math.max(max,d);}return {different,max};});
  },screens.map(s=>s.png));
  await comparePage.close();
  assert(report.fallbackPixelDiff.every(r=>r.different===0),'fallback screenshots must match every base-commit pixel: '+JSON.stringify(report.fallbackPixelDiff));report.fallback=screens.map(({setup,dom})=>({setup,dom}));
  // Classic UI takes the same GPU integration path.
  const classic=await prepare(browser,{ui:'classic',dpr:1});
  assert.equal(await classic.page.locator('html').getAttribute('data-gpu2d'),'on');
  assert.equal(await classic.page.evaluate(()=>ClearSkiesPortalBridge.gpuTerrain().getEngine().stats().lastView.dz),0);
  report.errors.push(...classic.errors);await classic.context.close();
  assert.deepEqual(report.errors,[]);
  fs.writeFileSync(path.join(OUT,`${which}-results.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({browser:which,maxAlignmentPx:Math.max(...report.alignment.map(x=>x.max)),gestureFrames:report.gesture.length,exports:report.exports.length,lifecycle:report.lifecycle,fallback:report.fallback,errors:report.errors},null,2));
 }finally{fs.writeFileSync(path.join(OUT,`${which}-results.json`),JSON.stringify(report,null,2));await browser.close();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={prepare};
