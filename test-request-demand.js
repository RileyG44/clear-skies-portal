'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {RequestPool}=require('./tile-pipeline'),{ElevationTileStore}=require('./gpu-terrain-store');
const tick=()=>new Promise(r=>setImmediate(r));
function held(pool,key,options={}){
  let finish;
  const promise=pool.request(key,()=>new Promise(resolve=>{finish=resolve;}),options);
  return {promise,finish:value=>finish(value)};
}
test('one background consumer cannot demote another foreground owner of a shared tile',async()=>{
  const pool=new RequestPool({concurrency:1}),bg=new AbortController(),fg=new AbortController(),order=[];
  const loader=key=>()=>{order.push(key);return null;};
  const a=pool.request('shared',loader('shared'),{signal:bg.signal,background:true,group:'backdrop',priority:99});
  const b=pool.request('shared',loader('shared'),{signal:fg.signal,group:'detail',priority:5});
  const other=pool.request('other',loader('other'),{priority:4,group:'detail'});
  pool.prioritize('shared',.5,{signal:bg.signal,background:true,group:'backdrop'});
  await Promise.all([a,b,other]);assert.deepEqual(order,['shared','other']);
});
test('departing foreground ownership restores background accounting and source group',async()=>{
  const pool=new RequestPool({concurrency:1}),fg=new AbortController(),bg=new AbortController();
  const a=held(pool,'shared',{signal:fg.signal,priority:5,group:'detail'});
  const rejected=assert.rejects(a.promise,{name:'AbortError'});
  const b=pool.request('shared',()=>{throw Error('duplicate');},{signal:bg.signal,background:true,priority:1,group:'backdrop'});await tick();
  fg.abort();await rejected;
  assert.equal(pool.foregroundActive,0);assert.equal(pool.backgroundActive,1);
  assert.equal(pool.groupActive.get('detail'),0);assert.equal(pool.groupActive.get('backdrop'),1);
  a.finish(null);await b;await tick();assert.equal(pool.active,0);assert.equal(pool.backgroundActive,0);
});
test('departing high-priority owner removes its queued priority',async()=>{
  const pool=new RequestPool({concurrency:1}),block=held(pool,'block');await tick();
  const fg=new AbortController(),order=[],loader=key=>()=>{order.push(key);return null;};
  const low=pool.request('shared',loader('shared'),{priority:1,group:'detail'});
  const high=pool.request('shared',loader('shared'),{signal:fg.signal,priority:9,group:'detail'});
  const rejected=assert.rejects(high,{name:'AbortError'}),other=pool.request('other',loader('other'),{priority:5,group:'detail'});
  fg.abort();await rejected;block.finish(null);await Promise.all([block.promise,low,other]);assert.deepEqual(order,['other','shared']);
});
test('unknown owner cannot reprioritize another owner; unscoped calls retain compatibility',async()=>{
  const pool=new RequestPool({concurrency:1}),owner=new AbortController(),unknown=new AbortController();
  const a=held(pool,'a',{signal:owner.signal,priority:3,group:'detail'});await tick();
  pool.prioritize('a',1,{signal:unknown.signal,background:true,group:'backdrop'});
  assert.equal(pool.jobs.get('a').group,'detail');assert.equal(pool.foregroundActive,1);
  pool.prioritize('a',1,{background:true,group:'backdrop'});
  assert.equal(pool.jobs.get('a').group,'backdrop');assert.equal(pool.backgroundActive,1);
  a.finish(null);await a.promise;
});
test('GPU source stores pass independent owners through shared reprioritization',async t=>{
  const pool=new RequestPool({concurrency:2}),spec={id:'raw',rank:3,label:'raw',nativeZoom:18,group:'detail',url:(z,x,y)=>`${z}/${x}/${y}`},jobs=new Map();
  const options={sources:[spec],prioritize:(...args)=>pool.prioritize(...args),request:(url,o)=>pool.request(url,s=>new Promise((resolve,reject)=>{
    jobs.set(url,{resolve,signal:s});s.addEventListener('abort',()=>reject(Error('Aborted')),{once:true});
  }),o)};
  const visible=new ElevationTileStore(options),background=new ElevationTileStore(options);t.after(()=>{visible.destroy();background.destroy();});
  visible.want([{z:4,x:0,y:0}]);background.want([{z:4,x:0,y:0}],{bounds:{z:4,x0:1,x1:1,y0:0,y1:0}});await tick();
  background.want([{z:4,x:0,y:0}],{bounds:{z:4,x0:1,x1:1,y0:0,y1:0}});await tick();
  assert.equal(pool.jobs.get('4/0/0').background,false,'background view updates cannot demote visible terrain in another store');
  visible.want([]);await tick();assert.equal(pool.jobs.get('4/0/0').background,true);
  assert.equal(jobs.get('4/0/0').signal.aborted,false,'the remaining background owner keeps the shared request');
  jobs.get('4/0/0').resolve({width:1,height:1,grid:new Float32Array([20])});await tick();
});
test('foreground intent dominates background priority regardless of registration order',async()=>{
  for(const firstBackground of [false,true]){
    const pool=new RequestPool({concurrency:1}),order=[],fg=new AbortController(),bg=new AbortController();
    const loader=key=>()=>{order.push(key);return null;};
    const opts=[{signal:fg.signal,group:'detail',priority:3},{signal:bg.signal,group:'backdrop',background:true,priority:99}];
    if(firstBackground)opts.reverse();
    const owners=opts.map(o=>pool.request('shared',loader('shared'),o));
    const other=pool.request('other',loader('other'),{group:'detail',priority:4});
    await Promise.all([...owners,other]);
    assert.deepEqual(order,['other','shared'],'a background priority cannot inflate the effective visible priority');
  }
});
test('shared work still observes source limits after its highest-priority owner leaves',async()=>{
  const pool=new RequestPool({concurrency:2,groupLimits:{detail:1}}),fg=new AbortController();
  const first=held(pool,'first',{group:'detail',priority:5});await tick();
  const owner=pool.request('shared',()=>null,{signal:fg.signal,group:'overview',priority:9}),rejected=assert.rejects(owner,{name:'AbortError'});
  let started=false;const remaining=pool.request('shared',()=>{started=true;return null;},{group:'detail',priority:2});
  fg.abort();await rejected;await tick();assert.equal(started,false);
  first.finish(null);await Promise.all([first.promise,remaining]);await tick();assert.equal(pool.active,0);
});
