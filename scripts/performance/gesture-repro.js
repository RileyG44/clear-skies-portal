'use strict';
/* Fast-gesture reproduction for the 2D map: a quick swipe with inertia and a
 * quick pinch-out, in WebKit at iPhone 15 Pro Max size (430x932 at 3x, touch,
 * coarse pointer). The page and /api come from a running engine (default
 * http://127.0.0.1:8765); every other client file comes from the working tree,
 * or from a git ref (--ref HEAD) for a baseline, so both use the same data.
 *
 * Gestures use the paths a finger takes: leaflet-rotate's pinch calls
 * map._move(center, zoom, {pinch:true}) once per frame and _animateZoom at
 * lift-off; a swipe moves the map pane every frame, then Leaflet's inertia.
 *
 * The map background is magenta (#ff00ff), so a pixel where no layer drew is
 * unambiguous in screenshots. --bare also removes every raster layer, so a
 * magenta pixel is then a hole in the GPU terrain itself.
 *
 * Run: node scripts/performance/gesture-repro.js [--ref HEAD] [--look aurora]
 *        [--bare] [--zoom 16] [--to 11] [--ms 900] [--out name]
 * Results: output/performance-audit/gesture/<out>.json (+ hole frames as PNG).
 * Laptop WebKit timings are information only; the phone is the measure. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'../..');
const pw=require('/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const argv=process.argv.slice(2),opt=(name,fallback)=>{const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1]&&!argv[i+1].startsWith('--')?argv[i+1]:true;};
const ENGINE=process.env.CSP_ENGINE||'http://127.0.0.1:8765',REF=opt('ref',null),LOOK=opt('look','aurora'),BARE=!!opt('bare',false);
const PROFILE=!!opt('profile',false);
const Z0=+opt('zoom',16),Z1=+opt('to',11),PINCH_MS=+opt('ms',900),CENTER=(opt('center','47.858,-118.33')+'').split(',').map(Number);
const OUT=path.join(root,'output/performance-audit/gesture'),NAME=opt('out',(REF?'ref-'+REF:'tree')+(BARE?'-bare':''));
fs.mkdirSync(OUT,{recursive:true});
const TYPES={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm','.jpg':'image/jpeg'};
const assetCache=new Map();
function asset(file){
  if(assetCache.has(file))return assetCache.get(file);
  let body=null;
  if(REF){try{body=cp.execFileSync('git',['show',`${REF}:${file}`],{cwd:root,maxBuffer:256<<20,stdio:['ignore','pipe','ignore']});}catch{body=null;}}
  else{const full=path.join(root,file);if(full.startsWith(root)&&fs.existsSync(full)&&fs.statSync(full).isFile())body=fs.readFileSync(full);}
  assetCache.set(file,body);return body;
}
/* Minimal PNG reader for Playwright screenshots (8-bit RGB/RGBA, no interlace). */
function readPng(buffer){
  let offset=8,width=0,height=0,type=0;const idat=[];
  while(offset<buffer.length){
    const length=buffer.readUInt32BE(offset),name=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,offset+8+length);
    if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);type=data[9];if(data[8]!==8||data[12])throw Error('Unsupported PNG');}
    else if(name==='IDAT')idat.push(data);else if(name==='IEND')break;
    offset+=12+length;
  }
  const channels=type===6?4:type===2?3:0;if(!channels)throw Error('Unsupported PNG colour type '+type);
  const raw=zlib.inflateSync(Buffer.concat(idat)),stride=width*channels,out=Buffer.alloc(width*height*4);
  let previous=Buffer.alloc(stride);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)],row=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
    for(let x=0;x<stride;x++){
      const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;
      if(filter===1)row[x]+=a;else if(filter===2)row[x]+=b;else if(filter===3)row[x]+=(a+b)>>1;
      else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);row[x]+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
    }
    for(let x=0;x<width;x++){const s=x*channels,d=(y*width+x)*4;out[d]=row[s];out[d+1]=row[s+1];out[d+2]=row[s+2];out[d+3]=channels===4?row[s+3]:255;}
    previous=row;
  }
  return {width,height,data:out};
}
/* Fraction of magenta pixels and of 16x16 cells that are mostly magenta. */
function holes(png){
  const {width,height,data}=png,cell=16,cols=Math.ceil(width/cell),rows=Math.ceil(height/cell),counts=new Uint32Array(cols*rows),sizes=new Uint32Array(cols*rows);
  let magenta=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,k=Math.floor(y/cell)*cols+Math.floor(x/cell);sizes[k]++;
    if(data[i]>235&&data[i+1]<30&&data[i+2]>235){magenta++;counts[k]++;}
  }
  let cells=0;for(let k=0;k<counts.length;k++)if(counts[k]>sizes[k]*.5)cells++;
  return {fraction:magenta/(width*height),cells,cellTotal:counts.length,mask:Array.from(counts,(n,k)=>n>sizes[k]*.5?1:0)};
}
(async()=>{
  const browser=await pw.webkit.launch();
  const report={engine:ENGINE,ref:REF||'working tree',look:LOOK,bare:BARE,center:CENTER,zoom:[Z0,Z1],pinchMs:PINCH_MS,errors:[]};
  /* One fresh context per pass: cold page and HTTP caches, same engine. */
  async function session(){
    const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:3,isMobile:true,hasTouch:true,serviceWorkers:'block'});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==ENGINE||url.pathname.startsWith('/api/'))return route.continue();
      const file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      if(file==='sw.js')return route.fulfill({status:404,body:''});
      const body=asset(file);if(!body)return route.continue();
      return route.fulfill({status:200,contentType:TYPES[path.extname(file)]||'application/octet-stream',body});
    });
    await context.addInitScript(()=>{try{localStorage.setItem('clearskies.mapTheme.v1','light');}catch{}});
    const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push(String(e)));
    await page.goto(ENGINE+'/?gpu2d=1');
    await page.waitForFunction(()=>window.ClearSkiesPortalBridge?.gpuTerrain?.()&&document.documentElement.dataset.gpu2d==='on',null,{timeout:60000});
    await page.addStyleTag({content:'#side,#mapDock,#sideToggleDock,.leaflet-control-container,#cspStartup,#blk{display:none!important}'+
      '#map,.leaflet-container,#map[data-basemap-theme]{background:#ff00ff!important}'});
    report.build=await page.evaluate(()=>CSP_BUILD);
    await page.evaluate(async({center,zoom,look,bare})=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),m=ClearSkiesPortalBridge.map;
      m.setBearing?.(0);m.setView(center,zoom,{animate:false});
      const style=document.getElementById('terStyle');style.value=look==='hs'?'hs':'rem';style.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(300);
      document.querySelector(`#terStudio [data-look="${look}"]`)?.click();
      await wait(300);
      if(bare)for(const layer of Object.values(m._layers))if(layer instanceof L.GridLayer)m.removeLayer(layer);
    },{center:CENTER,zoom:Z0,look:LOOK,bare:BARE});
    // Let the start view load completely (the engine may render cold tiles).
    const startLoad=await page.evaluate(async()=>{
      const g=ClearSkiesPortalBridge.gpuTerrain(),s=g.getStore(),t0=performance.now();
      while(performance.now()-t0<45000){
        await new Promise(r=>setTimeout(r,250));
        const raster=Object.values(ClearSkiesPortalBridge.map._layers).filter(l=>l instanceof L.GridLayer).every(l=>Object.values(l._tiles).every(t=>t.loaded));
        if(s.stats().pending===0&&raster&&g.getEngine().stats().queuedUploads===0)break;
      }
      await new Promise(r=>setTimeout(r,800));
      return {ms:Math.round(performance.now()-t0),store:s.stats(),gpu:g.getEngine().stats(),stack:g._state?.terrain?.stack?.layers?.map(l=>l.style)};
    });
    // Instrument per-frame state; nothing here changes what the app renders.
    await page.evaluate(()=>{
      const B=ClearSkiesPortalBridge,g=B.gpuTerrain(),e=g.getEngine(),s=g.getStore();
      window.__frames=[];window.__recording=false;
      const loop=t=>{
        if(window.__recording){
          const st=e.stats(),ss=s.stats(),m=B.map;
          window.__frames.push({t,zoom:m.getZoom(),painted:g._view?.zoom,coverage:g._coverage?.coverage,missing:g._coverage?.missing,
            frames:st.frames,uploads:st.uploads,evictions:st.evictions,textures:st.textures,textureBytes:st.textureBytes,queued:st.queuedUploads,
            drawCalls:st.drawCalls,renderMs:st.lastFrameMs,phase:st.phaseMs,planEntries:st.planEntries,storeTiles:ss.tiles,storeBytes:ss.bytes,pending:ss.pending,
            rasterHolds:Object.values(m._layers).reduce((n,l)=>n+(l._cspHolds?.length||0),0)});
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    if(PROFILE)await page.evaluate(()=>{
      /* Main-thread attribution: wall time inside each wrapped function, and a
         MessageChannel heartbeat whose gaps are main-thread blocking. */
      const P=window.__profile={totals:{},counts:{},gaps:[]};
      const wrap=(owner,name,label)=>{const f=owner&&owner[name];if(typeof f!=='function'||f.__wrapped)return;
        const w=function(...a){const t=performance.now();try{return f.apply(this,a);}finally{const d=performance.now()-t;if(window.__recording){P.totals[label]=(P.totals[label]||0)+d;P.counts[label]=(P.counts[label]||0)+1;}}};
        w.__wrapped=true;owner[name]=w;};
      const G=L.GridLayer.prototype;['_update','_addTile','_tileReady','_pruneTiles','_setView','_updateOpacity','_invalidateAll','_resetView','_onMoveEnd','_updateLevels','_setZoomTransforms']
        .forEach(n=>wrap(G,n,'grid.'+n));
      wrap(L.CSPGpuTerrainLayer.prototype,'_draw','gpuLayer._draw');
      const e=ClearSkiesPortalBridge.gpuTerrain().getEngine();wrap(e,'render','engine.render');
      const S=CSPGpuTerrainStore.ElevationTileStore.prototype;['want','_record','_evict','_emit','settled','provenance'].forEach(n=>wrap(S,n,'store.'+n));
      wrap(ElevationTileCore,'decodeTerrarium','decodeTerrarium');wrap(ElevationTileCore,'resampleElevation','resampleElevation');
      wrap(CanvasRenderingContext2D.prototype,'getImageData','2d.getImageData');wrap(CanvasRenderingContext2D.prototype,'drawImage','2d.drawImage');
      wrap(WebGL2RenderingContext.prototype,'texImage2D','gl.texImage2D');wrap(WebGL2RenderingContext.prototype,'deleteTexture','gl.deleteTexture');
      wrap(L.Map.prototype,'fire','map.fire');
      const ch=new MessageChannel();let last=performance.now();
      ch.port1.onmessage=()=>{const t=performance.now();if(window.__recording&&t-last>12)P.gaps.push(Math.round(t-last));last=t;setTimeout(()=>ch.port2.postMessage(0),0);};
      ch.port2.postMessage(0);
    });
    return {context,page,startLoad};
  }
  /* Screenshots stall WebKit's rendering, so each gesture runs twice from the
     same loaded start: once for frame timing with no screenshots, then once
     with back-to-back screenshots for holes. */
  async function capture(page,label,run,withShots){
    const shots=[];let done=false;
    await page.evaluate(()=>{window.__frames=[];window.__recording=true;});
    const job=page.evaluate(run).then(v=>{done=true;return v;});
    const t0=Date.now();
    while(withShots&&!done){const at=Date.now()-t0,buffer=await page.screenshot({scale:'css',type:'png'});shots.push({at,buffer});}
    const result=await job;
    const settle=Date.now();
    while(Date.now()-settle<2500){if(withShots){const at=Date.now()-t0;shots.push({at,buffer:await page.screenshot({scale:'css',type:'png'})});}await new Promise(r=>setTimeout(r,250));}
    const frames=await page.evaluate(()=>{window.__recording=false;return window.__frames;});
    const profile=PROFILE?await page.evaluate(()=>{const P=window.__profile,out={totals:{},gaps:P.gaps.slice().sort((a,b)=>b-a).slice(0,15),blockedMs:P.gaps.reduce((a,b)=>a+b,0)};
      for(const [k,v] of Object.entries(P.totals))out.totals[k]={ms:Math.round(v),n:P.counts[k]};P.totals={};P.counts={};P.gaps=[];return out;}):null;
    const dt=frames.slice(1).map((f,i)=>f.t-frames[i].t).sort((a,b)=>a-b),pct=p=>dt.length?Math.round(dt[Math.min(dt.length-1,Math.ceil(dt.length*p)-1)]*10)/10:null;
    const analysed=shots.map((s,i)=>{const h=holes(readPng(s.buffer));return {at:s.at,fraction:+h.fraction.toFixed(4),cells:h.cells,mask:h.mask,i};});
    // Strobing: a cell that is a hole, fills, and is a hole again later.
    const cellCount=analysed[0]?.mask.length||0;let strobing=0;
    for(let k=0;k<cellCount;k++){let state=0,flips=0;for(const a of analysed){const v=a.mask[k];if(v!==state){flips++;state=v;}}if(flips>=3)strobing++;}
    const worst=analysed.reduce((a,b)=>b.fraction>a.fraction?b:a,analysed[0]||{fraction:0});
    for(const a of analysed)if(a===worst||a.i%4===0)fs.writeFileSync(path.join(OUT,`${NAME}-${label}-${String(a.i).padStart(3,'0')}.png`),shots[a.i].buffer);
    const first=frames[0]||{},last=frames.at(-1)||{};
    return {result,profile,frames:frames.length,dt:{p50:pct(.5),p95:pct(.95),p99:pct(.99),max:dt.at(-1)??null,over33:dt.filter(x=>x>33.4).length,over50:dt.filter(x=>x>50).length},
      uploads:(last.uploads??0)-(first.uploads??0),evictions:(last.evictions??0)-(first.evictions??0),maxTextures:Math.max(0,...frames.map(f=>f.textures||0)),
      maxQueued:Math.max(0,...frames.map(f=>f.queued||0)),maxPending:Math.max(0,...frames.map(f=>f.pending||0)),
      minGeometryCoverage:Math.min(1,...frames.map(f=>f.coverage??1)),maxRenderMs:Math.max(0,...frames.map(f=>f.renderMs||0)),
      holes:analysed.map(a=>({at:a.at,fraction:a.fraction,cells:a.cells})),strobingCells:strobing,cellTotal:cellCount,
      worstHole:worst&&{at:worst.at,fraction:worst.fraction},finalHole:analysed.at(-1)?.fraction??null,
      frameLog:frames.map(f=>({t:Math.round(f.t),zoom:+(f.painted??f.zoom).toFixed(3),cov:f.coverage==null?null:+f.coverage.toFixed(3),
        up:f.uploads,ev:f.evictions,tex:f.textures,q:f.queued,dc:f.drawCalls,ms:f.renderMs,ph:f.phase&&Object.fromEntries(Object.entries(f.phase).map(([k,v])=>[k,+v.toFixed(1)])),pe:f.planEntries,pend:f.pending,holds:f.rasterHolds}))};
  }
  const pinch=async({z0,z1,ms})=>{
    const m=ClearSkiesPortalBridge.map,center=m.getCenter(),t0=performance.now();
    m._moveStart(true,false);
    await new Promise(resolve=>{const step=t=>{const k=Math.min(1,(t-t0)/ms),z=z0+(z1-z0)*(1-Math.pow(1-k,1.6));
      m._move(center,z,{pinch:true,round:false});if(k<1)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);});
    m._animateZoom(center,z1,true,0);
    return {ms:Math.round(performance.now()-t0),zoom:m.getZoom()};
  };
  const swipe=async()=>{
    const m=ClearSkiesPortalBridge.map,t0=performance.now();
    m.fire('movestart');m.fire('dragstart');
    // 380 ms finger drag at ~45 CSS px per frame, then Leaflet's inertia.
    await new Promise(resolve=>{const step=t=>{m._rawPanBy(L.point(45,18));m.fire('move');m.fire('drag');
      if(t-t0<380)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);});
    m.fire('dragend',{distance:600});
    m.panBy(L.point(1100,440),{duration:1.1,easeLinearity:.2,noMoveStart:true,animate:true});
    await new Promise(r=>setTimeout(r,1200));
    return {ms:Math.round(performance.now()-t0)};
  };
  const PROBE=opt('probe',null);
  if(PROBE){
    // Run an iOS Debug probe body (see ios/scripts/verify_shell_on_device.py) here.
    const {context,page}=await session(),body=fs.readFileSync(path.resolve(PROBE),'utf8');
    const result=await page.evaluate('(async()=>{'+body+'\n})()');
    fs.writeFileSync(path.join(OUT,NAME+'-probe.json'),JSON.stringify(result,null,1)+'\n');
    console.log(JSON.stringify(result,null,1));await context.close();await browser.close();return;
  }
  const gestures={pinch:new Function('return ('+pinch.toString()+')({z0:'+Z0+',z1:'+Z1+',ms:'+PINCH_MS+'})'),swipe:new Function('return ('+swipe.toString()+')()')};
  const settle=page=>page.evaluate(async()=>{const s=ClearSkiesPortalBridge.gpuTerrain().getStore(),t0=performance.now();
    while(s.stats().pending&&performance.now()-t0<20000)await new Promise(r=>setTimeout(r,250));return {ms:Math.round(performance.now()-t0),store:s.stats()};});
  for(const [label,run] of Object.entries(gestures))for(const withShots of [false,true]){
    const {context,page,startLoad}=await session();
    const key=(label==='pinch'?'pinchOut':'swipe')+(withShots?'':'Timing');
    report[key]=await capture(page,label+(withShots?'':'-timing'),run,withShots);
    report[key].startLoad=startLoad;report[key].settle=await settle(page);
    await context.close();
  }
  report.startLoad=report.pinchOut.startLoad;
  fs.writeFileSync(path.join(OUT,NAME+'.json'),JSON.stringify(report,null,1)+'\n');
  const brief=r=>({dt:r.dt,uploads:r.uploads,evictions:r.evictions,maxTextures:r.maxTextures,maxQueued:r.maxQueued,minGeometryCoverage:r.minGeometryCoverage,
    worstHole:r.worstHole,finalHole:r.finalHole,strobingCells:r.strobingCells,shots:r.holes.length});
  const timing=r=>({dt:r.dt,uploads:r.uploads,evictions:r.evictions,maxTextures:r.maxTextures,maxPending:r.maxPending,maxRenderMs:r.maxRenderMs});
  console.log(JSON.stringify({build:report.build,ref:report.ref,bare:BARE,startLoad:{ms:report.startLoad.ms,store:report.startLoad.store,textures:report.startLoad.gpu.textures,stack:report.startLoad.stack},
    pinchTiming:timing(report.pinchOutTiming),pinchVisual:brief(report.pinchOut),swipeTiming:timing(report.swipeTiming),swipeVisual:brief(report.swipe),errors:report.errors.slice(0,5)},null,1));
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
