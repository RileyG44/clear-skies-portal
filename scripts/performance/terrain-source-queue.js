#!/usr/bin/env node
'use strict';
/* Repeatable follow-up to tile-scheduling.js. Production modules from either
   revision, real TIFF decode/cache work, controlled source and warmer clocks. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('../../test-fixtures/usgs-source.js');
const {fixture:warmingFixture}=require('../../test-fixtures/terrain-warming.js');
const baseline=process.argv.find(arg=>arg.startsWith('--baseline='))?.slice('--baseline='.length);
const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice('--output='.length);
async function sharedProcessing(ref){
  const f=fixture({ref});
  try{
    const headers=Array.from({length:2},()=>f.source.openCog('shared.tif',f.bytes.length));
    await f.drain();const all=await Promise.all(headers);
    const blocks=all.map(h=>f.source.cogTile('shared.tif',h,0,0,0));
    await f.drain();const pixels=await Promise.all(blocks);
    assert(pixels.every(a=>a.every(v=>v===123.5)));
    return {overlappingRenders:2,headerParses:f.counters.parses,blockDecodes:f.counters.decodes,sourceRequests:f.requests.length};
  }finally{f.close();}
}
async function sourceCancellation(ref){
  const f=fixture({ref});
  try{
    const blocker=f.source.fetchRange('blocker',0,63);await f.tick();
    const owner=new AbortController();
    const old=Array.from({length:24},(_,i)=>f.source.openCog(`old-${i}.tif`,f.bytes.length,owner.signal).catch(()=>null));
    await f.tick();owner.abort();await f.tick();
    const queuedAfterDeparture=f.source.queueStats().queued,start=f.now;
    let currentViewReadyMs;
    const current=f.source.openCog('current.tif',f.bytes.length).then(()=>{currentViewReadyMs=f.now-start;});
    await f.drain();await Promise.all([blocker,current,...old]);
    assert.equal(f.source.queueStats().active,0);assert.equal(f.source.queueStats().queued,0);
    return {abandonedHeaders:24,queuedAfterDeparture,obsoleteSourceRequests:f.requests.filter(r=>r.path.startsWith('/old-')).length,
      sourceRequests:f.requests.length,currentViewReadyMs,maxActive:f.counters.maxActive};
  }finally{f.close();}
}
async function warming(ref){
  const f=warmingFixture({ref});
  try{
    await f.hit();await f.clock.advance(160);
    const speculativeJobs=f.jobs.length,queuedAtArrival=f.pool.stats().queued,start=f.clock.now;let currentViewReadyMs;
    const current=f.terrain.terrainTask('current','raw-elevation',{}, {priority:55},new AbortController().signal)
      .then(()=>{currentViewReadyMs=f.clock.now-start;});
    await f.clock.advance(1000);await current;
    return {speculativeJobs,queuedAtArrival,currentViewReadyMs,cancelledSpeculativeJobs:f.jobs.filter(j=>j.cancelled).length};
  }finally{f.close();}
}
async function run(ref){return {sharedProcessing:await sharedProcessing(ref),sourceCancellation:await sourceCancellation(ref),warming:await warming(ref)};}
(async()=>{
  const report={workload:'terrain-source-queue',baselineRef:baseline||null,
    notes:'Real TIFF parsing, block decoding and disk cache; controlled HTTPS at 20 ms/read with one S3 slot. Warmer uses one simulated worker, 400 ms speculative and 10 ms visible costs, demand arriving 160 ms after a cache hit. These are deterministic workload comparisons, not device or live-provider latency claims.'};
  if(baseline)report.before=await run(baseline);report.after=await run();
  if(baseline){
    assert(report.after.sharedProcessing.headerParses<report.before.sharedProcessing.headerParses);
    assert(report.after.sharedProcessing.blockDecodes<report.before.sharedProcessing.blockDecodes);
    assert(report.after.sourceCancellation.currentViewReadyMs<report.before.sourceCancellation.currentViewReadyMs);
    assert.equal(report.after.sourceCancellation.obsoleteSourceRequests,0);
    assert(report.after.warming.currentViewReadyMs<report.before.warming.currentViewReadyMs);
  }
  const json=JSON.stringify(report,null,2)+'\n';if(output)fs.writeFileSync(output,json);process.stdout.write(json);
})().catch(error=>{console.error(error);process.exitCode=1;});
