'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('markup.js','utf8');
const renderer=source.slice(source.indexOf('function drawGround('),source.indexOf('let terrainView='));
// Record Canvas commands in output coordinates. These tests check physical
// dimensions and alpha across projections, independently of SVG/DOM rendering.
class Context{
  constructor(){this.globalAlpha=1;this.commands=[];this.stack=[]}
  save(){this.stack.push({globalAlpha:this.globalAlpha,lineWidth:this.lineWidth})}
  restore(){Object.assign(this,this.stack.pop())}
  beginPath(){} closePath(){} moveTo(x,y){this.commands.push(['move',x,y])}
  lineTo(x,y){this.commands.push(['line',x,y])}
  stroke(){this.commands.push(['stroke',this.lineWidth,this.globalAlpha])}
  fill(){this.commands.push(['fill',this.globalAlpha])}
  arc(){} translate(){} rotate(){}
  scale(x,y){this.commands.push(['scale',x,y])}
  strokeText(t,x,y){this.commands.push(['text',t,x,y,this.globalAlpha])}
  fillText(){}
}
const sandbox={LINES:new Set(['pen','highlight','line','arrow','arrow2']),AREAS:new Set(['area','rect','shape','circle']),
  featureLat:f=>f.geometry.type==='Point'?f.geometry.coordinates[1]:f.geometry.type==='Polygon'?f.geometry.coordinates[0][0][1]:f.geometry.coordinates[0][1],
  toLL:c=>({lng:c[0],lat:c[1]}),haloFor:()=> '#fff',layers:new Map()};
vm.runInNewContext(renderer,sandbox);
const frozen=f=>{Object.freeze(f.properties);Object.freeze(f.geometry.coordinates);Object.freeze(f.geometry);return Object.freeze(f)};
const line=frozen({geometry:{type:'LineString',coordinates:[[0,0],[1,0]]},properties:{kind:'pen',width:12*.3048,opacity:1}});
const project=ll=>({x:ll.lng*100,y:-ll.lat*100});
const coarse=new Context(),fine=new Context();
sandbox.drawGround(coarse,[line],'#f00',project,()=>1);
sandbox.drawGround(fine,[line],'#f00',project,()=>.5);
assert.equal(coarse.commands.find(c=>c[0]==='stroke')[1],3.6576000000000004,'12 feet stays a ground width');
assert.equal(fine.commands.find(c=>c[0]==='stroke')[1],coarse.commands.find(c=>c[0]==='stroke')[1]*2,'twice the resolution gets twice the stroke pixels');
const polygon=frozen({geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{kind:'shape',width:1,opacity:.4,fill:.3}});
const faded=new Context();faded.globalAlpha=.5;sandbox.drawGround(faded,[polygon],'#f00',project,()=>1);
assert.equal(faded.commands.find(c=>c[0]==='fill')[1],.15,'layer opacity multiplies shape fill');
assert.equal(faded.commands.find(c=>c[0]==='stroke')[2],.2,'layer opacity multiplies outline opacity');
assert.equal(faded.globalAlpha,.5,'drawing restores the caller alpha');
const text=frozen({geometry:{type:'Point',coordinates:[0,0]},properties:{kind:'text',text:'40 ft',size:40*.3048,opacity:1}});
const label=new Context();sandbox.drawGround(label,[text],'#f00',project,()=>1);
assert.equal(label.commands.find(c=>c[0]==='scale')[1],12.192/24,'text height is fixed in ground units');
const visible={doc:{markup:{id:'a'},features:[line]},visible:true,opacity:100,pane:{}};
sandbox.layers.set('a',visible);
assert.equal(sandbox.snapshotEntries().length,1);
visible.visible=false;assert.equal(sandbox.snapshotEntries().length,0,'hidden annotations are excluded from export');
assert.equal(sandbox.drawSnapshotLayer(new Context(),'a',{}),false,'hidden annotations cannot paint a snapshot');
visible.visible=true;visible.opacity=0;assert.equal(sandbox.snapshotEntries().length,0,'fully transparent layers are excluded');
console.log('markup render checks passed (fixed feet, output scaling, fill/stroke opacity, text, hidden layers, immutable geometry)');

// Screen calculations normalize MapLibre's 512px world to Leaflet's 256px world.
const zoomCode=source.slice(source.indexOf('const viewZoom='),source.indexOf('const here='));
const zoomEnv={view3d:()=>({getZoom:()=>16}),map:{getZoom:()=>12}};
vm.runInNewContext(zoomCode+';result=viewZoom();',zoomEnv);assert.equal(zoomEnv.result,17);
const flatZoomEnv={view3d:()=>null,map:{getZoom:()=>12}};
vm.runInNewContext(zoomCode+';result=viewZoom();',flatZoomEnv);assert.equal(flatZoomEnv.result,12);
const circumference=40075016.686;
const boundsCode=source.slice(source.indexOf('const featureBounds='),source.indexOf('async function prepare3d('));
const boundsEnv={MERC:circumference,featureLat:sandbox.featureLat,cToP:c=>({x:c[0]/360*circumference,y:Math.log(Math.tan(Math.PI/4+c[1]*Math.PI/360))*circumference/(2*Math.PI)})};
vm.runInNewContext(boundsCode,boundsEnv);
const mark={geometry:{type:'LineString',coordinates:[[-120.31,47.415],[-120.309,47.415]]},properties:{kind:'pen',width:4}};
const layer={renderRevision:1,doc:{features:[mark]}};
const z=16,n=2**z,x=Math.floor((mark.geometry.coordinates[0][0]/360+.5)*n),y=Math.floor((.5-Math.log(Math.tan(Math.PI/4+mark.geometry.coordinates[0][1]*Math.PI/360))/(2*Math.PI))*n);
assert.equal(boundsEnv.featuresForTile(layer,z,x,y).length,1,'ground mark intersects its geographic tile');
assert.equal(boundsEnv.featuresForTile(layer,z,x+100,y).length,0,'distant tiles skip this mark');
mark.geometry.coordinates=mark.geometry.coordinates.map(c=>[c[0]+1,c[1]]);layer.renderRevision++;
assert.equal(boundsEnv.featuresForTile(layer,z,x,y).length,0,'editing invalidates cached bounds');
console.log('markup projection checks passed (3D zoom normalization, geographic tile culling and revision invalidation)');

// A rotated map and streamed crop must paint the same geographic position.
const snapshotEnv={...sandbox,map:{getZoom:()=>12,getCenter:()=>({lat:0,lng:0}),
  project:()=>({x:0,y:0,add:([x,y])=>({x,y})}),unproject:p=>p,
  latLngToContainerPoint:p=>({x:100-p.y,y:200+p.x})},mpp:()=>1};
vm.runInNewContext(renderer,snapshotEnv);
snapshotEnv.drawGround=()=>{};
visible.opacity=100;
const transformContext={canvas:{width:600,height:400},save(){},restore(){},setTransform(...args){this.transform=args}};
snapshotEnv.drawSnapshotLayer(transformContext,'a',{scale:2,sel:{x:10,y:20}});
assert.deepEqual(transformContext.transform,[0,2,-2,0,180,360],'rotation and crop are preserved in the export transform');
snapshotEnv.drawSnapshotLayer(transformContext,'a',{scale:2,sel:{x:310,y:120}});
assert.deepEqual(transformContext.transform,[0,2,-2,0,-420,160],'streamed blocks offset the same ground projection');
console.log('markup snapshot checks passed (map rotation, crop and streamed block offsets)');
