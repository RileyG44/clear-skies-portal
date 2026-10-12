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
vm.runInNewContext(take('researchColourRaster','runResearchWorker'),researchEnv);
const result=researchEnv.researchColourRaster({width:3,height:1,label:'Local relief',data:new Float32Array([-1,0,1])},'lrm');
assert.equal(result.legend.labels[0],'-3.3 ft');assert.equal(result.legend.labels[2],'3.3 ft');
assert(result.legend.bar.includes('rgb(65,145,245) 0%'),'legend uses the renderer’s actual negative color');
assert.deepEqual([...rendered[0].data.slice(0,3)],[65,145,245]);
const normalized=researchEnv.researchColourRaster({width:1,height:1,label:'Anomaly',data:new Float32Array([1])},'residual');
assert.equal(normalized.legend.labels[2],'1 σ','standardized anomalies must not be labelled as feet');

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
  cursorCoordinates:ll=>`${ll.lat},${ll.lng}`,refreshCursorElevation(){},
  map:{containerPointToLatLng:p=>({lat:-p.y,lng:-p.x})},
  map3d:{isMoving:()=>moving,unproject:([x,y])=>(unprojects++,{lat:y/10,lng:x/10}),project:ll=>(projects++,sky?{x:-1e6,y:0}:{x:ll.lng*10,y:ll.lat*10})},
  cursorLocation:null,cursorElevation:null,cursorPointer:null,cursorFrame:0
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
sky=true;point(300,300);assert.equal(text['#cursorCoordinates'].textContent,'Cursor over sky');assert.equal(gate.cursorLocation,null);sky=false;
gate.map3d=null;const flat=unprojects;gate.cursorCameraMoved();timers.clear();point(50,60);
assert.deepEqual({...gate.cursorLocation},{lat:-40,lng:-40},'2D readout is unchanged and ungated');
assert.equal(unprojects,flat);assert(!pending.has('pending'),'2D clears a pending mark left by 3D');
console.log('map readout checks passed (tile sampling, no-data, wrap, export option, streamed position, renderer palettes and units, 3D readout gated on camera motion)');
