'use strict';
const assert=require('node:assert/strict');
const {MessageChannel}=require('node:worker_threads');
const {TerrainRangeBroker,connectRangeClient}=require('./terrain-ranges.js');
const {workload}=require('./scripts/lib/terrain-range-workload.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){
  for(let i=0;i<200;i++){if(predicate())return;await tick();}
  throw Error('range fixture did not reach the expected state');
}
function fixture({limit=1,perWorkerLimit=4,maxQueue=64,workers=2}={}){
  const broker=new TerrainRangeBroker({limit,perWorkerLimit,maxQueue}),calls=[],clients=[],ports=[],available=Array(workers).fill(true);
  for(let i=0;i<workers;i++){
    const {port1,port2}=new MessageChannel();ports.push(port1,port2);broker.attach(port2,i,()=>available[i]);
    port2.on('message',m=>broker.handle(port2,m));port2.on('close',()=>broker.detach(port2));
    clients.push(connectRangeClient(port1,(key,a,b,signal,start)=>new Promise((resolve,reject)=>{
      calls.push({worker:i,key,a,b,signal,start,resolve:({cached=false}={})=>resolve({buf:Buffer.alloc(b-a+1,37),cached}),reject});
    })));
  }
  return {broker,calls,clients,ports,available,read:(i,key,signal)=>clients[i].read(key,0,63,signal),
    close:()=>{broker.close();for(const c of clients)c.close();for(const p of ports)p.close();}};
}
(async()=>{
  let f=fixture();
  try{
    const owner=new AbortController(),a=f.read(0,'shared',owner.signal),rejected=assert.rejects(a,{name:'AbortError'}),b=f.read(1,'shared');
    await until(()=>f.broker.stats().requests===2&&f.calls.length===1);f.calls[0].start();
    owner.abort();await rejected;await until(()=>f.broker.stats().cancelled===1);
    assert(!f.calls[0].signal.aborted,'one departing worker cannot abort another worker’s source');
    f.calls[0].resolve();const value=await b;
    assert.equal(value.buf.length,64);assert(value.buf.every(v=>v===37));
    assert(value.buf.buffer instanceof SharedArrayBuffer,'encoded bytes are shared without a per-worker clone');
    const s=f.broker.stats();assert.equal(s.shared,1);assert.equal(s.networkReads,1);assert.equal(s.bytes,64);assert.equal(s.failed,0);
  }finally{f.close();}

  f=fixture();
  try{
    const blocker=f.read(0,'blocker');await until(()=>f.calls.length===1);f.calls[0].start();
    const owners=Array.from({length:24},()=>new AbortController());
    const old=owners.map((owner,i)=>f.read(i%2,'obsolete-'+i,owner.signal).catch(e=>e));
    await until(()=>f.broker.stats().queued===24);owners.forEach(owner=>owner.abort());await Promise.all(old);
    await until(()=>f.broker.stats().queued===0);
    const current=f.read(1,'current');await until(()=>f.broker.stats().queued===1);
    f.calls[0].resolve();await blocker;await until(()=>f.calls.length===2);
    assert.equal(f.calls[1].key,'current','obsolete ranges never get ahead of the current view');
    f.calls[1].start();f.calls[1].resolve();await current;
    assert.equal(f.broker.stats().dropped,24);assert.equal(f.broker.stats().active,0);
  }finally{f.close();}

  f=fixture({maxQueue:2});
  try{
    const first=f.read(0,'active');await until(()=>f.calls.length===1);
    const one=f.read(0,'one'),two=f.read(1,'two');
    await until(()=>f.broker.stats().queued===3); // one assigned local wait plus two queued globally
    await assert.rejects(f.read(1,'overflow'),{code:'QUEUE_FULL'});
    assert.equal(f.calls.length,1,'the configured limit applies across workers');
    assert.equal(f.broker.stats().rejected,1);
    f.calls[0].resolve();await first;await until(()=>f.calls.length===2);
    f.calls[1].resolve();await one;await until(()=>f.calls.length===3);
    f.calls[2].resolve({cached:true});await two;
    assert.equal(f.broker.stats().diskHits,1,'a range cached during queueing is reused');
  }finally{f.close();}

  f=fixture({limit:2});
  try{
    const a=f.clients[0].read('windows',0,63),b=f.clients[0].read('windows',64,127);
    await until(()=>f.calls.length===2);
    const windows=f.calls.slice().sort((a,b)=>a.a-b.a);
    assert.deepEqual(windows.map(c=>[c.a,c.b]),[[0,63],[64,127]],'different byte windows keep independent ownership');
    assert.deepEqual(windows.map(c=>c.worker),[0,1],'one busy reader borrows other workers’ available source slots');
    f.calls.forEach(c=>c.resolve());await Promise.all([a,b]);assert.equal(f.broker.stats().shared,0);
  }finally{f.close();}

  f=fixture({limit:8,perWorkerLimit:1});
  try{
    f.available[1]=false;
    const a=f.read(0,'first');await until(()=>f.calls.length===1);
    const b=f.read(0,'waiting');await until(()=>f.broker.stats().requests===2);
    assert.equal(f.calls.length,1,'a full local gate leaves global capacity available instead of queueing behind one worker');
    const own=f.read(1,'fabric');await until(()=>f.calls.length===2);
    assert.equal(f.calls[1].worker,1,'a busy fabric worker can read its own data past another worker’s blocked queue');
    f.calls[1].resolve();await own;
    f.available[1]=true;f.broker.drain();await until(()=>f.calls.length===3);
    assert.equal(f.calls[2].worker,1,'newly available workers resume queued reads');
    f.calls[0].resolve();f.calls[2].resolve();await Promise.all([a,b]);
  }finally{f.close();}

  f=fixture();
  try{
    const owner=new AbortController(),old=f.read(0,'revisit',owner.signal),rejected=assert.rejects(old,{name:'AbortError'});
    await until(()=>f.calls.length===1);owner.abort();await rejected;
    await until(()=>f.calls[0].signal.aborted);
    const revisit=f.read(1,'revisit');await until(()=>f.broker.stats().requests===2);
    f.calls[0].reject(Object.assign(Error('cancelled local slot'),{code:'ABORT_ERR'}));
    await until(()=>f.calls.length===2);f.calls[1].start();f.calls[1].resolve();await revisit;
    assert.equal(f.broker.stats().failed,0,'a revisit retries an acknowledged queued cancellation without caching failure');
    assert.equal(f.broker.stats().active,0);
  }finally{f.close();}

  f=fixture();
  try{
    const owner=new AbortController(),old=f.read(0,'on-wire',owner.signal),rejected=assert.rejects(old,{name:'AbortError'});
    await until(()=>f.calls.length===1);f.calls[0].start();owner.abort();await rejected;
    await until(()=>f.calls[0].signal.aborted);
    const revisit=f.read(1,'on-wire');await until(()=>f.broker.stats().requests===2);
    f.calls[0].resolve();await revisit;
    assert.equal(f.calls.length,1,'a last-owner cancellation retains the on-wire read for an immediate revisit');
    assert.equal(f.broker.stats().shared,1);
  }finally{f.close();}

  f=fixture();
  try{
    const a=assert.rejects(f.read(0,'failed'),/source offline/),b=assert.rejects(f.read(1,'failed'),/source offline/);
    await until(()=>f.broker.stats().requests===2&&f.calls.length===1);
    f.calls[0].reject(Error('source offline'));await Promise.all([a,b]);
    const recovered=f.read(1,'failed');await until(()=>f.calls.length===2);
    f.calls[1].resolve();await recovered;assert.equal(f.broker.stats().failed,1);
  }finally{f.close();}

  f=fixture();
  try{
    const lost=assert.rejects(f.read(0,'crash'),{code:'RANGE_CLOSED'});
    await until(()=>f.calls.length===1);
    const surviving=f.read(1,'crash');
    await until(()=>f.broker.stats().requests===2&&f.calls.length===1);
    const oldLoad=[...f.broker.loads.keys()][0];
    f.ports[0].close();await lost;await until(()=>f.calls.length===2);
    assert.equal(f.calls[1].worker,1,'another worker resumes a surviving consumer’s interrupted source');
    f.broker.handle(f.ports[1],{kind:'terrain-range',op:'result',id:oldLoad,error:'late old result'});
    f.calls[1].resolve();await surviving;assert.equal(f.broker.stats().workerRetries,1);
    assert.equal(f.broker.stats().failed,0,'worker replacement does not fail a healthy neighbour');
  }finally{f.close();}

  const live=await workload({providerSlots:2,rangeLimit:2});
  assert(live.valid);assert.equal(live.uniqueWorkers,6);assert.equal(live.coldRequests,2);assert.equal(live.revisitRequests,0);
  assert.equal(live.sourceRanges.networkReads,2);assert(live.sourceRanges.shared>0);
  assert.equal(live.sourceRanges.active,0);assert.equal(live.sourceRanges.queued,0);
  const recovered=await workload({providerSlots:2,crashFirstReader:true});
  assert(recovered.valid,'real worker termination preserves every other numeric render and allows a healthy revisit');
  assert.equal(recovered.failedJobs,1);assert.equal(recovered.restarts,1);assert.equal(recovered.sourceRanges.workerRetries,1);
  assert.equal(recovered.sourceRanges.active,0);assert.equal(recovered.sourceRanges.queued,0);
  const single=await workload({readers:1,keysPerReader:6,shared:false,providerSlots:8});
  assert(single.valid);assert.equal(single.uniqueWorkers,1);assert.equal(single.coldRequests,12);assert.equal(single.revisitRequests,0);
  assert(single.sourceRanges.workers.filter(w=>w.reads>0).length>1,'one real render reader borrows other workers instead of filling its local queue');
  console.log('Terrain ranges: real six-worker sharing, cancellation, immediate revisits, bounded queues, worker loss, shared bytes and source telemetry passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
