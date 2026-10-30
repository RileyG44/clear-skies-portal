'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cache=require('./engine/tile-cache.js'),terrain=require('./engine/terrain.js'),usgs=require('./usgs.js');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'csp-scope-cache-'));
cache.init(dir,{canEvict:()=>false});let calls=0,fail=false;
const out={png:Buffer.from('new-numeric-body'),coverage:1,groundRes:1,sources:[{project:'Elwha OPR',product:'Original Product Resolution DEM'}]};
terrain.init({stats:()=>({active:1,queued:0}),run:async()=>{calls++;if(fail)throw Error('offline');return out}},null);
const p='/api/usgs/elev/20/164323/364505.png',ck=cache.key('usgselev:20/164323/364505');
async function request(){const res={req:{headers:{},method:"GET"},writeHead(status,headers){this.status=status;this.headers=headers;return this},end(body){this.body=body}};
 await terrain.routes['/api/usgs/elev/']({},res,{u:new URL('http://local'+p),p,signal:new AbortController().signal});return res;}
(async()=>{try{
 for(const old of [{status:204,meta:{final:true,scope:'WA_'}},{status:200,meta:{coverage:.3,scope:'WA_'}},{status:200,meta:{coverage:1}}]){
  cache.cachePut(ck,old.status,'image/png',Buffer.from('old-partial'),old.meta);
  const before=calls,r=await request();assert.equal(calls,before+1);assert.deepEqual(r.body,out.png);
  const second=await request();assert.equal(calls,before+1);assert.equal(second.headers['X-Cache'],'hit');
  assert(JSON.parse(decodeURIComponent(second.headers['X-USGS-Sources'])).some(s=>s.project==='Elwha OPR'));
  assert(!cache.cacheGet(ck,Infinity).sourceMeta.png,'PNG bytes must not inflate metadata');
 }
 cache.cachePut(ck,200,'image/png',Buffer.from('useful-old'),{scope:'old',coverage:.4});fail=true;
 for(let i=0;i<2;i++){const r=await request();assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers['X-CSP-Provisional'],'1');assert.equal(r.body.toString(),'useful-old');}
 fail=false;const recovered=await request();assert.deepEqual(recovered.body,out.png);assert.equal(cache.cacheGet(ck,Infinity).sourceMeta.scope,usgs.coverageScope());
 console.log('Changed coverage refreshes negatives, partial/legacy bodies, preserves useful offline bytes, retries stationary requests and retains provenance');
 }finally{fs.rmSync(dir,{force:true,recursive:true})}})().catch(error=>{console.error(error);process.exitCode=1});
