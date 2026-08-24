"use strict";

const assert=require("assert/strict");
const fs=require("fs");
const vm=require("vm");
const T=require("./terrain-core.js");

const close=(actual,expected,tolerance=1e-10,message="")=>
  assert(Math.abs(actual-expected)<=tolerance,`${message} expected ${expected}, received ${actual}`);

function plane(width,height,dx,dy,dzdx,dzdy,origin=100){
  return Float64Array.from({length:width*height},(_,index)=>{
    const row=Math.floor(index/width), column=index%width;
    return origin+column*dx*dzdx+row*dy*dzdy;
  });
}

/* The UMD build must expose exactly the same API without Node globals. */
const browserContext={};
vm.runInNewContext(fs.readFileSync(require.resolve("./terrain-core.js"),"utf8"),browserContext);
assert.equal(typeof browserContext.CSPTerrain.hornGradient,"function");
assert.equal(typeof browserContext.CSPTerrain.multidirectionalHillshade,"function");

/* Horn gradients recover analytical derivatives on non-square pixels. */
const dx=2, dy=5, eastRise=1.75, southRise=-0.6;
const kernel=plane(3,3,dx,dy,eastRise,southRise);
let gradient=T.hornGradient3x3(kernel,dx,dy);
close(gradient.dzdx,eastRise,1e-12,"3x3 east derivative");
close(gradient.dzdy,southRise,1e-12,"3x3 south derivative");
assert.deepEqual(T.hornGradient(kernel,dx,dy),gradient,"3x3 convenience overload");

const grid=plane(7,6,dx,dy,eastRise,southRise);
gradient=T.hornGradient(grid,7,6,3,3,dx,dy);
close(gradient.dzdx,eastRise,1e-12,"grid east derivative");
close(gradient.dzdy,southRise,1e-12,"grid south derivative");
assert.equal(T.hornGradient(grid,7,6,0,0,dx,dy),null,"strict edges are undefined");
assert(T.hornGradient(grid,7,6,0,0,dx,dy,{edge:"clamp"}),"clamped edges can be requested for display tiles");
assert(T.hornGradient(grid,7,6,0,0,dx,dy,{edge:"mirror"}),"mirrored edges can be requested for analysis rasters");

const flat=new Float32Array(9).fill(42);
assert.deepEqual(T.hornGradient(flat,1,3),{dzdx:0,dzdy:0});
const missing=Float64Array.from(kernel); missing[4]=NaN;
assert.equal(T.hornGradient(missing,dx,dy),null,"NaN center sample invalidates the kernel");
const sentinel=Float64Array.from(kernel); sentinel[0]=-9999;
assert.equal(T.hornGradient(sentinel,dx,dy,{noData:-9999}),null,"configured nodata invalidates the kernel");
assert.equal(T.hornGradient(kernel,dx,dy,{validMax:100}),null,"valid range filters are honored");
assert.throws(()=>T.hornGradient(kernel,0,dy),/dx/);
assert.throws(()=>T.hornGradient([1,2],dx,dy),/nine/);
assert.throws(()=>T.hornGradient(grid,7,6,8,3,dx,dy),/inside/);

/* Slope is unit-neutral after dx/dy normalization and supports z factors. */
close(T.slopeRadians(3,4),Math.atan(5));
close(T.slopeDegrees({dzdx:3,dzdy:4}),Math.atan(5)*180/Math.PI);
close(T.slopePercent(3,4),500);
close(T.slopePercent(3,4,{zFactor:0.2}),100);
assert.deepEqual(T.slopeMetrics(0,0),{radians:0,degrees:0,percent:0,grade:0});
assert.equal(T.slopeDegrees(NaN,1),null);
assert.throws(()=>T.slopePercent(1,1,{zFactor:-1}),/zFactor/);

