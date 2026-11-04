'use strict';
const assert=require('node:assert/strict');
const R=require('./lidar-render.js'),G=require('./water-geography.js'),S=require('./gpu-terrain-shaders.js');

// A substantial ocean footprint must never set the land palette's endpoints.
const heights=[...Array(900).fill(-4500),...Array.from({length:100},(_,i)=>i*1.5),-86,4200];
const water=Uint8Array.from(heights,(_,i)=>+(i<900));
const before=heights.slice(),fit=R.fitElevation(heights,water);
assert.deepEqual(fit,{land:[-90,4200],water:[-4500,-4499]});
assert.deepEqual(heights,before,'fitting never changes elevations');
assert.deepEqual(R.fitElevation(heights,water,'full'),[-4500,4200]);
assert.ok(R.fitElevation(heights,water,'robust')[1]<4200,'trimming remains an explicit option');
assert.deepEqual(R.fitElevation(heights,null),[-4500,4200],'missing geography retains all heights');
assert.deepEqual(R.fitElevation([NaN,Infinity,-Infinity],new Uint8Array(3)),null);
assert.deepEqual(R.fitElevation([10,20],new Uint8Array(2)),{land:[10,20],water:null});
assert.deepEqual(R.fitElevation([200,300],new Uint8Array([1,1])),{land:null,water:[200,300]},'lake beds need not be below sea level');
assert.equal(R.fitElevation([],[]),null);
assert.deepEqual(R.stableElevationFit([1,99],[0,100]),[0,100],'small inward moves do not shimmer');
assert.deepEqual(R.stableElevationFit([-.1,100.1],[0,100]),[-.1,100.1],'every new extreme is admitted');
assert.deepEqual(R.stableElevationFit([10,90],[0,100]),[10,90],'a materially different view refits');
assert.deepEqual(R.stableElevationFit({land:[1,99],water:null},{land:[0,100],water:[-5000,0]}),{land:[0,100],water:null},'domain changes clear stale water');
assert.deepEqual(R.stableElevationFit([1,99],[0,100],true),[1,99],'explicit fit ignores smoothing');
assert.equal(R.defaultLayer('tint').auto,false,'Classic relief retains its fixed absolute domain');
assert.equal(R.isLegacy(R.emptyState(),'tint'),true,'untouched Classic relief retains the original renderer');
const classic=R.defaultLayer('tint');
assert.equal(R.toHex(R._test.paletteColour({...classic,stops:R.resolveStops(classic)},1000)),'#858c5e','Missoula land keeps its fixed olive color');



for(const [name,lon,lat,expected] of [
  ['Death Valley',-116.8258,36.24,false],['Zuidplaspolder',4.65,51.99,false],['Flevoland',5.65,52.5,false],['Seattle',-122.33,47.61,false],
  ['Fiji',178.4,-18.1,false],['Mariana Trench',142.2,11.35,true],['Pacific',-130,40,true],
  ['Lake Superior',-87,47.5,true],['Dead Sea',35.47,31.5,true],['Caspian Sea',50,42,true],
  ['San Francisco Bay',-122.35,37.8,true],['San Pablo Bay',-122.4,37.98,true],
  ['Puget Sound',-122.45,47.6,true],['Puget Sound north',-122.45,47.8,true],
  ['Hood Canal',-122.88,47.67,true],['Bosphorus',29.06,41.1,true],
  ['Pacific east of date line',-179,0,true],['Pacific west of date line',179,0,true]
]){
  assert.equal(G.waterAt(lon,lat),expected,name);
  assert.equal(G.waterAt(lon+360,lat),expected,name+' wrapped');
  const y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;
  assert.equal(G.waterAtMercator((lon+180)/360,y),expected,name+' Mercator');
}
assert.equal(G.bytes().byteLength,16*1024*1024,'packed geography has a bounded CPU/GPU footprint');
assert.equal(G.waterAt(NaN,0),false);
assert.equal(G.waterAt(0,91),false);

const state=R.emptyState();state.base.tint={...R.defaultLayer('tint'),auto:true,palette:'viridis',param:0};
const stack=R.buildStack(state,'tint',{base:fit});
assert.deepEqual([stack.layers[0].min,stack.layers[0].max],fit.land);
assert.deepEqual(stack.layers[0].water,fit.water);
assert.deepEqual(S.stackUniforms(stack).c.slice(0,4),[0,1,...fit.water]);
state.base.tint.auto=false;
assert.equal(R.buildStack(state,'tint',{base:fit}).layers[0].water,null,'manual ranges remain continuous');
state.base.tint.auto=true;state.base.tint.rangeMode='full';
assert.equal(R.buildStack(state,'tint',{base:[-4500,4200]}).layers[0].water,null);
assert.equal(R.normalizeState({base:{tint:{rangeMode:'bad'}}}).base.tint.rangeMode,'separate');
assert.equal(R.normalizeState({base:{tint:{rangeMode:'robust'}}}).base.tint.rangeMode,'robust');
// Preserve a custom ramp's transparency when giving its water a blue ramp.
const layer={min:0,max:100,gamma:1,steps:0,stops:[[0,0,0,0,.2],[1,1,1,1,.8]]};
assert.ok(Math.abs(R.waterColour(-50,[-100,0],layer)[3]-.5)<1e-12);
console.log('Elevation scaling: ocean-heavy views, rare land extrema, inland depressions, lakes, missing/invalid data, wrapping, manual ranges and transparency passed');
