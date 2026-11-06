"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {test}=require("node:test");
const source=fs.readFileSync("app/terrain-3d.js","utf8");
const ready=source.slice(source.indexOf("function map3dStyleReady("),source.indexOf("function initGpu3d("));
const paint=source.slice(source.indexOf("function analyticalStyle("),source.indexOf('$("#terMode2d").onclick'));
const configure=source.slice(source.indexOf("function configureMaplibre("),source.indexOf("/* The 3D engine is"));
for(const href of ["clearskies://app/index.html","https://rileyg44.github.io/clear-skies-portal/map/","http://127.0.0.1:8770/"])
  test(`MapLibre uses the shipped terrain worker at ${new URL(href).protocol}`,()=>{
    let url;
    const env={URL,location:{href}};
    vm.createContext(env);vm.runInContext(configure,env);
    env.configureMaplibre({setWorkerUrl(value){url=value;}});
    assert.equal(url,new URL("./vendor/maplibre-gl-worker.mjs",href).href);
    assert.equal(new URL(url).protocol,new URL(href).protocol,"the native worker stays inside the bundled app");
  });
function fixture(gpu=true){
  const timers=new Map(),properties=new Map(),visibility=new Map(),light={azimuth:315,altitude:45,ambient:.12,exaggeration:1.25};
  let timer=0,rebuilds=0,updates=0,terrain={source:"dem",exaggeration:1.25},sky,loaded=true;
  const map={
    // The style exists, but a slow elevation tile has not arrived.
    isStyleLoaded:()=>false,
    getLayer:id=>loaded?{id}:undefined,
    getTerrain:()=>terrain,setTerrain:value=>{terrain=value;},
    getLayoutProperty:id=>visibility.get(id),setLayoutProperty:(id,name,value)=>visibility.set(id,value),
    setPaintProperty:(id,name,value)=>properties.set(id+":"+name,value),
    setSky:value=>{sky=value;}
  };
  const env={map3d:map,map3dBuiltKey:"same",map3dStructureKey:()=>"same",gpu3d:gpu?{enabled:true,update(){updates++;}}:null,
    terrainLighting:()=>light,terrainOpacity:()=>70,$:()=>({value:"hs"}),chooseTerrain:()=>({src:"analytic"}),
    studioStack:()=>null,elevationActive:()=>false,terrainTheme:()=>"light",terrainSky:(theme,value)=>({...value}),
    setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout(id){timers.delete(id);},
    map3dLightTimer:null,map3dStyleTimer:null,refresh3dStyle(){rebuilds++;}
  };
  vm.createContext(env);vm.runInContext(ready+paint,env);
  return {env,light,map,properties,visibility,loaded(value){loaded=value;},
    flush(){while(timers.size){const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();}},
    stats:()=>({rebuilds,updates,terrain,sky})};
}
for(const gpu of [true,false])test(`sun and relief update without discarding loading terrain (GPU=${gpu})`,()=>{
  const f=fixture(gpu);
  f.light.azimuth=135;f.light.altitude=20;f.light.exaggeration=2.5;
  f.env.schedule3dStyle();f.flush();
  assert.equal(f.properties.get("terrain-hillshade:hillshade-illumination-direction"),135);
  assert.equal(f.properties.get("terrain-hillshade:hillshade-illumination-altitude"),20);
  assert.equal(f.stats().terrain.exaggeration,2.5,"the mesh gains relief before all tiles finish");
  assert.equal(f.stats().sky.azimuth,135);
  assert.equal(f.stats().rebuilds,0,"lighting preserves the source tiles already loading");
  assert.equal(f.stats().updates,gpu?1:0,"resident analytical textures use the new light immediately");
  assert.equal(f.env.map3d,f.map,"the same map keeps the camera and terrain");
});
test("paint waits for the style definition, not the first fully loaded viewport",()=>{
  const f=fixture();f.loaded(false);
  assert.equal(f.env.apply3dLighting(),false);
  assert.equal(f.stats().updates,0);
  f.loaded(true);
  assert.equal(f.map.isStyleLoaded(),false);
  assert.equal(f.env.apply3dLighting(),true);
  assert.equal(f.stats().updates,1);
});
