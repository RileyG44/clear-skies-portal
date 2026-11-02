#!/usr/bin/env node
'use strict';
/* Fixed-cost scheduling workloads run the actual CPU layer, native GPU store
   and request pool. No provider, browser or live cache timing claims. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{elevationLayer}=require('../../test-fixtures/elevation-layer');
const root=path.resolve(__dirname,'../..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const baseline=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11);
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
const code=(file,ref)=>ref?execFileSync('git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8');
class Clock{
  constructor(){this.now=0;this.id=0;this.events=new Map();}
  set(fn,ms){const id=++this.id;this.events.set(id,{at:this.now+ms,fn});return id;}
  clear(id){this.events.delete(id);}
  async drain(){
    for(let i=0;i<10000;i++){
      await tick();if(!this.events.size)return;
      const [id,e]=[...this.events].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      this.events.delete(id);this.now=e.at;e.fn();
    }
    throw Error('workload did not drain');
  }
}
function setup(ref,concurrency=20){
  const clock=new Clock(),stats={started:0,completed:0,cancelled:0,sourceWorkMs:0};
  const globals={module:{exports:{}},AbortController,queueMicrotask,console,
    Date:class extends Date{static now(){return clock.now;}},setTimeout:(fn,ms)=>clock.set(fn,ms),clearTimeout:id=>clock.clear(id)};
  const load=file=>{const context={...globals,module:{exports:{}}};vm.runInNewContext(code(file,ref),context,{filename:file});return context.module.exports;};
  const {RequestPool}=load('tile-pipeline.js'),pool=new RequestPool({concurrency});
  const fetch=(url,signal,ms,values)=>new Promise((resolve,reject)=>{
    const start=clock.now;stats.started++;
    const finish=()=>{stats.sourceWorkMs+=clock.now-start;signal.removeEventListener('abort',abort);};
    const id=clock.set(()=>{finish();stats.completed++;resolve({width:Math.sqrt(values.length),height:Math.sqrt(values.length),grid:new Float32Array(values)});},ms);
    const abort=()=>{clock.clear(id);finish();stats.cancelled++;reject(Object.assign(Error('Aborted'),{name:'AbortError'}));};
    signal.addEventListener('abort',abort,{once:true});
  });
  return {clock,stats,pool,fetch,load};
}
async function cpu(ref,hidpi){
  const {clock,stats,pool,fetch}=setup(ref);let finestAt=null,settledAt=null;
  const context=elevationLayer({source:code('app/elevation.js',ref),pool,hidpi,fetchElevation:(url,signal)=>{
    const sharp=url.startsWith('/raw/17/'),raw=url.startsWith('/raw/');
    // Partial detail keeps national fallback necessary in the sharpening case.
    return fetch(url,signal,sharp?80:raw?100:url.startsWith('/national/')?2000:5000,
      raw?(hidpi?(sharp?[60,NaN,60,NaN]:Array.from({length:16},(_,i)=>i%4===0?50:NaN)):[50,50,50,50]):[10,10,10,10]);
  }});
  const layer=new context.Layer({tileSize:2,rawEndpoint:'/raw',nationalEndpoint:'/national',fallback:'/base/{z}/{x}/{y}'});
  layer._paint=(canvas,grid)=>{if(grid[0]===60)finestAt??=clock.now;};
  const canvas={width:2,height:2,dataset:{}};
  const loaded=layer._loadTile({z:hidpi?17:16,x:4,y:4},canvas,()=>{}).then(()=>{settledAt=clock.now;});
  await clock.drain();await loaded;
  assert.equal(canvas._cspRefining,false);assert.equal(pool.active,0);assert.equal(pool.queue.length,0);
  assert.equal(canvas._cspRefineFailed,false);
  assert.deepEqual([...layer._store.values()][0].elev,hidpi?new Float32Array([60,10,60,10]):new Float32Array([50,50,50,50]));
  return {...(hidpi?{finestDetailMs:finestAt}:{}),settledMs:settledAt,...stats};
}
async function gpu(ref,partial=false){
  const {clock,stats,pool,fetch,load}=setup(ref),{ElevationTileStore}=load('gpu-terrain-store.js');
  const source=(id,rank)=>({id,rank,label:id,nativeZoom:18,url:(z,x,y)=>`${id}/${z}/${x}/${y}`});
  const store=new ElevationTileStore({sources:[source('preferred',6),source('raw',3)],request:(url,o)=>pool.request(url,s=>
    fetch(url,s,url.startsWith('preferred')?100:5000,url.startsWith('preferred')?[60,partial?NaN:60,60,partial?NaN:60]:[30,30,30,30]),o)});
  let settledAt=null;const loaded=store.want([{z:16,x:4,y:4}]).then(()=>{settledAt=clock.now;});
  await clock.drain();await loaded;
  assert.equal(store.settled().refining,false);assert.equal(store.settled().ratio,1);assert.equal(pool.active,0);
  const result={settledMs:settledAt,...stats};store.destroy();return result;
}
async function viewport(ref){
  const {clock,stats,pool,fetch,load}=setup(ref,6),{ElevationTileStore}=load('gpu-terrain-store.js');
  const source=(id,rank)=>({id,rank,label:id,nativeZoom:18,url:(z,x,y)=>`${id}/${z}/${x}/${y}`});
  const store=new ElevationTileStore({sources:[source('preferred',6),source('raw',3)],request:(url,o)=>pool.request(url,s=>
    fetch(url,s,url.startsWith('preferred')?100:5000,url.startsWith('preferred')?[60,60,60,60]:[30,30,30,30]),o)});
  const tiles=Array.from({length:36},(_,i)=>({z:16,x:100+i%6,y:100+Math.floor(i/6)}));
  let finished=0,detailAt=null,settledAt=null;
  store.on('tile',r=>{if(r.sourceId==='preferred'&&++finished===tiles.length)detailAt=clock.now;});
  const loaded=store.want(tiles).then(()=>{settledAt=clock.now;});await clock.drain();await loaded;
  assert.equal(finished,36);assert.equal(store.settled().ratio,1);assert.equal(pool.active,0);assert.equal(pool.queue.length,0);
  const result={visibleTiles:36,sourceSlots:6,allPreferredDetailMs:detailAt,settledMs:settledAt,...stats};store.destroy();return result;
}
(async()=>{
  const run=async ref=>({cpuSharpening:await cpu(ref,true),cpuRedundantFallback:await cpu(ref,false),gpuRedundantLidar:await gpu(ref),gpuPartialControl:await gpu(ref,true),constrainedViewport:await viewport(ref)});
  const report={workload:'progressive-refinement',baselineRef:baseline||null,notes:'Virtual clock, actual production schedulers, fixed 100 ms preferred / 2–5 s fallback costs. These measure scheduling and eliminated work, not live provider/device speed.'};
  if(baseline)report.before=await run(baseline);report.after=await run();
  if(baseline){
    assert(report.after.cpuSharpening.finestDetailMs<report.before.cpuSharpening.finestDetailMs);
    for(const name of ['cpuRedundantFallback','gpuRedundantLidar']){
      assert(report.after[name].settledMs<report.before[name].settledMs);assert(report.after[name].sourceWorkMs<report.before[name].sourceWorkMs);
    }
    assert(report.after.constrainedViewport.allPreferredDetailMs<report.before.constrainedViewport.allPreferredDetailMs);
    assert.deepEqual(report.after.gpuPartialControl,report.before.gpuPartialControl,'partial coverage must keep the needed lower request');
  }
  const json=JSON.stringify(report,null,2)+'\n';if(output)fs.writeFileSync(path.resolve(root,output),json);process.stdout.write(json);
})().catch(error=>{console.error(error);process.exitCode=1;});
