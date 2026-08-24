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