/* Aspect is the azimuth of downslope: N=0, E=90, S=180, W=270. */
assert.equal(T.aspectDegrees(0,1),0,"surface rising south descends north");
assert.equal(T.aspectDegrees(-1,0),90,"surface rising west descends east");
assert.equal(T.aspectDegrees(0,-1),180,"surface rising north descends south");
assert.equal(T.aspectDegrees(1,0),270,"surface rising east descends west");
assert.equal(T.aspectCardinal(0,1),"N");
assert.equal(T.aspectCardinal(-1,0),"E");
assert.equal(T.aspectCardinal(0,-1),"S");
assert.equal(T.aspectCardinal(1,0),"W");
assert.equal(T.aspectDegrees(0,-1,{rowAxis:"north"}),0,"north-positive derivative is explicit");
assert.equal(T.aspectDegrees(0,1,{rowAxis:"north"}),180);
assert.equal(T.cardinalDirection(22.4,8),"N");
assert.equal(T.cardinalDirection(22.6,8),"NE");
assert.equal(T.cardinalDirection(348.75,16),"N");

const flatAspect=T.analyzeAspect(0,0);
assert.deepEqual(flatAspect,{degrees:null,cardinal:"Flat",flat:true,noData:false});
assert.equal(T.aspectDegrees(1e-14,-1e-14),null,"numeric flats have undefined aspect");
assert.equal(T.aspectDegrees(1e-14,-1e-14,{flatThreshold:0}),225,"flat tolerance is configurable");
assert.deepEqual(T.analyzeAspect(NaN,0),{degrees:null,cardinal:null,flat:false,noData:true});
assert.deepEqual(T.analyzeAspect(0,0,{flatValue:-1,flatLabel:"Level"}),
                 {degrees:-1,cardinal:"Level",flat:true,noData:false});

/* Vector-based hillshade is exact for flats, aligned slopes, and shadows. */
close(T.hillshade(0,0,{altitude:30}),0.5,1e-12,"flat illumination");
close(T.hillshade(0,0,{altitude:30,ambient:0.2}),0.6,1e-12,"ambient light");
close(T.hillshade(Math.SQRT1_2,Math.SQRT1_2,{azimuth:315,altitude:45}),1,1e-12,
      "slope normal aligned with the light");
assert.equal(T.hillshade(-Math.SQRT1_2,-Math.SQRT1_2,{azimuth:315,altitude:45}),0,
             "back-facing terrain is shadowed");
close(T.hillshade(Math.SQRT1_2,-Math.SQRT1_2,{rowAxis:"north",azimuth:315,altitude:45}),1,1e-12);
assert.equal(T.hillshadeByte(0,0,{altitude:90}),255);
assert.equal(T.hillshade(NaN,0),null);
assert.throws(()=>T.hillshade(0,0,{altitude:91}),/altitude/);
assert.throws(()=>T.hillshade(0,0,{ambient:1.1}),/ambient/);
const compiledShade=T.createHillshade({azimuth:287,altitude:38,ambient:0.08});
assert.equal(compiledShade(NaN,0),null,"compiled shaders preserve nodata");

/* Default multidirectional lighting follows Mark/GDAL: 225,270,315,360,
   weighted by sin(aspect-azimuth)^2. The four weights sum to two. */
const testGradient={dzdx:0.8,dzdy:-0.35};
close(compiledShade(testGradient.dzdx,testGradient.dzdy),
      T.hillshade(testGradient,{azimuth:287,altitude:38,ambient:0.08}),1e-12,
      "compiled single-direction shader");
const aspect=T.aspectDegrees(testGradient);
const markAzimuths=[225,270,315,360];
const markWeights=markAzimuths.map(azimuth=>Math.sin((aspect-azimuth)*Math.PI/180)**2);
close(markWeights.reduce((sum,value)=>sum+value,0),2,1e-12,"Mark weight sum");
const markDirect=markAzimuths.reduce((sum,azimuth,index)=>
  sum+markWeights[index]*T.hillshade(testGradient,{azimuth,altitude:35}),0)/2;
const markExpected=0.12+0.88*markDirect;
close(T.multidirectionalHillshade(testGradient,{altitude:35,ambient:0.12}),markExpected,1e-12,
      "Mark/GDAL multidirectional formula");
const compiledMulti=T.createMultidirectionalHillshade({altitude:35,ambient:0.12});
close(compiledMulti(testGradient.dzdx,testGradient.dzdy),markExpected,1e-12,
      "compiled Mark/GDAL multidirectional formula");
close(T.multidirectionalHillshade(0,0,{altitude:30}),0.5,1e-12,"flat multidirectional shade");
const weightedExpected=(T.hillshade(testGradient,{azimuth:0})+3*T.hillshade(testGradient,{azimuth:180}))/4;
close(T.multidirectionalHillshade(testGradient,{azimuths:[0,180],weights:[1,3]}),weightedExpected,1e-12);
assert(T.multidirectionalHillshade(testGradient,{blend:"maximum"})>=
       T.multidirectionalHillshade(testGradient,{blend:"mean"}));
