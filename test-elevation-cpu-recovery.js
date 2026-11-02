'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{getEventListeners}=require('node:events');
const {elevationLayer}=require('./test-fixtures/elevation-layer');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const options={tileSize:2,rawEndpoint:'/raw',nationalEndpoint:'/national',fallback:'/base/{z}/{x}/{y}'};
const coords={z:16,x:4,y:4},raw='/raw/16/4/4.png?ix=3',national='/national/16/4/4.png';
function harness(hidpi=false){
  const timers=new Map(),calls=[];let id=0;
  const context=elevationLayer({hidpi,globals:{setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key)},
    fetchElevation:(url,signal)=>new Promise((resolve,reject)=>{
      const abort=()=>reject(new DOMException('Aborted','AbortError'));
      signal.addEventListener('abort',abort,{once:true});
      calls.push({url,signal,resolve:values=>{signal.removeEventListener('abort',abort);resolve(values?{width:Math.sqrt(values.length),height:Math.sqrt(values.length),grid:new Float32Array(values)}:null);},reject});
    })});
  const layer=new context.Layer(options),canvas={width:2,height:2,dataset:{}};
  const latest=url=>calls.filter(c=>c.url===url).at(-1);
  const retry=()=>{assert.equal(timers.size,1);const [key,timer]=[...timers][0];timers.delete(key);return {ms:timer.ms,completion:timer.fn()};};
  return {layer,canvas,context,timers,calls,latest,retry};
}
async function failedBase(h){
  let done=0;const loaded=h.layer._loadTile(coords,h.canvas,()=>done++);await tick();
  h.latest(raw).reject(Error('provider exhausted short retries'));h.latest(national).resolve([20,20,20,20]);
  const result=await loaded;assert(result.some(r=>r.status==='rejected'));
  return ()=>done;
}
test('CPU retries only failed source work while stationary and keeps useful coverage',async()=>{
  const h=harness(),done=await failedBase(h),pending=h.layer._pending.get('16/4/4');
  assert.equal(h.canvas._cspRefining,true);assert.equal(h.canvas._cspRefineFailed,true);
  const count=h.calls.length,{completion,ms}=h.retry();assert.equal(ms,1000);await tick();
  assert.equal(h.calls.length,count+1);assert.equal(h.calls.at(-1).url,raw);
  assert.deepEqual([...h.layer._store.get('16/4/4').elev],[20,20,20,20]);
  h.latest(raw).resolve([60,60,60,60]);await completion;
  assert.deepEqual([...h.layer._store.get('16/4/4').elev],[60,60,60,60]);
  assert.equal(h.canvas._cspRefining,false);assert.equal(h.canvas._cspRefineFailed,false);
  assert.equal(h.layer._pending.size,0);assert.equal(h.timers.size,0);assert.equal(done(),1);
  assert.equal(getEventListeners(pending.controller.signal,'abort').length,0);
});
test('CPU failed sharpening retries without reloading successful coarse data',async()=>{
  const h=harness(true),loaded=h.layer._loadTile({z:17,x:4,y:4},h.canvas,()=>{});await tick();
  h.latest('/raw/16/2/2.png?ix=3').resolve(new Array(16).fill(50));await tick();
  const sharp='/raw/17/4/4.png?ix=3';h.latest(sharp).reject(Error('sharp source timed out'));await loaded;
  const before=h.calls.length,{completion}=h.retry();await tick();
  assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).url,sharp);
  h.latest(sharp).resolve([60,NaN,60,NaN]);await completion;
  assert.deepEqual([...h.layer._store.get('17/4/4').elev],[60,50,60,50]);
  assert.equal(h.canvas._cspRefineFailed,false);assert.equal(h.timers.size,0);
});
test('CPU confirmed nodata is final and does not cause retry traffic',async()=>{
  const h=harness(),loaded=h.layer._loadTile(coords,h.canvas,()=>{});await tick();
  h.latest(raw).resolve(null);h.latest(national).resolve([20,20,20,20]);await loaded;
  assert.equal(h.timers.size,0);assert.equal(h.canvas._cspRefining,false);assert.equal(h.canvas._cspRefineFailed,false);
});
test('CPU repeated provider failures back off to a bounded retry rate',async()=>{
  const h=harness();await failedBase(h);const delays=[];
  for(let i=0;i<8;i++){
    const {completion,ms}=h.retry();delays.push(ms);await tick();h.latest(raw).reject(Error('still offline'));await completion;
  }
  assert.deepEqual(delays,[1000,2000,4000,8000,16000,30000,30000,30000]);
  assert.equal(h.calls.filter(c=>c.url===national).length,1);
  h.layer.fire('tileunload',{coords,tile:h.canvas});assert.equal(h.timers.size,0);assert.equal(h.layer._pending.size,0);
});
test('CPU unloading during backoff releases its timer and ownership',async()=>{
  const h=harness();await failedBase(h);const pending=h.layer._pending.get('16/4/4');
  h.layer.fire('tileunload',{coords,tile:h.canvas});
  assert.equal(h.timers.size,0);assert.equal(h.layer._pending.size,0);assert.equal(h.layer._store.size,0);
  assert.equal(getEventListeners(pending.controller.signal,'abort').length,0);
});
test('CPU removing a recovering layer preserves another consumer of its retry',async()=>{
  const h=harness();await failedBase(h);const {completion}=h.retry();await tick();
  const other=h.context.elevationRequests.request(raw,()=>{throw Error('must share existing recovery');},{group:'detail'});
  h.layer.fire('remove',{});await completion;
  assert.equal(h.latest(raw).signal.aborted,false);assert.equal(h.layer._pending.size,0);assert.equal(h.timers.size,0);
  h.latest(raw).resolve([60,60,60,60]);await other;
  assert.deepEqual([...h.layer._store.get('16/4/4').elev],[20,20,20,20],'a removed layer cannot accept late recovery');
});
test('CPU unavailable first attempt can recover without repeating the tile completion callback',async()=>{
  const h=harness(),errors=[];let visible=false;
  const loaded=h.layer._loadTile(coords,h.canvas,error=>{errors.push(error);visible=!error;});await tick();
  for(const call of h.calls)call.reject(Error('all providers unavailable'));await loaded;
  assert.equal(errors.length,0,'keep Leaflet completion pending while automatic recovery can succeed');
  assert.equal(visible,false);assert.equal(h.timers.size,1);
  const {completion}=h.retry();await tick();h.latest(raw).resolve([60,60,60,60]);await completion;
  assert.equal(errors.length,1);assert.ifError(errors[0]);assert.equal(visible,true);
  assert.equal(h.canvas._cspHasContent,true);assert.equal(h.canvas._cspRefineFailed,false);
  assert.equal(h.layer._pending.size,0);assert.equal(h.timers.size,0);
});
test('CPU replacing source options cancels the prior stationary recovery',async()=>{
  const h=harness();await failedBase(h);
  h.layer._tiles={tile:{current:true,coords,el:h.canvas}};
  h.layer.setSourceOptions({sourceKey:'new',rawEndpoint:'/new-raw'});await tick();
  assert.equal(h.timers.size,0);assert.equal(h.calls.filter(c=>c.url===raw).length,1);
  assert.equal(h.calls.filter(c=>c.url==='/new-raw/16/4/4.png?ix=3').length,1);
  h.latest('/new-raw/16/4/4.png?ix=3').resolve([70,70,70,70]);await tick();
  assert.deepEqual([...h.layer._store.get('16/4/4').elev],[70,70,70,70]);assert.equal(h.layer._pending.size,0);
});
