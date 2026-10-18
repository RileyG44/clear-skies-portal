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

  // Invalid opaque Terrarium sentinels must never reach the GPU or mutate
  // a shared decoder cache. The native mask also receives an owned grid.
  const decoderGrid=new Float32Array([-32768,-20000,Infinity,25]);
  const normalized=new ElevationTileStore({sources:[source('s',1,0)],request:async()=>({width:2,height:2,grid:decoderGrid})});
  await normalized.want([{z:0,x:0,y:0}]);
  assert.deepEqual([...normalized.get('s/0/0/0').grid].map(Number.isNaN),[true,true,true,false]);
  assert.equal(decoderGrid[0],-32768);assert.equal(decoderGrid[2],Infinity);normalized.destroy();
  const sharedMaskGrid=new Float32Array([1,2,3,4]);
  const copyMask=new ElevationTileStore({sources:[source('s',1,0)],request:async()=>({width:2,height:2,grid:sharedMaskGrid}),mask:g=>{g[0]=NaN;return g;}});
  await copyMask.want([{z:0,x:0,y:0}]);assert.equal(sharedMaskGrid[0],1);copyMask.destroy();

  // Research downsampling averages every native cell, including an impulse
  // away from the output center, and merges rank/no-data before averaging.
  const impulse=new Float32Array(16);impulse.fill(NaN);impulse[0]=100;
  const averaging=new ElevationTileStore({sources:[source('base',1,0),source('detail',5,0)],
    request:async url=>({width:4,height:4,grid:url.startsWith('detail')?impulse:new Float32Array(16)})});
  await averaging.want([{z:0,x:0,y:0}]);
  const averaged=averaging.gridForView({bounds:[-180,-85.0511287798,180,85.0511287798],zoom:20,maxSide:1});
  assert.equal(averaged.width,1);assert.equal(averaged.height,1);assert.equal(averaged.grid[0],6.25);
  assert.equal(averaged.factor,4);assert.equal(averaged.z,Math.log2(4/256),'research resolution uses resident native density, not invented z20 detail');
  assert.ok(Math.abs(averaged.resolution-40075016.68557849)<1e-6);
  const mixed=averaging.provenance();assert.ok(mixed.ranks[1]>0&&mixed.ranks[5]>0);
  assert.equal(Object.values(mixed.ranks).reduce((a,b)=>a+b,0),65536,'contributions count one visible rank per sample');
  const summary=averaging._summary({z:0,x:0,y:0});averaging.settled();averaging.provenance();
  assert.equal(averaging._summary({z:0,x:0,y:0}),summary,'status calls reuse cached contributions');averaging.destroy();

  const partial=new ElevationTileStore({sources:[source('detail',5,0)],request:async()=>({width:4,height:4,grid:impulse})});
  await partial.want([{z:0,x:0,y:0}]);
  assert.equal(partial.settled().complete,0,'one valid pixel cannot mark an entire display tile complete');
  assert.ok(partial.settled().ratio>0&&partial.settled().ratio<1);partial.destroy();
  const hidden=new ElevationTileStore({sources:[source('base',1,0),source('detail',5,0)],request:async url=>({...data([10,10,10,10]),surveys:[{id:url.startsWith('base')?'hidden':'visible'}]})});
  await hidden.want([{z:0,x:0,y:0}]);
  assert.deepEqual(hidden.provenance().ranks,{'5':65536});assert.deepEqual(hidden.provenance().surveys,[{id:'visible'}]);hidden.destroy();

  // Cursor/research gates use the current display zoom even while a finer
  // source remains cached after zooming out.
  const gatedSources=[source('base',1,0),source('raw',3,4,{allowed:c=>c.z>=3})];
  const gated=new ElevationTileStore({sources:gatedSources,request:async url=>data(url.startsWith('raw')?[30,30,30,30]:[10,10,10,10])});
  await gated.want([{z:3,x:4,y:4}]);assert.equal(gated.sampleAt(22.5,-20).rank,3);
  await gated.want([{z:2,x:2,y:2}]);assert.equal(gated.sampleAt(22.5,-20).rank,1);
  assert.equal(gated.sampleAt(0,90),null,'unprojectable polar latitudes have no native sample');gated.destroy();

  const retinaResearch=new ElevationTileStore({sources:[source('s',1,1,{dz:1,sharper:true})],
    request:async()=>({width:256,height:256,grid:new Float32Array(65536).fill(42)})});
  await retinaResearch.want([{z:1,x:1,y:1}]);await tick();await tick();
  const retinaGrid=retinaResearch.gridForView({bounds:[0,-85.0511287798,180,0],zoom:0,maxSide:256});
  assert.equal(retinaGrid.width,256);assert.equal(retinaGrid.height,256);
  assert.equal(retinaGrid.z,1,'research retains resident HiDPI native level above CSS map zoom');retinaResearch.destroy();

  // A mask may select one overzoomed corner of a native tile; its center
  // need not satisfy the current display-coordinate source gate.
  const corner=new ElevationTileStore({sources:[source('dnr',5,0,{allowed:c=>c.z===2&&c.x===0&&c.y===0})],request:async()=>({width:256,height:256,grid:new Float32Array(65536).fill(4)})});
  await corner.want([{z:2,x:0,y:0}]);
  const cornerGrid=corner.gridForView({bounds:[-180,66.51326044311186,-90,85.0511287798],zoom:2,maxSide:4});
  assert.ok(cornerGrid.grid.some(Number.isFinite),'selected native corner remains available to research');corner.destroy();

  let revision=1,revisionSpecs=[source('s',1,0,{url:()=>`revision-${revision}`})],revisionCalls=0;
  const revised=new ElevationTileStore({sources:()=>revisionSpecs,request:async()=>{revisionCalls++;return data([revision,revision,revision,revision]);}});
  await revised.want([{z:0,x:0,y:0}]);revision=2;revisionSpecs=[source('s',1,0,{url:()=>`revision-${revision}`})];
  await revised.want([{z:0,x:0,y:0}]);assert.equal(revisionCalls,2);assert.equal(revised.sampleAt(0,0).value,2,'source revision replaces stale native record');revised.destroy();

  let cancelCalls=[];
  const preflight=new ElevationTileStore({sources:[source('s',1,4)],request:async url=>{cancelCalls.push(url);return data([1,1,1,1]);}});
  const cancelledBeforeStart=preflight.want([{z:2,x:0,y:0}]);const currentBeforeStart=preflight.want([{z:2,x:1,y:0}]);
  await Promise.all([cancelledBeforeStart,currentBeforeStart]);assert.deepEqual(cancelCalls,['s/2/1/0'],'cancel before dispatch avoids an obsolete network request');preflight.destroy();

  const phaseRequests=[];
  const phasesStore=new ElevationTileStore({sources:[source('detail',5,8,{dz:1,sharper:true}),source('base',1,8,{dz:1,sharper:true})],
    request:(url,o)=>new Promise(resolve=>phaseRequests.push({url,o,resolve}))});
  const phaseA=phasesStore.want([{z:3,x:4,y:4}]);await tick();
  const phaseB=phasesStore.want([{z:3,x:6,y:4}]);await tick();
  const phaseA2=phasesStore.want([{z:3,x:4,y:4}]);await tick();
  phaseRequests[4].resolve(data([1,1,1,1]));await tick();
  phaseRequests.slice(0,4).forEach(p=>p.resolve(data([1,1,1,1])));await Promise.all([phaseA,phaseB]);await tick();
  assert.equal(phaseRequests.length,7,'current detail can sharpen while its lower-ranked primary is still pending');
  assert.equal(phaseRequests[6].url,'detail/3/4/4','obsolete A/B completion does not launch unrelated refinement');
  phaseRequests[5].resolve(data([1,1,1,1]));await phaseA2;await tick();
  assert.equal(phaseRequests.length,7);assert.equal(phaseRequests[6].o.group,'sharp');
  phaseRequests[6].resolve(data([1,1,1,1]));await tick();phasesStore.destroy();

  const independentJobs=new Map(),independentCalls=[];
  const independent=new ElevationTileStore({sources:[source('s',2,8,{dz:1,sharper:true})],request:url=>{
    independentCalls.push(url);return new Promise(resolve=>independentJobs.set(url,resolve));}});
  const independentDone=independent.want([{z:3,x:0,y:0},{z:3,x:4,y:0}]);await tick();
  independentJobs.get('s/2/0/0')(data([2,2,2,2]));await tick();
  assert.ok(independentCalls.includes('s/3/0/0'),'ready region sharpens before unrelated slow primary completes');
  independentJobs.get('s/3/0/0')(data([3,3,3,3]));await tick();
  assert.equal(independent.finestFor('s',{z:3,x:0,y:0}).z,3);
  independentJobs.get('s/2/2/0')(data([2,2,2,2]));await independentDone;await tick();
  independentJobs.get('s/3/4/0')(data([3,3,3,3]));await tick();independent.destroy();

  const partialCalls=[];
  const partialSharp=new ElevationTileStore({sources:[source('survey',5,8,{dz:1,sharper:true}),source('fallback',2,8,{dz:1,sharper:true})],request:async url=>{
    partialCalls.push(url);return data(url.startsWith('survey')?[NaN,NaN,10,NaN]:[3,3,3,3]);}});
  await partialSharp.want([{z:3,x:0,y:0}]);await tick();
  assert.ok(partialCalls.includes('survey/3/0/0'));assert.ok(partialCalls.includes('fallback/3/0/0'),'partial survey cannot strand exposed fallback at coarse resolution');
  assert.equal(partialSharp.finestFor('fallback',{z:3,x:0,y:0}).z,3);partialSharp.destroy();

  for(const failure of ['reject','empty']){
    let attempts=0;
    const recovered=new ElevationTileStore({retryDelayMs:10,sources:[source('s',2,8,{dz:1,sharper:true})],request:async url=>{
      if(url==='s/3/0/0'&&++attempts===1){if(failure==='empty')return null;throw Error('temporary outage');}
      return data([3,3,3,3]);}});
    await recovered.want([{z:3,x:0,y:0}]);await tick();
    assert.equal(recovered.finestFor('s',{z:3,x:0,y:0}).z,2);
    assert.equal(recovered.settled().refining,true,'cooldown retains visible refinement demand');
    await new Promise(resolve=>setTimeout(resolve,35));await tick();
    assert.equal(attempts,2,'stationary view retries detail without another pan');
    assert.equal(recovered.finestFor('s',{z:3,x:0,y:0}).z,3);
    assert.equal(recovered._retryTimer,0);recovered.destroy();
  }
  let obsoleteRetries=0;
  const cancelledRetry=new ElevationTileStore({retryDelayMs:10,sources:[source('s',1,8)],request:async()=>{obsoleteRetries++;throw Error('outage');}});
  await cancelledRetry.want([{z:3,x:0,y:0}]);cancelledRetry.want([]);
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(obsoleteRetries,1,'leaving a tile cancels its retry');
  cancelledRetry.destroy();assert.equal(cancelledRetry._retryTimer,0);

  const fs=require('node:fs'),vm=require('node:vm'),html=fs.readFileSync(require.resolve('./index.html'),'utf8');
  const adapter=html.slice(html.indexOf('function gpuElevationRequest('),html.indexOf('function gpuElevationSources('));
  let noCoverageRequests=0;
  const context={elevationRequests:{request:async()=>{noCoverageRequests++;return null;}}};
  vm.createContext(context);vm.runInContext(adapter,context);
  const noCoverage=new ElevationTileStore({retryDelayMs:10,sources:[source('s',5,8)],request:context.gpuElevationRequest});
  await noCoverage.want([{z:3,x:0,y:0}]);await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(noCoverageRequests,1,'explicit provider no-coverage is cached, not retried');
  assert.equal(noCoverage._retryTimer,0);assert.equal(noCoverage.finestFor('s',{z:3,x:0,y:0}).validCount,0);noCoverage.destroy();

  const sources=buildSources({dnrEndpoint:'/dnr',rawEndpoint:'/raw',nationalEndpoint:'/national',fallback:'/base/{z}/{x}/{y}',fallbackNativeZoom:15,refineOverview:true},
    {proxy:true,api:x=>x,dz:1,dnrRevision:7,dnrTileAllowed:()=>true,rawCoverageQuery:'r=1'});
  assert.equal(sources.find(s=>s.id==='raw').allowed({z:13}),false);
  assert.equal(sources.find(s=>s.id==='raw').allowed({z:14}),true);
  assert.match(sources[0].url(2,1,1),/acquire=0&revision=7/);
  assert.equal(sources.find(s=>s.id==='overview').nativeZoom(22),15);
  console.log('gpu terrain store checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
