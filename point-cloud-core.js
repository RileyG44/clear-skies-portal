"use strict";

(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports) module.exports=api;
  root.CSPPointCloudCore=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const R=6378137, WORLD=2*Math.PI*R, RAD=Math.PI/180;

  /* Potree's own View allows pitch to run all the way to +PI/2, which walks the
     camera under the ground. That is not a theoretical edge: the panel opens at
     nadir, which is the minPitch floor, so the only direction a tilt gesture can
     move is toward the horizon - and nothing stops it there. One drag past the
     horizon and you are beneath the terrain looking up at the underside of it,
     which reads as a ceiling. Keep a couple of degrees of headroom instead. */
  const MIN_TILT_DEGREES=2;

  function project(lon,lat){
    const safe=Math.max(-85.05112878,Math.min(85.05112878,+lat));
    return {x:R*(+lon)*RAD,y:R*Math.log(Math.tan(Math.PI/4+safe*RAD/2))};
  }
  function unproject(x,y){ return {lon:(+x)/R/RAD,lat:(2*Math.atan(Math.exp((+y)/R))-Math.PI/2)/RAD} }
  function projectBounds(bounds){
    const sw=project(bounds.west,bounds.south),ne=project(bounds.east,bounds.north);
    return {west:sw.x,south:sw.y,east:ne.x,north:ne.y,width:Math.abs(ne.x-sw.x),height:Math.abs(ne.y-sw.y)};
  }
  /* pitch is degrees below the horizon: 90 looks straight down, which is the
     default so the panel opens as a plan view aligned with the 2D map.

     yaw and pitch come back in Potree's own convention because a nadir camera
     cannot be expressed as a position/target pair. Potree derives yaw from the
     look vector, and looking straight down the look vector is (0,0,-1) for every
     bearing - so the compass orientation is simply lost. Setting view.yaw and
     view.pitch directly is the only way to hold north up. Potree's setTopView()
     is yaw 0, pitch -PI/2, and this matches it. */
  function cameraForBounds(bounds,{bearing=0,targetZ=0,fov=60,aspect=1,pitch=90}={}){
    const b=projectBounds(bounds),target={x:(b.west+b.east)/2,y:(b.south+b.north)/2,z:+targetZ||0};
    const vfov=fov*RAD,hfov=2*Math.atan(Math.tan(vfov/2)*Math.max(.2,aspect));
    const radius=Math.max(b.width/(2*Math.tan(hfov/2)),b.height/(2*Math.tan(vfov/2)))*1.18;
    const deg=Number.isFinite(+pitch)?Math.max(MIN_TILT_DEGREES,Math.min(90,+pitch)):90;
    const yaw=(+bearing||0)*RAD,down=deg*RAD,flat=Math.cos(down);
    /* This must be Potree's own look vector, not merely a plausible one, because
       the position below is only correct if view.getPivot() lands back on the
       target. Potree builds it as Rz(yaw) * Rx(pitch) applied to (0,1,0), which
       puts a MINUS on the x term - yaw turns counter-clockwise about +Z. Getting
       that sign wrong leaves the pivot displaced sideways by 2*sin(yaw)*cos(pitch)
       *radius whenever the map is rotated and the view is tilted. */
    const direction={x:-Math.sin(yaw)*flat,y:Math.cos(yaw)*flat,z:-Math.sin(down)};
    return {target,
      position:{x:target.x-direction.x*radius,y:target.y-direction.y*radius,z:target.z-direction.z*radius},
      radius,bearing:+bearing||0,pitchDegrees:deg,
      yaw,pitch:-down};
  }

  /* Potree pitch (radians, negative looking down) -> degrees below the horizon,
     so a sync can preserve whatever tilt the user has orbited to. */
  function pitchDegreesFromView(pitchRadians){
    const value=-(+pitchRadians)*180/Math.PI;
    return Number.isFinite(value)?Math.max(MIN_TILT_DEGREES,Math.min(90,value)):90;
  }
  /* Applies the same headroom to Potree's live view, so orbiting cannot reach a
     tilt that a sync would then have to clamp away. Without this the two
     disagree: the controls happily orbit under the ground, and the next map move
     snaps the camera back to a grazing view of the horizon. */
  function limitPitch(view){
    if(!view)return view;
    view.minPitch=-Math.PI/2;
    view.maxPitch=-MIN_TILT_DEGREES*RAD;
    if(view.pitch>view.maxPitch)view.pitch=view.maxPitch;
    return view;
  }
  function mapViewForCamera(target,radius,{height=800,fov=60,bearing=0}={}){
    const ll=unproject(target.x,target.y),span=Math.max(1,2*(+radius||1)*Math.tan((+fov||60)*RAD/2));
    const zoom=Math.log2(WORLD*Math.max(1,+height||800)/(256*span));
    return {lat:ll.lat,lon:ll.lon,zoom,bearing:+bearing||0};
  }
  function projectYear(name){
    const text=String(name||""),years=(text.match(/(?:19|20)\d{2}/g)||[]).map(Number),short=text.match(/(?:^|_)[A-Z](\d{2})(?:_|$)/);
    if(short)years.push(2000+Number(short[1]));return years.length?Math.max(...years):0;
  }
  function chooseCoverage(catalog,lon,lat){
    const p=project(lon,lat);
    return (catalog||[]).filter(item=>{
      const b=item.boundsConforming||item.bounds;return b&&p.x>=b[0]&&p.x<=b[3]&&p.y>=b[1]&&p.y<=b[4];
    }).sort((a,b)=>(b.year||projectYear(b.project))-(a.year||projectYear(a.project))||(+b.points||0)-(+a.points||0))[0]||null;
  }
  function createSyncGuard(){
    let active=null;
    return {get active(){return active},run(source,fn){if(active&&active!==source)return false;const previous=active;active=source;try{fn()}finally{active=previous}return true}};
  }
  return {R,WORLD,MIN_TILT_DEGREES,project,unproject,projectBounds,cameraForBounds,pitchDegreesFromView,limitPitch,mapViewForCamera,projectYear,chooseCoverage,createSyncGuard};
});
