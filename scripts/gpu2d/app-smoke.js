'use strict';
/* Production engine/store/shaders inside the complete app, with deterministic
 * decoded-network fixtures supplied by layer-browser.js. Never touches :8765.
 * CSP_GPU2D_URL=http://127.0.0.1:8816 B=chrome|webkit node scripts/gpu2d/app-smoke.js
 * These are integration checks; full real-terrain parity/performance is separate. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {prepare}=require('./layer-browser');
const which=process.env.B||'chrome';
const pw=require(which==='webkit'?'/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core':'/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
(async()=>{
 const browser=which==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
 const report={browser:which,fixture:'flat 352m native Terrarium, production modules',checks:[]};
 try{
  const {context,page,errors}=await prepare(browser,{mocked:'real'});
  await page.waitForFunction(()=>{const g=ClearSkiesPortalBridge.gpuTerrain();return g&&g.getStore().stats().pending===0&&g._coverage?.coverage>=.98;});
  assert.equal(await page.locator('html').getAttribute('data-gpu2d'),'on');
  const initial=await page.evaluate(async()=>{
   const g=ClearSkiesPortalBridge.gpuTerrain(),m=ClearSkiesPortalBridge.map;
   const p=await g.getEngine().readProvenance(g._view),grid=g.gridForView();
   return {stats:g.getEngine().stats(),status:g.settled(),sample:g.sampleAt(m.getCenter()),provenance:p,
    grid:{width:grid.width,height:grid.height,first:grid.grid[0],last:grid.grid.at(-1),resolution:grid.resolution},
    canvases:document.querySelectorAll('.csp-gpu-terrain').length,perTile:Object.values(m._layers).filter(l=>l._store instanceof Map).length};
  });
  assert.equal(initial.canvases,1);assert.equal(initial.perTile,0);assert.equal(initial.sample.value,352);
  assert.equal(initial.grid.first,352);assert.equal(initial.grid.last,352);assert(initial.provenance.coverage>=.98);
  report.initial=initial;report.checks.push('single canvas, full pixel coverage, cursor/research/provenance');
  let requests=0;page.on('request',r=>{if(/elev|terrarium/.test(r.url()))requests++;});
  const settings=await page.evaluate(async()=>{
   const g=ClearSkiesPortalBridge.gpuTerrain(),out=[];
   for(const style of ['hs','hsmulti','slope','aspect','northness','tint','c2','c5','c10','c25']){
    const el=document.getElementById('terStyle');el.value=style;el.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>requestAnimationFrame(r));
    const result=await g.getEngine().readProvenance(g._view);out.push({style,coverage:result.coverage});
   }
   const el=document.getElementById('terSunAz');el.value=123;el.dispatchEvent(new Event('input',{bubbles:true}));
   const alpha=document.getElementById('terOp');alpha.value=63;alpha.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>requestAnimationFrame(r));return {out,state:g._state};
  });
  assert(settings.out.every(s=>s.coverage>=.98));assert.equal(settings.state.terrain.opacity,.63);assert.equal(settings.state.terrain.lighting.azimuth,123);
  assert.equal(requests,0,'resident settings updates must not fetch');report.settings=settings;report.checks.push('all styles and lighting/opacity: no network');
  report.exports=await page.evaluate(async()=>{
   const g=ClearSkiesPortalBridge.gpuTerrain(),m=ClearSkiesPortalBridge.map,out=[];
   for(const bearing of [0,37,90,180]){
    m.setBearing(bearing);await new Promise(r=>requestAnimationFrame(r));
    for(const scale of [1,2,4]){
     const entry=g.snapshotEntry({sel:{x:100,y:80,w:120,h:80},scale,width:120*scale,height:80*scale});
     let cv;try{cv=await entry.canvas();}finally{entry.dispose();}
     const p=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
     let valid=0;for(let i=3;i<p.length;i+=4)if(p[i])valid++;
     out.push({bearing,scale,width:cv.width,height:cv.height,coverage:valid/(cv.width*cv.height)});
    }
   }return out;
  });
  assert(report.exports.every(e=>e.coverage>.98));
  assert.equal(await page.evaluate(()=>ClearSkiesPortalBridge.gpuTerrain().getEngine().stats().exportTextures),0,'export entries must release their snapshot');
  report.checks.push('12 production exports: bearings 0/37/90/180, 1x/2x/4x');
  report.stream=await page.evaluate(async()=>{
   const spec={...__layerApp.snapshotSpec({x:170,y:90,w:180,h:110},2),plans:[],tiles:0},chunks=[];
   const normal=await __layerApp.composeSnapshot(spec);
   await __layerApp.composeSnapshotStream(spec,chunk=>chunks.push(chunk));
   const pixels=async blob=>{const bitmap=await createImageBitmap(blob),cv=document.createElement('canvas');cv.width=bitmap.width;cv.height=bitmap.height;
    const ctx=cv.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,cv.width,cv.height).data;};
   const a=await pixels(normal.blob),b=await pixels(new Blob(chunks,{type:'image/png'}));let different=0,max=0;
   for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)different++;max=Math.max(max,d);}
   return {different,max,channels:a.length};
  });
  assert.equal(report.stream.different,0,'production streamed and regular exports must match');report.checks.push('regular/streamed app exports match exactly');
  report.deepZoom=await page.evaluate(async()=>{
   const m=ClearSkiesPortalBridge.map,g=ClearSkiesPortalBridge.gpuTerrain(),out=[];
   for(let zoom=15;zoom<=28;zoom+=.25){
    m.setView(m.getCenter(),zoom,{animate:false});await new Promise(r=>requestAnimationFrame(r));
    const p=await g.getEngine().readProvenance(g._view);out.push({zoom,coverage:p.coverage});
   }return out;
  });
  assert(report.deepZoom.every(z=>z.coverage>=.98),JSON.stringify(report.deepZoom.filter(z=>z.coverage<.98)));
  report.checks.push('53 quarter-level zooms 15..28: no elevation holes');
  report.restore=await page.evaluate(async()=>{
   const g=ClearSkiesPortalBridge.gpuTerrain(),gl=g._canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_lose_context');
   if(!ext)return {unsupported:true};ext.loseContext();await new Promise(r=>setTimeout(r,50));const start=performance.now();ext.restoreContext();
   while(!g.getEngine().stats().ready&&performance.now()-start<1500)await new Promise(r=>setTimeout(r,10));
   g.redraw();await new Promise(r=>requestAnimationFrame(r));await new Promise(r=>requestAnimationFrame(r));
   return {milliseconds:performance.now()-start,ready:g.getEngine().stats().ready,stats:g.getEngine().stats(),coverage:(await g.getEngine().readProvenance(g._view)).coverage};
  });
  assert(!report.restore.unsupported);assert(report.restore.ready&&report.restore.milliseconds<1000);assert(report.restore.coverage>=.98);
  report.checks.push('production context-loss restore <1s');assert.deepEqual(errors,[]);report.errors=errors;report.status='pass';await context.close();
 }finally{fs.mkdirSync('output/playwright/gpu2d-app',{recursive:true});fs.writeFileSync(`output/playwright/gpu2d-app/${which}.json`,JSON.stringify(report,null,2));await browser.close();}
 console.log(JSON.stringify({browser:which,status:report.status,checks:report.checks,restoreMs:report.restore?.milliseconds},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
