"use strict";

const assert=require("assert/strict");
const terrain=require("./terrain-core.js");
const usgs=require("./usgs.js");
const cog=require("./cog.js");

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

// The interpolated Mercator -> UTM grid lands within a hundredth of a grid
// pixel of the exact projection, from continental zooms down to the finest,
// across latitudes and at a zone edge where the projection bends most.
for(const [lon,lat] of [[-122.3,47.6],[-149.9,61.2],[-80.2,25.8],[-114.01,48.7]]){
  for(const z of [6,9,12,15,18]){
    const n2=2**z, x=Math.floor((lon+180)/360*n2);
    const y=Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*n2);
    const b=cog.tileBoundsMerc(z,x,y), size=256, n=size+2, step=b.span/size;
    const mid=cog.mercToLonLat((b.minx+b.maxx)/2,(b.miny+b.maxy)/2), zone=cog.utmZone(mid.lon);
    const groundRes=step*Math.cos(mid.lat*Math.PI/180);
    const {E,N}=usgs.utmGrid(b,n,step,zone);
    let worst=0;
    for(let gy=0;gy<n;gy+=7) for(let gx=0;gx<n;gx+=5){
      const ll=cog.mercToLonLat(b.minx+(gx-0.5)*step,b.maxy-(gy-0.5)*step);
      const u=cog.lonLatToUTM(ll.lon,ll.lat,zone), k=gy*n+gx;
      worst=Math.max(worst,Math.hypot(E[k]-u.e,N[k]-u.n)/groundRes);
    }
    for(const k of [0,n-1,n*(n-1),n*n-1]) assert(Number.isFinite(E[k])&&Number.isFinite(N[k]),"lattice covers the grid corners");
    assert(worst<0.01,`z${z} at ${lon},${lat}: lattice error ${worst.toFixed(4)} px`);
  }
}

(async()=>{
  // A project crossing a UTM boundary (WA_CentralWildfire_D22 has 266 zone-10
  // and 65 zone-11 files) must keep the cells of both zones, including one
  // cell name that occurs in each. The old index kept only the last zone seen.
  const P="StagedProducts/Elevation/1m/Projects/WA_CentralWildfire_D22/TIFF/";
  const cells={},zones=new Set();
  for(const [f,size] of [["USGS_1M_10_x71y537_WA_CentralWildfire_D22.tif",10],
                         ["USGS_1M_11_x28y537_WA_CentralWildfire_D22.tif",11],
                         ["USGS_1M_11_x71y537_WA_CentralWildfire_D22.tif",12],
                         ["USGS_one_meter_x40y520_WA_Old.tif",13]])
    usgs.addTileKey(cells,zones,P+f,size);
  assert.deepEqual([...zones].sort(),[10,11]);
  const idx={projects:{WA_CentralWildfire_D22:{zone:null,cells}}};
  const twisp=await usgs.cellCandidates(idx,"x71y537",10);
  assert.equal(twisp.length,1,"Twisp's zone-10 cell is found");
  assert.equal(twisp[0].file,"USGS_1M_10_x71y537_WA_CentralWildfire_D22.tif");
  assert.equal(twisp[0].zone,10);
  const east=await usgs.cellCandidates(idx,"x71y537",11);
  assert.equal(east[0].file,"USGS_1M_11_x71y537_WA_CentralWildfire_D22.tif","same cell name, other zone");
  assert.equal((await usgs.cellCandidates(idx,"x28y537",10)).length,0,"a zoned cell never matches another zone");
  assert.equal(usgs.projectCell(idx.projects.WA_CentralWildfire_D22,"x40y520",10).zone,null,"zoneless names resolve per file");

  // The newest project is opened alone first; holes are filled from up to three.
  const calls=[],fake=results=>async(z,x,y,size,options)=>{calls.push(options.maxSources);return results[options.maxSources]??null};
  assert.equal((await usgs.sampleBest(15,1,2,256,fake({1:{coverage:1,id:"best"}}))).id,"best");
  assert.deepEqual(calls,[1],"a whole tile never opens fallback sources");
  calls.length=0;
  assert.equal((await usgs.sampleBest(15,1,2,256,fake({1:{coverage:0.57,id:"best"},3:{coverage:1,id:"filled"}}))).id,"filled",
    "a newer project's holes are filled from an older one (Wenatchee)");
  assert.deepEqual(calls,[1,3]);
  assert.equal((await usgs.sampleBest(15,1,2,256,fake({1:null,3:{coverage:0.4,id:"older"}}))).id,"older",
    "a best source with no data here still lets older projects answer");
  assert.equal((await usgs.sampleBest(15,1,2,256,fake({1:{coverage:0.5,id:"best"},3:{coverage:0.5,id:"same"}}))).id,"best");
  assert.equal(await usgs.sampleBest(15,1,2,256,fake({})),null,"no source anywhere is still no coverage");
  await assert.rejects(usgs.sampleBest(15,1,2,256,async()=>{throw Error("1 m source read failed (1)")}),/read failed/,
    "a failed read propagates instead of becoming a cached gap");
  console.log("USGS terrain render checks passed");
})().catch(error=>{console.error(error);process.exit(1)});
