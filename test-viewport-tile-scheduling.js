'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {ElevationTileStore}=require('./gpu-terrain-store'),{RequestPool}=require('./tile-pipeline');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const data=()=>({width:2,height:2,grid:new Float32Array([100,100,100,100])});

function layerSettlement(){
  let next=0;const timers=new Map(),renders=[];
  const L={Layer:{extend:methods=>{function Layer(){}Layer.prototype=methods;return Layer;}}};
  const context={L,setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(require.resolve('./gpu-terrain-layer'),'utf8'),context);
  const map={_cspPaneZoom:true,_animatingZoom:false},canvas={style:{}},view={zoom:14.25,cssSize:[390,844],dpr:3};
  const layer=Object.assign(Object.create(L.CSPGpuTerrainLayer.prototype),{
    _container:{},_map:map,_canvas:canvas,_pan:{coarse:false},_panTrack(){},_panStop(){},
    _deriveView:()=>view,_engine:{render:(v,o)=>renders.push({zoom:v.zoom,...o})},
    redraw(){this._dirty=true;},fire(){},_dirty:true
  });
  // _draw uses the browser root's body visibility, without needing a DOM/GPU.
  context.document={body:{classList:{contains:()=>false}}};
  for(const zoom of [14.25,15.5,16.67]){
    view.zoom=zoom;layer._zoomAnim({center:{},zoom,noUpdate:true});
    assert.equal(renders.at(-1).deferRequests,true,'every passing preview shades without issuing elevation demand');
  }
  assert.equal(timers.size,1,'camera events coalesce to one settlement timer');
  const flush=()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());};
  flush();assert.equal(timers.size,1,'an active pane gesture cannot settle early');
  map._cspPaneZoom=false;layer._moved({type:'zoomend'});layer._moved({type:'moveend'});
  flush();layer._draw();
  assert.equal(renders.at(-1).zoom,16.67,'intermediate zoom is refreshed at its exact resting view');
  assert.equal(renders.at(-1).deferRequests,false);assert.equal(renders.at(-1).refreshRequests,true);
  layer.redraw();layer._draw();assert.equal(renders.at(-1).refreshRequests,false,'a tile arrival or style redraw is not another demand refresh');
  layer._moved({type:'moveend'});flush();layer._draw();
  assert.equal(renders.at(-1).refreshRequests,true,'settling within unchanged rounded tile bounds still refreshes demand');
}

function fallbackDeferral(){
  const source=fs.readFileSync(require.resolve('./app/map'),'utf8');
  const block=source.slice(source.indexOf('/* A pinch commits the view on the way'),source.indexOf('/* Photographic tiles on a 2x/3x screen'));
  let updates=0;const events={},layers=[];
  const proto={_invalidateAll(){},_resetView(){this._update();},_update(){updates++;},_setView(){}};
  const map={_cspDeferExpensive:true,getCenter:()=>({}),getZoom:()=>16.67,on:(event,fn)=>events[event]=fn,eachLayer:fn=>layers.forEach(fn)};
  vm.runInNewContext(block,{map,L:{GridLayer:{prototype:proto}}});
  const layer=Object.assign(Object.create(proto),{_cspExpensive:true,_map:map});layers.push(layer);
  layer._resetView();assert.equal(layer._cspDeferred,true);layer._update();assert.equal(updates,0);
  map._cspDeferExpensive=false;layer._resetView();
  assert.equal(layer._cspDeferred,false);assert.equal(updates,1,'a normal reset releases an earlier gesture deferral');
  map._cspDeferExpensive=true;layer._resetView();map._cspDeferExpensive=false;events.moveend();
  assert.equal(layer._cspDeferred,false);assert.equal(updates,2,'moveend releases deferral even without the touch animation callback');
}

async function visibleFirst(){
  const pool=new RequestPool({concurrency:3,groupLimits:{detail:1},backgroundConcurrency:1}),started=[],pending=new Map();
  const spec={id:'raw',rank:3,label:'raw',nativeZoom:18,group:'detail',url:(z,x,y)=>`${z}/${x}/${y}`};
  const store=new ElevationTileStore({sources:[spec],prioritize:(...args)=>pool.prioritize(...args),
    request:(url,o)=>pool.request(url,signal=>new Promise((resolve,reject)=>{
      started.push(url);pending.set(url,resolve);signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});
    }),o)});
  try{
    // Wrapped x=0 is the nearest tile to a view straddling +180 degrees.
    const row=[14,15,0,1].map(x=>({z:4,x,y:8}));
    store.want(row,{bounds:{z:4,x0:15,x1:16,y0:8,y1:8}});await tick();
    assert.equal(started[0],'4/15/8','the antimeridian centre is ordered in the visible world copy');
    assert.equal(pool.jobs.get('4/14/8').background,true);assert.equal(pool.jobs.get('4/1/8').background,true);
    assert.equal(pool.jobs.get('4/0/8').background,false);
    // A small pan keeps the same tile list, but promotes x=1 and demotes x=15.
    store.want(row,{bounds:{z:4,x0:16,x1:17,y0:8,y1:8}});await tick();
    assert.equal(pool.jobs.get('4/1/8').background,false,'newly visible queued demand is promoted');
    assert.equal(started[1],'4/0/8','a formerly visible render yields its slot when it becomes prefetch');
    pending.get('4/0/8')(data());await tick();assert.equal(started[2],'4/1/8');
    pending.get('4/1/8')(data());await tick();
    assert.equal(store.settled().refining,false,'offscreen prefetch never holds visible readiness');
    assert.equal(started[3],'4/15/8','departed foreground work requeues only after visible detail has finished');
    store.want([]);await tick();assert.equal(pool.queue.length,0);assert.equal(pool.active,0,'leaving the view drains obsolete work');
  }finally{store.destroy();}
}

(async()=>{layerSettlement();fallbackDeferral();await visibleFirst();console.log('Viewport tile scheduling: intermediate settlement, fallback deferral, wrapped priorities, promotion and idle prefetch passed');})()
  .catch(error=>{console.error(error);process.exitCode=1;});
