"use strict";
const assert=require("assert/strict"),fs=require("fs"),vm=require("vm");
const raster=require("./terrain-raster.js"),before=require("./test-fixtures/terrain-raster-before-drape.js");
const drape=require("./terrain-drape-core.js"),bands=require("./elevation-bands.js");
const coloursBefore=require("./test-fixtures/elevation-colours-before-drape.js");
const {Pool}=require("./terrain-drape-pool.js");
const {RequestPool}=require("./tile-pipeline.js");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let comparisons=0;
for(const skirted of [false,true])for(const kind of ["flat","gentle","steep","waves","nodata"]){
  const size=24,n=skirted?size+2:size,grid=new Float32Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)grid[y*n+x]=kind==="flat"?2400:kind==="gentle"?100+x*.02-y*.03:
    kind==="steep"?-700+x*320-y*193:3000*Math.sin(x*.41)*Math.cos(y*.27)+x*.004;
  if(kind==="nodata"){grid[1]=NaN;grid[n+4]=-1e30;grid[n*2+8]=-9999;grid[n*3+11]=Infinity}
  for(const lighting of [{},{azimuth:0,altitude:90,ambient:0},{azimuth:167,altitude:12,ambient:.6},{azimuth:999,altitude:-1,ambient:-1}])
    for(const style of [...raster.STYLES,"unknown"]){
      const surface={grid,size,n:skirted?n:undefined,width:size,height:size,groundRes:kind==="steep"?2:.5,noData:-9999,lighting};
      assert.deepEqual(raster.renderRgba(style,surface),before.renderRgba(style,surface),`${kind}/${skirted}/${style}/${JSON.stringify(lighting)}`);comparisons++;
    }
}
// Exercise all contour intervals with a shallow ramp that actually draws both
// index and translucent lines, not just the transparent steep-slope case.
for(const style of raster.STYLES.filter(s=>s.startsWith("c"))){
  const size=64,grid=Float32Array.from({length:size*size},(_,i)=>(raster.CONTOUR_FT[style]/3.28084+(i%size)*.022+Math.floor(i/size)*.003));
  const surface={grid,size,groundRes:1};const rgba=raster.renderRgba(style,surface);
  assert(rgba.some((v,i)=>i%4===3&&v===200),`${style} needs translucent coverage`);
  assert.deepEqual(rgba,before.renderRgba(style,surface));comparisons++;
}
// Rectangular rasters and unrepresentable gradients retain scalar no-data semantics.
for(const groundRes of [1,1e-300])for(const style of raster.STYLES){
  const surface={grid:Float32Array.from({length:17*9},(_,i)=>i*97),width:17,height:9,groundRes};
  assert.deepEqual(raster.renderRgba(style,surface),before.renderRgba(style,surface));comparisons++;
}
const size=4,centre=Float32Array.from({length:size*size},(_,i)=>i+.00031);
const west=Float32Array.from(centre,v=>v+100),east=Float32Array.from(centre,v=>v+200);
const north=Float32Array.from(centre,v=>v+300),south=Float32Array.from(centre,v=>v+400);
const skirt=drape.skirt([centre,west,east,north,south],size),n=size+2;
for(let y=0;y<size;y++)for(let x=0;x<size;x++)assert.equal(skirt[(y+1)*n+x+1],centre[y*size+x]);
for(let i=0;i<size;i++){
  assert.equal(skirt[(i+1)*n],west[i*size+size-1]);assert.equal(skirt[(i+1)*n+n-1],east[i*size]);
  assert.equal(skirt[i+1],north[(size-1)*size+i]);assert.equal(skirt[(n-1)*n+i+1],south[i]);
}
assert.equal(skirt[0],north[(size-1)*size]);assert.equal(skirt[n-1],north[size*size-1]);
assert.equal(skirt[(n-1)*n],south[0]);assert.equal(skirt[n*n-1],south[size-1]);
const clamped=drape.skirt([centre,null,null,null,null],size);
assert.equal(clamped[0],centre[0]);assert.equal(clamped[n*n-1],centre[size*size-1]);
assert.equal(clamped[n],centre[0]);assert.equal(clamped[n+n-1],centre[size-1]);
assert.equal(centre[0],skirt[n+1],"Float32 precision survives, without Terrarium rounding");
for(const spectrumOn of [false,true])for(const outline of [false,true])for(const feather of [0,12]){
  const state=bands.sanitizeState({unit:"m",bands:[
    {id:"below",enabled:true,operator:"below",max:12,color:"#e34046",opacity:.52,feather,outline:{enabled:outline,width:8,color:"#ffffff",opacity:.88}},
    {id:"above",enabled:true,operator:"above",min:8,color:"#407ae3",opacity:.63,feather,outline:{enabled:outline,width:8,color:"#ffffff",opacity:.88}}
  ]},{defaults:false});
  const settings={spectrumOn,level:10,span:25,spectrumAlpha:.48,bandCompiled:bands.compileBands(state)};
  const grid=Float32Array.from({length:400},(_,i)=>i===6?NaN:i/3-40);
  assert.deepEqual(drape.elevationColours(grid,400,settings,new Uint8ClampedArray(1600)),coloursBefore(grid,400,settings,new Uint8ClampedArray(1600)));
  const tiles=[grid,null,null,null,null],skirted=drape.skirt(tiles,20);
  assert.deepEqual(drape.render({style:"spectrum",size:20,tiles,settings:{...settings,bandState:state}}),
    coloursBefore(skirted,400,settings,new Uint8ClampedArray(1600),20,22,23));comparisons++;
}
async function poolTests(){
  const workers=[],fallback=[];
  const workerFactory=()=>{const worker={postMessage(packet,transfer){this.packet=structuredClone(packet,{transfer})},terminate(){this.terminated=true}};workers.push(worker);return worker};
  const pool=new Pool({workerFactory,size:2,fallback:async packet=>{fallback.push(packet);return packet.op||"fallback"}});
  const controller=new AbortController(),a=pool.run({tiles:[centre]},controller.signal),b=pool.run({tiles:[centre]}),c=pool.run({tiles:[centre]});
  const cancelled=assert.rejects(a,{name:"AbortError"});controller.abort();await cancelled;
  assert.equal(workers.length,2);assert.equal(pool.queue.length,1);assert.equal(centre.length,16,"cache buffer never detaches");
  assert.deepEqual(workers[0].packet.tiles[0],centre);
  let closed=false;workers[0].onmessage({data:{id:workers[0].packet.id,bitmap:{close(){closed=true}}}});
  assert(closed,"aborted bitmap released");assert.equal(pool.queue.length,0);
  workers[1].onmessage({data:{id:workers[1].packet.id,bitmap:"b"}});assert.equal(await b,"b");
  workers[0].onmessage({data:{id:workers[0].packet.id,error:"OffscreenCanvas unavailable"}});assert.equal(await c,"fallback");
  const active=pool.run({op:"active"}),queued=pool.run({op:"queued"});workers[0].onerror();
  assert.equal(await active,"active");assert.equal(await queued,"queued");assert(workers.every(w=>w.terminated));
  const slowPool=new Pool({workerFactory,size:1,fallback:async()=>"unused"});
  const d=slowPool.run({tiles:[centre]}),e=slowPool.run({tiles:[centre]});
  const dAbort=assert.rejects(d,{name:"AbortError"}),eAbort=assert.rejects(e,{name:"AbortError"});slowPool.clear();await Promise.all([dAbort,eAbort]);
  const fallbackPool=new Pool({fallback:async()=>"cpu"});assert.equal(await fallbackPool.run({}),"cpu");
  const brokenPool=new Pool({workerFactory:()=>{throw new Error("CSP blocked")},fallback:async()=>"cpu"});assert.equal(await brokenPool.run({}),"cpu");
}
async function integrationTests(){
  const index=fs.readFileSync("index.html","utf8"),start=index.indexOf("const ELEV_CACHE_BYTES="),end=index.indexOf("\nasync function encodeTileRgba",start);
  let loads=0,rendered=0,mode="auto";const statuses=new Map();
  const sandbox={CSPTilePipeline:{RequestPool},CSPTerrainDrapePool:{Pool},navigator:{hardwareConcurrency:8},AbortController,DOMException,
    meshKey:(z,x,y)=>`${mode}:${z}/${x}/${y}`,PROXY:false,public3dDrapeSources:statuses,scheduleTerrainStatus(){},
    publicElevationWithFallback:async(coords,signal)=>{loads++;await tick();if(signal.aborted)throw new DOMException("aborted","AbortError");return {grid:new Float32Array(256*256).fill(coords.x+.00031),rank:2}},
    reliefResolution:r=>r,tileGroundResolution:()=>1,terrainLighting:()=>({}),CSPTerrainDrape:{render:job=>{rendered++;return job.tiles[0]}},encodeTileRgba:async rgba=>rgba,
    elevationRenderSettings:()=>({bandCompiled:{state:{bands:[]}}})};
  vm.runInNewContext(index.slice(start,end)+";this.renderTile=renderDrapeTile;this.clear=elevCacheClear;this.source=drapeElevation",sandbox);
  const c1=new AbortController(),c2=new AbortController();
  const cancelled=sandbox.source(4,3,4,c1.signal),survives=sandbox.source(4,3,4,c2.signal);
  const rejection=assert.rejects(cancelled,{name:"AbortError"});c1.abort();await rejection;await survives;assert.equal(loads,1);
  await Promise.all([sandbox.renderTile("slope",4,3,4,c2.signal),sandbox.renderTile("aspect",4,4,4,c2.signal)]);
  assert.equal(loads,8,"adjacent drapes fetch each source tile once");
  await sandbox.renderTile("tint",4,3,4,c2.signal);await sandbox.renderTile("spectrum",4,3,4,c2.signal);
  assert.equal(loads,8,"palette and lighting revisions reuse source floats");assert.equal(statuses.get("4/3/4").rank,2);
  await sandbox.source(4,19,4,c2.signal);assert.equal(loads,8,"world wrapping shares cache key");
  sandbox.clear();await sandbox.source(4,3,4,c2.signal);assert.equal(loads,9,"reset clears source cache");
  mode="wadnr";await sandbox.source(4,3,4,c2.signal);assert.equal(loads,10,"source mode changes cache key");
  const noData=await sandbox.source(4,3,-1,c2.signal);assert.equal(noData,null);
  const cancelledHit=new AbortController();cancelledHit.abort();await assert.rejects(sandbox.source(4,3,4,cancelledHit.signal),{name:"AbortError"});
  const pending=sandbox.source(4,7,4,c2.signal),reset=assert.rejects(pending,{name:"AbortError"});sandbox.clear();await reset;
  assert(rendered>=4);
  // Engine grids and their mixed quality ranks reach the drape unchanged.
  sandbox.clear();sandbox.PROXY=true;sandbox.dnrElevationAvailable=()=>true;sandbox.$=()=>({value:"auto"});
  let engineLoads=0;
  sandbox.engineElevationWithFallback=async()=>{engineLoads++;return {grid:centre,ranks:[5,3,2,1]}};
  assert.equal((await sandbox.source(4,3,4,c2.signal))[0],centre[0]);
  assert.deepEqual(Array.from(statuses.get("4/3/4").ranks),[5,3,2,1]);statuses.clear();
  await sandbox.source(4,3,4,c2.signal);assert.equal(engineLoads,1);assert.equal(statuses.size,1,"cache hits restore status bookkeeping");
  sandbox.clear();sandbox.engineElevationWithFallback=async()=>null;
  assert.equal(await sandbox.source(4,3,4,c2.signal),null,"strict missing engine coverage stays missing");
  // The raw proxy path retains Retry-After, and cancellation during a retry
  // does not turn into a successful missing-neighbour response.
  sandbox.clear();sandbox.dnrElevationAvailable=()=>false;sandbox.elevTileUrl=()=>"elevation";
  const delays=[];let attempts=0;
  sandbox.fetch=async()=>++attempts<3?{ok:false,status:503,headers:{get:()=>"1"}}:
    {ok:true,headers:{get:()=>"usgs-1m"},blob:async()=>({})};
  sandbox.waitElevationRetry=async(ms,signal)=>{delays.push(ms);if(signal.aborted)throw new DOMException("aborted","AbortError")};
  sandbox.imageBitmapFromBlob=async()=>({close(){}});
  sandbox.scratch=()=>({getContext:()=>({clearRect(){},drawImage(){},getImageData:()=>({data:[]})})});
  sandbox.ElevationTileCore={decodeTerrarium:()=>centre};
  assert.equal((await sandbox.source(4,3,4,c2.signal))[0],centre[0]);
  assert.equal(attempts,3);assert.deepEqual(delays,[1000,2000]);assert.equal(statuses.get("4/3/4").rank,3);
  sandbox.clear();attempts=0;const retryAbort=new AbortController();
  sandbox.waitElevationRetry=async()=>{retryAbort.abort();throw new DOMException("aborted","AbortError")};
  await assert.rejects(sandbox.source(4,3,4,retryAbort.signal),{name:"AbortError"});assert.equal(attempts,1);

  // The vendored getImage path returns bitmap protocols unchanged rather than
  // treating them as PNG bytes (minified identifiers are deliberately ignored).
  const vendor=fs.readFileSync("vendor/maplibre-gl.mjs","utf8");
  assert(vendor.includes("instanceof HTMLImageElement||"),"vendored direct image protocol branch");
}
(async()=>{await poolTests();await integrationTests();console.log(`drape tests passed (${comparisons} byte-identical raster/palette comparisons, skirt precision, worker cancellation/fallback, shared source cache)`);})().catch(error=>{console.error(error);process.exitCode=1});
