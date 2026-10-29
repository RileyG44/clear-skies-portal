'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {ElevationTileStore}=require('./gpu-terrain-store'),{RequestPool}=require('./tile-pipeline');
const page=require('./test-fixtures/page-source');
const fetchCode=page.slice(page.indexOf('async function fetchElevation('),page.indexOf('function waitElevationRetry('));
const adapterCode=page.slice(page.indexOf('function gpuElevationRequest('),page.indexOf('function gpuElevationSources('));
const core=require('./elevation-tile-core');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function clientRecovery(){
  let requests=0,healthy=false,decodes=0;
  const pool=new RequestPool(),raw='/api/usgs/elev/18/1/1.png?ix=3';
  const context={AbortController,DOMException,Float32Array,ElevationTileCore:core,elevationRequests:pool,
    // Accelerate only the fetch helper's 400/800 ms retry backoff. Store retry
    // is real, and no second want(), map event or source refresh is supplied.
    setTimeout:(fn,ms)=>setTimeout(fn,ms<10000?1:ms),clearTimeout,
    fetchOverviewResponse:async()=>{requests++;return {
      ok:true,status:200,headers:new Headers(healthy?{}:{'X-Coverage':'none','Cache-Control':'no-store'}),blob:async()=>new Blob()
    };},drapeWorkers:{run:async()=>{decodes++;return {grid:new Float32Array([80,80,80,80]),width:2,height:2};}}};
  vm.createContext(context);vm.runInContext(fetchCode+'\n'+adapterCode,context);
  const source={id:'raw',rank:3,label:'USGS',url:raw};
  const fallback={id:'national',rank:2,label:'National',url:'national'};
  const store=new ElevationTileStore({retryDelayMs:15,sources:[source,fallback],request:(url,options)=>url===raw
    ?context.gpuElevationRequest(url,options):Promise.resolve({grid:new Float32Array([10,10,10,10]),width:2,height:2})});
  try{
    await store.want([{z:18,x:1,y:1}]);
    assert.equal(store.finestFor('raw',{z:18,x:1,y:1}),undefined,'unknown coverage must never become a resident nodata record');
    assert.equal(store.settled().refining,true,'a stationary view retains retry demand');
    assert.equal(store.sampleAt(-179.99794,85.05095)?.rank,2,'useful national coverage stays visible');
    assert.equal(pool.cache.has(raw),false,'unknown coverage must not enter the shared decoded cache');
    healthy=true;
    for(let i=0;i<30&&!store.finestFor('raw',{z:18,x:1,y:1});i++)await wait(5);
    assert.equal(store.finestFor('raw',{z:18,x:1,y:1}).validCount,4,'detail arrives automatically after recovery');
    assert.equal(decodes,1);assert.equal(requests,4,'three provisional attempts followed by one healthy retry');
    assert.equal(store.settled().refining,false);
    // Confirmed gaps remain cacheable. DNR cache-only misses legitimately use
    // no-store and must not turn into a permanent retry loop.
    for(const [url,cacheControl]of[[raw,'public, max-age=604800, immutable'],['/api/wadnr/elev/18/1/1.png?acquire=0','no-store']]){
      context.fetchOverviewResponse=async()=>({ok:true,status:200,headers:new Headers({'X-Coverage':'none','Cache-Control':cacheControl})});
      assert.equal(await context.fetchElevation(url,new AbortController().signal),null);
    }
  }finally{store.destroy();}
}

async function routeRecovery(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'csp-provisional-'));
  const cache=require('./engine/tile-cache'),terrain=require('./engine/terrain');
  const budget=cache.init(dir,{canEvict:()=>true});
  let state='unknown',calls=0;
  terrain.init({run:async()=>{calls++;return state==='unknown'?{provisional:true}:state==='none'?null:
    {png:require('./engine/images').TRANSPARENT,coverage:1,meta:{coverage:1,groundRes:1,sources:[]}};},stats:()=>({active:0,queued:0})},null);
  const request=async p=>{
    const res={req:{headers:{}},writeHead(status,headers){this.status=status;this.headers=headers;return this;},end(body){this.body=body;return this;}};
    await terrain.routes[p.includes('/tile/')?'/api/usgs/tile/':'/api/usgs/elev/']({},res,{p,u:new URL(p,'http://localhost'),signal:new AbortController().signal});
    return res;
  };
  try{
    for(const p of ['/api/usgs/elev/5/1/1.png','/api/usgs/tile/hs/5/1/1.png']){
      state='unknown';
      for(let i=0;i<2;i++){
        const res=await request(p);assert.equal(res.status,503);assert.equal(res.headers['X-Coverage'],'unknown');
        assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['Retry-After'],'10');
      }
      const before=calls;state='ready';assert.equal((await request(p)).status,200);
      assert.equal(calls,before+1,'provisional result was not saved as absence');
      await request(p);assert.equal(calls,before+1,'healthy result is cached');
    }
    state='none';
    const p='/api/usgs/elev/5/2/1.png',gap=await request(p);
    assert.equal(gap.status,200);assert.equal(gap.headers['X-Coverage'],'none');
    assert.match(gap.headers['Cache-Control'],/immutable/);
    const before=calls;await request(p);assert.equal(calls,before,'true nodata does not retry forever');
  }finally{await budget.close();fs.rmSync(dir,{recursive:true,force:true});}
}
(async()=>{await clientRecovery();await routeRecovery();console.log('Elevation recovery: provisional gaps retry while stationary; real nodata stays final');})()
  .catch(error=>{console.error(error);process.exitCode=1;});
