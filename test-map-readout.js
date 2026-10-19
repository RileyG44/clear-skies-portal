'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');
const take=(name,next)=>source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'('));
const env={map:{project:ll=>({x:ll.x,y:ll.y})},ElevationTileCore:require('./elevation-tile-core.js')};
vm.runInNewContext(take('cursorTileSample','cursorLoadedElevation'),env);
const tile={coords:{z:1,x:1,y:0},width:2,height:2,elev:new Float32Array([0,-100,NaN,1000])};
assert.equal(env.cursorTileSample(tile,{x:256,y:0}),0,'sea level is a valid elevation');
assert.equal(env.cursorTileSample(tile,{x:400,y:0}),-100,'negative elevations remain negative');
assert.equal(env.cursorTileSample(tile,{x:256,y:150}),null,'no-data stays unavailable');
assert.equal(env.cursorTileSample(tile,{x:400,y:150}),1000,'grid dimensions are respected');
assert.equal(env.cursorTileSample(tile,{x:-112,y:150}),1000,'wrapped longitude samples the same tile');
assert.equal(env.cursorTileSample(tile,{x:255,y:150}),null,'a point outside a tile cannot use its elevation');
assert.equal(env.cursorTileSample(tile,{x:400,y:256}),null,'tile boundary does not index the next row');
const ctx={calls:[],save(){},restore(){},setTransform(...args){this.calls.push(['transform',...args])},
  fillText(...args){this.calls.push(['text',...args])},fillRect(...args){this.calls.push(['rect',...args])},
  createLinearGradient(){return {addColorStop(){}}}};
vm.runInNewContext(take('drawSnapshotReadout','cursorTileSample').split('function setSnapshotReadoutEnabled(')[0],env);
const spec={width:2000,height:1200,scale:2,readout:{note:'Cursor location',coordinates:'47° N · 120° W',elevation:'Elevation ≈ 1,000 ft',keys:[{name:'Slope',bar:'linear-gradient(90deg,#fff 0%,#000 100%)',labels:['0°','90°']}]}};
env.drawSnapshotReadout(ctx,spec);
const normal=ctx.calls[0];assert.deepEqual(normal,['transform',2,0,0,2,24,1012]);
ctx.calls=[];env.drawSnapshotReadout(ctx,spec,900,700);
assert.deepEqual(ctx.calls[0],['transform',2,0,0,2,-876,312],'streamed blocks use full-image corner coordinates');
ctx.calls=[];env.drawSnapshotReadout(ctx,{...spec,readout:null});assert.equal(ctx.calls.length,0,'disabled option paints nothing');
const rendered=[];
const researchEnv={document:{createElement:()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:im=>rendered.push(im)}),toDataURL:()=>''})},researchQuantile:()=>1};
vm.runInNewContext(source.slice(source.indexOf('const RESEARCH_PALETTES='),source.indexOf('function runResearchWorker(')),researchEnv);
const result=researchEnv.researchColourRaster({width:3,height:1,label:'Local relief',data:new Float32Array([-1,0,1])},'lrm');
assert.equal(result.legend.labels[0],'-3.3 ft');assert.equal(result.legend.labels[2],'3.3 ft');
assert(result.legend.bar.includes('rgb(65,145,245) 0%'),'legend uses the renderer’s actual negative color');
assert.deepEqual([...rendered[0].data.slice(0,3)],[65,145,245]);
const normalized=researchEnv.researchColourRaster({width:1,height:1,label:'Anomaly',data:new Float32Array([1])},'residual');
assert.equal(normalized.legend.labels[2],'1 σ','standardized anomalies must not be labelled as feet');

