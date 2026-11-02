#!/usr/bin/env node
'use strict';
/* Real client layer and scheduler; fixed provider costs and a virtual clock.
   The bounded DNR service below measures admission, not a live engine speed. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{elevationLayer}=require('../../test-fixtures/elevation-layer');
const root=path.resolve(__dirname,'../..'),tick=()=>new Promise(resolve=>setImmediate(resolve));
const baseline=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11),output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
const code=(file,ref)=>ref?execFileSync('git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8');
const canvas=()=>({width:2,height:2,dataset:{},getContext:()=>({clearRect(){}})});
class Clock{
  constructor(){this.now=0;this.id=0;this.events=new Map();}
  set(fn,ms){const id=++this.id;this.events.set(id,{at:this.now+ms,fn});return id;}
  clear(id){this.events.delete(id);}
  async drain(){for(let i=0;i<10000;i++){
    await tick();if(!this.events.size)return;
    const [id,event]=[...this.events].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
    this.events.delete(id);this.now=event.at;event.fn();
  }throw Error('mixed-source workload did not drain');}
}
function setup(ref,serve,capacity=Infinity){
  const clock=new Clock(),source=code('app/elevation.js',ref),env={module:{exports:{}},AbortController,queueMicrotask,
    Date:class extends Date{static now(){return clock.now;}},setTimeout:(fn,ms)=>clock.set(fn,ms),clearTimeout:id=>clock.clear(id)};
  vm.runInNewContext(code('tile-pipeline.js',ref),env);
  const declaration=source.slice(source.indexOf('const elevationRequests='),source.indexOf(';',source.indexOf('const elevationRequests='))+1);
  const poolEnv={CSPTilePipeline:env.module.exports};vm.runInNewContext(declaration+';this.pool=elevationRequests;',poolEnv);
  const pool=poolEnv.pool,stats={requests:0,completed:0,cancelled:0,sourceWorkMs:0,maxOutstanding:0,maxServiceQueued:0};
  const calls=[],queue=[];let running=0,outstanding=0;
  const pump=()=>{
    while(running<capacity&&queue.length){
      const job=queue.shift();job.running=true;running++;
      job.timer=clock.set(()=>{running--;job.finish();job.error?job.reject(Error(job.error)):job.resolve(job.values?{
        width:Math.sqrt(job.values.length),height:Math.sqrt(job.values.length),grid:new Float32Array(job.values)}:null);pump();},job.ms);
    }
    stats.maxServiceQueued=Math.max(stats.maxServiceQueued,queue.length);
  };
  const context=elevationLayer({source,pool,hidpi:true,globals:{setTimeout:env.setTimeout,clearTimeout:env.clearTimeout},
    fetchElevation:(url,signal)=>new Promise((resolve,reject)=>{
      calls.push(url);const job={url,resolve,reject,...serve(url,calls)},start=clock.now;
      stats.requests++;outstanding++;stats.maxOutstanding=Math.max(stats.maxOutstanding,outstanding);
      job.finish=()=>{outstanding--;stats.sourceWorkMs+=clock.now-start;signal.removeEventListener('abort',abort);stats.completed++;};
      const abort=()=>{
        if(job.running){running--;clock.clear(job.timer);}else queue.splice(queue.indexOf(job),1);
        job.finish();stats.completed--;stats.cancelled++;reject(Object.assign(Error('Aborted'),{name:'AbortError'}));pump();
      };
      signal.addEventListener('abort',abort,{once:true});queue.push(job);pump();
    })});
  return {clock,pool,context,stats,calls};
}
async function mixed(ref,partial=true,nationalSharpMs=100){
  const h=setup(ref,url=>{
    const raw=url.startsWith('/raw/'),sharp=url.includes('/17/');
    return {ms:raw?100:url.startsWith('/national/')?(sharp?nationalSharpMs:2000):5000,values:raw?(partial?(sharp?[60,NaN,60,NaN]:Array.from({length:64},(_,i)=>i%4===0?50:NaN)):
      new Array(sharp?4:64).fill(sharp?60:50)):new Array(4).fill(sharp?25:20)};
  }),layer=new h.context.Layer({tileSize:2,rawEndpoint:'/raw',nationalEndpoint:'/national',fallback:'/base/{z}/{x}/{y}',
    rawNativeZoom:18,nationalNativeZoom:17,fallbackNativeZoom:15});
  const sharpRaw=new Set();let firstPaint=null,allCovered=null,firstSharp=null,allRawSharp=null,allSamplesSharp=null,settled=null;
  layer._paint=(cv,grid,c)=>{
    if(grid[0]===60){sharpRaw.add(`${c.x}/${c.y}`);firstSharp??=h.clock.now;if(sharpRaw.size===36)allRawSharp??=h.clock.now;}
    if(layer._store.size===36&&[...layer._store.values()].every(t=>[...t.elev].every(Number.isFinite)))allCovered??=h.clock.now;
    if(layer._store.size===36&&[...layer._store.values()].every(t=>[...t.elev].every(v=>v===60||v===25)))allSamplesSharp??=h.clock.now;
  };
  const jobs=Array.from({length:36},(_,i)=>layer._loadTile({z:17,x:100+i%6,y:100+Math.floor(i/6)},canvas(),()=>{firstPaint??=h.clock.now;}));
  const loaded=Promise.all(jobs).then(()=>{settled=h.clock.now;});await h.clock.drain();await loaded;
  const tiles=[...layer._store.values()],sharp=tiles.flatMap(t=>[...t.elev]).filter(v=>v===60||v===25).length;
  assert.equal(h.pool.active,0);assert.equal(h.pool.queue.length,0);assert.equal(tiles.length,36);
  for(const tile of tiles){assert.equal(tile.elev[0],60);assert.equal(tile.elev[2],60);assert.equal(tile.cv._cspRefining,false);}
  return {tiles:36,nationalSharpCostMs:nationalSharpMs,firstPaintMs:firstPaint,allCoveredMs:allCovered,firstRawSharpMs:firstSharp,allRawSharpMs:allRawSharp,allSamplesSharpMs:allSamplesSharp,
    finalSharpPercent:100*sharp/144,settledMs:settled,nationalSharpRequests:h.calls.filter(u=>u.startsWith('/national/17/')).length,...h.stats};
}
async function provider(ref){
  const h=setup(ref,url=>{const sharp=url.includes('/17/');return {ms:sharp?1000:100,values:new Array(sharp?4:16).fill(sharp?60:50)};},2);
  const layer=new h.context.Layer({tileSize:2,dnrEndpoint:'/dnr'});let firstPaint=null,allPaint=null,painted=0,firstSharp=null,finished=null;
  layer._paint=(cv,grid)=>{if(grid[0]===60)firstSharp??=h.clock.now;};
  const jobs=Array.from({length:36},(_,i)=>layer._loadTile({z:17,x:100+i%6,y:100+Math.floor(i/6)},canvas(),()=>{
    firstPaint??=h.clock.now;if(++painted===36)allPaint=h.clock.now;
  }));
  const loaded=Promise.all(jobs).then(()=>{finished=h.clock.now;});await h.clock.drain();await loaded;
  assert.equal(h.pool.active,0);assert.equal(h.pool.queue.length,0);
  for(const tile of layer._store.values())assert([...tile.elev].every(v=>v===60));
  return {tiles:36,serviceCapacity:2,firstPaintMs:firstPaint,allPaintMs:allPaint,firstSharpMs:firstSharp,allSharpMs:finished,...h.stats};
}
async function recovery(ref){
  const h=setup(ref,(url,calls)=>({ms:url.startsWith('/raw/')?100:50,values:new Array(4).fill(url.startsWith('/raw/')?60:20),
    error:url.startsWith('/raw/')&&calls.filter(u=>u.startsWith('/raw/')).length===1?'short retries exhausted':null}));
  const layer=new h.context.Layer({tileSize:2,hiDpi:false,rawEndpoint:'/raw',nationalEndpoint:'/national'}),cv=canvas();
  let firstPaint=null,recovered=null;layer._paint=(cv,grid)=>{if(grid[0]===60)recovered=h.clock.now;};
  const loaded=layer._loadTile({z:16,x:4,y:4},cv,()=>{firstPaint??=h.clock.now;});
  await h.clock.drain();await loaded;assert.equal(h.pool.active,0);
  return {firstPaintMs:firstPaint,recoveredMs:recovered,finalElevation:layer._store.get('16/4/4').elev[0],...h.stats};
}
const guard=setTimeout(()=>{throw Error('mixed-source workload timed out');},10000);
(async()=>{
  const run=async ref=>({mixedView:await mixed(ref),slowNationalControl:await mixed(ref,true,2000),fullDetailControl:await mixed(ref,false),providerAdmission:await provider(ref),stationaryRecovery:await recovery(ref)});
  const report={workload:'mixed-source-refinement',baselineRef:baseline||null,
    notes:'Actual client layer/pool, virtual clock and fixed costs. DNR service has two simulated slots. Not live provider or device timings.'};
  if(baseline)report.before=await run(baseline);report.after=await run();
  assert.equal(report.after.mixedView.finalSharpPercent,100);assert.equal(report.after.providerAdmission.maxOutstanding,2);
  assert.equal(report.after.providerAdmission.maxServiceQueued,0);assert.equal(report.after.stationaryRecovery.finalElevation,60);
  if(baseline){
    assert.equal(report.before.mixedView.finalSharpPercent,50);assert.equal(report.before.mixedView.allSamplesSharpMs,null);
    assert.equal(report.after.mixedView.firstPaintMs,report.before.mixedView.firstPaintMs);
    assert.equal(report.after.mixedView.firstRawSharpMs,report.before.mixedView.firstRawSharpMs);
    assert.equal(report.after.slowNationalControl.allCoveredMs,report.before.slowNationalControl.allCoveredMs);
    assert.equal(report.after.slowNationalControl.finalSharpPercent,100);
    assert.deepEqual(report.after.fullDetailControl,report.before.fullDetailControl);
    assert.equal(report.after.fullDetailControl.nationalSharpRequests,0);
    assert(report.after.providerAdmission.maxOutstanding<report.before.providerAdmission.maxOutstanding);
    assert(report.after.providerAdmission.allPaintMs<report.before.providerAdmission.allPaintMs);
    assert.equal(report.after.providerAdmission.allSharpMs,report.before.providerAdmission.allSharpMs);
    assert.equal(report.before.stationaryRecovery.recoveredMs,null);
  }
  const json=JSON.stringify(report,null,2)+'\n';if(output)fs.writeFileSync(path.resolve(root,output),json);process.stdout.write(json);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(guard));
