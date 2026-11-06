'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=require("./test-fixtures/page-source.js");
function extend(props){function Layer(url,options){this.options=options;this._map={};this.events={};this.initialize?.(url,options)}Layer.prototype=Object.assign(Object.create(this.prototype||{}),props);Layer.extend=extend;return Layer}
const requests=[],timers=new Map();let timerID=0;
const Base=extend.call(function(){},{initialize(url,options){this.options=options},on(name,fn){this.events[name]=fn},fire(){},createTile(c,done){const image={url:this.getTileUrl(c)};requests.push({image,done});return image}});
const context={ResilientTileLayer:Base,L:{Util:{template:(url,c)=>url.replace(/\{([xyz])\}/g,(_,k)=>c[k])}},window:{devicePixelRatio:3},tileMerc:()=>[1,2,3,4],EMPTY_TILE:'empty',setTimeout:fn=>{timers.set(++timerID,fn);return timerID},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>context.onWindow.push([name,fn]),onWindow:[],document:{readyState:'complete',createElement:()=>({getContext:()=>({clearRect(){},drawImage(image){context.painted=image.url}})})}};
vm.runInNewContext(source.slice(source.indexOf('const ExportLayer ='),source.indexOf('const OV_KEY=')).replace('const ReferenceLabelLayer=','globalThis.ReferenceLabelLayer='),context);
const layer=new context.ReferenceLabelLayer('',{endpoint:'https://hydro.nationalmap.gov/export',layers:'4,6',cachedUrl:'cache/{z}/{x}/{y}',minDetailScale:577790.554289});
const c={x:1,y:2,z:12};let complete=0;
let tile=layer.createTile(c,()=>complete++);
assert.equal(tile.width,768);assert.match(requests[1].image.url,/size=768,768.*dpi=288/);
requests[1].done(null,requests[1].image);requests[0].done(null,requests[0].image);
assert.equal(complete,1);assert.equal(tile._cspReferenceQuality,'detail');assert.match(context.painted,/hydro/,'late overview cannot overwrite rendered detail');assert.equal(timers.size,0);
requests.length=0;complete=0;tile=layer.createTile(c,()=>complete++);
requests[0].done(null,requests[0].image);assert.equal(tile._cspReferenceQuality,'cached');assert.equal(complete,1,'cached coverage displays while detail is pending');
[...timers.values()][0]();assert.equal(tile._cspReferenceQuality,'cached');assert.equal(complete,1,'timeout must retain useful cached coverage');assert.equal(requests[1].image._cspCancelled,true);
requests.length=0;tile=layer.createTile(c,()=>{throw Error('unloaded tile must not publish')});tile._cspCancelled=true;layer.events.tileunload({tile});assert(requests.every(r=>r.image._cspCancelled));requests[0].done(null,requests[0].image);
assert.equal(layer.wantsDetail({z:9}),false,'overview honors provider minimum scale');
context.window.devicePixelRatio=1;const url=new URL(layer.getTileUrl(c));assert.equal(url.searchParams.get('size'),'512,512');assert.equal(url.searchParams.get('dpi'),'192','density and DPI preserve label size');
const fn=source.slice(source.indexOf('function snapshotLayerTileUrl('),source.indexOf('async function snapshotPool('));vm.runInNewContext(fn,context);context.snapshotWrappedX=(x,z)=>((x%2**z)+2**z)%2**z;
assert.match(context.snapshotLayerTileUrl({_url:'',getTileUrl:()=> 'dynamic-export'},c),/dynamic-export/,'dynamic capture layers have an empty template URL');
console.log('Reference label staging, fallback, scale, cancellation and capture URL checks passed');

