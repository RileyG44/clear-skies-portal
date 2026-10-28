/* ---------------------------------------------------------------- map */
/* Let CSS own the dynamic viewport. Mobile Safari can report a visual viewport
   that excludes the bottom safe-area strip; using that number as a fixed shell
   height creates a black band below Leaflet. The map intentionally paints into
   the covered area and only controls opt into safe-area insets. */
// A fresh session opens over North America. Native process recovery calls
// restoreSession later to resume the same session's camera and layer state.
/* Providers stop publishing new pixels between roughly z8 and z20, but the
   viewer must never turn black past that point. Leaflet requests the source's
   last native tile and scales it through VIEW_MAX. It gets blurrier, never
   empty, which is the honest representation of the available resolution. */
const VIEW_MAX=28;
/* 2x and 3x screens (every iPhone): tiles are fetched at twice the pixels of
   their CSS size wherever the source has them - see sharpTiles, EXPORT_PX and
   ElevLayer. */
const HIDPI=(Number(window.devicePixelRatio)||1)>=1.5;
/* LiDAR terrain keeps drawing new tiles past the data's own zoom (z18, about
   0.4 m/pixel) up to here. Nothing more is fetched - four, sixteen, then
   sixty-four tiles share one source tile, magnified smoothly - but the shading
   and contours are computed per screen pixel, so they stay crisp instead of
   a z18 picture stretched until it goes soft. */
const TERRAIN_OVERZOOM=22;
let map3d=null,maplibreModule=null,maplibreProtocolReady=false,map3dStyleRevision=0,locationPin=null;
let gpu3d=null,gpu3dFailed=false,gpu3dBlank=null;
let map3dStylePending=null;
/* Set while 3D is wanted. Leaving 3D before the lazy import finishes used to
   leave an orphaned MapLibre instance holding WebGL and workers: exit saw
   map3d still null, returned, and the loader then created a map nothing
   pointed at. */
let map3dWanted=false,map3dLightTimer=null;
/* setMapTheme runs during load, before OVERLAYS is initialised. A `typeof`
   guard is not enough: OVERLAYS is a const, so touching it in its temporal
   dead zone throws even from typeof, which aborted the whole script. */
let ovThemedReady=false;
const map = L.map("map",{zoomControl:false,doubleClickZoom:false,maxZoom:VIEW_MAX,minZoom:0,
  /* zoomSnap:0 is what makes continuous zoom possible at all - with Leaflet's
     default of 1 every zoom lands on a whole level, which is the discrete
     stepping this replaces. scrollWheelZoom is off because Leaflet's own wheel
     handler ceils each gesture to a whole level (see the smooth wheel handler
     below); the pinch handlers further down handle Safari's gesture events. */
  zoomSnap:0,scrollWheelZoom:false,
  rotate:true,dragRotate:true,touchRotate:true,touchGestures:true,rotateControl:false,
  shiftKeyRotate:false,preventPageGestures:true}).setView([45,-100],3,{animate:false});
/* Fit the world's finite Mercator height around the viewport, including a
   rotated viewport. A portrait screen crops the world horizontally at its
   widest view instead of exposing empty polar bands. Longitude stays wrapped
   so crossing the antimeridian works normally. Two CSS pixels at each pole
   absorb Leaflet's rounded pixel origins. */
function mapFillMetrics(target,zoom=target.getZoom()){
  const size=target.getSize(),a=(target.getBearing?.()||0)*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
  return {width:size.x*c+size.y*s,height:size.y*c+size.x*s,world:target.options.crs.scale(zoom)};
}
const leafletLimitCenter=map._limitCenter;
map._limitCenter=function(center,zoom,bounds){
  center=leafletLimitCenter.call(this,L.latLng(center),zoom,bounds);
  const {height,world}=mapFillMetrics(this,zoom),half=Math.min(world/2,height/2+2),p=this.project(center,zoom);
  const y=Math.max(half,Math.min(world-half,p.y));
  return Math.abs(y-p.y)<1e-9?center:this.unproject(L.point(p.x,y),zoom);
};
/* Pinch is the primary zoom affordance on a phone. Keep the buttons for a
   desktop pointer, but do not spend mobile map space on duplicate controls. */
