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
  assert(f.classes.has('csp-map-staging'),'the shell fade leaves a half-loaded map on the canvas colour');
  const pictureWatch=[...f.timers.values()].find(t=>t.ms===12000);
  assert(pictureWatch,'a withheld first picture keeps a recovery watch after the shell is up');
  f.context.window.CSPBoot.fail('late rendering failure');
  assert(f.nodes.cspStartup.hidden,'an optional renderer failure must not cover a working shell');
  const failures=[];
  f.context.window.CSPNativeHost={startupFailed:message=>failures.push(message),startupSettled:()=>failures.push('settled')};
  pictureWatch.fn();
  assert(f.nodes.cspStartup.classes.has('failed'),'a map that never finishes offers reload');
  assert.equal(f.nodes.cspStartup.hidden,false);
  assert.match(failures[0],/longer/);
  f.classes.delete('csp-map-staging');
  f.context.window.CSPBoot.settlePicture();
  assert(f.nodes.cspStartup.hidden,'a finished picture dismisses recovery');
  assert.equal(failures.at(-1),'settled');
  f.context.window.CSPBoot.failPicture('too late');
  assert(f.nodes.cspStartup.hidden,'recovery does not cover a picture that already arrived');
  f.classes.add('csp-terrain-pending');
  f.context.window.CSPBoot.failPicture('The terrain picture is still hidden.');
  assert.equal(f.nodes.cspStartup.hidden,false,'a hidden terrain picture can still offer reload after the shell is up');
  f.classes.delete('csp-terrain-pending');
  f.context.window.CSPBoot.settlePicture();
  assert(f.nodes.cspStartup.hidden);
}
{
  const f=fixture();
  f.rootEvents['csp:ready']();
  const armed=[...f.timers.entries()].filter(([,t])=>t.ms===12000);
  assert.equal(armed.length,1,'ready arms one picture watch');
  const [oldId,oldTimer]=armed[0];
  f.context.window.CSPBoot.notePictureProgress();
  oldTimer.fn();
  assert(!f.nodes.cspStartup.classes.has('failed'),'a replaced stall timer cannot fail a picture that is still arriving');
  assert(f.nodes.cspStartup.hidden,'progress keeps the reload panel off');
  const live=[...f.timers.entries()].filter(([,t])=>t.ms===12000);
  assert.equal(live.length,1);assert.notEqual(live[0][0],oldId,'progress replaces the stall watch');
  live[0][1].fn();
  assert(f.nodes.cspStartup.classes.has('failed'),'twelve seconds without a new frame still offers reload');
}
{
  const f=fixture();
  f.context.window.CSPBoot.pictureStillMoving=()=>true;
  f.rootEvents['csp:ready']();
  const [oldId,oldTimer]=[...f.timers.entries()].filter(([,t])=>t.ms===12000)[0];
  oldTimer.fn();
  assert(!f.nodes.cspStartup.classes.has('failed'),'a basemap or scene that is still fetching is not a failed start');
  const live=[...f.timers.entries()].filter(([,t])=>t.ms===12000);
  assert.equal(live.length,1);assert.notEqual(live[0][0],oldId,'an in-flight fetch replaces the stall watch');
  f.context.window.CSPBoot.pictureStillMoving=()=>false;
  live[0][1].fn();
  assert(f.nodes.cspStartup.classes.has('failed'),'twelve seconds after fetching stops still offers reload');
}
{
  const f=fixture();
  f.rootEvents['csp:ready']();
  f.classes.delete('csp-map-staging');
  f.context.window.CSPBoot.settlePicture();
  f.context.window.CSPBoot.notePictureProgress();
  assert.equal([...f.timers.values()].filter(t=>t.ms===12000).length,0,'a settled picture does not grow a new stall watch');
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
  const f=fixture(),failures=[];
  f.context.window.CSPNativeHost={startupFailed:message=>failures.push(message)};
  f.winEvents.error({target:{tagName:'SCRIPT'}});
  assert.match(failures[0],/required app file/,'native recovery learns of an early script failure');
  f.rootEvents['csp:ready']();f.context.window.CSPBoot.fail('late error');
  assert.equal(failures.length,1,'a working map is never covered by native startup recovery');
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
    setTimeout:(fn,ms)=>{context.stageTimers.push({fn,ms});return context.stageTimers.length},clearTimeout(){},setInterval:fn=>{tick=fn;return 1},clearInterval(){tick=null}});
  context.stageTimers=[];
  rootClasses.add('csp-map-staging');context.cspStageFirstPicture();clock=300;
  a.loading=false;tick();
  assert(rootClasses.has('csp-map-staging'),'one finished layer must not release the map while another loads');
  b.loading=false;context.terrainSwap=()=>{};tick();
  assert(rootClasses.has('csp-map-staging'),'a terrain swap still staging keeps the map held');
  context.terrainSwap=null;tick();
  assert(rootClasses.has('csp-map-staging'),'the basemap is part of the first picture');
  context.stageTimers.find(t=>t.ms===1500).fn();
  assert(rootClasses.has('csp-map-staging'),'a startup deadline cannot uncover a half-loaded basemap');
  base.loading=false;tick();
  assert(!rootClasses.has('csp-map-staging'),'the map is released once the first picture is complete');
  assert.equal(boot.holds.length,2,'the shell waits for the first map picture and its visible icons');
  let shown=0;await Promise.all(boot.holds.map(hold=>hold.then(()=>shown++)));assert.equal(shown,2,'both holds settle once the picture and icons are ready');
  assert.equal(context.gpuTerrainEnabled,false);assert.equal(context.document.documentElement.dataset.gpu2d,"off");
  const gestures=[];
  context.map.getContainer=()=>({
    addEventListener(name,fn){if(name==="pointerdown")gestures.push(fn)},
    removeEventListener(){}
  });
  context.cspShareCameraPending=true;
  rootClasses.add("csp-map-staging");
  clock=8000;
  context.cspStageFirstPicture();
  context.stageTimers.filter(t=>t.ms===1500).at(-1).fn();
  assert(rootClasses.has("csp-map-staging"),"a shared link keeps the map on the canvas colour until its camera is applied");
  gestures.at(-1)({target:{closest:query=>String(query).includes("#mapDock")?{}:null}});
  assert(rootClasses.has("csp-map-staging"),"a tool tap does not uncover a shared map that is still waiting");
  gestures.at(-1)({target:{closest:()=>null}});
  assert(rootClasses.has("csp-map-staging"),"a map gesture does not uncover a shared view before its camera is applied");
  context.cspShareCameraPending=false;
  clock=8300;
  tick();
  assert(!rootClasses.has("csp-map-staging"),"the shared camera releases the pane onto its own view");
  context.cspShareCameraPending=false;
  context.cspNativeCameraPending=true;
  rootClasses.add("csp-map-staging");
  clock=9000;
  context.cspStageFirstPicture();
  context.stageTimers.filter(t=>t.ms===1500).at(-1).fn();
  assert(rootClasses.has("csp-map-staging"),"a recovered camera keeps the map on the canvas colour until it is applied");
  context.cspNativeCameraPending=false;
  clock=9300;
  tick();
  assert(!rootClasses.has("csp-map-staging"),"the recovered camera releases the pane onto its own view");
  const water=fake(true);
  context.cspFreshView=true;context.ovOn={water:true};context.ovLayers={water};
  context.cspNativeCameraPending=false;context.cspShareCameraPending=false;
  rootClasses.add("csp-map-staging");
  clock=12000;
  context.cspStageFirstPicture();
  clock=12300;tick();
  assert(rootClasses.has("csp-map-staging"),"a fresh launch waits for rivers and lakes");
  context.stageTimers.filter(t=>t.ms===1500).at(-1).fn();
  assert(rootClasses.has("csp-map-staging"),"the deadline does not uncover rivers that are still loading");
  water.loading=false;tick();
  assert(!rootClasses.has("csp-map-staging"),"the fresh launch opens once rivers and lakes have drawn");
  context.cspFreshView=false;
  const cpuOnly=fake(true);
  context.terLayer=cpuOnly;context.elevLayer=null;context.terBase=null;context.baseLayer=fake(false);context.terrainSwap=null;
  context.gpuTerrainEnabled=false;context.gpuTerrainLayer=null;
  rootClasses.add("csp-map-staging");
  clock=14000;
  context.cspStageFirstPicture();
  clock=14300;tick();
  assert(rootClasses.has("csp-map-staging"),"terrain tiles that are still loading keep the pane closed");
  context.stageTimers.filter(t=>t.ms===1500).at(-1).fn();
  assert(rootClasses.has("csp-map-staging"),"the deadline does not uncover the basemap while terrain tiles are still loading");
  cpuOnly.loading=false;tick();
  assert(!rootClasses.has("csp-map-staging"),"the pane opens once those terrain tiles have drawn");
  const events=new Map(),reads=[];
  const layer={
    getContainer:()=>({style:{},querySelector:()=>null}),
    on(name,fn){let set=events.get(name);if(!set){set=new Set();events.set(name,set)}set.add(fn)},
    off(name,fn){events.get(name)?.delete(fn)},
    getEngine:()=>({readProvenance:()=>new Promise(resolve=>reads.push(resolve))}),
    redraw(){}
  };
  context.gpuTerrainEnabled=true;context.gpuTerrainLayer=layer;
  context.beginStudioPublication=()=>()=>{};
  context.scheduleTerrainStatus=()=>{};
  context.matchMedia=()=>({matches:false});
  context.lidarStudio.needsFit=()=>false;
  context.document.documentElement.classList.add=name=>rootClasses.add(name);
  context.document.documentElement.classList.contains=name=>rootClasses.has(name);
  context.cspShareCameraPending=true;
  rootClasses.add("csp-map-staging");
  clock=15000;
  context.cspStageFirstPicture();
  for(const fn of [...(events.get("render")||[])])fn({view:{zoom:2},coverage:{coverage:1}});
  reads.shift()({coverage:1,ranks:{1:100}});
  await new Promise(resolve=>setImmediate(resolve));
  context.stageTimers.filter(t=>t.ms===1500).at(-1).fn();
  assert(rootClasses.has("csp-map-staging"),"the deadline still waits for the shared camera");
  context.cspShareCameraPending=false;
  clock=15300;tick();
  assert(rootClasses.has("csp-map-staging"),"a late camera does not uncover the base map before its picture publishes");
  reads.shift()({coverage:1,ranks:{1:100}});
  await new Promise(resolve=>setImmediate(resolve));
  tick();
  assert(!rootClasses.has("csp-map-staging"),"the pane opens once the deferred picture has published");
  context.cspShareCameraPending=false;
  context.cspNativeCameraPending=false;
  context.baseLayer=fake(false);
  context.terLayer=fake(false);
  context.terrainSwap=null;
  context.cspFreshView=false;
  rootClasses.add("csp-map-staging");
  clock=18000;
  context.cspStageFirstPicture();
  clock=18300;tick();
  assert(rootClasses.has("csp-map-staging"),"an unfinished terrain picture keeps the pane on the canvas colour");
  context.stageTimers.filter(t=>t.ms===1500).at(-1).fn();
  assert(rootClasses.has("csp-map-staging"),"the deadline does not uncover the basemap while the terrain picture is still hidden");
  assert(rootClasses.has("csp-terrain-pending"),"the deadline hides the unfinished terrain picture");
  for(const fn of [...(events.get("render")||[])])fn({view:{zoom:2},coverage:{coverage:1}});
  reads.shift()({coverage:1,ranks:{1:100}});
  await new Promise(resolve=>setImmediate(resolve));
  tick();
  assert(!rootClasses.has("csp-map-staging"),"the pane opens once the hidden terrain picture has published");
  events.clear();
  context.cspShareCameraPending=true;
  rootClasses.add("csp-map-staging");
  clock=20000;
  context.cspStageFirstPicture();
  for(const fn of [...(events.get("render")||[])])fn({view:{zoom:4},coverage:{coverage:1}});
  reads.at(-1)({coverage:1,ranks:{1:100}});
  await new Promise(resolve=>setImmediate(resolve));
  context.cspShareCameraPending=false;
  clock=20300;tick();
  assert(rootClasses.has("csp-map-staging"),"a camera inside the deadline keeps the pane staged for its resample");
  assert.equal(typeof tick,"function","the resample leaves the poll running");
  context.stageTimers.filter(t=>t.ms===1500).at(-1).fn();
  assert(rootClasses.has("csp-map-staging"),"the deadline does not uncover a picture that is still resampling");
  assert.equal(typeof tick,"function","the deadline leaves the poll running while launchHold is set");
  reads.at(-1)({coverage:1,ranks:{1:100}});
  await new Promise(resolve=>setImmediate(resolve));
  tick();
  assert(!rootClasses.has("csp-map-staging"),"the pane opens once that early resample publishes");
}
async function gpuPicture(){
  const begin=html.indexOf('function cspGpuPicture(layer){'),end=html.indexOf('/* The shell\'s visible icons',begin);
  function pictureFixture({bitmap=false,pixels}={}){
    const events=new Map(),reads=[],timers=new Map(),style={},input=new Set(),classes=new Set(),children=[];
    const canvasStyle={};let nextTimer=0,fitFrozen=null,copies=0;
    const canvas={width:bitmap?32:0,height:bitmap?32:0,style:canvasStyle,generation:0,parentNode:null};
    const container={style,appendChild(node){children.push(node);node.parentNode=this;return node},querySelector:sel=>bitmap&&sel==="canvas"?canvas:null};
    canvas.parentNode=container;
    const context={Promise,JSON,document:{documentElement:{classList:{
        contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name)
      },addEventListener(){},removeEventListener(){}},
      createElement(){copies++;const node={width:0,height:0,className:"",style:{},sourceGeneration:0};
        node.setAttribute=()=>{};node.remove=()=>{node.removed=true;const at=children.indexOf(node);if(at>=0)children.splice(at,1)};node.getContext=()=>({drawImage(src){node.sourceGeneration=src?.generation||0},getImageData:(x,y,w,h)=>({data:(pixels||(()=>[8,8,8,255]))(x,y,w,h)})});return node}},
      matchMedia:()=>({matches:false}),lidarStudio:{needsFit:()=>false},
      beginStudioPublication:()=>succeeded=>{fitFrozen=succeeded===true},scheduleTerrainStatus:()=>{},
      cspUserInput:(fn,on)=>on?input.add(fn):input.delete(fn),
      setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)};
    const layer={getContainer:()=>container,getEngine:()=>({readProvenance:()=>new Promise(resolve=>reads.push(resolve))}),
      on(name,fn){let set=events.get(name);if(!set){set=new Set();events.set(name,set)}set.add(fn)},
      off(name,fn){const set=events.get(name);if(!set)return;set.delete(fn);if(!set.size)events.delete(name)},
      redraw(){this.redraws=(this.redraws||0)+1}};
    vm.createContext(context);vm.runInContext(html.slice(begin,end),context);
    const picture=context.cspGpuPicture(layer);
    return {context,picture,layer,reads,timers,style,canvas,canvasStyle,children,copies:()=>copies,input,events,frozen:()=>fitFrozen,
      render(zoom=1){for(const fn of [...(events.get("render")||[])])fn({view:{zoom},coverage:{coverage:1}})}};
  }
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const f=pictureFixture();f.picture.hideUntilReady();
  assert(f.context.document.documentElement.classList.contains("csp-terrain-pending"),"a withheld picture is announced as still loading");
  f.render();
  f.reads.shift()({coverage:1/65536});await flush();
  assert.equal(f.picture.ready,false,'one valid sample in an overlapping tile is not a complete picture');
  for(const timer of f.timers.values())timer.fn();
  assert.equal(f.style.opacity,'0','elapsed time alone must never publish patchwork terrain');
  f.render();f.reads.shift()({coverage:1});await flush();
  assert(f.picture.ready);assert.equal(f.style.opacity,'','a valid complete picture fades in');
  assert.equal(f.frozen(),true,'a picture that needs no fit can keep its colours');
  assert(f.context.document.documentElement.classList.contains("csp-terrain-pending"),"the loading announcement stays until the fade ends");
  [...f.timers.values()].find(t=>t.ms===320).fn();
  assert(!f.context.document.documentElement.classList.contains("csp-terrain-pending"),"publication clears the loading announcement after the fade");
  assert(!f.events.has('render')&&!f.events.has('remove'),'publication releases its layer listeners');
  assert.equal(f.input.size,0);

  const stale=pictureFixture();stale.picture.hideUntilReady();stale.render(1);stale.render(2);
  stale.reads.shift()({coverage:1});await flush();
  assert.equal(stale.picture.ready,false,'a readback from the previous shared-link camera cannot release the new view');
  stale.reads.shift()({coverage:0});await flush();assert.equal(stale.picture.ready,false);
  stale.render(2);for(const fn of [...(stale.events.get("remove")||[])])fn();stale.reads.shift()({coverage:1});await flush();
  assert.equal(stale.picture.ready,false,'a removed layer cannot finish late or change the replacement');
  assert.equal(stale.style.opacity,'');assert.equal(stale.input.size,0);assert.equal(stale.events.size,0);
  const interactive=pictureFixture();interactive.picture.hideUntilReady();
  for(const fn of [...interactive.input])fn();
  assert(interactive.picture.ready,'taking the map gives the user control without waiting for sources');
  const fitting=pictureFixture();let fitCurrent,finishFit;
  fitting.context.lidarStudio.needsFit=()=>true;
  fitting.context.fitStudio=current=>{fitCurrent=current;return new Promise(resolve=>finishFit=resolve)};
  fitting.render();fitting.reads.shift()({coverage:1});await flush();
  assert(fitCurrent());assert.equal(fitting.picture.ready,false,'the first valid picture still waits for its colour fit');
  const budget=[...fitting.timers.values()].find(t=>t.ms===600);budget.fn();
  assert(!fitCurrent(),'an expired fit cannot recolour terrain after publication');
  assert.equal(fitting.layer.redraws||0,0,'an expired fit does not redraw or publish the default stretch');
  assert.equal(fitting.picture.ready,false,'the fit deadline still requires a valid rendered picture');
  assert.equal(fitting.frozen(),null,'an unfinished fit does not freeze the camera');
  finishFit(true);await flush();assert.equal(fitting.layer.redraws||0,0,'a late fit result cannot redraw after the budget');
  const due=()=>[...fitting.timers.values()].filter(t=>t.ms===400).at(-1);
  due().fn();
  fitting.reads.shift()({coverage:1});await flush();
  assert(fitCurrent(),'the next quiet frame may fit again');
  finishFit(false);await flush();
  assert.equal(fitting.picture.ready,false,'a fit that does not land stays hidden');
  assert.equal(fitting.layer.redraws||0,0);
  due().fn();
  fitting.reads.shift()({coverage:1});await flush();
  finishFit(true);await flush();
  assert.equal(fitting.layer.redraws,1,'only a fit that lands redraws');
  assert.equal(fitting.picture.ready,false,'publication waits for the redrawn frame');
  fitting.render();fitting.reads.shift()({coverage:1});await flush();
  assert(fitting.picture.ready);
  assert.equal(fitting.frozen(),true,'a landed fit freezes that camera so it cannot recolour');
  const tapped=pictureFixture();
  tapped.context.lidarStudio.needsFit=()=>true;
  tapped.picture.hideUntilReady();
  for(const fn of [...tapped.input])fn();
  assert(tapped.picture.ready,'taking the map gives the user control without waiting for a fit');
  assert.equal(tapped.frozen(),false,'taking the map does not freeze an unfinished colour fit');

  const mixed=pictureFixture();
  mixed.layer.settled=()=>({total:4,refining:true,ratio:1});
  mixed.picture.hideUntilReady();
  mixed.render();mixed.reads.shift()({coverage:1,ranks:{1:90,5:30}});await flush();
  assert.equal(mixed.picture.ready,false,'an overview with finer tiles already in it stays hidden');
  assert.equal(mixed.style.opacity,'0');
  const overview=pictureFixture();
  overview.layer.settled=()=>({total:4,refining:true,ratio:1});
  overview.picture.hideUntilReady();
  overview.render();overview.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert.equal(overview.picture.ready,false,'a stretched overview waits for the view tiles when its bitmap cannot be held');
  overview.layer.settled=()=>({total:4,refining:false,ratio:1});
  overview.render();overview.reads.shift()({coverage:1,ranks:{5:80,1:2}});await flush();
  assert(overview.picture.ready,'the view tiles publish as one picture once they have settled');
  assert.deepEqual(overview.layer.shownProvenance.ranks,{5:80,1:2},'the published frame keeps the ranks that were actually drawn');

  const held=pictureFixture({bitmap:true});
  held.layer.settled=()=>({total:4,refining:true,ratio:1});
  held.picture.hideUntilReady();
  held.render();held.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert(held.picture.ready,'a whole overview is shown once its bitmap can be held');
  assert.equal(held.children.length,1,'the still is a child of the terrain container');
  assert.equal(held.canvas.style.opacity,"0",'the live canvas stays hidden under the still');
  assert.equal(held.style.opacity,"",'the container stays visible so the still can show');
  assert.equal(held.layer._cspHoldStill,true);
  [...held.timers.values()].find(t=>t.ms===0).fn();
  assert.equal(held.children[0].style.opacity,"1");
  [...held.timers.values()].find(t=>t.ms===320).fn();
  assert(!held.context.document.documentElement.classList.contains("csp-terrain-pending"),'the held still clears the loading line after it fades in');
  assert.equal(held.canvas.style.opacity,"0",'settling tiles stay under the still');
  held.layer.settled=()=>({total:4,refining:false,ratio:1});
  held.render();
  assert.equal(held.children.length,1,'the same view fades the still instead of dropping it');
  assert.equal(held.canvas.style.opacity,"",'the live canvas returns once the view tiles have settled');
  assert.equal(held.layer._cspHoldStill,false);

  const moved=pictureFixture({bitmap:true});
  moved.layer.settled=()=>({total:4,refining:true,ratio:1});
  moved.picture.hideUntilReady();
  moved.render(1);moved.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert.equal(moved.children.length,1);
  moved.layer.settled=()=>({total:4,refining:true,ratio:0});
  moved.render(4);
  assert.equal(moved.children.length,0,'a new view drops the held hillshade');
  assert.equal(moved.canvas.style.opacity,"");
  assert.equal(moved.layer._cspHoldStill,false);

  const fittedStill=pictureFixture({bitmap:true});
  let landFit;fittedStill.context.lidarStudio.needsFit=()=>true;
  fittedStill.context.fitStudio=()=>new Promise(resolve=>landFit=resolve);
  fittedStill.layer.settled=()=>({total:4,refining:true,ratio:1});
  fittedStill.canvas.generation=1;
  fittedStill.picture.hideUntilReady();
  fittedStill.render();fittedStill.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert.equal(fittedStill.picture.ready,false);
  assert.equal(fittedStill.copies(),0,'the pre-fit stretch is not copied');
  assert.equal(fittedStill.children.length,0);
  landFit(true);await flush();
  assert.equal(fittedStill.layer.redraws,1,'a fit that lands redraws before the still is taken');
  assert.equal(fittedStill.picture.ready,false,'publication waits for that redrawn frame');
  fittedStill.canvas.generation=2;
  fittedStill.render();fittedStill.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert(fittedStill.picture.ready,'the fitted frame is the one that is held');
  assert.equal(fittedStill.copies(),1);
  assert.equal(fittedStill.children[0].sourceGeneration,2,'the held still is the frame after the fit');
  assert.equal(fittedStill.canvas.style.opacity,"0");
  assert.equal(fittedStill.style.opacity,"");

  const coast=pictureFixture();
  coast.layer.settled=()=>({total:4,refining:false,ratio:1});
  coast.picture.hideUntilReady();
  coast.render();coast.reads.shift()({coverage:0.4,ranks:{1:10}});await flush();
  assert(coast.picture.ready,'a settled coast publishes even when water keeps the sample under 0.98');
  assert.deepEqual(coast.layer.shownProvenance.ranks,{1:10});
  assert.equal([...coast.timers.values()].some(t=>t.ms===400),false,'a settled short sample is not read again');

  const partial=pictureFixture();
  partial.layer.settled=()=>({total:4,refining:true,ratio:0.4});
  partial.picture.hideUntilReady();
  partial.render();partial.reads.shift()({coverage:0.4,ranks:{1:10}});await flush();
  for(const timer of partial.timers.values())timer.fn();
  await flush();
  assert.equal(partial.picture.ready,false,'a short sample is not retried until the view settles');
  assert.equal(partial.style.opacity,"0");

  const progressing=pictureFixture();
  let notes=0;progressing.context.CSPBoot={notePictureProgress(){notes++}};
  progressing.picture.hideUntilReady();
  progressing.render();
  assert.equal(notes,1,'each render while the picture is withheld counts as progress');

  const stuck=pictureFixture();
  let stuckNotes=0;
  stuck.context.CSPBoot={notePictureProgress(){stuckNotes++}};
  stuck.context.lidarStudio.needsFit=()=>true;
  stuck.context.fitStudio=()=>new Promise(()=>{});
  stuck.picture.hideUntilReady();
  stuck.render(8);
  assert.equal(stuckNotes,1,'the first frame of a view that still needs a fit is progress');
  stuck.render(8);stuck.render(8);
  assert.equal(stuckNotes,1,'redrawing a stretch that cannot publish does not reset the reload watch');
  stuck.render(9);
  assert.equal(stuckNotes,2,'a new view is a new picture, so the watch may start over');

  const persistent=pictureFixture();
  let fits=0;
  persistent.context.lidarStudio.needsFit=()=>true;
  persistent.context.fitStudio=()=>{fits++;return new Promise(()=>{})};
  persistent.render();
  for(let attempt=1;attempt<=5;attempt++){
    persistent.reads.shift()({coverage:1});
    await flush();
    assert.equal(fits,attempt,`fit attempt ${attempt} still runs after earlier misses`);
    [...persistent.timers.values()].filter(t=>t.ms===600).at(-1).fn();
    const retry=[...persistent.timers.values()].filter(t=>t.ms===400).at(-1);
    assert(retry,`a missed fit ${attempt} schedules another sample`);
    retry.fn();
  }
  persistent.reads.shift()({coverage:1});
  await flush();
  assert.equal(fits,6,'a slow readback can still fit after four misses');
  assert.equal(persistent.picture.ready,false,'missed fits do not publish the default stretch');
  assert.equal(persistent.frozen(),null,'a missed fit does not freeze the camera');

  const shore=pictureFixture({bitmap:true,pixels:(x,y,w,h)=>x<8||y<8||x+w>24||y+h>24?[8,8,8,255]:[0,0,0,0]});
  shore.layer.settled=()=>({total:4,refining:true,ratio:1});
  shore.picture.hideUntilReady();
  shore.render();shore.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert(shore.picture.ready,'a coast keeps its hillshade when the center of the frame is water');
  assert.equal(shore.children.length,1,'the held overview is the frame that had ink away from the center');

  let ink=false;
  const openWater=pictureFixture({bitmap:true,pixels:()=>ink?[8,8,8,255]:[0,0,0,0]});
  openWater.layer.settled=()=>({total:4,refining:true,ratio:1});
  openWater.picture.hideUntilReady();
  openWater.render(3);
  assert.equal(openWater.copies(),1);
  assert.equal(openWater.children.length,0,'a cleared frame is not kept as the overview');
  ink=true;
  openWater.render(3);
  assert.equal(openWater.copies(),2,'an empty copy does not latch the view, so a later frame can be held');
  openWater.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  openWater.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert(openWater.picture.ready,'the first frame that has ink is the overview that is held');
  assert.equal(openWater.children.length,1);

  const blocked=pictureFixture({bitmap:true});
  let holdCamera=true;
  blocked.context.startupCameraPending=()=>holdCamera;
  blocked.layer.settled=()=>({total:4,refining:true,ratio:1});
  blocked.picture.hideUntilReady();
  blocked.render();blocked.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert.equal(blocked.picture.ready,false,'a picture of the placeholder camera does not publish');
  assert.equal(blocked.picture.defer,true);
  holdCamera=false;
  blocked.picture.resample();
  blocked.reads.shift()({coverage:1,ranks:{1:100}});await flush();
  assert(blocked.picture.ready,'the picture publishes once the launch camera is the view on screen');
}
async function studioPublication(){
  const begin=html.indexOf('let studioFitChain'),end=html.indexOf('function initGpuTerrain',begin);
  const timers=[];let mix='view-a';
  const context={Promise,map:{getCenter:()=>({lat:1,lng:2}),getZoom:()=>5,getSize:()=>({x:10,y:10})},
    lidarStudio:{needsFit:()=>true,fitKey:()=>mix},
    setTimeout:(fn,ms)=>timers.push({fn,ms,cleared:false})&&timers.length,
    clearTimeout:id=>{if(timers[id-1])timers[id-1].cleared=true}};
  vm.createContext(context);vm.runInContext('var studioFitTimer=0;\n'+html.slice(begin,end),context);
  const pending=()=>timers.filter(t=>!t.cleared&&t.ms===450);
  const close=context.beginStudioPublication();
  context.scheduleStudioFit();
  assert.equal(pending().length,0,'the first picture owns range fits until it publishes');
  close(false);
  context.scheduleStudioFit();
  assert.equal(pending().length,1,'a failed fit leaves this camera free to fit again');
  pending().forEach(t=>t.cleared=true);
  const close2=context.beginStudioPublication();
  close2(true);
  context.scheduleStudioFit();
  assert.equal(pending().length,0,'a landed fit freezes that camera so it cannot recolour');
  mix='view-b';
  context.scheduleStudioFit();
  assert.equal(pending().length,1,'a new camera or mix can fit again');
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
  const nativeShell=fs.readFileSync('ios/Resources/native-shell.js','utf8');
  assert.match(nativeShell,/addEventListener\("csp:reveal", start/,'the iOS cover lifts when the page reveals, after any shared-link hold');
  const startAt=nativeShell.indexOf('const start = async'),listenAt=nativeShell.indexOf('addEventListener("csp:reveal", start');
  assert(startAt>0&&listenAt>startAt);
  assert(!nativeShell.slice(startAt,listenAt).includes('CSPNativeHost.resume'),'the cover does not move the camera after the first picture');
  assert.match(nativeShell,/dataset\.uiThemeSaved/,'the native shell reports the saved theme, not a shared link');
  assert(!/theme:\s*document\.documentElement\.dataset\.uiTheme\b/.test(nativeShell),'a live shared theme is not the next launch colour');
  assert.match(fs.readFileSync('electron/main.js','utf8'),/backgroundColor: "#ffffff"/,'the desktop window opens on the start-up screen\'s white');
  assert.match(html,/dataset\.uiThemeSaved=theme/,'choosing a theme records it separately from the live paint');
  const restoreAt=html.indexOf('async function cspRestoreShareState'),restoreEnd=html.indexOf('Object.assign(window.ClearSkiesPortalBridge,{shareURL:cspShareURL',restoreAt);
  const restoreBody=html.slice(restoreAt,restoreEnd);
  const shownAt=restoreBody.indexOf('cspShareShown?.()');
  assert(shownAt>restoreBody.indexOf('await cspRestoreImagery'),'the shell waits for shared imagery');
  assert(shownAt>restoreBody.indexOf('map.setView(state.view.center'),'the shell waits for the final shared camera');
  assert(shownAt>restoreBody.indexOf('await cspAwaitSharedOverlays'),'the shell waits for shared overlays');
  assert.equal(restoreBody.indexOf('cspShareShown?.()',shownAt+1),-1,'the shared shell is released once inside the restore');
  const resumed=html.indexOf('const resume=window.CSPNativeHost?.resume');
  const pictureCall=html.indexOf('cspStageFirstPicture()',resumed);
  assert(resumed>0&&pictureCall>resumed,'a recovered camera is applied before the first picture can publish');
  const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
  assert.equal(manifest.background_color,'#ffffff','the installed splash is the start-up screen\'s white');assert.equal(manifest.theme_color,'#dbe6eb','the browser chrome uses the map colour');
  assert.match(html,/themeMetas\[ti\]\.setAttribute\("content","#ffffff"\)/,'browser chrome is white under the start-up screen');
  assert.match(html,/theme==="dark"\?"#111416":"#dbe6eb"/,'the map colour returns to the chrome as the start-up screen lifts');
  const rootView=fs.readFileSync('ios/Sources/App/RootView.swift','utf8'),host=fs.readFileSync('ios/Sources/Web/WebHost.swift','utf8'),cover=fs.readFileSync('ios/Sources/Shell/Map/MapChrome.swift','utf8'),app=fs.readFileSync('ios/Sources/App/ClearSkiesApp.swift','utf8');
  assert(rootView.includes('MapCanvasColor')&&host.includes('useMapCanvas')&&cover.includes('MapCanvasColor.color'),'the iOS cover and the web view use the saved map colour');
  assert(app.includes('UIWindow.appearance().backgroundColor = .white')&&app.includes('overrideUserInterfaceStyle'),'the iOS window opens white, under the start-up screen, in the saved appearance');
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
function basemapStall(){
  const src=fs.readFileSync('app/map.js','utf8');
  const begin=src.indexOf('function considerBasemapBlocked(');
  const end=src.indexOf('\nsetTimeout(considerBasemapBlocked,12000)',begin);
  assert(begin>=0&&end>begin);
  const timers=[];
  const run=({ok,loading})=>{
    const shown=[];
    const context={baseOK:ok,baseLayer:{isLoading:()=>loading},showBlocked:()=>shown.push('blocked'),
      setTimeout:(fn,ms)=>timers.push({fn,ms})};
    vm.createContext(context);vm.runInContext(src.slice(begin,end)+'\nthis.consider=considerBasemapBlocked;',context);
    context.consider();
    return {shown,timers};
  };
  const quiet=run({ok:0,loading:false});
  assert.deepEqual(quiet.shown,['blocked'],'a basemap that has stopped with no tiles says so');
  const arriving=run({ok:0,loading:true});
  assert.deepEqual(arriving.shown,[],'a basemap that is still fetching does not say the tiles are unavailable');
  assert.equal(arriving.timers.filter(t=>t.ms===12000).length,1,'the blocked check waits out the request that is already in flight');
  const drawn=run({ok:1,loading:false});
  assert.deepEqual(drawn.shown,[],'a drawn basemap is not reported as blocked');
}
function pictureMotion(){
  const src=fs.readFileSync('app/map.js','utf8');
  const begin=src.indexOf('if(window.CSPBoot)window.CSPBoot.pictureStillMoving=function(){');
  const end=src.indexOf('\nfunction stageMapLocation',begin);
  assert(begin>=0&&end>begin);
  const run=vars=>{
    const onMap=vars.onMap||new Set();
    const context={window:{CSPBoot:{}},...vars,map:{hasLayer:layer=>!!layer&&onMap.has(layer)}};
    vm.createContext(context);
    vm.runInContext(src.slice(begin,end),context);
    return context.window.CSPBoot.pictureStillMoving();
  };
  const idle={isLoading:()=>false},busy={isLoading:()=>true},water={isLoading:()=>true};
  const base={onMap:new Set(),baseLayer:idle,overlayPending:null,terrainSwap:null,terBase:null,terLayer:null,elevLayer:null,cspFreshView:false,ovOn:{},ovLayers:{}};
  assert.equal(run({...base,onMap:new Set()}),false,'an idle map is not still drawing the first picture');
  assert.equal(run({...base,baseLayer:busy}),true,'a basemap that is still fetching holds the reload watch');
  assert.equal(run({...base,onMap:new Set([busy]),terLayer:busy}),true,'cpu terrain that is still drawing holds the reload watch');
  assert.equal(run({...base,terrainSwap:()=>{}}),true,'a terrain swap still staging holds the reload watch');
  assert.equal(run({...base,onMap:new Set([water]),cspFreshView:true,ovOn:{water:true},ovLayers:{water}}),true,'a fresh visit waits to reload while rivers and lakes are drawing');
  assert.equal(run({...base,onMap:new Set([water]),cspFreshView:false,ovOn:{water:true},ovLayers:{water}}),false,'a returning visit does not treat rivers as the first picture');
  const scene={isLoading:()=>false,_cspHealth:{pending:true,started:0,loaded:0}};
  assert.equal(run({...base,overlayPending:scene}),false,'a scene that has not requested a tile is not still drawing');
  scene._cspHealth.started=2;
  assert.equal(run({...base,overlayPending:scene}),true,'a scene with tiles in flight holds the reload watch');
}
function mapGesture(){
  const begin=html.indexOf("function cspUserInput(fn,on){"),end=html.indexOf("/* One coordinator for the first picture.",begin);
  assert(begin>=0&&end>begin);
  const listeners=new Map();
  const el={addEventListener(name,fn){listeners.set(name,fn)},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name)}};
  let calls=0;
  const context={map:{getContainer:()=>el}};
  vm.createContext(context);vm.runInContext(html.slice(begin,end),context);
  const fn=()=>calls++;
  context.cspUserInput(fn,true);
  const control=selector=>({closest:query=>query.split(",").some(part=>part.trim()===selector)?{id:selector}:null});
  const fire=(name,target)=>listeners.get(name)({target});
  fire("pointerdown",control("#mapDock"));
  fire("pointerdown",control("#sideToggle"));
  fire("pointerdown",control("button"));
  fire("touchstart",control(".leaflet-control"));
  fire("keydown",control("input"));
  fire("wheel",control(".map-tool"));
  assert.equal(calls,0,"a control cannot uncover the map");
  fire("pointerdown",{closest:()=>null});
  fire("wheel",{closest:()=>null});
  assert.equal(calls,2,"the map itself still counts as taking it");
  context.cspUserInput(fn,false);
  assert(!listeners.has("pointerdown"),"a removed gesture no longer reaches the picture");
}
async function splashManifest(){
  const events={};let themeText="",offline=false,stored="";
  const shell=()=>new Response(fs.readFileSync("index.html","utf8"),{headers:{"Content-Type":"text/html; charset=utf-8"}});
  const context={URL,Response,Headers,
    self:{location:{href:"https://portal.test/sw.js",origin:"https://portal.test"},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:()=>Promise.resolve()},
    caches:{open:async()=>({put:async(_url,response)=>{stored=await response.text()}}),keys:async()=>[],
      match:async req=>{const url=typeof req==="string"?req:req?.url||"";
        if(String(url).includes("csp-map-theme")&&themeText)return {text:async()=>themeText};
        if(new URL(url,"https://portal.test/").pathname==="/")return shell();
        return null}},
    fetch:async req=>{
      if(offline)throw new Error("offline");
      const url=typeof req==="string"?req:req?.url||"";
      if(req?.mode==="navigate")return shell();
      return new Response(fs.readFileSync(String(url).includes("index.html")?"index.html":"manifest.json","utf8"),{headers:{"Content-Type":String(url).includes("index.html")?"text/html":"application/json"}});
    }};
  vm.runInNewContext(fs.readFileSync("sw.js","utf8"),context);
  const ask=()=>new Promise(resolve=>events.fetch({request:{method:"GET",url:"https://portal.test/manifest.json",mode:"cors"},respondWith:p=>resolve(p)}));
  const plain=await (await ask()).json();
  assert.equal(plain.background_color,"#ffffff");assert.equal(plain.theme_color,"#dbe6eb");
  themeText="dark";
  const dark=await (await ask()).json();
  assert.equal(dark.background_color,"#ffffff","the installed splash stays the start-up screen's white");
  assert.equal(dark.theme_color,"#111416","a saved dark map recolours the installed chrome");
  themeText="light";
  const light=await (await ask()).json();
  assert.equal(light.background_color,"#ffffff");assert.equal(light.theme_color,"#dbe6eb");
  const open=()=>new Promise(resolve=>events.fetch({request:{method:"GET",url:"https://portal.test/",mode:"navigate"},waitUntil:()=>{},respondWith:p=>resolve(p)}));
  themeText="";
  const first=await (await open()).text();
  assert(first.includes('media="(prefers-color-scheme: light)"'),"a first launch keeps the device theme-color until a theme is saved");
  assert(!/<html\b[^>]*\bdata-ui-theme=/.test(first),"a first launch does not bake a theme onto the document");
  themeText="dark";
  const themed=await (await open()).text();
  assert(themed.includes('<html lang="en" data-ui-theme="dark">'),"the saved theme is on the document before the head script");
  assert(!/name="theme-color"[^>]*media=/.test(themed),"installed chrome does not follow the device once a theme is saved");
  assert(themed.includes('content="#111416"'),"a saved dark map recolours theme-color");
  assert(themed.includes("body{background:#111416 linear-gradient(#111416,#111416)}"),"a saved dark map recolours the boot background");
  assert(themed.includes('theme==="dark"?"#111416":"#dbe6eb"'),"the head script can still follow a share hint");
  for(let i=0;i<6;i++)await Promise.resolve();
  assert(stored.includes('media="(prefers-color-scheme: light)"'),"the cached shell stays uncoloured so the next theme can recolour it");
  themeText="light";
  const savedLight=await (await open()).text();
  assert(savedLight.includes('data-ui-theme="light">'));
  assert(savedLight.includes('content="#dbe6eb"'));
  assert(!/name="theme-color"[^>]*media=/.test(savedLight),"a saved light map wins over a dark device");
  offline=true;themeText="dark";
  const cached=await (await open()).text();
  assert(cached.includes('data-ui-theme="dark">')&&cached.includes("body{background:#111416 linear-gradient(#111416,#111416)}"),"an offline open uses the saved theme too");
}
function map3dTheme(){
  const css=fs.readFileSync("ui-base.css","utf8"),src=fs.readFileSync("app/terrain-3d.js","utf8");
  assert.match(css,/html\[data-ui-theme="dark"\] #map3d,#map\[data-basemap-theme="dark"\] #map3d\{background:#111416\}/,"the 3D canvas follows the live map theme");
  const enter=src.slice(src.indexOf("async function enterTerrain3d"),src.indexOf("function exitTerrain3d"));
  assert(enter.includes("paintMap3dTheme()"),"opening 3D paints the live map colour");
  assert(enter.indexOf("paintMap3dTheme()")<enter.indexOf("new module.Map"));
  assert(enter.indexOf("map3dFrameReady=false")<enter.indexOf("new module.Map"));
  const revealed=enter.indexOf("map3dFrameReady=true");
  assert(revealed>0&&enter.includes('view.once("load",reveal)'),"terrain-3d shows at MapLibre's load");
  assert(enter.includes('view.once("render",reveal)'),"terrain-3d shows on the first drawn frame");
  /* load waits for every tile in view. A slow tile must not leave 3D hidden
     over the 2D map, which pans and rotates but cannot tilt. */
  assert(enter.includes("revealTimer=setTimeout(reveal,MAP3D_REVEAL_MS)"),"a slow tile cannot hold the 3D view hidden");
  assert(enter.indexOf("map3dShownWaiters.splice(0)")<enter.indexOf("easeTo({pitch:MAP3D_PITCH"),"a restored flat camera cannot cancel the opening tilt");
  assert(/const MAP3D_REVEAL_MS=\d+;/.test(src)&&+src.match(/const MAP3D_REVEAL_MS=(\d+);/)[1]<=2000);
  const bridgeSrc=fs.readFileSync("app/bridge.js","utf8");
  assert(!/map3d\.once\("load"/.test(bridgeSrc),"a restored 3D camera is reapplied when the view appears, not at a late load");
  assert(bridgeSrc.includes("whenMap3dShown("));
  const prelude=src.slice(src.indexOf("function paintMap3dTheme"),src.indexOf("function webgl2Capable"));
  const run=extra=>{
    const classes=new Set(),nodes=new Map();
    const el=sel=>{
      if(!nodes.has(sel))nodes.set(sel,{style:{},attrs:{},textContent:"",value:"hs",setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]}});
      return nodes.get(sel);
    };
    const context={document:{body:{classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)}}},
      documentElement:{dataset:{uiTheme:"dark"}},getElementById:id=>el("#"+id)},
      $:el,matchMedia:()=>({matches:false}),syncBearingButton(){},syncLocationPin(){},paintSunNote(){},paintTerrainLegend(){},reset3dGlassMotion(){}};
    vm.runInNewContext(prelude+"\n"+extra,context);
    return {classes,el,context};
  };
  const hidden=run('paintMap3dTheme();setTerrainModeUi(true,"Starting the GPU terrain viewer…");');
  assert.equal(hidden.el("#map3d").style.background,"#111416","a dark map paints the 3D canvas before its first frame");
  assert(!hidden.classes.has("terrain-3d"),"the 3D canvas stays hidden until MapLibre's first frame");
  assert.equal(hidden.el("#terMode3d").getAttribute("aria-pressed"),"true","the 3D control still shows that 3D was requested");
  const shown=run("map3dFrameReady=true;setTerrainModeUi(true);");
  assert(shown.classes.has("terrain-3d"),"the first frame reveals the 3D canvas");
  const closed=run("map3dFrameReady=true;setTerrainModeUi(false);");
  assert(!closed.classes.has("terrain-3d"));
  assert.equal(closed.context.map3dFrameReady,false,"leaving 3D waits for the next first frame");
}
lidarRouteIsolation();
basemapStall();
pictureMotion();
mapGesture();
async function nativeResume(){
  const begin=html.indexOf('document.documentElement.addEventListener("csp:ready",()=>requestAnimationFrame(');
  const end=html.indexOf('/* The first map picture appears whole',begin);
  assert(begin>=0&&end>begin);
  const run=async({host,share,fail}={})=>{
    const order=[];let frame,camera;
    const context={window:{CSPNativeHost:host?{resume:host}:undefined,ClearSkiesPortalBridge:{restoreSession:async state=>{
      order.push("resume");camera=state;if(fail)throw new Error("restore failed");
    }}},document:{documentElement:{dataset:{},classList:{remove(){}},addEventListener(name,fn){if(name==="csp:ready")context.ready=fn}}},
      requestAnimationFrame:fn=>{frame=fn},initGpuTerrain(){order.push("gpu")},gpuTerrainEnabled:false,gpuTerrainLayer:null,
      $:()=>({value:"hs"}),applyTerrain(){order.push("terrain")},elevationActive:()=>false,syncElevationChecks(){},
      cspStageFirstPicture(){order.push("picture")},cspRendererReady(){order.push("renderer")},cspReleaseMap(){order.push("release")},
      console:{warn(){}},Promise,cspShareCameraPending:!!share,cspNativeCameraPending:true};
    vm.runInNewContext(html.slice(begin,end),context);
    context.ready();frame();
    for(let i=0;i<8;i++)await Promise.resolve();
    return {order,pending:context.cspNativeCameraPending,camera};
  };
  const recovered=await run({host:{center:[47.5,-122.1],zoom:11,mode:"2d"}});
  assert.deepEqual(recovered.order,["resume","gpu","terrain","picture","renderer"],"the recovered camera is applied before the first picture");
  assert.equal(recovered.pending,false,"recovery releases the pane hold once the camera exists");
  assert.equal(recovered.camera.zoom,11);
  const shared=await run({host:{center:[1,2],zoom:3,mode:"2d"},share:true});
  assert.deepEqual(shared.order,["gpu","terrain","picture","renderer"],"a shared link keeps its own camera ahead of the recovered one");
  assert.equal(shared.camera,undefined);
  assert.equal(shared.pending,false);
  const failed=await run({host:{center:[1,2],zoom:4,mode:"2d"},fail:true});
  assert.deepEqual(failed.order,["resume","gpu","terrain","picture","renderer"],"a failed recovery still starts the picture");
  assert.equal(failed.pending,false);
}
/* The white start-up screen with the maple holds until the shell is up and the
   first picture is whole, then lifts once; a failure or the 8 s cap lifts it too. */
