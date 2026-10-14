'use strict';
const assert=require('node:assert/strict');
const C=require('./scripts/glacial-calibration/compare-current-app.js');
const {spawnSync}=require('node:child_process');
assert.deepEqual([...C.scoreMask([NaN,0.57,0.58,0.59],0.58)],[0,0,1,1]);
// Independently enumerate distances on an asymmetric grid, including empty mask.
const w=7,h=5,mask=new Uint8Array(w*h),skel=new Uint8Array(w*h).fill(1);mask[9]=mask[26]=1;
for(const tolerance of [0,1,2.5]){
 const actual=C.coveredSkeleton(mask,skel,w,h,2,tolerance);
 for(let i=0;i<mask.length;i++){
  const expected=[9,26].some(p=>Math.hypot((i%w)-(p%w),Math.floor(i/w)-Math.floor(p/w))*2<=tolerance);
  assert.equal(actual[i],+expected);
 }
}
assert.equal(C.coveredSkeleton(new Uint8Array(w*h),skel,w,h,1,10).reduce((a,z)=>a+z,0),0);
assert.deepEqual(C.overlapCounts([1,1,1,1],[1,1,0,0],[0,1,1,0]),
 {total:4,currentHits:2,newHits:2,both:1,newOnly:1,currentOnly:1,union:3});
const rows=[{class:'positive',region:'small',skeletonPixels:10,methods:{x:{skeletonHits:10}}},
 {class:'positive',region:'large',skeletonPixels:90,methods:{x:{skeletonHits:0}}},
 {class:'control',type:'dune',validPixels:10,methods:{x:{flaggedPixels:2}}},
 {class:'control',type:'dune',validPixels:30,methods:{x:{flaggedPixels:12}}}];
const summary=C.summarize(rows,'x');assert.equal(summary.regionMacroRecall,0.5);assert.equal(summary.pooledRecall,0.1);
assert(Math.abs(summary.confusers.dune.meanFlaggedArea-0.3)<1e-12);assert.equal(summary.confusers.dune.pooledFlaggedArea,0.35);
assert.throws(()=>C.evaluate({split:'test'}),/test refused/);
const cli=spawnSync(process.execPath,['scripts/glacial-calibration/compare-current-app.js','--split','test'],{encoding:'utf8'});
assert.equal(cli.status,1);assert.match(cli.stderr,/test refused/);
console.log('Current app comparison checks passed (threshold, independent distance oracle, empty mask, overlap, aggregation, held-out refusal)');
