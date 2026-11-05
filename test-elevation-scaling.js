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
  ['Lake Victoria',33,-1,false],['Lake Tanganyika',29.6,-6.2,false],
  ['Lake Superior',-87,47.5,false],['Lake Erie',-81.5,42.2,false],
  ['Great Salt Lake',-112.5,41.2,false],['Salton Sea',-115.8,33.3,false],
  ['Dead Sea',35.47,31.5,false],['Caspian Sea',50,42,false],
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

// Relative relief keeps its inland contrast, but no ocean sample sets its fit.
const remHeights=[...Array(90).fill(-5000),...Array.from({length:10},(_,i)=>100+i*10)];
const remWater=Uint8Array.from(remHeights,(_,i)=>+(i<90));
const remValues=remHeights.map((h,i)=>i<90?2000+i:10+i-90);
assert.deepEqual(R.fitRelative(remValues,remHeights,remWater),{land:R.fitRange(remValues.slice(90),'rem'),water:[-5000,-4999]});
assert.deepEqual(R.fitRelative(remValues.slice(90),remHeights.slice(90),new Uint8Array(10)).land,R.fitRange(remValues.slice(90),'rem'),'inland REM fit is unchanged');
assert.deepEqual(R.fitRelative([NaN,NaN],[-9000,-2500],new Uint8Array([1,1])),{land:null,water:[-9000,-2500]},'water fits without a local base');
assert.deepEqual(R.fitRelative([NaN,30,50],[-9000,-86,100],new Uint8Array([1,0,0])),{land:[0,50],water:[-9000,-8999]},'missing base stays aligned and negative land stays land');
assert.deepEqual(R.fitRelative(remValues,remHeights,remWater,'full'),R.fitRange(remValues,'rem'),'single relative scale retains the original fit');
const remState=R.emptyState();remState.base.rem=R.defaultLayer('rem');
const remStack=R.buildStack(remState,'rem',{base:R.fitRelative(remValues,remHeights,remWater)},{remFlatBase:-5000,remLandBase:100});
assert.equal(remStack.layers[0].separateRem,true);assert.deepEqual(remStack.layers[0].water,[-5000,-4999]);
assert.equal(remStack.remFlatBase,-5000);assert.equal(remStack.remLandBase,100);
assert.equal(S.stackUniforms(remStack).c[1],3,'water ramp and land floor are independent flags');
// Changing only seabed elevations cannot alter the land floor or its colors.
const w=13,h=9,mask=Uint8Array.from({length:w*h},(_,i)=>+(i%w<6));
const makeDem=depth=>({width:w,height:h,res:100,water:mask,grid:Float32Array.from(mask,(wet,i)=>wet?depth:-86+(i%w)*3)});
const shallow=makeDem(-1000),deep=makeDem(-10000),floorA=R.relativeBase(shallow,2,true),floorB=R.relativeBase(deep,2,true);
for(let i=0;i<mask.length;i++)if(!mask[i])assert.equal(floorA[i],floorB[i],'coastal floor excludes seabed');
const pixelsA=R.renderStack(remStack,shallow),pixelsB=R.renderStack(remStack,deep);
for(let i=0;i<mask.length;i++)if(!mask[i])assert.deepEqual(pixelsA.slice(i*4,i*4+4),pixelsB.slice(i*4,i*4+4),'land colors are independent of ocean extremes');
console.log('Relative elevation: separate fits, missing bases, inland contrast and coastal-floor isolation passed');
