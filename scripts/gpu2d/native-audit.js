#!/usr/bin/env node
'use strict';
/* Native-adapter regression workflow (CR-001): real bundled web code with a
 * mocked native message transport. Native UIKit is verified on the device.
 * Run node scripts/gpu2d/native-audit.js --site=/assembled/site --browser=both
 * Add --network=fixture to test adapter behavior without live provider outages.
 */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const site=arg('site');if(!site)throw Error('--site must name the assembled app site');
const fixtureNetwork=arg('network')==='fixture';
const fixturePixels=Buffer.alloc(256*256*4);
for(let i=0;i<fixturePixels.length;i+=4)fixturePixels.set([129,96,0,255],i);
const fixturePNG=require(path.join(root,'usgs')).encodePNG(fixturePixels,256,256);
const shell=fs.readFileSync(path.join(root,'ios/Resources/native-shell.js'),'utf8');
const template=fs.readFileSync(path.join(root,'ios/Resources/native-host.js'),'utf8');
const chrome=require('/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const wk=require('/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const types={html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',wasm:'application/wasm',woff2:'font/woff2',svg:'image/svg+xml',png:'image/png'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){res.writeHead(503,{'content-type':'application/json'});return res.end('{"ok":false,"error":"No engine"}')}
 const file=path.resolve(site,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
 if(!file.startsWith(path.resolve(site)+path.sep)){res.writeHead(404);return res.end()}
 fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'content-type':types[path.extname(file).slice(1)]||'application/octet-stream'});res.end(e?'Not found':data)});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const results={};
 try{
  for(const name of (arg('browser')||'both')==='both'?['chrome','webkit']:[arg('browser')]){
   const browser=await (name==='chrome'?chrome.chromium.launch({channel:'chrome',args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']}):wk.webkit.launch());
   const contexts=[];
   async function open(resume=null,storageState,offline=false){
    const ctx=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:3,isMobile:true,hasTouch:true,storageState});contexts.push(ctx);
    const host=template.replaceAll('__CSP_NATIVE_CONFIG__',JSON.stringify({engineBase:'',appVersion:'audit-regression',resume}));
    await ctx.addInitScript(`window.__messages=[];Object.defineProperty(window,'webkit',{value:{messageHandlers:{cspNative:{postMessage(m){if(m.type==='shell')window.__messages.push(JSON.parse(m.json));if(m.type==='ready')window.__nativeReady=true;return Promise.resolve(true)}}}},configurable:true});`);
    await ctx.addInitScript(`(()=>{const run=()=>{(0,eval)(${JSON.stringify(host)})};if(document.documentElement)run();else new MutationObserver((r,o)=>{if(document.documentElement){o.disconnect();run()}}).observe(document,{childList:true})})()`);
    await ctx.addInitScript(`document.addEventListener('readystatechange',function f(){if(document.readyState==='interactive'){document.removeEventListener('readystatechange',f);(0,eval)(${JSON.stringify(shell)})}})`);
    if(offline)await ctx.route(u=>!u.href.startsWith(url),r=>r.abort('internetdisconnected'));
    else if(fixtureNetwork)await ctx.route(u=>!u.href.startsWith(url),r=>{
     if(/\.(png|jpg)|tile|exportImage|MapServer/.test(r.request().url()))return r.fulfill({contentType:'image/png',body:fixturePNG});
     return r.abort();
    });
    const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url,{waitUntil:'load'});try{await page.waitForFunction(()=>window.__nativeReady)}catch(error){console.error(await page.evaluate(()=>({host:!!window.CSPNativeHost,shell:!!window.CSPNativeShell,portal:!!window.ClearSkiesPortalBridge,classes:document.documentElement.className,messages:window.__messages,body:document.body.innerText.slice(0,200)})),errors);throw error}return {page,ctx,errors};
   }
   try{
    const {page,ctx,errors}=await open();await page.waitForTimeout(1800);
    const colors=await page.evaluate(async()=>{
     const S=CSPNativeShell,ids=['elevLowColor','elevMidColor','elevHighColor','elevBelowColor','elevAboveColor'];
     ids.forEach(id=>S.act('#'+id,'commit','#123456'));return ids;
    });
    await page.reload();await page.waitForFunction(()=>window.__nativeReady);
    assert.deepEqual(await page.evaluate(ids=>ids.map(id=>document.getElementById(id).value),colors),colors.map(()=>'#123456'));
    const traffic=await page.evaluate(async()=>{
     const S=CSPNativeShell;S.act('#terStyle','select','hs');S.open('terrain');S.setView({sheet:'large',page:'terrain',panel:null});
     await new Promise(r=>setTimeout(r,2000));
     const initial=__messages.flatMap(m=>Object.values(m.images||{}));
     const from=__messages.length;const input=document.querySelector('#terBrightness');
     for(let i=0;i<60;i++){S.act('#terBrightness','input',80+i%40);await new Promise(r=>setTimeout(r,16))}S.act('#terBrightness','commit',100);
     await new Promise(r=>setTimeout(r,300));
     const updates=__messages.slice(from);return {initialImages:initial.length,bytes:updates.reduce((n,m)=>n+JSON.stringify(m).length,0),updates:updates.length,
      embedded:updates.some(m=>m.page&&JSON.stringify(m.page).includes('data:image/png')),assetPackets:updates.filter(m=>m.images).length};
    });
    assert(traffic.initialImages>=11,'Look previews were not published');assert(!traffic.embedded,'PNG data still embedded in routine page descriptions');
    const race=await page.evaluate(async()=>{
     const B=ClearSkiesPortalBridge;let chosen=0;B.placeSuggestions=async text=>[{primary:text,lat:47,lng:-119}];B.searchPlace=()=>chosen++;
     const old=await CSPNativeShell.suggest('old'),now=await CSPNativeShell.suggest('new');
     const stale=CSPNativeShell.pick(old[0].index,old[0].version),fresh=CSPNativeShell.pick(now[0].index,now[0].version);
     return {stale,fresh,chosen};
    });assert.deepEqual(race,{stale:false,fresh:true,chosen:1});
    await page.evaluate(()=>CSPNativeShell.open('analyze'));await page.waitForTimeout(800);
    const curvature=await page.evaluate(()=>{document.querySelector('#researchLayers .ls-add-button').click();return JSON.stringify(CSPNativeShell.describe())});
    assert(curvature.includes('Surface curvature (Laplacian)')&&!curvature.includes('Profile / plan curvature'));
    const session=await page.evaluate(async()=>{
     const state={center:[47.35,-119.1],zoom:12.75,bearing:37,pitch:32,mode:'3d',location:{lat:47.351,lng:-119.101,label:'Recovery fixture'}};
     await ClearSkiesPortalBridge.restoreSession(state);return ClearSkiesPortalBridge.sessionState();
    });
    const recovered=await open(session,await ctx.storageState());
    const actual=await recovered.page.evaluate(()=>ClearSkiesPortalBridge.sessionState());
    assert.equal(actual.mode,'3d');assert.equal(actual.location.label,session.location.label);
    assert(actual.center.every((n,i)=>Math.abs(n-session.center[i])<1e-5));assert(Math.abs(actual.zoom-session.zoom)<1e-5);
    const offline=await open(null,undefined,true);await offline.page.evaluate(()=>CSPNativeShell.act('#terStyle','select','hs'));
    await offline.page.waitForFunction(()=>['partial','offline'].includes(document.querySelector('#terrainLoadStatus')?.dataset.state),null,{timeout:20000});
    const outage=await offline.page.evaluate(()=>({state:document.querySelector('#terrainLoadStatus').dataset.state,message:document.querySelector('#blk')?.textContent||''}));
    assert(!outage.message.includes('index.html')&&!outage.message.includes('Chrome'));
    assert.deepEqual(errors,[]);assert.deepEqual(recovered.errors,[]);assert.deepEqual(offline.errors,[]);
    results[name]={passed:true,network:fixtureNetwork?'fixture':'live',colorPersistence:true,traffic,suggestionRace:race,recovery:true,curvature:true,outage};
   }finally{await Promise.all(contexts.map(c=>c.close()));await browser.close()}
  }
 }finally{await new Promise(resolve=>server.close(resolve))}
 console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
