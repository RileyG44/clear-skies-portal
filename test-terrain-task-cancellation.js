'use strict';
const assert=require('node:assert/strict');
const terrain=require('./engine/terrain');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

(async()=>{
  const runs=[];
  terrain.init({run:(action,args,options)=>new Promise((resolve,reject)=>{
    const job={action,args,options,resolve,reject};runs.push(job);
    options.signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{code:'ABORT_ERR'})),{once:true});
  })},null);
  const a=new AbortController(),b=new AbortController();
  const first=terrain.terrainTask('shared','raw-elevation',{},null,a.signal);
  const other=terrain.terrainTask('shared','raw-elevation',{},null,b.signal);
  assert.equal(runs.length,1);assert.equal(runs[0].options.finishOnAbort,false);
  const cancelled=assert.rejects(first,{code:'ABORT_ERR'});a.abort();await cancelled;
  assert.equal(runs[0].options.signal.aborted,false,'another viewer owns the shared render');
  runs[0].resolve('valid');assert.equal(await other,'valid');

  const departing=new AbortController();
  const obsolete=terrain.terrainTask('revisited','raw-terrain',{},null,departing.signal);
  const rejected=assert.rejects(obsolete,{code:'ABORT_ERR'});departing.abort();
  // Revisit in the same turn, before the aborted promise's finally callback.
  const revisited=terrain.terrainTask('revisited','raw-terrain',{},null,new AbortController().signal);
  assert.equal(runs.length,3,'a fresh viewer never attaches to a cancelled render');
  await rejected;await tick();
  const sharedAgain=terrain.terrainTask('revisited','raw-terrain',{},null,new AbortController().signal);
  assert.equal(runs.length,3,'an old finally callback cannot delete the replacement render');
  runs[2].resolve('current');assert.deepEqual(await Promise.all([revisited,sharedAgain]),['current','current']);
  assert.equal(runs[1].options.signal.aborted,true,'departed raw demand reaches the worker pool');
  console.log('Terrain task cancellation: multiple viewers, final departure, immediate revisit and replacement identity passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
