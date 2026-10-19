"use strict";

const assert=require("assert/strict");
const T=require("./terrain-analysis-core.js");
const A=require("./research-analysis.js");

function surface(width,height,fn){
  const grid=new Float32Array(width*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) grid[y*width+x]=fn(x,y);
  return grid;
}
const at=(result,width,x,y)=>result.data[y*width+x];
const near=(actual,expected,tolerance,message)=>assert(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} vs ${expected}`);

const W=41,H=41,C=20;
const flat=surface(W,H,()=>100);
const cone=surface(W,H,(x,y)=>200-2*Math.hypot(x-C,y-C));
const bowl=surface(W,H,(x,y)=>100+2*Math.hypot(x-C,y-C));
const options={cellSize:2,radiusCells:10};

/* Sky-view factor and openness. */
near(at(T.skyViewFactor(flat,W,H,options),W,C,C),1,1e-9,"a plain sees the whole sky");
const bowlSky=at(T.skyViewFactor(bowl,W,H,options),W,C,C);
assert(bowlSky<0.6&&bowlSky>0,"a bowl floor sees less sky");
assert(at(T.skyViewFactor(cone,W,H,options),W,C,C)>0.999,"a summit sees the whole sky");
near(at(T.openness(flat,W,H,options),W,C,C),90,1e-6,"flat positive openness");
near(at(T.openness(flat,W,H,{...options,sign:"negative"}),W,C,C),90,1e-6,"flat negative openness");
assert(at(T.openness(cone,W,H,options),W,C,C)>90,"summit positive openness exceeds 90");
assert(at(T.openness(bowl,W,H,options),W,C,C)<90,"bowl positive openness is below 90");
const rrim=T.redRelief(cone,W,H,options);
assert(rrim.secondary instanceof Float32Array&&at(rrim,W,C,C)>0,"red relief: summit is convex");
near(rrim.secondary[C*W+C+5],Math.atan(1)*180/Math.PI,0.5,"red relief carries slope");

/* Geomorphons. */
const forms=T.GEOMORPHON_CLASSES;
assert.equal(forms[at(T.geomorphons(cone,W,H,options),W,C,C)],"Peak");
assert.equal(forms[at(T.geomorphons(bowl,W,H,options),W,C,C)],"Pit");
assert.equal(forms[at(T.geomorphons(flat,W,H,options),W,C,C)],"Flat");
const ridge=surface(W,H,(x)=>200-2*Math.abs(x-C)),valley=surface(W,H,(x)=>100+2*Math.abs(x-C));
assert.equal(forms[at(T.geomorphons(ridge,W,H,options),W,C,C)],"Ridge");
assert.equal(forms[at(T.geomorphons(valley,W,H,options),W,C,C)],"Valley");
const plane=surface(W,H,(x,y)=>100+y);
assert.equal(forms[at(T.geomorphons(plane,W,H,options),W,C,C)],"Slope");
for(let lower=0;lower<=8;lower++) for(let higher=0;lower+higher<=8;higher++) assert(T.geomorphonClass(lower,higher)>=1);

/* Hydrology. A closed bowl fills to its rim; a tilted V drains to one outlet. */
const sink=T.depressions(bowl,W,H,options);
near(at(sink,W,C,C),bowl[0*W+C]-100,1e-3,"bowl depth reaches its lowest rim");
assert.equal(at(T.depressions(cone,W,H,options),W,C,C),0,"a summit holds no water");
const vee=surface(W,H,(x,y)=>100+3*Math.abs(x-C)+0.5*(H-1-y));
const d8=T.drainage(vee,W,H,options);
assert(at(d8,W,C,H-3)>at(d8,W,C,5),"flow accumulates downstream");
assert(Number.isNaN(at(d8,W,0,C)),"the view edge frame is blank");
assert(at(d8,W,C,H-3)>at(d8,W,C-8,H-3)*10,"the thalweg collects the hillsides");
const twi=T.wetness(vee,W,H,options);
assert(at(twi,W,C,H-3)>at(twi,W,C-10,10),"the valley floor is wetter than the hillside");
const pond=T.drainage(bowl,W,H,options);
assert(Number.isFinite(at(pond,W,C,C)),"filled flats still route flow");

/* Avalanche slope angle. */
const thirtyEight=surface(W,H,(x,y)=>Math.tan(38*Math.PI/180)*2*y);
near(at(T.avalancheSlope(thirtyEight,W,H,options),W,C,C),38,1e-3,"slope angle in degrees");

/* Sun. */
const winter=T.sunPosition(47,355,12);
near(winter.altitude,90-47-23.44,0.3,"winter-solstice noon sun at 47°N");
near(winter.azimuth,180,0.5,"noon sun is due south");
assert(T.sunPosition(47,172,8).azimuth<180,"morning sun is in the east");
assert(T.beamIrradiance(60,172)>T.beamIrradiance(10,172),"low sun passes through more air");
const southFacing=surface(W,H,(x,y)=>-y),northFacing=surface(W,H,(x,y)=>y);
const sunOptions={cellSize:2,latitude:47,dayOfYear:355};
const south=T.solarExposure(southFacing,W,H,sunOptions),north=T.solarExposure(northFacing,W,H,sunOptions);
assert(at(south,W,C,C)>2*at(north,W,C,C),"winter sun favours south-facing slopes");
assert(south.secondary[C*W+C]>6,"an open south slope has most of the winter day");
/* A 40 m wall south of a strip of ground shades it all December day. */
const wall=surface(W,H,(x,y)=>y>=25?140:100);
const shaded=T.solarExposure(wall,W,H,sunOptions);
assert.equal(shaded.secondary[20*W+C],0,"cast shadow behind a wall");
assert(shaded.secondary[5*W+C]===0||shaded.secondary[5*W+C]>0,"hours are finite");
assert(T.solarExposure(wall,W,H,{...sunOptions,dayOfYear:172}).secondary[20*W+C]>0,"midsummer sun clears the wall");

/* Wind: a north-south ridge under a west wind loads its east (lee) side. */
const ridgeWind=T.windExposure(ridge,W,H,{cellSize:2,windAzimuth:270,searchMetres:60});
assert(at(ridgeWind,W,C+4,C)>0,"lee slope is sheltered");
assert(at(ridgeWind,W,C-4,C)<0,"windward slope is exposed");

/* Dispatcher, options and wire format. */
assert.deepEqual(A.analysisOptions({options:{dayOfYear:900,latitude:-120,windAzimuth:-90,extra:1}}),{dayOfYear:366,latitude:-85,windAzimuth:270});
assert.deepEqual(A.analysisOptions({}),{});
for(const product of A.TERRAIN_PRODUCTS){
  const result=A.run({product,scale:"fine",grid:cone,width:W,height:H,resolution:2,options:{latitude:47,dayOfYear:80,windAzimuth:225}});
  assert.equal(result.data.length,W*H,product);
  assert(result.label.length>0&&result.metadata.kind,product);
  const wire=A.decodeResult(A.encodeResult(result));
  assert.equal(wire.label,result.label);
  assert.equal(!!wire.secondary,!!result.secondary,product);
  assert.deepEqual(Array.from(wire.data),Array.from(result.data),product);
}
assert.equal(A.run({product:"solar",scale:"balanced",grid:cone,width:W,height:H,resolution:2,options:{dayOfYear:172}}).metadata.dayOfYear,172);
assert.equal(A.run({product:"wind",scale:"broad",grid:cone,width:W,height:H,resolution:2,options:{windAzimuth:45}}).metadata.windFrom,45);

/* Large viewport budget: every product stays well inside the worker timeout. */
const big=surface(512,512,(x,y)=>500+80*Math.sin(x/37)*Math.cos(y/53)+30*Math.sin((x+y)/11));
for(const product of A.TERRAIN_PRODUCTS){
  const started=Date.now();
  A.run({product,scale:"broad",grid:big,width:512,height:512,resolution:2,options:{latitude:47,dayOfYear:355}});
  assert(Date.now()-started<12000,`${product} is too slow for the viewport worker`);
}

console.log("terrain analysis: ok");
