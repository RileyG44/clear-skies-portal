'use strict';
const fs=require('fs'),path=require('path');
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
 report.build=await page.evaluate(()=>CSP_BUILD);report.sourceHashes=Object.fromEntries(['index.html','gpu-terrain-engine.js','gpu-terrain-layer.js','gpu-terrain-store.js'].map(p=>[p,require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
 report.checks.sourceReplacement=await page.evaluate(async()=>{const g=ClearSkiesPortalBridge.gpuTerrain(),s=g.getStore(),req=s.options.request,before={coverage:g._coverage?.coverage,tiles:s.stats().tiles};s.options.request=(...a)=>new Promise(r=>setTimeout(r,1500)).then(()=>req(...a));const el=document.getElementById('terSrc');el.value='auto';el.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,250));const during={coverage:g._coverage?.coverage,tiles:s.stats().tiles};await new Promise(r=>setTimeout(r,2400));s.options.request=req;return {before,during,after:{coverage:g._coverage?.coverage,tiles:s.stats().tiles},fixture:'1500ms request-adapter delay on source replacement'};});
 report.checks.duplicateRenders=await page.evaluate(async()=>{
  const B=ClearSkiesPortalBridge,m=B.map,g=B.gpuTerrain(),e=g.getEngine(),original=e.render,rows=[];let count=0;
  e.render=function(v){count++;return original.call(this,v);};
  try{for(let i=0;i<24;i++){await new Promise(requestAnimationFrame);const before=count;m.setBearing(i*1.5);m._move(L.latLng(47.858+i*.00001,-118.33),15+i*.005,{pinch:true});rows.push(count-before);}m._animateZoom(m.getCenter(),15.12);}
  finally{e.render=original;}return {perInput:rows,total:rows.reduce((a,b)=>a+b,0)};
 });
 // Use the application's actual GridLayer invalidation/hold patches and a
 // deterministic slow photographic provider. This is an isolated test tab.
 let delay=false;const pixels=Buffer.alloc(256*256*4);for(let i=0;i<pixels.length;i+=4)pixels.set([200,40,150,255],i);const png=encodePNG(pixels,256,256);
 await page.route('**/audit-tiles/**',async r=>{if(delay)await new Promise(r=>setTimeout(r,4000));await r.fulfill({contentType:'image/png',body:png}).catch(()=>{});});
 await page.addStyleTag({content:'#side,#mapDock,#sideToggleDock,.leaflet-control-container{display:none!important}'});
 await page.evaluate(()=>{const m=ClearSkiesPortalBridge.map;for(const l of Object.values(m._layers))m.removeLayer(l);m.setBearing(0);m.setView([47.858,-118.33],9,{animate:false});window.__auditImage=L.tileLayer('/audit-tiles/{z}/{x}/{y}.png',{maxZoom:28,updateWhenZooming:false}).addTo(m);});
 await page.waitForFunction(()=>Object.values(__auditImage._tiles).every(t=>t.loaded));await page.waitForTimeout(300);
 const shots=[];
 const shot=async name=>{const p=path.join(out,`${B}-${name}.png`),buf=await page.screenshot({path:p,clip:{x:110,y:200,width:200,height:250}});const im=decodePng(buf);let magenta=0;for(let i=0;i<im.data.length;i+=4)if(im.data[i]-im.data[i+1]>15&&im.data[i+2]-im.data[i+1]>8)magenta++;
  const state=await page.evaluate(()=>({elapsedMs:performance.now()-window.__auditZoomStart,holds:__auditImage._cspHolds?.length||0,loaded:Object.values(__auditImage._tiles).filter(t=>t.loaded).length,total:Object.keys(__auditImage._tiles).length,opacity:__auditImage.options.opacity,tileOpacity:Object.values(__auditImage._tiles).slice(0,1).map(t=>({inline:t.el.style.opacity,computed:getComputedStyle(t.el).opacity,loaded:t.loaded}))}));shots.push({name,coverage:magenta/(im.width*im.height),...state});};
 await shot('loaded');delay=true;await page.evaluate(()=>{window.__auditZoomStart=performance.now();ClearSkiesPortalBridge.map.setZoom(10,{animate:false});});
 await page.waitForTimeout(350);await shot('hold-350ms');await page.waitForTimeout(2400);await shot('hold-2750ms');await page.waitForTimeout(1600);await shot('replacement-4350ms');
 await page.waitForTimeout(1000);await shot('replacement-5350ms');report.checks.slowReplacement=shots;report.errors=errors;await context.close();
 }catch(error){report.failure=String(error.stack||error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,`browser-${B}.json`),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify(report,null,2));
})();