const leafZoomControl=L.control.zoom({position:"bottomright"});
const compactMapViewport=matchMedia("(max-width:760px)");
const syncLeafZoomControl=()=>{
  if(compactMapViewport.matches){ if(leafZoomControl._map) leafZoomControl.remove(); }
  else if(!leafZoomControl._map) leafZoomControl.addTo(map);
};
syncLeafZoomControl();
compactMapViewport.addEventListener?.("change",syncLeafZoomControl);
/* Trackpad pinch-to-zoom on macOS, which reaches us in two different shapes and
   was doing neither before: Safari fires gesture* events (nothing handled them, so
   the page zoomed and the map sat still), while Chrome and Edge deliver a wheel
   event with ctrlKey set (Leaflet zooms on it, but nothing stopped the browser
   from page-zooming the whole UI at the same time).

   preventDefault is what suppresses the browser gesture. It deliberately does NOT
   stopPropagation, so Leaflet still sees the ctrl+wheel and performs the zoom
   itself - suppressing the event outright would break wheel zoom on the map. */
{
  const pinchEl=document.getElementById("map");
  /* Continuous wheel/pinch zoom. Leaflet's ScrollWheelZoom rounds every gesture to
     a whole level - it ceils its accumulated delta - so the map stepped in
     discrete jumps even though nothing here asked it to. This applies the wheel
     delta as a fraction of a level instead, which zoomSnap:0 in the map options
     now permits, and keeps the map (not the browser) responding to trackpad
     pinch: macOS sends that as ctrl+wheel, with a finer factor because a pinch
     produces many small deltas. */
  const ZOOM_PER_PIXEL=1/420;              // pixels of scroll per zoom level
  /* Motion during a gesture is continuous; where it comes to rest is not.
     Leaflet picks the tile level as round(zoom), so resting between levels - and
     a smooth zoom rests almost anywhere - leaves tiles upscaled by up to 1.41x,
     which is visibly softer than the whole-level zooming it replaced. 160 ms
     after the last event the view settles onto the nearest whole level, which is
     the one scale where Leaflet draws the tiles natively at 1.000.

     What the gesture asked for is tracked separately, in `intent`, rather than
     being read back off the camera: a gesture that asks for less than half a level
     is undone by that settle, and reading the camera would forget it, so repeated
     small nudges could never add up to anything. `intent` accumulates them and the
     rest lands on round(intent) - two quarter-level nudges commit one level, and
     because the target is the rounded intent rather than "the nearest level plus
     one", a large gesture cannot overshoot either. */
  let settleTimer=null, intent=null, aim=null, zoomFrame=null, committed=null, visual=null, settleCommit=false, gestureStart=null;
  const viewClamp=(z)=>map3d?Math.max(map3d.getMinZoom(),Math.min(map3d.getMaxZoom(),z))
                            :Math.max(map.getMinZoom(),Math.min(map.getMaxZoom(),z));
  /* Motion, not steps - and painted, not committed.

     A wheel notch or a pinch delta arrives as a single event, so applying it in
     that event is the discrete jump this whole change set exists to remove. But
     easing it through Leaflet's setZoom is worse than it sounds: setZoom is the
     *jump* API - it fires viewprereset/viewreset, and every tile of every layer is
     thrown away and rebuilt. Measured on one 100px wheel nudge, the frame-by-frame
     easing that used to sit here rebuilt the tile set 26 times and created 576
     <img> elements. A new tile is hidden until its image has decoded, so the map
     spent most of those frames showing its own background - the black flash - and
     each rebuild is also what made a zoom read as snapshots of a picture instead
     of a picture scaling.

     So the motion scales the decoded pixels instead. Leaflet already does exactly
     that for its own animated zooms: it transforms the tile panes, whose `zoom`
     scale the imagery is drawn at, and only rebuilds tiles at the end. This does
     the same thing per frame and commits the zoom when the tile level under the
     pixels changes or when the gesture settles. That is the Photos behaviour the
     request described - the image scales under the fingers, and the detail
     sharpens once it stops.

     0.3 of the remaining distance per frame arrives in about 120ms: quick enough
     to stay attached to the fingers, slow enough to read as an animation. */
  const ZOOM_EASE=0.3;
  /* How far a gesture paints before committing on the way (see commitPassing).
     Zooming in, the level on screen still covers the view, only softer, so a
     whole level is enough; zooming out uncovers map the old level never had,
     so it commits sooner. Measured over a fast trackpad pinch: coverage
     100% in / 95% out, with fewer tile requests than per-layer updates made. */
  const PASSING_COMMIT_IN=1, PASSING_COMMIT_OUT=0.5;
  /* One transform per pane, not one per layer.

     Painting a frame used to transform every tile level of every layer on its
     own (Leaflet's zoomanim), and the base map and each label overlay were
     separate composited layers updated one by one. Nothing in the maths lets
     them disagree, but a browser is free to present them from different
     frames, and the label overlays - translucent, so each is its own opacity
     group - could be seen holding still and then snapping into place. Now the
     whole tile pane and the whole overlay pane (every raster, vector and label
     layer) are scaled as two units from the same numbers in the same write,
     which is also two style writes per frame instead of one per level.

     The transform is the one Leaflet would apply to anything laid out at the
     committed zoom z0: a layer point p lands at s*(p + origin0) - origin(z),
     with s = 2^(z - z0). Markers, popups and tooltips are not scaled and still
     follow zoomanim; the tile and vector layers inside the scaled panes skip
     it while pane painting is on (see the GridLayer/Renderer patch below). */
  const PAINT_PANES=["tilePane","overlayPane"];
  let paneZoom=null, paintCenter=null;
  const paintPanes=(center,z)=>{
    paintCenter=center;
    if(!paneZoom){ paneZoom={z0:map.getZoom(),origin:map.getPixelOrigin()}; map._cspPaneZoom=true }
    const s=map.getZoomScale(z,paneZoom.z0),next=map._getNewPixelOrigin(center,z);
    const transform=`translate3d(${paneZoom.origin.x*s-next.x}px,${paneZoom.origin.y*s-next.y}px,0) scale(${s})`;
    for(const name of PAINT_PANES){ const pane=map.getPane(name);pane.style.transformOrigin="0 0";pane.style.transform=transform }
  };
  /* Hand the painted frame back to per-layer transforms: the state the old
     path left, which a commit's tile hold and Leaflet's own zoom animations
     start from. Synchronous, so no frame ever shows the unscaled panes. */
  const endPanePaint=()=>{
    if(!paneZoom) return;
    paneZoom=null; map._cspPaneZoom=false;
    for(const name of PAINT_PANES){ const pane=map.getPane(name);pane.style.transform="";pane.style.transformOrigin="" }
    const center=paintCenter||map.getCenter(); paintCenter=null;
    if(visual===null||(Math.abs(visual-map.getZoom())<1e-6&&center.equals(map.getCenter()))) return;
    /* Transforms only. Replaying zoomanim here would also let a layer with
       updateWhenZooming open an empty new tile level - and that empty level
       is what the commit's hold would then copy, blanking the map. */
    map.eachLayer(layer=>{
      if(layer instanceof L.GridLayer){ if(layer._levels) layer._setZoomTransforms(center,visual) }
      else if(layer instanceof L.Renderer) layer._updateTransform?.(center,visual);
      else if(layer instanceof L.ImageOverlay&&layer._image) layer._animateZoom?.({center,zoom:visual});
      layer._cspTransformHold?.(center,visual);
    });
  };
  /* Anything else that zooms the map (buttons, a flyTo, a search, a pinch)
     starts from the painted frame. */
  map.on("zoomstart viewprereset",endPanePaint);
  const paintZoom=(z)=>{
    z=viewClamp(z);
    visual=z;
    /* MapLibre has no separate paint and commit: a camera update is the zoom, so
       this is also the committed value - otherwise the check in syncIfMoved would
       read our own painting as somebody else moving the view and stop the ease. */
    if(map3d){ committed=z; map3d.setZoom(z); return }
    const center=map._limitCenter(map.getCenter(),z);
    paintPanes(center,z);
    /* Markers, popups and tooltips live outside the scaled panes and follow
       Leaflet's zoomanim for the same preview frame. The noUpdate flag keeps
       this a visual transform; the controller still owns all camera state and
       tile requests. */
    map.fire("zoomanim",{center,zoom:z,noUpdate:true});
  };
  /* A passing zoom commit changes pane transforms and then the map camera in
     one painted frame. Render terrain once, after both agree. Otherwise the
     GPU shades the preview, the intermediate rebase and the committed view
     (three full-resolution passes that can differ by subpixel rounding). */
  const cameraFrame=fn=>{
    if(map3d)return fn();
    const outer=!!map._cspCameraFrame;map._cspCameraFrame=true;
    try{return fn()}finally{
      map._cspCameraFrame=outer;
      if(!outer)map.eachLayer(layer=>layer._cspFlushViewFrame?.());
    }
  };
  /* Commits that keep what is on screen. setView/setZoom are the jump API:
     viewprereset wipes every tile level, and zooming out the holds cover only
     where the old level was, so new edge tiles faded in and were wiped again
     at the next commit - squares strobing around the screen. Mid-gesture this
     uses Leaflet's own pinch step instead: the new level is added over the
     old one, which stays until the gesture ends. A plain zoom then lets each
     layer prune behind what has loaded, keeping parent/child tiles under any
     replacement still arriving. "jump" is a complete move on its own. */
  const keepView=(center,zoom,phase)=>{
    cameraFrame(()=>{
      zoom=map._limitZoom(zoom);center=map._limitCenter(center,zoom);
      endPanePaint();
      if(phase==="during"){ leafletMove.call(map,center,zoom,{pinch:true,round:false}); return }
      if(phase==="jump"){ map._stop(); map._moveStart(Math.abs(zoom-map.getZoom())>1e-9,false) }
      leafletMove.call(map,center,zoom,undefined,true);
      map.fire("zoom").fire("move");
      map._moveEnd(true);
    });
  };
  const commitZoom=(z)=>{
    z=viewClamp(z);
    committed=z; settleCommit=false;
    if(map3d){ map3d.setZoom(z); return }
    if(Math.abs(map.getZoom()-z)>1e-6) keepView(map.getCenter(),z,"jump");
    else endPanePaint();
  };
  /* Touch pinch (iOS, Android): leaflet-rotate's two-finger handler owns the
     gesture maths - zoom from the spread, rotation from the twist, the
     anchor kept under the fingers - and used to apply every frame with
     Leaflet's _move, then play a 250 ms CSS zoom animation from a stale frame
     at lift-off. Its frames now go through the same pane painter as the wheel
     and trackpad: the base map and overlays scale as one, the view commits
     (and fetches the imagery for where you are) as a pinch passes a level or
     slides far, and lift-off commits the exact frame on screen with no
     animation to replay. Rotation is still applied live by the plugin. */
  let pinchLive=false;
  /* Measured on a phone-sized view over a pinch/pan session: committing every
     half level zooming out (and after a 40%-of-screen slide) kept every layer
     at least 70% covered in every frame; a level at a time let it fall to 40%. */
  const PINCH_COMMIT_OUT=0.5, PINCH_COMMIT_SHIFT=0.4;
  const leafletMove=map._move;
  map._move=function(center,zoom,data,suppress){
    if(data&&data.pinch&&!map3d){ pinchFrame(center,zoom);return this }
    return leafletMove.call(this,center,zoom,data,suppress);
  };
  const leafletAnimateZoom=map._animateZoom;
  map._animateZoom=function(center,zoom){
    if(pinchLive){
      pinchLive=false;commitView(center,zoom,"end");
      map.eachLayer(layer=>layer._cspEndDeferral?.());
      return;
    }
    return leafletAnimateZoom.apply(this,arguments);
  };
  const commitView=(center,zoom,phase)=>{
    zoom=map._limitZoom(zoom);center=map._limitCenter(center,zoom);
    committed=zoom;visual=zoom;intent=null;aim=null;
    keepView(center,zoom,phase);
  };
  const pinchFrame=(center,zoom)=>cameraFrame(()=>{
    zoom=map._limitZoom(zoom);center=map._limitCenter(center,zoom);
    pinchLive=true;visual=zoom;
    paintPanes(center,zoom);
    map.fire("zoomanim",{center,zoom,noUpdate:true});
    /* Commit on the way, as the wheel does: past a level, or once the fingers
       have carried the view a third of the screen from where it was laid out. */
    const travelled=zoom-map.getZoom(),size=map.getSize();
    const shift=map.latLngToContainerPoint(center).distanceTo(size.divideBy(2));
    if(travelled>=PASSING_COMMIT_IN||-travelled>=PINCH_COMMIT_OUT||shift>Math.min(size.x,size.y)*PINCH_COMMIT_SHIFT){
      /* LiDAR terrain waits for the lift-off (see _cspExpensive). */
      map._cspDeferExpensive=true;
      try{ commitView(center,zoom,"during") }finally{ map._cspDeferExpensive=false }
    }
  });
  /* A long gesture commits as it passes each level, so the imagery under it is
     fetched for the level being shown (with the hold covering while it loads)
     rather than one old level stretched until the gesture ends. Unlike
     commitZoom this is not the settle, so it leaves that pending. */
  const commitPassing=(z)=>{
    if(map3d) return;
    committed=z; keepView(map.getCenter(),z,"jump");
  };
  /* Anything that commits a zoom outside this handler - the zoom buttons, a flyTo,
     a search - leaves the camera away from the last value committed here, and that
     is the signal to start again from what is on screen. While painting is in
     flight the camera is *supposed* to differ, so it is not consulted then. */
  const syncIfMoved=()=>{
    if(zoomFrame!==null) return;
    const z=viewZoom();
    if(committed===null||visual===null||Math.abs(z-committed)>0.01){ aim=null; intent=null; visual=z; committed=z }
  };
  const zoomStep=()=>{
    zoomFrame=null;
    syncIfMoved();
    if(aim===null) return;
    const step=aim-visual;
    if(Math.abs(step)>=0.002){
      cameraFrame(()=>{
        paintZoom(visual+step*ZOOM_EASE);
        const travelled=visual-(map3d?visual:map.getZoom());
        if(travelled>=PASSING_COMMIT_IN||-travelled>=PASSING_COMMIT_OUT) commitPassing(visual);
      });
      zoomFrame=requestAnimationFrame(zoomStep); return;
    }
    /* Landed. Commit when this was the settle, or when the imagery underneath is
       no longer the level being shown - one rebuild, with the hold covering the
       tiles while they load. */
    if(settleCommit||(!map3d&&Math.round(visual)!==Math.round(viewZoom()))) commitZoom(visual);
  };
  const aimAt=(target)=>{
    syncIfMoved();
    aim=viewClamp(target);
    if(zoomFrame===null) zoomFrame=requestAnimationFrame(zoomStep);
  };
  /* What the next input continues from: what is on screen, which is the painted
     zoom rather than the committed one while the accumulator is ahead of it. */
  const intentBase=()=>{
    syncIfMoved();
    if(intent===null) intent=visual===null?viewZoom():visual;
    return intent;
  };
  /* Where the gesture in progress began, so the settle can tell a small ask from
     a long scroll. Only re-read while nothing is easing: mid-gesture this is the
     same value on purpose. */
  const noteGesture=()=>{ if(gestureStart===null||zoomFrame===null) gestureStart=visual===null?viewZoom():visual };
  /* 3D terrain puts a MapLibre camera on screen and hides the Leaflet panes, so
     every path here has to move whichever camera is on screen. Two reasons.

     The gesture path had no choice: MapLibre does not handle Safari's gesture
     events at all, and with this writing to the hidden Leaflet map a pinch in 3D
     moved nothing on screen while still swallowing the browser's page zoom, i.e.
     it did nothing.

     The wheel path is here for sharpness. MapLibre's own scroll zoom eases to a
     fractional zoom and stops there, which rests the raster tiles up to 1.41x
     upscaled - the soft case the settle below exists to avoid, and the one place
     the 3D view was still softer at rest than the 2D map. MapLibre's scrollZoom is
     therefore off (see enterTerrain3d) and this handler owns the wheel in both
     views, so the two can never both answer the same event either. */
  const viewZoom=()=>map3d?map3d.getZoom():map.getZoom();
  const settleToNativeLevel=()=>{
    intent=intentBase();
    /* A small zoom should move the view the way it was asked and stay there.
       Rounding to the nearest level instead sent it back whenever the request
       landed in the lower half of a level - the bounce that read as the map
       fighting the gesture. So a gesture that stays within one level commits one,
       in the direction it was asked for; a longer one still rounds to nearest, so
       a long scroll lands where it stopped rather than a level past it. Under
       0.12 of a level is trackpad debris and is still ignored. */
    const travel=intent-(gestureStart===null?intent:gestureStart);
    const target=Math.abs(travel)>=0.12&&Math.abs(travel)<0.5
      ? Math.round(gestureStart)+Math.sign(travel)
      : Math.round(intent);
    /* The accumulator restarts from where the view is left. Keeping the fraction
       that this commit just rounded away made the *next* gesture's travel read as
       backwards - a second small zoom in committed a level out, which is the map
       "bouncing right back" this fixes. With small gestures committing on their
       own there is nothing left for a remainder to accumulate toward. */
    intent=viewClamp(target);
    /* The settle is the one time the zoom is committed even if the tile level
       happens to match: it also brings the camera itself onto the level, so
       everything that reads the map's zoom sees the resting value. */
    settleCommit=true;
    gestureStart=null;
    aimAt(target);
  };
  pinchEl.addEventListener("wheel",event=>{
    event.preventDefault();
    const unit=event.deltaMode===1?16:event.deltaMode===2?pinchEl.clientHeight:1;
    const step=-event.deltaY*unit*ZOOM_PER_PIXEL*(event.ctrlKey?0.6:1);
    if(!step) return;
    /* intentBase() first: it is what notices an outside jump - leaving 3D hands
       the view back through map.setView - and rebases `visual` on what is actually
       on screen. Reading the gesture base before that read left it stale, which
       made the gesture's travel read as more than a level and swallowed the zoom. */
    /* Clamped: scrolling on past the deepest level used to bank the excess, so
       the next zoom out had to unwind it all before the map moved at all. */
    intent=viewClamp(intentBase()+step);
    noteGesture();
    aimAt(intent);
    clearTimeout(settleTimer); settleTimer=setTimeout(settleToNativeLevel,160);
  },{passive:false});
  /* Safari's gesture events are how a *trackpad* pinch arrives on macOS, where
     there are no touch events to read - that is the whole reason this path exists.
     A touch screen fires the same events for a two-finger gesture, but there the
     touch path already does the job natively (measured with a synthetic
     two-finger touch sequence in 3D: rotate moved the bearing 0 -> -83 degrees and
     a spread took zoom 14 -> 15.05), and claiming the gesture on a touch device
     only prevents the platform default and fights it - which is what stopped
     two-finger rotate and tilt working on iOS. Trackpad only. */
  const trackpadGestures=!(("ontouchstart" in window)||navigator.maxTouchPoints>0);
  if(trackpadGestures){
    const pinch={scale:1,zoom:0};
    pinchEl.addEventListener("gesturestart",event=>{
      event.preventDefault(); intent=intentBase(); noteGesture();
      pinch.scale=event.scale||1; pinch.zoom=visual===null?viewZoom():visual;
      /* Seed the accumulator from where the gesture starts. Doing it at the end
         instead counted the gesture's own travel twice: a 1.4x pinch added its
         0.49 level to a `nearest` that already contained it, and landed a whole
         level past the amount that was actually pinched. */
    },{passive:false});
    pinchEl.addEventListener("gesturechange",event=>{
      event.preventDefault();
      const step=Math.log2((event.scale||1)/pinch.scale);
      if(step) aimAt(pinch.zoom+step);
    },{passive:false});
    pinchEl.addEventListener("gestureend",event=>{
      event.preventDefault();
      /* Same contract as the wheel path, and the socket it was missing: without
         this a trackpad pinch rested wherever it stopped - between levels, which is
         the upscaled-and-soft case the settle exists to avoid. The gesture's travel
         is added to the intent seeded at gesturestart, so small pinches accumulate
         into a committed level without a large one overshooting. */
      intent=viewClamp(intentBase()+((visual===null?pinch.zoom:visual)-pinch.zoom));
      settleToNativeLevel();
    },{passive:false});
  }
  /* Register before any map layers: drag/inertia changes the map pane directly,
     bypassing _limitCenter. Correct that translation synchronously before a
     layer sees move. Work in raw world pixels, since projecting getCenter()
     again would discard a drag's overshoot beyond Mercator's latitude limit. */
  const constrainMapPane=()=>{
    if(map3d||map._cspPaneZoom)return;
    const {height,world}=mapFillMetrics(map),half=Math.min(world/2,height/2+2);
    const center=map.containerPointToLayerPoint(map.getSize().divideBy(2)).add(map.getPixelOrigin());
    const dy=Math.max(half,Math.min(world-half,center.y))-center.y;
    if(Math.abs(dy)<1e-7)return;
    const a=(map.getBearing?.()||0)*Math.PI/180;
    map._rawPanBy(L.point(-dy*Math.sin(a),dy*Math.cos(a)));
  };
  const syncMapFill=()=>{
    if(map3d)return;
    const {width,height}=mapFillMetrics(map),floor=Math.max(0,Math.log2((Math.max(width,height)+4)/256));
    if(Math.abs(map.getMinZoom()-floor)>1e-9){map.options.minZoom=floor;map.fire("zoomlevelschange");}
    if(aim!==null)aim=viewClamp(aim);
    if(intent!==null)intent=viewClamp(intent);
    if(map.getZoom()<floor){
      aim=null;intent=null;visual=committed=floor;keepView(map.getCenter(),floor,"jump");
    }
    constrainMapPane();
  };
  map.on("move",constrainMapPane);
  map.on("resize rotate",syncMapFill);
  syncMapFill();
}
/* Right-drag is how the 3D view is orbited (two fingers pressed on a trackpad, or
   Ctrl-drag), and the browser's own menu used to open the moment that press
   landed - MapLibre only suppresses it when the map has a contextmenu listener of
   its own, and the drag handler's suppression is not attached yet at the instant
   of the press. So: never let the browser menu open over the map, and give a
   stationary right-click the app's own map menu instead, which is where Copy
   coordinates and the scene actions already live. A right-click that moves is an
   orbit and gets no menu. */
{
  const mapEl=document.getElementById("map");
  let press=null;
  /* The press itself never opens anything: a menu appearing at press time is in
     the way of the gesture, and in 3D Leaflet's own contextmenu handler fired
     from the event that MapLibre had not suppressed yet, so it asked for a
     coordinate from a map that is not on screen. Both are stopped here and the
     menu is opened on release instead, if the press did not move. */
  mapEl.addEventListener("contextmenu",event=>{ event.preventDefault(); event.stopPropagation() },{capture:true});
  mapEl.addEventListener("mousedown",event=>{ if(event.button===2) press={x:event.clientX,y:event.clientY} },{capture:true});
  mapEl.addEventListener("mouseup",event=>{
    if(event.button!==2||!press) return;
    const moved=Math.hypot(event.clientX-press.x,event.clientY-press.y); press=null;
    if(moved>6) return;                       // a right-drag is a rotate, not a click
    const rect=mapEl.getBoundingClientRect();
    const point=[event.clientX-rect.left,event.clientY-rect.top];
    const ll=map3d?map3d.unproject(point):map.containerPointToLatLng(L.point(point[0],point[1]));
    map.fire("contextmenu",{latlng:L.latLng(ll.lat,ll.lng),originalEvent:event,containerPoint:L.point(point[0],point[1])});
  },{capture:true});
}
const bearingButton=document.getElementById("bearingReset");
function activeBearing(){ return document.body.classList.contains("terrain-3d")&&map3d ? map3d.getBearing() : (map.getBearing?.()||0) }
function syncBearingButton(){
  const bearing=((activeBearing()%360)+360)%360,visible=Math.min(bearing,360-bearing)>.25||document.body.classList.contains("terrain-3d");
  bearingButton.hidden=!visible;bearingButton.classList.toggle("active",Math.min(bearing,360-bearing)>.25);
  bearingButton.querySelector("svg").style.transform=`rotate(${-bearing}deg)`;
  bearingButton.title=bearing?`Bearing ${Math.round(bearing)}° — reset north`:`North up`;
}
bearingButton.addEventListener("click",()=>{
  if(document.body.classList.contains("terrain-3d")&&map3d) map3d.easeTo({bearing:0,duration:260});
  else map.setBearing?.(0);
});
map.on("rotate",syncBearingButton);
const reflowVisualViewport=()=>{
  requestAnimationFrame(()=>map.invalidateSize({pan:false,animate:false}));
};
window.visualViewport?.addEventListener("resize",reflowVisualViewport);
window.visualViewport?.addEventListener("scroll",reflowVisualViewport);
window.addEventListener("orientationchange",()=>setTimeout(reflowVisualViewport,80));

