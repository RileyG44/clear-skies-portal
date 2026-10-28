'use strict';
/* Full app, production shaders/store, deterministic source PNGs. The repository
 * GPU browser workflow also checks older-engine compatibility and session restore.
 * B=webkit|chrome CSP_GPU2D_URL=http://127.0.0.1:8812 node <this file> */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const which=process.env.B||'webkit',root=path.resolve(__dirname,'../..');
const pw=require('../lib/playwright.js');
const {prepare}=require('../gpu2d/layer-browser');
const out=path.join(root,'output/performance-audit/prewarm');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=which==='webkit'?await pw.webkit.launch():await pw.chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']});
 const rows=[];
 try{
  for(const [name,viewport,features] of [['phone',{width:430,height:932},['overview-elevation']],['small-phone',{width:320,height:568},[]],['desktop',{width:1100,height:760},['overview-elevation']]]){
   const {context,page,errors}=await prepare(browser,{mocked:'real',startup:true,viewport,features,dpr:name==='desktop'?1:3});
   try{
    await page.waitForFunction(()=>document.documentElement.dataset.gpu2d==='on');
    const state=()=>page.evaluate(()=>{const m=ClearSkiesPortalBridge.map,b=m.getBounds();return {center:[m.getCenter().lat,m.getCenter().lng],zoom:m.getZoom(),floor:m.getMinZoom(),width:m.getSize().x,span:b.getEast()-b.getWest(),south:b.getSouth(),north:b.getNorth()};});
    const isNorthAmerica=s=>s.zoom===3&&Math.abs(s.center[0]-45)<.1&&Math.abs(s.center[1]+100)<.1;
    const startup=await state();assert(isNorthAmerica(startup),JSON.stringify(startup));
    await page.screenshot({path:path.join(out,`${which}-${name}-north-america.png`),scale:'css'});
    const urls=[];page.on('request',r=>{if(/terrarium|\/api\/elev\/overview/.test(r.url()))urls.push(r.url());});
    await page.evaluate(()=>{const m=ClearSkiesPortalBridge.map;m.setView([0,-100],-10,{animate:false});const el=document.getElementById('terStyle');el.value='rem';el.dispatchEvent(new Event('change',{bubbles:true}));});
    const waitTerrain=()=>page.waitForFunction(()=>{const g=ClearSkiesPortalBridge.gpuTerrain();return g?.getStore().stats().pending===0&&g.getEngine().stats().queuedUploads===0;});
    await page.waitForTimeout(600);await page.waitForLoadState('networkidle');await waitTerrain();
    assert(urls.length>0,'terrain must load its overview');
    assert(urls.every(u=>features.length?u.includes('/api/elev/overview/'):u.includes('amazonaws.com/elevation-tiles-prod/terrarium/')),'overview source must match engine capability');
    const before=urls.length;
    const styles=await page.evaluate(async()=>{const rows=[],g=ClearSkiesPortalBridge.gpuTerrain();
      for(const style of ['hs','hsmulti','rem','tint','slope','aspect','northness','c2','c5','c10','c25']){
        const el=document.getElementById('terStyle');el.value=style;el.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        const p=await g.getEngine().readProvenance(g._view);rows.push({style,coverage:p.coverage,error:g.getEngine().stats().error});
      }return rows;});
    assert(styles.every(r=>r.coverage>=.99&&!r.error),JSON.stringify(styles));assert.equal(urls.length,before,'changing terrain style must reuse the warmed elevation');
    // Inspect raw world pixels at all four viewport corners. Re-projecting
    // lat/lng would clamp at the poles and conceal an overscroll bug.
    const limits=await page.evaluate(()=>{
      const m=ClearSkiesPortalBridge.map,rows=[];
      const sample=phase=>{const s=m.getSize(),world=m.options.crs.scale(m.getZoom()),ys=[[0,0],[s.x,0],[0,s.y],[s.x,s.y]].map(p=>m.containerPointToLayerPoint(L.point(p)).add(m.getPixelOrigin()).y);
        rows.push({phase,zoom:m.getZoom(),floor:m.getMinZoom(),ys,world});};
      for(const bearing of [0,37,90,180]){
        m.setBearing(bearing);m.setView([85,120],-10,{animate:false});sample(`north-${bearing}`);
        m._rawPanBy(L.point(2000,5000));m.fire('move');sample(`drag-${bearing}`);
        m.panBy([0,-50000],{animate:false});sample(`pan-${bearing}`);
        m.setView([-85,120],m.getMinZoom()+1,{animate:false});sample(`south-${bearing}`);
        m._move(L.latLng(-85,120),-10,{pinch:true});m._animateZoom(L.latLng(-85,120),-10);sample(`pinch-${bearing}`);
      }return rows;
    });
    assert(limits.every(r=>r.zoom>=r.floor-1e-9&&Math.min(...r.ys)>=-1e-6&&Math.max(...r.ys)<=r.world+1e-6),JSON.stringify(limits));
    await page.setViewportSize({width:viewport.height,height:viewport.width});
    await page.waitForTimeout(250);
    const resized=await page.evaluate(()=>{const m=ClearSkiesPortalBridge.map,s=m.getSize(),a=m.getBearing()*Math.PI/180;return {zoom:m.getZoom(),floor:m.getMinZoom(),needed:Math.max(s.x*Math.abs(Math.cos(a))+s.y*Math.abs(Math.sin(a)),s.y*Math.abs(Math.cos(a))+s.x*Math.abs(Math.sin(a)))+4,world:m.options.crs.scale(m.getZoom())};});
    assert(resized.zoom>=resized.floor&&resized.world>=resized.needed-1e-6,JSON.stringify(resized));
    await page.waitForLoadState('networkidle');
    await page.evaluate(()=>ClearSkiesPortalBridge.restoreSession({center:[47.858,-118.33],zoom:16,bearing:37,mode:'2d'}));
    const resumed=await state();assert(Math.abs(resumed.center[0]-47.858)<1e-6&&resumed.zoom===16,'recovery must restore the same session');
    await page.waitForTimeout(600);await page.waitForLoadState('networkidle');await waitTerrain();
    await page.setViewportSize(viewport);await page.waitForTimeout(350);await page.waitForLoadState('networkidle');await waitTerrain();await page.reload();await page.waitForFunction(()=>!!window.ClearSkiesPortalBridge);
    const fresh=await state();assert(isNorthAmerica(fresh),'a new session must start over North America again');assert.deepEqual(errors,[]);
    rows.push({name,startup,resumed,fresh,styles,limits,resized,overviewRequests:before,cache:!!features.length,errors});
   }finally{await context.close();}
  }
  fs.writeFileSync(path.join(out,`${which}-startup.json`),JSON.stringify({browser:which,rows},null,2)+'\n');
  console.log(JSON.stringify({browser:which,viewports:rows.length,styles:rows.reduce((n,r)=>n+r.styles.length,0),cameraLimits:rows.reduce((n,r)=>n+r.limits.length,0),errors:rows.flatMap(r=>r.errors)}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
