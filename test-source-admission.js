'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {TerrainRangeBroker}=require('./terrain-ranges'),{fixture:upstream}=require('./test-fixtures/upstream-source');
function brokerFixture(options={}){
  const broker=new TerrainRangeBroker({limit:4,perWorkerLimit:2,...options}),messages=[];let id=0;
  const workers=Array.from({length:4},(_,index)=>({postMessage:message=>{
    messages.push({worker:index,...message});if(message.op==='load')broker.handle(workers[index],{kind:'terrain-range',op:'started',id:message.id});
  }}));workers.forEach((worker,index)=>broker.attach(worker,index));
  const read=(index,key)=>{
    const request={worker:workers[index],id:++id};broker.handle(request.worker,{kind:'terrain-range',op:'read',...request,key,a:0,b:63});return request;
  };
  const finish=(key,error,code)=>{
    const entry=[...broker.loads.values()].find(e=>e.key===key);assert.ok(entry,'missing active '+key);
    broker.handle(entry.owner,{kind:'terrain-range',op:'result',id:entry.id,error,code,bytes:error?undefined:new SharedArrayBuffer(64)});
  };
  const drain=()=>{while(broker.loads.size)finish(broker.loads.values().next().value.key);assert.equal(broker.queue.length,0);};
  return {broker,workers,messages,read,finish,drain,loads:()=>messages.filter(m=>m.op==='load').map(m=>m.key)};
}
test('source broker admits a small reader before a broad window finishes all queued blocks',()=>{
  const f=brokerFixture();for(let i=0;i<32;i++)f.read(0,'broad-'+i);
  f.read(1,'small-0');f.read(1,'small-1');f.finish('broad-0');
  assert.equal(f.loads().at(-1),'small-0');f.finish('broad-1');assert.equal(f.loads().at(-1),'small-1');
  assert.equal(f.broker.loads.size,4);f.drain();assert.equal(f.broker.stats().networkReads,34);
});
test('source broker rotates equal-pressure readers even with one source slot',()=>{
  const f=brokerFixture({limit:1});for(let i=0;i<6;i++)f.read(0,'a-'+i);
  f.read(1,'b-0');f.read(1,'b-1');f.drain();
  assert.deepEqual(f.loads().slice(0,5),['a-0','b-0','a-1','b-1','a-2']);
});
test('source broker balances active consumer reads while preserving per-reader FIFO',()=>{
  const f=brokerFixture({limit:6});for(let i=0;i<16;i++)f.read(0,'a-'+i);
  for(let i=0;i<4;i++){f.read(1,'b-'+i);f.read(2,'c-'+i);}
  f.finish('a-0');f.finish('a-1');f.finish('a-2');f.finish('a-3');
  assert.deepEqual(f.loads().slice(6,10),['b-0','c-0','b-1','c-1']);f.drain();
  assert.equal(f.broker.stats().networkReads,24);
});
test('source fairness follows current shared ownership after a consumer cancels',()=>{
  const f=brokerFixture();for(let i=0;i<12;i++)f.read(0,'a-'+i);
  const departed=f.read(1,'a-4');f.read(1,'current');
  f.broker.handle(departed.worker,{kind:'terrain-range',op:'cancel',id:departed.id});f.finish('a-0');
  assert.equal(f.loads().at(-1),'current','a cancelled shared owner cannot inflate its old range demand');
  f.drain();assert.equal(f.broker.stats().shared,1);assert.equal(f.loads().filter(k=>k==='a-4').length,1);
});
test('source failures record one bounded diagnostic per shared network failure',()=>{
  const f=brokerFixture();f.read(0,'shared');f.read(1,'shared');f.finish('shared','range 503','S3_HTTP_503');
  const stats=f.broker.stats();assert.equal(stats.failed,1);assert.deepEqual(stats.failureCodes,{S3_HTTP_503:1});
  assert.equal(stats.lastFailure.code,'S3_HTTP_503');assert.equal(stats.lastFailure.phase,'read');
  assert(stats.lastFailure.queueMs>=0);assert(stats.lastFailure.readMs>=0);
  assert.equal(f.messages.filter(m=>m.op==='reply'&&m.error==='range 503').length,2);
  stats.lastFailure.message='changed';stats.failureCodes.S3_HTTP_503=100;
  assert.equal(f.broker.stats().lastFailure.message,'range 503');assert.equal(f.broker.stats().failureCodes.S3_HTTP_503,1);
});
test('source cancellation does not become a provider failure diagnostic',()=>{
  const f=brokerFixture(),owner=f.read(0,'cancelled');
  f.broker.handle(owner.worker,{kind:'terrain-range',op:'cancel',id:owner.id});f.finish('cancelled','cancelled','ABORT_ERR');
  const stats=f.broker.stats();assert.equal(stats.failed,0);assert.deepEqual(stats.failureCodes,{});assert.equal(stats.lastFailure,null);assert.equal(stats.networkReads,0);
});
test('source diagnostic storage remains bounded across distinct failures',()=>{
  const f=brokerFixture();for(let i=0;i<40;i++){f.read(0,'failure-'+i);f.finish('failure-'+i,'x'.repeat(1000),'failure-code-'+i);}
  const stats=f.broker.stats();assert.equal(Object.keys(stats.failureCodes).length,16);assert.equal(stats.failureCodes.OTHER,25);
  assert.equal(stats.lastFailure.message.length,160);assert.equal(stats.failed,40);
});
test('an aborted queued upstream cannot erase the immediate replacement sharing entry',async()=>{
  const f=upstream(),owner=new AbortController(),block=f.read('block');await f.tick();
  const old=f.read('target',owner.signal),rejected=assert.rejects(old,{code:'ABORT_ERR'});owner.abort();
  const current=f.read('target');await rejected;await f.tick();const neighbour=f.read('target');await f.tick();
  assert.equal(f.api.upstreamLoad().queued,1);await f.drain();await Promise.all([block,current,neighbour]);
  assert.equal(f.requests.filter(r=>r.options.path==='/target').length,1);assert.equal(f.api.upstreamLoad().inflight,0);
});
test('an aborted on-wire upstream cannot erase a replacement or cancel its other viewer',async()=>{
  const f=upstream(),owner=new AbortController(),old=f.read('target',owner.signal),rejected=assert.rejects(old,{code:'ABORT_ERR'});
  await f.tick();owner.abort();const current=f.read('target');await rejected;await f.tick();const neighbour=f.read('target');
  await f.drain();await Promise.all([current,neighbour]);
  assert.equal(f.requests.length,2,'one abandoned transport plus one shared replacement');assert.equal(f.api.upstreamLoad().queued,0);
});
test('one upstream viewer leaving retains the other viewer and one transport',async()=>{
  const f=upstream(),owner=new AbortController(),first=f.read('shared',owner.signal),rejected=assert.rejects(first,{code:'ABORT_ERR'});
  const second=f.read('shared');await f.tick();owner.abort();await rejected;await f.drain();
  const result=await second;assert.equal(result.status,200);assert(result.body.every(v=>v===37));assert.equal(f.requests.length,1);
});
test('failed upstream requests release their lane and remain retryable',async()=>{
  const f=upstream(),first=f.read('failure'),rejected=assert.rejects(first,/network offline/);await f.tick();
  f.requests[0].destroy(Error('network offline'));await rejected;
  const retry=f.read('failure');await f.drain();assert.equal((await retry).status,200);assert.equal(f.requests.length,2);
});
