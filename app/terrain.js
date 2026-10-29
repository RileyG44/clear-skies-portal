function scheduleServerProbe(delay){
  clearTimeout(serverProbeTimer);
  if(API) serverProbeTimer=setTimeout(()=>probeServer(),delay);
}
function probeServer(){
  const token=++probeToken, base=API, controller=new AbortController(), wasOnline=PROXY;
  let becameAvailable=false;
  /* GitHub Pages is intentionally static. With no configured engine URL there
     is nothing to probe, and asking github.io for /api/health only creates a
     misleading 404 in an otherwise healthy production session. A Tailscale or
     other explicit URL is still probed; locally served pages keep auto-detect.
     The iPhone app never serves the engine itself, so it is the same case. */
  if(!base&&(NATIVE_HOST||/\.github\.io$/i.test(location.hostname))){
    PROXY=false; serverHealth=null; paintServerBox(); paintTerrainInfo(); return Promise.resolve(false);
  }
  // Raw lidar rendering can legitimately occupy the engine for several
  // seconds. A short browser probe must not turn a busy-but-working service
  // into a misleading red "unreachable" state.
  const timer=setTimeout(()=>controller.abort(),12000);
  // In the app the address must reach the app before the relative request does.
  const health=NATIVE_HOST
    ? nativeEngineSync.then(()=>fetch(api("/api/health"),{signal:controller.signal,cache:"no-store"}))
    : fetch(base+"/api/health",{signal:controller.signal,cache:"no-store"});
  return health.then(r=>r.ok?r.json():null)
    .then(j=>{ if(token===probeToken&&base===API){
      const wasConnected=PROXY;
      PROXY=!!(j&&j.ok); serverHealth=PROXY?j:null;
      dnrStatus=j?.dnr||null;
      becameAvailable=PROXY&&!wasConnected;
      // A setup-link fragment is intentionally transient. Remember its target
      // only after it has answered a health check from this browser.
      if(PROXY&&API) localStorage.setItem("cspServer",API);
    } })
    .catch(()=>{ if(token===probeToken&&base===API){ PROXY=false; serverHealth=null } })
    .then(()=>{ if(token===probeToken){
      paintServerBox(); paintTerrainInfo(); scheduleServerProbe(PROXY?40000:15000);
      if(becameAvailable) document.dispatchEvent(new CustomEvent("csp:server",{detail:{online:true}}));
      else if(wasOnline&&!PROXY) document.dispatchEvent(new CustomEvent("csp:server",{detail:{online:false}}));
      if(becameAvailable){ refreshTerrainCoverage(true);applyElev();schedule3dStyle() }
    } return PROXY })
    .finally(()=>clearTimeout(timer));
}
probeServer();

let WA_EXTENT={};                     // layerId -> [xmin,ymin,xmax,ymax] in EPSG:3857
/* which WA lidar projects cover the current view? */
async function waCoverage(bounds=map.getBounds(),signal){
  if(!PROXY) return null;
  const bbox=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()];
  const r=await fetch(api("/api/wadnr/coverage?bbox="+bbox.join(",")),{signal});
  if(!r.ok||r.headers.get("X-Cache")==="ERROR")throw new Error(`DNR catalogue lookup HTTP ${r.status}`);
  const result=await r.json();
  if(!Array.isArray(result.projects)||!["ready","stale"].includes(result.state))throw new Error("Invalid DNR coverage catalogue");
  for(const project of result.projects)for(const id of [project.dtm,project.dsm])
    if(id!=null){
      const [w,s,e,n]=project.bounds,mx=lon=>lon*Math.PI/180*6378137,my=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*6378137;
      WA_EXTENT[id]=[mx(w),my(s),mx(e),my(n)];
    }
  return result;
}

const WA_MAX_PROJECTS = 14;   // a handful renders in ~1 s; the full 962 layers times out

/* A view almost always spans several lidar projects - Crab Creek sits across a
   county boundary, for instance - so ask for all of them, newest first, and let
   3DEP fill anything none of them covers. */
function waProjects(){
  if(!waCover) return [];
  return waCover.filter(p=>p.dtm!=null || p.dsm!=null).slice(0, WA_MAX_PROJECTS);
}
function waIds(){
  return waProjects().map(p=>p.dtm).filter(v=>v!=null);
}
/* Every WA DTM layer seen this session, newest survey first. Tiles pick the
   ones that overlap them (waTileUrl), so a growing list costs nothing and the
   layer never needs rebuilding as the view moves. */
const waSeen=new Map();                 // layer id -> survey year
function waLiveIds(){
  for(const p of waProjects()) if(p.dtm!=null&&!waSeen.has(p.dtm)) waSeen.set(p.dtm,p.year||0);
  return [...waSeen.entries()].sort((a,b)=>b[1]-a[1]).map(([id])=>id);
}

function chooseTerrain(style){
  const want=$("#terSrc").value;
  const closeEnough=map.getZoom()>=13;
  const ids=waIds();
  const waOK = closeEnough && PROXY && ids.length && WADNR_OK.has(style);
  const u1OK = closeEnough && PROXY; // coverage is decided per tile, never just at the map centre
  if(want==="3dep")  return {src:"3dep"};
  if(want==="usgs1m") return u1OK ? {src:"usgs1m", cover:usgsCover} : {src:"3dep", forced:true,overview:!closeEnough,reason:!PROXY?"Raw USGS elevation requires a connected terrain engine.":"Raw USGS elevation starts at zoom 13."};
  // Best available prefers cached WA DNR without starting an archive download.
  if(dnrElevationAvailable())return {src:"wadnr-elevation",cachedOnly:true,overview:!closeEnough};
  if(u1OK) return {src:"usgs1m", cover:usgsCover};
  return {src:"3dep"};
}

/* Presentation is independent of terrain derivation. These CSS filters apply
   to an already-rendered layer in one frame, make no network requests, and are
   stored separately for each scientific layer. */