/* hydro.nationalmap.gov answers overload with gateway error pages that lack CORS
   headers. Detail is metered so a burst of tiles cannot provoke them: a cap on
   requests in flight, a deadline ahead of the gateway, and backoff after failures. */
{
let clock=1e6;context.Date={now:()=>clock};requests.length=0;timers.clear();
const meter=new context.ReferenceLabelLayer("",{endpoint:"https://hydro.nationalmap.gov/export",layers:"4,6",cachedUrl:"cache/{z}/{x}/{y}",minDetailScale:577790.554289});
const tiles=[],outcomes=[];
for(let i=0;i<4;i++){const n=outcomes.length;outcomes.push([]);tiles.push(meter.createTile({x:i,y:2,z:12},error=>outcomes[n].push(error)))}
const detailRequests=()=>requests.filter(r=>/hydro/.test(r.image.url));
assert.equal(detailRequests().length,2,"at most two detail exports in flight");
assert.equal(requests.length,6,"every cached tile still requests at once");
const [first,second]=detailRequests();
first.done(null,first.image);
assert.equal(detailRequests().length,3,"a finished export frees its slot for the queue");
/* Deadline: a stalled export is cancelled silently (never left to become a
   gateway error page) and retried once from the back of the queue. */
const cached1=requests.find(r=>r.image.url==="cache/12/1/2");cached1.done(null,cached1.image);
const expire=tile=>{const id=tile._cspReferenceTimer,fn=timers.get(id);assert(fn,"deadline armed");timers.delete(id);fn()};
expire(tiles[1]);
assert.equal(second.image._cspCancelled,true,"timed-out export is cancelled");
assert.equal(meter._cspDetailFailures,0,"a first timeout is retried, not yet a failure");
assert.equal(meter._cspDetailQueue.at(-1),tiles[1]._cspReferenceJob,"the retry waits behind tiles not yet tried");
assert.equal(tiles[1]._cspReferenceQuality,"cached","timeout keeps cached coverage");
assert.deepEqual(outcomes[1],[null]);
expire(tiles[2]);expire(tiles[3]);
assert.equal(meter._cspDetailActive,2,"retries reuse the freed slots");
/* A second timeout is final for that tile; consecutive failures pause new exports. */
expire(tiles[1]);assert.equal(meter._cspDetailFailures,1);assert.equal(meter.detailPaused(),false,"one failure does not pause");
assert.equal(tiles[1]._cspReferenceQuality,"cached");assert.equal(meter._cspDetailQueue.includes(tiles[1]._cspReferenceJob),false);
expire(tiles[2]);
assert(meter.detailPaused(),"two consecutive failures pause detail");
const before=detailRequests().length;
tiles.push(meter.createTile({x:9,y:2,z:12},()=>{}));
assert.equal(detailRequests().length,before,"no new export starts while paused");
const wake=[...timers.values()].pop();clock+=60*1000;wake();
assert.equal(detailRequests().length,before+1,"queued detail resumes after the pause");
/* Success resets backoff; detail is never replaced by a late cached tile. */
const last=detailRequests().pop();last.done(null,last.image);
assert.equal(meter._cspDetailFailures,0);
const lateCached=requests.find(r=>r.image.url==="cache/12/9/2");lateCached.done(null,lateCached.image);
assert.equal(tiles[4]._cspReferenceQuality,"detail","late cached pixels cannot undo detail");
/* Cached failure while paused settles the tile instead of waiting out the pause. */
meter._cspDetailPausedUntil=clock+30000;requests.length=0;const errs=[];
const stuck=meter.createTile({x:20,y:2,z:12},error=>errs.push(error));
assert.equal(requests.length,1,"paused: only the cached request starts");
requests[0].done(Error("cached down"),requests[0].image);
assert.equal(errs.length,1);assert(errs[0]);assert.equal(meter._cspDetailQueue.includes(stuck._cspReferenceJob),false);
/* Detail waits for the window load event so slow exports cannot hold it. */
meter._cspDetailPausedUntil=0;meter._cspDetailFailures=0;meter._cspDetailQueue.length=0;meter._cspDetailActive=0;requests.length=0;
context.document.readyState="interactive";
const early=meter.createTile({x:40,y:2,z:12},()=>{});meter.createTile({x:41,y:2,z:12},()=>{});
assert.equal(requests.length,2,"only cached tiles load before the window load event");
assert.equal(context.onWindow.filter(([name])=>name==="load").length,1,"one load listener per layer");
context.document.readyState="complete";context.onWindow.pop()[1]();
assert.equal(detailRequests().length,2,"detail starts once the page has loaded");
meter.events.tileunload({tile:early});
/* A 1 px answer is the quiet failure the service worker and the engine use
   instead of a CORS-less gateway page. It must not paint over cached water,
   and it is retried once. */
meter._cspDetailPausedUntil=0;meter._cspDetailFailures=0;meter._cspDetailQueue.length=0;meter._cspDetailActive=0;
meter._cspDetailTransportSettled=true;requests.length=0;timers.clear();
const sentinelTile=meter.createTile({x:50,y:2,z:12},()=>{});
const sentinelCached=requests.find(r=>r.image.url==="cache/12/50/2");
sentinelCached.done(null,sentinelCached.image);
assert.equal(sentinelTile._cspReferenceQuality,"cached");
const sentinelDetail=requests.find(r=>/hydro/.test(r.image.url));
sentinelDetail.image.naturalWidth=1;
sentinelDetail.done(null,sentinelDetail.image);
assert.equal(sentinelTile._cspReferenceQuality,"cached","a sentinel does not replace cached hydrography");
assert.equal(meter._cspDetailFailures,0,"the first sentinel is retried");
const sentinelRetry=requests.filter(r=>/hydro/.test(r.image.url)).pop();
assert.notEqual(sentinelRetry,sentinelDetail);
sentinelRetry.image.naturalWidth=1;
sentinelRetry.done(null,sentinelRetry.image);
assert.equal(meter._cspDetailFailures,1,"a second sentinel is a real miss");
assert.equal(sentinelTile._cspReferenceQuality,"cached");
/* Unloading an active tile frees its slot without counting as a failure. */
meter._cspDetailPausedUntil=0;meter._cspDetailFailures=0;meter._cspDetailQueue.length=0;meter._cspDetailActive=0;requests.length=0;
const a=meter.createTile({x:30,y:2,z:12},()=>{});
assert.equal(meter._cspDetailActive,1);meter.events.tileunload({tile:a});
assert.equal(meter._cspDetailActive,0);assert.equal(meter._cspDetailFailures,0);
console.log("Reference detail concurrency, deadline, backoff and late-response checks passed");
}

