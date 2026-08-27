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

  /* Potree never clamps view.radius, and its orbit control accumulates wheel
     input into radiusDelta that is only drained on the next frame. A map-driven
     sync writes view.radius directly in between, so a delta sized for the OLD
     radius lands on the NEW one - and radius + delta goes negative whenever the
     sync zoomed in. A negative radius is not a small error: position is built as
     pivot + direction * -radius, so the camera jumps to the far side of its own
     pivot, through the ground, looking back up at the underside of the terrain. */
  const MIN_RADIUS=0.5;

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
  function clampRadius(value){
    const radius=+value;
    return Number.isFinite(radius)&&radius>MIN_RADIUS?radius:MIN_RADIUS;
  }
  /* Holds the floor on Potree's live view. An accessor rather than a one-off
     clamp because the orbit control writes radius every frame from inside its
     own update loop, so there is no single call site to guard. onClamp fires
     only when a write actually had to be corrected, which is the signal that
     stale wheel input is still pending and should be dropped. */
  function installRadiusFloor(view,onClamp){
    if(!view||view.cspRadiusFloor)return view;
    let current=clampRadius(view.radius);
    Object.defineProperty(view,"radius",{configurable:true,
      get(){return current},
      set(value){
        const wanted=+value;
        current=clampRadius(wanted);
        if(!(Number.isFinite(wanted)&&wanted>=MIN_RADIUS)&&typeof onClamp==="function")onClamp();
      }});
    Object.defineProperty(view,"cspRadiusFloor",{value:true,configurable:true});
    return view;
  }
  /* The height of the ground under a point, taken from the deepest loaded octree
     node covering it. The alternative - the midpoint of the cloud's bounding box -
     is a PROJECT-wide average: these USGS projects span from near sea level to
     over 3000 m, so on high terrain that midpoint is hundreds of metres UNDER the
     surface. It goes unnoticed while zoomed out, because the camera sits a whole
     viewport-radius above it, and bites as soon as the radius shrinks. */
  function groundHeightFromNodes(nodes,x,y,fallback){
    let top=null,deepest=-1;
    for(const node of nodes||[]){
      const box=node&&node.getBoundingBox&&node.getBoundingBox();
      if(!box||!box.min||!box.max)continue;
      if(!(x>=box.min.x&&x<=box.max.x&&y>=box.min.y&&y<=box.max.y))continue;
      const level=node.getLevel?node.getLevel():0;
      if(level>deepest&&Number.isFinite(box.max.z)){deepest=level;top=box.max.z}
    }
    return top===null?fallback:top;
  }
  /* Idea 1: scale the elevation ramp to what is on screen.
     Potree seeds elevationRange from the cloud's bounding box, which is the
     whole USGS project - near sea level to over 3000 m. A single hillside then
     occupies a few percent of the ramp and renders as one flat colour, which is
     why the cloud read as a featureless blue slab. Taking the range from the
     loaded octree nodes puts the full ramp across the ground actually in view.

     MIN_RAMP_SPAN stops the opposite failure: over genuinely flat ground the
     measured span collapses toward zero and the ramp starts colouring noise. */
  const MIN_RAMP_SPAN=25;
  function elevationRangeFromNodes(nodes,fallback){
    let low=Infinity,high=-Infinity;
    for(const node of nodes||[]){
      const box=node&&node.getBoundingBox&&node.getBoundingBox();
      if(!box||!box.min||!box.max)continue;
      if(Number.isFinite(box.min.z)&&box.min.z<low)low=box.min.z;
      if(Number.isFinite(box.max.z)&&box.max.z>high)high=box.max.z;
    }
    if(!(low<high)) return Array.isArray(fallback)&&fallback.length===2?fallback.slice():null;
    if(high-low<MIN_RAMP_SPAN){
      const middle=(low+high)/2;
      low=middle-MIN_RAMP_SPAN/2;high=middle+MIN_RAMP_SPAN/2;
    }
    return [low,high];
  }

  /* Idea 2: one slider from bare earth to every return.
     Eight class checkboxes ask you to know the ASPRS numbering before you can
     see the ground. The thing people actually want is to lift the vegetation
     off the terrain, which is a single ordered gesture: ground, then each
     vegetation layer by height, then the built surface, then everything else. */
  const CANOPY_STOPS=Object.freeze([
    Object.freeze({at:0,   label:"Bare earth",        classes:Object.freeze(["2"])}),
    Object.freeze({at:25,  label:"+ low vegetation",  classes:Object.freeze(["2","3"])}),
    Object.freeze({at:50,  label:"+ medium vegetation",classes:Object.freeze(["2","3","4"])}),
    Object.freeze({at:75,  label:"+ high vegetation", classes:Object.freeze(["2","3","4","5"])}),
    Object.freeze({at:100, label:"All returns",       classes:Object.freeze(["2","3","4","5","6","7","9","other"])})
  ]);
  const CANOPY_CLASSES=Object.freeze(["2","3","4","5","6","7","9","other"]);
  function canopyStop(value){
    const level=Number.isFinite(+value)?Math.max(0,Math.min(100,+value)):100;
    let chosen=CANOPY_STOPS[0];
    for(const stop of CANOPY_STOPS) if(level>=stop.at) chosen=stop;
    return chosen;
  }
  function classesForCanopy(value){
    const stop=canopyStop(value),visible={};
    for(const code of CANOPY_CLASSES) visible[code]=stop.classes.includes(code);
    return visible;
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
  return {R,WORLD,MIN_TILT_DEGREES,MIN_RADIUS,MIN_RAMP_SPAN,CANOPY_STOPS,CANOPY_CLASSES,elevationRangeFromNodes,canopyStop,classesForCanopy,project,unproject,projectBounds,cameraForBounds,pitchDegreesFromView,limitPitch,clampRadius,installRadiusFloor,groundHeightFromNodes,mapViewForCamera,projectYear,chooseCoverage,createSyncGuard};
});
