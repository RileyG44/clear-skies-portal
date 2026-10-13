'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('markup.js','utf8');
const functionCode=(name,next)=>source.slice(source.indexOf(`function ${name}(`),source.indexOf(next,source.indexOf(`function ${name}(`)));
const saved=[];
let zoomUnit=2,rot=.8;
const env={styles:{ink:{color:'#ff0000',opacity:100},text:{size:28,groundSize:999}},editing:{doc:{markup:{color:'#000000'}}},
  placementUnit:space=>space?.metresPerPixel||zoomUnit,screenRot:()=>rot,toC:ll=>[ll.lng,ll.lat],
  textEditor:(px,initial,color,done)=>{zoomUnit=8;rot=0;done('note');},addFeature:(kind,geometry,props)=>saved.push({kind,geometry,props})};
vm.runInNewContext(functionCode('placeText','/* ------------------------------------------------------------------ eraser'),env);
env.placeText('text',{lng:-120,lat:47},{x:100,y:200});
assert.equal(saved[0].props.size,56,'font size is resolved at placement, independent of camera movement while typing');
assert.equal(saved[0].props.fontSize,28,'font control saves typographic size');
assert.equal(saved[0].props.rot,.8,'rotated map orientation is captured before editor opens');
const space={anchor:[-120,47,500],right:[1,0,0],up:[0,0,1],metresPerPixel:.2};
rot=0;env.placeText('text',{lng:-120,lat:47},{x:100,y:200},space);
assert.equal(saved[1].props.size,5.6,'world sign resolves font size using its fixed placement plane');
assert.deepEqual(saved[1].props.space3d,space,'saved feature retains full 3D pose');
const restored=JSON.parse(JSON.stringify(saved[1]));assert.deepEqual(restored.props.space3d,space,'3D pose round-trips with GeoJSON JSON');
const styleEnv={selectedFeature:()=>restored,currentStyle:()=>({family:'text'}),styles:{ink:{},highlight:{},text:{},fill:{}},saveStyles(){},styleEdit:false,
  pushUndo(){},featureLat:()=>47,mpp:()=>1000,viewZoom:()=>1,renderFeature(){},touch(){},drawFrame(){},editing:{}};
vm.runInNewContext(functionCode('applyStyle','/* Surface/space'),styleEnv);
const selected={properties:{...saved[1].props}};styleEnv.selectedFeature=()=>selected;
styleEnv.applyStyle('size',56,true);assert.equal(selected.properties.size,11.2,'font resize scales fixed physical size even after zoom changes');
assert.equal(selected.properties.fontSize,56);
const boundsEnv={featureBounds:new WeakMap(),MERC:40075016.686};
vm.runInNewContext(functionCode('featuresForTile','async function prepare3d('),boundsEnv);
assert.equal(boundsEnv.featuresForTile({doc:{features:[{properties:{space3d:space}}]}},10,0,0).length,0,'floating signs never rasterize onto terrain');
console.log('markup placement checks passed (placement-time font size/orientation, fixed world sizing, JSON persistence, terrain separation)');

// Preserve the actual baseline when snapping a rotated sign after moving
// closer: the placement-time pixel scale deliberately differs from this view.
const mark={geometry:{type:'Point',coordinates:[10,0]},properties:{kind:'text',size:5.6,width:.2,fontSize:28,rot:.65,space3d:{anchor:[0,0,500],metresPerPixel:.2}}};
const conversion={selectedFeature:()=>mark,tool:'select',styles:{placement:{snap:true,textSnap:false,distance:300}},saveStyles(){},cancelDraft(){},paintBar(){},
  projectedPoints:f=>[{x:f.geometry.coordinates[0],y:f.geometry.coordinates[1]}],
  featurePx:(f,ll)=>({x:ll.lng*2,y:-ll.lat*2}),unproj:q=>({lng:q.x,lat:q.y}),featureLat:()=>0,
  pxLL:px=>({lng:px.x/.25,lat:-px.y/.25}),onGround:()=>true,proj:ll=>({x:ll.lng,y:ll.lat}),toLL:c=>({lng:c[0],lat:c[1]}),toC:ll=>[ll.lng,ll.lat],
  window:{CSPMarkup3D:{}},view3d:()=>({}),pushUndo(){},editing:{},renderFeature(){},touch(){},drawFrame(){}};
vm.runInNewContext(functionCode('mapCoords','/* An old-style circle'),conversion);
vm.runInNewContext(functionCode('changePlacement','bar.addEventListener("change"'),conversion);
conversion.changePlacement(true);
assert(Math.abs(mark.properties.rot-.65)<1e-12,'snap preserves the rotated baseline');
assert(Math.abs(mark.properties.size-44.8)<1e-10,'snap resolves sizing from the current camera, not placement-time pixels');
assert(Math.abs(mark.properties.width-1.6)<1e-10,'snap resolves stroke width from the current view');
assert.equal(mark.properties.fontSize,28,'snap preserves the font setting');assert.equal(mark.properties.space3d,undefined);

// A partially clipped line remains selectable along its visible segment.
const hit={view3d:()=>({}),window:{CSPMarkup3D:{isVisible:()=>true,project:()=>({visible:false})}},strokePx:()=>0,
  featurePx:(f,ll)=>({x:ll.lng,y:ll.lat}),toLL:c=>({lng:c[0],lat:c[1]}),clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};
vm.runInNewContext(functionCode('distToSeg','function inside(')+functionCode('hitFeature','function hitTest('),hit);
assert(hit.hitFeature({properties:{kind:'line',space3d:space},geometry:{type:'LineString',coordinates:[[-10,50],[50,50]]}},{x:10,y:50}),
  'first vertex outside the viewport does not reject the visible part of a world line');
console.log('markup conversion/picking checks passed (rotated baseline, current camera size, partially clipped line)');
