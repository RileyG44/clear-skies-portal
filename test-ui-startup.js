'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=require("./test-fixtures/page-source.js"),ui=fs.readFileSync('ui-system.js','utf8');
const bootSource=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('window.CSPBoot'));
assert(bootSource,'the startup recovery controller must ship inline');
function fixture({loaded=true,cache}={}){
  const rootEvents={},docEvents={},winEvents={},timers=new Map(),classes=new Set();
  const nodes=Object.fromEntries(['cspStartup','cspStartupMessage','cspStartupRetry'].map(id=>[id,{hidden:false,textContent:'',classes:new Set(),classList:{toggle(c,on){if(on)this.owner.classes.add(c);else this.owner.classes.delete(c)}}}]));
  for(const node of Object.values(nodes))node.classList.owner=node;
  let reloads=0,timerId=0,destination;
  const root={classList:{add:(...c)=>c.forEach(x=>classes.add(x)),remove:c=>classes.delete(c),contains:c=>classes.has(c)},style:{setProperty(){}},addEventListener:(n,f)=>rootEvents[n]=f,dispatchEvent:e=>rootEvents[e.type]?.(e)};
  const context={window:{addEventListener:(n,f)=>winEvents[n]=f},document:{documentElement:root,getElementById:id=>nodes[id],addEventListener:(n,f)=>docEvents[n]=f},
    URL,Promise,Date,Event,caches:cache,localStorage:{getItem:()=>null},location:{href:'https://portal.test/clear-skies-portal/#view',replace:url=>{reloads++;destination=url}},setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(bootSource,context);
  context.window.caches=cache;
  if(loaded)docEvents.DOMContentLoaded();
  return {context,rootEvents,winEvents,timers,classes,nodes,docEvents,reloads:()=>reloads,destination:()=>destination};
}
{
  const f=fixture();assert(f.classes.has('csp-boot'));
  assert(!f.nodes.cspStartup.classes.has('failed'),'normal startup has no recovery controls');
  f.timers.get(1).fn();
  assert(f.classes.has('csp-boot'),'a slow load must not reveal incomplete or legacy controls');
  assert.match(f.nodes.cspStartupMessage.textContent,/longer/);
  assert(f.nodes.cspStartup.classes.has('failed'),'slow startup reveals recovery controls');
  f.rootEvents['csp:ready']();
  assert(!f.classes.has('csp-boot'));assert(f.nodes.cspStartup.hidden);
  assert(!f.timers.has(1),'ready clears the slow-start watchdog');
  assert(f.classes.has('csp-reveal'),'the map colour stays under the shell while it fades in');
  let revealed=0;f.rootEvents['csp:revealed']=()=>revealed++;
  for(const [id,t] of [...f.timers])if(t.ms<=500){t.fn();f.timers.delete(id)}
  assert(!f.classes.has('csp-reveal'));
  assert.equal(revealed,1,'optional rendering starts once the fade has finished');
  assert(!f.classes.has('csp-map-staging'),'the shell never appears over a held map');assert.equal(f.timers.size,0);
  f.context.window.CSPBoot.fail('late rendering failure');
  assert(f.nodes.cspStartup.hidden,'an optional renderer failure must not cover a working shell');
}
async function revealHold(){
  // A shared link holds the fade-in until its view is applied...
  let release;const f=fixture();f.context.window.CSPBoot.hold=new Promise(r=>release=r);
  f.rootEvents['csp:ready']();
  assert(f.classes.has('csp-boot'),'the shell stays hidden while a shared view is applied');
  assert(f.nodes.cspStartup.hidden,'holding is not a failure');
  release();await new Promise(resolve=>setImmediate(resolve));
  assert(!f.classes.has('csp-boot'),'the shell fades in once the shared view is in place');
  // ...as does the first map picture (boot.holds)...
  let mapShown;const m=fixture();m.context.window.CSPBoot.holds.push(new Promise(r=>mapShown=r));
  m.rootEvents['csp:ready']();assert(m.classes.has('csp-boot'),'the shell waits for the first map picture');
  mapShown();await new Promise(resolve=>setImmediate(resolve));
  assert(!m.classes.has('csp-boot'),'shell and map arrive together');
  // ...but never for more than 1.6 s.
  const g=fixture();g.context.window.CSPBoot.hold=new Promise(()=>{});
  g.rootEvents['csp:ready']();assert(g.classes.has('csp-boot'));
  [...g.timers.values()].find(t=>t.ms===1600).fn();
  assert(!g.classes.has('csp-boot'),'a stalled shared view cannot keep the app hidden');
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
async function gpuStartup(){
  const begin=html.indexOf('document.documentElement.addEventListener("csp:ready",()=>requestAnimationFrame(');
  const end=html.indexOf('if("serviceWorker" in navigator',begin);
  assert(begin>=0&&end>begin);
  let frame,rendered=0,cleaned=0;const readyHooks=[],readyHook=()=>readyHooks.forEach(fn=>fn());
  const rootClasses=new Set(['csp-map-staging']);
  const boot={holds:[]};
  const context={window:{CSPBoot:boot},Promise,document:{documentElement:{dataset:{},classList:{remove:c=>rootClasses.delete(c)},addEventListener:(name,fn)=>{if(name==="csp:ready")readyHooks.push(fn)}},querySelectorAll:()=>[]},
    requestAnimationFrame:fn=>frame=fn,initGpuTerrain:()=>{throw Error("GPU unsupported")},
    gpuTerrainEnabled:true,gpuTerrainLayer:{destroy:()=>cleaned++},gpuTerrainStore:{destroy:()=>cleaned++},
    lidarStudio:{refresh(){}},console:{warn(){}},$:()=>({value:"hs"}),applyTerrain:()=>rendered++,
    elevationActive:()=>false,syncElevationChecks(){},cspRendererReady(){context.decided=(context.decided||0)+1},terLayer:null,elevLayer:null,terBase:null,baseLayer:null,terrainSwap:null,
    map:{hasLayer:()=>false,getContainer:()=>({addEventListener(){},removeEventListener(){}})},performance:{now:()=>1000},
    setInterval:fn=>(context.ticks=(context.ticks||[])).push(fn),clearInterval(){},setTimeout:fn=>{context.deadline=fn;return 1},clearTimeout(){}};
  vm.runInNewContext(html.slice(begin,end),context);
  assert.equal(rendered,0);readyHook();assert.equal(rendered,0);
  frame();assert.equal(cleaned,2);assert.equal(rendered,1);
  // Nothing to draw: released after the short grace (simulated clock).
  context.performance.now=()=>1300;context.ticks.at(-1)();
  assert.equal(context.decided,1,'shared views learn the renderer even when GPU start-up fails');
  assert(!rootClasses.has('csp-map-staging'),'the map is shown at once when there is no GPU picture to stage');
  // The first-picture coordinator holds the map while CPU terrain layers load,
  // a terrain swap is staging, or the basemap is loading; it releases once all
  // are done (after its short grace).
  let tick=null,clock=0;const fake=loading=>({loading,isLoading(){return this.loading}});
  const a=fake(true),b=fake(true),base=fake(true);
  Object.assign(context,{gpuTerrainEnabled:false,terLayer:a,elevLayer:b,terBase:null,baseLayer:base,terrainSwap:null,
    map:{hasLayer:()=>true,on(){},off(){},getContainer:()=>({addEventListener(){},removeEventListener(){}})},performance:{now:()=>clock},
    setTimeout:()=>0,clearTimeout(){},setInterval:fn=>{tick=fn;return 1},clearInterval(){tick=null}});
  rootClasses.add('csp-map-staging');context.cspStageFirstPicture();clock=300;
  a.loading=false;tick();
  assert(rootClasses.has('csp-map-staging'),'one finished layer must not release the map while another loads');
  b.loading=false;context.terrainSwap=()=>{};tick();
  assert(rootClasses.has('csp-map-staging'),'a terrain swap still staging keeps the map held');
  context.terrainSwap=null;tick();
  assert(rootClasses.has('csp-map-staging'),'the basemap is part of the first picture');
  base.loading=false;tick();
  assert(!rootClasses.has('csp-map-staging'),'the map is released once the first picture is complete');
  assert.equal(boot.holds.length,2,'the shell waits for the first map picture and its visible icons');
  let shown=0;await Promise.all(boot.holds.map(hold=>hold.then(()=>shown++)));assert.equal(shown,2,'both holds settle once the picture and icons are ready');
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
  assert.match(fs.readFileSync('ios/Resources/native-shell.js','utf8'),/addEventListener\("csp:reveal", start/,'the iOS cover lifts when the page reveals, after any shared-link hold');
  const scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
  assert(scripts.length>25);assert(scripts.every(url=>/\?build=\d{4}-\d{2}-\d{2}[a-z]$/.test(url)),'every startup script must bypass older unversioned worker entries');
}
async function workerCache(){
  const events={},cached=new Set();let installed;
  const base='https://portal.test/';
  const context={URL,self:{location:{origin:new URL(base).origin},addEventListener:(n,f)=>events[n]=f,skipWaiting:()=>Promise.resolve()},
    caches:{open:async()=>({addAll:async list=>{for(const url of list)cached.add(new URL(url,base).href)}}),
      match:async req=>cached.has(typeof req==='string'?req:req.url)?{ok:true,fromCache:true}:null},fetch:async url=>{if(String(url).endsWith('site.json'))return {ok:true,json:async()=>JSON.parse(fs.readFileSync('site.json','utf8'))};throw Error('offline')}};
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
// The shared sidebar redesign must never style the independently organized
// LiDAR cards. Exercise first load, all routes, and returning to LiDAR.
function lidarRouteIsolation(){
  const begin=ui.indexOf('function activateRoute('),end=ui.indexOf('\nnavScroll.addEventListener(',begin);
  assert(begin>=0&&end>begin,'the real route handler must be exercised');
  const routesBegin=ui.indexOf('const ROUTES='),routesEnd=ui.indexOf('\nconst nav=$(',routesBegin);
  assert(routesBegin>=0&&routesEnd>routesBegin);
  const routes=vm.runInNewContext(ui.slice(routesBegin,routesEnd)+';ROUTES'),keys=Object.keys(routes);
  for(const compact of [false,true]){
    const classes=new Set(['csp-redesign','csp-grouped-menus']);
    const classList={add:name=>classes.add(name),remove:name=>classes.delete(name),
      toggle(name,on){if(on)classes.add(name);else classes.delete(name)}};
    const nodes=new Map(),node=selector=>{
      if(!nodes.has(selector))nodes.set(selector,{textContent:'',hidden:false});
      return nodes.get(selector);
    };
    let rendered;
    const context={ROUTES:routes,routesShown:0,currentRoute:null,overlayGroup:null,
      document:{body:{classList,dataset:{}}},workspace:{classList,offsetWidth:660},compactShell:{matches:compact},
      $:node,$$:()=>[],panes:{},filterResearch(){},annotateOverlayGroups(){},bridge:{},
      renderCustom:route=>rendered=route,openDefaultPanes(){},workspaceScroll:{scrollTop:80},updateCounts(){}};
    vm.createContext(context);vm.runInContext(ui.slice(begin,end),context);
    for(const key of ['terrain',...keys,'terrain','appearance','terrain']){
      context.activateRoute(key);
      assert.equal(classes.has('csp-grouped-menus'),key!=='terrain',`${compact?'compact':'desktop'} ${key} uses its own menu styling`);
      assert.equal(context.document.body.dataset.cspRoute,key);
      assert.equal(rendered,routes[key],'routing still renders the requested page');
      assert.equal(context.workspaceScroll.scrollTop,0);
    }
    context.activateRoute('missing');
    assert.equal(context.document.body.dataset.cspRoute,'terrain','unknown routes leave LiDAR unchanged');
  }
}
lidarRouteIsolation();
Promise.all([retryBeforeLoad(),workerCache(),revealHold(),gpuStartup()]).then(()=>console.log('UI startup checks passed (static shell, pre-load retry, bounded cache recovery, missing bridge, exact offline asset URLs, LiDAR menu isolation)')).catch(e=>{console.error(e);process.exitCode=1});