/* LiDAR analysis looks: palettes, classes and the cursor readout text. */
researchEnv.CSPTerrainAnalysis=require('./terrain-analysis-core.js');researchEnv.reliefZFactor=c=>1;
rendered.length=0;researchEnv.researchQuantile=(data,q)=>q<.5?0:1;
const skyView=researchEnv.researchColourRaster({width:2,height:1,label:'Sky-view factor',data:new Float32Array([0,1])},'svf',{palette:'grey'});
assert.deepEqual([...rendered[0].data],[11,11,13,255,255,255,255,255],'sky-view greyscale runs dark to white');
assert.deepEqual([...skyView.legend.labels],['Enclosed','','Open sky']);
rendered.length=0;
researchEnv.researchColourRaster({width:3,height:1,label:'Avalanche',data:new Float32Array([20,33,40])},'avalanche',{palette:'caltopo'});
assert.equal(rendered[0].data[3],0,'slopes under 27° stay clear');
assert.deepEqual([...rendered[0].data.slice(4,7)],[240,122,34],'32–34° is the orange band');
assert.deepEqual([...rendered[0].data.slice(8,11)],[224,38,43],'35–45° is the red band');
rendered.length=0;
researchEnv.researchColourRaster({width:2,height:1,label:'Depressions',data:new Float32Array([0,2])},'depressions',{palette:'depth'});
assert.equal(rendered[0].data[3],0,'ground outside a sink is clear');assert(rendered[0].data[7]>200,'a deep sink is strongly painted');
rendered.length=0;
researchEnv.researchColourRaster({width:2,height:1,label:'Sky',data:new Float32Array([1,1])},'svf',{palette:'grey',relief:100,hillshade:new Float32Array([0,1])});
assert(rendered[0].data[0]<rendered[0].data[4],'relief shading darkens shadowed ground');
const looks=vm.runInNewContext('RESEARCH_LOOKS',researchEnv),palettes=vm.runInNewContext('RESEARCH_PALETTES',researchEnv);
assert.equal(looks.geomorphons.read(3),'Ridge');
assert.equal(looks.wind.read(4),'Sheltered 4.0° · snow loading');
assert.equal(looks.solar.read(3.25,5.5),'3.3 kWh/m² · 5.5 h direct sun');
for(const [product,look] of Object.entries(looks))
  for(const id of look.palettes) assert(palettes[id],`${product} palette ${id} exists`);

