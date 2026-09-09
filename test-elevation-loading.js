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
  getTileSize(){return {x:2,y:2};}
  static extend(methods){class Layer extends Grid{};Object.assign(Layer.prototype,methods);return Layer;}
}
async function main(){
  const calls=new Map(),deferred=new Map();
  const context={L:{GridLayer:Grid,setOptions:(self,opts)=>{self.options=opts;}},
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
  console.log('elevation loading checks passed (actual layer, out-of-order responses, shared requests, pan cancellation, revisit)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