const TERRAIN_LOOK_KEY="clearskies.terrainAppearance.v2";
function terrainLighting(){
  const number=(id,fallback)=>{const value=+$(id)?.value;return Number.isFinite(value)?value:fallback};
  return {azimuth:Math.max(0,Math.min(359,number("#terSunAz",315))),
    altitude:Math.max(5,Math.min(90,number("#terSunAlt",45))),
    ambient:Math.max(0,Math.min(.6,number("#terAmbient",12)/100)),
    exaggeration:Math.max(.25,Math.min(4,number("#terExaggeration",125)/100))};
}
/* Whether moving the sun changes anything in the 2D map right now.
   Two separate reasons it may not, and the panel used to admit neither in a way
   you could act on - the note was evergreen prose, always shown, so it read as
   background information rather than a description of the layer in front of you.

   1. Slope, aspect, northness and contours are derived from gradient and
      elevation. They have no light source to move.
   2. "Best available" silently prefers the published WA DNR hillshade once you
      pass z13 over Washington with the engine connected. That product, and the
      3DEP export composited beneath it, both arrive as finished images with
      their shadows already baked in - so the same slider that worked a moment
      ago at a wider zoom does nothing here, with no explanation. */
function sunEffect(){
  const style=$("#terStyle").value;
  const stack=gpuTerrainEnabled?studioStack(style):null;
  if(stack&&stack.layers.some(layer=>layer.style==="hs"||layer.style==="hsmulti"||(layer.style==="tint"||layer.style==="rem")&&layer.param>0))
    return {live:true,why:"Shaded layers in this look relight instantly."};
  const verdict=CSPTerrain.sunAffectsTerrain(style,style==="off"?null:chooseTerrain(style).src);
  if(verdict.reason==="off") return {live:false,why:"Terrain is off, so there is nothing here to light."};
  if(verdict.reason==="derived"){
    const label=$("#terStyle").selectedOptions[0]?.textContent?.trim()||"This style";
    return {live:false,why:`${label} is computed from the terrain\u2019s gradient, not from a light source, so the sun does not change it. The sliders still drive 3D relief.`};
  }
  if(verdict.reason==="prerendered")
    return {live:false,why:"Published WA DNR LiDAR hillshade arrives already rendered, with its shadows baked in \u2014 the sun cannot be moved here. Set Source to National 3DEP or USGS 3.3 ft to relight from elevation instead."};
  return {live:true,why:"Hillshade and elevation tint relight instantly."};
}
function paintSunNote(){
  const note=$("#terLightNote");if(!note)return;
  const effect=sunEffect();
  note.textContent=effect.why;
  note.dataset.live=String(effect.live);
}
function syncTerrainLighting(){
  const light=terrainLighting();
  paintSunNote();
  $("#terSunAzOut").textContent=Math.round(light.azimuth)+"°";
  $("#terSunAltOut").textContent=Math.round(light.altitude)+"°";
  $("#terAmbientOut").textContent=Math.round(light.ambient*100)+"%";
  $("#terExaggerationOut").textContent=light.exaggeration.toFixed(2)+"×";
  return light;
}
const TERRAIN_LOOK_DEFAULTS={
  hs:{contrast:100,saturation:100,brightness:100},hsmulti:{contrast:100,saturation:100,brightness:100},
  tint:{contrast:100,saturation:100,brightness:100},rem:{contrast:100,saturation:100,brightness:100},slope:{contrast:100,saturation:100,brightness:100},
  aspect:{contrast:100,saturation:100,brightness:100},c2:{contrast:100,saturation:100,brightness:100},
  northness:{contrast:100,saturation:100,brightness:100},
  c5:{contrast:100,saturation:100,brightness:100},c10:{contrast:100,saturation:100,brightness:100},
  c25:{contrast:100,saturation:100,brightness:100},off:{contrast:100,saturation:100,brightness:100}
};
let terrainLooks={};
try{ terrainLooks=JSON.parse(localStorage.getItem(TERRAIN_LOOK_KEY)||"{}")||{} }catch(e){ terrainLooks={} }
function terrainLook(style=$("#terStyle").value){
  const base=TERRAIN_LOOK_DEFAULTS[style]||TERRAIN_LOOK_DEFAULTS.off,stored=terrainLooks[style]||{};
  return {
    contrast:Math.max(60,Math.min(180,+stored.contrast||base.contrast)),
    saturation:Math.max(0,Math.min(180,Number.isFinite(+stored.saturation)?+stored.saturation:base.saturation)),
    brightness:Math.max(75,Math.min(150,+stored.brightness||base.brightness))
  };
}
function applyTerrainAppearanceTo(layer){
  if(gpuTerrainEnabled)syncGpuTerrain();
  if(!layer||layer===gpuTerrainLayer) return;
  const style=layer._cspStyle||$("#terStyle").value,look=terrainLook(style),container=layer.getContainer?.();
  if(container) container.style.filter=`saturate(${look.saturation/100}) contrast(${look.contrast/100}) brightness(${look.brightness/100})`;
}
function syncTerrainLookControls(){
  const style=$("#terStyle").value,look=terrainLook(style);
  $("#terLookStyle").textContent=style==="off"?"choose a layer":STYLE_NAME[style]||style;
  for(const [id,key] of [["terContrast","contrast"],["terSaturation","saturation"],["terBrightness","brightness"]]){
    $("#"+id).value=look[key];$("#"+id+"Out").textContent=look[key]+"%";
  }
}
function saveTerrainLook(){ try{ localStorage.setItem(TERRAIN_LOOK_KEY,JSON.stringify(terrainLooks)) }catch(e){} }
function updateTerrainLook(){
  const style=$("#terStyle").value;if(style==="off") return;
  terrainLooks[style]={contrast:+$("#terContrast").value,saturation:+$("#terSaturation").value,brightness:+$("#terBrightness").value};
  syncTerrainLookControls();applyTerrainAppearanceTo(terBase);applyTerrainAppearanceTo(terLayer);saveTerrainLook();
}

