#!/usr/bin/env node
'use strict';
const {workload}=require('../lib/terrain-range-workload.js');
const fs=require('node:fs'),assert=require('node:assert/strict');
const baseline=process.argv.find(a=>a.startsWith('--baseline='))?.slice('--baseline='.length);
const output=process.argv.find(a=>a.startsWith('--output='))?.slice('--output='.length);
async function run(ref){
  const shared=[],independent=[],singleReader=[];
  for(let i=0;i<3;i++){
    shared.push(await workload({ref,shared:true}));independent.push(await workload({ref,shared:false}));
    singleReader.push(await workload({ref,shared:false,readers:1,keysPerReader:6,providerSlots:8}));
  }
  return {shared,independent,singleReader};
}
(async()=>{
  const report={workload:'cross-worker-cold-ranges',baselineRef:baseline||null,
    notes:'Six real workers parse and decode numeric TIFFs. HTTPS is redirected to a local provider with 50 ms/read: two slots for six shared/independent readers; eight slots for a single reader opening six files. Three runs per case. The baseline loads the historical worker pool with broker support absent; both use the same reader and TIFF fixture. These are controlled source-workload measurements, not phone or live-provider latency claims.'};
  if(baseline)report.before=await run(baseline);report.after=await run();
  assert(report.after.shared.every(r=>r.valid&&r.coldRequests===2&&r.revisitRequests===0));
  assert(report.after.independent.every(r=>r.valid&&r.coldRequests===12&&r.revisitRequests===0));
  assert(report.after.singleReader.every(r=>r.valid&&r.coldRequests===12&&r.revisitRequests===0&&r.sourceRanges.workers.filter(w=>w.reads>0).length>1));
  if(baseline)assert(report.before.shared.every(r=>r.coldRequests===12));
  const json=JSON.stringify(report,null,2)+'\n';if(output)fs.writeFileSync(output,json);process.stdout.write(json);
})().catch(error=>{console.error(error);process.exitCode=1;});