/* Failed detail must capture cached pixels with the same grey and alpha on WebKit. */
{
const s=source;let fallbackCalls=0,pixels;
const captureEnv={snapshotLayerTileUrl:()=> 'detail',snapshotWrappedX:x=>x,SNAPSHOT_FETCH_CONCURRENCY:2,snapshotBitmap:async url=>{if(url==='detail')throw Error('offline');fallbackCalls++;return {width:1,height:1}},document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([40,140,220,127])}),putImageData(data){pixels=data.data}})})}};
vm.runInNewContext(s.slice(s.indexOf('async function snapshotPool('),s.indexOf('async function snapshotSvgBitmap(')),captureEnv);
(async()=>{let drawn;const ctx={save(){},restore(){},drawImage(...args){drawn=args},setTransform(){}};const result=await captureEnv.drawSnapshotRasterPlan(ctx,{layer:{getFallbackTileUrl:()=> 'cached'},m:[1,0,0,1,0,0],opacity:.7,filter:'grayscale(1) brightness(1.35)',x0:0,x1:0,y0:0,y1:0,z:1},{scale:2,sel:{x:0,y:0}},new Map());assert.equal(result.drawn,1);assert.equal(result.failed,0);assert.equal(fallbackCalls,1);assert.equal(pixels[0],pixels[1]);assert.equal(pixels[1],pixels[2]);assert.equal(pixels[3],127);assert.deepEqual(drawn.slice(1),[0,0,512,512]);console.log('Capture fallback and WebKit grey-water pixel/alpha/footprint check passed')})().catch(e=>{console.error(e);process.exit(1)});

}