// Retain readiness state for the map and a future status location, without
// rendering the former readiness card in the LiDAR menu.
const terrainLoadStatus=document.createElement("div");
terrainLoadStatus.id="terrainLoadStatus";
let surveyController=null;
$("#terrainInspectSource").onclick=async()=>{
  surveyController?.abort();surveyController=new AbortController();const controller=surveyController;
  const view=document.body.classList.contains("terrain-3d")&&map3d?map3d:map,center=view.getCenter(),zoom=Math.round(view.getZoom());
  const output=$("#terrainSurveyInfo");output.textContent="Looking up the USGS mosaic at this point…";
  const timer=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch(CSPPublicTerrain.identifyUrl(center.lat,center.lng,zoom),{signal:controller.signal});
    if(!response.ok)throw new Error("Provider unavailable");
    const result=await response.json();if(result.error)throw new Error(result.error.message);
    const items=result.catalogItems?.features||[],visibilities=result.catalogItemVisibilities||[];
    output.replaceChildren();
    const heading=document.createElement("p");heading.textContent=`USGS catalog at ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}. This identifies the provider's mosaic at this point, not every pixel of the view.`;output.append(heading);
    if(!items.length){const note=document.createElement("p");note.textContent="No survey metadata was returned for this point.";output.append(note)}
    items.slice(0,8).forEach((item,index)=>{
      const a=item.attributes||{},row=document.createElement("p");
      const fields=[a.title||a.Name||"Unnamed USGS raster"];
      if(a.Resolution_X)fields.push(`native spacing: ${a.Resolution_X}`);
      if(a.VerticalDatum)fields.push(`vertical datum: ${a.VerticalDatum}`);
      if(a.AcquisitionDate&&Number.isFinite(+a.AcquisitionDate))fields.push(`acquired ${new Date(+a.AcquisitionDate).toISOString().slice(0,10)}`);
      if(Number.isFinite(visibilities[index]))fields.push(`provider contribution: ${(visibilities[index]*100).toFixed(0)}%`);
      row.textContent=fields.join(" · ");output.append(row);
      const url=safeHttpUrl(a.Metadata||a.URL);if(url){const link=document.createElement("a");link.href=url;link.target="_blank";link.rel="noopener noreferrer";link.textContent="Provider metadata";row.append(" ",link)}
    });
  }catch(error){if(controller===surveyController)output.textContent="Survey metadata is unavailable right now. The rendered-source labels above still reflect loaded tiles."}
  finally{clearTimeout(timer)}
};
function formatSampleMeters(meters){
  if(!Number.isFinite(meters)||meters<=0)return "sampling not reported";
  return `~${res(meters)}/pixel`;
}
function sourceResolutionText(source){
  const native=source.nativeLabel||"Native spacing not reported";
  const corrections=[...new Set((source.surveys||[]).map(s=>s.verticalUnitBasis).filter(Boolean))];
  const surveys=source.surveys||[],projects=surveys.slice(0,3).map(s=>`${s.project} (DTM ${s.datasetId})`).join("; ");
  return `Native: ${native} · displayed sampling: ${formatSampleMeters(source.sampleMeters)}${projects?" · Surveys: "+projects+(surveys.length>3?` +${surveys.length-3} more`:""):""}${corrections.length?" · "+corrections.join("; "):""}`;
}
function renderTerrainSourcePanel(summaryArg,is3dArg,layerArg){
  const body=$("#terrainSourcePanelBody");if(!body)return;
  const is3d=is3dArg??document.body.classList.contains("terrain-3d");
  const layer=layerArg||(terrainSwap?terrainSwap.displayedLayer:(!terLayer?elevLayer:terLayer));
  const summary=summaryArg||terrainLayerSummary(layer);
  /* Built once and updated in place: this runs on every tile load, and a
     rebuild would drop a slider out from under a drag. */
  if(!body.dataset.built){
    body.innerHTML='<p class="terrain-source-panel-status"></p><div class="terrain-source-panel-heading">Active layers</div><div class="tsp-rows"></div>'+
      '<p class="terrain-source-panel-note">Terrain labels reflect loaded tile samples. Other layer rows show the configured provider or feed; they do not imply that every pixel has identical coverage.</p>'+
      '<div class="terrain-source-panel-heading">Map source references</div><div class="terrain-source-panel-note" id="mapSourceReferences"></div>';
    body.dataset.built="1";
    const rows=body.querySelector(".tsp-rows");
    rows.addEventListener("input",e=>{
      const input=e.target.closest("input[data-tsp]");if(!input)return;
      const row=input.closest("[data-id]"),id=row.dataset.id;
      if(input.dataset.tsp==="opacity"){ window.ClearSkiesPortalBridge.setLayerOpacity(id,+input.value); input.nextElementSibling.textContent=input.value+"%"; }
      else if(input.dataset.tsp==="elevation"){ const slide=$("#elevSlide"); slide.value=input.value; slide.dispatchEvent(new Event("input",{bubbles:true})); input.nextElementSibling.textContent=elevationLabel(); }
      else if(input.dataset.tsp==="span"){ const span=$("#elevSpan"); span.value=elevSpanFromPosition(input.value); span.dispatchEvent(new Event("input",{bubbles:true})); input.nextElementSibling.textContent=Number(span.value).toLocaleString()+" ft";input.setAttribute("aria-valuetext",Number(span.value).toLocaleString()+" feet"); }
    });
    rows.addEventListener("change",e=>{
      const input=e.target.closest("input[data-tsp]");if(!input)return;
      const target={elevation:"#elevSlide",span:"#elevSpan"}[input.dataset.tsp];
      if(target) $(target).dispatchEvent(new Event("change",{bubbles:true}));
    });
  }
  const credits=[map.attributionControl?._container?.innerHTML,
    is3d?$("#map3d .maplibregl-ctrl-attrib-inner")?.innerHTML:""].filter(Boolean);
  body.querySelector("#mapSourceReferences").innerHTML=credits.join("<br>");
  const status=body.querySelector(".terrain-source-panel-status");
  status.textContent=is3d?public3dSourceText():summary.sources.length?`${summary.sources.map(source=>source.label).join(" + ")} · ${summary.coverage}% of tile positions rendered`:`${summary.coverage}% of tile positions rendered · waiting for elevation`;
  /* With terrain off there is no elevation to wait for; say nothing. */
  status.hidden=!is3d&&!summary.sources.length&&$("#terStyle")?.value==="off";
  const rows=body.querySelector(".tsp-rows");
  const active=window.ClearSkiesPortalBridge?.activeLayers?.()||[];
  const visible=active.filter(item=>item.visible!==false);
  const signature=visible.map(item=>item.id).join("|");
  if(rows.dataset.signature!==signature){
    rows.dataset.signature=signature;rows.replaceChildren();
    if(!visible.length){const empty=document.createElement("p");empty.textContent="No research layers are active; the reference basemap remains available.";rows.append(empty)}
    for(const item of visible){
      const row=document.createElement("div");row.className="terrain-source-panel-row";row.dataset.id=item.id;
      row.innerHTML='<div class="terrain-source-panel-name"></div><div class="terrain-source-panel-meta"></div>'+
        (item.noOpacity?"":'<label class="tsp-control"><span>Opacity</span><input type="range" min="0" max="100" step="1" data-tsp="opacity"><output></output></label>')+
        (item.id==="elevation-spectrum"?'<label class="tsp-control"><span>Elevation</span><input type="range" min="-500" max="4500" step="1" data-tsp="elevation"><output></output></label>'+
          '<label class="tsp-control"><span>Color span</span><input type="range" min="0" max="1000" step="1" data-tsp="span" title="Distance in feet from the reference where colors reach full strength"><output></output></label>':"");
      row.querySelectorAll("input").forEach(input=>input.setAttribute("aria-label",`${item.name} ${input.dataset.tsp==="span"?"color span in feet":input.dataset.tsp}`));
      rows.append(row);
    }
    requestAnimationFrame(()=>positionToolPopover(terrainSourcePanel,terrainSourceToggle));
  }
  for(const item of visible){
    const row=rows.querySelector(`[data-id="${CSS.escape(item.id)}"]`);if(!row)continue;
    let basis=item.meta||"Source not reported";
    if(item.id==="terrain"||item.id==="elevation-spectrum"||item.id==="elevation-bands"){
      const own=item.id==="terrain"?summary:terrainLayerSummary(elevLayer);
      basis=own.sources.length?own.sources.map(entry=>`${entry.label} (${Math.round(entry.percent)}% · ${sourceResolutionText(entry)})`).join(" · "):"Elevation source is still loading";
      if(item.id==="terrain"&&dnrAreas.length)basis=`WA DNR fetched areas: ${dnrAreas.length} · Rendered: ${basis}`;
    }
    if(item.id==="basemap")basis="Esri / OpenStreetMap reference basemap";
    const name=row.querySelector(".terrain-source-panel-name"),meta=row.querySelector(".terrain-source-panel-meta");
    if(name.textContent!==(item.name||"Unnamed layer")) name.textContent=item.name||"Unnamed layer";
    if(meta.textContent!==basis) meta.textContent=basis;
    const opacity=row.querySelector('[data-tsp="opacity"]');
    if(opacity&&document.activeElement!==opacity){ opacity.value=Math.round(item.opacity);opacity.nextElementSibling.textContent=Math.round(item.opacity)+"%" }
    const elevation=row.querySelector('[data-tsp="elevation"]');
    if(elevation&&document.activeElement!==elevation){ elevation.value=$("#elevSlide").value;elevation.nextElementSibling.textContent=elevationLabel() }
    const span=row.querySelector('[data-tsp="span"]');
    if(span&&document.activeElement!==span){ span.value=elevSpanPosition($("#elevSpan").value);span.setAttribute("aria-valuetext",Number($("#elevSpan").value).toLocaleString()+" feet");span.nextElementSibling.textContent=Number($("#elevSpan").value).toLocaleString()+" ft" }
  }
}
function elevationLabel(){
  const unit=$("#elevUnit").value;
  return `${Math.round(+$("#elevSlide").value/ELEV_UNIT[unit]).toLocaleString()} ${unit}`;
}
let terrainStatusFrame=0,terrainSwapMessage="";
function scheduleTerrainStatus(){
  if(terrainStatusFrame)return;
  terrainStatusFrame=requestAnimationFrame(()=>{terrainStatusFrame=0;paintTerrainStatus();});
}
function paintTerrainStatus(){
  const is3d=document.body.classList.contains("terrain-3d");
  if($("#terStyle").value==="off"&&!elevationActive()&&!is3d){terrainLoadStatus.hidden=true;return;}
  terrainLoadStatus.hidden=false;
  const layer=terrainSwap?terrainSwap.displayedLayer:(!terLayer?elevLayer:terLayer),tiles=Object.values(layer?._tiles||{});
  const summary=terrainLayerSummary(layer),{refining,failed,coverage,sources}=summary;
  const loading=!!terrainSwap||coverage<100||refining;
  const source3d=is3d?public3dSourceText():"";
  const offline=typeof navigator!=="undefined"&&navigator.onLine===false;
  terrainLoadStatus.dataset.state=offline?"offline":terrainSwapMessage||failed&&coverage===0?"partial":is3d?(source3d.includes("waiting for data")?"loading":"ready"):loading?"loading":failed?"partial":"ready";
  const label=terrainSwap?"Preparing terrain":failed&&coverage===0?"Terrain unavailable · check your connection or source":coverage<100?"Loading terrain":refining?"Refining terrain":failed?"Terrain available · some detail unavailable":"Terrain ready";
  const detail=sources.length?sources.map(source=>source.label).join(" + "):"Waiting for elevation";
  const requested=dnrAreas.length?`WA DNR areas: ${dnrAreas.length} · `:"";
  const message=offline?"Offline · reconnect to load missing map and terrain data.":is3d?source3d:terrainSwapMessage||`${requested}${label} · ${coverage}% of loaded tile positions · ${detail}${dnrAcquisitionText()?` · ${dnrAcquisitionText()}`:""}`;
  if(terrainLoadStatus.textContent!==message)terrainLoadStatus.textContent=message;
  const output=$("#terrainSourceSummary");
  output.innerHTML='<p><b>Currently displayed in 2D</b></p>'+sources.map(source=>`<p><a href="${source.url}" target="_blank" rel="noopener noreferrer">${esc(source.label)}</a> · ${source.percent<1?"<1":Math.round(source.percent)}% of rendered elevation samples<br><span class="terrain-resolution-note">${esc(sourceResolutionText(source))}</span></p>`).join("")+
    (!sources.length?'<p>No elevation samples displayed yet.</p>':'')+
    '<p>Percentages describe the current loaded tile samples, not survey footprint area. USGS 3DEP mixes resolutions; a 3.3 ft service capability does not mean every location has 3.3 ft data. Zooming past a source’s detail does not create new information.</p>'+
    (is3d?'<p><b>3D</b> '+esc(public3dSourceText())+'</p>':'')+
    (layer instanceof CompositeTerrainLayer?'<p>WA DNR is a published, fixed-light hillshade. Listed nearby projects are coverage candidates; the export does not identify which individual project supplies every pixel.</p>':'');
  renderTerrainSourcePanel(summary,is3d,layer);
}
map.on("moveend",scheduleTerrainStatus);
window.addEventListener("offline",scheduleTerrainStatus);
window.addEventListener("online",()=>{
  if(baseIdx>=BASEMAPS.length||document.getElementById("blk")) useBasemap(0);
  scheduleTerrainStatus();
});
let terrainSwap=null;
function clearTerrain(){
  scheduleTerrainStatus();
  if(terrainSwap) terrainSwap(false);
  if(terLayer){ map.removeLayer(terLayer); terLayer=null }
  if(terBase){ map.removeLayer(terBase); terBase=null }
  if(gpuTerrainEnabled)syncGpuTerrain();
}