/* 3D cursor readout: resolved at rest, never per frame of camera motion. */
const gateStart=source.indexOf('const CURSOR_SETTLE_MS='),gateSource=source.slice(gateStart,source.indexOf('document.addEventListener("pointermove"',gateStart));
assert(gateSource.length>100&&gateSource.includes('function updateCursorLocation('),'cursor readout gate is present');
const timers=new Map();let timerId=0;
const runTimers=()=>{const due=[...timers.values()];timers.clear();due.forEach(fn=>fn())};
const text={'#cursorCoordinates':{textContent:''},'#cursorElevation':{textContent:''}};
let rectReads=0,resized=null,unprojects=0,projects=0,moving=false,sky=false;
const pending=new Set(),gate={
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),window:{},innerWidth:1200,
  addEventListener:(type,fn)=>{if(type==='resize')resized=fn},
  readoutRoot:{querySelector:()=>({classList:{toggle:(name,on)=>on?pending.add(name):pending.delete(name)}})},
  $:sel=>sel==='#map'?{getBoundingClientRect:()=>(rectReads++,{left:10,top:20,width:800,height:600})}:text[sel],
  L:{point:(x,y)=>({x,y})},snapSel:{hidden:true},document:{body:{classList:{contains:()=>false}}},
  cursorCoordinates:ll=>`${ll.lat},${ll.lng}`,refreshCursorElevation(){},paintCursorAnalysis(){},
  map:{containerPointToLatLng:p=>({lat:-p.y,lng:-p.x})},
  map3d:{isMoving:()=>moving,unproject:([x,y])=>(unprojects++,{lat:y/10,lng:x/10}),project:ll=>(projects++,sky?{x:-1e6,y:0}:{x:ll.lng*10,y:ll.lat*10})},
  cursorLocation:null,cursorElevation:null,cursorPointer:null,cursorFrame:0,snapshotCursorLocation:null
};
vm.createContext(gate);vm.runInContext(gateSource,gate);
const point=(x,y)=>{gate.cursorPointer={x,y};gate.updateCursorLocation()};
point(110,220);
assert.deepEqual({...gate.cursorLocation},{lat:20,lng:10},'a still camera resolves the exact pixel under the cursor');
assert.equal(unprojects,1);assert.equal(projects,1);
point(120,230);assert.equal(rectReads,1,'the map box is measured once, not per pointer move');
resized();point(120,230);assert.equal(rectReads,2,'a resize re-measures the map box');
const before=unprojects;
for(let frame=0;frame<30;frame++){gate.cursorCameraMoved();point(130+frame*10,240)}
assert.equal(unprojects,before,'no unproject while the camera is moving (per-frame setZoom included)');
assert.equal(gate.cursorLocation,null,'a moving camera drops the stale location');
assert(pending.has('pending'),'the readout is marked pending during motion');
moving=true;runTimers();
assert.equal(unprojects,before,'a camera still easing or dragged is not resolved');
assert.equal(timers.size,1,'the settle re-arms while the camera is still moving');
moving=false;runTimers();
assert.equal(unprojects,before+1,'the settle resolves exactly once');
assert.deepEqual({...gate.cursorLocation},{lat:22,lng:41},'the settled reading is for the last pointer position');
assert(!pending.has('pending'),'the settled readout is no longer pending');
moving=true;point(200,200);
assert.equal(unprojects,before+1,'a pointer move during a handler drag does not unproject');
assert.equal(timers.size,1,'and arms the settle');
moving=false;runTimers();assert.equal(unprojects,before+2);
const idle=unprojects;gate.cursorCameraMoved();gate.cursorCameraIdle();
assert.equal(unprojects,idle,'idle before the settle leaves it to the settle');
runTimers();gate.cursorCameraIdle();
assert.equal(unprojects,idle+2,'idle re-reads the still pointer once the finer terrain has rendered');
gate.cursorCameraIdle();gate.cursorCameraIdle();
assert.equal(unprojects,idle+4,'every idle re-reads (later DEM tiles, exaggeration changes)');
/* Snapshot selection: a camera move drops the captured cursor point, and the
   reading deferred by the open selection resolves when it closes. */
