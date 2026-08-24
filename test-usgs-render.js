"use strict";

const assert=require("assert/strict");
const terrain=require("./terrain-core.js");
const usgs=require("./usgs.js");

function plane(size,dzdx,dzdy,origin=100){
  const n=size+2;
  const grid=Float32Array.from({length:n*n},(_,index)=>{
    const row=Math.floor(index/n),column=index%n;
    return origin+column*dzdx+row*dzdy;
  });
  return {grid,n,size,groundRes:1};
}

function center(style,surface){
  const rgba=usgs.renderRgba(style,surface);
  const x=Math.floor(surface.size/2),y=Math.floor(surface.size/2);
  return Array.from(rgba.slice((y*surface.size+x)*4,(y*surface.size+x)*4+4));
}

// Display aspect is the true downslope compass direction, and each cardinal
// direction lands on the documented cyclic palette rather than a rotated hue.
assert.deepEqual(center("aspect",plane(3,1,0)),[141,101,187,255],"rise east faces west (270 degrees)");
assert.deepEqual(center("aspect",plane(3,-1,0)),[87,167,101,255],"rise west faces east (90 degrees)");
assert.deepEqual(center("aspect",plane(3,0,1)),[77,120,200,255],"rise south faces north (0 degrees)");
assert.deepEqual(center("aspect",plane(3,0,-1)),[217,107,82,255],"rise north faces south (180 degrees)");
assert.equal(center("aspect",plane(3,0,0))[3],0,"flat terrain has undefined/transparent aspect");
assert.equal(center("aspect",plane(3,0.001,0))[3],0,"sub-half-degree noise is masked as display-flat");

// Slope colors have fixed, regression-tested breakpoints.
assert.deepEqual(center("slope",plane(3,1,0)),[213,70,80,255],"a 100 percent grade is 45 degrees");
assert.deepEqual(center("slope",plane(3,0,0)),[242,244,238,255]);

// Both lighting styles retain ambient light: a valid back-slope can be dark,
// but never becomes indistinguishable from a black/no-data tile.
const flatExpected=Math.round(terrain.createHillshade({azimuth:315,altitude:45,ambient:0.12})(0,0)*255);
assert.deepEqual(center("hs",plane(3,0,0)),[flatExpected,flatExpected,flatExpected,255]);
assert.deepEqual(center("hsmulti",plane(3,0,0)),[flatExpected,flatExpected,flatExpected,255]);
assert(center("hs",plane(3,-1,-1))[0]>=Math.round(0.12*255));

// The renderer keeps true no-data transparent.
const missing=plane(3,0,0);
missing.grid[2*missing.n+2]=Math.fround(-1e30);
assert.equal(center("hs",missing)[3],0);

console.log("USGS terrain render checks passed");
