'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture}=require('./test-fixtures/usgs-source');
const {MessageChannel}=require('node:worker_threads'),{TerrainRangeBroker,connectRangeClient}=require('./terrain-ranges');
test('HTTP source failures retain a diagnostic code and can recover',async()=>{
  const f=fixture();try{
    const read=f.source.fetchRange('unavailable.tif',0,63),failed=assert.rejects(read,{code:'S3_HTTP_503'});await f.tick();
    f.complete(f.requests[0],{status:503});await failed;
    const retry=f.source.fetchRange('unavailable.tif',0,63);await f.drain();assert.equal((await retry).buf.length,64);
    assert.equal(f.source.queueStats().active,0);
  }finally{f.close();}
});
test('S3 read timeouts retain a diagnostic code and release source capacity',async()=>{
  const f=fixture();try{
    const read=f.source.fetchRange('timeout.tif',0,63),failed=assert.rejects(read,{code:'S3_TIMEOUT'});await f.tick();
    assert.equal(f.requests[0].req.timeout.ms,30000);f.requests[0].req.timeout.handler();await failed;
    assert.equal(f.source.queueStats().active,0);assert.equal(f.source.queueStats().queued,0);
  }finally{f.close();}
});
test('oversized S3 bodies retain a diagnostic code and are not cached',async()=>{
  const f=fixture();try{
    const read=f.source.fetchRange('oversized.tif',0,63),failed=assert.rejects(read,{code:'S3_BODY_TOO_LARGE'});await f.tick();
    f.complete(f.requests[0],{body:Buffer.alloc(32*1024*1024+1)});await failed;
    const retry=f.source.fetchRange('oversized.tif',0,63);await f.drain();assert.equal((await retry).buf.length,64);
    assert.equal(f.requests.length,2);
  }finally{f.close();}
});
test('source failure codes survive the real broker message protocol',async()=>{
  const {port1,port2}=new MessageChannel(),broker=new TerrainRangeBroker({limit:1});
  broker.attach(port2,0);port2.on('message',message=>broker.handle(port2,message));
  const client=connectRangeClient(port1,async(key,a,b,signal,start)=>{
    start();throw Object.assign(Error('range 503'),{code:'S3_HTTP_503'});
  });
  try{
    await assert.rejects(client.read('source.tif',0,63),{code:'S3_HTTP_503'});
    const stats=broker.stats();assert.deepEqual(stats.failureCodes,{S3_HTTP_503:1});assert.equal(stats.lastFailure.phase,'read');
    assert.equal(stats.active,0);assert.equal(stats.queued,0);
  }finally{broker.close();client.close();port1.close();port2.close();}
});
