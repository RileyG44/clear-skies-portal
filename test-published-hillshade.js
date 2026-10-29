'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const pipeline=require('./tile-pipeline'),core=require('./elevation-tile-core');
const tick=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
class Canvas{
  constructor(){this.dataset={};this.width=2;this.height=2;this.data=new Uint8ClampedArray(16);}
  getContext(){const cv=this;return {
    clearRect(){cv.data.fill(0);},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
    getImageData(){return {data:cv.data.slice()};},putImageData(im){cv.data=im.data.slice();},
    drawImage(im){cv.data=im.pixels.slice();}
  };}
}
class Grid{
  constructor(options){this.events={};this.initialize(options);}
  on(names,fn){for(const name of names.split(' '))(this.events[name]||=[]).push(fn);return this;}
  fire(name,value){for(const fn of this.events[name]||[])fn.call(this,value);}
  getTileSize(){return {x:this.options.tileSize||2,y:this.options.tileSize||2};}
  static extend(methods){class Layer extends this{}Object.assign(Layer.prototype,methods);return Layer;}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function main(){
  const numeric=new Map(),images=new Map(),calls=[],timers=new Map();let timerID=0;
  const lighting={azimuth:315,altitude:45,ambient:.12,exaggeration:1};
  const context={L:{GridLayer:Grid,setOptions:(self,o)=>self.options={...o},point:(x,y)=>({x,y})},HIDPI:false,
    releaseCanvas:cv=>{cv.width=cv.height=0;},document:{createElement:()=>new Canvas()},
    AbortController,DOMException,Float32Array,Uint8ClampedArray,Promise,CSPTilePipeline:pipeline,ElevationTileCore:core,
    CSPTerrainRaster:require('./terrain-raster'),CSPPublicTerrain:require('./public-terrain'),
    terrainGpu:{paint:()=>false},terrainLighting:()=>lighting,sourceSampleMeters:()=>1,
    PROXY:true,RAW_COVERAGE_QUERY:'ix=3',dnrStatus:{revision:2},dnrTileAllowed:()=>true,api:p=>'engine'+p,
    elevationRequests:new pipeline.RequestPool({concurrency:8}),
    fetchElevation:(url,signal)=>{calls.push(url);const d=deferred();numeric.set(url,d);signal.addEventListener('abort',()=>d.reject(new DOMException('Aborted','AbortError')),{once:true});return d.promise;},
    fetch:(url,{signal})=>{calls.push(url);const d=deferred();images.set(url,{...d,signal});return d.promise;},
    CompositeTerrainLayer:{prototype:{_bitmap:async pixels=>({pixels,close(){}})}},
    setTimeout:(fn,ms)=>{const id=++timerID;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  const elevation=fs.readFileSync('app/elevation.js','utf8');
  vm.createContext(context);vm.runInContext(elevation.slice(elevation.indexOf('const ElevLayer ='))+
    fs.readFileSync('app/published-hillshade.js','utf8')+';this.Layer=PublishedHillshadeLayer;',context);
  const options={style:'hs',rawEndpoint:'/raw',dnrEndpoint:'/dnr',nationalEndpoint:'/national',fallback:'fallback/{z}/{x}/{y}',
    fallbackNativeZoom:18,nationalNativeZoom:18,publishedUrl:c=>'published/'+c.x};
  const coord=x=>({z:17,x,y:2});
  const url=(tier,x)=>tier==='overview'?`fallback/17/${x}/2`:`engine/${tier}/17/${x}/2.png${tier==='raw'?'?ix=3':tier==='dnr'?'?acquire=0&revision=2':''}`;
  const grid=values=>({grid:new Float32Array(values),width:2,height:2});
  const settleNumeric=(x,dnr=[50,NaN,NaN,NaN])=>{
    for(const [tier,values]of [['national',[20,20,20,20]],['dnr',dnr],['raw',[30,30,30,30]],['overview',[10,10,10,10]]])numeric.get(url(tier,x)).resolve(grid(values));
  };
  const pixels=alphas=>new Uint8ClampedArray(alphas.flatMap((a,i)=>[11+i,21+i,31+i,a]));
  const response=(data,status=200)=>({status,headers:{get:k=>status===204&&k==='X-CSP-Error'?'upstream':null},blob:async()=>data});
  const first=new context.Layer(options);let done=0;
  const cv=first.createTile(coord(1),error=>{assert.ifError(error);done++;});await tick();
  settleNumeric(1);await tick();const numericPixel=cv.data.slice(0,4);
  assert.equal(done,1,'numeric fallback becomes usable without waiting for published hillshade');
  images.get('published/1').resolve(response(pixels([255,255,255,0])));await tick();
  assert.deepEqual([...cv.data.slice(0,4)],[...numericPixel],'valid cached numeric DNR remains above the published image');
  assert.deepEqual([...cv.data.slice(4,8)],[12,22,32,255],'published DNR replaces coarse federal fallback at its valid pixels');
  assert.deepEqual({...cv._cspSourceCounts},{1:0,2:0,3:1,4:2,5:1},'counts reflect actual source contributions, including transparent image holes');
  assert.deepEqual([...first._store.get('17/1/2').elev],[50,30,30,30],'published RGB never enters the measurement grid');
  assert.equal(first._store.get('17/1/2').ranks[1],3,'numeric provenance remains independent of displayed image provenance');
  const fetched=calls.length,oldImage=cv.data.slice(4,12);lighting.azimuth=135;
  first._store.forEach(t=>first._paint(t.cv,t.elev,t.coords));
  assert.equal(calls.length,fetched,'lighting reuses cached elevation and published pixels');
  assert.deepEqual([...cv.data.slice(4,12)],[...oldImage],'published lighting stays fixed');
  assert.equal(cv._cspRefining,false);assert.equal(done,1);

  // A successful transparent image is absence, and must not trigger a retry.
  const transparent=new context.Layer(options),empty=transparent.createTile(coord(2),()=>{});await tick();
  images.get('published/2').resolve(response(pixels([0,0,0,0])));settleNumeric(2);await tick();
  assert.equal(empty._cspSourceCounts[4],0);assert.equal(empty._cspRefining,false);assert.equal(timers.size,0);
  const translucent=new context.Layer({...options,opacity:.37}),tc=translucent.createTile(coord(6),()=>{});await tick();
  settleNumeric(6);await tick();const base=tc.data.slice();
  images.get('published/6').resolve(response(pixels([255,128,255,0])));await tick();
  const alpha=128/255;
  assert.equal(tc._cspSourceCounts[4],1+alpha,'fractional image alpha records only its actual contribution');
  for(let c=0;c<3;c++)assert.equal(tc.data[4+c],Math.round((12+c*10)*alpha+base[4+c]*(1-alpha)));
  assert.equal(tc.data[7],255,'fallback fills translucent image pixels');
  assert.equal(translucent.options.opacity,.37,'requested layer opacity is retained for one final map composite');
  translucent.fire('tileunload',{coords:coord(6),tile:tc});

  // The former engine's 204/error is a failure, not permanent transparent data.
  const recovery=new context.Layer(options),retry=recovery.createTile(coord(3),()=>{});await tick();settleNumeric(3);await tick();
  const useful=retry.data.slice();images.get('published/3').resolve(response(null,204));await tick();
  assert.deepEqual([...retry.data],[...useful],'failed published imagery keeps the useful map');
  assert.equal(retry._cspRefineFailed,true);assert.equal(retry._cspRefining,true);
  const retryTimer=[...timers].find(([,v])=>v.ms===1000);assert(retryTimer,'stationary retry is scheduled with backoff');
  timers.delete(retryTimer[0]);retryTimer[1].fn();await tick();
  images.get('published/3').resolve(response(pixels([255,255,255,255])));await tick();
  assert.equal(retry._cspSourceCounts[4],3,'recovery sharpens without another camera or layer event');
  assert.equal(retry._cspSourceCounts[5],1);assert.equal(retry._cspRefineFailed,false);assert.equal(retry._cspRefining,false);

  // Two consumers share image and numeric work; departing one cannot abort it.
  const a=new context.Layer(options),b=new context.Layer(options);
  const ac=a.createTile(coord(4),()=>{}),bc=b.createTile(coord(4),()=>{});await tick();
  assert.equal(calls.filter(u=>u==='published/4').length,1);
  a.fire('tileunload',{coords:coord(4),tile:ac});assert.equal(images.get('published/4').signal.aborted,false);
  images.get('published/4').resolve(response(pixels([255,255,255,255])));settleNumeric(4);await tick();
  assert.equal(a._published.size,0);assert.equal(a._store.size,0);assert.equal(ac.width,0);
  assert.equal(bc._cspSourceCounts[4],3);assert.equal(bc._cspSourceCounts[5],1);
  // An image arriving first must not become numeric height data. Late cached
  // DNR replaces it only at valid pixels, even if both sources needed retry.
  const late=new context.Layer(options),lc=late.createTile(coord(5),()=>{});await tick();
  images.get('published/5').resolve(response(null,503));
  numeric.get(url('dnr',5)).reject(new Error('temporary numeric failure'));
  for(const tier of ['raw','national','overview'])numeric.get(url(tier,5)).resolve(grid([30,30,30,30]));
  await tick();
  const backoff=[...timers].find(([,v])=>v.ms===1000);assert(backoff);
  timers.delete(backoff[0]);backoff[1].fn();await tick();
  images.get('published/5').resolve(response(pixels([255,255,255,255])));await tick();
  assert.equal(lc._cspSourceCounts[4],4,'image recovery can finish while numeric DNR remains pending');
  assert(lc._cspRefining);
  numeric.get(url('dnr',5)).resolve(grid([50,NaN,NaN,NaN]));await tick();
  assert.equal(lc._cspSourceCounts[5],1);assert.equal(lc._cspSourceCounts[4],3);
  assert.equal(lc._cspRefining,false);assert.equal(lc._cspRefineFailed,false);
  assert.equal(timers.size,0,'overlapping recoveries leave no spurious retry timer');
  assert.deepEqual([...late._store.get('17/5/2').elev],[50,30,30,30]);
  late.fire('tileunload',{coords:coord(5),tile:lc});
  for(const [layer,x,canvas]of [[first,1,cv],[transparent,2,empty],[recovery,3,retry],[b,4,bc]])layer.fire('tileunload',{coords:coord(x),tile:canvas});
  assert.equal(timers.size,0,'unloaded tiles release timers and image consumers');
  console.log('published hillshade: pixel ranks, real alpha, numeric separation, fixed light, stationary recovery and shared cancellation passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