assert(T.multidirectionalHillshade(testGradient,{blend:"rms"})>=
       T.multidirectionalHillshade(testGradient,{blend:"mean"}));
assert.throws(()=>T.multidirectionalHillshade(testGradient,{weights:[0,0,0,0]}),/greater than zero/);

/* Elevation ramps interpolate deterministically, preserve alpha, and isolate
   returned colors so callers cannot mutate a compiled ramp. */
const blackWhite=[[0,"#000"],[10,"#fff"]];
assert.deepEqual(T.colorForElevation(0,blackWhite),[0,0,0,255]);
assert.deepEqual(T.colorForElevation(5,blackWhite),[128,128,128,255]);
assert.deepEqual(T.colorForElevation(10,blackWhite),[255,255,255,255]);
assert.deepEqual(T.colorForElevation(-1,blackWhite),[0,0,0,255],"ramps clamp below their domain");
assert.deepEqual(T.colorForElevation(11,blackWhite,{clamp:false}),[0,0,0,0]);
assert.deepEqual(T.colorForElevation(NaN,blackWhite,{noDataColor:"#1234"}),[17,34,51,68]);
assert.deepEqual(T.colorForElevation(5,[[0,[0,0,0,0]],[10,[100,200,50,200]]]),[50,100,25,100]);
assert.deepEqual(T.colorForElevation(5,blackWhite,{space:"linear-rgb"}),[188,188,188,255]);
const domainColorizer=T.createElevationColorizer([[0,"#000"],[1,"#fff"]],{domain:[100,200]});
assert.deepEqual(domainColorizer(150),[128,128,128,255]);
const isolated=T.createElevationColorizer([[0,"#010203"],[1,"#040506"]]);
const mutable=isolated(0); mutable[0]=255;
assert.deepEqual(isolated(0),[1,2,3,255]);
assert.deepEqual(T.colorForElevation(0,"topographic"),[181,214,229,255]);
assert.equal(Object.isFrozen(T.ELEVATION_RAMPS),true);
assert.throws(()=>T.normalizeColorRamp([]),/at least one/);
assert.throws(()=>T.colorForElevation(1,[[0,"red"]]),/color/);

/* Contour helpers choose stable 1/2/2.5/5 decades and prevent dense slopes
   from turning linework into a dark raster. */
assert.equal(T.niceContourInterval(12.3),20);
assert.equal(T.niceContourInterval(12.3,"floor"),10);
assert.equal(T.niceContourInterval(12.3,"nearest"),10);
assert.equal(T.niceContourInterval(0.21),0.25);
assert.equal(T.niceContourInterval(0),null);
assert.equal(T.adaptiveContourInterval(0,100,{targetCount:10}),10);
assert.equal(T.adaptiveContourInterval({min:0,max:20,targetCount:20,groundResolution:2,
                                        slopePercent:100,minPixelSpacing:4}),10,
             "pixel spacing can promote the contour interval");
assert.equal(T.adaptiveContourInterval({min:0,max:20,targetCount:20,groundResolution:2,
                                        slopeDegrees:45,minPixelSpacing:4}),10);
const details=T.contourIntervalDetails({min:10,max:133,targetCount:10,verticalPerPixel:5,minPixelSpacing:4});
assert.equal(details.interval,20);
assert.equal(details.range,123);
assert.equal(details.rangeDriven,12.3);
assert.equal(details.spacingDriven,20);
assert.equal(T.indexContourInterval(10),50);
assert.deepEqual(T.contourLevels(-1,1,0.25),[-1,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,1]);
assert.deepEqual(T.contourLevels(2,8,2,{base:1}),[3,5,7]);
assert.deepEqual(T.contourLevels(8,2,2),[2,4,6,8]);
assert.equal(T.adaptiveContourInterval(5,5),null);
assert.throws(()=>T.contourLevels(0,100,0.01,{maxLevels:100}),/maxLevels/);
assert.throws(()=>T.adaptiveContourInterval({min:0,max:100,groundResolution:1,slopeDegrees:90}),/less than 90/);

console.log("terrain core checks passed");