async function startupScreen(){
  const settle=f=>f.context.window.CSPBoot.settlePicture();
  {
    const f=fixture(),s=f.context.window.CSPBoot.splash;let lifted=false,events=0;s.lifted.then(()=>lifted=true);
    assert(f.classes.has('csp-splash')&&f.classes.has('csp-map-staging'),'the start-up screen is up from the first frame');
    f.rootEvents['csp:splash']=()=>events++;
    settle(f);assert(!s.done,'nothing lifts it before the shell is up');
    f.rootEvents['csp:ready']();assert(f.classes.has('csp-reveal'),'the shell reveals under the start-up screen');
    assert(!s.done,'a staged map keeps the start-up screen up after the shell reveal');
    f.classes.delete('csp-map-staging');f.classes.add('csp-terrain-pending');settle(f);
    assert(!s.done,'held-back terrain keeps it up');
    f.classes.delete('csp-terrain-pending');settle(f);
    assert(s.done&&f.classes.has('csp-splash-out'),'a whole first picture lifts it');
    await Promise.resolve();assert(lifted,'the lift is announced to the iOS shell');assert.equal(events,1);
    let disposed=0;s.dispose=()=>disposed++;
    for(const [id,t] of [...f.timers])if(t.ms===680){t.fn();f.timers.delete(id)}
    assert(!f.classes.has('csp-splash')&&!f.classes.has('csp-splash-out')&&disposed===1,'after its fade the screen is gone and the tree lets go of its GL context');
    s.finish();assert.equal(events,1,'it lifts once');
  }
  {
    const f=fixture(),s=f.context.window.CSPBoot.splash;let now=1000;f.context.Date={now:()=>now};
    f.rootEvents['csp:ready']();s.tree();now+=200;
    f.classes.delete('csp-map-staging');settle(f);
    assert(!s.done,'a tree that has only just come up is not snatched away');
    const wait=[...f.timers.values()].find(t=>t.ms===300);assert(wait,'the lift waits out the rest of half a second');
    now+=300;wait.fn();assert(s.done);
  }
  {
    const f=fixture(),s=f.context.window.CSPBoot.splash;let endFade,disposed=0,removed=0;
    f.nodes.cspSplash={parentNode:{removeChild(){removed++}},animate(frames,options){
      assert.equal(frames[0].opacity,1);assert.equal(frames[1].opacity,0);
      assert.equal(options.duration,650);
      return {finished:new Promise(resolve=>endFade=resolve)};
    }};
    s.dispose=()=>disposed++;
    f.rootEvents['csp:ready']();f.classes.delete('csp-map-staging');settle(f);
    for(const [id,t] of [...f.timers])if(t.ms<12000){t.fn();f.timers.delete(id)}
    assert(f.classes.has('csp-splash')&&removed===0&&disposed===0,'a busy first map frame cannot remove the splash before the compositor finishes its fade');
    endFade();await Promise.resolve();
    assert(!f.classes.has('csp-splash')&&removed===1&&disposed===1,'the completed fade removes the cover and releases the animated tree');
  }
  {
    const f=fixture(),s=f.context.window.CSPBoot.splash;let now=1000;f.context.Date={now:()=>now};
    f.rootEvents['csp:ready']();s.tree(1800);now+=600;
    f.classes.delete('csp-map-staging');settle(f);
    assert(!s.done,'a fast map still gives the growing tree time to draw');
    const wait=[...f.timers.values()].find(t=>t.ms===1200);assert(wait);
    now+=1200;wait.fn();assert(s.done,'growth finishes without adding a wait to a slower map');
  }
  {
    const f=fixture(),s=f.context.window.CSPBoot.splash;let now=1000;f.context.Date={now:()=>now};
    f.classes.add('csp-reduce-motion');
    f.nodes.cspSplash={animate(){assert.fail('Reduce Motion skips the animated transition')}};
    f.rootEvents['csp:ready']();s.tree(1800);now+=500;
    f.classes.delete('csp-map-staging');settle(f);
    assert(s.done,'Reduce Motion does not wait for the growing-tree animation');
    assert([...f.timers.values()].some(t=>t.ms===0),'Reduce Motion removes the cover immediately');
  }
  {
    const f=fixture(),s=f.context.window.CSPBoot.splash;
    f.context.window.CSPBoot.fail('broken');
    assert(s.done,'a start-up failure lifts it at once, so the message and Reload show');
  }
  {
    const f=fixture(),s=f.context.window.CSPBoot.splash;
    f.rootEvents['csp:ready']();
    [...f.timers.values()].find(t=>t.ms===8000).fn();
    assert(s.done,'nothing holds it past 8 s');
  }
  const nativeShell=fs.readFileSync('ios/Resources/native-shell.js','utf8');
  assert.match(nativeShell,/splash\?\.lifted\)\.then\(\(\) => handler\.postMessage\(\{type: "ready"\}\)/,'the native controls appear as the start-up screen lifts');
  assert.match(nativeShell,/postMessage\(\{type: "splash"\}\)/,'the native cover gives way once the start-up screen has painted');
  const rootView=fs.readFileSync('ios/Sources/App/RootView.swift','utf8');
  assert(rootView.includes('(!portal.ready && !portal.splashUp) || portal.startupFailure != nil'),'the white native cover stays only until the page\'s start-up screen is up');
}
map3dTheme();
Promise.all([startupScreen(),retryBeforeLoad(),workerCache(),revealHold(),gpuStartup(),gpuPicture(),studioPublication(),splashManifest(),nativeResume()]).then(()=>console.log('UI startup checks passed (recovery, coherent valid terrain, stale readbacks, bounded shell, exact offline assets, LiDAR menu isolation)')).catch(e=>{console.error(e);process.exitCode=1});
