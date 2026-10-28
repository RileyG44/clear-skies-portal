'use strict';
// Real-GPU regression: slow overview, transient fine failures, stop-and-recover.
// Uses an isolated app server and the app's actual shared request pool.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const H=require('../gpu3d/harness3d-lib.js');
const argv=process.argv.slice(2),option=(k,d)=>argv.includes(k)?argv[argv.indexOf(k)+1]:d;
const browserName=option('--browser','chrome'),url=option('--url','http://127.0.0.1:8826/');
const output=option('--out','/tmp/csp-refinement-fix/browser-'+browserName+'.json'),baseline=argv.includes('--baseline'),phone=argv.includes('--phone');
if(new URL(url).port==='8765')throw Error('Use an isolated server, not the live service');
const result={browser:browserName,url,baseline,phoneEmulation:phone,startedAt:new Date().toISOString(),errors:[]};
const baselineText=file=>cp.execFileSync('git',['show','79722f9:'+file],{cwd:H.REPO,encoding:'utf8'});
async function capture(page,label){
 const data=await page.evaluate(()=>new Promise(resolve=>{
  const l=ClearSkiesPortalBridge.gpuTerrain();l.once('render',()=>resolve(l._canvas.toDataURL()));
  l.getEngine().setState(l._state);l.redraw();
 }));
 const file=path.join(path.dirname(output),`${path.basename(output,'.json')}-${label}.png`);
 fs.writeFileSync(file,Buffer.from(data.split(',')[1],'base64'));return file;
}
(async()=>{
 const browser=await H.launch(browserName),{context,page}=await H.newPage(browser,phone?'phone':'desktop');
 try{
  page.on('pageerror',e=>result.errors.push(e.message));
  await context.addInitScript(()=>localStorage.setItem('clearskies.reduceMotion.v1','1'));
  const png=H.fixturePng();
  await context.route(/\/api\/health$/,r=>r.fulfill({json:{ok:true,features:[]}}));
  await context.route(/\/api\/elev\//,r=>r.fulfill({contentType:'image/png',body:png}));
  await context.route(/https:\/\/(?:[^/]*arcgisonline\.com|[^/]*cartocdn\.com|[^/]*tile\.openstreetmap\.org|s3\.amazonaws\.com)\//,
   r=>r.fulfill({contentType:'image/png',body:png}));
  const origin=new URL(url).origin;
  await context.route(origin+'/**',async route=>{
   const name=new URL(route.request().url()).pathname;
   if(baseline&&name==='/gpu-terrain-store.js')return route.fulfill({contentType:'application/javascript',body:baselineText('gpu-terrain-store.js')});
   if(name!=='/app.js')return route.fallback();
   const response=await route.fetch();let html=await response.text();
   const re=/const elevationRequests=new CSPTilePipeline\.RequestPool\([^\n]*\);/;
   if(baseline)html=html.replace(re,baselineText('index.html').match(re)[0]);
   html=html.replace(re,'$&window.__refinementPool=elevationRequests;');
   await route.fulfill({response,body:html});
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.ClearSkiesPortalBridge?.gpuTerrain()?.getEngine());
  await page.evaluate(()=>{
   const b=ClearSkiesPortalBridge;b.map.setView([47.858,-118.33],14,{animate:false});
   for(const [id,value] of [['terSrc','3dep'],['terStyle','slope']]){const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  await page.evaluate(()=>{
   const b=ClearSkiesPortalBridge,l=b.gpuTerrain(),s=l.getStore(),pool=window.__refinementPool;
   s.clear();s.retryDelayMs=350;
   const probe=window.__refinement={calls:[],attempts:{},completed:[],held:null,release:null,aborts:0};
   const specs=[{id:'native',rank:2,label:'Native fixture',dz:1,nativeZoom:18,sharper:true,group:'national',url:(z,x,y)=>`native/${z}/${x}/${y}`},
    {id:'overview',rank:1,label:'Overview fixture',dz:1,nativeZoom:12,sharper:false,group:'overview',url:(z,x,y)=>`overview/${z}/${x}/${y}`}];
   s.options.sources=()=>specs;
   s.options.request=(key,opts)=>pool.request('fixture:'+key,signal=>new Promise((resolve,reject)=>{
    const [id,zs,xs,ys]=key.split('/'),z=+zs,x=+xs,y=+ys,n=256;
    const attempt=probe.attempts[key]=(probe.attempts[key]||0)+1;probe.calls.push({key,attempt,group:opts.group});
    let timer;const abort=()=>{clearTimeout(timer);probe.aborts++;reject(new DOMException('cancelled','AbortError'));};
    if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});
    const finish=()=>{
     signal.removeEventListener('abort',abort);
     if(id==='native'&&z===15&&(x+y)%2===0&&attempt===1)return reject(Error('one transient detail failure'));
     const grid=new Float32Array(n*n);
     for(let j=0;j<n;j++)for(let i=0;i<n;i++)grid[j*n+i]=1200+i*.12+j*.08+(id==='native'&&z>=15?8*Math.sin(i*.35)*Math.cos(j*.29):0);
     probe.completed.push(key);resolve({width:n,height:n,grid});
    };
    if(id==='native'&&z===14&&!probe.held){probe.held=key;probe.release=finish;}
    else timer=setTimeout(finish,5);
   }),opts);
   l.getEngine().invalidate();l.redraw();
  });
  await page.waitForFunction(()=>__refinement.held&&__refinement.completed.length>2);
  await page.waitForTimeout(200);
  result.whilePrimaryHeld=await page.evaluate(()=>({fine:__refinement.completed.filter(k=>k.startsWith('native/15/')).length,
   held:__refinement.held,heldCompleted:__refinement.completed.includes(__refinement.held),frames:ClearSkiesPortalBridge.gpuTerrain().getEngine().stats().frames}));
  result.coarseImage=await capture(page,'recovering');
  await page.evaluate(()=>__refinement.release());
  try{
   await page.waitForFunction(()=>{
    const s=ClearSkiesPortalBridge.gpuTerrain().getStore();
    return s._displays.length>0&&s._displays.every(d=>s.finestFor('native',d)?.z===d.z)&&s._pending.size===0;
   },null,{timeout:baseline?2000:15000});result.allNative=true;
  }catch{result.allNative=false;}
  result.after=await page.evaluate(()=>{
   const l=ClearSkiesPortalBridge.gpuTerrain(),s=l.getStore(),gl=l.getEngine().gl;
   return {native:s._displays.filter(d=>s.finestFor('native',d)?.z===d.z).length,total:s._displays.length,
    recovered:Object.values(__refinement.attempts).filter(n=>n>1).length,stats:l.getEngine().stats(),settled:s.settled(),
    center:ClearSkiesPortalBridge.map.getCenter(),zoom:ClearSkiesPortalBridge.map.getZoom(),
    renderer:gl?'exposed':'see-context-probe'};
  });
  result.nativeImage=await capture(page,'native');
  result.diff=H.lib2d.diffRgba(H.lib2d.decodePng(fs.readFileSync(result.coarseImage)),H.lib2d.decodePng(fs.readFileSync(result.nativeImage)));
  result.hardware=await page.evaluate(()=>{
   const c=ClearSkiesPortalBridge.gpuTerrain()._canvas,g=c.getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');
   return String(g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER));
  });
  result.pass=baseline?result.whilePrimaryHeld.fine===0&&!result.allNative:
   result.whilePrimaryHeld.fine>0&&!result.whilePrimaryHeld.heldCompleted&&result.allNative&&result.after.recovered>0&&result.diff.mean>0;
  result.pass=result.pass&&!result.errors.length&&!/swiftshader|software|llvmpipe/i.test(result.hardware);
 }catch(e){result.error=String(e.stack||e);result.pass=false;}
 finally{await browser.close();result.finishedAt=new Date().toISOString();fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));}
 console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
