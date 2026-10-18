"use strict";

const assert=require("assert/strict");
const raster=require("./terrain-raster.js");
const usgs=require("./usgs.js");

function skirtedPlane(size,dzdx,dzdy,origin=100){
  const n=size+2;
  const grid=Float32Array.from({length:n*n},(_,index)=>{
    const y=Math.floor(index/n),x=index%n;
    return origin+x*dzdx+y*dzdy;
  });
  return {grid,n,size,groundRes:1};
}

function plainPlane(size,dzdx,dzdy,origin=100){
  const grid=Float32Array.from({length:size*size},(_,index)=>{
    const y=Math.floor(index/size),x=index%size;
    return origin+x*dzdx+y*dzdy;
  });
  return {grid,width:size,height:size,groundRes:1};
}

function pixel(rgba,width,x,y){
  const offset=(y*width+x)*4;
  return Array.from(rgba.slice(offset,offset+4));
}

for(const style of raster.STYLES.filter(style=>style!=="northness")){
  const surface=skirtedPlane(9,0.4,-0.25);
  assert.deepEqual(Array.from(raster.renderRgba(style,surface)),Array.from(usgs.renderRgba(style,surface)),
    `${style} browser raster must match the M2 worker palette and math`);
}

// A browser tile has no one-pixel source skirt. Clamp its edge samples for a
// continuous valid display rather than returning transparent/black borders.
const aspect=raster.renderRgba("aspect",plainPlane(8,1,0));
assert.deepEqual(pixel(aspect,8,4,4),[141,101,187,255],"east-rising terrain faces west");
assert.equal(pixel(aspect,8,0,0)[3],255,"valid edge pixels must never become an empty tile seam");
const north=raster.renderRgba("northness",plainPlane(8,0,1));
const south=raster.renderRgba("northness",plainPlane(8,0,-1));
assert(pixel(north,8,4,4)[1]>pixel(north,8,4,4)[0],"north-facing exposure must be green");
assert(pixel(south,8,4,4)[0]>pixel(south,8,4,4)[1],"south-facing exposure must be red");
assert.equal(raster.hasData(plainPlane(8,0,0)),true);
const empty={grid:new Float32Array(64).fill(NaN),width:8,height:8,groundRes:1};
assert.equal(raster.hasData(empty),false);

// Lighting is a render parameter, not part of the elevation source. Changing
// the sun direction must relight the same cached DEM without another fetch.
const litSurface=plainPlane(16,0.8,-0.3);
const eastLight=raster.renderRgba("hillshade",{
  ...litSurface,lighting:{azimuth:90,altitude:35,ambient:.08}
});
const westLight=raster.renderRgba("hillshade",{
  ...litSurface,lighting:{azimuth:270,altitude:35,ambient:.08}
});
assert.notDeepEqual(Array.from(eastLight),Array.from(westLight),
  "opposed sun azimuths must produce different hillshade pixels");
assert.notDeepEqual(
  raster.renderRgba("hsmulti",{...litSurface,lighting:{azimuth:90,altitude:35,ambient:.08}}),
  raster.renderRgba("hsmulti",{...litSurface,lighting:{azimuth:270,altitude:35,ambient:.08}}),
  "multidirectional CPU fallback must follow the same sun slider as GPU shading");
for(const azimuth of [0,90,167,270,315,359]){
  const expected=Math.round(255*require("./terrain-core.js").createMultidirectionalHillshade({
    azimuths:[azimuth-90,azimuth-45,azimuth,azimuth+45],altitude:35,ambient:.08
  })(.8,-.3));
  const actual=pixel(raster.renderRgba("hsmulti",{...litSurface,
    lighting:{azimuth,altitude:35,ambient:.08}}),16,8,8);
  assert(Math.abs(actual[0]-expected)<=1,`multi-light direction ${azimuth}: ${actual[0]} vs ${expected}`);
  assert.equal(actual[0],actual[1]);assert.equal(actual[1],actual[2]);assert.equal(actual[3],255);
}
const defaultLight=raster.renderRgba("hillshade",litSurface);
const explicitDefault=raster.renderRgba("hillshade",{
  ...litSurface,lighting:{azimuth:315,altitude:45,ambient:.12}
});
assert.deepEqual(Array.from(defaultLight),Array.from(explicitDefault),
  "omitted lighting must preserve the documented default appearance");

console.log("browser terrain raster checks passed");
