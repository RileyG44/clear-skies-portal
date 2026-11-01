'use strict';
const assert=require('node:assert/strict');
const {fixture}=require('./test-fixtures/terrain-warming.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ref=process.env.CSP_TEST_BASELINE;
async function check(options,run){const f=fixture({ref,...options});try{await run(f);}finally{f.close();await tick();}}
(async()=>{
  await check({slots:8},async f=>{
    assert.equal((await f.hit()).status,200);
    assert.equal(f.jobs.length,0,'a cache hit returns before speculative work is admitted');
    await f.clock.advance(160);
    assert.equal(f.jobs.length,1,'only one speculative neighbour starts after the idle pause');
    await f.clock.advance(160*10+400*10);
    assert(f.jobs.length<=12,'warming remains bounded per window');
    assert.equal(f.maxActive,1,'idle warming never floods otherwise free workers');
  });
  await check({},async f=>{
    await f.hit();await f.clock.advance(160);assert.equal(f.pool.stats().active,1);
    const warm=f.jobs[0];
    const visible=f.terrain.terrainTask('visible','raw-elevation',{}, {priority:55},new AbortController().signal);
    assert.equal(warm.cancelled,true,'current demand cancels a different speculative render');
    await f.clock.advance(10);await visible;
    assert.equal(f.jobs.filter(j=>j.options.priority>=0).length,1);
    await f.clock.advance(10000);
    assert.equal(f.jobs.length,2,'discarded warm candidates cannot resume behind the new viewport');
    assert.equal(f.pool.stats().active,0);assert.equal(f.pool.stats().queued,0);
  });
  await check({},async f=>{
    await f.hit();await f.clock.advance(160);
    const warm=f.jobs[0],{z,x,y,style}=warm.args;
    const jobKey=`raw-terrain:${f.terrain.TERRAIN_RENDER_VERSION}:${style}:${z}/${x}/${y}`;
    const controller=new AbortController();
    const joined=f.terrain.terrainTask(jobKey,'raw-terrain',warm.args,{priority:40},controller.signal);
    assert.equal(warm.cancelled,false,'joining the warm neighbour keeps its useful render alive');
    assert.equal(f.jobs.length,1,'warm and visible consumers share one render');
    const other=f.terrain.terrainTask('other','raw-elevation',{}, {priority:55},new AbortController().signal);
    assert.equal(warm.cancelled,false,'later demand cannot cancel the visible owner of a former warm render');
    await f.clock.advance(410);assert.deepEqual(await joined,f.result);await other;
    await f.clock.advance(10000);assert.equal(f.jobs.length,2,'joining also discards speculative siblings');
  });
  await check({},async f=>{
    await f.hit();
    const visible=f.terrain.terrainTask('arrives-during-pause','raw-elevation',{}, {priority:55});
    await f.clock.advance(10000);await visible;
    assert.equal(f.jobs.length,1,'new demand during the idle pause prevents warm requests entirely');
  });
  console.log('Terrain warming: idle admission, one-job limit, rate bound, foreground cancellation and shared visible ownership passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
