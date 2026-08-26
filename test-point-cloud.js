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
console.log("point cloud core tests passed");
