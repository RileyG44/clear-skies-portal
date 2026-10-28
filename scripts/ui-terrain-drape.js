"use strict";
/* Regression for the reviewed default 1280x800 slope view. Synthetic
   Terrarium responses make request counts independent of provider availability.
   Run a server from this worktree, then:
     PLAYWRIGHT_MODULE=/path/to/playwright node scripts/ui-terrain-drape.js http://127.0.0.1:8765/
   Playwright is optional, as in the other scripts/ui-*.js workflows. */
const assert=require('assert/strict'),fs=require('fs');
const {launchUIBrowser}=require('./lib/browser.js');
const path=require('path');const root=path.join(__dirname,'..');const {encodePNG}=require(path.join(root,'usgs.js'));
const terrarium=(h,amp)=>{const b=Buffer.alloc(256*256*4);for(let j=0;j<256;j++)for(let i=0;i<256;i++){const v=Math.round((h+amp*Math.sin(i/9)+amp*Math.cos(j/7)+32768)*256),o=(j*256+i)*4;b[o]=v>>16;b[o+1]=(v>>8)&255;b[o+2]=v&255;b[o+3]=255;}return encodePNG(b,256,256);};
const png=terrarium(1200,40);
(async()=>{
  const browser=await launchUIBrowser({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  try{
  const page=await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'});
  const errors=[];page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(/3D terrain failed|drape.*failed/i.test(m.text()))errors.push(m.type()+': '+m.text().slice(0,200))});
  await page.addInitScript(()=>{const W=window.Worker;window.__workers=[];window.Worker=function(url,opts){const w=new W(url,opts);window.__workers.push(String(url));return w};window.Worker.prototype=W.prototype;});
  let drapeElev=0,national=0;
  await page.route('**/api/health',async route=>{const res=await route.fetch();const json=await res.json();json.features=(json.features||[]).filter(f=>f!=='wadnr-elevation');await route.fulfill({response:res,json});});
  await page.route(/\/api\/elev\/national\//,route=>{national++;route.fulfill({status:200,contentType:'image/png',body:png})});
  await page.route(/\/api\/elev\/\d+\//,route=>{drapeElev++;route.fulfill({status:200,contentType:'image/png',body:png})});
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**',route=>route.fulfill({status:200,contentType:'image/png',body:png,headers:{'access-control-allow-origin':'*'}}));
  await page.route(/https:\/\/(?:[^/]*arcgisonline\.com|[^/]*cartocdn\.com|[^/]*tile\.openstreetmap\.org)\//,route=>route.fulfill({status:200,contentType:'image/png',body:png,headers:{'access-control-allow-origin':'*'}}));
  await page.route(u=>new URL(u).pathname==='/app.js',async route=>{const res=await route.fetch();let html=await res.text();
    const hook='window.CSPMarkup?.attach3d(module,map3d);';assert(html.includes(hook),'3D test hook');
    html=html.replace(hook,hook+'window.__map3d=map3d;');
    const renderHook='async function renderDrapeTile(style,z,x,y,signal){';assert(html.includes(renderHook),'drape test hook');
    html=html.replace(renderHook,renderHook+'window.__drapeRenders=(window.__drapeRenders||0)+1;');
    await route.fulfill({response:res,body:html,headers:{...res.headers(),'content-length':String(Buffer.byteLength(html))}});});
  await page.goto(process.argv[2]||'http://127.0.0.1:8765/',{waitUntil:'load'});await page.waitForTimeout(3000);
  await page.evaluate(()=>{const s=document.getElementById('terStyle');s.value='slope';s.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForTimeout(1000);
  await page.evaluate(()=>document.getElementById('terMode3d').click());
  await page.waitForFunction(()=>window.__map3d&&window.__map3d.isStyleLoaded(),null,{timeout:30000});
  const waitLoaded=()=>page.waitForFunction(()=>{
    const m=window.__map3d;if(!m?.isStyleLoaded())return false;
    const t=m.style.tileManagers.analysis;
    return t&&t.getIds().length>=42&&t.getIds().every(k=>t.getTileByID(k).state==='loaded');
  },null,{timeout:30000});
  const state=async label=>{
    const result=await page.evaluate(()=>{
      const tm=window.__map3d.style.tileManagers,tiles={};
      for(const id in tm)tiles[id]=tm[id].getIds().map(k=>tm[id].getTileByID(k).state).reduce((a,s)=>(a[s]=(a[s]||0)+1,a),{});
      return {tiles,renders:window.__drapeRenders,workers:window.__workers.slice()};
    });
    console.log(label,JSON.stringify({...result,drapeElev,national}));return result;
  };
  try{await waitLoaded()}catch(e){await state('timed out');console.error(errors);throw e}
  await page.waitForTimeout(1500);const loaded=await state('loaded');
  assert(loaded.tiles.analysis?.loaded>=42,'default desktop view exercises at least 42 drapes');
  const before=drapeElev;
  await page.evaluate(()=>{const s=document.getElementById('terSunAz');s.value='120';s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForTimeout(500);await waitLoaded();await page.waitForTimeout(1500);
  const relit=await state('after light change');
  assert(relit.renders-loaded.renders>=42,'light change actually redraws visible drapes');
  console.log('elevation requests caused by light change:',drapeElev-before);
  assert.equal(drapeElev-before,0,'light change must not request elevation');
  // A palette change rebuilds analytical textures while keeping source floats.
  await page.evaluate(()=>{const s=document.getElementById('terStyle');s.value='aspect';s.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForTimeout(500);await waitLoaded();await page.waitForTimeout(1500);
  const recoloured=await state('after palette change');
  assert(recoloured.renders-relit.renders>=42,'palette change actually redraws visible drapes');
  assert.equal(drapeElev-before,0,'palette change must not request elevation');
  fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});
  await page.screenshot({path:path.join(root,'output/playwright/terrain-drape.png')});
  assert.deepEqual(errors,[],'no drape or page errors');
  console.log('terrain drape browser regression passed');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
