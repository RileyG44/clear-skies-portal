'use strict';
const assert=require('node:assert/strict');
const {RequestPool,ProgressiveGrid}=require('./tile-pipeline');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function main(){
  const grid=new ProgressiveGrid(3);
  grid.accept(new Float32Array([100,NaN,300]),3);
  grid.accept(new Float32Array([10,20,NaN]),2);
  grid.accept(new Float32Array([1,2,3]),1);
  assert.deepEqual([...grid.grid],[100,20,300],'late coarse data cannot erase detail');
  assert.equal(grid.valid,3);
  assert.equal(grid.accept(new Float32Array([NaN,-32768,NaN]),3),false,'no-data cannot erase terrain');
  const pool=new RequestPool({concurrency:1,maxBytes:8});let calls=0,finish;
  const a=new AbortController(),b=new AbortController();
  const loader=signal=>{calls++;return new Promise((resolve,reject)=>{finish=resolve;signal.addEventListener('abort',()=>reject(new Error('aborted')));});};
  const first=pool.request('shared',loader,{signal:a.signal});
  const second=pool.request('shared',loader,{signal:b.signal});
  const cancelled=assert.rejects(first,{name:'AbortError'});a.abort();await tick();
  assert.equal(calls,1);finish(new Float32Array([4]));await cancelled;
  assert.deepEqual([...await second],[4],'one departing layer cannot cancel another');await tick();
  assert.deepEqual([...await pool.request('shared',()=>{throw Error('must be cached');})],[4]);
  await pool.request('next',()=>new Float32Array([5,6]));await tick();
  assert.equal(pool.cache.has('shared'),false,'decoded cache obeys byte budget');
  const order=[];let unblock;
  const block=pool.request('block',()=>new Promise(resolve=>{unblock=resolve;}));await tick();
  const low=pool.request('low',()=>{order.push('low');return null;},{priority:0});
  const high=pool.request('high',()=>{order.push('high');return null;},{priority:10});
  const c=new AbortController();
  const obsolete=pool.request('obsolete',()=>{throw Error('obsolete task ran');},{signal:c.signal});
  const gone=assert.rejects(obsolete,{name:'AbortError'});c.abort();unblock(null);
  await Promise.all([block,low,high,gone]);assert.deepEqual(order,['high','low']);await tick();
  assert.equal(pool.jobs.size,0);assert.equal(pool.active,0);
  let retry=0;await assert.rejects(pool.request('failed',()=>{retry++;throw Error('offline');}));await tick();
  await pool.request('failed',()=>{retry++;return new Float32Array([9]);});assert.equal(retry,2,'failures are not cached');
  console.log('tile pipeline checks passed (ordering, cancellation, coalescing, priority, eviction, retry)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

// A slow detail service cannot occupy the overview's reserved capacity.
(async()=>{
  const pool=new RequestPool({concurrency:2,groupLimits:{detail:1,overview:1}});
  let finish;const order=[];
  const first=pool.request('detail-1',()=>new Promise(resolve=>{finish=resolve;}),{group:'detail',priority:3});
  const second=pool.request('detail-2',()=>{order.push('detail');return null;},{group:'detail',priority:3});
  const overview=pool.request('overview',()=>{order.push('overview');return null;},{group:'overview',priority:1});
  await overview;assert.deepEqual(order,['overview']);finish(null);await Promise.all([first,second]);
  // Retrying a no-coverage response immediately must not attach to a completed job.
  assert.equal(await pool.request('empty',()=>null),null);
  assert.equal(await pool.request('empty',()=>null),null);
})().catch(error=>{console.error(error);process.exitCode=1;});
