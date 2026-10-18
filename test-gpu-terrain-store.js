'use strict';
const assert=require('node:assert/strict');
const {ElevationTileStore,buildSources}=require('./gpu-terrain-store');
const tick=()=>new Promise(r=>setImmediate(r));
const source=(id,rank,max=4,extra={})=>({id,rank,label:id,nativeZoom:z=>Math.min(z,max),url:(z,x,y)=>`${id}/${z}/${x}/${y}`,sharper:false,...extra});
const data=values=>({width:2,height:2,grid:new Float32Array(values)});
(async()=>{
  let calls=[];
  const store=new ElevationTileStore({sources:()=>[source('base',1,1),source('detail',5,2)],
    request:async(url,o)=>{calls.push({url,...o});return data(url.startsWith('base')?[10,10,10,10]:[NaN,NaN,30,30]);}});
  await store.want([{z:2,x:2,y:2},{z:2,x:3,y:2}],{generation:1});await tick();
  assert.equal(calls.length,3,'ancestor request shared by adjacent display tiles');
  await store.want([{z:2,x:2,y:2},{z:2,x:3,y:2}],{generation:2});
  assert.equal(calls.length,3,'resident tiles do not refetch on settings/view refresh');
  const topLat=Math.atan(Math.sinh(Math.PI*(1-2*.5625)))*180/Math.PI;
  const bottomLat=Math.atan(Math.sinh(Math.PI*(1-2*.6875)))*180/Math.PI;
  assert.equal(store.sampleAt(22.5,topLat).value,10,'no-data detail preserves base');
  assert.ok(Math.abs(store.sampleAt(22.5,bottomLat).value-30)<1e-10,'higher rank wins where valid');
  assert.ok(Math.abs(store.sampleAt(382.5,bottomLat).value-30)<1e-10,'longitude wraps');
  assert.equal(store.finestFor('base',{z:8,x:128,y:128}).z,1);
  assert.equal(store.settled().ratio,1);
  assert.deepEqual(Object.keys(store.provenance().ranks).sort(),['1','5']);
  const grid=store.gridForView({bounds:[0,-66,90,0],zoom:4,maxSide:16});
  assert.ok(grid.width<=16&&grid.height<=16);assert.ok(grid.grid.some(Number.isFinite));
  store.destroy();assert.equal(store.stats().bytes,0);

  let resolveOld,oldSignal;
  const moving=new ElevationTileStore({sources:()=>[source('s',1)],request:(url,o)=>{
    oldSignal=o.signal;return new Promise(r=>{resolveOld=r;});}});
  const old=moving.want([{z:2,x:0,y:0}]);await tick();
  moving.clear();assert.equal(oldSignal.aborted,true);
  resolveOld(data([1,1,1,1]));await old;await tick();
  assert.equal(moving.stats().tiles,0,'late response after clear cannot restore stale DNR');
  moving.destroy();

  let pending=[];
  const aborting=new ElevationTileStore({sources:()=>[source('s',1)],request:(url,o)=>new Promise(resolve=>pending.push({url,o,resolve}))});
  const a=aborting.want([{z:2,x:0,y:0}]);await tick();
  const b=aborting.want([{z:2,x:1,y:0}]);await tick();
  assert.equal(pending[0].o.signal.aborted,true,'offscreen requests abort');
  pending.forEach(p=>p.resolve(data([1,1,1,1])));await Promise.all([a,b]);await tick();
  assert.equal(aborting.stats().tiles,1);aborting.destroy();

  const masked=[];
  const maskStore=new ElevationTileStore({sources:()=>[source('dnr',5,1)],request:async()=>data([1,1,1,1]),mask:(g,w,h,c)=>{masked.push(c);return g;}});
  await maskStore.want([{z:4,x:8,y:8}]);assert.deepEqual(masked,[{z:1,x:1,y:1}]);maskStore.destroy();

  const lru=new ElevationTileStore({maxBytes:16,sources:()=>[source('s',1)],request:async()=>data([1,1,1,1])});
  await lru.want([{z:2,x:0,y:0}]);await lru.want([{z:2,x:1,y:0}]);
  assert.equal(lru.stats().bytes,16);assert.equal(lru.get('s/2/0/0'),undefined);lru.destroy();

  const phases=[];
  const retina=new ElevationTileStore({sources:()=>[source('s',1,8,{dz:1,sharper:true})],request:async(url,o)=>{phases.push({url,...o});return data([1,1,1,1]);}});
  await retina.want([{z:3,x:4,y:4},{z:3,x:5,y:4}]);await tick();await tick();
  assert.equal(phases.length,3);assert.equal(phases[0].url,'s/2/2/2');
  assert.ok(phases.slice(1).every(p=>p.priority===0&&p.group==='sharp'));retina.destroy();

  const sources=buildSources({dnrEndpoint:'/dnr',rawEndpoint:'/raw',nationalEndpoint:'/national',fallback:'/base/{z}/{x}/{y}',fallbackNativeZoom:15,refineOverview:true},
    {proxy:true,api:x=>x,dz:1,dnrRevision:7,dnrTileAllowed:()=>true,rawCoverageQuery:'r=1'});
  assert.equal(sources.find(s=>s.id==='raw').allowed({z:13}),false);
  assert.equal(sources.find(s=>s.id==='raw').allowed({z:14}),true);
  assert.match(sources[0].url(2,1,1),/acquire=0&revision=7/);
  assert.equal(sources.find(s=>s.id==='overview').nativeZoom(22),15);
  console.log('gpu terrain store checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
