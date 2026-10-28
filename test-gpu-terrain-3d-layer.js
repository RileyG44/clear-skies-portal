"use strict";
const assert=require("node:assert/strict");
const Layer=require("./gpu-terrain-3d-layer.js"),Cache=require("./gpu-terrain-3d-cache.js");
// A spectrum debounce queued before GPU activation must not restore CPU URLs.
{
  const fs=require("node:fs"),vm=require("node:vm"),html=require("./test-fixtures/page-source.js");
  const fn=html.slice(html.indexOf("function sync3dSpectrum(){"),html.indexOf("/* Numbers for what an aspect map"));
  let callback,writes=0,cleared=0,deferred=0,paint=false;
  const env={elev3dTimer:0,gpu3d:null,map3dBuiltKey:"same",map3dStructureKey:()=>"same",
    map3d:{getSource:()=>({setTiles(){writes++;}})},elevSpectrumRevision:0,
    apply3dLighting:()=>paint,schedule3dStyle(){deferred++;},refresh3dStyle(){throw Error("unexpected rebuild");},
    setTimeout(fn){callback=fn;return 1;},clearTimeout(){cleared++;}};
  vm.createContext(env);vm.runInContext(fn,env);env.sync3dSpectrum();
  env.gpu3d={enabled:true};callback();assert.equal(writes,0);assert.equal(deferred,1);
  paint=true;env.sync3dSpectrum();assert.equal(cleared,2,"GPU fast path cancels old timer");
  assert.equal(writes,0);
  env.gpu3d=null;env.sync3dSpectrum();callback();assert.equal(writes,1,"legacy path still refreshes");
}
function fixture(){
  const callbacks=new Map(),layers=new Map([["terrain-analysis",{}],["elev-spectrum",{}]]);
  const grid=new Float32Array(256*256).fill(123),handles=[{},{}],tiles=handles.map(handle=>({state:"loaded",
    tileID:{canonical:{z:3,x:2,y:2}},texture:{texture:handle,size:[256,256],useMipmap:true}}));
  let draws=0,creates=0,destroys=0,releases=0,fail=false;
  const map={painter:{context:{gl:{texStorage2D(){},isContextLost:()=>false},setDirty(){}}},
    style:{tileManagers:Object.fromEntries(["analysis","elevspec"].map((id,i)=>[id,{getIds:()=>["tile"],getTileByID:()=>tiles[i]}]))},
    terrain:{tileManager:{releaseRTT(){releases++;}}},
    on(name,fn){if(!callbacks.has(name))callbacks.set(name,new Set());callbacks.get(name).add(fn);},
    off(name,fn){callbacks.get(name)?.delete(fn);},getLayer:id=>layers.get(id),
    addLayer(layer){layers.set(layer.id,layer);},getLayoutProperty:()=>"visible",getTerrain:()=>({source:"dem"}),
    triggerRepaint(){},isStyleLoaded:()=>true};
  const renderer={create(){creates++;return {renderBatch(jobs){if(fail)throw Error("GPU test failure");draws+=jobs.length;return {drawn:jobs.length};},
    stats:()=>({draws}),clear(){},destroy(){destroys++;}};}};
  const states={analysis:{terrain:{style:"slope"}},elevspec:{terrain:{style:"off"},spectrum:{level:123}}};
  const statuses=[],fallbacks=[];
  const controller=Layer.create({map,version:"6.6.0",renderer,cacheModule:Cache,loadGrid:async()=>grid,
    groundResolution:()=>1,getStates:()=>states,onStatus:(...args)=>statuses.push(args),onFallback:e=>fallbacks.push(e)});
  return {map,controller,states,tiles,statuses,fallbacks,callbacks,prerender:()=>layers.get("csp-gpu3d-shade").prerender(),
    counts:()=>({draws,creates,destroys,releases}),setFail:()=>{fail=true;}};
}
(async()=>{
  assert.equal(Layer.resolveFlag("",null),true);
  assert.equal(Layer.resolveFlag("?gpu3d=0",null),false);
  assert.equal(Layer.resolveFlag("?gpu3d=1",{getItem:()=>"0"}),true);
  const f=fixture();assert(f.controller.enabled);
  await f.controller.prepare(3,2,2);f.prerender();
  assert.equal(f.counts().draws,2,"both native raster outputs shaded from one record");
  assert.equal(f.controller.stats().cache.entries,1,"analytical and spectrum share skirt");
  f.prerender();assert.equal(f.counts().draws,2,"clean camera frames do no shade work");
  f.states.analysis.terrain.style="aspect";f.controller.update();f.prerender();
  assert.equal(f.counts().draws,3,"style uniform change shades analysis only");
  f.states.elevspec.spectrum.level=456;f.controller.update();f.prerender();
  assert.equal(f.counts().draws,4,"spectrum uniform change shades spectrum only");
  f.tiles[0].texture.texture={};f.prerender();assert.equal(f.counts().draws,5,"recycled native texture is repainted");
  assert.equal(f.counts().releases,4,"duplicate analytical/spectrum coordinates invalidate the terrain once");
  f.callbacks.get("webglcontextlost").forEach(fn=>fn());assert(f.controller.stats().lost);
  f.callbacks.get("webglcontextrestored").forEach(fn=>fn());f.prerender();
  assert.equal(f.counts().creates,2);assert.equal(f.counts().draws,7,"restore reuses CPU records and repaints outputs");
  f.controller.destroy();f.controller.destroy();assert.equal(f.counts().destroys,1,"only live restored renderer destroyed once");
  assert.equal([...f.callbacks.values()].reduce((n,s)=>n+s.size,0),0,"all listeners removed");
  const broken=fixture();await broken.controller.prepare(3,2,2);broken.setFail();broken.prerender();
  assert.equal(broken.controller.enabled,false);assert.match(broken.controller.stats().error,/GPU test failure/);
  assert.equal(broken.fallbacks.length,1);broken.prerender();assert.equal(broken.fallbacks.length,1);broken.controller.destroy();
  console.log("3D GPU layer scheduling, RTT invalidation, restoration and fallback tests passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
