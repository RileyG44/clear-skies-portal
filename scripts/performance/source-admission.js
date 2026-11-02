#!/usr/bin/env node
'use strict';
/* Source broker and HTTPS admission, fixed costs and a virtual clock. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {sourceCode}=require('../../test-fixtures/usgs-source'),{fixture}=require('../../test-fixtures/upstream-source');
const baseline=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11),output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
function ranges(ref,readers=2){
  let now=1,id=0;const events=[],starts=[],finished=[],context={module:{exports:{}},Date:{now:()=>now}};
  vm.runInNewContext(sourceCode('terrain-ranges.js',ref),context);
  const {TerrainRangeBroker}=context.module.exports,broker=new TerrainRangeBroker({limit:24,perWorkerLimit:4});
  const workers=Array.from({length:6},(_,index)=>({postMessage:message=>{
    if(message.op!=='load')return;
    starts.push({key:message.key,at:now});broker.handle(workers[index],{kind:'terrain-range',op:'started',id:message.id});
    events.push({at:now+100,worker:workers[index],id:message.id,key:message.key});
  }}));workers.forEach((worker,i)=>broker.attach(worker,i));
  const read=(worker,key)=>broker.handle(worker,{kind:'terrain-range',op:'read',id:++id,key,a:0,b:63});
  // One render opens a broad raster window. Another render needs two ranges
  // after those reads have occupied all slots. All the original work is useful.
  for(let i=0;i<192;i++)read(workers[0],'broad-'+i);
  now=2;if(readers>1)for(let i=0;i<2;i++)read(workers[1],'small-'+i);
  while(events.length){
    events.sort((a,b)=>a.at-b.at);const event=events.shift();now=event.at;finished.push({key:event.key,at:now});
    broker.handle(event.worker,{kind:'terrain-range',op:'result',id:event.id,bytes:new SharedArrayBuffer(64)});
  }
  assert.equal(broker.stats().active,0);assert.equal(broker.stats().queued,0);
  const small=finished.filter(e=>e.key.startsWith('small')),first=starts.find(e=>e.key.startsWith('small'));
  return {globalSlots:24,readMs:100,broadRanges:192,smallRanges:small.length,
    firstSmallStartedMs:first?first.at-2:null,
    allSmallReadyMs:small.length?Math.max(...small.map(e=>e.at))-2:null,
    allBroadReadyMs:Math.max(...finished.filter(e=>e.key.startsWith('broad')).map(e=>e.at))-1,
    allWorkMs:now-1,networkReads:broker.stats().networkReads,uniqueBorrowers:broker.stats().workers.filter(w=>w.reads>0).length};
}
async function revisit(ref){
  const f=fixture({ref}),owner=new AbortController();
  const blocker=f.read('blocker');await f.tick();
  const old=f.read('target',owner.signal),rejected=assert.rejects(old,{code:'ABORT_ERR'});owner.abort();
  const current=f.read('target');await rejected;await f.tick();
  const neighbour=f.read('target');await f.tick();const queued=f.api.upstreamLoad().queued;
  await f.drain();await Promise.all([blocker,current,neighbour]);
  return {targetRequests:f.requests.filter(r=>r.options.path==='/target').length,queuedRevisitRequests:queued};
}
(async()=>{
  const run=async ref=>({contendedReader:ranges(ref),singleReaderControl:ranges(ref,1),rapidRevisit:await revisit(ref)});
  const report={workload:'source-admission',baselineRef:baseline||null,
    notes:'Actual broker and upstream code, fixed 100 ms range costs and a virtual clock. 24 range slots and six borrower workers. HTTPS sharing uses controlled transport. Not live/device speed.'};
  if(baseline)report.before=await run(baseline);report.after=await run();
  assert.equal(report.after.rapidRevisit.targetRequests,1);
  if(baseline){
    assert(report.after.contendedReader.allSmallReadyMs<report.before.contendedReader.allSmallReadyMs);
    assert.equal(report.after.contendedReader.networkReads,report.before.contendedReader.networkReads);
    assert(report.after.contendedReader.allWorkMs<=report.before.contendedReader.allWorkMs);
    assert.deepEqual(report.after.singleReaderControl,report.before.singleReaderControl);
    assert(report.after.rapidRevisit.targetRequests<report.before.rapidRevisit.targetRequests);
  }
  const json=JSON.stringify(report,null,2)+'\n';if(output)fs.writeFileSync(output,json);process.stdout.write(json);
})().catch(error=>{console.error(error);process.exitCode=1;});
