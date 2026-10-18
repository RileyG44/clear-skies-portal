"use strict";
const assert=require("node:assert/strict");
const {create}=require("./gpu-terrain-3d-cache.js");

const SIZE=256;
const CELLS=SIZE*SIZE;
const N=SIZE+2;
const RECORD_BYTES=N*N*4;

function tile(value){
  const grid=new Float32Array(CELLS);
  grid.fill(value);
  return grid;
}
function deferred(){
  let resolve,reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const aborted=error=>error&&error.name==="AbortError";
const findCall=(calls,z,x,y)=>calls.find(call=>call.z===z&&call.x===x&&call.y===y);

(async()=>{
  const unhandled=[];
  process.on("unhandledRejection",reason=>unhandled.push(reason));

  /* 1. Coalescing, normalization, skirt orientation and unchanged centre. */
  {
    const centre=tile(0);
    for(let i=0;i<CELLS;i++)centre[i]=100+i;
    const centreCopy=centre.slice();
    const west=tile(0);
    for(let y=0;y<SIZE;y++)west[y*SIZE+SIZE-1]=1000+y;
    const east=tile(0);
    for(let y=0;y<SIZE;y++)east[y*SIZE]=2000+y;
    const north=tile(0);
    for(let x=0;x<SIZE;x++)north[(SIZE-1)*SIZE+x]=3000+x;
    const south=tile(0);
    for(let x=0;x<SIZE;x++)south[x]=4000+x;
    const calls=[];
    const loadGrid=(z,x,y,signal)=>{
      calls.push({z,x,y,signal});
      if(x===1&&y===2)return Promise.resolve(centre);
      if(x===0&&y===2)return Promise.resolve(west);
      if(x===2&&y===2)return Promise.resolve(east);
      if(x===1&&y===1)return Promise.resolve(north);
      if(x===1&&y===3)return Promise.resolve(south);
      return Promise.resolve(tile(0));
    };
    const cache=create({loadGrid});
    const first=()=>cache.prepare(2,1,2);
    const p1=first(),p2=first();
    const [a,b]=await Promise.all([p1,p2]);
    assert.equal(a,b,"simultaneous consumers share one record");
    assert.equal(calls.length,5,"five normalized loads for one job");
    for(const [z,x,y] of [[2,1,2],[2,0,2],[2,2,2],[2,1,1],[2,1,3]]){
      assert.ok(findCall(calls,z,x,y),"load "+z+"/"+x+"/"+y);
    }
    assert.equal(a.key,"2/1/2");
    assert.equal(a.z,2);assert.equal(a.x,1);assert.equal(a.y,2);
    assert.equal(a.size,256);
    assert.ok(a.grid instanceof Float32Array);
    assert.equal(a.grid.length,N*N);
    assert.ok(a.revision>0);
    for(const y of [0,1,128,SIZE-1]){
      assert.equal(a.grid[(y+1)*N],west[y*SIZE+SIZE-1],"west border row "+y);
      assert.equal(a.grid[(y+1)*N+N-1],east[y*SIZE],"east border row "+y);
    }
    for(const x of [0,1,128,SIZE-1]){
      assert.equal(a.grid[1+x],north[(SIZE-1)*SIZE+x],"north border col "+x);
      assert.equal(a.grid[(N-1)*N+1+x],south[x],"south border col "+x);
    }
    for(let y=0;y<SIZE;y++){
      for(let x=0;x<SIZE;x++){
        if(a.grid[(y+1)*N+1+x]!==centre[y*SIZE+x])throw new Error("centre pixel changed at "+x+","+y);
      }
    }
    assert.deepEqual(centre,centreCopy,"input centre grid unchanged");
    assert.equal(cache.stats().pending,0);
  }

  /* 2. Completed records are reused without loading again. */
  {
    let loads=0;
    const cache=create({loadGrid:()=>{loads++;return Promise.resolve(tile(1));}});
    const first=await cache.prepare(3,2,3);
    const before=cache.stats();
    const second=await cache.prepare(3,2,3);
    const after=cache.stats();
    assert.equal(first,second,"completed prepare returns the same record");
    assert.equal(first.revision,second.revision,"revision does not change on a hit");
    assert.equal(loads,5,"no extra loads on a completed hit");
    assert.equal(before.entries,1);
    assert.equal(after.entries,1);
    assert.equal(after.hits,before.hits+1);
    assert.equal(after.misses,1);
    assert.equal(cache.peek(3,2,3),first,"peek returns the cached record");
  }

  /* 3. One aborted waiter does not abort the shared internal job. */
  {
    const centreDeferred=deferred();
    const calls=[];
    const cache=create({loadGrid:(z,x,y,signal)=>{
      calls.push({z,x,y,signal});
      if(x===1&&y===1)return centreDeferred.promise;
      return Promise.resolve(tile(1));
    }});
    const controller=new AbortController();
    const survivor=cache.prepare(2,1,1);
    const abandoned=cache.prepare(2,1,1,{signal:controller.signal});
    await tick();
    assert.equal(calls.length,5);
    const centreCall=findCall(calls,2,1,1);
    assert.ok(centreCall);
    controller.abort();
    await assert.rejects(abandoned,aborted);
    assert.equal(centreCall.signal.aborted,false,"shared job still running");
    assert.equal(cache.stats().pending,1,"surviving waiter keeps the job");
    centreDeferred.resolve(tile(7));
    const record=await survivor;
    assert.equal(record.grid[(1)*N+1+1],7,"survivor receives the finished record");
    assert.equal(cache.stats().pending,0);
  }

  /* 4. Last waiter abort cancels the job; an old completion cannot remove a newer one. */
  {
    const calls=[];
    const batch=[];
    const cache=create({loadGrid:(z,x,y,signal)=>{
      calls.push({z,x,y,signal});
      if(calls.length<=5){
        const pending=deferred();
        batch.push(pending);
        return pending.promise;
      }
      return Promise.resolve(tile(5));
    }});
    const controller=new AbortController();
    const abandoned=cache.prepare(2,1,1,{signal:controller.signal});
    await tick();
    assert.equal(calls.length,5);
    assert.equal(cache.stats().pending,1);
    controller.abort();
    await assert.rejects(abandoned,aborted);
    assert.equal(cache.stats().pending,0,"last abort removes the pending job");
    assert.equal(calls[0].signal.aborted,true,"last abort cancels the internal signal");

    const newer=await cache.prepare(2,1,1);
    assert.equal(calls.length,10,"next call starts a fresh job");
    assert.equal(cache.stats().pending,0);
    assert.equal(cache.peek(2,1,1),newer);

    for(const pending of batch)pending.resolve(tile(9));
    await tick();await tick();
    assert.equal(cache.stats().pending,0);
    assert.equal(cache.stats().entries,1);
    assert.equal(cache.peek(2,1,1),newer,"stale completion cannot replace the newer record");
    assert.equal(newer.grid[1+1+1],5,"newer record keeps its own data");
  }

  /* 5. clear rejects waiters promptly and stale successes cannot repopulate. */
  {
    const defs=[];
    const cache=create({loadGrid:()=>{
      const pending=deferred();
      defs.push(pending);
      return pending.promise;
    }});
    const waiting=cache.prepare(2,2,2);
    await tick();
    assert.equal(cache.stats().pending,1);
    assert.equal(defs.length,5);
    cache.clear();
    await assert.rejects(waiting,aborted);
    const afterClear=cache.stats();
    assert.equal(afterClear.generation,1);
    assert.equal(afterClear.pending,0);
    assert.equal(afterClear.entries,0);
    assert.equal(afterClear.bytes,0);
    for(const pending of defs)pending.resolve(tile(3));
    await tick();await tick();
    assert.equal(cache.stats().entries,0,"delayed success does not repopulate");
    assert.equal(cache.stats().pending,0);
    assert.equal(cache.peek(2,2,2),undefined);
  }

  /* 6. LRU capacity, zero budget and eviction callback fault tolerance. */
  {
    const evicted=[];
    const cache=create({loadGrid:()=>Promise.resolve(tile(1)),maxBytes:RECORD_BYTES,onEvict:record=>evicted.push(record)});
    const first=await cache.prepare(2,0,0);
    const second=await cache.prepare(2,1,0);
    assert.notEqual(first,second);
    assert.equal(evicted.length,1,"one eviction callback");
    assert.equal(evicted[0],first,"oldest record evicted");
    let stats=cache.stats();
    assert.equal(stats.evictions,1);
    assert.equal(stats.entries,1);
    assert.equal(stats.bytes,RECORD_BYTES);
    assert.equal(cache.peek(2,0,0),undefined);
    assert.equal(cache.peek(2,1,0),second);

    const zero=create({loadGrid:()=>Promise.resolve(tile(2)),maxBytes:0});
    const uncached=await zero.prepare(2,0,0);
    assert.ok(uncached.grid instanceof Float32Array);
    assert.equal(uncached.grid.length,N*N);
    stats=zero.stats();
    assert.equal(stats.entries,0,"zero budget retains nothing");
    assert.equal(stats.bytes,0);
    assert.equal(stats.evictions,0);
    assert.equal(zero.peek(2,0,0),undefined);

    const throwing=create({loadGrid:()=>Promise.resolve(tile(4)),maxBytes:RECORD_BYTES,onEvict:()=>{throw new Error("ignore me");}});
    await throwing.prepare(2,0,0);
    const kept=await throwing.prepare(2,1,0);
    assert.equal(throwing.stats().entries,1);
    assert.equal(throwing.stats().evictions,1);
    assert.equal(throwing.peek(2,1,0),kept);
  }

  /* 7. Coordinate validation and x wrapping. */
  {
    const calls=[];
    const cache=create({loadGrid:(z,x,y)=>{calls.push({z,x,y});return Promise.resolve(tile(1));}});
    for(const args of [[23,0,0],[-1,0,0],[1.5,0,0],["1",0,0],[1,0.5,0],[1,0,-1],[1,0,2]]){
      await assert.rejects(cache.prepare(...args),RangeError,"rejects "+JSON.stringify(args));
    }
    const record=await cache.prepare(1,3,1);
    assert.equal(record.key,"1/1/1");
    assert.equal(record.x,1);
    assert.equal(record.z,1);
    assert.equal(record.y,1);
    assert.equal(calls.length,4,"z=1/y=1 has no south neighbour");
    assert.ok(findCall(calls,1,1,1),"centre normalized");
    assert.ok(findCall(calls,1,0,1),"west normalized");
    assert.ok(findCall(calls,1,0,1),"east wrapped");
    assert.ok(findCall(calls,1,1,0),"north loaded");
    assert.equal(cache.peek(1,-1,1),record,"peek wraps x too");
    await assert.rejects(cache.prepare(1,-1,-1),RangeError);
  }

  /* 8. Neighbour errors clamp the skirt; centre errors reject. */
  {
    const cache=create({loadGrid:(z,x,y)=>{
      if(x===1&&y===1)return Promise.resolve(tile(10));
      if(x===0&&y===1)return Promise.reject(new Error("west failed"));
      if(x===2&&y===1)return Promise.resolve(null);
      if(x===1&&y===0)return Promise.resolve(new Float32Array(10));
      if(x===1&&y===2)return Promise.resolve(tile(50));
      throw new Error("unexpected coordinate");
    }});
    const record=await cache.prepare(2,1,1);
    assert.equal(record.grid[1*N],10,"west failure clamps to centre");
    assert.equal(record.grid[1*N+N-1],10,"east null clamps to centre");
    assert.equal(record.grid[1],10,"north failure clamps to centre");
    assert.equal(record.grid[(N-1)*N+1],50,"south success used");
    assert.equal(cache.stats().pending,0);

    const failingCentre=create({loadGrid:()=>Promise.reject(new Error("centre boom"))});
    await assert.rejects(failingCentre.prepare(2,1,1),/centre boom/);
    assert.equal(failingCentre.stats().pending,0);

    const missingCentre=create({loadGrid:(z,x,y)=>Promise.resolve(x===1&&y===1?null:tile(1))});
    await assert.rejects(missingCentre.prepare(2,1,1),/elevation tile unavailable/);
  }

  /* 9. destroy is idempotent and permanent. */
  {
    const evicted=[];
    const cache=create({loadGrid:()=>Promise.resolve(tile(1)),onEvict:record=>evicted.push(record)});
    const record=await cache.prepare(2,1,1);
    assert.equal(cache.stats().destroyed,false);
    cache.destroy();
    let stats=cache.stats();
    assert.equal(stats.destroyed,true);
    assert.equal(stats.generation,1,"clear runs exactly once");
    assert.equal(stats.entries,0);
    assert.equal(stats.bytes,0);
    assert.equal(stats.pending,0);
    assert.equal(evicted.length,1);
    assert.equal(evicted[0],record);
    cache.destroy();
    assert.equal(cache.stats().generation,1,"double destroy is a no-op");
    await assert.rejects(cache.prepare(0,0,0),error=>error.message==="cache destroyed");
    assert.equal(cache.peek(0,0,0),undefined);

    const pendingDeferred=deferred();
    const pendingCache=create({loadGrid:()=>pendingDeferred.promise});
    const waiting=pendingCache.prepare(1,0,0);
    await tick();
    pendingCache.destroy();
    await assert.rejects(waiting,aborted,"destroy rejects pending subscribers");
    assert.equal(pendingCache.stats().pending,0);
  }

  await tick();await tick();
  assert.deepEqual(unhandled,[],"no unhandled rejections");
  console.log("gpu-terrain-3d-cache tests passed: 9/9");
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
