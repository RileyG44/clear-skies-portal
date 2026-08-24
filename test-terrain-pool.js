"use strict";
const assert=require("assert/strict");
const path=require("path");
const {TerrainPool}=require("./terrain-pool.js");

async function rejectsCode(promise,code){
  await assert.rejects(promise,error=>error&&error.code===code);
}

async function main(){
  const workerFile=path.join(__dirname,"test-terrain-worker-fixture.js");
  const pool=new TerrainPool({cacheDir:__dirname,size:1,maxQueue:8,workerFile});
  try{
    const blocker=pool.run("delay",{ms:60,value:"blocker"});
    const low=pool.run("echo",{value:"low"},{priority:1});
    const high=pool.run("echo",{value:"high"},{priority:100});
    assert.equal(await blocker,"blocker");
    assert.deepEqual(await high,{value:"high"});
    assert.deepEqual(await low,{value:"low"});

    const transferred=new Float32Array([1.25,2.5,5]);
    const transferResult=await pool.run("echo",{grid:transferred},{transferList:[transferred.buffer]});
    assert.equal(transferred.buffer.byteLength,0,"large analysis grids transfer without a main-thread clone");
    assert.deepEqual(Array.from(transferResult.grid),[1.25,2.5,5]);
    const detached=new ArrayBuffer(8);structuredClone(detached,{transfer:[detached]});
    await rejectsCode(pool.run("echo",{badTransfer:true},{transferList:[detached]}),"TRANSFER_ERROR");
    assert.equal(pool.stats().restarted,0,"a caller transfer error must not restart a healthy worker");
    assert.deepEqual(await pool.run("echo",{afterTransferError:true}),{afterTransferError:true});

    pool.maxQueue=2;
    const pressure=pool.run("delay",{ms:80,value:"pressure"});
    const queuedOne=pool.run("echo",{queued:1});
    const queuedTwo=pool.run("echo",{queued:2});
    await rejectsCode(pool.run("echo",{overflow:true}),"QUEUE_FULL");
    assert.equal(await pressure,"pressure");
    assert.deepEqual(await queuedOne,{queued:1});
    assert.deepEqual(await queuedTwo,{queued:2});
    pool.maxQueue=8;

    const controller=new AbortController();
    const running=pool.run("spin",{ms:250},{timeoutMs:1000,signal:controller.signal});
    setTimeout(()=>controller.abort(),20);
    await rejectsCode(running,"ABORT_ERR");

    await new Promise(resolve=>setTimeout(resolve,80));
    assert.deepEqual(await pool.run("echo",{recovered:true}),{recovered:true});
    assert.equal(pool.stats().restarted,0,"a cancelled job that finishes during grace keeps its warm worker");

    const cacheController=new AbortController();
    const cacheable=pool.run("delay",{ms:70,value:"cacheable"},{timeoutMs:1000,signal:cacheController.signal,finishOnAbort:true});
    setTimeout(()=>cacheController.abort(),15);
    assert.equal(await cacheable,"cacheable","active cacheable work finishes after its client leaves");
    await rejectsCode(pool.run("spin",{ms:250},{timeoutMs:20}),"TIMEOUT");
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.deepEqual(await pool.run("echo",{afterTimeout:true}),{afterTimeout:true});

    const stats=pool.stats();
    assert.equal(stats.workers,1);
    assert(stats.completed>=4);
    assert(stats.cancelled>=1);
    assert(stats.timedOut>=1);
  }finally{ await pool.close() }
  console.log("terrain worker pool checks passed");
}

main().catch(error=>{ console.error(error); process.exitCode=1 });
