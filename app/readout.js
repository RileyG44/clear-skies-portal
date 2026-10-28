async function createSnapshotReadout(spec){
  /* Chosen once: a camera move while this awaits the elevation or the keys
     drops snapshotCursorLocation, and reading it again for the label then
     called the cursor's coordinates the selection centre. */
  const cursor=snapshotCursorLocation;
  const ll=cursor||(()=>{
    const p=[spec.sel.x+spec.sel.w/2,spec.sel.y+spec.sel.h/2];
    return map3d?map3d.unproject(p):map.containerPointToLatLng(L.point(p));
  })();
  const location={lat:ll.lat,lng:((ll.lng+180)%360+360)%360-180};
  let sample=cursorLoadedElevation(location);
  if(!sample){
    const {coords,key}=cursorTileAddress(location),cached=cursorTiles.get(key),value=cursorTileSample(cached?.tile,location);
    if(value!==null)sample={value,source:cached.source};
    else{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
      try{
        const tile=PROXY?await elevationRequests.request(api(`/api/elev/${coords.z}/${coords.x}/${coords.y}.png?${RAW_COVERAGE_QUERY}`),s=>fetchElevation(api(`/api/elev/${coords.z}/${coords.x}/${coords.y}.png?${RAW_COVERAGE_QUERY}`),s),{signal:controller.signal,priority:1,group:"cursor"}):await publicElevationWithFallback(coords,controller.signal);
        const value=cursorTileSample(tile?{coords,elev:tile.grid,width:tile.width,height:tile.height}:null,location);
        if(value!==null)sample={value};
      }catch(error){}finally{clearTimeout(timer)}
    }
  }
  await loadSnowColourKeys();
  return {coordinates:cursorCoordinates(location),elevation:sample?`Elevation ≈ ${Math.round(sample.value/.3048).toLocaleString()} ft`:"Elevation unavailable",
    note:cursor?"Cursor location":"Selection center",keys:readoutColourKeys()};
}
function drawSnapshotReadout(ctx,spec,blockX=0,blockY=0){
  const info=spec.readout;if(!info)return;
  const keyHeight=key=>key.swatches?18+Math.ceil(key.swatches.length/3)*14:36;
  const height=46+info.keys.reduce((sum,key)=>sum+keyHeight(key),0),width=260,pad=12;
  const k=Math.min(spec.scale,(spec.width-8)/(width+2*pad),(spec.height-8)/(height+2*pad));
  if(k<=0)return;
  ctx.save();ctx.setTransform(k,0,0,k,pad*k-blockX,spec.height-(height+pad)*k-blockY);
  ctx.globalAlpha=1;ctx.filter="none";ctx.fillStyle="#000";ctx.textAlign="left";ctx.textBaseline="top";
  const text=(value,x,y,size=11,bold=false,max=width)=>{ctx.font=`${bold?600:400} ${size}px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;ctx.fillStyle="#000";ctx.fillText(String(value),x,y,max)};
  text(info.note,0,0,9);text(info.coordinates,0,12);text(info.elevation,0,26);
  let y=46;
  for(const key of info.keys){
    text(key.name,0,y,10,true);y+=14;
    if(key.swatches){
      key.swatches.forEach((s,i)=>{const x=(i%3)*width/3,Y=y+Math.floor(i/3)*14;ctx.drawImage(s.img,x,Y,12,9);text(s.label,x+15,Y,9,false,width/3-18)});
      y+=Math.ceil(key.swatches.length/3)*14+4;continue;
    }
    const matches=[...key.bar.matchAll(/(#[\da-f]{3,8}|rgba?\([^)]*\))\s*(\d*\.?\d+%)?/gi)];
    const gradient=ctx.createLinearGradient(0,0,width,0);
    matches.forEach((m,i)=>gradient.addColorStop(m[2]?parseFloat(m[2])/100:i/Math.max(1,matches.length-1),m[1]));
    ctx.fillStyle=gradient;ctx.fillRect(0,y,width,6);y+=9;
    key.labels.forEach((label,i)=>{ctx.textAlign=i===0?"left":i===key.labels.length-1?"right":"center";text(label,i*width/Math.max(1,key.labels.length-1),y,9,false,width/Math.max(1,key.labels.length))});
    ctx.textAlign="left";y+=13;
  }
  ctx.restore();
}
function setSnapshotReadoutEnabled(enabled,persist=false){
  $("#snapshotReadout").checked=enabled;
  if(persist)try{localStorage.setItem("clearskies.snapshot.readout.v1",String(enabled))}catch(error){}
}
try{setSnapshotReadoutEnabled(localStorage.getItem("clearskies.snapshot.readout.v1")==="true")}catch(error){}
$("#snapshotReadout").addEventListener("change",event=>setSnapshotReadoutEnabled(event.target.checked,true));
function cursorTileSample(tile,ll){
  if(!tile?.elev||!tile.coords)return null;
  const {z,x,y}=tile.coords,p=map.project(ll,z),world=256*2**z;
  const dx=((p.x-x*256)%world+world)%world,dy=p.y-y*256;
  if(dx>=256||dy<0||dy>=256)return null;
  const width=tile.cv?.width||tile.width||256,height=tile.cv?.height||tile.height||256;
  const value=tile.elev[Math.floor(dy*height/256)*width+Math.floor(dx*width/256)];
  return ElevationTileCore.isElevation(value)?value:null;
}
function cursorLoadedElevation(ll){
  if(gpuTerrainEnabled){const sample=gpuTerrainLayer.sampleAt(ll);return sample?{...sample,source:sample.label}:null;}
  let best=null;
  for(const layer of [elevLayer,terLayer,terBase])for(const tile of layer?._store?.values()||[]){
    const value=cursorTileSample(tile,ll);
    if(value!==null&&(!best||tile.coords.z>best.z))best={value,z:tile.coords.z,source:tile.cv?.dataset.cspElevationSource||"Loaded terrain"};
  }
  return best;
}
const readoutRoot=document.createElement("aside");readoutRoot.id="mapReadout";
readoutRoot.setAttribute("aria-label","Map info");
readoutRoot.innerHTML='<button type="button" class="map-info-toggle" aria-label="Show map info" aria-expanded="false" aria-controls="mapInfoContent"><svg class="map-info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7v1"></path></svg><span class="map-info-title">Map info</span><svg class="map-info-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button><div id="mapInfoContent" hidden><div class="cursor-location"><div id="cursorBasis">Cursor location</div><div id="cursorCoordinates">Move the cursor over the map</div><div id="cursorElevation">Elevation —</div><div id="cursorSource"></div><div id="cursorAnalysis" hidden></div></div><div class="map-info-terrain" role="status"><div class="key-name">Terrain</div><div id="mapInfoTerrain"></div></div><div class="map-colour-keys"></div></div>';
$("#app").append(readoutRoot);
let mapInfoAnimation=null,mapInfoFade=null;
function setMapInfoExpanded(expanded){
  const before=readoutRoot.getBoundingClientRect(),content=$("#mapInfoContent");
  mapInfoAnimation?.cancel();mapInfoFade?.cancel();mapInfoAnimation=null;
  readoutRoot.classList.toggle("expanded",expanded);
  $(".map-info-toggle",readoutRoot).setAttribute("aria-expanded",String(expanded));
  $(".map-info-toggle",readoutRoot).setAttribute("aria-label",expanded?"Hide map info":"Show map info");
  content.hidden=!expanded;content.inert=!expanded;
  content.setAttribute("aria-hidden",String(!expanded));
  const after=readoutRoot.getBoundingClientRect();
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches||document.documentElement.classList.contains("csp-reduce-motion");
  if(!reduced&&readoutRoot.animate&&before.width&&after.width){
    // Keep outgoing content painted as the glass contracts. Inert and
    // aria-hidden remove it from interaction immediately on collapse.
    if(!expanded)content.hidden=false;
    const animation=readoutRoot.animate([
      {width:before.width+"px",height:before.height+"px",borderRadius:expanded?"22px":"18px"},
      {width:after.width+"px",height:after.height+"px",borderRadius:expanded?"18px":"22px"}
    ],{duration:260,easing:"cubic-bezier(.16,1,.3,1)",fill:"both"});
    mapInfoAnimation=animation;
    animation.onfinish=()=>{
      if(mapInfoAnimation!==animation)return;
      content.hidden=!expanded;mapInfoAnimation=null;animation.cancel();
    };
    mapInfoFade=content.animate([{opacity:expanded?0:1},{opacity:expanded?1:0}],{duration:expanded?200:120,easing:"ease",fill:"forwards"});
  }
  if(expanded)scheduleMapReadout();
}
$(".map-info-toggle",readoutRoot).addEventListener("click",()=>setMapInfoExpanded(!readoutRoot.classList.contains("expanded")));
readoutRoot.addEventListener("keydown",event=>{if(event.key==="Escape"){setMapInfoExpanded(false);$(".map-info-toggle",readoutRoot).focus();event.stopPropagation()}});
for(const type of ["pointerdown","dblclick","wheel"])readoutRoot.addEventListener(type,event=>event.stopPropagation());
let cursorLocation=null,cursorElevation=null,cursorPointer=null,cursorFrame=0,cursorTimer=null,cursorRequest=null,snapshotCursorLocation=null;
const cursorTiles=new Map(),snowColourKeys=new Map();
let snowKeysLoading=null;
const snowKeysRetryAt=new Map();
function cursorCoordinates(ll){
  return `${Math.abs(ll.lat).toFixed(5)}° ${ll.lat<0?"S":"N"} · ${Math.abs(ll.lng).toFixed(5)}° ${ll.lng<0?"W":"E"}`;
}
function paintCursorElevation(sample){
  cursorElevation=sample;
  $("#cursorElevation").textContent=sample?`Elevation ≈ ${Math.round(sample.value/.3048).toLocaleString()} ft`:"Elevation unavailable";
  $("#cursorElevation").title=sample?.source||"No elevation sample is available at this location";
  $("#cursorSource").textContent=sample?.source||"";
}
function cursorTileAddress(ll){
  const z=Math.max(0,Math.min(15,Math.floor(map3d?map3d.getZoom()+1:map.getZoom()))),p=map.project(ll,z),n=2**z;
  const coords={z,x:((Math.floor(p.x/256)%n)+n)%n,y:Math.floor(p.y/256)};
  return {coords,key:`${PROXY?API:"public"}/${$("#terSrc").value}/${z}/${coords.x}/${coords.y}`};
}
function refreshCursorElevation(){
  if(!cursorLocation||document.hidden)return;
  const loaded=cursorLoadedElevation(cursorLocation);if(loaded){paintCursorElevation(loaded);return}
  const {coords,key}=cursorTileAddress(cursorLocation),cached=cursorTiles.get(key);
  if(cached&&Date.now()-cached.at<60000){
    const value=cursorTileSample(cached.tile,cursorLocation);paintCursorElevation(value===null?null:{value,source:cached.source});return;
  }
  $("#cursorElevation").textContent="Elevation …";$("#cursorSource").textContent="";cursorElevation=null;
  if(cursorRequest?.key===key)return;
  clearTimeout(cursorTimer);
  cursorTimer=setTimeout(async()=>{
    cursorRequest?.controller.abort();
    const controller=new AbortController(),request={key,controller};cursorRequest=request;
    const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const tile=PROXY?await elevationRequests.request(api(`/api/elev/${coords.z}/${coords.x}/${coords.y}.png?${RAW_COVERAGE_QUERY}`),s=>fetchElevation(api(`/api/elev/${coords.z}/${coords.x}/${coords.y}.png?${RAW_COVERAGE_QUERY}`),s),{signal:controller.signal,priority:1,group:"cursor"}):await publicElevationWithFallback(coords,controller.signal);
      cursorTiles.set(key,{at:Date.now(),tile:tile?{coords,elev:tile.grid,width:tile.width||256,height:tile.height||256}:null,source:PROXY?"USGS elevation":tile?.rank===1?"Global overview elevation":"USGS 3DEP elevation"});
    }catch(error){if(!controller.signal.aborted)cursorTiles.set(key,{at:Date.now(),tile:null,source:""});}
    finally{
      clearTimeout(timeout);if(cursorRequest===request)cursorRequest=null;
      while(cursorTiles.size>8)cursorTiles.delete(cursorTiles.keys().next().value);
      if(cursorLocation&&cursorTileAddress(cursorLocation).key===key){
        const loaded=cursorLoadedElevation(cursorLocation),cached=cursorTiles.get(key),value=cursorTileSample(cached?.tile,cursorLocation);
        paintCursorElevation(loaded||(value===null?null:{value,source:cached.source}));
      }
    }
  },220);
}
/* The 3D readout is resolved at rest, not per frame of motion. With terrain
   on, MapLibre 6.6's unproject ray-marches the DEM on the CPU - up to 512
   steps plus a 40-step bisection, against a coverage index every rendered
   frame throws away and the next call rebuilds from all renderable tiles -
   and the project() that tells ground from sky walks the frustum's covering
   tiles again. (It does not read pixels back: the only readPixels in the
   bundle is depthAtPoint, which only maplibregl.Marker uses, and this app
   has none.) Measured in headless Chrome on an Apple-silicon Mac, the pair
   costs 0.3 ms median and up to 1.6 ms after a rendered frame. Orbiting and
   mouse panning are mouse moves, so that work ran inside every frame
   MapLibre was trying to draw, and the wheel zoom's per-frame setZoom fires
   a moveend each frame and ran it again from there. Now any camera motion
   only dims the readout and drops the location, so nothing - the elevation
   poll, a PNG export - can use a coordinate that is no longer under the
   cursor, and 120 ms after the last move the same unproject + project as
   before runs once for the pixel under the pointer. Hovering a still camera
   is unchanged: one resolve per frame in which the pointer moved, for that
   exact pixel. */
const CURSOR_SETTLE_MS=120;
let cursorMapBox=null,cursorSettleTimer=null,cursorStale=false;
const cursorLocationEl=readoutRoot.querySelector(".cursor-location");
/* #map fills the fixed #app, so its box only changes when the window does. */
addEventListener("resize",()=>{cursorMapBox=null});
if(window.ResizeObserver)new ResizeObserver(()=>{cursorMapBox=null}).observe($("#map"));
function setCursorStale(stale){
  if(stale===cursorStale)return;
  cursorStale=stale;cursorLocationEl.classList.toggle("pending",stale);
  if(stale){cursorLocation=null;cursorElevation=null}
}
/* A camera move during a snapshot selection also drops the point captured
   when the selection opened: it is no longer under the cursor, and the
   export would still have labelled it "Cursor location". Without it the
   export reads the selection centre, as it does when no cursor was over the
   map. */
function cursorCameraMoved(){
  if(cursorPointer)setCursorStale(true);
  if(!snapSel.hidden)snapshotCursorLocation=null;
  clearTimeout(cursorSettleTimer);cursorSettleTimer=setTimeout(cursorCameraSettled,CURSOR_SETTLE_MS);
}
/* Every pending mark has this timer behind it, so this is also the cleanup:
   after leaving 3D (or a failed start) it resolves the readout on the 2D map
   rather than leaving it dimmed. A reading deferred by an open snapshot
   selection is resolved when the selection closes. */
function cursorCameraSettled(){
  cursorSettleTimer=null;
  if(!map3d){if(cursorStale&&cursorPointer)updateCursorLocation();return}
  /* A drag held still between moves, or a camera ease between frames. */
  if(map3d.isMoving()){cursorSettleTimer=setTimeout(cursorCameraSettled,CURSOR_SETTLE_MS);return}
  if(cursorPointer)updateCursorLocation();
}
/* The terrain under a still pointer keeps refining after the camera stops:
   the finer DEM tiles for the new view arrive later, and a reading taken at
   the settle (or, before, at moveend) was left on the coarser surface -
   2-9 m off the final reading in a test at 85 degrees of pitch. Idle is
   the frame that has them, so the reading is retaken there - on every idle,
   deliberately: idle follows any finished repaint, and repaints at rest
   include later DEM tiles and terrain exaggeration changes. Each costs one
   unproject + project with the map otherwise quiet. */
function cursorSelectionClosed(){
  if(cursorStale&&cursorPointer&&!cursorSettleTimer)updateCursorLocation();
}
function cursorCameraIdle(){
  if(cursorPointer&&!cursorSettleTimer&&map3d&&!map3d.isMoving())updateCursorLocation();
}
function updateCursorLocation(){
  cursorFrame=0;
  if(!cursorPointer||innerWidth<=760||document.body.classList.contains("point-cloud-open")||!snapSel.hidden)return;
  const box=cursorMapBox||(cursorMapBox=$("#map").getBoundingClientRect()),p=L.point(cursorPointer.x-box.left,cursorPointer.y-box.top);
  if(p.x<0||p.y<0||p.x>box.width||p.y>box.height)return;
  let ll;
  if(map3d){
    /* The settle resolves it; a pointer move must not push that back, or
       a mouse that keeps moving after the camera stops would never see one. */
    if(cursorSettleTimer)return;
    if(map3d.isMoving()){cursorCameraMoved();return}
    ll=map3d.unproject([p.x,p.y]);const q=map3d.project(ll);
    if(!Number.isFinite(ll.lat)||Math.abs(ll.lat)>85.05113||Math.hypot(q.x-p.x,q.y-p.y)>4){
      setCursorStale(false);cursorLocation=null;cursorElevation=null;$("#cursorCoordinates").textContent="Cursor over sky";$("#cursorElevation").textContent="Elevation —";return;
    }
  }else ll=map.containerPointToLatLng(p);
  setCursorStale(false);cursorLocation={lat:ll.lat,lng:((ll.lng+180)%360+360)%360-180};
  $("#cursorCoordinates").textContent=cursorCoordinates(cursorLocation);refreshCursorElevation();paintCursorAnalysis();
}
document.addEventListener("pointermove",event=>{
  if(event.pointerType&&event.pointerType!=="mouse")return;
  if(!event.target.closest("#map")||event.target.closest("button,input,select,a,.leaflet-control,.tool-popover,#ctl"))return;
  cursorPointer={x:event.clientX,y:event.clientY};if(!cursorFrame)cursorFrame=requestAnimationFrame(updateCursorLocation);
},{passive:true});
map.on("moveend",()=>{if(cursorPointer)updateCursorLocation()});
/* The 2D view moving under an open snapshot selection drops the captured
   cursor point too (see cursorCameraMoved): a wheel zoom paints through
   zoomanim before it commits, and a twist only fires rotate. */
map.on("zoomanim move rotate",()=>{if(!snapSel.hidden)snapshotCursorLocation=null});
setInterval(()=>{if(cursorLocation&&!document.hidden)refreshCursorElevation()},1000);
function readoutColourKeys(){
  const keys=[],is3d=!!map3d,style=$("#terStyle").value;
  if(style!=="off"&&terrainOpacity()>0){
    const legend=$("#terLegend"),bar=legend?.querySelector(".bar")?.style.backgroundImage;
    if(bar)keys.push({name:$("#terStyle").selectedOptions[0].textContent,bar,labels:[...legend.querySelectorAll(".ticks span")].map(el=>el.textContent)});
  }
  if(is3d&&map3d.getLayer("terrain-relief")){
    const ramp=hypsometricRamp().slice(3),top=ramp[ramp.length-2];
    const stops=[];for(let i=0;i<ramp.length;i+=2)stops.push(`${ramp[i+1]} ${ramp[i]/top*100}%`);
    keys.push({name:"3D relief elevation tint",bar:`linear-gradient(90deg,${stops.join(",")})`,labels:[0,top/2,top].map(v=>`${Math.round(v/.3048).toLocaleString()} ft`)});
  }
  if($("#elevSh").checked&&elevAlpha()>0){
    const level=elevMetres(),span=elevSpanMetres();
    const stops=Array.from({length:17},(_,i)=>`rgb(${elevRampRgb(level-span+i*span/8,level,span,spectrumHexColors().map(hex=>ElevationBands.parseColor(hex).slice(0,3))).join(",")}) ${i/16*100}%`);
    keys.push({name:"Elevation spectrum",bar:`linear-gradient(90deg,${stops.join(",")})`,labels:[level-span,level,level+span].map(v=>`${Math.round(v/.3048).toLocaleString()} ft`)});
  }
  if(elevationActive()&&+$("#elevBandAlpha").value>0){
    for(const side of ["Below","Above"])if($("#elev"+side+"On").checked){
      keys.push({name:`${side} ${(+$("#elev"+side+"Val").value||0).toLocaleString()} ft`,bar:`linear-gradient(90deg,${$("#elev"+side+"Color").value},${$("#elev"+side+"Color").value})`,labels:[]});
    }
  }
  if(!is3d)for(const entry of researchStack.slice().reverse())if(entry.overlay&&entry.legend&&entry.style.visible&&entry.style.opacity>0)keys.push(entry.legend);
  for(const id of ["snowdepth","swe","snowcover"])if(!is3d&&ovOn[id]&&ovLayers[id]&&overlayOpacityPercent(OVERLAYS.find(o=>o.id===id))>0){
    const key=snowColourKeys.get(id);if(key)keys.push(key);
  }
  return keys;
}
function loadSnowColourKeys(){
  if(snowKeysLoading)return snowKeysLoading;
  if(!["snowdepth","swe","snowcover"].some(id=>ovOn[id]&&!snowColourKeys.has(id)&&Date.now()>=(snowKeysRetryAt.get(id)||0)))return Promise.resolve();
  snowKeysLoading=fetchSnowColourKeys().finally(()=>{snowKeysLoading=null});return snowKeysLoading;
}
async function fetchSnowColourKeys(){
  await Promise.allSettled([fetchNoaaSnowKeys(),fetchNDSISnowKey()]);paintMapReadoutKeys();
}
async function fetchNDSISnowKey(){
  if(!ovOn.snowcover||snowColourKeys.has("snowcover")||Date.now()<(snowKeysRetryAt.get("snowcover")||0))return;
  snowKeysRetryAt.set("snowcover",Date.now()+60000);
  const response=await fetch("https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDSI_Snow_Cover.xml",{signal:AbortSignal.timeout(10000)});
  if(!response.ok)return;
  const xml=new DOMParser().parseFromString(await response.text(),"application/xml");
  const entries=[...xml.querySelectorAll('ColorMap[title="Normalized Difference Snow Index"] ColorMapEntry')].filter(e=>e.getAttribute("transparent")==="false"&&/^\[\d+\]$/.test(e.getAttribute("value")||""));
  if(!entries.length)return;
  const stops=entries.flatMap((e,i)=>{const c=`rgb(${e.getAttribute("rgb")})`;return [`${c} ${i/entries.length*100}%`,`${c} ${(i+1)/entries.length*100}%`]});
  snowColourKeys.set("snowcover",{name:"Snow cover · NDSI",bar:`linear-gradient(90deg,${stops.join(",")})`,labels:["1","50","100"]});
}
async function fetchNoaaSnowKeys(){
  if(!["snowdepth","swe"].some(id=>ovOn[id]&&!snowColourKeys.has(id)&&Date.now()>=(snowKeysRetryAt.get(id)||0)))return;
  for(const id of ["snowdepth","swe"])snowKeysRetryAt.set(id,Date.now()+60000);
  try{
    const response=await fetch("https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/legend?f=json",{signal:AbortSignal.timeout(10000)});
    if(!response.ok)return;const data=await response.json();
    for(const [id,layerId,name] of [["snowdepth",3,"Snow depth · inches"],["swe",7,"Snow water equivalent · inches"]]){
      const entries=data.layers?.find(l=>l.layerId===layerId)?.legend||[];
      const swatches=await Promise.all(entries.filter(e=>e.imageData).map(async e=>{
        const url=`data:${e.contentType||"image/png"};base64,${e.imageData}`,img=new Image();img.src=url;await img.decode();return {label:e.label,url,img};
      }));
      if(swatches.length)snowColourKeys.set(id,{name,swatches});
    }
    paintMapReadoutKeys();
  }catch(error){} // A provider without a key must not be given an invented scale.
}
function paintMapReadoutKeys(){
  const keys=readoutColourKeys();
  const html=keys.map(key=>`<div class="map-colour-key"><div class="key-name">${esc(key.name)}</div>${key.bar?
    `<div class="key-ramp" style="background:${esc(key.bar)}"></div><div class="key-ticks">${key.labels.map(t=>`<span>${esc(t)}</span>`).join("")}</div>`:
    `<div class="key-swatches">${key.swatches.map(s=>`<span class="key-swatch"><img src="${s.url}" alt="">${esc(s.label)}</span>`).join("")}</div>`}</div>`).join("");
  const element=$(".map-colour-keys",readoutRoot);
  if(element.innerHTML!==html)element.innerHTML=html;
}
/* The native tile uses exactly these readings and rendered legends. A touch
   device has no hovering cursor: sample the selected location or map center. */
let nativeReadoutMoving=false;
function invalidateNativeMapReadout(){
  nativeReadoutMoving=true;
  if(committedLocation?.coordinates)return;
  cursorLocation=null;cursorElevation=null;
  $("#cursorBasis").textContent="Map center";
  $("#cursorCoordinates").textContent="Map moving…";
  $("#cursorElevation").textContent="Elevation —";
  $("#cursorSource").textContent="";
  $("#cursorAnalysis").textContent="";$("#cursorAnalysis").hidden=true;
}
function updateNativeMapReadout(){
  if(!NATIVE_HOST&&innerWidth>760)return;
  const selected=committedLocation?.coordinates;
  if(nativeReadoutMoving&&!selected){invalidateNativeMapReadout();return;}
  const ll=selected||(map3d||map).getCenter();
  const next={lat:ll.lat,lng:((ll.lng+180)%360+360)%360-180};
  if(!cursorLocation||cursorLocation.lat!==next.lat||cursorLocation.lng!==next.lng){
    cursorElevation=null;$("#cursorElevation").textContent="Elevation …";
    $("#cursorElevation").title="";$("#cursorSource").textContent="";
  }
  cursorLocation=next;
  $("#cursorBasis").textContent=selected?"Selected location":"Map center";
  $("#cursorCoordinates").textContent=cursorCoordinates(next);
  refreshCursorElevation();paintCursorAnalysis();
}
function mapInfoTerrainState(){
  return terrainLoadStatus.hidden?{state:"off",text:"Terrain is off"}:
    {state:terrainLoadStatus.dataset.state||"loading",text:terrainLoadStatus.textContent||"Waiting for terrain"};
}
function paintMapInfoTerrain(){
  const terrain=mapInfoTerrainState(),element=$("#mapInfoTerrain");
  if(element.textContent!==terrain.text)element.textContent=terrain.text;
  readoutRoot.dataset.terrainState=terrain.state;
}
window.ClearSkiesPortalBridge.mapReadoutState=()=>({
  basis:$("#cursorBasis").textContent,coordinates:$("#cursorCoordinates").textContent,
  elevation:$("#cursorElevation").textContent,source:$("#cursorSource").textContent,
  analysis:$("#cursorAnalysis").hidden?"":$("#cursorAnalysis").textContent,
  terrain:mapInfoTerrainState()
});
function placeMapReadout(){
  const app=$("#app").getBoundingClientRect();
  readoutRoot.style.setProperty("--map-info-width",Math.max(130,Math.min(260,app.width-82))+"px");
  paintTerrainStatus();updateNativeMapReadout();paintMapInfoTerrain();paintMapReadoutKeys();
}
let readoutRefresh=0;
function scheduleMapReadout(){
  if(readoutRefresh)return;readoutRefresh=requestAnimationFrame(()=>{readoutRefresh=0;placeMapReadout();loadSnowColourKeys()});
}
document.addEventListener("input",scheduleMapReadout);document.addEventListener("change",scheduleMapReadout);
document.addEventListener("csp:layers-changed",scheduleMapReadout);
map.on("layeradd layerremove",scheduleMapReadout);
new MutationObserver(scheduleMapReadout).observe(document.body,{attributes:true,attributeFilter:["class"]});
new MutationObserver(scheduleMapReadout).observe($("#terLegend"),{childList:true,subtree:true});
new MutationObserver(paintMapInfoTerrain).observe(terrainLoadStatus,{attributes:true,childList:true,characterData:true,subtree:true});
document.addEventListener("csp:location",scheduleMapReadout);
map.on("movestart",()=>{if((NATIVE_HOST||innerWidth<=760)&&!map3d)invalidateNativeMapReadout()});
map.on("moveend",()=>{if((NATIVE_HOST||innerWidth<=760)&&!map3d){nativeReadoutMoving=false;scheduleMapReadout()}});
{
  let readout3d=null;
  new MutationObserver(()=>{
    if(map3d&&map3d!==readout3d){readout3d=map3d;map3d.on("movestart",()=>{if(NATIVE_HOST||innerWidth<=760)invalidateNativeMapReadout()});map3d.on("moveend",()=>{nativeReadoutMoving=false;scheduleMapReadout()})}
    if(!map3d)nativeReadoutMoving=false;
  }).observe(document.body,{attributes:true,attributeFilter:["class"]});
}
addEventListener("resize",scheduleMapReadout);scheduleMapReadout();

$("#q").addEventListener("focus",()=>{ if(acList.length && $("#q").value.trim().length>=3) acRender() });
$("#q").addEventListener("blur",()=>setTimeout(acHide,120));
document.addEventListener("click",e=>{ if(!e.target.closest("#iw")) acHide() });