gate.snapshotCursorLocation={lat:30,lng:40};gate.cursorCameraMoved();runTimers();
assert.deepEqual({...gate.snapshotCursorLocation},{lat:30,lng:40},'moves with no selection open leave the export point alone');
gate.snapSel.hidden=false;const selected=unprojects;gate.cursorCameraMoved();
assert.equal(gate.snapshotCursorLocation,null,'a move during selection drops the stale export point');
runTimers();assert.equal(unprojects,selected,'no reading while the selection is open');
assert(pending.has('pending'),'and the readout stays pending');
gate.snapSel.hidden=true;gate.cursorSelectionClosed();
assert.equal(unprojects,selected+1,'closing the selection resolves the deferred reading');
assert(!pending.has('pending'),'closing the selection clears the pending mark');
gate.cursorSelectionClosed();assert.equal(unprojects,selected+1,'closing with nothing deferred reads nothing');
gate.cursorCameraMoved();gate.cursorSelectionClosed();
assert.equal(unprojects,selected+1,'a selection closed mid-motion leaves the reading to the settle');
runTimers();assert.equal(unprojects,selected+2);
sky=true;point(300,300);assert.equal(text['#cursorCoordinates'].textContent,'Cursor over sky');assert.equal(gate.cursorLocation,null);sky=false;
/* Leaving 3D with a reading pending: the settle resolves it on the 2D map. */
const view3d=gate.map3d,flat=unprojects;gate.cursorCameraMoved();gate.map3d=null;runTimers();
assert.deepEqual({...gate.cursorLocation},{lat:-280,lng:70},'exit resolves the pending reading on the 2D map');
assert(!pending.has('pending'),'exit to 2D clears the pending mark');assert.equal(timers.size,0,'and leaves no timer');
gate.map3d=view3d;gate.cursorCameraMoved();gate.snapSel.hidden=false;gate.map3d=null;runTimers();
assert(pending.has('pending'),'exit with a selection open defers to the selection');
gate.snapSel.hidden=true;gate.cursorSelectionClosed();assert(!pending.has('pending'),'and closing it resolves on the 2D map');
point(50,60);
assert.deepEqual({...gate.cursorLocation},{lat:-40,lng:-40},'2D readout is unchanged and ungated');
assert.equal(unprojects,flat);assert(!pending.has('pending'));
assert(take('endSnapshotSelect','snapPoint').includes('cursorSelectionClosed()'),'closing a snapshot selection resolves a deferred reading');
{
  const hook=/map\.on\("zoomanim move rotate",[^\n]*\n/.exec(source);assert(hook,'2D view motion drops the snapshot cursor point');
  const handlers={},flat={map:{on:(types,fn)=>types.split(' ').forEach(type=>handlers[type]=fn)},snapSel:{hidden:true},snapshotCursorLocation:{lat:30,lng:40}};
  vm.createContext(flat);vm.runInContext(hook[0],flat);
  handlers.move();assert.deepEqual({...flat.snapshotCursorLocation},{lat:30,lng:40},'2D motion with no selection open leaves the export point alone');
  for(const type of ['zoomanim','move','rotate']){
    flat.snapSel.hidden=false;flat.snapshotCursorLocation={lat:30,lng:40};handlers[type]();
    assert.equal(flat.snapshotCursorLocation,null,`2D ${type} during selection drops the stale export point`);
  }
}
/* The export decides cursor-or-centre once, before it awaits elevation and
   keys: a camera move during those awaits drops snapshotCursorLocation. */
(async()=>{
  const readoutStart=source.indexOf('async function createSnapshotReadout(');
  const exportEnv={snapshotCursorLocation:{lat:30,lng:40},map3d:null,PROXY:false,cursorTiles:new Map(),setTimeout,clearTimeout,AbortController,
    map:{containerPointToLatLng:()=>({lat:50,lng:60})},L:{point:p=>p},cursorLoadedElevation:()=>null,cursorTileSample:()=>null,
    cursorTileAddress:()=>({coords:{z:1,x:0,y:0},key:'k'}),cursorCoordinates:ll=>`${ll.lat},${ll.lng}`,readoutColourKeys:()=>[]};
  let elevation,keys;
  exportEnv.publicElevationWithFallback=()=>new Promise(r=>elevation=r);exportEnv.loadSnowColourKeys=()=>new Promise(r=>keys=r);
  vm.createContext(exportEnv);vm.runInContext(source.slice(readoutStart,source.indexOf('function drawSnapshotReadout(')),exportEnv);
  const spec={sel:{x:0,y:0,w:10,h:10}},pendingExport=exportEnv.createSnapshotReadout(spec);
  exportEnv.snapshotCursorLocation=null;elevation(null);await new Promise(r=>setImmediate(r));
  exportEnv.snapshotCursorLocation=null;keys();
  const info=await pendingExport;
  assert.equal(info.coordinates,'30,40');assert.equal(info.note,'Cursor location','a move during the export cannot relabel the cursor point');
  const centre=exportEnv.createSnapshotReadout(spec);elevation(null);await new Promise(r=>setImmediate(r));keys();
  const fallback=await centre;assert.equal(fallback.coordinates,'50,60');assert.equal(fallback.note,'Selection center');
  console.log('map readout checks passed (tile sampling, no-data, wrap, export option, streamed position, renderer palettes and units, 3D readout gated on camera motion, selection and exit lifecycle, export label frozen before its awaits)');
})().catch(error=>{console.error(error);process.exit(1)});
