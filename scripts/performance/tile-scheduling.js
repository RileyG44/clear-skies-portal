#!/usr/bin/env node
'use strict';
/* Deterministic scheduling, plus real-worker cancellation latency. No service,
   source downloads, live cache or browser. Compare any revision without editing
   a checkout: node scripts/performance/tile-scheduling.js --baseline=ed16560 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const baseline=process.argv.find(arg=>arg.startsWith('--baseline='))?.slice('--baseline='.length);
function code(file,ref){return ref?execFileSync('git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8');}
function load(file,ref,globals){
  const filename=path.join(root,file);
  if(globals){
    const context={module:{exports:{}},AbortController,queueMicrotask,console,...globals};
    vm.runInNewContext(code(file,ref),context,{filename});return context.module.exports;
  }
  const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
  mod._compile(code(file,ref),filename);return mod.exports;
}
class Clock{
  constructor(){this.now=0;this.serial=0;this.events=new Map();}
  set(fn,ms){const id=++this.serial;this.events.set(id,{at:this.now+ms,fn});return id;}
  clear(id){this.events.delete(id);}
  async drain(){
    for(let turns=0;turns<10000;turns++){
      await tick();if(!this.events.size)return;
      const [id,event]=[...this.events].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      this.events.delete(id);this.now=event.at;event.fn();
    }
    throw Error('workload did not drain');
  }
}
async function scheduling(ref){
  const clock=new Clock(),globals={Date:class extends Date{static now(){return clock.now;}},
    setTimeout:(fn,ms)=>clock.set(fn,ms),clearTimeout:id=>clock.clear(id)};
  const {RequestPool}=load('tile-pipeline.js',ref,globals),{ElevationTileStore}=load('gpu-terrain-store.js',ref,globals);
  const pool=new RequestPool({concurrency:20,groupLimits:{detail:10,national:6,overview:6,backdrop:3}});
  const sources=[{id:'raw',rank:3,label:'USGS',nativeZoom:18,standIn:2,group:'detail',url:(z,x,y)=>`raw/${z}/${x}/${y}`},
    {id:'overview',rank:1,label:'Overview',nativeZoom:15,backdrop:true,group:'overview',url:(z,x,y)=>`overview/${z}/${x}/${y}`}];
  let started=0,beforeDetail=0,detailAt=null,firstDetailAt=null,maxActive=0,prefetchBeforeDetail=0;
  const visible=new Set(),finished=new Set(),tiles=[],bounds={z:16,x0:100,x1:111,y0:100,y1:102};
  for(let y=99;y<=103;y++)for(let x=99;x<=112;x++){
    tiles.push({z:16,x,y});if(x>=100&&x<=111&&y>=100&&y<=102)visible.add(`raw/16/${x}/${y}`);
  }
  const store=new ElevationTileStore({sources,prioritize:(...args)=>pool.prioritize(...args),
    request:(url,options)=>pool.request(url,signal=>new Promise((resolve,reject)=>{
      started++;maxActive=Math.max(maxActive,pool.active);
      if(detailAt===null){beforeDetail++;if(url.startsWith('raw/16/')&&!visible.has(url))prefetchBeforeDetail++;}
      const ms=url.startsWith('raw/16/')?100:url.startsWith('raw/')?180:30;
      const id=clock.set(()=>{
        signal.removeEventListener('abort',abort);
        resolve({width:2,height:2,grid:new Float32Array([100,100,100,100])});
      },ms);
      const abort=()=>{clock.clear(id);reject(Object.assign(Error('cancelled'),{name:'AbortError'}));};
      signal.addEventListener('abort',abort,{once:true});
    }),options)});
  store.on('tile',record=>{
    if(!visible.has(record.key))return;
    finished.add(record.key);firstDetailAt??=clock.now;
    if(finished.size===visible.size)detailAt=clock.now;
  });
  try{
    store.want(tiles,{bounds});await clock.drain();await tick();
    assert.equal(finished.size,visible.size);assert.equal(pool.active,0);assert.equal(pool.queue.length,0);
    return {visibleTiles:visible.size,firstVisibleDetailMs:firstDetailAt,allVisibleDetailMs:detailAt,
      requestsBeforeVisibleDetail:beforeDetail,prefetchBeforeVisibleDetail:prefetchBeforeDetail,totalRequests:started,maxActive};
  }finally{store.destroy();}
}
async function cancellation(ref){
  const {TerrainPool}=load('terrain-pool.js',ref),terrain=load('engine/terrain.js',ref);
  const pool=new TerrainPool({cacheDir:root,size:1,jobsPerWorker:1,workerFile:path.join(root,'test-fixtures/terrain-worker.js')});
  terrain.init(pool,null);
  try{
    await pool.run('echo',{warm:true});
    const controller=new AbortController();
    const old=terrain.terrainTask('old','raw-elevation',{ms:400,value:'old'},{timeoutMs:1000},controller.signal).catch(()=>null);
    await tick();const started=performance.now();controller.abort();
    const current=await terrain.terrainTask('current','raw-elevation',{ms:10,value:'current'},{timeoutMs:1000},new AbortController().signal);
    const latency=performance.now()-started;await old;assert.equal(current,'current');
    return {abandonedRenderMs:400,currentRenderMs:10,currentViewReadyMs:+latency.toFixed(1),workerRestarts:pool.stats().restarted};
  }finally{await pool.close();}
}
(async()=>{
  const report={workload:'tile-scheduling',baselineRef:baseline||null,notes:'Scheduling times use a virtual clock and fixed source costs. Cancellation uses a real fixture worker; these are not provider or device latency claims.'};
  if(baseline)report.before={scheduling:await scheduling(baseline),cancellation:await cancellation(baseline)};
  report.after={scheduling:await scheduling(),cancellation:await cancellation()};
  if(baseline){
    assert(report.after.scheduling.allVisibleDetailMs<report.before.scheduling.allVisibleDetailMs,'visible detail did not improve');
    assert(report.after.cancellation.currentViewReadyMs<report.before.cancellation.currentViewReadyMs/2,'obsolete render still blocks current demand');
  }
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
