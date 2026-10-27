'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const between=(start,end)=>{
  const at=html.indexOf(start);assert(at>=0,`missing ${start}`);
  const stop=html.indexOf(end,at+start.length);assert(stop>at,`missing ${end}`);
  return html.slice(at,stop);
};
const elements=()=>{
  const nodes=new Map();
  return {get:id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,hidden:false,textContent:'',attributes:{},listeners:{},
      addEventListener(type,handler){this.listeners[type]=handler},
      dispatchEvent(event){this.listeners[event.type]?.(event)},
      setAttribute(name,value){this.attributes[name]=String(value)},removeAttribute(name){delete this.attributes[name]},dataset:{},focus(){}});
    return nodes.get(id);
  }};
};
function spanChecks(){
  const nodes=elements(),context={$:nodes.get,document:{activeElement:null},Event:class {constructor(type){this.type=type}},
    scheduleElevPaint(){context.paints++},saveTerrainPrefs(){context.saves++},applyElev(){context.paints++},paints:0,saves:0};
  vm.createContext(context);
  vm.runInContext(between('function elevSpanPosition(', 'function elevSpanMetres(')+
    between('$("#elevSpan").addEventListener("input"', '$("#elevAlpha").addEventListener("input"'),context);
  const number=nodes.get('#elevSpan'),slider=nodes.get('#elevSpanSlide');
  number.value=1200;number.dispatchEvent(new context.Event('input'));
  assert.equal(slider.value,630);assert.equal(slider.attributes['aria-valuetext'],'1,200 feet');
  number.value=49;number.dispatchEvent(new context.Event('input'));
  assert.equal(number.value,49,'numeric entry preserves an exact value near a preset');
  context.document.activeElement=slider;
  slider.value=0;slider.dispatchEvent(new context.Event('input'));assert.equal(number.value,10);
  slider.value=1000;slider.dispatchEvent(new context.Event('input'));assert.equal(number.value,20000);
  slider.value=630;slider.dispatchEvent(new context.Event('input'));assert.equal(number.value,1200);
  slider.value=447;slider.dispatchEvent(new context.Event('input'));assert.equal(number.value,300);
  slider.value=448;slider.dispatchEvent(new context.Event('input'));
  assert.equal(slider.value,448,'keyboard steps must not be reset into a preset snap trap');
  slider.dispatchEvent(new context.Event('change'));assert.equal(context.saves,1,'slider release persists the source number');
  let previous=0;
  for(let position=0;position<=1000;position++){
    const feet=context.elevSpanFromPosition(position);assert(feet>=previous,'span never reverses direction');previous=feet;
  }
  const panel=between('<div class="terdl dnr-module" id="dnrAreaPanel">','</section>');
  assert.equal((panel.match(/<button/g)||[]).length,3,'the module contains Select, current-view download and housekeeping Clear');
  assert(panel.includes('id="dnrViewport"'),'viewport download is separate from selection');
  assert(!panel.includes('id="dnrFetch"'),'download confirmation belongs on the map');
  assert(between('<div id="dnrSelectionBar"','<section id="ctl"').includes('id="dnrFetch"'),'map toolbar owns confirmation');
}
const reply=value=>({ok:true,json:async()=>value});
function dnrFixture(){
  const nodes=elements(),timers=new Map(),requests=[],messages=[],stops=[],removed=[],events=[],keys={};let nextTimer=1;
  const classes=new Set(['dnr-selecting']);
  const bounds=values=>({getWest:()=>values[0],getSouth:()=>values[1],getEast:()=>values[2],getNorth:()=>values[3]});
  const context={$:nodes.get,document:{body:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)}},
      dispatchEvent:event=>events.push(event.type),addEventListener:(name,handler)=>{keys[name]=handler}},
    CustomEvent:class{constructor(type){this.type=type}},
    serverHealth:{features:['wadnr-job-cancel']},PROXY:true,dnrBar:nodes.get('#dnrSelectionBar'),
    dnrMoveBox:nodes.get('.dnr-move-box'),dnrSelRect:{setBounds(){}},dnrSelHandles:[{dragging:{enable(){},disable(){}},setLatLng(){}}],
    dnrAreas:[],dnrBusy:false,dnrSelBbox:[-120,47,-119.999,47.001],
    dnrDownloadBbox:null,dnrBackground:false,dnrPollNow:null,dnrStartUncertain:false,
    dnrJobId:null,dnrFetchToken:0,dnrFetchPoll:null,dnrSuccessTimer:null,dnrLargeApproved:false,
    viewport:[-120,47,-119.999,47.001],map3d:null,
    map:{getBounds:()=>bounds(context.viewport),removeLayer:layer=>removed.push(layer)},
    AbortSignal,api:x=>x,fmtMB:x=>String(x),dnrAcquisitionText:()=>'',scheduleDnrPosition(){},
    paintDnrAreas(){},saveDnrAreas(){context.saves++},resetMeshSources(){},applyTerrain(){},
    elevationActive:()=>false,applyElev(){},schedule3dStyle(){},scheduleDnrStatus(){},clears:0,saves:0,
    setTimeout(callback){const id=nextTimer++;timers.set(id,callback);return id},clearTimeout:id=>timers.delete(id),
    fetch:async(url,init)=>{
      requests.push({url,body:init?.body?JSON.parse(init.body):null});
      if(url==='/api/wadnr/warm/stop'){stops.push(JSON.parse(init.body).id);return reply({cancelled:true})}
      return context.respond(url,init);
    },respond:async url=>reply(url.endsWith('/status')?{id:'job-1',running:true,total:2,done:1}:{id:'job-1'})
  };
  vm.createContext(context);
  vm.runInContext(between('function dnrMsg(', 'function scheduleDnrPosition(')+
    between('function paintDnrAvailability(', 'function paintDnrAreas(')+
    between('function clearDnrSelection(', 'function setDnrSelection(')+
    between('async function stopDnrJob(', '$("#dnrSelect").onclick')+
    between('function dnrViewportBbox(', '$("#dnrClear").onclick'),context);
  const originalClear=context.clearDnrSelection,originalMsg=context.dnrMsg;
  context.clearDnrSelection=(...args)=>{context.clears++;return originalClear(...args)};
  context.dnrMsg=(text,state,...args)=>{messages.push({text,state});return originalMsg(text,state,...args)};
  const poll=async()=>{const entry=timers.entries().next().value;assert(entry,'a poll must be scheduled');const [id,callback]=entry;timers.delete(id);await callback()};
  const postCount=()=>requests.filter(r=>r.url==='/api/wadnr/warm').length;
  return {context,nodes,timers,messages,requests,stops,poll,removed,classes,events,keys,postCount,
    bounds,start:()=>nodes.get('#dnrFetch').onclick(),currentView:()=>nodes.get('#dnrViewport').onclick()};
}
async function dnrChecks(){
  let f=dnrFixture();await f.start();
  assert.equal(f.context.dnrBusy,true);assert.equal(f.nodes.get('#dnrCancel').disabled,false,'busy jobs retain an exit');
  await f.poll();assert.equal(f.timers.size,1,'a still-running job can be polled again');
  let resolveStatus;
  f.context.respond=()=>new Promise(resolve=>{resolveStatus=resolve});
  const late=f.poll();f.context.cancelDnrSelection();
  assert.equal(f.context.dnrBusy,false);assert.equal(f.context.dnrSelBbox,null);assert.equal(f.timers.size,0);
  assert.deepEqual(f.stops,['job-1'],'Cancel stops only the owned engine job');
  resolveStatus(reply({id:'job-1',running:false,total:2,done:2}));await late;
  assert.equal(f.context.dnrAreas.length,0,'a late completion after Cancel cannot apply an area');
  assert.equal(f.timers.size,0,'Cancel does not resurrect polling');

  f=dnrFixture();let resolveStart;
  f.context.respond=()=>new Promise(resolve=>{resolveStart=resolve});
  const starting=f.start();f.context.cancelDnrSelection();resolveStart(reply({id:'late-job'}));await starting;
  assert.deepEqual(f.stops,['late-job'],'cancel before start response stops the job once its id arrives');
  assert.equal(f.timers.size,0);assert.equal(f.context.dnrBusy,false);

  f=dnrFixture();await f.start();let rejectStop;
  f.context.fetch=(url)=>url.endsWith('/stop')?new Promise((resolve,reject)=>{rejectStop=reject}):Promise.resolve(reply({}));
  f.context.cancelDnrSelection();const messageCount=f.messages.length;
  f.context.dnrFetchToken++; // A fresh selection invalidates messages from the old stop request.
  rejectStop(new Error('offline'));await Promise.resolve();await Promise.resolve();
  assert.equal(f.messages.length,messageCount,'a failed old stop cannot overwrite a fresh selection');

  f=dnrFixture();f.context.serverHealth.features=[];await f.start();f.context.cancelDnrSelection();
  assert.deepEqual(f.stops,[],'legacy engines receive no unguarded global stop request');
  assert.equal(f.context.dnrBusy,false,'legacy engines still allow dismissing the request');

  f=dnrFixture();await f.start();
  f.context.respond=async()=>reply({id:'somebody-elses-job',running:false,total:2,done:2});await f.poll();
  assert.equal(f.context.dnrAreas.length,0,'a superseding job cannot apply the original area');
  assert.equal(f.context.dnrBusy,false);assert.equal(f.timers.size,0);

  f=dnrFixture();await f.start();
  f.context.respond=async()=>reply({id:'job-1',running:false,total:2,done:2,bytes:100});await f.poll();
  assert.equal(f.context.dnrAreas.length,1);assert.equal(f.context.saves,1,'complete jobs persist their selected area');
}
async function backgroundChecks(){
  let f=dnrFixture();await f.currentView();
  assert.equal(f.postCount(),1);assert.deepEqual(f.requests[0].body.bbox,f.context.viewport);
  assert.equal(f.context.dnrSelRect,null);assert.equal(f.context.dnrSelHandles.length,0);assert(f.removed.length>=2);
  assert.equal(f.context.dnrMoveBox.hidden,true);assert.equal(f.classes.has('dnr-selecting'),false,'download frees normal map interaction');
  assert.equal(f.context.dnrBackground,true);assert.equal(f.nodes.get('#dnrSelectionDetails').hidden,true,'background details start collapsed');
  assert(f.events.includes('csp:dnr-download'),'phone sheet can leave the map available');
  const frozen=[...f.requests[0].body.bbox];f.context.viewport=[-121,46,-120.99,46.01];
  f.context.respond=async()=>reply({id:'job-1',running:false,total:2,done:2,bytes:100});await f.poll();
  assert.deepEqual(Array.from(f.context.dnrAreas[0].bbox),frozen,'completion applies the original camera, not the moved map');
  assert.equal(f.context.saves,1);

  f=dnrFixture();f.classes.add('terrain-3d');f.context.map3d={getBounds:()=>f.bounds([-121,46,-120.999,46.001])};
  await f.currentView();assert.deepEqual(f.requests[0].body.bbox,[-121,46,-120.999,46.001],'3D uses the live camera without exiting it');
  assert(f.classes.has('terrain-3d'));

  f=dnrFixture();f.context.viewport=[-120,47,-119.85,47.1];await f.currentView();
  assert.equal(f.postCount(),0,'large current views require an explicit second action');
  assert.equal(f.context.dnrBackground,true);assert.equal(f.nodes.get('#dnrSelectionDetails').hidden,false);
  const large=[...f.context.viewport];f.context.viewport=[-121,46,-120.999,46.001];await f.start();
  assert.equal(f.postCount(),1);assert.deepEqual(f.requests[0].body.bbox,large,'confirmation uses the warned viewport');

  f=dnrFixture();f.context.PROXY=false;f.context.paintDnrAvailability();await f.currentView();
  assert.equal(f.postCount(),0);assert(f.nodes.get('#dnrSelect').disabled&&f.nodes.get('#dnrViewport').disabled);
  f=dnrFixture();f.context.viewport=[-120,84,-119,89];await f.currentView();assert.equal(f.postCount(),0,'invalid polar bounds never start');

  f=dnrFixture();await f.currentView();f.context.respond=async()=>{throw new Error('temporary offline')};await f.poll();
  assert.equal(f.context.dnrBusy,true,'status failure retains the active guard');assert.equal(f.context.dnrJobId,'job-1');
  assert.equal(f.nodes.get('#dnrFetch').textContent,'Check status');assert.equal(f.context.dnrAreas.length,0);
  await f.currentView();assert.equal(f.postCount(),1,'a second acquisition is disabled while reconnecting');
  f.context.respond=async()=>reply({id:'job-1',running:false,total:2,done:2,bytes:100});await f.start();
  assert.equal(f.postCount(),1,'Check status is GET-only');assert.equal(f.context.dnrAreas.length,1);

  f=dnrFixture();f.context.respond=async url=>{if(url.endsWith('/warm'))throw new Error('start response lost');return reply({id:'unowned',running:true,total:2,done:1})};
  await f.currentView();assert.equal(f.context.dnrBusy,true);assert.equal(f.context.dnrJobId,null);
  await f.poll();assert.equal(f.postCount(),1);assert.equal(f.context.dnrAreas.length,0,'an unowned global job cannot apply this area');
  f.context.respond=async()=>reply({id:'unowned',running:false,total:2,done:2});await f.poll();
  assert.equal(f.context.dnrBusy,false);assert.equal(f.context.dnrAreas.length,0);assert.deepEqual(f.stops,[]);

  f=dnrFixture();await f.currentView();
  f.keys.keydown({key:'Escape',preventDefault(){throw new Error('collapsed background status must not consume Escape')}});
  assert.equal(f.context.dnrBusy,true);assert.deepEqual(f.stops,[],'Escape does not cancel a background job');
  f.context.expandDnrDownload(true);let escaped=false;
  f.keys.keydown({key:'Escape',preventDefault(){escaped=true}});
  assert(escaped);assert.equal(f.nodes.get('#dnrSelectionDetails').hidden,true);assert.equal(f.context.dnrBusy,true);

  f=dnrFixture();await f.start();f.context.respond=async()=>reply({id:'job-1',running:false,total:2,done:2,bytes:100});await f.poll();
  assert.equal(f.timers.size,1);await f.currentView();
  assert.equal(f.context.dnrBar.hidden,false);assert.equal(f.timers.size,1,'new work clears the old success-dismiss timer');
}
spanChecks();dnrChecks().then(backgroundChecks).then(()=>console.log('menu control checks passed (elevation span, owned jobs, viewport/3D snapshot, background interaction, large-area confirmation, status recovery, uncertain starts and cancellation)')).catch(error=>{console.error(error);process.exitCode=1});
