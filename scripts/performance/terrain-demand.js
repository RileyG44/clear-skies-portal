#!/usr/bin/env node
'use strict';
/* Actual client schedulers with deterministic source costs. Compare revisions
   without checking them out or contacting a provider. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{elevationLayer}=require('../../test-fixtures/elevation-layer');
const root=path.resolve(__dirname,'../..'),tick=()=>new Promise(r=>setImmediate(r));
const baseline=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11),output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
const code=(file,ref)=>ref?execFileSync('git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8');
class Clock{
  constructor(){this.now=0;this.id=0;this.events=new Map();}
  set(fn,ms){const id=++this.id;this.events.set(id,{at:this.now+ms,fn});return id;}
  clear(id){this.events.delete(id);}
  async drain(){for(let i=0;i<10000;i++){
    await tick();if(!this.events.size)return;
    const [id,e]=[...this.events].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];this.events.delete(id);this.now=e.at;e.fn();
  }throw Error('workload did not drain');}
}
function setup(ref){
  const clock=new Clock(),stats={started:0,completed:0,cancelled:0,sourceWorkMs:0},starts=[];
  const globals={AbortController,queueMicrotask,console,Date:class extends Date{static now(){return clock.now;}},
    setTimeout:(fn,ms)=>clock.set(fn,ms),clearTimeout:id=>clock.clear(id)};
  const load=file=>{const c={...globals,module:{exports:{}}};vm.runInNewContext(code(file,ref),c,{filename:file});return c.module.exports;};
  const pipeline=load('tile-pipeline.js');
  const fetch=(url,signal,ms,values=[30,30,30,30])=>new Promise((resolve,reject)=>{
    const start=clock.now;stats.started++;starts.push(url);
    const finish=()=>{stats.sourceWorkMs+=clock.now-start;signal.removeEventListener('abort',abort);};
    const id=clock.set(()=>{finish();stats.completed++;resolve({width:Math.sqrt(values.length),height:Math.sqrt(values.length),grid:new Float32Array(values)});},ms);
    const abort=()=>{clock.clear(id);finish();stats.cancelled++;reject(Object.assign(Error('Aborted'),{name:'AbortError'}));};
    signal.addEventListener('abort',abort,{once:true});
  });
  return {clock,stats,starts,load,pipeline,fetch};
}
async function ownership(ref){
  const {clock,stats,pipeline,fetch}=setup(ref),pool=new pipeline.RequestPool({concurrency:1});
  const background=new AbortController(),foreground=new AbortController();let visibleAt=null;
  const old=pool.request('shared',s=>fetch('shared',s,100),{signal:background.signal,priority:1,group:'backdrop',background:true});
  const visible=pool.request('shared',s=>fetch('shared',s,100),{signal:foreground.signal,priority:5,group:'detail'}).then(()=>{visibleAt=clock.now;});
  // One background owner updates its position; a separate visible owner must
  // retain its own foreground priority and real source group.
  pool.prioritize('shared',.5,{signal:background.signal,group:'backdrop',background:true});
  const other=pool.request('other',s=>fetch('other',s,5000),{priority:4,group:'detail'});
  await clock.drain();await Promise.all([old,visible,other]);assert.equal(pool.active,0);
  return {visibleSharedMs:visibleAt,...stats};
}
async function standIn(ref){
  const {clock,stats,pipeline,fetch,load}=setup(ref),pool=new pipeline.RequestPool({concurrency:20,groupLimits:{detail:10}});
  const {ElevationTileStore}=load('gpu-terrain-store.js');
  const spec={id:'raw',rank:3,label:'raw',nativeZoom:18,standIn:2,group:'detail',url:(z,x,y)=>`raw/${z}/${x}/${y}`};
  const tiles=Array.from({length:16},(_,i)=>({z:16,x:100+i%4,y:100+Math.floor(i/4)}));
  let fine=0,detailAt=null,refinementDoneAt=null;
  const store=new ElevationTileStore({sources:[spec],request:(url,o)=>pool.request(url,s=>fetch(url,s,url.startsWith('raw/14/')?5000:100),o)});
  store.on('tile',r=>{if(r.z===16&&++fine===tiles.length)detailAt=clock.now;});
  store.on('settled',()=>{if(!store.settled().refining)refinementDoneAt??=clock.now;});
  const initial=store.want(tiles);await clock.drain();await initial;
  const beforeRevisit=stats.started,revisit=store.want(tiles);await clock.drain();await revisit;
  assert.equal(store.settled().ratio,1);assert.equal(pool.active,0);
  const result={visibleTiles:16,allDetailMs:detailAt,refinementDoneMs:refinementDoneAt,revisitRequests:stats.started-beforeRevisit,...stats};store.destroy();return result;
}
async function cpu(ref,partial=true,sourceSlots){
  const {clock,stats,load,pipeline,fetch}=setup(ref),source=code('app/elevation.js',ref);
  // Use the production capacities, rather than a separately tuned pool.
  const declaration=source.slice(source.indexOf('const elevationRequests='),source.indexOf(';',source.indexOf('const elevationRequests='))+1);
  const env={CSPTilePipeline:pipeline};vm.runInNewContext(declaration+';this.pool=elevationRequests;',env);const pool=env.pool;
  if(sourceSlots)pool.concurrency=sourceSlots;
  const c=elevationLayer({source,pool,hidpi:true,fetchElevation:(url,signal)=>{
    const sharp=url.startsWith('/raw/17/'),raw=url.startsWith('/raw/');
    return fetch(url,signal,raw?100:url.startsWith('/national/')?2000:5000,
      raw?(partial?(sharp?[60,NaN,60,NaN]:Array.from({length:64},(_,i)=>i%4===0?50:NaN)):new Array(sharp?4:64).fill(sharp?60:50)):[20,20,20,20]);
  }}),layer=new c.Layer({tileSize:2,rawEndpoint:'/raw',nationalEndpoint:'/national',fallback:'/base/{z}/{x}/{y}'});
  const seen=new Set();let firstSharp=null,lastSharp=null,firstPaint=null,settledAt=null;
  layer._paint=(cv,grid,coords)=>{if(grid[0]===60){seen.add(`${coords.x}/${coords.y}`);firstSharp??=clock.now;if(seen.size===36)lastSharp??=clock.now;}};
  const jobs=Array.from({length:36},(_,i)=>layer._loadTile({z:17,x:100+i%6,y:100+Math.floor(i/6)},{width:2,height:2,dataset:{}},()=>{firstPaint??=clock.now;}));
  const loaded=Promise.all(jobs).then(()=>{settledAt=clock.now;});await clock.drain();await loaded;
  assert.equal(seen.size,36);assert.equal(pool.active,0);assert.equal(pool.queue.length,0);
  for(const tile of layer._store.values()){
    assert.deepEqual([...tile.elev],partial?[60,20,60,20]:[60,60,60,60]);
    assert.equal(tile.cv._cspRefining,false);assert.equal(tile.cv._cspRefineFailed,false);
  }
  return {visibleTiles:36,sourceSlots:pool.concurrency,firstPaintMs:firstPaint,firstSharpMs:firstSharp,allSharpMs:lastSharp,settledMs:settledAt,...stats};
}
const guard=setTimeout(()=>{throw Error('terrain-demand workload did not finish');},10000);
(async()=>{
  const run=async ref=>({sharedOwnership:await ownership(ref),obsoleteStandIn:await standIn(ref),constrainedCpuView:await cpu(ref,true,8),partialCpuControl:await cpu(ref),fullCpuControl:await cpu(ref,false)});
  const report={workload:'terrain-demand',baselineRef:baseline||null,notes:'Actual schedulers, virtual clock and fixed source costs. Controlled ownership/queue measurements; not provider or device latency.'};
  if(baseline)report.before=await run(baseline);report.after=await run();
  if(baseline){
    assert(report.after.sharedOwnership.visibleSharedMs<report.before.sharedOwnership.visibleSharedMs);
    assert(report.after.obsoleteStandIn.sourceWorkMs<report.before.obsoleteStandIn.sourceWorkMs);
    assert(report.after.constrainedCpuView.allSharpMs<report.before.constrainedCpuView.allSharpMs,JSON.stringify(report));
    assert.equal(report.after.constrainedCpuView.firstPaintMs,report.before.constrainedCpuView.firstPaintMs);
    assert(report.after.constrainedCpuView.settledMs<=report.before.constrainedCpuView.settledMs,'sharpening must not delay necessary gap filling');
    assert.deepEqual(report.after.partialCpuControl,report.before.partialCpuControl);
    assert.deepEqual(report.after.fullCpuControl,report.before.fullCpuControl);
  }
  const json=JSON.stringify(report,null,2)+'\n';if(output)fs.writeFileSync(path.resolve(root,output),json);process.stdout.write(json);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>clearTimeout(guard));