function installTerrain(nextBase,nextLayer){
  if(terrainSwap) terrainSwap(false);
  terrainSwapMessage="";
  const oldBase=terBase, oldLayer=terLayer;
  terBase=nextBase; terLayer=nextLayer;
  const ready=nextLayer||nextBase;
  if(!ready){ if(oldLayer) map.removeLayer(oldLayer); if(oldBase) map.removeLayer(oldBase); return }
  const pending=[nextBase,nextLayer].filter(Boolean);
  for(const layer of pending){
    layer._cspTargetOpacity=Number.isFinite(+layer.options.opacity)?+layer.options.opacity:1;
    layer._cspPending=true;
    layer.setOpacity(0);                    // preload without double-compositing
  }
  let loaded=0, finished=false, timer=null,settleTimer=null;
  const finish=ok=>{
    if(finished) return; finished=true; if(timer) clearTimeout(timer); if(settleTimer) clearTimeout(settleTimer);
    ready.off("tileload",onLoad); ready.off("tilerefine",onLoad); ready.off("load",onComplete); ready.off("tileerror",onError);
    terrainSwap=null;scheduleTerrainStatus();
    if(ok){
      if(oldLayer&&map.hasLayer(oldLayer)) map.removeLayer(oldLayer);
      if(oldBase&&map.hasLayer(oldBase)) map.removeLayer(oldBase);
      for(const layer of pending){ layer._cspPending=false; layer.setOpacity(layer._cspTargetOpacity) }
    }else{
      if(nextLayer&&map.hasLayer(nextLayer)) map.removeLayer(nextLayer);
      if(nextBase&&map.hasLayer(nextBase)) map.removeLayer(nextBase);
      terLayer=oldLayer; terBase=oldBase; terSig=null;
      terrainSwapMessage="Requested terrain unavailable · previous map preserved. Try another source or reconnect the terrain engine.";
      terrainLoadStatus.dataset.state="partial";
      const current=+$("#terOp").value/100;
      if(oldLayer) oldLayer.setOpacity(current); if(oldBase) oldBase.setOpacity(current);
    }
  };
  finish.setOpacity=value=>{
    for(const layer of pending) layer._cspTargetOpacity=value;
    if(oldLayer) oldLayer.setOpacity(value); if(oldBase) oldBase.setOpacity(value);
  };
  const readiness=()=>{
    if(ready.getEngine&&ready.settled)return ready.settled();
    const tiles=Object.values(ready._tiles||{}).filter(tile=>tile.current!==false);
    const complete=tiles.filter(tile=>!!tile.loaded&&
      (!(tile.el instanceof HTMLCanvasElement)||tile.el._cspHasContent===true)).length;
    return {complete,total:tiles.length,ratio:complete/Math.max(1,tiles.length)};
  };
  const nearComplete=()=>{
    if(finished) return;
    const status=readiness();
    if(status.complete&&status.ratio>=0.9) finish(true);
  };
  const settle=()=>{ clearTimeout(settleTimer);settleTimer=setTimeout(nearComplete,250) };
  const onLoad=()=>{ loaded++;settle() };
  const onError=settle;
  /* `load` means every visible coordinate has either loaded or exhausted its
     resilient fallback. Swapping on the first tile exposed a checkerboard of
     unfinished gaps; waiting here makes the replacement viewport-atomic. */
  const onComplete=()=>{ const status=readiness();if(status.complete>0&&status.ratio>=0.9)finish(true); };
  ready.on("tileload",onLoad); ready.on("tilerefine",onLoad); ready.on("tileerror",onError); ready.on("load",onComplete);
  timer=setTimeout(()=>{ const status=readiness();finish(status.complete>0&&status.ratio>=0.9) },20000);
  terrainSwap=finish;
  finish.displayedLayer=oldLayer||oldBase||null;
  if(nextBase){ nextBase.addTo(map);applyTerrainAppearanceTo(nextBase) }
  if(nextLayer){ nextLayer.addTo(map);applyTerrainAppearanceTo(nextLayer) }
}

