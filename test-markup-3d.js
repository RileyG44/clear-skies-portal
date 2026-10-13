'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {mat4,vec3,glMatrix}=require('gl-matrix');
glMatrix.setMatrixArrayType(Float64Array);
const window={},document={fonts:{addEventListener(){},removeEventListener(){}}};
vm.runInNewContext(fs.readFileSync('markup-3d.js','utf8'),{window,document,console});
const api=window.CSPMarkup3D;
const gl=new Proxy({}, {get:(o,k)=> k==='getShaderParameter'||k==='getProgramParameter'?()=>true:k==='getAttribLocation'?()=>0:k==='getParameter'?()=>null:k==='isEnabled'?()=>false:k.startsWith('create')?()=>({}):k[0]===k[0].toUpperCase()?k:()=>{}});
const v={getCanvas:()=>({clientWidth:900,clientHeight:600}),getProjection:()=>({type:'mercator'}),triggerRepaint(){}};
const layer=api.createLayer({},v,()=>[],()=>{});
assert.equal(api.createPlacement(v,{x:400,y:300},100),null);
layer.onAdd(v,gl);
const CIRC=2*Math.PI*6371008.8,lat=47,scale=1/(CIRC*Math.cos(lat*Math.PI/180));
const a=[(-119+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/Math.PI)/2];
const camera=[a[0],a[1]+200*scale,1000*scale],target=[a[0],a[1],0];
function matrix(camera,target){const view=mat4.lookAt(mat4.create(),camera,target,[0,0,1]),proj=mat4.perspective(mat4.create(),Math.PI/3,1.5,scale*.1,scale*1e6);proj[0]*=-1;return mat4.multiply(mat4.create(),proj,view)}
function render(camera,target){layer.render(gl,{defaultProjectionData:{mainMatrix:matrix(camera,target)}})}
render(camera,target);
for(const px of [{x:450,y:300},{x:280,y:110},{x:810,y:520}]){
  const space=api.createPlacement(v,px,300);assert(space,'valid placement');
  const geo=api.screenToGround(v,px,space);assert(geo,'valid plane intersection');
  assert(Math.abs(geo.lng-space.anchor[0])<1e-8&&Math.abs(geo.lat-space.anchor[1])<1e-8,'clicked anchor encoded exactly');
  const p=api.project(v,geo,space);assert(p.visible);assert(Math.abs(p.x-px.x)<1e-5&&Math.abs(p.y-px.y)<1e-5,'screen to plane roundtrip');
  for(const offset of [[20,-10],[-43,35]]){const screen={x:px.x+offset[0],y:px.y+offset[1]},coords=api.screenToGround(v,screen,space),q=api.project(v,coords,space);assert(Math.abs(q.x-screen.x)<1e-5&&Math.abs(q.y-screen.y)<1e-5,'plane to screen arbitrary roundtrip')}
  const m=[(space.anchor[0]+180)/360,(1-Math.log(Math.tan(Math.PI/4+space.anchor[1]*Math.PI/360))/Math.PI)/2,space.anchor[2]/(CIRC*Math.cos(space.anchor[1]*Math.PI/180))];
  assert(Math.abs(vec3.distance(camera,m)*(CIRC*Math.cos((2*Math.atan(Math.exp((1-2*camera[1])*Math.PI))-Math.PI/2)))-300)<1e-5,'300 m camera distance');
  assert(Math.abs(vec3.dot(space.right,space.up))<1e-12,'orthogonal plane axes');assert(space.metresPerPixel>0);
}
const space=api.createPlacement(v,{x:450,y:300},300),before=JSON.stringify(space),geo=space.anchor.slice(0,2);
const moved=[camera[0]+120*scale,camera[1],camera[2]];render(moved,target);
assert.equal(JSON.stringify(space),before,'navigation preserves fixed plane');
assert(Math.abs(api.project(v,geo,space).x-450)>5,'fixed anchor changes screen position after navigation');
const p0=[(space.anchor[0]+180)/360,(1-Math.log(Math.tan(Math.PI/4+space.anchor[1]*Math.PI/360))/Math.PI)/2,space.anchor[2]/(CIRC*Math.cos(space.anchor[1]*Math.PI/180))];
const behind=p0.map((x,i)=>2*x-camera[i]);render(behind,p0);
assert.equal(api.isVisible(v,space),false,'back face hidden');assert.equal(api.project(v,geo,space).visible,false);assert.equal(api.screenToGround(v,{x:450,y:300},space),null);
layer.onRemove();assert.equal(api.createPlacement(v,{x:450,y:300},100),null,'removed view invalidates matrix');
layer.onAdd(v,gl);render(camera,target);assert(api.createPlacement(v,{x:450,y:300},100),'re-entry initializes');layer.onRemove();
console.log('PASS world markup: perspective camera distance, three placements, sky-capable rays, XY roundtrips, fixed navigation anchor, backface gating, remove/re-entry');
