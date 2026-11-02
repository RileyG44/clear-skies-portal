'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {ElevationTileStore}=require('./gpu-terrain-store'),{RequestPool}=require('./tile-pipeline');
const tick=()=>new Promise(r=>setImmediate(r)),data=values=>({width:2,height:2,grid:new Float32Array(values)});
const full=[30,30,30,30],empty=[NaN,NaN,NaN,NaN];
const raw={id:'raw',rank:3,label:'raw',nativeZoom:18,standIn:2,url:(z,x,y)=>`raw/${z}/${x}/${y}`};
const preferred={id:'preferred',rank:6,label:'preferred',nativeZoom:18,url:(z,x,y)=>`preferred/${z}/${x}/${y}`};
function harness(t,sources=[raw]){
  const calls=new Map(),pool=new RequestPool({concurrency:20});
  const store=new ElevationTileStore({sources,retryDelayMs:60000,request:(url,o)=>pool.request(url,s=>new Promise((resolve,reject)=>{
    const abort=()=>reject(Error('Aborted'));s.addEventListener('abort',abort,{once:true});
    calls.set(url,{signal:s,resolve:v=>{s.removeEventListener('abort',abort);resolve(data(v));},reject});
  }),o)});t.after(()=>store.destroy());return {store,calls};
}
test('GPU coarse stand-in retires once every display child has full requested detail',async t=>{
  const {store,calls}=harness(t),tiles=[{z:4,x:0,y:0},{z:4,x:1,y:0}],loaded=store.want(tiles);await tick();
  calls.get('raw/4/0/0').resolve(full);await tick();assert.equal(calls.get('raw/2/0/0').signal.aborted,false);
  calls.get('raw/4/1/0').resolve(full);await loaded;await tick();
  assert.equal(calls.get('raw/2/0/0').signal.aborted,true);
  assert.equal(store.wants('raw/2/0/0'),false);assert.equal(store.settled().refining,false);
});
test('GPU partial fine coverage retains its stand-in and useful coarse pixels',async t=>{
  const {store,calls}=harness(t),loaded=store.want([{z:4,x:0,y:0}]);await tick();
  calls.get('raw/4/0/0').resolve(empty);await loaded;
  assert.equal(calls.get('raw/2/0/0').signal.aborted,false);
  calls.get('raw/2/0/0').resolve(full);await tick();assert.equal(store.settled().ratio,1);
});
test('GPU full higher source also retires raw stand-in and avoids it on revisit',async t=>{
  const {store,calls}=harness(t,[preferred,raw]),tiles=[{z:4,x:0,y:0}],loaded=store.want(tiles);await tick();
  calls.get('preferred/4/0/0').resolve(full);await loaded;await tick();
  assert.equal(calls.get('raw/2/0/0').signal.aborted,true);
  const count=calls.size,coarse=calls.get('raw/2/0/0');await store.want(tiles);await tick();
  assert.equal(calls.size,count);assert.equal(calls.get('raw/2/0/0'),coarse,'resident preferred detail makes new raw stand-ins unnecessary');
});
test('GPU a completed stand-in failure is removed once fine coverage makes it redundant',async t=>{
  const {store,calls}=harness(t),loaded=store.want([{z:4,x:0,y:0}]);await tick();
  calls.get('raw/2/0/0').reject(Error('outage'));await tick();assert.equal(store.settled().failed,true);
  calls.get('raw/4/0/0').resolve(full);await loaded;await tick();
  assert.equal(store.settled().failed,false);assert.equal(store._failed.size,0);assert.equal(store._retryTimer,0);
});
test('GPU stale callbacks cannot retire a stand-in needed by the newer viewport',async t=>{
  const {store,calls}=harness(t),old=store.want([{z:4,x:0,y:0}]);await tick();
  const current=store.want([{z:4,x:0,y:0},{z:4,x:1,y:0}]);await tick();
  calls.get('raw/4/0/0').resolve(full);await tick();assert.equal(calls.get('raw/2/0/0').signal.aborted,false);
  calls.get('raw/4/1/0').resolve(empty);await Promise.all([old,current]);
  assert.equal(calls.get('raw/2/0/0').signal.aborted,false);calls.get('raw/2/0/0').resolve(full);await tick();
});
test('GPU stand-in retirement retains another layer’s shared transport consumer',async t=>{
  const {store,calls}=harness(t),loaded=store.want([{z:4,x:0,y:0}]);await tick();
  const owner=new AbortController(),other=store.options.request('raw/2/0/0',{signal:owner.signal});
  calls.get('raw/4/0/0').resolve(full);await loaded;await tick();
  assert.equal(calls.get('raw/2/0/0').signal.aborted,false);assert.equal(store.settled().refining,false);
  calls.get('raw/2/0/0').resolve(full);await other;await tick();
  assert.equal(store.stats().tiles,1,'late shared coarse data is not reinserted into the retired store');
});
test('GPU stand-in sharing a requested native target is retained for that target',async t=>{
  const {store,calls}=harness(t),loaded=store.want([{z:4,x:0,y:0},{z:2,x:0,y:0}]);await tick();
  calls.get('raw/4/0/0').resolve(full);await tick();
  assert.equal(calls.get('raw/2/0/0').signal.aborted,false,'another display still requests this native tile as its exact target');
  calls.get('raw/2/0/0').resolve(full);await loaded;await tick();
  assert.equal(calls.get('raw/0/0/0').signal.aborted,true);
  assert.equal(store.settled().refining,false);
});