let terSig=null;
function applyTerrain(force){
  const style=$("#terStyle").value;
  if(style==="off"){ clearTerrain(); terSig=null; setCount("terrain",""); paintTerrainInfo(); return }
  const op=+$("#terOp").value/100;
  const pick=chooseTerrain(style);
  if(gpuTerrainEnabled&&pick.src!=="wadnr"){
    if(terrainSwap)terrainSwap(false);
    if(terLayer){map.removeLayer(terLayer);terLayer=null;}
    if(terBase){map.removeLayer(terBase);terBase=null;}
    terrainSwapMessage="";syncGpuTerrain();terSig=null;
    setCount("terrain",STYLE_NAME[style]||"");paintTerrainInfo(pick);return;
  }
  if(gpuTerrainEnabled)syncGpuTerrain();
  // Rebuilding a tile layer throws away every tile it has already loaded, which
  // is why panning used to blank the map. Only rebuild when the actual choice
  // changes; otherwise leave Leaflet alone and let it reuse its tiles.
  /* The signature names the kind of layer, not the view. National 3DEP and
     raw USGS 3.3 ft are one elevation layer - it asks for raw pixels only from
     z13, per tile - so crossing z13 no longer rebuilds it. The WA LiDAR layer
     reads the projects it may use at tile time (waLiveIds), so a pan that
     brings new projects into view no longer rebuilds it either. Each rebuild
     re-fetched every terrain tile on screen. */
  const kind=pick.src==="wadnr"?"wadnr":"elevation";
  const rawOK=PROXY&&$("#terSrc").value!=="3dep";
  const sourceOptions=elevationSourceOptions();
  const sourceSig=[kind,kind==="elevation"&&rawOK?"raw":"",sourceOptions.sourceKey].join("|");
  const sig=[style,sourceSig].join("|");
  if(!force&&sig===terSig&&terLayer){paintTerrainInfo(pick);return;}
  if(!terrainSwap&&terLayer instanceof AnalyticTerrainLayer&&kind==="elevation"){
    terLayer.setSourceOptions(sourceOptions);terLayer._cspSourceSig=sourceSig;
    terrainSwapMessage="";scheduleTerrainStatus();
    terLayer.options.style=style;terLayer._cspStyle=style;
    terLayer._store.forEach(tile=>terLayer._paint(tile.cv,tile.elev,tile.coords));
    applyTerrainAppearanceTo(terLayer);terSig=sig;setCount("terrain",STYLE_NAME[style]||"");paintTerrainInfo(pick);return;
  }
  let nextBase=null, nextLayer=null;
  if(pick.src==="wadnr"){
    nextLayer=new CompositeTerrainLayer({...TILE_OPTS,opacity:op,maxZoom:VIEW_MAX,maxNativeZoom:18,zIndex:440,className:`terrain-style-${style}`,
      baseUrl:(c,px)=>depProxyTileUrl(c,style,px),detailUrl:(c,px)=>waTileUrl(c,waLiveIds(),px),
      sharpPx:()=>({base:EXPORT_PX,detail:waSharpPx()}),attribution:"WA DNR LiDAR + USGS 3DEP fallback"});
  }else if(rawOK){
    nextLayer=new AnalyticTerrainLayer({...TILE_OPTS,opacity:op,maxZoom:VIEW_MAX,maxNativeZoom:TERRAIN_OVERZOOM,rawNativeZoom:18,zIndex:440,
      className:`terrain-style-${style}`,style,sourceLabel:"usgs-1m",refineOverview:true,
      ...sourceOptions,fallbackNativeZoom:15,nationalNativeZoom:17,
      attribution:"WA DNR elevation / USGS 3DEP / AWS overview (see rendered source status)"});
  }else{
    nextLayer=new AnalyticTerrainLayer({...TILE_OPTS,opacity:op,maxZoom:VIEW_MAX,maxNativeZoom:TERRAIN_OVERZOOM,rawNativeZoom:18,zIndex:440,
      className:`terrain-style-${style}`,style,sourceLabel:"national",refineOverview:true,
      ...sourceOptions,fallbackNativeZoom:15,nationalNativeZoom:17,
      attribution:"National elevation + AWS Terrarium fallback"});
  }
  if(nextBase) nextBase._cspStyle=style;
  if(nextLayer){
    nextLayer._cspStyle=style;nextLayer._cspSourceSig=sourceSig;
    nextLayer.on("loading tileload tileerror load tilerefine",scheduleTerrainStatus);
  }
  installTerrain(nextBase,nextLayer);
  terSig=sig;scheduleTerrainStatus();
  setCount("terrain", STYLE_NAME[style]||"");
  paintTerrainInfo(pick);
}