/* Leaflet treats a failed image as final. Dynamic imagery and the WA lidar
   service occasionally return a transient 429/5xx, so one bad response used
   to leave a permanent black/empty square until the user moved the map. Keep
   the tile pending, retry with bounded exponential backoff, then fail to a
   transparent pixel so the lower-resolution layer remains visible. */
const EMPTY_TILE="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const retryUrl=(value,n)=>{
  try{ const u=new URL(value,location.href); u.searchParams.set("_csp_retry",String(n)); return u.href }
  catch(e){ return value }
};
/* Leaflet defaults updateWhenIdle to true on phones: tiles for newly exposed
   ground are not even requested until a pan stops, so every swipe showed its
   edges blank and then filled them all at once. Load while moving instead
   (Leaflet throttles it to updateInterval, 200 ms), as desktops already do. */
L.GridLayer.prototype.options.updateWhenIdle=false;
/* While the smooth-zoom controller paints whole panes (see paintPanes), the
   layers inside them must not also transform themselves for the same frame. */
{
  const paneScaled=(layer)=>layer._map&&layer._map._cspPaneZoom&&
    (layer.options.pane==="tilePane"||layer.options.pane==="overlayPane");
  const skipWhilePainted=(proto,name)=>{
    const original=proto[name];
    if(typeof original!=="function") return;
    proto[name]=function(event){ if(event&&event.noUpdate&&paneScaled(this)) return; return original.call(this,event) };
  };
  skipWhilePainted(L.GridLayer.prototype,"_animateZoom");
  skipWhilePainted(L.Renderer.prototype,"_onAnimZoom");
  skipWhilePainted(L.ImageOverlay.prototype,"_animateZoom");
}
/* Keep the outgoing tile level on screen while the incoming one loads.

   Leaflet swaps levels by creating the new level's container and pruning the old
   level's tiles. Nothing is wrong with that on a fast local cache, but measured
   against the deployed site - where imagery comes from the providers rather than
   this machine - a one-level zoom left the viewport 0% covered by loaded tiles
   for 168ms, and the fade that used to sit on top of that stretch made more than
   half the frames of a small zoom show no imagery at all. On a dark theme that is
   the whole screen going black and then snapping to the new frame.

   Retain useful outgoing pixels until the new level has actually loaded and
   faded in. Network delays and failed tiles must not erase that fallback.
   At most two levels are held, and layer removal releases them. Each hold
   stays georeferenced during subsequent pans and zooms. */
{
  const invalidateAll=L.GridLayer.prototype._invalidateAll;
  const HOLD_MAX=2;
  L.GridLayer.prototype._invalidateAll=function(){
    /* leaflet-rotate re-bases the map pane (a _resetView) at the start of every
       two-finger touch and on each rotation after a pan, and deliberately
       skips invalidation while it does. Nothing is wiped then, so nothing may
       be held either - holding there copied every tile at every pinch. */
    if(this._map&&this._map._committingRotatePan) return invalidateAll.call(this);
    /* Snapshot before the wipe: _invalidateAll drops every level container and
       every tile in one pass, so afterwards there is nothing left to copy. Only
       what has actually painted is worth holding: a level still loading would
       be an empty copy laid over the previous, complete one - which is how a
       fast zoom that commits twice in a row used to blank the map. */
    let snapshot=null,snapshotView=null,snapshotComplete=false;
    if(this._container&&this._tileZoom!==undefined){
      const level=this._levels&&this._levels[this._tileZoom];
      const loaded=level&&level.el?level.el.querySelectorAll(".leaflet-tile-loaded"):[];
      if(loaded.length){
        const current=Object.values(this._tiles||{}).filter(tile=>tile.current!==false&&tile.coords.z===this._tileZoom);
        snapshotComplete=current.length>0&&current.every(tile=>tile.loaded&&tile.el.classList.contains("leaflet-tile-loaded")&&tile.el._cspHasContent!==false);
        snapshot=level.el.cloneNode(true);
        snapshotView={origin:level.origin,zoom:level.zoom};
        /* cloneNode copies a canvas element but not its pixels. */
        const from=level.el.querySelectorAll("canvas"),to=snapshot.querySelectorAll("canvas");
        for(let i=0;i<from.length&&i<to.length;i++){
          if(!from[i].width||!from[i].height) continue;
          to[i].width=from[i].width;to[i].height=from[i].height;
          try{ to[i].getContext("2d").drawImage(from[i],0,0) }catch(error){}
        }
      }
    }
    invalidateAll.call(this);
    if(!snapshot||!this._container) return;
    const holds=this._cspHolds||(this._cspHolds=[]);
    // Repeated incomplete levels must not evict the last complete fallback.
    while(holds.length>=HOLD_MAX) (holds.find(item=>!item.complete)||holds[0]).drop();
    const hold=snapshot, container=this._container;
    hold.classList.add("csp-tile-hold");
    /* Beneath the live level and beneath any earlier hold, so the order on
       screen is newest level, then the most recent hold, then older ones. */
    container.insertBefore(hold,container.firstChild);
    const holdLevel={el:hold,origin:snapshotView.origin,zoom:snapshotView.zoom};
    let timer=null;
    const replacementReady=()=>{
      const tiles=Object.values(this._tiles||{}).filter(tile=>tile.current!==false&&tile.coords.z===this._tileZoom);
      return tiles.length>0&&tiles.every(tile=>tile.loaded&&tile.el.classList.contains("leaflet-tile-loaded")&&
        tile.el._cspHasContent!==false&&tile.el.getAttribute("src")!==EMPTY_TILE);
    };
    const check=()=>{
      clearTimeout(timer);timer=null;
      if(replacementReady())timer=setTimeout(()=>{if(replacementReady())entry.drop()},260);
    };
    const entry={
      complete:snapshotComplete,
      transform:(center,zoom)=>{ if(hold.isConnected) this._setZoomTransform(holdLevel,center,zoom) },
      drop:()=>{ clearTimeout(timer);this.off("load tileload",check);this.off("remove",entry.drop);
        hold.remove();releaseCanvasesIn(hold);const at=holds.indexOf(entry);if(at>=0) holds.splice(at,1) }
    };
    holds.push(entry);
    const transformHold=(center,zoom)=>{ for(const item of holds) item.transform(center,zoom) };
    this._cspTransformHold=transformHold;
    this._cspDropHold=()=>{ for(const item of [...holds]) item.drop() };
    if(!this._cspHoldMove){
      this._cspHoldMove=()=>{if(this._map&&!this._map._cspPaneZoom)
        this._cspTransformHold(this._map.getCenter(),this._map.getZoom())};
      this.on("add",()=>{this._cspHoldMap=this._map;this._cspHoldMap.on("move zoom rotate",this._cspHoldMove)});
      this.on("remove",()=>{this._cspHoldMap?.off("move zoom rotate",this._cspHoldMove);this._cspHoldMap=null});
      this._cspHoldMap=this._map;this._cspHoldMap?.on("move zoom rotate",this._cspHoldMove);
    }
    // `load` also follows errors. Require successful live tiles and recheck
    // after Leaflet's fade; an old load event cannot release a newer hold.
    this.on("load tileload",check);this.on("remove",entry.drop);check();
  };
}
/* A pinch commits the view on the way (see pinchFrame) so imagery loads for the
   level under the fingers. For LiDAR terrain that is the wrong trade: every
   tile is a render on the engine that takes a second or more, a pinch from z15
   to z19 passed four levels, and each one was requested and then thrown away -
   the engine then worked through that backlog before reaching the zoom you
   stopped at, and the screen sat on the blurry overview meanwhile. So layers
   marked _cspExpensive sit those commits out: their tiles on screen are only
   scaled, and they load once, for the view the fingers lift at. */
{
  const proto=L.GridLayer.prototype;
  const deferring=layer=>layer._cspExpensive&&layer._map&&layer._map._cspDeferExpensive;
  const invalidateAll=proto._invalidateAll,resetView=proto._resetView,update=proto._update;
  proto._invalidateAll=function(){
    if(deferring(this)){ this._cspDeferred=true;return }
    this._cspDeferred=false;return invalidateAll.call(this);
  };
  proto._resetView=function(event){
    if(deferring(this)){ this._cspDeferred=true;return this._setView(this._map.getCenter(),this._map.getZoom(),true,true) }
    return resetView.call(this,event);
  };
  proto._update=function(center){
    if(this._cspDeferred) return;
    return update.call(this,center);
  };
  /* After the gesture: anything still deferred (a commit that only panned
     wipes nothing) loads for the view now on screen. */
  proto._cspEndDeferral=function(){
    if(!this._cspDeferred||!this._map) return;
    this._cspDeferred=false;resetView.call(this);
  };
}
/* Photographic tiles on a 2x/3x screen: a 256 px tile drawn over 256 CSS px
   is stretched over 512-768 physical pixels, which is the soft look of
   satellite imagery on a phone. Draw each tile at 128 CSS px from the next
   zoom instead (Leaflet's detectRetina), capped one level lower so nothing is
   ever asked of the provider past its real maximum. cspNativeZoom keeps the
   provider's own maximum for the snapshot exporter. Only for pictures -
   labels and line work drawn this way would shrink to half size. */
