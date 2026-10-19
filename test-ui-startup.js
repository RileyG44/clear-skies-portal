'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8'),ui=fs.readFileSync('ui-system.js','utf8');
const bootSource=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('window.CSPBoot'));
assert(bootSource,'the startup recovery controller must ship inline');
function fixture({loaded=true,cache}={}){
  const rootEvents={},docEvents={},winEvents={},timers=new Map(),classes=new Set();
  const nodes=Object.fromEntries(['cspStartup','cspStartupMessage','cspStartupRetry'].map(id=>[id,{hidden:false,textContent:''}]));
  let reloads=0,timerId=0,destination;
  const root={classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},style:{setProperty(){}},addEventListener:(n,f)=>rootEvents[n]=f};
  const context={window:{addEventListener:(n,f)=>winEvents[n]=f},document:{documentElement:root,getElementById:id=>nodes[id],addEventListener:(n,f)=>docEvents[n]=f},
    URL,Promise,Date,caches:cache,localStorage:{getItem:()=>null},location:{href:'https://portal.test/clear-skies-portal/#view',replace:url=>{reloads++;destination=url}},setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(bootSource,context);
  context.window.caches=cache;
  if(loaded)docEvents.DOMContentLoaded();
  return {context,rootEvents,winEvents,timers,classes,nodes,docEvents,reloads:()=>reloads,destination:()=>destination};
}
{
  const f=fixture();assert(f.classes.has('csp-boot'));
  f.timers.get(1).fn();
  assert(f.classes.has('csp-boot'),'a slow load must not reveal incomplete or legacy controls');
  assert.match(f.nodes.cspStartupMessage.textContent,/longer/);
  f.rootEvents['csp:ready']();
  assert(!f.classes.has('csp-boot'));assert(f.nodes.cspStartup.hidden);
  assert.equal(f.timers.size,0);
  f.context.window.CSPBoot.fail('late rendering failure');
  assert(f.nodes.cspStartup.hidden,'an optional renderer failure must not cover a working shell');
}
{
  const f=fixture();f.winEvents.error({target:{tagName:'SCRIPT'}});
  assert.match(f.nodes.cspStartupMessage.textContent,/required app file/);
  assert(f.classes.has('csp-boot'));
  f.rootEvents['csp:ready']();assert(f.nodes.cspStartup.hidden,'a recovered slow script can finish normally');
}
{
  let failures=0,ready=0;
  const context={window:{CSPBoot:{fail:()=>failures++}},document:{querySelector:()=>null,documentElement:{dispatchEvent:()=>ready++}},matchMedia:()=>({matches:true})};
  vm.runInNewContext(ui.slice(0,ui.indexOf('document.body.classList.add'))+'})();',context);
  assert.equal(failures,1);assert.equal(ready,0,'missing engine bridge must not report a working shell');
}
// A device-specific GPU exception runs after shell readiness, falls back to CPU,
// and cannot prevent navigation from starting.
{
  const begin=html.indexOf('document.documentElement.addEventListener("csp:ready",()=>requestAnimationFrame(');
  const end=html.indexOf('if("serviceWorker" in navigator',begin);
  assert(begin>=0&&end>begin);
  let readyHook,frame,rendered=0,cleaned=0;
  const context={document:{documentElement:{dataset:{},addEventListener:(name,fn)=>readyHook=fn}},
    requestAnimationFrame:fn=>frame=fn,initGpuTerrain:()=>{throw Error("GPU unsupported")},
    gpuTerrainEnabled:true,gpuTerrainLayer:{destroy:()=>cleaned++},gpuTerrainStore:{destroy:()=>cleaned++},
    lidarStudio:{refresh(){}},console:{warn(){}},$:()=>({value:"hs"}),applyTerrain:()=>rendered++,
    elevationActive:()=>false,syncElevationChecks(){}};
  vm.runInNewContext(html.slice(begin,end),context);
  assert.equal(rendered,0);readyHook();assert.equal(rendered,0);
  frame();assert.equal(cleaned,2);assert.equal(rendered,1);
  assert.equal(context.gpuTerrainEnabled,false);assert.equal(context.document.documentElement.dataset.gpu2d,"off");
}
async function retryBeforeLoad(){
  // A stalled parser-blocking script prevents DOMContentLoaded indefinitely.
  // Retry must already be wired, and must never wait forever on CacheStorage.
  const f=fixture({loaded:false,cache:{keys:()=>new Promise(()=>{})}});
  let prevented=false;
  f.docEvents.click({target:{closest:selector=>selector==='#cspStartupRetry'},preventDefault:()=>prevented=true});
  assert(prevented);assert.match(f.nodes.cspStartupMessage.textContent,/Reloading/);
  [...f.timers.values()].find(t=>t.ms===1500).fn();
  assert.equal(f.reloads(),1);assert.match(f.destination(),/\?reload=\d+#view$/);
  const deleted=[];
  const g=fixture({loaded:false,cache:{keys:async()=>['clear-skies-shell-old','clear-skies-shell-current','terrain-tiles','saved-markup'],delete:async key=>{deleted.push(key);return true}}});
  g.docEvents.click({target:{closest:()=>true},preventDefault(){}});
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.deepEqual(deleted,['clear-skies-shell-old','clear-skies-shell-current']);
  assert.equal(g.reloads(),1,'retry navigates as soon as shell cleanup finishes');
  assert.match(html,/<a id="cspStartupRetry" href="\?reload=[^"]+">Reload portal<\/a>/,'retry has a native navigation fallback');
  assert(html.indexOf('window.CSPBoot')<html.indexOf('<link rel="stylesheet" href="ui-theme.css'),'the watchdog must execute before a stylesheet can stall parsing');
  const scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
  assert(scripts.length>25);assert(scripts.every(url=>/\?build=\d{4}-\d{2}-\d{2}[a-z]$/.test(url)),'every startup script must bypass older unversioned worker entries');
}
async function workerCache(){
  const events={},cached=new Set();let installed;
  const base='https://portal.test/';
  const context={URL,self:{location:{origin:new URL(base).origin},addEventListener:(n,f)=>events[n]=f,skipWaiting:()=>Promise.resolve()},
    caches:{open:async()=>({addAll:async list=>{for(const url of list)cached.add(new URL(url,base).href)}}),
      match:async req=>cached.has(typeof req==='string'?req:req.url)?{ok:true,fromCache:true}:null},fetch:async()=>{throw Error('offline')}};
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
  events.install({waitUntil:p=>installed=p});await installed;
  const urls=[...html.matchAll(/(?:src|href)="([^\"]+\?build=[^\"]+)"/g)].map(m=>m[1]);
  assert(urls.length>=6);
  for(const url of [...urls,"public-terrain-worker.js","terrain-core.js","vendor/maplibre-gl.css"]){
    const req={method:'GET',url:new URL(url,base).href,mode:'cors'};let response;
    events.fetch({request:req,respondWith:p=>response=p});
    const result=await response;
    assert(result?.fromCache,`${url} must load offline from its exact document URL`);
  }
}
Promise.all([retryBeforeLoad(),workerCache()]).then(()=>console.log('UI startup checks passed (static shell, pre-load retry, bounded cache recovery, missing bridge, exact offline asset URLs)')).catch(e=>{console.error(e);process.exitCode=1});
