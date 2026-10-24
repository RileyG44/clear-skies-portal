"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const html=fs.readFileSync(require.resolve("./index.html"),"utf8");
const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const {snapshotAuxTransform}=require("./gpu-terrain-engine.js")._test;

function gestures(){
  const listeners={},inside={},outside={},handle={closest:()=>({dataset:{h:"se"}})};
  inside.closest=outside.closest=()=>null;
  const surface={addEventListener:(name,fn)=>listeners[name]=fn,setPointerCapture(){}};
  const c={snapSel:surface,snapBox:{contains:target=>target===inside||target===handle},snapBar:{contains:()=>false},snapRect:{x:60,y:160,w:260,h:540},snapDrag:null,
    snapshotExporting:false,SNAP_MIN:16,snapBounds:()=>({left:0,top:0,w:430,h:932}),layoutSnapSel(){},
    L:{DomEvent:{disableClickPropagation:target=>{assert.equal(target,surface);}}}};
  vm.createContext(c);
  vm.runInContext(section("function snapPoint(","snapBox.addEventListener(\"dblclick\""),c);
  const event=(type,x,y,extra={})=>({type,clientX:x,clientY:y,pointerId:1,pointerType:"touch",button:0,target:outside,preventDefault(){},stopPropagation(){},...extra});
  assert.equal(c.snapHandleAt({x:338,y:718},c.snapRect,26),"se","a finger just outside a corner still grabs the corner");
  assert.equal(c.snapHandleAt({x:150,y:152},c.snapRect,26),"n","edges work between the visible dots");
  assert.equal(c.snapHandleAt({x:150,y:300},c.snapRect,26),"");
  listeners.pointerdown(event("pointerdown",338,718));
  listeners.pointerdown(event("pointerdown",100,100,{pointerId:2}));
  assert.equal(c.snapDrag.id,1,"a second finger cannot replace the active resize");
  listeners.pointermove(event("pointermove",20,20,{pointerId:2}));assert.equal(c.snapRect.x,60);
  listeners.pointermove(event("pointermove",368,758));listeners.pointerup(event("pointerup",368,758));
  assert.deepEqual({...c.snapRect},{x:60,y:160,w:290,h:580},"resize preserves the opposite corner and the grab offset");
  listeners.pointerdown(event("pointerdown",150,155));listeners.pointermove(event("pointermove",150,135));listeners.pointerup(event("pointerup",150,135));
  assert.deepEqual({...c.snapRect},{x:60,y:140,w:290,h:600},"top-edge drag changes height without moving the bottom");
  const before={...c.snapRect};
  listeners.pointerdown(event("pointerdown",180,400,{target:inside}));listeners.pointermove(event("pointermove",200,420));listeners.pointercancel(event("pointercancel",200,420));
  assert.deepEqual({...c.snapRect},before,"cancelled gestures restore the original rectangle");
  listeners.pointerdown(event("pointerdown",180,400,{target:inside}));listeners.pointermove(event("pointermove",190,410));listeners.lostpointercapture(event("lostpointercapture",190,410));
  assert.equal(c.snapDrag,null,"lost capture cannot leave a stale drag alive");
}
function coordinates(){
  // Transform the same geographic sample independently through each camera.
  const project=(v,ll)=>{const r=(v.bearing||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r),px=256*2**v.zoom*v.dpr;
    const dx=(ll[0]-v.centerMerc[0])*px,dy=(ll[1]-v.centerMerc[1])*px;
    return [v.cssSize[0]*v.dpr/2+c*dx-s*dy,v.cssSize[1]*v.dpr/2-s*dx-c*dy];};
  const reference={zoom:15.25,bearing:37,centerMerc:[.41,.35],cssSize:[430,932],dpr:3};
  for(const bearing of [0,37,90])for(const dpr of [1,4,32]){
    const view={...reference,bearing,dpr,centerMerc:[.410001,.350002],cssSize:[80,53]},w=80*dpr,h=53*dpr;
    const m=snapshotAuxTransform(reference,view,w,h);
    for(const ll of [[.41,.35],[.410002,.349999]]){
      const p=project(view,ll),want=project(reference,ll),got=[m[0]*p[0]+m[3]*p[1]+m[6],m[1]*p[0]+m[4]*p[1]+m[7]];
      got.forEach((n,i)=>assert(Math.abs(n-want[i])<1e-6,"capture fields must stay registered across crops, rotation and 32x density"));
    }
  }
}
async function compositor(fail=false){
  let entries=0,blocks=0,releases=0,rows=0,aborted=0;
  const ctx={setTransform(){},fillRect(){},drawImage(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})};
  const canvas={width:0,height:0,getContext:()=>ctx};ctx.canvas=canvas;
  const c={document:{createElement:()=>canvas},$:()=>({}),getComputedStyle:()=>({backgroundColor:"#000"}),
    SNAPSHOT_BAND_PIXELS:4_000_000,SNAPSHOT_BLOCK_EDGE:4096,gpuTerrainEnabled:true,
    gpuTerrainLayer:{snapshotEntry(){entries++;return {kind:"gpu-terrain",canvas:async spec=>{blocks++;assert(spec.width<=4096&&spec.height<=1024);
      if(fail&&blocks===2)throw Error("GPU lost");return {};},dispose:()=>releases++};}},
    snapshotPaintOrder:x=>x,snapshotDomItems:()=>[],window:{},snapshotProgressAt:0,performance:{now:()=>0},snapshotReport(){},
    drawSnapshotReadout(){},CSPPngStream:{create:()=>({writeRows:async(data,h)=>{rows+=h;},finish:async()=>{},abort:()=>aborted++})}};
  vm.createContext(c);vm.runInContext(section("async function composeSnapshotStream(","\n/* Where a streamed export goes."),c);
  const task=c.composeSnapshotStream({width:5000,height:2100,scale:32,sel:{x:10,y:20,w:156.25,h:65.625},plans:[]},()=>{});
  if(fail)await assert.rejects(task,/GPU lost/);else{await task;assert.equal(rows,2100);assert.equal(blocks,6);}
  assert.equal(entries,1,"one terrain snapshot must serve every streamed block");assert.equal(releases,1,"capture resources are released on success and failure");assert.equal(aborted,fail?1:0);
}
(async()=>{gestures();coordinates();await compositor();await compositor(true);console.log("capture checks passed (touch targets, edge/corner offsets, pointer ownership/cancellation, frozen field registration, streamed session reuse/cleanup)");})().catch(error=>{console.error(error);process.exitCode=1;});
