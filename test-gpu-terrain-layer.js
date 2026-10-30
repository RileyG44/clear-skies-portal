'use strict';
const assert=require('node:assert/strict');
const {mercator,resolveFlag,buildState,levelOffset,viewFromMap,exportView}=require('./gpu-terrain-layer.js');
let checks=0;
function near(a,b,epsilon=1e-10){assert(Math.abs(a-b)<epsilon,`${a} != ${b}`);checks++;}
near(mercator({lat:0,lng:0})[0],.5);near(mercator({lat:0,lng:0})[1],.5);
near(mercator({lat:85.0511287798,lng:180})[1],0);
const storage={getItem:()=> '0'};
assert.equal(resolveFlag('?gpu2d=1',storage),true);assert.equal(resolveFlag('?gpu2d=0',{getItem:()=> '1'}),false);
assert.equal(resolveFlag('',storage),false);assert.equal(resolveFlag('?gpu2d=invalid',{getItem:()=> '1'}),true);
assert.equal(resolveFlag('',{getItem(){throw Error('denied')}}),true);checks+=5;
const map={getSize:()=>({x:1000,y:600}),getZoom:()=>14,getBearing:()=>37,getCenter:()=>({lat:47.858,lng:-118.33})};
const view=viewFromMap(map,null,2);
assert.deepEqual(view,{centerMerc:mercator(map.getCenter()),zoom:14,bearing:37,cssSize:[1000,600],dpr:2,dz:1});
assert.equal(viewFromMap(map,null,1.49).dz,0);assert.equal(viewFromMap(map,null,1.5).dz,1);
// A 3x screen gets 0.7 to 1.4 elevation samples per physical pixel at every zoom.
for(let zoom=10;zoom<20;zoom+=.03){
  const level=Math.round(zoom)+levelOffset(zoom,3),density=2**level/2**zoom/3;
  assert.ok(density>=.7&&density<=1.42,`zoom ${zoom}: ${density} samples per pixel`);
}
const painted=viewFromMap(map,{center:{lat:0,lng:0},zoom:14.375},1);
near(painted.zoom,14.375);near(painted.centerMerc[0],.5);checks+=3;
const settings={style:'aspect',opacity:.63,look:{contrast:115,saturation:82,brightness:106},
  lighting:{azimuth:37,altitude:52,ambient:.12},spectrum:{spectrumOn:true,level:335,bandAlpha:.52},spectrumOpacity:.9};
assert.deepEqual(buildState(settings),{terrain:{style:'aspect',opacity:.63,look:settings.look,lighting:settings.lighting},spectrum:settings.spectrum,spectrumOpacity:.9});checks++;
// Crop displacement must be inverse-rotated; a screen-right offset at 90°
// is north in Mercator. Export density must not change the CSS zoom.
for(const bearing of [0,37,90,180])for(const scale of [1,2,4]){
 const v={...view,bearing},spec={sel:{x:500,y:300,w:200,h:100},scale,width:200*scale,height:100*scale};
 const out=exportView(v,spec),a=bearing*Math.PI/180,w=256*2**view.zoom;
 near(out.centerMerc[0],v.centerMerc[0]+(100*Math.cos(a)+50*Math.sin(a))/w);
 near(out.centerMerc[1],v.centerMerc[1]+(-100*Math.sin(a)+50*Math.cos(a))/w);
 assert.deepEqual(out.cssSize,[200,100]);near(out.zoom,view.zoom);near(out.dpr,scale);checks++;
 const full=exportView(v,{sel:{x:0,y:0,w:1000,h:600},scale,width:1000*scale,height:600*scale});
 assert.deepEqual(full.centerMerc,v.centerMerc);checks++;
}
console.log(`GPU terrain layer: ${checks} checks passed (views, flags, state, rotated export 1×/2×/4×)`);
