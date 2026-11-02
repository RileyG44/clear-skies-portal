'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {ElevationTileStore}=require('./gpu-terrain-store'),{RequestPool}=require('./tile-pipeline');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const data=values=>({width:2,height:2,grid:new Float32Array(values)});
const source=(id,rank,nativeZoom=18,extra={})=>({id,rank,label:id,nativeZoom,url:(z,x,y)=>`${id}/${z}/${x}/${y}`,...extra});
const preferred=source('preferred',6),raw=source('raw',3),tile={z:2,x:0,y:0};
function harness(t,sources=[preferred,raw],pool=new RequestPool()){
  const calls=new Map();
  const fetch=(url,signal)=>new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Aborted','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    calls.set(url,{signal,resolve:values=>{signal.removeEventListener('abort',abort);resolve(data(values));},reject});
  });
  const request=(url,o)=>pool.request(url,s=>fetch(url,s),o),store=new ElevationTileStore({sources,request,retryDelayMs:60000});
  t.after(()=>store.destroy());return {store,calls,pool,request};
}
test('GPU full preferred detail promptly retires redundant lower LiDAR and intent',async t=>{
  const {store,calls}=harness(t),loaded=store.want([tile]);await tick();
  calls.get('preferred/2/0/0').resolve([60,60,60,60]);await tick();
  assert.equal(calls.get('raw/2/0/0').signal.aborted,true);
  await loaded;assert.equal(store.settled().refining,false);assert.equal(store.settled().failed,false);
  assert.equal(store.wants('raw/2/0/0'),false);
  assert.deepEqual(Object.keys(store.provenance().ranks),['6']);
  const count=calls.size;await store.want([tile]);
  assert.equal(calls.size,count,'an exact resident preferred tile must not restart redundant raw work');
});
test('GPU full lower LiDAR keeps a pending higher-quality source',async t=>{
  const {store,calls}=harness(t),loaded=store.want([tile]);await tick();
  calls.get('raw/2/0/0').resolve([30,30,30,30]);await tick();
  assert.equal(calls.get('preferred/2/0/0').signal.aborted,false);assert.equal(store.settled().refining,true);
  calls.get('preferred/2/0/0').resolve([60,NaN,60,NaN]);await loaded;
  assert.equal(store.settled().ratio,1);assert.ok(store.provenance().ranks[3]>0);
});
for(const partial of [false,true])test(`GPU shared native parent stays until all children release it (partial=${partial})`,async t=>{
  const {store,calls}=harness(t,[preferred,source('raw',3,1)]);
  const loaded=store.want([tile,{z:2,x:1,y:0}]);await tick();
  assert.equal(calls.size,3,'both display children share one raw parent');
  calls.get('preferred/2/0/0').resolve([60,60,60,60]);await tick();
  assert.equal(calls.get('raw/1/0/0').signal.aborted,false,'one full child cannot drop its neighbour’s fallback');
  calls.get('preferred/2/1/0').resolve(partial?[NaN,NaN,60,60]:[60,60,60,60]);await tick();
  assert.equal(calls.get('raw/1/0/0').signal.aborted,!partial);
  if(partial)calls.get('raw/1/0/0').resolve([30,30,30,30]);
  await loaded;assert.equal(store.settled().ratio,1);assert.equal(store.settled().refining,false);
});
test('GPU retirement drops only its own shared transport consumer',async t=>{
  const {store,calls,request}=harness(t),owner=new AbortController();
  const other=request('raw/2/0/0',{signal:owner.signal});
  const loaded=store.want([tile]);await tick();calls.get('preferred/2/0/0').resolve([60,60,60,60]);await tick();
  assert.equal(calls.get('raw/2/0/0').signal.aborted,false);
  assert.equal(store.settled().refining,false);await loaded;
  calls.get('raw/2/0/0').resolve([30,30,30,30]);await other;
  assert.equal(store.stats().tiles,1,'the redundant late response cannot enter this store');
});
test('GPU retirement removes redundant failures and stationary retries',async t=>{
  const {store,calls}=harness(t),loaded=store.want([tile]);await tick();
  calls.get('raw/2/0/0').reject(Error('outage'));await tick();assert.equal(store.settled().failed,true);
  calls.get('preferred/2/0/0').resolve([60,60,60,60]);await loaded;
  assert.equal(store.settled().failed,false);assert.equal(store._failed.size,0);assert.equal(store._retryTimer,0);
});
test('GPU coarse preferred coverage cannot suppress requested finer raw detail',async t=>{
  const {store,calls}=harness(t),coarse=store.want([{z:1,x:0,y:0}]);await tick();
  calls.get('preferred/1/0/0').resolve([60,60,60,60]);calls.get('raw/1/0/0').resolve([30,30,30,30]);await coarse;
  const fine=store.want([tile]);await tick();
  assert.ok(calls.has('raw/2/0/0'),'only the requested target can prove that raw is redundant');
  calls.get('preferred/2/0/0').resolve([NaN,NaN,NaN,NaN]);calls.get('raw/2/0/0').resolve([30,30,30,30]);await fine;
  assert.equal(store.finestFor('raw',tile).z,2);
});
test('GPU a superseded view cannot retire a shared parent needed by the new view',async t=>{
  const {store,calls}=harness(t,[preferred,source('raw',3,1)]);
  const old=store.want([tile]);await tick();
  const current=store.want([tile,{z:2,x:1,y:0}]);await tick();
  calls.get('preferred/2/0/0').resolve([60,60,60,60]);await tick();
  assert.equal(calls.get('raw/1/0/0').signal.aborted,false);
  calls.get('preferred/2/1/0').resolve([NaN,NaN,NaN,NaN]);await tick();
  calls.get('raw/1/0/0').resolve([30,30,30,30]);await Promise.all([old,current]);
  assert.equal(store.settled().ratio,1);assert.equal(store.settled().refining,false);
});
test('GPU masked partial data cannot establish full preferred coverage',async t=>{
  const {store,calls}=harness(t);store.options.mask=(grid,w,h,c,s)=>{if(s.rank===6)grid[0]=NaN;return grid;};
  const loaded=store.want([tile]);await tick();calls.get('preferred/2/0/0').resolve([60,60,60,60]);await tick();
  assert.equal(calls.get('raw/2/0/0').signal.aborted,false);
  calls.get('raw/2/0/0').resolve([30,30,30,30]);await loaded;assert.equal(store.settled().ratio,1);
});
