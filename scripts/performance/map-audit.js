'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=process.cwd(),B=process.env.B||'webkit';
const pw=require(B==='webkit'?'/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core':'/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const {prepare}=require(path.join(root,'scripts/gpu2d/layer-browser'));
const {encodePNG}=require(path.join(root,'usgs'));
const {decodePng}=require(path.join(root,'scripts/gpu2d/harness-lib'));
const out=path.join(root,'output/performance-audit');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=B==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
 const report={browser:B,checks:{},errors:[]};
 try{
 const {context,page,errors}=await prepare(browser,{mocked:'real',dpr:3});
 page.setDefaultTimeout(15000);await page.setViewportSize({width:430,height:932});
 await page.evaluate(()=>{if(!document.body.classList.contains('collapsed'))document.getElementById('sideToggle').click();ClearSkiesPortalBridge.map.invalidateSize({pan:false});});
 await page.waitForTimeout(1500);
 await page.waitForFunction(()=>ClearSkiesPortalBridge.gpuTerrain().getStore().stats().pending===0);
 report.build=await page.evaluate(()=>CSP_BUILD);report.sourceHashes=Object.fromEntries(['index.html','gpu-terrain-engine.js','gpu-terrain-layer.js','gpu-terrain-store.js'].map(p=>[p,fs.readFileSync(path.join(root,p))]).concat([['app.js',require('../../site.js').appSource(root)]]).map(([p,b])=>[p,require('crypto').createHash('sha256').update(b).digest('hex')]));
 report.checks.sourceReplacement=await page.evaluate(async()=>{const g=ClearSkiesPortalBridge.gpuTerrain(),s=g.getStore(),req=s.options.request,before={coverage:g._coverage?.coverage,tiles:s.stats().tiles};s.options.request=(...a)=>new Promise(r=>setTimeout(r,1500)).then(()=>req(...a));const el=document.getElementById('terSrc');el.value='auto';el.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,250));const during={coverage:g._coverage?.coverage,pixelCoverage:(await g.getEngine().readProvenance(g._view)).coverage,tiles:s.stats().tiles};await new Promise(r=>setTimeout(r,2400));s.options.request=req;return {before,during,after:{coverage:g._coverage?.coverage,tiles:s.stats().tiles},fixture:'1500ms request-adapter delay on source replacement'};});
 assert(report.checks.sourceReplacement.during.pixelCoverage>=.98,'source refresh erased valid terrain');
 report.checks.duplicateRenders=await page.evaluate(async()=>{
  const B=ClearSkiesPortalBridge,m=B.map,g=B.gpuTerrain(),e=g.getEngine(),original=e.render,rows=[];let count=0;
  e.render=function(v){count++;return original.call(this,v);};
  try{for(let i=0;i<24;i++){await new Promise(requestAnimationFrame);const before=count;m.setBearing(i*1.5);m._move(L.latLng(47.858+i*.00001,-118.33),15+i*.005,{pinch:true});rows.push(count-before);}m._animateZoom(m.getCenter(),15.12);}
  finally{e.render=original;}return {perInput:rows,total:rows.reduce((a,b)=>a+b,0)};
 });
 assert(report.checks.duplicateRenders.perInput.slice(2).every(n=>n<=1),'steady combined gesture must shade once per input');
 report.checks.passingCommitRenders=await page.evaluate(async()=>{
  const m=ClearSkiesPortalBridge.map,e=ClearSkiesPortalBridge.gpuTerrain().getEngine(),original=e.render,rows=[];
  m.setBearing(0);m.setView([47.858,-118.33],16,{animate:false});await new Promise(r=>setTimeout(r,500));
  let calls=0;e.render=function(v){calls++;return original.call(this,v);};
  try{
    m._moveStart(true,false);
    for(const zoom of [15.9,15.4,15,14.6,14.1,13.6,13.1,12.6,12.1,11.6,11]){
      await new Promise(requestAnimationFrame);calls=0;const before=e.stats().frames;
      m._move(L.latLng(47.858,-118.33),zoom,{pinch:true,round:false});
      rows.push({zoom,renders:calls,shades:e.stats().frames-before});
    }
    m._animateZoom(L.latLng(47.858,-118.33),11,true,0);
  }finally{e.render=original;}
  return rows;
 });
 assert(report.checks.passingCommitRenders.every(r=>r.renders===1&&r.shades<=1),'a passing pinch commit must shade only its final camera');
 report.checks.sourceCapture=await page.evaluate(async()=>{
  const g=ClearSkiesPortalBridge.gpuTerrain(),e=g.getEngine(),s=g.getStore(),sources=s.options.sources,request=s.options.request;
  const live=g._view,snapshot=e.createSnapshot(live),jobs=[];
  const crop=CSPGpuTerrainLayer.exportView(live,{sel:{x:100,y:100,w:80,h:60},scale:1,width:80,height:60});
  const pixels=async()=>{const cv=await e.renderToCanvas(crop,80,60,null,{snapshot,detail:false});return cv.getContext('2d').getImageData(0,0,80,60).data;};
  try{
    const before=await pixels(),specs=sources().filter(x=>x.id!=='raw').map(x=>x.id==='national'?{...x,cacheKey:'capture-refresh'}:x);
    s.options.sources=()=>specs;s.options.request=()=>new Promise(resolve=>jobs.push(resolve));e.setState(g._state);e.render(live);
    await Promise.resolve();const during=(await e.readProvenance(live)).coverage;
    const after=await pixels();let different=0;for(let i=0;i<before.length;i++)if(before[i]!==after[i])different++;
    jobs.forEach(resolve=>resolve({width:2,height:2,grid:new Float32Array(4).fill(1000)}));
    await Promise.all([...s._pending.values()].map(p=>p.promise));snapshot.release();
    for(let i=0;i<10;i++){e.render(live);await new Promise(requestAnimationFrame);}
    return {different,during,currentSample:g.sampleAt(ClearSkiesPortalBridge.map.getCenter())?.value,
      glError:g._canvas.getContext('webgl2').getError(),exportTextures:e.stats().exportTextures};
  }finally{snapshot.release();s.options.sources=sources;s.options.request=request;g.redraw();}
 });
 assert.equal(report.checks.sourceCapture.different,0,'source refresh changed an in-progress capture');
 assert(report.checks.sourceCapture.during>=.98,'source refresh erased the live fallback during capture');
 assert.equal(report.checks.sourceCapture.currentSample,1000,'current source must replace fallback after capture releases');
 assert.equal(report.checks.sourceCapture.glError,0,'capture used a deleted/invalid GPU texture');
 assert.equal(report.checks.sourceCapture.exportTextures,0,'capture release leaked export textures');
 // Use the application's actual GridLayer invalidation/hold patches and a
 // deterministic slow photographic provider. This is an isolated test tab.
 let delay=false,fail=false;const pixels=Buffer.alloc(256*256*4);for(let i=0;i<pixels.length;i+=4)pixels.set([200,40,150,255],i);const png=encodePNG(pixels,256,256);
 await page.route('**/audit-tiles/**',async r=>{if(delay)await new Promise(r=>setTimeout(r,4000));if(fail)return r.abort().catch(()=>{});await r.fulfill({contentType:'image/png',body:png}).catch(()=>{});});
 await page.addStyleTag({content:'#side,#mapDock,#sideToggleDock,.leaflet-control-container{display:none!important}'});
 await page.evaluate(()=>{const m=ClearSkiesPortalBridge.map;for(const l of Object.values(m._layers))m.removeLayer(l);m.setBearing(0);m.setView([47.858,-118.33],9,{animate:false});window.__auditImage=L.tileLayer('/audit-tiles/{z}/{x}/{y}.png',{maxZoom:28,updateWhenZooming:false}).addTo(m);});
 await page.waitForFunction(()=>Object.values(__auditImage._tiles).every(t=>t.loaded));await page.waitForTimeout(300);
 const shots=[];
 const shot=async name=>{const p=path.join(out,`${B}-${name}.png`),buf=await page.screenshot({path:p,clip:{x:110,y:200,width:200,height:250}});const im=decodePng(buf);let magenta=0;for(let i=0;i<im.data.length;i+=4)if(im.data[i]-im.data[i+1]>15&&im.data[i+2]-im.data[i+1]>8)magenta++;
  const state=await page.evaluate(()=>({elapsedMs:performance.now()-window.__auditZoomStart,holds:__auditImage._cspHolds?.length||0,loaded:Object.values(__auditImage._tiles).filter(t=>t.loaded).length,total:Object.keys(__auditImage._tiles).length,opacity:__auditImage.options.opacity,tileOpacity:Object.values(__auditImage._tiles).slice(0,1).map(t=>({inline:t.el.style.opacity,computed:getComputedStyle(t.el).opacity,loaded:t.loaded}))}));shots.push({name,coverage:magenta/(im.width*im.height),...state});};
 await shot('loaded');delay=true;await page.evaluate(()=>{window.__auditZoomStart=performance.now();ClearSkiesPortalBridge.map.setZoom(10,{animate:false});});
 await page.waitForTimeout(350);await shot('hold-350ms');await page.waitForTimeout(2400);await shot('hold-2750ms');await page.waitForTimeout(1600);await shot('replacement-4350ms');
 await page.waitForTimeout(1000);await shot('replacement-5350ms');
 assert(shots.every(r=>r.coverage>=.98),'slow replacement exposed the map background');
 assert.equal(shots.at(-1).holds,0,'successful replacement must release held tiles');
 report.checks.slowReplacement=shots.slice();
 fail=true;await page.evaluate(()=>ClearSkiesPortalBridge.map.setZoom(11,{animate:false}));
 await page.waitForTimeout(4500);await shot('failed-replacement');
 assert(shots.at(-1).coverage>=.98&&shots.at(-1).holds>0,'failed load discarded useful fallback');
 await page.evaluate(()=>{const m=ClearSkiesPortalBridge.map;m.panBy([20,10],{animate:false});m.setBearing(37);});
 await page.waitForTimeout(300);await shot('failed-replacement-pan-rotate');
 assert(shots.at(-1).coverage>=.98,'held tiles became misaligned after pan/rotation');
 report.checks.holdAlignment=await page.evaluate(()=>{
  const m=ClearSkiesPortalBridge.map,cache=new Map([[m.getContainer(),new DOMMatrix()]]);
  const matrix=node=>{if(cache.has(node))return cache.get(node);
    const cs=getComputedStyle(node),[ox,oy]=cs.transformOrigin.split(' ').map(v=>parseFloat(v)||0);
    let local=new DOMMatrix().translate(node.offsetLeft||0,node.offsetTop||0);
    if(cs.transform!=='none')local=local.translate(ox,oy).multiply(new DOMMatrix(cs.transform)).translate(-ox,-oy);
    const result=matrix(node.parentElement).multiply(local);cache.set(node,result);return result;};
  let max=0,points=0;
  for(const tile of document.querySelectorAll('.csp-tile-hold img')){
    const coords=tile.src.match(/\/audit-tiles\/(\d+)\/(\d+)\/(\d+)\.png/);if(!coords)continue;
    const [,z,x,y]=coords.map(Number),transform=matrix(tile);
    for(const [dx,dy] of [[0,0],[256,0],[0,256],[256,256]]){
      const expected=m.latLngToContainerPoint(m.unproject([x*256+dx,y*256+dy],z));
      if(expected.x<0||expected.y<0||expected.x>m.getSize().x||expected.y>m.getSize().y)continue;
      const actual=transform.transformPoint({x:dx,y:dy});max=Math.max(max,Math.hypot(actual.x-expected.x,actual.y-expected.y));points++;
    }
  }
  return {max,points};
 });
 assert(report.checks.holdAlignment.points>0&&report.checks.holdAlignment.max<1.1,'held imagery shifted geographically');
 for(const zoom of [12,13,12,11]){await page.evaluate(z=>ClearSkiesPortalBridge.map.setZoom(z,{animate:false}),zoom);await page.waitForTimeout(50);}
 assert(await page.evaluate(()=>__auditImage._cspHolds.length<=2),'held levels must remain bounded');
 report.checks.failedReplacement=shots.slice(-2);
 report.checks.cleanup=await page.evaluate(()=>{ClearSkiesPortalBridge.map.removeLayer(__auditImage);return {holds:__auditImage._cspHolds.length,map:!!__auditImage._cspHoldMap};});
 assert.deepEqual(report.checks.cleanup,{holds:0,map:false},'layer removal must release held pixels and map listeners');
 report.errors=errors;await context.close();
 }catch(error){report.failure=String(error.stack||error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,`browser-${B}.json`),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify(report,null,2));
})();
