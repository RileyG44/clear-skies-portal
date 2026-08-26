"use strict";
const assert=require("assert");
const pc=require("./point-cloud-core.js");

for(const sample of [{lon:-121.76,lat:46.85},{lon:-122.33,lat:47.61},{lon:-119.28,lat:47.13}]){
  const p=pc.project(sample.lon,sample.lat),ll=pc.unproject(p.x,p.y);
  assert(Math.abs(sample.lon-ll.lon)<1e-9);assert(Math.abs(sample.lat-ll.lat)<1e-9);
  const camera=pc.cameraForBounds({west:sample.lon-.05,east:sample.lon+.05,south:sample.lat-.03,north:sample.lat+.03},{bearing:37,targetZ:1200,aspect:1.5});
  const view=pc.mapViewForCamera(camera.target,camera.radius,{height:800,bearing:37}),expected=pc.unproject(camera.target.x,camera.target.y);
  assert(Math.abs(view.lon-expected.lon)<1e-9);assert(Math.abs(view.lat-expected.lat)<1e-9);assert(Number.isFinite(view.zoom));assert.equal(view.bearing,37);
}
const rainier=pc.project(-121.7603,46.8523);
const catalog=[{project:"old_2018",year:2018,points:9,boundsConforming:[rainier.x-1,rainier.y-1,0,rainier.x+1,rainier.y+1,1]},{project:"new_2022",year:2022,points:1,boundsConforming:[rainier.x-1,rainier.y-1,0,rainier.x+1,rainier.y+1,1]}];
assert.equal(pc.chooseCoverage(catalog,-121.7603,46.8523).project,"new_2022");assert.equal(pc.chooseCoverage(catalog,0,0),null);
const guard=pc.createSyncGuard();let nested=false;assert(guard.run("2d",()=>{nested=guard.run("3d",()=>{})}));assert.equal(nested,false);assert.equal(guard.active,null);
/* The panel must open as a plan view aligned with the 2D map: straight down,
   centred on the same ground, north where the map has north. */
{
  const b={west:-121.80,east:-121.72,south:46.82,north:46.88};
  const nadir=pc.cameraForBounds(b,{bearing:0,targetZ:1500,aspect:1.4});
  assert.equal(nadir.pitchDegrees,90,"default must be straight down");
  assert(Math.abs(nadir.pitch+Math.PI/2)<1e-12,"Potree pitch for nadir is -PI/2");
  assert.equal(nadir.yaw,0,"north-up must be yaw 0");
  // camera sits directly over the target, above it
  assert(Math.hypot(nadir.position.x-nadir.target.x,nadir.position.y-nadir.target.y)<1e-6,
         "nadir camera must be directly above its target");
  assert(nadir.position.z>nadir.target.z,"nadir camera must be above, not below");
  /* The target must be the midpoint in PROJECTED space, not the mid-latitude.
     Leaflet's getCenter() is the centre of the viewport in pixel/Mercator
     space, and Mercator y is non-linear in latitude, so the two differ - about
     1.4 m on this box, growing with latitude and with viewport height. Small,
     but it is a constant offset between the panes, which is exactly the kind of
     misalignment that is maddening to chase later. */
  const sw=pc.project(b.west,b.south),ne=pc.project(b.east,b.north);
  assert(Math.abs(nadir.target.x-(sw.x+ne.x)/2)<1e-6&&Math.abs(nadir.target.y-(sw.y+ne.y)/2)<1e-6,
         "3D target must be the projected viewport centre, matching Leaflet");
  const midLat=pc.project((b.west+b.east)/2,(b.south+b.north)/2);
  assert(Math.abs(midLat.y-nadir.target.y)>1,
         "guard: the mid-latitude really is a different point, so this test means something");
  // bearing carries into yaw, which is the only thing holding orientation at nadir
  const turned=pc.cameraForBounds(b,{bearing:90,targetZ:1500,aspect:1.4});
  assert(Math.abs(turned.yaw-Math.PI/2)<1e-12,"bearing must reach yaw");
  assert(Math.abs(turned.pitch+Math.PI/2)<1e-12,"turning must not disturb the tilt");
  // an orbited tilt round-trips, so a later sync can preserve it
  for(const deg of [15,42,90]){
    const cam=pc.cameraForBounds(b,{pitch:deg,targetZ:0,aspect:1.4});
    assert(Math.abs(pc.pitchDegreesFromView(cam.pitch)-deg)<1e-9,"pitch must round-trip through Potree units");
  }
}
console.log("point cloud core tests passed");