function paintTerrainInfo(pick){
  /* The active source changes with zoom, location and whether the engine is
     connected, so the note has to be re-evaluated wherever the terrain state is,
     not only when a slider moves. */
  paintSunNote();
  const el=$("#terInfo"); if(!el) return;
  const style=$("#terStyle").value;
  paintTerrainLegend(style);
  if(style==="off"){
    el.innerHTML = PROXY
      ? "Pick a layer to drape terrain over the map. Hillshade and contours come from LiDAR where it exists."
      : 'Choose a terrain layer to explore USGS elevation directly, with lighting, slope, contours and 3D. No server setup is needed. Global overview fills unavailable coverage.';
    return;
  }
  pick = pick || chooseTerrain(style);
  let html="";
  if(pick.src==="wadnr-elevation"){
    html+=`<div>Requested source: <b>Best available (cached WA DNR, then USGS)</b>. All analytical styles derive from numeric elevation; rendered sources and their percentages are shown above.</div>`;
    html+=`<div>Uses WA DNR already available on the connected engine, including downloaded areas. To fetch missing data, use <b>Select area on map</b> or <b>Download current view</b>. Panning never starts an archive download.</div>`;
    if(dnrAcquisitionText())html+=`<div>${esc(dnrAcquisitionText())}</div>`;
  }else if(pick.src==="wadnr"){
    const ps=pick.projs||[], n=ps.length;
    const yrs=ps.map(p=>p.year).filter(Boolean);
    html += `<div class="row2"><span>Preferred source: <span class="src">WA DNR LiDAR</span></span>`
          + `<span class="yr">${yrs.length ? (Math.min(...yrs)===Math.max(...yrs) ? yrs[0] : Math.min(...yrs)+"\u2013"+Math.max(...yrs)) : ""}</span></div>`
          + `<div><b>${n} project${n>1?"s":""}</b> composited as one bare-earth image at native resolution. `
          + `The basemap remains visible through true no-data areas.</div>`;
  }else if(pick.src==="usgs1m"){
    const h=(pick.cover&&pick.cover.hits)||[];
    const yrs=h.map(x=>x.year).filter(Boolean);
    html += `<div class="row2"><span>Preferred source: <span class="src">USGS 3.3 ft LiDAR</span></span>`
          + `<span class="yr">${yrs.length?Math.max(...yrs):""}</span></div>`
          + `<div>Detailed elevation loads where available. National terrain fills survey gaps; the loading status above identifies the data actually displayed.</div>`
          + h.slice(0,3).map(x=>`<div class="row2"><span>${esc(x.project)}</span>`
              + `<span class="yr">${(x.size/1048576).toFixed(0)} MiB</span></div>`).join("");
  }else{
    html += `<div>USGS 3DEP elevation with global overview fallback. ${PROXY?"":"Elevation downloads directly from USGS and is decoded on your device."}`
          + (pick.forced ? ` <b>Requested source could not be used:</b> ${esc(pick.reason||"The requested source is unavailable at this scale.")}` : "")
          + ` Native resolution varies by survey; use Rendered data &amp; source details to check what loaded. A private engine adds WA DNR published hillshades, raw archive access and offline downloads.</div>`;

  }
  if(PROXY && usgsCover && pick.src!=="usgs1m"){
    html += usgsCover.hits && usgsCover.hits.length
      ? `<div style="margin-top:7px">USGS <b>3.3 ft DEM</b> covers the map centre`
        + ` (${esc(usgsCover.cell)}) &mdash; pick <i>USGS 3.3 ft</i> for slope, aspect and contours from real elevation.</div>`
      : `<div style="margin-top:7px">No federal 3.3 ft DEM for this cell (${esc(usgsCover.cell||"")}).</div>`;
  }
  if(waCover && waCover.length){
    html += `<div style="margin-top:7px"><b>LiDAR projects in and around this view</b></div>`
          + waCover.slice(0,5).map(p=>
              `<div class="row2"><span>${esc(p.name.replace(/\s*\d{4}\s*$/,""))}</span>`
            + `<span class="yr">${p.year||"?"}</span></div>`).join("")
          + (waCover.length>5 ? `<div style="margin-top:3px">+${waCover.length-5} more projects</div>` : "");
  }else if(PROXY && LOC){
    html += waCoverageState==="error"
      ? `<div style="margin-top:7px">DNR catalogue lookup failed; coverage is unknown. ${esc(waCoverageError)} A retry will run automatically.</div>`
      : waCoverageState==="ready"?`<div style="margin-top:7px">No DNR catalogue candidates intersect this view.</div>`
      : `<div style="margin-top:7px">DNR catalogue coverage is ${waCoverageState==="stale"?"using the last valid catalogue":"being checked"}.</div>`;
  }
  el.innerHTML=html;
}