function sharpTiles(options){
  const native=options.maxNativeZoom??19;
  if(!HIDPI) return {...options,cspNativeZoom:native};
  return {...options,tileSize:128,zoomOffset:(options.zoomOffset||0)+1,maxNativeZoom:native-1,cspNativeZoom:native,
          minNativeZoom:options.minNativeZoom!=null?Math.max(0,options.minNativeZoom-1):undefined};
}
/* The two scene tilers use different retina APIs. TiTiler 2 removed the
   @2x suffix (HTTP 422); Planetary Computer still advertises that suffix in
   its TileJSON. Keep each provider's protocol and request actual 512px tiles. */
function sharpSceneUrl(url){
  if(!HIDPI||!url) return url;
  if(/^https:\/\/titiler\.xyz\/cog\/tiles\//i.test(url)){
    url=url.replace(/\/\{y\}@[1-4]x(?=[.?]|$)/,"/{y}");
    return /[?&]tilesize=/.test(url)
      ? url.replace(/([?&]tilesize=)\d+/,(_,prefix)=>prefix+"512") : url+(url.includes("?")?"&":"?")+"tilesize=512";
  }
  if(/\{y\}@1x/.test(url)) return url.replace("{y}@1x","{y}@2x");
  if(/\/tiles\/WebMercatorQuad\/\{z\}\/\{x\}\/\{y\}(?!@)/.test(url)&&/titiler|planetarycomputer/.test(url))
    return url.replace(/\/\{y\}(\.(png|jpe?g|webp))?(?=[?#]|$)/,(m,ext)=>`/{y}@2x${ext||""}`);
  return url;
}
const ResilientTileLayer=L.TileLayer.extend({
  initialize(url,options){
    L.TileLayer.prototype.initialize.call(this,url,options);
    this.on("tileunload",e=>{
      const tile=e&&e.tile;
      if(!tile) return;
      tile._cspCancelled=true;
      if(tile._cspRetry) clearTimeout(tile._cspRetry);
      tile.onload=null; tile.onerror=null;
      tile.src=EMPTY_TILE;
    });
  },
  onAdd(map){ this._cspRemoved=false; return L.TileLayer.prototype.onAdd.call(this,map) },
  onRemove(map){
    this._cspRemoved=true;
    for(const key in this._tiles){
      const tile=this._tiles[key]&&this._tiles[key].el;
      if(!tile) continue;
      tile._cspCancelled=true;
      if(tile._cspRetry) clearTimeout(tile._cspRetry);
      tile.onload=null; tile.onerror=null;
      tile.src=EMPTY_TILE;
    }
    return L.TileLayer.prototype.onRemove.call(this,map);
  },
  createTile(coords,done){
    const tile=document.createElement("img");
    tile.alt=""; tile.setAttribute("role","presentation"); tile.decoding="async";
    if(this.options.crossOrigin||this.options.crossOrigin==="")
      tile.crossOrigin=this.options.crossOrigin===true?"":this.options.crossOrigin;
    if(this.options.referrerPolicy) tile.referrerPolicy=this.options.referrerPolicy;
    const base=this.getTileUrl(coords), retries=Math.max(0,this.options.tileRetries??2);
    const fallback=typeof this.getFallbackTileUrl==="function" ? this.getFallbackTileUrl(coords) : null;
    let source=base, attempt=0, fallbackUsed=false, finished=false;
    const finish=err=>{ if(finished||tile._cspCancelled||this._cspRemoved||!this._map) return; finished=true;
      if(tile._cspRetry) clearTimeout(tile._cspRetry); done(err,tile) };
    const load=()=>{tile._cspFallbackUsed=fallbackUsed;finish(null)};
    const fail=()=>{
      if(tile._cspCancelled) return;
      if(attempt<retries){
        attempt++;
        tile._cspRetry=setTimeout(()=>{ tile.src=retryUrl(source,attempt) },
          400*Math.pow(2,attempt-1)+Math.random()*180);
        return;
      }
      // A CORS-clean provider is normally fastest direct from the browser, but
      // a warmed local engine is the better answer when that provider is down
      // or the device has gone offline. Switch without blanking the old layer.
      if(fallback&&!fallbackUsed&&fallback!==base){
        fallbackUsed=true; source=fallback; attempt=0; tile.src=source; return;
      }
      tile.onload=null; tile.onerror=null; tile.src=EMPTY_TILE;
      finish(new Error(`tile failed after ${attempt+1} attempts`));
    };
    tile.onload=load; tile.onerror=fail; tile.src=base;
    return tile;
  }
});
const resilientLayer=(url,options)=>new ResilientTileLayer(url,options);
const trackLayerHealth=layer=>{
  const h=layer._cspHealth={started:0,loaded:0,errors:0,pending:true};
  layer.on("loading",()=>{ h.started=0; h.loaded=0; h.errors=0; h.pending=true });
  layer.on("tileloadstart",()=>{ h.started++ });
  layer.on("tileload",()=>{ h.loaded++ });
  layer.on("tileerror",()=>{ h.errors++ });
  layer.on("load",()=>{ h.pending=false });
  return layer;
};
const layerHealth=layer=>{
  const h=layer&&layer._cspHealth;
  if(!h) return null;
  const total=h.loaded+h.errors, expected=Math.max(total,h.started);
  return {loaded:h.loaded,errors:h.errors,total,expected,pending:h.pending};
};

/* NB: tile.openstreetmap.org is deliberately NOT used - the OSM Foundation tile
   usage policy prohibits third-party apps and returns HTTP 418 to them.

   CARTO's raster basemaps were the previous choice. On 2026-08-26 CARTO began
   requiring an API key and stamps unkeyed tiles with a watermark, and they are
   retiring raster basemaps altogether - so a key would only have deferred this.
   Esri's Canvas basemaps are keyless and published for exactly this use. Their
   caches hold real tiles to z16 in North America (Esri's placeholder stamp
   beyond), so they are stretched from z16 up. Note the axis order: ArcGIS serves
   /tile/{z}/{row}/{col}, i.e. y before x, and has no {s} shard or {r} retina
   variant. */
const ESRI_CANVAS="https://services.arcgisonline.com/ArcGIS/rest/services/Canvas";
const ESRI_ATTR="Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
/* Global imagery. The portal had none: the basemaps are cartographic and the
   high-resolution tier came from NAIP, which stops at the US border. Outside it
   the map fell back to grey vector tiles plus whatever single Sentinel-2 scenes
   the STAC search happened to return, which is why coverage read as sparse and
   erratic anywhere abroad. These two fill that in everywhere.

   Both are display-only under their providers' terms - no bulk caching or
   re-serving - so neither is precached by the service worker and neither is
   proxied through the engine's tile cache. They are cross-origin, and sw.js
   returns early for anything that is not same-origin, so this holds by
   construction rather than by a rule someone has to remember. */
const ESRI_IMAGERY="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_IMAGERY_ATTR="Esri, Maxar, Earthstar Geographics, and the GIS User Community";
/* EOX publishes a cloudless annual mosaic per year; the layer id carries the
   year, so moving to a newer vintage is a one-word change. */
const EOX_S2_YEAR="2024";
const EOX_S2_CLOUDLESS=`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${EOX_S2_YEAR}_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`;
const EOX_ATTR=`Sentinel-2 cloudless ${EOX_S2_YEAR} by EOX IT Services GmbH (Contains modified Copernicus Sentinel data)`;
const BASEMAPS=[
  /* The Canvas caches hold real tiles only to z16 (1:9k) in North America;
     from z17 every tile is Esri's "Map data not yet available" stamp, which
     showed through translucent terrain. Stop at 16 and stretch those tiles. */
  {url:ESRI_CANVAS+"/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", attr:ESRI_ATTR, max:16},
  {url:ESRI_CANVAS+"/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", attr:ESRI_ATTR, max:16},
  {url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg", attr:"NASA GIBS Blue Marble", max:8}
];
let baseIdx=-1, baseLayer=null, baseOK=0, baseErr=0, baseSwitchTimer=null;
const MAP_THEME_KEY="clearskies.mapTheme.v1";

function useBasemap(i){
  if(i>=BASEMAPS.length){ showBlocked(); return }
  if(baseSwitchTimer){ clearTimeout(baseSwitchTimer); baseSwitchTimer=null }
  baseIdx=i; baseErr=0; baseOK=0;
  if(baseLayer) map.removeLayer(baseLayer);
  const b=BASEMAPS[i];
  baseLayer=resilientLayer(b.url,{attribution:b.attr,maxZoom:VIEW_MAX,maxNativeZoom:b.max,tileRetries:2})
    .on("tileload",()=>{ baseOK++; hideBlocked() })
    .on("tileerror",()=>{
      baseErr++;
      /* Removing the layer synchronously inside Leaflet's tileerror dispatch
         nulls its map while _tileReady is still finishing. Defer the fallback
         one task so a blocked basemap cannot crash the renderer. */
      if(baseErr>6&&baseOK===0&&!baseSwitchTimer)
        baseSwitchTimer=setTimeout(()=>{ baseSwitchTimer=null; if(baseErr>6&&baseOK===0) useBasemap(baseIdx+1) },0);
    })
    .addTo(map);
  baseLayer.setZIndex(0);
}
function showBlocked(){
  if(document.getElementById("blk")) return;
  const d=document.createElement("div"); d.id="blk";
  d.innerHTML=NATIVE_HOST
    ? '<b>Map connection unavailable.</b><br>Reconnect to Wi-Fi or cellular data to load map tiles and terrain. Previously loaded data stays available.'
    : '<b>Map tiles are unavailable.</b><br>Check your connection and allow requests to the map provider, then retry.';
  document.getElementById("map").appendChild(d);
}
function hideBlocked(){ const d=document.getElementById("blk"); if(d) d.remove() }
function mapThemeIcon(theme){
  return theme==="dark"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>';
}
function setMapTheme(theme,persist){
  theme=theme==="dark"?"dark":"light";
  const button=document.getElementById("mapTheme"), next=theme==="dark"?"light":"dark";
  document.getElementById("map").dataset.basemapTheme=theme;
  /* One control, both surfaces. The chrome used to be styled in literals that
     no theme could reach, so this switch moved the basemap and left the panel
     bright white beside a dark map. ui-theme.css supplies the values; this is
     the only place that decides which set is live. */
  document.documentElement.dataset.uiTheme=theme;
  button.dataset.theme=theme; button.innerHTML=mapThemeIcon(theme);
  button.setAttribute("aria-pressed",String(theme==="dark"));
  button.setAttribute("aria-label",`Switch to ${next} map`); button.title=`Switch to ${next} map`;
  useBasemap(theme==="dark"?1:0);
  ovRefreshThemed();                                            // labels follow the base
  if(map3d) refresh3dStyle();
  if(persist!==false) try{ localStorage.setItem(MAP_THEME_KEY,theme) }catch(e){}
}
/* Seed from the operating system the first time only. After that the saved
   choice wins outright: the map is the subject here and people pick its theme
   deliberately, so following the OS on every launch would silently overrule
   them at sunset. */
let initialMapTheme="light";
try{
  const saved=localStorage.getItem(MAP_THEME_KEY);
  initialMapTheme = saved==="dark"||saved==="light" ? saved
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}catch(e){}
setMapTheme(initialMapTheme,false);
const mapThemeButton=document.getElementById("mapTheme");
mapThemeButton.addEventListener("click",event=>{
  L.DomEvent.stop(event);
  setMapTheme(mapThemeButton.dataset.theme==="dark"?"light":"dark",true);
});
L.DomEvent.disableClickPropagation(mapThemeButton);
L.DomEvent.disableScrollPropagation(mapThemeButton);
// if nothing at all has drawn after 12 s, say so plainly
setTimeout(()=>{ if(baseOK===0) showBlocked() }, 12000);
let marker=null, overlay=null, overlayPending=null, footprint=null, sceneToken=0, sceneAbort=null;
function stageMapLocation(e){
  if(document.body.classList.contains("dnr-selecting"))return;
  acHide(); setLoc(e.latlng.lat,e.latlng.lng);
  const status=document.getElementById("status");
  if(status){status.dataset.kind="general";status.textContent="Location selected. Double-click or double-tap the map to load imagery.";}
}
/* Leaflet's container also receives taps on the 3D canvas, but its 2D
   projection ignores pitch and terrain. Read those taps from the 3D camera. */
function mapEventLocation(e){
  if(!map3d||!document.body.classList.contains("terrain-3d")||!e.containerPoint) return e;
  const ll=map3d.unproject([e.containerPoint.x,e.containerPoint.y]);
  return ll&&Number.isFinite(ll.lat)&&Number.isFinite(ll.lng)?{latlng:L.latLng(ll.lat,ll.lng)}:null;
}
/* Touch selection owns the gesture even when WebKit omits its compatibility
   click. Suppress a delayed click briefly, without swallowing later mouse input. */
let fingerTapHandled=false,fingerTapTimer;
map.on("click",e=>{ if(fingerTapHandled)return;const at=mapEventLocation(e);if(at) stageMapLocation(at); });
map.on("dblclick",e=>{ if(document.body.classList.contains("dnr-selecting"))return;if(fingerTapHandled)return;const at=mapEventLocation(e);if(!at)return;stageMapLocation(at);run(); });
/* WebKit can omit click after a stationary first touch on the map, even
   without preventDefault. Select valid finger taps from touchend directly;
   also retain the drifting-tap behavior when the renderer claimed a move. */
{
  const FINGER_TAP=24,FINGER_TAP_MS=500;
  const mapEl=document.getElementById("map");
  let finger=null,lastFingerTap=null;
  mapEl.addEventListener("pointerdown",event=>{
    if(event.pointerType==="mouse"){fingerTapHandled=false;clearTimeout(fingerTapTimer)}
  },true);
  const ignoresTap=event=>event.target.closest("#mkCapture,#pointCloudPanel,button,a,input,textarea,select,label,.leaflet-control,#mapDock");
  locationPin=document.createElement("div");
  locationPin.id="cspLocationPin";
  locationPin.hidden=true;
  mapEl.append(locationPin);
  mapEl.addEventListener("touchstart",event=>{
    fingerTapHandled=false;clearTimeout(fingerTapTimer);
    if(event.touches.length!==1||ignoresTap(event)){finger=null;lastFingerTap=null;return}
    const t=event.touches[0],rect=mapEl.getBoundingClientRect(),x=t.clientX-rect.left,y=t.clientY-rect.top;
    const ll=map3d&&document.body.classList.contains("terrain-3d")?map3d.unproject([x,y]):map.containerPointToLatLng(L.point(x,y));
    finger={x:t.clientX,y:t.clientY,ll,at:performance.now(),moved:0};
  },true);
  mapEl.addEventListener("touchmove",event=>{
    if(!finger)return;
    if(event.touches.length!==1){finger=null;lastFingerTap=null;return}
    const t=event.touches[0];
    finger.moved=Math.max(finger.moved,Math.abs(t.clientX-finger.x)+Math.abs(t.clientY-finger.y));
  },{capture:true,passive:true});
  mapEl.addEventListener("touchend",event=>{
    const start=finger;finger=null;
    if(!start||event.touches.length||event.changedTouches.length!==1) return;
    const t=event.changedTouches[0];
    const moved=Math.max(start.moved,Math.abs(t.clientX-start.x)+Math.abs(t.clientY-start.y));
    const now=performance.now();
    if(moved>=FINGER_TAP||now-start.at>FINGER_TAP_MS){lastFingerTap=null;return}
    const second=lastFingerTap!==null&&now-lastFingerTap<320;
    lastFingerTap=now;
    if(document.body.classList.contains("dnr-selecting")||document.body.classList.contains("point-cloud-open")) return;
    const snap=document.getElementById("snapSel");
    if(snap&&!snap.hidden) return;
    const ll=start.ll;
    if(!ll||!Number.isFinite(ll.lat)||!Number.isFinite(ll.lng)) return;
    fingerTapHandled=true;
    fingerTapTimer=setTimeout(()=>{fingerTapHandled=false},700);
    stageMapLocation({latlng:L.latLng(ll.lat,ll.lng)});
    if(second) run();
  },true);
  mapEl.addEventListener("touchcancel",()=>{finger=null;lastFingerTap=null},true);
}

