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
      setAttribute(name,value){this.attributes[name]=String(value)},focus(){}});
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
  const panel=between('<div class="terdl dnr-module" id="dnrAreaPanel">','<div class="terrain-subsection" id="terAppearance">');
  assert.equal((panel.match(/<button/g)||[]).length,2,'the module contains only Select and housekeeping Clear');
  assert(!panel.includes('id="dnrFetch"'),'download confirmation belongs on the map');
  assert(between('<div id="dnrSelectionBar"','<section id="ctl"').includes('id="dnrFetch"'),'map toolbar owns confirmation');
}
const reply=value=>({ok:true,json:async()=>value});
function dnrFixture(){
  const nodes=elements(),timers=new Map(),requests=[],messages=[],stops=[];let nextTimer=1;
  const context={$:nodes.get,document:{body:{classList:{remove(){}}}},
    serverHealth:{features:['wadnr-job-cancel']},PROXY:true,dnrBar:nodes.get('#dnrSelectionBar'),
    dnrMoveBox:nodes.get('.dnr-move-box'),dnrSelHandles:[],dnrAreas:[],dnrBusy:false,dnrSelBbox:[-120,47,-119.999,47.001],
    dnrJobId:null,dnrFetchToken:0,dnrFetchPoll:null,dnrSuccessTimer:null,dnrLargeApproved:false,
    AbortSignal,api:x=>x,fmtMB:x=>String(x),dnrAcquisitionText:()=>'',
    clearDnrSelection(){context.dnrSelBbox=null;context.dnrBar.hidden=true;context.clears++},
    paintDnrAreas(){},paintDnrAvailability(){},saveDnrAreas(){context.saves++},resetMeshSources(){},applyTerrain(){},
    elevationActive:()=>false,applyElev(){},schedule3dStyle(){},scheduleDnrStatus(){},
    dnrMsg:(text,state)=>messages.push({text,state}),clears:0,saves:0,
    setTimeout(callback){const id=nextTimer++;timers.set(id,callback);return id},clearTimeout:id=>timers.delete(id),
    fetch:async(url,init)=>{
      requests.push(url);
      if(url==='/api/wadnr/warm/stop'){stops.push(JSON.parse(init.body).id);return reply({cancelled:true})}
      return context.respond(url,init);
    },respond:async url=>reply(url.endsWith('/status')?{id:'job-1',running:true,total:2,done:1}:{id:'job-1'})
  };
  vm.createContext(context);
  vm.runInContext(between('function setDnrBusy(', 'function setDnrSelection(')+
    between('async function stopDnrJob(', '$("#dnrCancel").onclick')+
    between('$("#dnrFetch").onclick=async', '$("#dnrClear").onclick'),context);
  const poll=async()=>{const [id,callback]=timers.entries().next().value;timers.delete(id);await callback()};
  return {context,nodes,timers,messages,requests,stops,poll,start:()=>nodes.get('#dnrFetch').onclick()};
}
async function dnrChecks(){
  let f=dnrFixture();await f.start();
  assert.equal(f.context.dnrBusy,true);assert.equal(f.nodes.get('#dnrCancel').disabled,false,'busy jobs retain an exit');
  await f.poll();assert.equal(f.timers.size,1,'a still-running job can be polled again');
  let resolveStatus;
  f.context.respond=()=>new Promise(resolve=>{resolveStatus=resolve});
  const late=f.poll();f.context.cancelDnrSelection();
  assert.equal(f.context.dnrBusy,false);assert.equal(f.context.clears,1);assert.equal(f.timers.size,0);
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
  assert.equal(f.context.dnrBusy,false,'legacy engines still allow closing selection');

  f=dnrFixture();await f.start();
  f.context.respond=async()=>reply({id:'somebody-elses-job',running:false,total:2,done:2});await f.poll();
  assert.equal(f.context.dnrAreas.length,0,'a superseding job cannot apply the original area');
  assert.equal(f.context.dnrBusy,false);assert.equal(f.timers.size,0);

  f=dnrFixture();await f.start();
  f.context.respond=async()=>reply({id:'job-1',running:false,total:2,done:2,bytes:100});await f.poll();
  assert.equal(f.context.dnrAreas.length,1);assert.equal(f.context.saves,1,'complete jobs persist their selected area');
}
spanChecks();dnrChecks().then(()=>console.log('menu control checks passed (span, keyboard escape from snaps, persistence, map confirmation, stuck-job cancellation, late responses, ownership and completion)')).catch(error=>{console.error(error);process.exitCode=1});
