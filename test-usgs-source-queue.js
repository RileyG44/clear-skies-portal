'use strict';
const assert=require('node:assert/strict'),{getEventListeners}=require('node:events');
const {fixture}=require('./test-fixtures/usgs-source.js');
const ref=process.env.CSP_TEST_BASELINE;
async function check(options,run){const f=fixture({ref,...options});try{await run(f);}finally{f.close();}}
(async()=>{
  await check({},async f=>{
    const headers=Array.from({length:8},()=>f.source.openCog('shared.tif',f.bytes.length));
    await f.drain();const all=await Promise.all(headers);
    assert.equal(f.requests.length,1,'header HTTP ranges are shared');
    assert.equal(f.counters.parses,1,'concurrent renders parse a shared header once');
    assert(all.every(h=>h===all[0]),'every render reuses the same parsed directory');
    const tiles=Array.from({length:8},()=>f.source.cogTile('shared.tif',all[0],0,0,0));
    await f.drain();const decoded=await Promise.all(tiles);
    assert.equal(f.requests.length,2);assert.equal(f.counters.decodes,1,'concurrent renders decode a shared block once');
    assert(decoded.every(a=>a===decoded[0]&&a.every(v=>v===123.5)),'shared blocks retain exact numeric elevation');
    assert.equal(await f.source.openCog('shared.tif',f.bytes.length),all[0]);
    assert.equal(await f.source.cogTile('shared.tif',all[0],0,0,0),decoded[0]);
    assert.equal(f.requests.length,2,'resident revisits do no work');
  });
  await check({},async f=>{
    const blocker=f.source.fetchRange('blocker',0,63);await f.tick();
    const owner=new AbortController();
    const abandoned=Array.from({length:24},(_,i)=>f.source.openCog(`old-${i}.tif`,f.bytes.length,owner.signal));
    const rejected=Promise.all(abandoned.map(p=>assert.rejects(p,{name:'AbortError'})));
    await f.tick();assert.equal(f.source.queueStats().queued,24);
    owner.abort();await f.tick();
    assert.equal(f.source.queueStats().queued,0,'all orphaned header ranges leave the S3 queue immediately');
    assert.equal(getEventListeners(owner.signal,'abort').length,0,'render cancellation releases its signal listeners');
    const current=f.source.openCog('current.tif',f.bytes.length);
    await f.drain();await blocker;await rejected;await current;
    assert.deepEqual(f.requests.map(r=>r.path),['/blocker','/current.tif'],'old ranges never consume network slots');
  });
  await check({},async f=>{
    const blocker=f.source.fetchRange('blocker',0,63);await f.tick();
    const a=new AbortController(),b=new AbortController();
    const first=f.source.openCog('shared.tif',f.bytes.length,a.signal);
    const second=f.source.openCog('shared.tif',f.bytes.length,b.signal);await f.tick();
    const rejected=assert.rejects(first,{name:'AbortError'});a.abort();await rejected;
    assert.equal(f.source.queueStats().queued,1,'another render still owns the shared queued header');
    await f.drain();await blocker;const header=await second;
    assert.equal(f.counters.parses,1);assert.equal(getEventListeners(b.signal,'abort').length,0);
    const departing=new AbortController();
    const old=f.source.cogTile('shared.tif',header,0,0,0,departing.signal);await f.tick();
    const oldRejected=assert.rejects(old,{name:'AbortError'});departing.abort();await oldRejected;
    const revisited=f.source.cogTile('shared.tif',header,0,0,0);await f.drain();
    assert((await revisited).every(v=>v===123.5));
    assert.equal(f.requests.length,3,'immediate revisit reuses a read already on the wire');
    assert.equal(f.counters.decodes,1);
  });
  await check({},async f=>{
    const blocker=f.source.fetchRange('blocker',0,63);await f.tick();
    const departing=new AbortController();
    const old=f.source.openCog('revisit.tif',f.bytes.length,departing.signal);await f.tick();
    const rejected=assert.rejects(old,{name:'AbortError'});departing.abort();
    const current=f.source.openCog('revisit.tif',f.bytes.length);await rejected;await f.tick();
    const other=f.source.openCog('revisit.tif',f.bytes.length);await f.drain();await blocker;
    assert.equal(await current,await other,'an old completion cannot erase replacement ownership');
    assert.equal(f.requests.length,2);
  });
  await check({},async f=>{
    const failed=f.source.openCog('retry.tif',f.bytes.length);await f.tick();
    const rejected=assert.rejects(failed,/range 503/);f.complete(f.requests[0],{status:503});await rejected;
    const retry=f.source.openCog('retry.tif',f.bytes.length);await f.drain();const header=await retry;
    assert.equal(f.requests.length,2,'failed headers are retryable');
    const bad=f.source.cogTile('retry.tif',header,0,0,0);await f.tick();
    const badRejected=assert.rejects(bad,/range 503/);f.complete(f.requests[2],{status:503});await badRejected;
    const again=f.source.cogTile('retry.tif',header,0,0,0);await f.drain();assert((await again).every(v=>v===123.5));
  });
  await check({},async f=>{
    const gate=f.source.testGate;
    await gate.take();const queued=gate.take();gate.release();
    const newcomer=gate.take();await f.tick();
    assert.equal(f.source.queueStats().active,1,'a just-released slot is reserved before microtasks run');
    assert.equal(f.source.queueStats().queued,1,'a newcomer cannot steal a reserved slot');
    await queued;gate.release();await newcomer;gate.release();
    assert.equal(f.source.queueStats().active,0);
  });
  await check({},async f=>{
    const headers=f.source.openCog('seed.tif',f.bytes.length);await f.drain();const header=await headers;
    const blocker=f.source.fetchRange('blocker',0,63);await f.tick();
    const owner=new AbortController();
    const abandoned=Array.from({length:24},(_,i)=>f.source.cogTile(`old-${i}.tif`,header,0,0,0,owner.signal));
    const rejected=Promise.all(abandoned.map(p=>assert.rejects(p,{name:'AbortError'})));await f.tick();
    assert.equal(f.source.queueStats().queued,24);assert.equal(getEventListeners(owner.signal,'abort').length,1);
    owner.abort();await rejected;assert.equal(f.source.queueStats().queued,0,'orphaned decoded-block reads also leave the queue');
    await f.drain();await blocker;assert.equal(f.counters.decodes,0,'cancelled blocks are never decoded');
    assert.equal(f.requests.length,2);assert.equal(getEventListeners(owner.signal,'abort').length,0);
  });
  await check({},async f=>{
    const blocker=f.source.fetchRange('blocker',0,63);await f.tick();
    const index={projects:{Fixture:{zone:null,cells:{x59y519:{f:'zoneless.tif',size:f.bytes.length}}}}};
    const owner=new AbortController();
    const candidates=f.source.cellCandidates(index,'x59y519',10,owner.signal);
    const rejected=assert.rejects(candidates,{name:'AbortError'});await f.tick();assert.equal(f.source.queueStats().queued,1);
    owner.abort();await f.tick();assert.equal(f.source.queueStats().queued,0,'zone discovery releases its header ownership');await rejected;
    const retry=f.source.cellCandidates(index,'x59y519',10);await f.drain();await blocker;
    assert.equal((await retry).length,1);assert.equal(f.requests.length,2,'cancellation never caches an unknown zone');
  });
  const usgs=require('./usgs.js'),terrain=require('./engine/terrain.js'),findCells=usgs.findCells;
  try{
    const controller=new AbortController();let written=false;
    usgs.findCells=async(lon,lat,signal)=>{
      assert.equal(signal,controller.signal,'coverage lookup owns its source waits');
      await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    };
    const lookup=terrain.routes['/api/usgs/cover']({}, {writeHead:()=>{written=true;}},
      {u:new URL('http://fixture/api/usgs/cover?lon=-122&lat=47'),signal:controller.signal});
    controller.abort();await lookup;assert.equal(written,false,'cancelled coverage lookup never becomes a server error response');
  }finally{usgs.findCells=findCells;}
  console.log('USGS source queue: shared parsing/decoding, orphan cancellation, retained reads, ownership, retries and strict concurrency passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
