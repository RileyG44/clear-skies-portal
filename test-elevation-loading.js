'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {RequestPool}=require('./tile-pipeline');
const pipeline=require('./tile-pipeline');
const core=require('./elevation-tile-core');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const html=fs.readFileSync(require.resolve('./index.html'),'utf8');
const source=html.slice(html.indexOf('const ElevLayer ='),html.indexOf('function tileGroundResolution('));
class Grid {
  constructor(options){this.events={};this.initialize(options);}
  on(name,fn){this.events[name]=fn;return this;}
  fire(name,value){this.events[name]?.(value);}
  getTileSize(){const t=this.options.tileSize;return t?{x:t,y:t}:{x:2,y:2};}
  static extend(methods){class Layer extends Grid{};Object.assign(Layer.prototype,methods);return Layer;}
}
async function main(){
  const calls=new Map(),deferred=new Map();
  const context={L:{GridLayer:Grid,setOptions:(self,opts)=>{self.options=opts;},point:(x,y)=>({x,y})},HIDPI:false,
    releaseCanvas:canvas=>{ if(canvas&&canvas.width){ canvas.width=0;canvas.height=0 } },
    document:{createElement:()=>({dataset:{}})},AbortController,DOMException,Float32Array,Promise,
    PROXY:true,api:value=>'engine'+value,CSPTilePipeline:pipeline,ElevationTileCore:core,CSPPublicTerrain:require('./public-terrain'),
    elevationRequests:new RequestPool(),fetchElevation:(url,signal)=>{
      calls.set(url,(calls.get(url)||0)+1);
      return new Promise((resolve,reject)=>{deferred.set(url,resolve);signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})));});
    }};
  vm.runInNewContext(source+';this.Layer=ElevLayer;',context);
  const opts={rawEndpoint:'/raw',nationalEndpoint:'/national',fallback:'fallback/{z}/{x}/{y}',fallbackNativeZoom:17,nationalNativeZoom:17};
  const first=new context.Layer(opts),second=new context.Layer(opts);
  first._paint=second._paint=()=>{};
  let done=0;const coords={z:17,x:1,y:2};
  const cv=first.createTile(coords,error=>{assert.ifError(error);done++;});
  const cv2=second.createTile(coords,()=>{});await tick();
  assert.equal([...calls.values()].reduce((a,b)=>a+b,0),3,'two consumers must share all three source requests');
  deferred.get('engine/raw/17/1/2.png')({grid:new Float32Array([100,NaN,300,400]),width:2,height:2});await tick();
  assert.equal(done,1,'detail paints without waiting for the fallback');
  assert.equal(cv.dataset.cspQuality,'3');assert.equal(cv._cspRefining,true);
  first.fire('tileunload',{coords,tile:cv});
  assert.equal(cv.width,0,'an unloaded tile gives its canvas memory back at once (iOS caps total canvas memory)');
  deferred.get('engine/national/17/1/2.png')({grid:new Float32Array([10,20,30,40]),width:2,height:2});
  deferred.get('fallback/17/1/2')({grid:new Float32Array([1,2,3,4]),width:2,height:2});await tick();
  assert.equal(first._store.size,0,'departed tiles must not resurrect');
  assert.deepEqual([...second._store.get('17/1/2').elev],[100,20,300,400]);
  assert.equal(cv2._cspRefining,false);assert.equal(second._pending.size,0);
  assert.equal(cv2._cspSourceCounts[3],3,'only real detail pixels count as detail');
  assert.equal(cv2._cspSourceCounts[2],1,'national fills the missing detail sample');
  assert.equal(cv2._cspSourceCounts[1],0,'fully replaced overview must disappear from attribution');
  assert.equal(done,1,'completion callback fires exactly once');
  const third=new context.Layer(opts);third._paint=()=>{};third.createTile(coords,()=>{});await tick();
  assert.equal([...calls.values()].reduce((a,b)=>a+b,0),3,'returning to the view reuses decoded elevation');
  context.PROXY=false;
  context.fetchPublicElevation=context.fetchElevation;
  const publicLayer=new context.Layer(opts);publicLayer._paint=()=>{};
  const publicCoords={z:17,x:2,y:2};let publicDone=0;
  const publicCanvas=publicLayer.createTile(publicCoords,error=>{assert.ifError(error);publicDone++;});await tick();
  const directUrl=context.CSPPublicTerrain.nationalUrl(publicCoords);
  assert.ok(calls.has(directUrl),'server-free terrain must request USGS directly');
  assert.equal(calls.has('engine/raw/17/2/2.png'),false,'public visitors never require the private raw endpoint');
  deferred.get('fallback/17/2/2')({grid:new Float32Array([1,2,3,4]),width:2,height:2});await tick();
  assert.equal(publicCanvas._cspSourceCounts[1],4,'overview is honestly reported while USGS is pending');
  deferred.get(directUrl)({grid:new Float32Array([10,NaN,30,40]),width:2,height:2});await tick();
  assert.deepEqual([...publicLayer._store.get('17/2/2').elev],[10,2,30,40]);
  assert.equal(publicCanvas._cspSourceCounts[2],3);assert.equal(publicCanvas._cspSourceCounts[1],1);
  assert.equal(publicDone,1,'refinement does not trigger completion twice');

  /* High-density screens: the display tile at z16 is drawn from the whole z17
     source tile at twice its CSS size, keyed and stored by the source tile.
     It first paints from the z16 tile the screen's zoom always used - one
     request shared by four display tiles - and only then asks for z17. */
  context.PROXY=true;context.HIDPI=true;
  const dense=new context.Layer({...opts,tileSize:2,maxNativeZoom:18});dense._paint=()=>{};
  assert.equal(dense.options.tileSize,1,'the grid is half size');
  assert.equal(dense.options.maxNativeZoom,17,'native zoom is counted in source tiles');
  const display={z:16,x:5,y:6},sibling={z:16,x:4,y:6};let denseDone=0;
  const denseCanvas=dense.createTile(display,error=>{assert.ifError(error);denseDone++;});
  const siblingCanvas=dense.createTile(sibling,()=>{});await tick();
  assert.equal(denseCanvas.width,2,'the canvas holds the full source tile');
  assert.equal(denseCanvas._cspCoords.z,17);
  assert.equal(calls.get('engine/raw/16/2/3.png'),1,'the first pass is the on-screen zoom, shared by sibling tiles');
  assert.equal(calls.has('engine/raw/17/5/6.png'),false,'the finer zoom waits until the tile has painted');
  deferred.get('engine/raw/16/2/3.png')({grid:new Float32Array([1,2,3,4]),width:2,height:2});await tick();
  assert.equal(denseDone,1,'the tile paints from the first pass');
  assert.ok([...dense._store.get('17/5/6').elev].every(v=>v>=1&&v<=4),'the first pass is drawn from the coarser tile');
  deferred.get('engine/national/16/2/3.png')({grid:new Float32Array([9,9,9,9]),width:2,height:2});
  deferred.get('fallback/16/2/3')({grid:new Float32Array([9,9,9,9]),width:2,height:2});await tick();await tick();
  assert.equal(calls.get('engine/raw/17/5/6.png'),1,'then the best source sharpens at the finer zoom');
  assert.equal(calls.has('engine/national/17/5/6.png'),false,'only the best source is sharpened');
  assert.equal(denseCanvas._cspRefining,true);
  deferred.get('engine/raw/17/5/6.png')({grid:new Float32Array([5,NaN,7,8]),width:2,height:2});await tick();await tick();
  assert.deepEqual([...dense._store.get('17/5/6').elev],[5,2,7,8],'sharper pixels replace their own source, gaps keep the first pass');
  assert.equal(denseCanvas._cspSourceCounts[3],4,'sharpening does not change attribution');
  assert.equal(denseCanvas._cspRefining,false);assert.equal(denseDone,1);
  dense.fire('tileunload',{coords:sibling,tile:siblingCanvas});
  assert.equal(dense._pending.has('17/4/6'),false,'unloading the display tile cancels its source request');
  console.log('elevation loading checks passed (actual layer, out-of-order responses, shared requests, pan cancellation, revisit, high density, sharpening)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
