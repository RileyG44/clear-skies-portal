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
/* Potree's View, reduced to the parts the camera maths has to agree with. The
   direction getter is Rz(yaw) * Rx(pitch) applied to (0,1,0), exactly as the
   vendored potree.js builds it, and the pitch setter clamps to the same
   min/max the real one does. */
class FakeView{
  constructor(){this.position={x:0,y:0,z:0};this.yaw=0;this._pitch=-Math.PI/4;this.radius=1;this.maxPitch=Math.PI/2;this.minPitch=-Math.PI/2}
  get pitch(){return this._pitch}
  set pitch(a){this._pitch=Math.max(Math.min(a,this.maxPitch),this.minPitch)}
  get direction(){const c=Math.cos(this.pitch);return {x:-Math.sin(this.yaw)*c,y:Math.cos(this.yaw)*c,z:Math.sin(this.pitch)}}
  getPivot(){const d=this.direction;return {x:this.position.x+d.x*this.radius,y:this.position.y+d.y*this.radius,z:this.position.z+d.z*this.radius}}
}
{
  const b={west:-121.80,east:-121.72,south:46.82,north:46.88};
  /* The camera is only right if Potree, using its own look vector, pivots on the
     ground we aimed at. A tilted view over a rotated map is where a sign error in
     the look vector shows up; nadir and north-up both hide it. */
  for(const bearing of [0,37,90,180,285]) for(const pitch of [8,35,62,90]){
    const cam=pc.cameraForBounds(b,{bearing,pitch,targetZ:1400,aspect:1.4});
    const view=new FakeView();
    view.position=cam.position;view.yaw=cam.yaw;view.pitch=cam.pitch;view.radius=cam.radius;
    assert(Math.abs(view.pitch-cam.pitch)<1e-12,`bearing ${bearing} pitch ${pitch}: Potree must accept the tilt unclamped`);
    const pivot=view.getPivot();
    assert(Math.hypot(pivot.x-cam.target.x,pivot.y-cam.target.y,pivot.z-cam.target.z)<1e-6,
           `bearing ${bearing} pitch ${pitch}: Potree must pivot on the target we aimed at`);
    assert(cam.position.z>cam.target.z,`bearing ${bearing} pitch ${pitch}: camera must stay above the ground`);
  }
}
/* The ceiling bug: the panel opens at nadir, which is the floor of Potree's
   pitch range, so a tilt gesture can only travel toward the horizon - and
   Potree's own maxPitch of +PI/2 lets it sail straight through into the
   underside of the terrain. limitPitch is what stops that. */
{
  const view=new FakeView();
  view.pitch=-Math.PI/2;
  view.pitch=Math.PI/2;
  assert(view.pitch>0,"guard: unclamped Potree really does orbit under the ground");
  pc.limitPitch(view);
  assert(view.pitch<0,"limitPitch must lift a view that already slipped underneath");
  view.pitch=Math.PI/2;
  assert(view.pitch<0,"a clamped view must not be able to orbit under the ground again");
  assert(Math.abs(view.pitch+pc.MIN_TILT_DEGREES*Math.PI/180)<1e-12,"the clamp must sit at the tilt floor");
  view.pitch=-Math.PI/2;
  assert(Math.abs(view.pitch+Math.PI/2)<1e-12,"nadir must stay reachable");
  assert.equal(pc.limitPitch(null),null,"limitPitch must tolerate a viewer with no scene yet");
  // whatever the controls can reach now round-trips through the sync without clamping
  for(const deg of [pc.MIN_TILT_DEGREES,30,90]){
    const cam=pc.cameraForBounds({west:-121.8,east:-121.72,south:46.82,north:46.88},{pitch:deg,aspect:1.4});
    assert(Math.abs(pc.pitchDegreesFromView(cam.pitch)-deg)<1e-9,"the tilt floor must round-trip, not clamp");
  }
}
console.log("point cloud core tests passed");
