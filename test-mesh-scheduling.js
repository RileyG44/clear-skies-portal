'use strict';
/* Independent review regressions: cancellation must preserve refinement,
   MapLibre-held terrain must survive pruning, and new demand must not wait
   behind stalled background work. Exercises the actual cspmesh handler. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=process.env.CSP_ROOT||__dirname;
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const between=(start,end)=>{const i=html.indexOf(start);assert(i>=0,start);const j=html.indexOf(end,i);assert(j>i,end);return html.slice(i,j);};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flush=async()=>{for(let i=0;i<12;i++) await tick();};

function harness({bounds=null,inView={},source='auto',ignoreAbort=false}={}){
  let now=0,timerId=0;const timers=[];
  const clock={
    setTimeout:(fn,ms=0)=>{const id=++timerId;timers.push({id,at:now+ms,fn});return id;},
    clearTimeout:id=>{const i=timers.findIndex(t=>t.id===id);if(i>=0) timers.splice(i,1);},
    async advance(ms){const end=now+ms;for(;;){await flush();timers.sort((a,b)=>a.at-b.at);if(!timers.length||timers[0].at>end) break;const t=timers.shift();now=t.at;t.fn();}now=end;await flush();}
  };
  const fine=new Map(),fetches=[],aborted=[];
  const fetchStub=(url,{signal}={})=>{
    fetches.push(url);
    if(url.startsWith('https://s3.amazonaws.com/')) return Promise.resolve({ok:true,status:200,arrayBuffer:async()=>new Uint8Array([1]).buffer});
    return new Promise((resolve,reject)=>{
      signal?.addEventListener('abort',()=>{aborted.push(url);if(!ignoreAbort){fine.delete(url);reject(new DOMException('Aborted','AbortError'))}},{once:true});
      fine.set(url,body=>resolve(body===null
        ?{ok:true,status:200,headers:{get:n=>n==='X-Coverage'?'none':null},arrayBuffer:async()=>new ArrayBuffer(0)}
        :{ok:true,status:200,headers:{get:()=>null},arrayBuffer:async()=>new Uint8Array([2]).buffer}));
    });
  };
  const refreshes=[],handlers={};
  const view={bounds,inView};
  const map3d={
    getSource:id=>['dem','demShade'].includes(id)?{}:undefined,
    refreshTiles:(id,tiles)=>refreshes.push([id,Array.from(tiles,t=>`${t.z}/${t.x}/${t.y}`).sort()]),
    getBounds:()=>{const b=view.bounds;return {getWest:()=>b[0],getSouth:()=>b[1],getEast:()=>b[2],getNorth:()=>b[3]}},
    /* What MapLibre itself holds in view per DEM source (TileManager#getIds). */
    style:{tileManagers:Object.fromEntries(['dem','demShade'].map(id=>[id,{
      getIds:()=>(view.inView[id]||[]).map((_,i)=>`${id}:opaque:${i}`),
      getTileByID:key=>{const value=view.inView[id]?.[Number(key.split(':').at(-1))];if(!value)return;
        const [z,x,y]=value.split('/').map(Number);return {tileID:{canonical:{z,x,y}}};}}]))}
  };
  const context={...clock,AbortController,DOMException,AggregateError,CSPTilePipeline:require(path.join(ROOT,'tile-pipeline.js')),
    performance:{now:()=>now},console,
    $:()=>({value:source}),PROXY:true,API:'engine',api:p=>'engine'+p,serverHealth:null,dnrStatus:{revision:1},dnrElevationAvailable:()=>false,
    fetch:fetchStub,public3dSources:new Map(),public3dDrapeSources:new Map(),scheduleTerrainStatus:()=>{},elevCacheClear:()=>{},
    map3dBuiltKey:'x',elevSpectrumRevision:0,map3d,maplibreProtocolReady:false};
  vm.runInNewContext(between('function terrainDemTiles(','function terrainTheme(')+'\n'+
    between('async function installMaplibreProtocols(','\nfunction setTerrainModeUi(')+'\n'+
    between('function waitElevationRetry(','async function engineElevationWithFallback('),context);
  const national=(z,x,y)=>`engine/api/elev/national/${z}/${x}/${y}.png`;
  return {context,clock,fine,fetches,aborted,refreshes,handlers,view,national,
    async install(){await context.installMaplibreProtocols({addProtocol:(n,fn)=>{handlers[n]=fn}})},
    request(host,z,x,y,controller=new AbortController()){
      return {controller,promise:handlers.cspmesh({url:`cspmesh://${host}/${z}/${x}/${y}.png?r=0`},controller).then(r=>new Uint8Array(r.data)[0])};
    }};
}
/* lon/lat bounds of a tile, for building view bounds. */
const tileLon=(x,z)=>x/2**z*360-180,tileLat=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;