function paintTerrainLegend(style){
  const el=$("#terLegend"); if(!el) return;
  const studio=gpuTerrainEnabled&&style!=="off"?lidarStudio?.legend(style):null;
  if(studio?.hidden){el.className="terlegend";el.innerHTML="";return}
  if(studio){
    el.className="terlegend on";
    el.innerHTML=`<div class="caption">${esc(studio.caption)}</div><div class="bar" style="background:${studio.bar}"></div><div class="ticks">${studio.ticks.map(t=>`<span>${esc(t)}</span>`).join("")}</div>`;
    return;
  }
  const intervals={c2:"2 ft",c5:"5 ft",c10:"10 ft",c25:"25 ft"};
  if(style==="off"){ el.className="terlegend";el.innerHTML="";return }
  let bar="",ticks="",caption="";
  if(style==="slope"){
    caption="Slope · Horn 3 × 3 · degrees";
    bar=`linear-gradient(90deg,${CSPTerrainRaster.SLOPE_STOPS.map(([degrees,color])=>`${color} ${+(degrees/90*100).toFixed(3)}%`).join(",")})`;
    ticks="<span>0°</span><span>30°</span><span>60°</span><span>90°</span>";
  }else if(style==="aspect"){
    caption="Downslope aspect · compass azimuth · flats transparent";
    bar=`linear-gradient(90deg,${CSPTerrainRaster.ASPECT_STOPS.map(([,color])=>color).join(",")})`;
    ticks="<span>N 0°</span><span>E 90°</span><span>S 180°</span><span>W 270°</span><span>N</span>";
  }else if(style==="northness"){
    caption="North–south exposure · cooler/moister to warmer/drier · flats transparent";
    bar="linear-gradient(90deg,#37895c,#f7f3e0,#d6524e)";
    ticks="<span>north-facing</span><span>east / west</span><span>south-facing</span>";
  }else if(style==="tint"){
    caption="Elevation tint · feet";
    bar=`linear-gradient(90deg,${CSPTerrain.ELEVATION_RAMPS.relief.filter(stop=>stop[0]<=3200).map(([m,rgb])=>`rgb(${rgb.slice(0,3).join(",")}) ${(m+500)/3700*100}%`).join(",")})`;
    ticks="<span>−1,640 ft</span><span>4,430 ft</span><span>10,500 ft+</span>";
  }else if(style==="hsmulti"){
    caption="Mark / GDAL multidirectional hillshade";
    bar="linear-gradient(90deg,#222,#777,#c5c5c5,#fff)";
    ticks="<span>ambient</span><span>relief</span><span>illuminated</span>";
  }else if(style==="hs"){
    const light=terrainLighting();caption=`Hillshade · ${Math.round(light.azimuth)}° azimuth · ${Math.round(light.altitude)}° sun altitude`;
    bar="linear-gradient(90deg,#1f1f1f,#777,#c5c5c5,#fff)";
    ticks="<span>shadow</span><span>relief</span><span>illuminated</span>";
  }else if(intervals[style]){
    caption=`Contours · ${intervals[style]} base interval · every fifth indexed`;
    bar="linear-gradient(90deg,#965f47 0 44%,#784628 44% 56%,#965f47 56%)";
    ticks="<span>intermediate</span><span>index</span><span>intermediate</span>";
  }
  el.className="terlegend on";
  el.innerHTML=`<div class="caption">${caption}</div><div class="bar" style="background:${bar}"></div><div class="ticks">${ticks}</div>`;
}

