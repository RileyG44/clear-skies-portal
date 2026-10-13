'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const code=html.slice(html.indexOf('async function engineElevationWithFallback('),html.indexOf('\nconst ElevLayer'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const tile=(value,gap=false)=>{const grid=new Float32Array(256*256).fill(value);if(gap)grid[0]=NaN;return {grid,width:256,height:256}};
function fixture(dnrAllowed=true){
  const pending=new Map(),aborts=[];
  const request=(url,signal)=>new Promise((resolve,reject)=>{
    pending.set(url,resolve);signal.addEventListener('abort',()=>{aborts.push(url);reject(new DOMException('Aborted','AbortError'))},{once:true});
  });
  const context={AbortController,DOMException,CSPTilePipeline:require('./tile-pipeline'),ElevationTileCore:require('./elevation-tile-core'),
    $:()=>({value:'auto'}),api:x=>x,dnrStatus:{revision:0},dnrTileAllowed:()=>dnrAllowed,maskDnrGrid:grid=>grid,
    elevationRequests:{request:(url,loader,{signal})=>request(url,signal)},fetchElevation:()=>{},
    overviewElevation:(coords,signal)=>request('overview',signal)};
  vm.runInNewContext(code,context);
  return {pending,aborts,run:(signal,mesh=true)=>context.engineElevationWithFallback({z:12,x:1,y:1},signal,mesh)};
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
  assert.equal(f.pending.has('/api/wadnr/elev/12/1/1.png?acquire=0&revision=0'),false,'no fetched area means no DNR request at all');
  f.pending.get('/api/elev/national/12/1/1.png')(tile(20));
  assert.deepEqual(Array.from((await gated).ranks),[2],'outside fetched areas USGS fills the mesh');

  f=fixture();controller=new AbortController();
  const cancelled=assert.rejects(f.run(controller.signal),{name:'AbortError'});controller.abort();await cancelled;
  assert.equal(f.aborts.length,3,'cancellation reaches every source');
  console.log('engine elevation checks passed (early completion, gap filling, fetched-area gating, cancellation)');
}
main().catch(error=>{console.error(error);process.exitCode=1});