const results=[];
async function check(name,fn){
  try{await fn();results.push([name,'PASS']);}
  catch(error){results.push([name,'FAIL',error.message]);}
}

async function main(){
  /* 1. Shared DEM/shade consumer: aborting one MapLibre request keeps the
     shared fine job alive for the other; aborting both cancels the network. */
  await check('shared dem/shade consumers keep fine alive; last abort cancels network',async()=>{
    const h=harness();await h.install();
    const dem=h.request('dem',14,10,20),shade=h.request('shade',14,10,20);
    await h.clock.advance(0);
    assert.equal(h.fetches.filter(u=>u===h.national(14,10,20)).length,1,'one coalesced fine fetch');
    // Overview is instant here, so both already resolved overview; abort before it to test consumer accounting:
    const h2=harness();await h2.install();
    h2.context.fetch=((orig)=>(url,o)=>url.startsWith('https://s3')?new Promise((res,rej)=>o?.signal?.addEventListener('abort',()=>rej(new DOMException('Aborted','AbortError')))):orig(url,o))(h2.context.fetch);
    const a=h2.request('dem',14,10,20),b=h2.request('shade',14,10,20);await h2.clock.advance(0);
    a.controller.abort();a.promise.catch(()=>{});await h2.clock.advance(0);
    assert.equal(h2.aborted.length,0,'shade still consuming: fine fetch not aborted');
    h2.fine.get(h2.national(14,10,20))(new Uint8Array([2]));
    assert.equal(await b.promise,2,'shade receives fine');
    const c=h2.request('dem',14,11,20),d=h2.request('shade',14,11,20);await h2.clock.advance(0);
    c.controller.abort();d.controller.abort();await Promise.allSettled([c.promise,d.promise]);await h2.clock.advance(0);
    assert.deepEqual(h2.aborted,[h2.national(14,11,20)],'last consumer abort cancels the fine fetch');
    await dem.promise;await shade.promise;
  });

  /* A cancelled holder settles promptly while another holder shares fine work. */
  await check('aborted consumer settles promptly while shared fine continues',async()=>{
    const h=harness();await h.install();
    h.context.fetch=((orig)=>(url,o)=>url.startsWith('https://s3')?new Promise((res,rej)=>o?.signal?.addEventListener('abort',()=>rej(new DOMException('Aborted','AbortError')))):orig(url,o))(h.context.fetch);
    const a=h.request('dem',14,10,20),b=h.request('shade',14,10,20);await h.clock.advance(0);
    let settled=false;a.promise.then(()=>settled='resolved',e=>settled=e.name);
    a.controller.abort();await h.clock.advance(50);
    const state=settled;
    h.fine.get(h.national(14,10,20))(new Uint8Array([2]));await b.promise;await a.promise.catch(()=>{});
    assert.equal(state,'AbortError',`aborted request still pending (state=${state}) until the shared fine job finished`);
  });

  /* 2. Fine arriving before overview wins immediately (no 300 ms wait). */
  await check('fine data wins race when overview is slow',async()=>{
    const h=harness();await h.install();
    let releaseOverview;h.context.fetch=((orig)=>(url,o)=>url.startsWith('https://s3')?new Promise(r=>{releaseOverview=()=>r({ok:true,status:200,arrayBuffer:async()=>new Uint8Array([1]).buffer})}):orig(url,o))(h.context.fetch);
    const r=h.request('dem',14,10,20);await h.clock.advance(0);
    h.fine.get(h.national(14,10,20))(new Uint8Array([2]));
    assert.equal(await r.promise,2);
  });

  /* Cancelled refinement retries when its cached overview returns to view. */
  await check('pruned background fine job is retried/refined when tile returns to view',async()=>{
    const z=14,x=10,y=20;
    const away=[tileLon(x+50,z),tileLat(y+51,z),tileLon(x+51,z),tileLat(y+50,z)];
    const here=[tileLon(x,z),tileLat(y+1,z),tileLon(x+1,z),tileLat(y,z)];
    const h=harness({bounds:here});await h.install();
    assert.equal(await h.request('dem',z,x,y).promise,1,'overview served first');
    h.view.bounds=away;h.context.pruneMeshRequests();await h.clock.advance(0);
    assert.deepEqual(h.aborted,[h.national(z,x,y)],'prune aborted the background fine request');
    /* User pans back. MapLibre reuses its cached overview tile (no new
       cspmesh request); only moveend handlers run. */
    h.view.bounds=here;h.context.pruneMeshRequests();h.context.meshRefineAgain();await h.clock.advance(2000);
    const refetched=h.fetches.filter(u=>u===h.national(z,x,y)).length>1;
    if(refetched){h.fine.get(h.national(z,x,y))?.(new Uint8Array([2]));await h.clock.advance(2000);}
    assert(h.refreshes.some(([id,t])=>id==='dem'&&t.includes(`${z}/${x}/${y}`)),
      `tile ${z}/${x}/${y} never refined after cancellation (refetched=${refetched}, refreshes=${JSON.stringify(h.refreshes)})`);
  });

  /* 4. Abort is not no-coverage, at the markMeshTile level: after prune the
     stale entry must survive (not ready) rather than be deleted. */
  await check('cancelled fine keeps the stale entry (abort != X-Coverage:none)',async()=>{
    const z=14,x=10,y=20,h=harness({bounds:[0,0,0.0001,0.0001]});await h.install();
    await h.request('dem',z,x,y).promise;
    const key=vm.runInNewContext(`meshKey(${z},${x},${y})`,h.context);
    assert(vm.runInNewContext(`meshStale.dem.has(${JSON.stringify(key)})`,h.context),'stale entry recorded after overview');
    h.context.pruneMeshRequests();await h.clock.advance(0);
    assert(vm.runInNewContext(`meshStale.dem.has(${JSON.stringify(key)})`,h.context),'stale entry dropped by cancellation');
  });

  /* 5. Control for 4: genuine no-coverage still drops the stale entry. */
  await check('genuine X-Coverage:none still finalises the overview (no refresh)',async()=>{
    const z=14,x=12,y=20,h=harness();await h.install();
    await h.request('dem',z,x,y).promise;h.fine.get(h.national(z,x,y))(null);await h.clock.advance(1500);
    assert.equal(h.refreshes.length,0);
    const key=vm.runInNewContext(`meshKey(${z},${x},${y})`,h.context);
    assert(!vm.runInNewContext(`meshStale.dem.has(${JSON.stringify(key)})`,h.context));
  });

  /* 6. Pitched/terrain view: Map#getBounds intersects screen corners with a
     plane at the centre elevation and clamps the top at the flat horizon
     (vendor/maplibre-gl.mjs getBounds -> screenPointToLocation without
     terrain). Ridges rising above that plane near the horizon, or high
     foreground, are drawn but lie outside getBounds. Contract: prune must not
     cancel fine work for a tile MapLibre itself holds in view. */
  await check('prune preserves opaque held IDs from either DEM source outside flat bounds',async()=>{
    for(const source of ['dem','demShade']){
      const z=14,x=10,y=20,h=harness({bounds:[tileLon(x,z),tileLat(y+3,z),tileLon(x+1,z),tileLat(y+2,z)],inView:{[source]:[`${z}/${x}/${y}`]}});
      await h.install();await h.request('dem',z,x,y).promise;
      h.context.pruneMeshRequests();await h.clock.advance(0);
      assert.deepEqual(h.aborted,[],`${source} held horizon tile was pruned`);
    }
  });

  /* 7. Antimeridian: getBounds may return east > 180; a tile at x=0 is in view. */
  await check('wrap: tile across antimeridian is not pruned',async()=>{
    const z=4,h=harness({bounds:[170,-10,195,10]});await h.install();
    await h.request('dem',z,0,7).promise;h.context.pruneMeshRequests();await h.clock.advance(0);
    assert.deepEqual(h.aborted,[]);
  });

  /* New demand can yield stalled background work without exceeding the bound. */
  await check('a ready tile is not starved behind 6 stalled background fine jobs',async()=>{
    const h=harness();await h.install();
    for(let i=0;i<6;i++) await h.request('dem',14,100+i,20).promise;
    await h.clock.advance(5000);
    await h.request('dem',14,200,20).promise;await h.clock.advance(0);
    assert(h.fetches.includes(h.national(14,200,20)),'7th fine request never issued while 6 stall');
  });

  await check('healthy initial refinements survive waves of new visible tiles',async()=>{
    const h=harness({bounds:[-180,-89,180,89]});await h.install();
    for(let i=0;i<20;i++)await h.request('dem',14,100+i,20).promise;
    assert.equal(h.aborted.length,0,'healthy in-flight work is not discarded');
    for(let k=0;k<40;k++){
      for(const [url,answer] of [...h.fine]){h.fine.delete(url);answer(new Uint8Array([2]));}
      await h.clock.advance(2000);
    }
    assert.equal(h.fetches.filter(url=>url.includes('/national/')).length,20,'one fine fetch per tile');
    assert.equal(new Set(h.refreshes.flatMap(([,tiles])=>tiles)).size,20,'every overview refines');
  });

  await check('yielded slot serves new demand ahead of queued background work',async()=>{
    const h=harness();await h.install();
    for(let i=0;i<12;i++)await h.request('dem',14,100+i,20).promise;
    await h.clock.advance(5000);
    h.context.fetch=((original)=>(url,options)=>url.startsWith('https://s3')&&url.includes('/300/')
      ?new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))
      :original(url,options))(h.context.fetch);
    const demand=h.request('dem',14,300,20);await h.clock.advance(0);
    assert(h.fetches.includes(h.national(14,300,20)),'foreground request takes the yielded slot');
    h.fine.get(h.national(14,300,20))(new Uint8Array([2]));assert.equal(await demand.promise,2);
  });

  await check('aborting one holder does not cancel shared fine work for the other',async()=>{
    const h=harness();await h.install();
    const a=h.request('dem',14,10,20),b=h.request('shade',14,10,20);
    let aFailed=false;a.promise.catch(()=>{aFailed=true});await h.clock.advance(0);
    a.controller.abort();await h.clock.advance(50);
    assert.equal(h.aborted.length,0,'other holder keeps fine work');
    h.fine.get(h.national(14,10,20))(new Uint8Array([2]));await b.promise;
    await h.clock.advance(50);assert.equal(aFailed,false,'a holder already served useful data is not retroactively aborted');
  });

  await check('503 backoff keeps the bound and stalled retry work yields to demand',async()=>{
    const h=harness();await h.install();const attempts=new Map(),original=h.context.fetch;
    h.context.fetch=(url,options)=>{
      if(url.includes('/national/')&&/\/10[0-5]\//.test(url)){
        const count=(attempts.get(url)||0)+1;attempts.set(url,count);
        if(count===1)return Promise.resolve({ok:false,status:503,headers:{get:()=>null}});
      }
      return original(url,options);
    };
    for(let i=0;i<6;i++)await h.request('dem',14,100+i,20).promise;
    assert.equal(h.fine.size,0,'busy responses enter real timed backoff');
    await h.clock.advance(5000);assert.equal(h.fine.size,6,'retry work stays at six');
    await h.request('dem',14,200,20).promise;await h.clock.advance(0);
    assert(h.fetches.includes(h.national(14,200,20)),'new tile obtains a stalled retry slot');
    assert.equal(vm.runInNewContext('meshRequests.active',h.context),6);
  });

  await check('late bytes after reset neither populate cache nor resurrect stale work',async()=>{
    const h=harness({ignoreAbort:true});await h.install();
    await h.request('dem',14,10,20).promise;const late=h.fine.get(h.national(14,10,20));
    h.context.resetMeshSources();late(new Uint8Array([2]));await h.clock.advance(2000);
    assert.equal(vm.runInNewContext('meshFine.size',h.context),0);
    assert.equal(vm.runInNewContext('meshStale.dem.size+meshStale.demShade.size',h.context),0);
    assert.equal(h.fetches.filter(url=>url===h.national(14,10,20)).length,1,'reset does not rearm old source');
  });

  /* Reset immediately rejects abortable fine work. */
  await check('resetMeshSources aborts pending fine work',async()=>{
    const h=harness();await h.install();
    await h.request('dem',14,10,20).promise;h.context.resetMeshSources();await h.clock.advance(0);
    assert.deepEqual(h.aborted,[h.national(14,10,20)]);
    assert.equal(vm.runInNewContext('meshFine.size',h.context),0);
  });

  const failures=results.filter(([,status])=>status==='FAIL');
  for(const [name,status,msg] of results)console.log(`${status} ${name}${msg?'\n'+msg:''}`);
  if(failures.length)process.exitCode=1;
  console.log(`mesh scheduling checks: ${results.length-failures.length} passed, ${failures.length} failed`);

}
main().catch(error=>{console.error(error);process.exit(1);});
