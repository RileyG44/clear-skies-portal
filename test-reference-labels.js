'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
function extend(props){function Layer(url,options){this.options=options;this._map={};this.events={};this.initialize?.(url,options)}Layer.prototype=Object.assign(Object.create(this.prototype||{}),props);Layer.extend=extend;return Layer}
const requests=[],timers=new Map();let timerID=0;
const Base=extend.call(function(){},{initialize(url,options){this.options=options},on(name,fn){this.events[name]=fn},fire(){},createTile(c,done){const image={url:this.getTileUrl(c)};requests.push({image,done});return image}});
const context={ResilientTileLayer:Base,L:{Util:{template:(url,c)=>url.replace(/\{([xyz])\}/g,(_,k)=>c[k])}},window:{devicePixelRatio:3},tileMerc:()=>[1,2,3,4],EMPTY_TILE:'empty',setTimeout:fn=>{timers.set(++timerID,fn);return timerID},clearTimeout:id=>timers.delete(id),document:{createElement:()=>({getContext:()=>({clearRect(){},drawImage(image){context.painted=image.url}})})}};
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

/* Failed detail must capture cached pixels with the same grey and alpha on WebKit. */
{
const s=source;let fallbackCalls=0,pixels;
const captureEnv={snapshotLayerTileUrl:()=> 'detail',snapshotWrappedX:x=>x,SNAPSHOT_FETCH_CONCURRENCY:2,snapshotBitmap:async url=>{if(url==='detail')throw Error('offline');fallbackCalls++;return {width:1,height:1}},document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([40,140,220,127])}),putImageData(data){pixels=data.data}})})}};
vm.runInNewContext(s.slice(s.indexOf('async function snapshotPool('),s.indexOf('async function snapshotSvgBitmap(')),captureEnv);
(async()=>{let drawn;const ctx={save(){},restore(){},drawImage(...args){drawn=args},setTransform(){}};const result=await captureEnv.drawSnapshotRasterPlan(ctx,{layer:{getFallbackTileUrl:()=> 'cached'},m:[1,0,0,1,0,0],opacity:.7,filter:'grayscale(1) brightness(1.35)',x0:0,x1:0,y0:0,y1:0,z:1},{scale:2,sel:{x:0,y:0}},new Map());assert.equal(result.drawn,1);assert.equal(result.failed,0);assert.equal(fallbackCalls,1);assert.equal(pixels[0],pixels[1]);assert.equal(pixels[1],pixels[2]);assert.equal(pixels[3],127);assert.deepEqual(drawn.slice(1),[0,0,512,512]);console.log('Capture fallback and WebKit grey-water pixel/alpha/footprint check passed')})().catch(e=>{console.error(e);process.exit(1)});

}
