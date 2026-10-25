'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require.resolve('./index.html'),'utf8');
class Canvas{}
class Layer{
  constructor(content=true){this.options={opacity:.7};this.opacity=.7;this.handlers=new Map();this._tiles={a:{loaded:1,current:true,el:Object.assign(new Canvas(),{_cspHasContent:content})}};}
  on(event,fn){this.handlers.set(event,fn);return this;}
  off(event){this.handlers.delete(event);return this;}
  emit(event){this.handlers.get(event)?.();}
  addTo(map){map.layers.add(this);this.opacityAtAdd=this.opacity;return this;}
  setOpacity(value){this.opacity=value;return this;}
}
async function main(){
  const map={layers:new Set(),hasLayer(layer){return this.layers.has(layer);},removeLayer(layer){this.layers.delete(layer);}};
  const timers=new Map();let timerId=0;
  const context={map,HTMLCanvasElement:Canvas,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    terrainSwap:null,terrainSwapMessage:'',terBase:null,terLayer:null,terSig:null,
    terrainLoadStatus:{dataset:{}},scheduleTerrainStatus:()=>{},applyTerrainAppearanceTo:()=>{},$:()=>({value:'70'}),
    mosToken:1,PENDING_NEIGH:new Set()};
  const install=html.slice(html.indexOf('function installTerrain('),html.indexOf('\nlet terSig=',html.indexOf('function installTerrain(')));
  const wait=html.slice(html.indexOf('function waitForLayerTiles('),html.indexOf('\nasync function pooled(',html.indexOf('function waitForLayerTiles(')));
  vm.runInNewContext(install+'\n'+wait,context);
  const old=new Layer(),next=new Layer(false);context.terLayer=old;map.layers.add(old);
  context.installTerrain(null,next);
  assert.equal(next.opacityAtAdd,0,'new terrain is staged invisibly');
  next.emit('load');assert.equal(map.hasLayer(old),true,'empty response cannot remove good terrain');
  next._tiles.a.el._cspHasContent=true;next.emit('load');
  assert.equal(map.hasLayer(old),false);assert.equal(next.opacity,.7);
  const failed=new Layer(false);context.installTerrain(null,failed);context.terrainSwap(false);
  assert.equal(context.terLayer,next,'failed replacement restores the working layer');
  assert.equal(map.hasLayer(failed),false);assert.equal(next.opacity,.7);
  const candidate=new Layer();const ready=context.waitForLayerTiles(candidate,1);
  assert.equal(candidate.opacityAtAdd,0,'mosaic candidate must never flash during validation');
  candidate.emit('tileload');candidate.emit('load');
  assert.equal((await ready).ready,true);assert.equal(candidate.opacity,0,'validation alone must not commit a mosaic layer');
  const partial=new Layer();partial._tiles.b={};const incomplete=context.waitForLayerTiles(partial,1);
  partial.emit('tileload');partial.emit('tileerror');partial.emit('load');assert.equal((await incomplete).ready,false);
  map.layers.clear();timers.clear();
  const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
  const controls=new Map(['#op','#mosaic','#mosStat','#ctlName','#ctlDate','#ctlLink'].map(id=>[id,{value:70,checked:true,dataset:{},textContent:''}]));
  const primary=new Layer(),pending=new Layer(),outline=new Layer(),neighbour=new Layer(),backdrop=new Layer(),pendingNeighbour=new Layer(),reference=new Layer();
  for(const layer of [primary,pending,outline,neighbour,backdrop,pendingNeighbour,reference])map.layers.add(layer);
  pending._cspReadyTimer=context.setTimeout(()=>{throw Error('removed scene timer ran');});
  let pendingCancelled=false;
  pendingNeighbour._cspCancelWait=()=>{pendingCancelled=true;};
  const sceneController=new AbortController(),mosaicController=new AbortController();
  const scene={
    map,$:id=>controls.get(id),AbortController,sceneToken:2,sceneAbort:sceneController,
    overlay:primary,overlayPending:pending,footprint:outline,SEL:0,ITEMS:[],
    NEIGH:[{layer:neighbour}],MOSAIC_BACKDROP:{layer:backdrop},PENDING_NEIGH:new Set([pendingNeighbour]),
    MOSAIC_ON:true,MOSAIC_ONCE:true,mosToken:5,mosAbort:mosaicController,
    mosTimer:context.setTimeout(()=>{throw Error('removed mosaic timer ran');}),
    clearTimeout:context.clearTimeout,syncChecks:()=>{},hideMenu:()=>{},hideSceneControls:()=>{},
    render:()=>{},document:{dispatchEvent:()=>{}},CustomEvent:class{},
    cspInput:()=>{throw Error('Off must remove the scene, not change its opacity');}
  };
  vm.createContext(scene);
  vm.runInContext(section('function cancelPendingNeighbours(','\n/* Whether the mosaic is live.')+
    section('function clearScene(','\n$("#clr").onclick=')+
    section('function cspSetLayerVisible(','\nfunction cspSetLayerOpacity('),scene);
  scene.cspSetLayerVisible('scene',false);
  assert.deepEqual([...map.layers],[reference],'Off removes scene, footprint, neighbours, backdrop, and staged layers only');
  assert(sceneController.signal.aborted&&mosaicController.signal.aborted,'Off aborts scene metadata and mosaic requests');
  assert(pendingCancelled,'Off cancels staged neighbour validation');
  assert.equal(timers.size,0,'Off cancels scene readiness and delayed mosaic timers');
  for(const key of ['overlay','overlayPending','footprint','sceneAbort','mosAbort','mosTimer','SEL'])assert.equal(scene[key],null,key+' is released');
  assert.equal(scene.NEIGH.length,0);assert.equal(scene.PENDING_NEIGH.size,0);
  assert.equal(scene.MOSAIC_ONCE,false,'Off ends a one-off fill');
  assert.equal(controls.get('#mosaic').checked,true,'Off keeps the Auto-fill surroundings choice');
  assert.equal(scene.MOSAIC_ON,true,'the next scene still auto-fills when the switch is on');
  controls.get('#mosaic').checked=false;scene.clearScene(false);
  assert.equal(scene.MOSAIC_ON,false,'a switched-off Auto-fill stays off');
  controls.get('#mosaic').checked=true;

  // A metadata response that arrives after Off must never install a new layer.
  let resolveMetadata;
  Object.assign(scene,{
    ITEMS:[{label:'Test scene',src:'Test provider',date:'2026-10-11',tiles:{},geom:{}}],
    showSceneControls:()=>{},ago:()=>'',safeHttpUrl:()=>'',L:{geoJSON:()=>new Layer()},
    tileUrl:()=>new Promise(resolve=>{resolveMetadata=resolve;})
  });
  vm.runInContext(section('async function select(','\n/* ------------------------------------------------- side panel:'),scene);
  const selecting=scene.select(0);
  assert(scene.footprint&&map.hasLayer(scene.footprint),'explicit selection adds its outline');
  const metadataController=scene.sceneAbort;
  scene.cspSetLayerVisible('scene',false);
  resolveMetadata('https://example.invalid/{z}/{x}/{y}.png');
  await selecting;
  assert(metadataController.signal.aborted);
  assert.deepEqual([...map.layers],[reference],'late scene response cannot resurrect imagery after Off');

  const result={id:'available-scene'},searchControls={'#cloud':{value:30}};
  let cleared=false;
  const search={
    LOC:{lat:47,lng:-119},searchToken:0,searchAbort:null,AbortController,ITEMS:[],RESULT_SHOWN:{},
    clearScene:renderResults=>{assert.equal(renderResults,false);cleared=true;},
    dateWindow:()=>({}),$:id=>searchControls[id],render:()=>{},
    statusEl:{dataset:{},innerHTML:''},SOURCES:[{key:'test',name:'Test provider'}],
    stacSearch:async()=>[result],gibsItems:()=>[],renderPasses:()=>{},refreshTerrainCoverage:()=>{},
    autoSelect:()=>{throw Error('search must never auto-select imagery');},
    select:()=>{throw Error('search must never apply imagery');}
  };
  vm.createContext(search);
  vm.runInContext(section('async function run(','\n/* ---------------------------------------------------------------- render */'),search);
  await search.run();
  assert(cleared,'new search clears any previous scene');
  assert.equal(search.ITEMS[0],result,'scene catalog still loads in the background');

  // The native imagery button is the explicit exception: it searches, then
  // applies the Best photo pick from the filtered pool, and nothing else.
  const photo={label:'Sentinel-2 L2A',date:'2026-10-20T19:01:00Z',gsd:10,cloud:3};
  const radar={label:'Sentinel-1',date:'2026-10-22T02:00:00Z',gsd:10};
  const selected=[];let pool=[radar,photo],supersede=false;
  const best={
    LOC:{lat:47,lng:-119},searchToken:0,ITEMS:[],
    run(){ const token=++best.searchToken;best.ITEMS=[radar,photo];return Promise.resolve().then(()=>{ if(supersede) best.searchToken=token+1 }) },
    resultPool:()=>pool,bestPhoto:list=>list.includes(photo)?photo:null,
    select:async i=>{selected.push(i)},res:gsd=>gsd+' m'
  };
  vm.createContext(best);
  vm.runInContext(section('async function cspSearchBestImagery(','\n$("#go").onclick=')+';this.searchBest=cspSearchBestImagery;',best);
  let outcome=await best.searchBest();
  assert.deepEqual(selected,[1],'the button applies the Best photo scene');
  assert.equal(outcome.applied,true);assert.match(outcome.message,/Sentinel-2 L2A · 2026-10-20 · 10 m · 3% cloud/);
  pool=[radar];outcome=await best.searchBest();
  assert.equal(outcome.applied,false);assert.equal(selected.length,1,'no clear photo means nothing is applied');
  assert.match(outcome.message,/No clear true-color scene/);
  pool=[radar,photo];supersede=true;outcome=await best.searchBest();
  assert.equal(outcome.applied,false);assert.equal(selected.length,1,'a newer search wins over a superseded button press');
  supersede=false;best.LOC=null;outcome=await best.searchBest();
  assert.equal(outcome.applied,false);assert.equal(selected.length,1,'no selected place, no search');
  // Exercise the actual status painter after a replacement fails, in 3D,
  // and when offline. Retaining old tiles must never claim the request succeeded.
  const statusControls={'#terStyle':{value:'hs'},'#terrainSourceSummary':{innerHTML:''}};
  let is3d=false,summary={sources:[],coverage:100,refining:false,failed:false},text3d='3D mesh: ready. Analytical drape: waiting for data.';
  const status={document:{body:{classList:{contains:()=>is3d}}},navigator:{onLine:true},$:id=>statusControls[id],
    terrainLoadStatus:{hidden:false,dataset:{},textContent:''},terrainSwap:null,terrainSwapMessage:'Requested terrain unavailable · previous map preserved.',
    terLayer:null,elevLayer:null,dnrAreas:[],terrainLayerSummary:()=>summary,elevationActive:()=>false,
    public3dSourceText:()=>text3d,dnrAcquisitionText:()=>'',esc:value=>value,renderTerrainSourcePanel:()=>{},CompositeTerrainLayer:class{}};
  vm.createContext(status);
  vm.runInContext(section('function paintTerrainStatus(','\nmap.on("moveend",scheduleTerrainStatus);'),status);
  status.paintTerrainStatus();assert.equal(status.terrainLoadStatus.dataset.state,'partial','failed replacement stays partial after repaint');
  status.terrainSwapMessage='';status.paintTerrainStatus();assert.equal(status.terrainLoadStatus.dataset.state,'ready');
  is3d=true;status.paintTerrainStatus();assert.equal(status.terrainLoadStatus.dataset.state,'loading','3D readiness cannot come from the ready 2D layer');
  text3d='3D mesh: USGS. Analytical drape: USGS.';status.paintTerrainStatus();assert.equal(status.terrainLoadStatus.dataset.state,'ready');
  status.navigator.onLine=false;status.paintTerrainStatus();assert.equal(status.terrainLoadStatus.dataset.state,'offline');
  assert(status.terrainLoadStatus.textContent.includes('reconnect'));
  status.navigator.onLine=true;is3d=false;summary={sources:[],coverage:0,refining:true,failed:true};
  status.paintTerrainStatus();assert.equal(status.terrainLoadStatus.dataset.state,'partial','failed empty terrain stops the indefinite loading status');

  console.log('layer transition checks passed (staging, rollback, mosaic cleanup, scene Off, late responses, search without auto-selection, explicit best imagery)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
