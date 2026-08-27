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
/* Potree's orbit control, reduced to its zoom path: wheel events accumulate into
   radiusDelta, and update() drains it a frame later. Both are copied from the
   vendored potree.js rather than paraphrased - the bug lives in the interaction
   between that delay and a direct write to view.radius. */
class FakeControls{
  constructor(view){this.view=view;this.radiusDelta=0;this.yawDelta=0;this.pitchDelta=0;this.fadeFactor=20}
  scroll(delta){const resolved=this.view.radius+this.radiusDelta;this.radiusDelta+=-delta*resolved*0.1}
  update(dt){
    const progression=Math.min(1,this.fadeFactor*dt);
    const radius=this.view.radius+progression*this.radiusDelta;
    this.view.radius=radius;
    this.radiusDelta-=progression*this.radiusDelta;
    return radius;
  }
}
{
  // Scrolling alone is self-damping: resolved shrinks with each tick, so it converges toward zero without crossing it.
  const view=new FakeView();view.radius=1000;
  const controls=new FakeControls(view);
  for(let i=0;i<40;i++)controls.scroll(1);
  assert(controls.update(0.05)>0,"guard: Potree's own zoom does not go negative on its own");

  /* The real sequence: the user scrolls in the 3D panel, that drives the 2D map,
     and the map sync writes a much smaller radius back before the frame lands.
     The pending delta was sized against the OLD radius. */
  const flipped=new FakeView();flipped.radius=15000;
  const c2=new FakeControls(flipped);
  for(let i=0;i<20;i++)c2.scroll(1);
  flipped.radius=400;                      // what syncFromMap writes after the map zooms in
  const after=c2.update(0.05);
  assert(after<0,"guard: a stale delta on a freshly synced radius really does go negative");
  /* Potree builds position as pivot + direction * -radius. With the camera
     looking down, a positive radius puts it above its pivot and a negative one
     puts it below - through the ground, with the pivot now behind it, so every
     later orbit swings around a point at its back. */
  const below=(radius,pitch)=>{const dir=Math.sin(pitch);return -radius*dir};
  assert(below(400,-Math.PI/4)>0,"guard: a positive radius holds the camera above its pivot");
  assert(below(after,-Math.PI/4)<0,"the flipped radius drops the camera below its pivot");
}
{
  // The floor holds that same sequence, and reports the correction so stale input can be dropped.
  let dropped=0;
  const view=new FakeView();view.radius=15000;
  pc.installRadiusFloor(view,()=>{dropped++});
  const controls=new FakeControls(view);
  for(let i=0;i<20;i++)controls.scroll(1);
  view.radius=400;
  assert.equal(view.radius,400,"an ordinary write must pass through untouched");
  assert.equal(dropped,0,"an ordinary write must not report a correction");
  controls.update(0.05);
  assert(view.radius>=pc.MIN_RADIUS,"the floor must hold the camera on its own side of the pivot");
  assert(dropped>0,"the floor must report the correction so stale input gets dropped");
  view.radius=-1;assert.equal(view.radius,pc.MIN_RADIUS,"negative must clamp");
  view.radius=NaN;assert.equal(view.radius,pc.MIN_RADIUS,"NaN must clamp");
  view.radius=2500;assert.equal(view.radius,2500,"the floor must not stop zooming back out");
  pc.installRadiusFloor(view,()=>{dropped++});
  view.radius=800;assert.equal(view.radius,800,"installing twice must not double-wrap the accessor");
}
/* The second way underneath: aiming at the midpoint of a PROJECT-wide bounding
   box. These USGS projects run from near sea level to over 3000 m, so on high
   ground that midpoint is far below the surface. */
{
  const node=(level,x0,y0,x1,y1,zTop)=>({getLevel:()=>level,
    getBoundingBox:()=>({min:{x:x0,y:y0,z:0},max:{x:x1,y:y1,z:zTop}})});
  const nodes=[node(0,-100,-100,100,100,3253),node(3,-20,-20,20,20,2500),node(6,-5,-5,5,5,2460)];
  assert.equal(pc.groundHeightFromNodes(nodes,0,0,1654),2460,"the deepest node covering the point wins");
  assert.equal(pc.groundHeightFromNodes(nodes,50,50,1654),3253,"a coarser node still covers the wider area");
  assert.equal(pc.groundHeightFromNodes(nodes,9999,9999,1654),1654,"outside every node, fall back");
  assert.equal(pc.groundHeightFromNodes([],0,0,1654),1654,"before anything loads, fall back");
  assert.equal(pc.groundHeightFromNodes(null,0,0,1654),1654,"no nodes at all must not throw");
  // the project-wide midpoint really is underground here, which is what made this bite
  assert(1654<2460,"guard: the old fallback sits below the local surface");
  const cam=pc.cameraForBounds({west:-121.76,east:-121.755,south:46.85,north:46.854},
                               {targetZ:2460,pitch:90,aspect:1.4});
  assert(cam.position.z>2460,"the camera must sit above the local ground, not the project average");
}
console.log("point cloud core tests passed");
