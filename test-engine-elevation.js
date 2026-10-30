'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=require("./test-fixtures/page-source.js");
const code=html.slice(html.indexOf('async function engineElevationWithFallback('),html.indexOf('\nconst ElevLayer'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const tile=(value,gap=false)=>{const grid=new Float32Array(256*256).fill(value);if(gap)grid[0]=NaN;return {grid,width:256,height:256}};
function fixture(dnrAllowed=true,preference='auto'){
  const pending=new Map(),aborts=[];
  const request=(url,signal)=>new Promise((resolve,reject)=>{
    pending.set(url,resolve);signal.addEventListener('abort',()=>{aborts.push(url);reject(new DOMException('Aborted','AbortError'))},{once:true});
  });
  const context={AbortController,DOMException,CSPTilePipeline:require('./tile-pipeline'),CSPPublicTerrain:{NATIONAL_MIN_ZOOM:8},ElevationTileCore:require('./elevation-tile-core'),
    $:()=>({value:preference}),api:x=>x,RAW_COVERAGE_QUERY:'ix=3',dnrStatus:{revision:0},dnrTileAllowed:()=>dnrAllowed,
    elevationRequests:{request:(url,loader,{signal})=>request(url,signal)},fetchElevation:()=>{},
    overviewElevation:(coords,signal)=>request('overview',signal)};
  vm.runInNewContext(code,context);
  return {pending,aborts,run:(signal,mesh=true,z=12)=>context.engineElevationWithFallback({z,x:1,y:1},signal,mesh)};
}
async function main(){
  let f=fixture(),controller=new AbortController(),returned=false;
  const fast=f.run(controller.signal).then(x=>{returned=true;return x});
  f.pending.get('/api/elev/national/12/1/1.png')(tile(20));await tick();
  assert.equal(returned,false,'higher-ranked DNR is still allowed to contribute');
  f.pending.get('/api/wadnr/elev/12/1/1.png?acquire=0&revision=0')(null);
  const result=await fast;
  assert.deepEqual(Array.from(result.ranks),[2]);assert.ok(f.aborts.includes('overview'),'complete national data cancels slow overview');

  f=fixture();controller=new AbortController();returned=false;
  const holes=f.run(controller.signal).then(x=>{returned=true;return x});
  f.pending.get('/api/wadnr/elev/12/1/1.png?acquire=0&revision=0')(tile(50,true));
  f.pending.get('/api/elev/national/12/1/1.png')(tile(20,true));await tick();
  assert.equal(returned,false,'partial coverage must wait for gap filling');
  f.pending.get('overview')(tile(1));const filled=await holes;
  assert.equal(filled.grid[0],1);assert.equal(filled.grid[1],50);
  assert.deepEqual(Array.from(filled.ranks),[5,1]);

  f=fixture(false);controller=new AbortController();
  const gated=f.run(controller.signal);
  assert.equal(f.pending.has('/api/wadnr/elev/12/1/1.png?acquire=0&revision=0'),false,'no cached DNR candidate means no DNR request');
  f.pending.get('/api/elev/national/12/1/1.png')(tile(20));
  assert.deepEqual(Array.from((await gated).ranks),[2],'outside cached DNR footprints USGS fills the mesh');

  f=fixture(false,'3dep');controller=new AbortController();
  const national=f.run(controller.signal,false,14);
  assert.equal([...f.pending.keys()].some(url=>url.includes('/usgs/elev/')),false,'explicit national preference never requests raw USGS');
  f.pending.get('/api/elev/national/14/1/1.png')(tile(20));
  assert.deepEqual(Array.from((await national).ranks),[2]);

  f=fixture(false,'usgs1m');controller=new AbortController();returned=false;
  const rawMesh=f.run(controller.signal,true,14).then(value=>{returned=true;return value});
  f.pending.get('/api/elev/national/14/1/1.png')(tile(20));await tick();
  assert.equal(returned,false,'explicit raw preference allows the finer mesh source to finish');
  f.pending.get('/api/usgs/elev/14/1/1.png?ix=3')(tile(50));
  assert.deepEqual(Array.from((await rawMesh).ranks),[3],'explicit raw USGS preference supplies 3D too');

  f=fixture();controller=new AbortController();
  const cancelled=assert.rejects(f.run(controller.signal),{name:'AbortError'});controller.abort();await cancelled;
  assert.equal(f.aborts.length,3,'cancellation reaches every source');
  console.log('engine elevation checks passed (early completion, gap filling, cached-source gating, explicit preferences, cancellation)');
}
main().catch(error=>{console.error(error);process.exitCode=1});
