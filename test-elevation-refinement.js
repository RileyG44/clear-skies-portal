'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {RequestPool}=require('./tile-pipeline'),{elevationLayer}=require('./test-fixtures/elevation-layer');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const data=values=>({width:Math.sqrt(values.length),height:Math.sqrt(values.length),grid:new Float32Array(values)});
const options={rawEndpoint:'/raw',nationalEndpoint:'/national',fallback:'/base/{z}/{x}/{y}',tileSize:2};
function harness(hidpi=false,pool){
  const calls=new Map();
  const context=elevationLayer({hidpi,pool,fetchElevation:(url,signal)=>new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Aborted','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    calls.set(url,{signal,resolve:value=>{signal.removeEventListener('abort',abort);resolve(data(value));},reject});
  })});
  const layer=new context.Layer(options),canvas={width:2,height:2,dataset:{}};
  return {calls,context,layer,canvas};
}
test('CPU starts HiDPI refinement while slower baseline sources are pending',async()=>{
  const {layer,canvas,calls}=harness(true);
  const loaded=layer._loadTile({z:17,x:4,y:4},canvas,()=>{});await tick();
  calls.get('/raw/16/2/2.png?ix=3').resolve(Array.from({length:16},(_,i)=>i%4===0?50:NaN));await tick();
  assert.ok(calls.has('/raw/17/4/4.png?ix=3'),'available best data must sharpen before national/overview settle');
  calls.get('/raw/17/4/4.png?ix=3').resolve([60,NaN,60,NaN]);await tick();
  assert.deepEqual([...layer._store.get('17/4/4').elev],[60,NaN,60,NaN]);
  calls.get('/national/16/2/2.png').resolve([20,20,20,20]);
  calls.get('/base/16/2/2').resolve([10,10,10,10]);await loaded;
  assert.deepEqual([...layer._store.get('17/4/4').elev],[60,20,60,20]);
  assert.equal(canvas._cspRefining,false);assert.equal(canvas._cspRefineFailed,false);
});
test('CPU full detail releases redundant sources without failing refinement',async()=>{
  const {layer,canvas,calls}=harness();
  const loaded=layer._loadTile({z:16,x:4,y:4},canvas,()=>{});await tick();
  calls.get('/raw/16/4/4.png?ix=3').resolve([50,50,50,50]);await tick();
  assert.equal(calls.get('/national/16/4/4.png').signal.aborted,true);
  assert.equal(calls.get('/base/16/4/4').signal.aborted,true);
  const results=await loaded;
  assert.equal(results.some(r=>r.status==='rejected'),false,'discarded fallback is not a refinement failure');
  assert.equal(canvas._cspRefining,false);assert.equal(canvas._cspRefineFailed,false);
  assert.equal(layer._pending.size,0);
});
test('CPU releases its own wait while another layer retains the shared source',async()=>{
  const pool=new RequestPool(),{layer,canvas,calls,context}=harness(false,pool);
  const owner=new AbortController();
  const other=pool.request('/national/16/4/4.png',s=>context.fetchElevation('/national/16/4/4.png',s),{signal:owner.signal});
  const loaded=layer._loadTile({z:16,x:4,y:4},canvas,()=>{});await tick();
  calls.get('/raw/16/4/4.png?ix=3').resolve([50,50,50,50]);await tick();
  assert.equal(calls.get('/national/16/4/4.png').signal.aborted,false,'another owner retains the transport');
  assert.equal(canvas._cspRefining,false,'another owner cannot hold this tile in refinement');
  await loaded;calls.get('/national/16/4/4.png').resolve([20,20,20,20]);await other;
  assert.deepEqual([...layer._store.get('16/4/4').elev],[50,50,50,50]);
});
test('CPU a late preferred source sharpens and cancels superseded lower refinement',async()=>{
  const {context,calls}=harness(true),layer=new context.Layer({...options,dnrEndpoint:'/dnr'}),canvas={width:2,height:2,dataset:{}};
  const loaded=layer._loadTile({z:17,x:4,y:4},canvas,()=>{});await tick();
  calls.get('/raw/16/2/2.png?ix=3').resolve(new Array(16).fill(30));await tick();
  assert.ok(calls.has('/raw/17/4/4.png?ix=3'),'raw can sharpen while preferred data is still pending');
  assert.equal(calls.get('/dnr/16/2/2.png?acquire=0&revision=1').signal.aborted,false);
  calls.get('/dnr/16/2/2.png?acquire=0&revision=1').resolve(new Array(16).fill(50));await tick();
  assert.equal(calls.get('/raw/17/4/4.png?ix=3').signal.aborted,true,'full higher rank retires the raw sharp wait');
  assert.ok(calls.has('/dnr/17/4/4.png?acquire=0&revision=1'));
  calls.get('/dnr/17/4/4.png?acquire=0&revision=1').resolve([60,NaN,60,NaN]);
  const results=await loaded;assert.equal(results.some(r=>r.status==='rejected'),false);
  assert.deepEqual([...layer._store.get('17/4/4').elev],[60,50,60,50]);
  assert.equal(canvas._cspSourceCounts[5],4);assert.equal(canvas._cspRefining,false);
});
test('CPU partial preferred coverage retains lower pixels but drops fully replaced tiers',async()=>{
  const {context,calls}=harness(),layer=new context.Layer({...options,dnrEndpoint:'/dnr'}),canvas={width:2,height:2,dataset:{}};
  const loaded=layer._loadTile({z:16,x:4,y:4},canvas,()=>{});await tick();
  calls.get('/dnr/16/4/4.png?acquire=0&revision=1').resolve([50,NaN,50,NaN]);await tick();
  assert.equal(calls.get('/raw/16/4/4.png?ix=3').signal.aborted,false);
  calls.get('/raw/16/4/4.png?ix=3').resolve([30,30,30,30]);await loaded;
  assert.equal(calls.get('/national/16/4/4.png').signal.aborted,true);
  assert.equal(calls.get('/base/16/4/4').signal.aborted,true);
  assert.deepEqual([...layer._store.get('16/4/4').elev],[50,30,50,30]);
  assert.equal(canvas._cspSourceCounts[5],2);assert.equal(canvas._cspSourceCounts[3],2);
});
test('CPU preferred outage preserves lower fallback and the genuine failure',async()=>{
  const {layer,canvas,calls}=harness(),loaded=layer._loadTile({z:16,x:4,y:4},canvas,()=>{});await tick();
  calls.get('/raw/16/4/4.png?ix=3').reject(Error('provider outage'));
  calls.get('/national/16/4/4.png').resolve([20,20,20,20]);await loaded;
  assert.equal(calls.get('/base/16/4/4').signal.aborted,true);
  assert.equal(canvas._cspRefineFailed,true,'a missing better source remains eligible for recovery');
  assert.deepEqual([...layer._store.get('16/4/4').elev],[20,20,20,20]);
});
test('CPU unloading during early sharpening cancels every remaining consumer',async()=>{
  const {layer,calls}=harness(true);let done=0;
  const display={z:16,x:4,y:4},canvas=layer.createTile(display,()=>done++);await tick();
  calls.get('/raw/16/2/2.png?ix=3').resolve(new Array(16).fill(30));await tick();
  assert.equal(done,1);assert.ok(calls.has('/raw/17/4/4.png?ix=3'));
  layer.fire('tileunload',{coords:display,tile:canvas});await tick();
  assert.equal(calls.get('/raw/17/4/4.png?ix=3').signal.aborted,true);
  assert.equal(layer._store.size,0);assert.equal(layer._pending.size,0);assert.equal(canvas.width,0);
});
test('CPU available detail sharpens before queued overview when numeric fallback is at capacity',async()=>{
  const pool=new RequestPool({concurrency:2,groupLimits:{national:1}});
  let finishNational;
  const occupied=pool.request('other-national',()=>new Promise(resolve=>{finishNational=resolve;}),{priority:2,group:'national'});
  const {layer,canvas,calls}=harness(true,pool);
  const loaded=layer._loadTile({z:17,x:4,y:4},canvas,()=>{});await tick();
  calls.get('/raw/16/2/2.png?ix=3').resolve(Array.from({length:16},(_,i)=>i%4===0?50:NaN));await tick();
  assert.ok(calls.has('/raw/17/4/4.png?ix=3'),'queued detail must not wait behind overview');
  assert.equal(calls.has('/national/16/2/2.png'),false);
  calls.get('/raw/17/4/4.png?ix=3').resolve([60,NaN,60,NaN]);await tick();
  finishNational(null);await occupied;await tick();
  assert.ok(calls.has('/national/16/2/2.png'),'needed numeric fallback keeps its source capacity');
  calls.get('/national/16/2/2.png').resolve([20,20,20,20]);await loaded;
  assert.deepEqual([...layer._store.get('17/4/4').elev],[60,20,60,20]);
});