/* refresh coverage when the view or location changes, then re-pick the source */
let coverBounds=null,coverageController=null,coverageRetryTimer=null;
/* Federal 1 m coverage for the centre of the view. One 10 km cell answers for
   the whole screen at any usable zoom, so this is re-asked only when the centre
   leaves the cell that was last looked up. */
let usgsCover=null, usgsCell=null;
async function usgsCoverage(signal){
  const c=map.getCenter();
  try{
    const r=await fetch(api(`/api/usgs/cover?lat=${c.lat.toFixed(5)}&lon=${c.lng.toFixed(5)}`),{signal});
    if(!r.ok) return null;
    const j=await r.json();
    usgsCell=j.cell;
    return j;
  }catch(e){ return null }
}

async function refreshTerrainCoverage(force){
  clearTimeout(coverageRetryTimer);
  const token=++terrainQueryToken;coverageController?.abort();coverageController=null;
  if(!PROXY){waCover=null;usgsCover=null;coverBounds=null;applyTerrain();return;}
  const b=map.getBounds();
  if(!force&&coverBounds&&coverBounds.contains(b)){applyTerrain();return;}
  const controller=new AbortController();coverageController=controller;
  const timeout=setTimeout(()=>controller.abort(),35000);
  const queryBounds=b.pad(0.15);
  waCoverageState="loading";
  try{
    const [wa,u1]=await Promise.all([waCoverage(queryBounds,controller.signal),usgsCoverage(controller.signal)]);
    if(token!==terrainQueryToken||controller.signal.aborted)return;
    waCover=wa?.projects||null;waCoverageState=wa?.state||"unknown";waCoverageError="";
    dnrStatus=wa?.elevation||dnrStatus;usgsCover=u1;coverBounds=queryBounds;
    if(waCoverageState==="stale"){coverBounds=null;coverageRetryTimer=setTimeout(()=>refreshTerrainCoverage(true),30000);}
  }catch(error){
    if(token!==terrainQueryToken)return;
    // A temporary provider failure is not evidence that a survey disappeared.
    coverBounds=null;
    waCoverageState="error";waCoverageError=error.name==="AbortError"?"The lookup timed out.":String(error.message||error);
    coverageRetryTimer=setTimeout(()=>refreshTerrainCoverage(true),30000);
  }finally{clearTimeout(timeout);}
  if(token!==terrainQueryToken)return;
  paintElevOut();applyTerrain();
}

lidarStudio=window.CSPLidarStudio?.mount($("#terStudio"),{
  getStyle:()=>$("#terStyle").value,
  setStyle:style=>{$("#terStyle").value=style;$("#terStyle").dispatchEvent(new Event("change",{bubbles:true}))},
  onChange:()=>{syncGpuTerrain();schedule3dStyle();paintTerrainInfo();scheduleStudioFit()},
  sample:()=>gpuTerrainEnabled&&gpuTerrainLayer&&map.hasLayer(gpuTerrainLayer)?gpuTerrainLayer.getEngine()?.sampleValues():null,
  gpuAvailable:()=>gpuTerrainDecided?gpuTerrainEnabled:true,
  getOpacity:()=>terrainOpacity(),
  setOpacity:value=>{const input=$("#terOp");input.value=Math.round(value);input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))},
  lighting:()=>terrainLighting()
})||null;
$("#terStyle").onchange=()=>{ syncTerrainLookControls();saveTerrainPrefs(); applyTerrain(true);refreshTerrainCoverage(false);schedule3dStyle();lidarStudio?.refresh() };
$("#terSrc").onchange=()=>{ saveTerrainPrefs();applyTerrain(true);applyElev();refreshTerrainCoverage(false);resetMeshSources();schedule3dStyle() };
function terrainOpacity(){
  const value=+$("#terOp").value;
  return Math.max(0,Math.min(100,Number.isFinite(value)?value:70));
}
function syncTerrainOpacity(){
  const value=terrainOpacity();
  $("#terOpOut").textContent=value+"%";
  return value/100;
}
$("#terOp").oninput=()=>{ const v=syncTerrainOpacity();
  if(terrainSwap&&terrainSwap.setOpacity) terrainSwap.setOpacity(v);
  else{ if(terLayer) terLayer.setOpacity(v); if(terBase) terBase.setOpacity(v) }
  if(gpuTerrainEnabled)syncGpuTerrain();
  saveTerrainPrefs();schedule3dStyle() };
for(const id of ["#terContrast","#terSaturation","#terBrightness"]) $(id).addEventListener("input",updateTerrainLook);
$("#terLookReset").onclick=()=>{
  const style=$("#terStyle").value;if(style==="off") return;
  delete terrainLooks[style];saveTerrainLook();syncTerrainLookControls();applyTerrainAppearanceTo(terBase);applyTerrainAppearanceTo(terLayer);
};
$("#terReset").onclick=()=>{
  exitTerrain3d();
  $("#terStyle").value="off";$("#terSrc").value="auto";$("#terOp").value=70;
  $("#terDepth").value="native";$("#terExtent").value="view";terrainLooks={};saveTerrainLook();
  $("#terSunAz").value=315;$("#terSunAlt").value=45;$("#terAmbient").value=12;$("#terExaggeration").value=125;
  syncTerrainOpacity();syncTerrainLookControls();syncTerrainLighting();saveTerrainPrefs();applyTerrain(true);schedule3dStyle();warmPreview();lidarStudio?.refresh();
  announceLayers();
};
map.on("moveend", ()=>{
  if(!PROXY || ($("#terStyle").value==="off"&&!$("#elevSh").checked)) return;
  clearTimeout(terTimer);
  terTimer=setTimeout(()=>{ refreshTerrainCoverage(false); warmPreview() }, 700);
});

