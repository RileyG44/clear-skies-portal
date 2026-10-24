"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const html=fs.readFileSync(require.resolve("./index.html"),"utf8");
const adapter=fs.readFileSync(require.resolve("./ios/Resources/native-shell.js"),"utf8");
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

async function main(){
  const retina={HIDPI:true};
  vm.createContext(retina);
  vm.runInContext(section(html,"function sharpSceneUrl(","\nconst ResilientTileLayer="),retina);
  const cog="https://titiler.xyz/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=https%3A%2F%2Fexample.test%2FTCI.tif";
  assert.equal(retina.sharpSceneUrl(cog),cog+"&tilesize=512","TiTiler 2 needs a query parameter, not @2x");
  assert.equal(retina.sharpSceneUrl(cog+"&tilesize=256"),cog+"&tilesize=512");
  assert.equal(retina.sharpSceneUrl(retina.sharpSceneUrl(cog)),cog+"&tilesize=512","retina tuning is idempotent");
  assert.equal(retina.sharpSceneUrl(cog.replace("{y}","{y}@1x")),cog+"&tilesize=512");
  const pc="https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?collection=sentinel-2-l2a&item=selected-date";
  assert.equal(retina.sharpSceneUrl(pc),pc.replace("@1x","@2x"),"preserve Planetary Computer's advertised syntax and acquisition");
  const context="https://gibs.earthdata.nasa.gov/wmts/{z}/{y}/{x}.jpg";
  assert.equal(retina.sharpSceneUrl(context),context,"context is not upsampled into claimed detail");
  retina.HIDPI=false;
  assert.equal(retina.sharpSceneUrl(cog),cog,"ordinary displays keep the ordinary tile endpoint");

  const pane={dataset:{pane:"results"},querySelector(){throw Error("native panes must not animate offscreen");}};
  const panes={window:{CSPNativeHost:{}},paneMotions:new Map(),paneState:{min:{results:false}},
    matchMedia:()=>({matches:false}),applyPanes(){},savePanes(){},reflowMap(){},requestAnimationFrame:fn=>fn()};
  vm.createContext(panes);
  vm.runInContext(section(html,"function togglePaneAnimated(","\n/* A normal tap anywhere"),panes);
  panes.togglePaneAnimated(pane);assert.equal(panes.paneState.min.results,true);
  panes.togglePaneAnimated(pane);assert.equal(panes.paneState.min.results,false,"an immediate reopen cannot be lost behind an offscreen close animation");

  const root={hidden:false},view={panel:"ctl"};let closed=0;
  const panel={view,document:{getElementById:()=>root},$:selector=>({click(){assert.equal(selector,"#ctlCollapse");closed++;root.hidden=true;}}),schedule(){}};
  vm.createContext(panel);
  vm.runInContext(section(adapter,"const PANELS =", "  const openPanel =")+
    "\nconst commands={"+section(adapter,"closePanel(id) {", "    statusText:").trim().replace(/,$/,"")+"}; globalThis.close=commands.closePanel;",panel);
  panel.close("ctl");panel.close("ctl");
  assert.equal(closed,1,"closing is idempotent and invokes the real collapse control");assert.equal(view.panel,null);

  class Layer{
    constructor(url,options){this._url=url;this.options=options;this.events={};this._tiles={a:{},b:{}};}
    on(type,fn){(this.events[type]??=[]).push(fn);return this;}
    emit(type){for(const fn of this.events[type]||[])fn();}
    addTo(map){map.layers.add(this);return this;}
    setOpacity(value){this.options.opacity=value;return this;}
    setZIndex(){return this;}
  }
  const controls=Object.fromEntries(["#op","#mosaic","#mosStat","#ctlName","#ctlDate","#ctlLink"].map(id=>[id,{value:100,checked:false,dataset:{},textContent:""}]));
  const map={layers:new Set(),hasLayer(layer){return this.layers.has(layer);},removeLayer(layer){this.layers.delete(layer);}};
  const timers=new Map();let timer=0,fillCalls=0,resolveMetadata;
  const scene={map,$:id=>controls[id],AbortController,sceneToken:0,sceneAbort:null,overlay:null,overlayPending:null,footprint:null,
    SEL:null,ITEMS:[{id:"a",label:"Selected dated scene",src:"Provider",srcKey:"test",date:"2026-10-21",gsd:10,tiles:{}}],
    mosToken:0,mosAbort:null,MOSAIC_ON:false,MOBILE:{matches:true},IMG_TILE_OPTS:{},VIEW_MAX:28,
    render(){},showSceneControls(){},ago:()=>"3 days ago",safeHttpUrl:()=>"",cancelPendingNeighbours(){},hideMenu(){},
    document:{body:{classList:{add(){}}}},performance:{now:()=>0},recordProviderOutcome(){},clearMosaic(){},
    fillMosaic(){fillCalls++;},tileUrl:async()=>cog,trackLayerHealth:layer=>layer,
    resilientLayer:(url,options)=>new Layer(url,options),
    setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(scene);
  vm.runInContext(section(html,"function itemLeafletBounds(","\n/* a stable id")+"\n"+
    section(html,"async function select(","\n/* ------------------------------------------------- side panel:"),scene);
  await scene.select(0);
  const first=scene.overlayPending;
  assert.equal(first.options.opacity,0,"a scene stages invisibly without Auto Fill");
  first.emit("tileload");first.emit("tileload");first.emit("load");
  assert.equal(scene.overlay,first);assert.equal(first.options.opacity,1);assert.equal(fillCalls,0,"a selected scene must load independently of Auto Fill");
  assert.equal(first.options.maxNativeZoom,14,"10m scenes retain finer tile levels for zoom refinement");
  assert.equal(scene.imageryNativeZoom({nativeMax:null,gsd:.6}),18,"a null native zoom must never freeze imagery at z0");
  assert.equal(scene.imageryNativeZoom({nativeMax:9,gsd:250}),9,"coarse context retains its actual ceiling");
  await scene.select(0);const failed=scene.overlayPending;failed.emit("tileerror");failed.emit("tileerror");failed.emit("load");
  assert.equal(scene.overlay,first);assert(map.hasLayer(first));assert(!map.hasLayer(failed),"a failed scene keeps useful previous imagery");
  scene.tileUrl=()=>new Promise(resolve=>{resolveMetadata=resolve;});const obsolete=scene.select(0);
  const stale=resolveMetadata;
  scene.tileUrl=async()=>cog+"&new-date=1";await scene.select(0);const newest=scene.overlayPending;
  stale(cog+"&old-date=1");await obsolete;
  assert.equal(scene.overlayPending,newest,"reversed metadata responses cannot install an obsolete scene");
  newest.emit("tileload");newest.emit("tileload");newest.emit("load");assert.equal(scene.overlay,newest);assert(!map.hasLayer(first));
  timers.clear();
  console.log("satellite checks passed (provider retina APIs, immediate disclosures, panel close, scene application, native zoom, failure retention, reversed responses)");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
