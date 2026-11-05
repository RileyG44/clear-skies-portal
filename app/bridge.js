function cspTerrainSourceMeta(){
  const summary=terrainLayerSummary(terLayer);
  return summary.sources.length?summary.sources.map(source=>source.label).join(" + "):
    summary.failed?"Terrain source unavailable":"Terrain · source pending";
}
function cspActiveLayers(){
  const layers=[];
  if(overlay||overlayPending||footprint){
    layers.push({id:"scene",name:$("#ctlName").textContent||"Satellite scene",
      meta:[$("#ctlDate").textContent,"Satellite imagery"].filter(Boolean).join(" · "),
      opacity:+$("#op").value,visible:+$("#op").value>0,kind:"imagery"});
  }
  if($("#terStyle").value!=="off"){
    layers.push({id:"terrain",name:$("#terStyle").selectedOptions[0]?.textContent||"Terrain",
      meta:cspTerrainSourceMeta(),
      opacity:+$("#terOp").value,visible:true,kind:"terrain"});
  }
  if($("#elevSh").checked){
    layers.push({id:"elevation-spectrum",name:"Color by elevation",
      meta:`Reference ${elevFormat(elevMetres())} · span ±${elevFormat(elevSpanMetres())}`,
      opacity:+$("#elevAlpha").value,visible:true,kind:"analysis"});
  }
  if($("#elevBelowOn").checked||$("#elevAboveOn").checked){
    layers.push({id:"elevation-bands",name:"Elevation highlights",
      meta:[$("#elevBelowOn").checked&&`Below ${(+$("#elevBelowVal").value||0).toLocaleString()} ${elevUnitKey()}`,$("#elevAboveOn").checked&&`Above ${(+$("#elevAboveVal").value||0).toLocaleString()} ${elevUnitKey()}`].filter(Boolean).join(" · "),
      opacity:+$("#elevBandAlpha").value,visible:true,kind:"analysis"});
  }
  for(const entry of researchStack.slice().reverse()){
    if(!entry.overlay) continue;
    const blend=CSPAnalysisLayers.BLENDS.find(b=>b.id===entry.style.blend)?.label||"Normal";
    layers.push({id:"analysis:"+entry.id,name:researchLabel(entry),meta:`Surface analysis · ${blend}`,
      opacity:Math.round(entry.style.opacity*100),visible:entry.style.visible,kind:"analysis"});
  }
  for(const o of OVERLAYS){
    if(!ovOn[o.id]) continue;
    layers.push({id:`overlay:${o.id}`,name:o.id==="imagery"?"Global satellite basemap":o.name,
      meta:`${o.group||"Overlay"} · ${o.via||"public source"}`,opacity:overlayOpacityPercent(o),visible:true,kind:"overlay"});
  }
  if($("#fire").checked) layers.push({id:"active-fires",name:"Active fires",meta:"NIFC live perimeter feed",opacity:100,visible:true,kind:"condition",noOpacity:true});
  layers.push(...(window.CSPMarkup?.activeEntries()||[]));
  layers.push({id:"basemap",name:"Reference basemap",meta:"Pinned below all research layers",opacity:100,visible:true,kind:"base",locked:true,noOpacity:true});
  return layers;
}
function cspInput(id,value,event="input"){
  const input=$(id);if(!input) return;
  if(input.type==="checkbox") input.checked=!!value; else input.value=value;
  input.dispatchEvent(new Event(event,{bubbles:true}));
  if(event==="input") input.dispatchEvent(new Event("change",{bubbles:true}));
}
function cspSetLayerVisible(id,visible){
  if(id==="scene"){if(!visible) clearScene()}
  else if(id==="terrain"){
    if(!visible){$("#terStyle").dataset.lastVisible=$("#terStyle").value;cspInput("#terStyle","off","change")}
    else cspInput("#terStyle",$("#terStyle").dataset.lastVisible||"hs","change");
  }else if(id==="elevation-spectrum") cspInput("#elevSh",visible,"change");
  else if(id==="elevation-bands"){
    cspInput("#elevBelowOn",visible,"change");cspInput("#elevAboveOn",visible,"change");
  }else if(id.startsWith("analysis:")) updateResearchLayer(id.slice(9),{visible});
  else if(id==="active-fires") cspInput("#fire",visible,"change");
  else if(id.startsWith("overlay:")) cspInput("#ov_"+id.slice(8),visible,"change");
  else if(id.startsWith("markup:")) window.CSPMarkup?.setVisible(id.slice(7),visible);
  announceLayers();
}
function cspSetLayerOpacity(id,value){
  value=Math.max(0,Math.min(100,+value||0));
  if(id==="scene"){if(value>0) $("#op").dataset.lastVisible=value;cspInput("#op",value)}
  else if(id==="terrain") cspInput("#terOp",value);
  else if(id==="elevation-spectrum") cspInput("#elevAlpha",value);
  else if(id==="elevation-bands") cspInput("#elevBandAlpha",value);
  else if(id.startsWith("analysis:")) updateResearchLayer(id.slice(9),{opacity:value/100,visible:value>0});
  else if(id.startsWith("overlay:")) setOverlayOpacity(id.slice(8),value);
  else if(id.startsWith("markup:")) window.CSPMarkup?.setOpacity(id.slice(7),value);
  announceLayers();
}
function cspResetLayer(id){
  if(id==="scene") $("#ctlReset").click();
  else if(id==="terrain") $("#terReset").click();
  else if(id==="elevation-spectrum") $("#elevSpectrumReset").click();
  else if(id==="elevation-bands") $("#elevBandsReset").click();
  else if(id.startsWith("analysis:")){const entry=researchEntry(id.slice(9));if(entry){delete researchStyles[entry.product];updateResearchLayer(entry.id,researchStyleDefaults(entry.product))}}
  else if(id.startsWith("overlay:")){
    const overlayId=id.slice(8),o=OVERLAYS.find(item=>item.id===overlayId);delete ovOpacities[overlayId];
    if(o?.lineWidth){ovLineWidths[overlayId]=o.lineWidth.default;const input=$("#ovLine_"+overlayId);if(input){input.value=o.lineWidth.default;input.dispatchEvent(new Event("input",{bubbles:true}))}}
    if(o?.timeSlice){const input=$("#ovTime_"+overlayId);if(input){input.value=o.timeSlice.values.indexOf(o.timeSlice.default);input.dispatchEvent(new Event("input",{bubbles:true}))}}
    if(o&&ovLayers[overlayId]?.setOpacity) ovLayers[overlayId].setOpacity(ovOpacity(o));ovSave();
  }
  else if(id.startsWith("markup:")) window.CSPMarkup?.resetLayer(id.slice(7));
  announceLayers();
}
function cspSetLayerOrder(order){
  const top=620;
  // Terrain and spectrum share a compositing surface: keep them adjacent,
  // using the uppermost requested stack position for that surface.
  const gpuIds=["terrain","elevation-spectrum","elevation-bands"];
  const gpuIndex=(order||[]).findIndex(id=>gpuIds.includes(id));
  if(gpuIndex>=0){gpuTerrainOrderZ=top-gpuIndex*8+1;if(gpuTerrainEnabled)gpuTerrainLayer.setZIndex(gpuTerrainOrderZ);}
  (order||[]).forEach((id,index)=>{
    const z=top-index*8;
    if(id==="scene"){
      overlay?.setZIndex?.(z);NEIGH.forEach(n=>n.layer?.setZIndex?.(z-1));MOSAIC_BACKDROP?.layer?.setZIndex?.(z-2);
    }else if(id==="terrain"){terBase?.setZIndex?.(z);terLayer?.setZIndex?.(z+1)}
    else if(id==="elevation-spectrum"||id==="elevation-bands") elevLayer?.setZIndex?.(z);
    else if(id.startsWith("analysis:")) researchEntry(id.slice(9))?.overlay?.setZIndex?.(z);
    else if(id.startsWith("overlay:")) ovLayers[id.slice(8)]?.setZIndex?.(z);
  });
  /* The layer list may reorder analysis layers; keep their own stack in step. */
  const analysisOrder=(order||[]).filter(id=>id.startsWith("analysis:")).map(id=>id.slice(9));
  if(analysisOrder.length&&analysisOrder.length===researchStack.filter(entry=>entry.overlay).length){
    const rank=entry=>{const i=analysisOrder.indexOf(entry.id);return i<0?-1:analysisOrder.length-i};
    const sorted=researchStack.slice().sort((x,y)=>rank(x)-rank(y));
    if(sorted.some((entry,i)=>entry!==researchStack[i])){researchStack=sorted;for(const view of researchViews) view.refresh()}
  }
  setOverlayOrder((order||[]).filter(id=>id.startsWith("overlay:")).map(id=>id.slice(8)));
  window.CSPMarkup?.setOrder((order||[]).filter(id=>id.startsWith("markup:")).map(id=>id.slice(7)));
}
window.ClearSkiesPortalBridge={
  /* For markup.js: the map, the engine address, and whether it answers. */
  map,
  positionToolPopover,
  announceToolPopover,
  map3d:()=>map3d,
  gpuTerrain:()=>gpuTerrainLayer,
  gpu3d:()=>gpu3d,
  api,
  server:()=>({online:PROXY,base:API}),
  activeLayers:cspActiveLayers,
  setLayerVisible:cspSetLayerVisible,
  setLayerOpacity:cspSetLayerOpacity,
  resetLayer:cspResetLayer,
  setLayerOrder:cspSetLayerOrder,
  refreshOverlayStatus:paintOverlayNote,
  /* Automatic route opens keep focus in the search or navigation control. */
  openPane:name=>{
    const pane=document.querySelector(`.pane[data-pane="${name}"]`);
    if(pane?.classList.contains("min")) togglePaneAnimated(pane);
  },
  /* Annotation tools stay on whichever map is visible. */
  ensureMap:()=>{if(document.body.classList.contains("point-cloud-open"))pointCloudPanel?.close?.()},
  ensure2d:()=>{ if(document.body.classList.contains("point-cloud-open")) pointCloudPanel?.close?.(); if(document.body.classList.contains("terrain-3d")) exitTerrain3d() },
  overlayCatalog:()=>OVERLAYS.map(o=>({id:o.id,name:o.id==="imagery"?"Global satellite basemap":o.name,group:o.group,route:OVERLAY_GROUP_ROUTES[o.group],via:o.via})),
  /* For the Satellite panel's scene search. */
  placeSuggestions:cspPlaceSuggestions,
  searchPlace:cspSearchPlace,
  searchText:cspSearchText,
  searchMapCenter:cspSearchMapCenter,
  searchSelected:cspSearchSelected,
  searchBestImagery:cspSearchBestImagery,
  searchLabel:()=>committedLocation?.label||"",
  moveDockTool(id,index){
    const el=document.getElementById(String(id));
    if(!el||el.parentElement!==dockEl||!el.matches(".map-tool")||!Number.isInteger(index))return false;
    moveDockTool(el,index,false);saveDockOrder();return true;
  },
  sessionState:()=>{
    const active=map3d||map,center=active.getCenter();
    return {center:[center.lat,center.lng],zoom:active.getZoom(),bearing:active.getBearing?.()||0,
      pitch:map3d?.getPitch()||0,mode:map3d?"3d":"2d",
      location:committedLocation?.coordinates?{...committedLocation.coordinates,label:committedLocation.label}:null};
  },
  async restoreSession(state){
    if(!Array.isArray(state?.center)||state.center.length!==2||!state.center.every(Number.isFinite)||!Number.isFinite(state.zoom))return false;
    if(state.mode!=="3d"&&map3d)exitTerrain3d();
    if(!state.location)clearLoc();
    if(state.location&&Number.isFinite(state.location.lat)&&Number.isFinite(state.location.lng))
      setLoc(state.location.lat,state.location.lng,true,String(state.location.label||""));
    map.setView(state.center,state.zoom,{animate:false});map.setBearing?.(Number(state.bearing)||0);
    if(state.mode==="3d"){
      await enterTerrain3d();
      const camera={center:[state.center[1],state.center[0]],zoom:state.zoom,bearing:Number(state.bearing)||0,pitch:Number(state.pitch)||0};
      map3d.jumpTo(camera);
      map3d.once("load",()=>{map3d.stop();map3d.jumpTo(camera)});
    }
    return true;
  },
  searchState:()=>committedLocation?{...committedLocation,coordinates:{...committedLocation.coordinates}}:{version:0,label:"",coordinates:null}
};

/* CR-003 r1 — opt-in location/full-display-state links. No engine settings,
   account data, saved-look library or other unrelated preferences are read. */
const CSP_SHARE_WEB_URL="https://rileyg44.github.io/clear-skies-portal/";
const CSP_SHARE_CONTROL=/^(?:ter(?:Style|Src|Op|Depth|Extent|SunAz|SunAlt|Ambient|Exaggeration|Contrast|Saturation|Brightness)|fabBand|elev[A-Z]\w*|pc(?:Budget|Size|SizeMode|Colour|Edl|EdlStrength|EdlRadius|Canopy|Linked)|days|dFrom|dTo|cloud|vis|sort|viewable|mosaic|fire|op)$/;
function cspShareControls(){
  return [...document.querySelectorAll("input[id],select[id]")].filter(el=>CSP_SHARE_CONTROL.test(el.id)&&!["button","submit","file","hidden"].includes(el.type));
}
const cspShareBounds=b=>[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
const cspShareLatLngBounds=b=>L.latLngBounds([b[1],b[0]],[b[3],b[2]]);
function cspShareScene(it){
  if(!it)return null;
  const result={};
  for(const key of ["id","src","srcKey","coll","label","kind","vis","gsd","date","cloud","bbox","geom","nativeMax","tiles","link"])
    if(it[key]!==undefined)result[key]=it[key];
  // Acquisition footprint keys are display identity, not the full STAC metadata.
  result.props={};
  for(const key of ["s2:mgrs_tile","landsat:wrs_path","landsat:wrs_row","mgrs:utm_zone","mgrs:latitude_band","mgrs:grid_square"])
    if(it.props?.[key]!=null)result.props[key]=it.props[key];
  cspValidateShareScene(result);return result;
}
function cspShareResearch(entry){
  const result={id:entry.id,product:entry.product,params:{...entry.params},style:{...entry.style},last:null};
  if(entry.last){
    const last=entry.last,c=last.capture;
    result.last={result:last.result,engine:last.engine,bounds:cspShareBounds(last.bounds),
      capture:{elevation:c.elevation,width:c.width,height:c.height,resolution:c.resolution,hillshade:c.hillshade,
        raster:{...c.raster,bounds:cspShareBounds(c.raster.bounds)}}};
  }
  return result;
}
function cspCaptureShareState(){
  const B=window.ClearSkiesPortalBridge,view=B.sessionState(),point=view.location;
  if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lng))throw Error("Select a location before sharing.");
  view.center=[point.lat,point.lng];
  const active=cspActiveLayers(),ids=new Set(active.map(layer=>layer.id));
  let saved=[];try{saved=JSON.parse(localStorage.getItem("clearskies.active-layer-order.v1")||"[]")}catch(_){}
  const order=[...saved.filter(id=>ids.has(id)),...active.map(layer=>layer.id).filter(id=>!saved.includes(id))];
  const primary=SEL!=null?ITEMS[SEL]:null;
  const state={version:1,view,theme:document.documentElement.dataset.uiTheme,
    controls:Object.fromEntries(cspShareControls().map(el=>[el.id,el.type==="checkbox"?el.checked:el.value])),
    studio:lidarStudio?.displayState()||null,terrainLook:terrainLook(),
    overlays:OVERLAYS.filter(o=>ovOn[o.id]).map(o=>({id:o.id,opacity:overlayOpacityPercent(o),
      lineWidth:o.lineWidth?overlayLineWidth(o):null,timeSlice:o.timeSlice?overlayTimeSlice(o):null})),
    alerts:JSON.parse(JSON.stringify(alertPrefs)),
    imagery:primary?{primary:cspShareScene(primary),neighbours:NEIGH.map(n=>cspShareScene(n.item)),backdrop:cspShareScene(MOSAIC_BACKDROP?.item)}:null,
    research:{live:$("#researchLive").checked,layers:researchStack.map(cspShareResearch)},
    markup:window.CSPMarkup?.displayState()||[],pointCloud:pointCloudPanel?.displayState()||null,order};
  cspValidateShareState(state);return state;
}
/* Everything a share link may hold on this page; share-state.js checks it. */
function cspShareEnvironment(){
  return {controls:cspShareControls(),viewMax:VIEW_MAX,overlays:OVERLAYS,
    pointCloudClasses:[...document.querySelectorAll("[data-pc-class]")].map(el=>el.dataset.pcClass),
    lidarRender:CSPLidarRender,analysisLayers:CSPAnalysisLayers,researchLabels:RESEARCH_LABELS,researchParams:RESEARCH_PARAMS,
    researchStyleDefaults,researchPaletteChoices};
}
function cspValidateShareScene(scene){return CSPShareState.validateScene(scene)}
function cspValidateShareState(state){return CSPShareState.validate(state,cspShareEnvironment())}
async function cspShareURL(){
  const state=cspCaptureShareState(),payload=await window.CSPShareState.encode(state);
  /* theme= is only a launch hint: index.html paints the first frame in the
     link's map colour before the payload is decoded. The payload decides. */
  return CSP_SHARE_WEB_URL+"#csp="+payload+"&theme="+(state.theme==="dark"?"dark":"light");
}
/* The steps of restoring a shared view. Each adds to warnings what it could
   not restore, rather than failing the whole view. */
function cspRestoreOverlays(state,warnings){
  const wanted=new Map(state.overlays.map(item=>[item.id,item]));
  for(const o of OVERLAYS){const item=wanted.get(o.id);ovOn[o.id]=!!item;
    const input=$("#ov_"+o.id);if(input)input.checked=!!item;
    if(item){ovOpacities[o.id]=item.opacity;if(item.lineWidth!=null)ovLineWidths[o.id]=item.lineWidth;if(item.timeSlice!=null)ovTimeSlices[o.id]=item.timeSlice}}
  alertPrefs=JSON.parse(JSON.stringify(state.alerts));syncAlertUI();ovApply();
  for(const item of state.overlays){
    const source=OVERLAYS.find(o=>o.id===item.id);
    if(source.needsProxy&&!PROXY)warnings.push(source.name+": a locally configured terrain engine is required.");
  }
}
function cspRestoreResearch(state,warnings){
  clearResearchLayers("");
  for(const snapshot of state.research.layers){
    const entry={...snapshot,overlay:null,url:"",legend:null,status:"ready",message:"",last:null};
    entry.style=CSPAnalysisLayers.normalizeStyle(snapshot.style,researchStyleDefaults(entry.product));
    researchStack.push(entry);researchSeq=Math.max(researchSeq,+entry.id.slice(1));
    if(snapshot.last){const last=snapshot.last;entry.last={...last,bounds:cspShareLatLngBounds(last.bounds),capture:{...last.capture,raster:{...last.capture.raster,bounds:cspShareLatLngBounds(last.capture.raster.bounds)}}};repaintResearch(entry)}
    else{entry.status="error";entry.message="The shared analysis had no completed raster.";warnings.push(researchLabel(entry)+": no completed analysis was available.")}
  }
  researchFocus=researchStack.at(-1)?.id||null;researchChanged();
}
async function cspRestoreImagery(state,warnings){
  if(state.imagery){
    // select() retains useful previous imagery until new rendered coverage is
    // ready. Replaying scene identity must never become a new best-photo search.
    MOSAIC_ON=false;$("#mosaic").checked=false;
    ITEMS=[state.imagery.primary,...state.imagery.neighbours];SEL=null;
    const previous=overlay;await select(0);
    $("#op").value=state.controls.op;
    const deadline=performance.now()+13500;
    while(overlayPending&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    if(!overlay||overlay===previous)warnings.push("The shared satellite scene is unavailable; previous useful imagery was kept.");
    else{
      for(const it of state.imagery.neighbours){
        const nb=await loadNeighbour(footprintKey(it),it,mosToken,true);
        if(nb)NEIGH.push(nb);else warnings.push("Shared surrounding scene unavailable: "+it.label+" · "+it.date.slice(0,10));
      }
      if(state.imagery.backdrop){const it=state.imagery.backdrop,nb=await loadNeighbour("shared-backdrop",it,mosToken,true);if(nb){nb.layer.setZIndex(150);MOSAIC_BACKDROP={...nb}}else warnings.push("The shared imagery backdrop is unavailable.")}
    }
    syncChecks();render();
  }else clearScene();
}
async function cspAwaitSharedOverlays(state,warnings){
  for(const item of state.overlays){
    const layer=ovLayers[item.id];if(!layer)continue;
    const deadline=performance.now()+16000;
    while(layer._cspLoading&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
    if(layer._cspError)warnings.push(OVERLAYS.find(o=>o.id===item.id).name+": "+layer._cspError);
    else if(layer._cspLoading)warnings.push(OVERLAYS.find(o=>o.id===item.id).name+": loading has not completed.");
  }
}
async function cspRestoreShareState(state){
  cspValidateShareState(state); // Complete validation precedes any map mutation.
  const warnings=[],B=window.ClearSkiesPortalBridge;
  // A search or Auto-fill queued by the previous view must not replace the
  // scene identities being restored. Ordinary map movement resumes Auto-fill.
  ++searchToken;searchAbort?.abort();searchAbort=null;
  clearTimeout(mosTimer);mosTimer=null;MOSAIC_ON=false;MOSAIC_ONCE=false;
  clearTimeout(researchLiveTimer);$("#researchLive").checked=false;
  pointCloudPanel?.close();if(map3d)exitTerrain3d();
  for(const [id,value] of Object.entries(state.controls)){const el=document.getElementById(id);if(el.type==="checkbox")el.checked=value;else el.value=value}
  const mosaicChoice=$("#mosaic").checked;$("#mosaic").checked=false;
  terrainLooks[$("#terStyle").value]={...state.terrainLook};
  if(state.studio){if(lidarStudio)lidarStudio.restoreDisplay(state.studio);else warnings.push("The shared terrain mix is unavailable in this renderer.")}
  syncTerrainLookControls();syncTerrainLighting();syncElevationFromControls();syncSpectrumPalette();syncElevSpanSlider();syncElevationChecks();
  PREV_DAYS=+$("#days").value;syncDateUI();syncChecks();
  setMapTheme(state.theme,false);
  await B.restoreSession({...state.view,mode:"2d"});
  // Imagery can move the camera, and overlays are not on the map yet. The
  // shell stays up until those are applied and the final camera is written.
  await cspRendererDecided;
  applyTerrain(true);applyElev();
  if(state.controls.terStyle!=="off"){
    const source=chooseTerrain(state.controls.terStyle);
    if(source.forced)warnings.push(source.reason);
    if(state.studio&&!gpuTerrainEnabled&&!CSPLidarRender.isLegacy(state.studio.state,state.controls.terStyle))warnings.push("The shared terrain mix needs the GPU terrain renderer, which is unavailable here.");
  }
  cspRestoreOverlays(state,warnings);
  if($("#fire").checked)loadFires(true);else clearFires();
  cspRestoreResearch(state,warnings);
  const markupIds=window.CSPMarkup?.restoreDisplay(state.markup)||{};
  if(state.markup.length&&!window.CSPMarkup)warnings.push("Shared annotations could not be loaded.");
  await cspRestoreImagery(state,warnings);
  if(state.view.mode==="3d")try{await B.restoreSession(state.view)}catch(error){warnings.push("3D view unavailable: "+error.message)}
  else{map.setView(state.view.center,state.view.zoom,{animate:false});map.setBearing?.(state.view.bearing)}
  if(state.pointCloud)try{await pointCloudPanel.restoreDisplay(state.pointCloud)}catch(error){warnings.push(error.message)}
  await cspAwaitSharedOverlays(state,warnings);
  // Overlays, imagery and the final camera are in place. The map pane can
  // leave the canvas colour, and the shell may fade in. A stalled link still
  // fades at the shell's 1.6 s cap, from index.html, not from here.
  cspMarkShareCamera();
  cspShareShown?.();
  const order=state.order.map(id=>markupIds[id]||id);
  localStorage.setItem("clearskies.active-layer-order.v1",JSON.stringify(order));cspSetLayerOrder(order);
  clearTimeout(researchLiveTimer);$("#researchLive").checked=state.research.live;
  clearTimeout(mosTimer);mosTimer=null;MOSAIC_ON=mosaicChoice;$("#mosaic").checked=mosaicChoice;syncChecks();
  announceLayers();
  const message=warnings.length?"Shared view is incomplete. "+warnings.join(" "):"Shared location and map layers restored.";
  statusEl.dataset.kind=warnings.length?"error":"general";statusEl.textContent=message;
  if(warnings.length)window.alert(message);
  return {complete:warnings.length===0,warnings};
}
Object.assign(window.ClearSkiesPortalBridge,{shareURL:cspShareURL,captureShareState:cspCaptureShareState,restoreShareState:cspRestoreShareState});
let cspShareReady=false,cspShareRunning=false,cspShareRequested,cspShareLast,cspShareShown=null,cspRendererReady;
const cspRendererDecided=new Promise(resolve=>cspRendererReady=resolve);
/* A shared link opens straight into its view. The shell's fade-in waits
   (for at most 1.6 s) until the link's overlays, imagery and final camera
   are applied. The map pane stays on the canvas colour until that same
   moment, or until the link fails, so the opening view cannot flash through.
   A restarted iOS session has the same hold: the map is created on North
   America, and the pane stays there until the saved camera is applied. */
var cspShareCameraPending=false;
try{cspShareCameraPending=new URLSearchParams(location.hash.slice(1)).has("csp")}catch(e){}
function cspMarkShareCamera(){cspShareCameraPending=false}
var cspNativeCameraPending=false;
try{cspNativeCameraPending=!!window.CSPNativeHost?.resume&&!cspShareCameraPending}catch(e){}
if(cspShareCameraPending&&window.CSPBoot)
  window.CSPBoot.hold=new Promise(resolve=>cspShareShown=()=>{cspShareShown=null;resolve()});
function cspReceiveShare(){
  const params=new URLSearchParams(location.hash.slice(1));
  if(!cspShareReady||!params.has("csp"))return;
  const payload=params.get("csp");
  if(payload===cspShareLast)return;
  cspShareLast=payload;cspShareRequested=payload;
  if(cspShareRunning)return;
  cspShareRunning=true;
  window.CSPShareRestore=(async()=>{
    let result;
    while(cspShareRequested!==undefined){
      const next=cspShareRequested;cspShareRequested=undefined;
      try{
        const state=await window.CSPShareState.decode(next);
        if(cspShareRequested!==undefined)continue;
        result=await cspRestoreShareState(state);
      }catch(error){
        const message="Unable to open shared view. "+error.message;
        statusEl.dataset.kind="error";statusEl.textContent=message;window.alert(message);
        result={complete:false,warnings:[message]};
      }
    }
    cspMarkShareCamera(); // a failed link must not keep the map on the canvas colour
    cspShareShown?.();
    cspShareRunning=false;return result;
  })();
}
document.documentElement.addEventListener("csp:ready",()=>{cspShareReady=true;cspReceiveShare()},{once:true});
addEventListener("hashchange",cspReceiveShare);
/* End CR-003 shared display state. */

// Fit only the new fresh default after the shell has established its layout.
// Existing cameras, share links and recovery never enter this path. On desktop
// reserve the open sidebar's area; native chrome floats over the full viewport.
document.documentElement.addEventListener("csp:ready", () => {
  if (!cspFreshView) return;
  const size = map.getSize();
  const left = !NATIVE_HOST && innerWidth > 760 && !document.body.classList.contains("collapsed")
    ? Math.min(size.x - 1, Math.max(0, sideEl.getBoundingClientRect().right)) : 0;
  const zoom = cspStartupZoom(size.x - left, size.y);
  map.setView(CSP_STARTUP_VIEW.center, zoom, {animate:false});
  if (left) map.panBy([-left / 2, 0], {animate:false});
}, {once:true});

/* Optional rendering starts in its own task once the shell is built. The
   shell stays hidden until the first map picture is ready (index.html waits
   on cspMapReady), so this work never runs under a visible fade. A
   device-specific GPU failure must never abort the shell's initialization. */
document.documentElement.addEventListener("csp:ready",()=>requestAnimationFrame(()=>{
  const begin=()=>{
    try{initGpuTerrain()}catch(error){
      gpuTerrainEnabled=false;
      try{gpuTerrainLayer?.destroy();gpuTerrainStore?.destroy()}catch(_){}
      gpuTerrainLayer=null;gpuTerrainStore=null;
      document.documentElement.dataset.gpu2d="off";lidarStudio?.refresh();
      console.warn("Terrain GPU unavailable; using the CPU renderer",error);
    }
    if(gpuTerrainLayer)gpuTerrainLayer.on("tilerefine",()=>{scheduleTerrainStatus();paintElevOut()});
    try{
      if($("#terStyle").value!=="off")applyTerrain(true);
      if(elevationActive())applyElev();else syncElevationChecks();
      cspStageFirstPicture();
    }catch(error){console.warn("Initial terrain rendering failed",error);cspReleaseMap()}
    /* Shared views wait for the renderer to be settled: a deferred GPU engine
       is either ready or has handed terrain to the CPU renderer. */
    const engine=gpuTerrainEnabled&&gpuTerrainLayer?.getEngine?.();
    if(engine&&!engine.ready){
      let settled=false;const settle=()=>{if(!settled){settled=true;cspRendererReady()}};
      gpuTerrainLayer.once("engineready",settle);gpuTerrainLayer.once("enginefailed",settle);
      // A driver that never finishes compiling must not leave terrain pending.
      setTimeout(()=>{
        if(!settled&&gpuTerrainEnabled&&gpuTerrainLayer?.getEngine?.()&&!gpuTerrainLayer.getEngine().ready)
          gpuTerrainFailedLate(new Error("GPU terrain start-up timed out"));
        settle();
      },8000);
    }else cspRendererReady();
  };
  /* The map is born on North America. A restarted session already has a
     camera: move there before the first picture can publish. A shared link
     owns the launch instead, and applies its own camera. */
  const resume=window.CSPNativeHost?.resume;
  const sharePending=typeof cspShareCameraPending!=="undefined"&&!!cspShareCameraPending;
  if(resume&&!sharePending){
    const restore=window.ClearSkiesPortalBridge?.restoreSession?.(resume);
    Promise.resolve(restore).then(()=>{cspNativeCameraPending=false;begin()},()=>{cspNativeCameraPending=false;begin()});
    return;
  }
  cspNativeCameraPending=false;
  begin();
}),{once:true});

/* The first map picture appears whole rather than tile by tile.
   csp-map-staging keeps the map pane (basemap, terrain, overlays) transparent
   and the shell waits on cspMapReady (index.html), so both appear in one fade.
   Map controls sit outside the pane. */
let cspMapShown;
const cspMapReady=new Promise(resolve=>cspMapShown=resolve);
if(window.CSPBoot)(window.CSPBoot.holds||(window.CSPBoot.holds=[])).push(cspMapReady);
function cspReleaseMap(){
  const root=document.documentElement;
  root.classList.remove("csp-map-staging");cspMapShown();
  if(!root.classList.contains?.("csp-terrain-pending"))globalThis.CSPBoot?.settlePicture?.();
}
/* Staging gives way only when the person takes the map. A tap on the dock,
   the sidebar toggle, or another control is not the map: Leaflet stops
   mousedown on those, but pointerdown still bubbles to this container.
   Programmatic camera moves keep waiting for the picture of the view they land on. */
function cspUserInput(fn,on){
  const el=map.getContainer();
  if(!fn._cspMapInput)fn._cspMapInput=event=>{
    if(event?.target?.closest?.("#mapDock,#sideToggle,#sideToggleDock,#pointCloudPanel,#mkCapture,button,a,input,textarea,select,label,.leaflet-control,.map-tool"))return;
    fn(event);
  };
  for(const name of ["pointerdown","wheel","keydown","touchstart"])
    on?el.addEventListener(name,fn._cspMapInput,{passive:true}):el.removeEventListener(name,fn._cspMapInput,{passive:true});
}
/* One coordinator for the first picture. Which renderer draws it settles over
   the first moments (a shared link's restored controls can add the GPU layer a
   frame after the GPU block; a late GPU failure hands terrain to the CPU
   renderer; WA DNR published hillshade is a CPU tile layer). Every 50 ms:
   terrain is ready when the GPU picture is covered and fitted, or when no CPU
   tile layer or terrain swap is busy; the basemap is ready when it has loaded
   its first view. A fresh visit also waits for Rivers & lakes. Release the
   map when those are ready (after a 200 ms grace). At the 1.5 s deadline an
   unfinished GPU picture hides itself. The pane stays on the canvas colour
   until that picture has published, or until CPU terrain tiles have finished,
   and until the basemap and a fresh visit's rivers are idle. A shared link
   keeps it there until the final camera is written, and a recovered session
   until its saved camera is applied. A picture deferred across that deadline
   publishes before the pane opens. The deadline itself does not open the pane:
   a camera that lands inside the 1.5 s window sets launchHold, and the poll
   stays armed until that resampled picture is ready. Taking the map shows
   everything at once.
   A picture that is still withheld after the shell is up keeps the recovery
   watch armed in index.html. */
/* After the first picture, one readback when the camera has been still names
   the frame that is actually on screen. It is never a synchronous read on the
   draw path, and it stays quiet while the first picture is still hidden. */
function cspWatchShownProvenance(layer){
  if(!layer||layer._cspProvenanceWatch)return;
  layer._cspProvenanceWatch=true;
  let reading=false,timer=0,ticket=0;
  layer.on("render",()=>{
    if(layer._cspHoldStill||document.documentElement.classList.contains("csp-terrain-pending"))return;
    clearTimeout(timer);const id=++ticket;
    timer=setTimeout(()=>{
      if(reading||id!==ticket)return;
      const engine=layer.getEngine?.();
      if(!engine?.readProvenance)return;
      reading=true;
      engine.readProvenance().then(result=>{
        reading=false;
        if(id!==ticket||!(result?.coverage>=.98)||!Object.values(result.ranks||{}).some(n=>n>0))return;
        layer.shownProvenance=result;scheduleTerrainStatus();
      }).catch(()=>{reading=false});
    },240);
  });
}
function startupCameraPending(){
  return (typeof cspShareCameraPending!=="undefined"&&!!cspShareCameraPending)
    ||(typeof cspNativeCameraPending!=="undefined"&&!!cspNativeCameraPending);
}
function cspStageFirstPicture(){
  let done=false,gpu=null;const started=performance.now();
  const cpuBusy=()=>!!terrainSwap||[terBase,terLayer,elevLayer].some(layer=>layer&&map.hasLayer(layer)&&layer.isLoading?.());
  const baseBusy=()=>!!(baseLayer&&map.hasLayer(baseLayer)&&baseLayer.isLoading?.());
  /* A new visit turns Rivers & lakes on before this gate. Those tiles are
     part of the first picture, same as the basemap. */
  const waterBusy=()=>{
    if(typeof cspFreshView==="undefined"||!cspFreshView)return false;
    if(typeof ovOn==="undefined"||!ovOn?.water)return false;
    const layer=typeof ovLayers!=="undefined"?ovLayers?.water:null;
    return !!(layer&&map.hasLayer(layer)&&layer.isLoading?.());
  };
  const stop=()=>{done=true;clearInterval(poll);clearTimeout(timer);cspUserInput(onInput,false)};
  const release=force=>{if(done||(!force&&startupCameraPending()))return;stop();cspReleaseMap()};
  const onInput=()=>{
    // A tap before the shared or recovered camera is written would uncover
    // North America, or an intermediate fitBounds, and then jump.
    if(startupCameraPending())return;
    gpu?.show();release(true);
  };
  const deadline=()=>{
    // Hide the unfinished hillshade. Opening the pane here shows the basemap
    // alone while that picture, or CPU terrain tiles, are still loading.
    gpu?.hideUntilReady();
    // A share can land inside this window. step() has set launchHold and
    // asked for a resample, or it is about to. release() would stop the poll,
    // so the pane would open on the basemap and never see that picture.
    if(gpu?.launchHold&&!gpu.ready)return;
  };
  const step=()=>{
    if(done)return;
    let pictureDue=false;
    if(gpu?.defer&&!startupCameraPending()){
      gpu.defer=false;gpu.launchHold=true;pictureDue=true;gpu.resample?.();
    }
    const gpuOn=gpuTerrainEnabled&&gpuTerrainLayer&&map.hasLayer(gpuTerrainLayer);
    if(gpu&&(!gpuOn||gpu.layer!==gpuTerrainLayer)){gpu.stop();gpu=null}
    if(gpuOn&&!gpu)gpu=cspGpuPicture(gpuTerrainLayer);
    const terrainReady=gpu?gpu.ready:!cpuBusy();
    // The deadline may already have hidden the terrain. The resampled picture
    // of the launch camera has to publish before the base map is uncovered.
    if(pictureDue||(gpu?.launchHold&&!terrainReady))return;
    if(!baseBusy()&&!waterBusy()&&performance.now()-started>=200&&terrainReady)release(false);
  };
  const poll=setInterval(step,50),timer=setTimeout(deadline,1500);
  cspUserInput(onInput,true);step();
}
/* The GPU picture is ready once one whole frame covers the view and its
   automatic colour ranges are fitted (the frame after the fit carries the
   fitted colours). That frame is copied from the WebGL canvas, the child of
   the layer container, and held until the view's own tiles settle. A copy
   taken before the fit lands is discarded. If the bitmap cannot be held, the
   picture waits for those tiles. Once they have settled, rank 0 is nodata, so
   a coast or any finished frame publishes even when the coarse sample is
   under 0.98. The loading announcement stays until the fade ends.
   Resident tile overlap is only a cheap precheck: a fenced readback checks
   valid pixels, so a sparse tile cannot count as a complete picture. */
function cspGpuPicture(layer){
  const el=layer.getContainer(),root=document.documentElement;
  const closeFit=beginStudioPublication();
  const picture={layer,ready:false,cover:null};
  let stopped=false,hidden=false,reading=false,fitting=false,fitted=false;
  let revision=0,viewKey="",latest=null,fitTimer=0,fitToken=0,retryTimer=0,fadeTimer=0;
  const motionStill=()=>root.classList.contains("csp-reduce-motion")||matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clearPending=()=>{
    root.classList.remove("csp-terrain-pending");scheduleTerrainStatus();
    if(!root.classList.contains?.("csp-map-staging"))globalThis.CSPBoot?.settlePicture?.();
  };
  /* One rank covering the frame is one picture. A second rank that is more
     than a sliver is a finer tile arriving through the overview. */
  const onePicture=result=>{
    const counts=Object.values(result?.ranks||{}).filter(n=>n>0);
    if(!counts.length)return false;
    const total=counts.reduce((sum,n)=>sum+n,0);
    return total>0&&Math.max(...counts)/total>=.98;
  };
  const ownTilesSettled=()=>{
    if(typeof layer.settled!=="function")return true;
    const status=layer.settled();
    return !!status?.total&&!status.refining;
  };
  /* The container is a transformed div. The bitmap is its canvas child. */
  function frameCanvas(){
    const canvas=el?.querySelector?.("canvas");
    return canvas&&canvas.width>0?canvas:null;
  }
  /* Copy once, in this turn, while the WebGL buffer still holds the frame.
     A readback runs after the browser has cleared that buffer, so it cannot
     take the still itself. The pre-fit stretch is the wrong picture. */
  /* Water and a cleared buffer are transparent in the middle. A coast still
     has shore somewhere in the frame, so look past the center before deciding
     the copy is empty. An empty copy does not latch the view: the next draw
     can hold the hillshade once it has ink. */
  function frameHasInk(ctx,width,height){
    const n=8,places=[
      [0,0],[width-n,0],[0,height-n],[width-n,height-n],
      [(width>>1)-(n>>1),(height>>1)-(n>>1)],
      [width>>2,height>>2],[(width*3)>>2,height>>2],
      [width>>2,(height*3)>>2],[(width*3)>>2,(height*3)>>2]
    ];
    for(const [sx,sy] of places){
      const x=Math.max(0,Math.min(width-1,sx|0)),y=Math.max(0,Math.min(height-1,sy|0));
      const w=Math.min(n,width-x),h=Math.min(n,height-y);
      if(w<1||h<1)continue;
      const data=ctx.getImageData(x,y,w,h).data;
      for(let i=0;i<data.length;i++)if(data[i])return true;
    }
    return false;
  }
  function rememberFrame(){
    if(picture.still||picture.ready||picture.cover)return;
    if(lidarStudio?.needsFit?.()&&!fitted)return;
    if(ownTilesSettled()||picture.snapKey===viewKey)return;
    if(!(latest?.coverage?.coverage>=.98))return;
    const canvas=frameCanvas();
    if(typeof document?.createElement!=="function"||!canvas?.parentNode)return;
    const copy=document.createElement("canvas");
    copy.width=canvas.width;copy.height=canvas.height;
    let ink=false;
    try{
      const ctx=copy.getContext("2d");
      ctx.drawImage(canvas,0,0);
      ink=frameHasInk(ctx,copy.width,copy.height);
    }catch(e){return}
    if(!ink)return;
    picture.snapKey=viewKey;
    picture.still=copy;picture.stillRevision=revision;
  }
  /* The old hillshade cannot stay on a new place. Drop it at once; the
     settled fade is only for the same view. */
  function dropHeldStill(){
    const cover=picture.cover;
    if(!cover)return;
    picture.cover=null;layer._cspHoldStill=false;
    cover.remove?.();
    const canvas=frameCanvas();
    if(canvas){canvas.style.transition="none";canvas.style.opacity=""}
    el.style.transition="none";el.style.opacity="";
  }
  /* Keep that still inside the transformed container, over the live canvas.
     Finer tiles draw underneath it, and it fades away once they have settled. */
  function holdShownPicture(){
    if(picture.cover)return true;
    const copy=picture.still,host=frameCanvas()?.parentNode;
    if(!copy||!host?.appendChild)return false;
    picture.still=null;
    copy.className="csp-gpu-terrain-hold";copy.setAttribute("aria-hidden","true");
    copy.style.cssText="position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;opacity:0";
    host.appendChild(copy);picture.cover=copy;layer._cspHoldStill=true;
    const heldKey=viewKey;
    const reveal=event=>{
      if(stopped||picture.cover!==copy)return;
      if(JSON.stringify(event?.view||{})!==heldKey){dropHeldStill();layer.off("render",reveal);return}
      if(layer.settled?.()?.refining)return;
      picture.cover=null;layer._cspHoldStill=false;layer.off("render",reveal);
      const canvas=frameCanvas();
      if(canvas){canvas.style.transition="none";canvas.style.opacity=""}
      el.style.transition="none";el.style.opacity="";
      const engine=layer.getEngine?.();
      engine?.readProvenance?.().then(next=>{
        if(stopped||!next?.ranks)return;
        layer.shownProvenance=next;scheduleTerrainStatus();
      }).catch(()=>{});
      if(motionStill()){copy.remove();return}
      copy.style.transition="opacity .32s cubic-bezier(.2,.7,.2,1)";copy.style.opacity="0";
      setTimeout(()=>copy.remove(),320);
    };
    layer.on("render",reveal);
    return true;
  }
  function commitFrame(result){
    if(!ownTilesSettled()){
      if(!onePicture(result)||!holdShownPicture())return false;
    }else picture.still=null;
    if(result?.ranks)layer.shownProvenance=result;
    return true;
  }
  const fadeIn=()=>{
    const still=motionStill(),cover=picture.cover;
    if(!hidden&&!cover){clearPending();return}
    hidden=false;
    if(cover){
      /* The still lives in the container, so the container has to show.
         Only the live canvas stays hidden until the view's own tiles settle. */
      const canvas=frameCanvas();
      if(canvas){canvas.style.transition="none";canvas.style.opacity="0"}
      el.style.transition="none";el.style.opacity="";
      if(still){cover.style.opacity="1";clearPending();return}
      clearTimeout(fadeTimer);
      fadeTimer=setTimeout(()=>{
        if(stopped||picture.cover!==cover){clearPending();return}
        cover.style.transition="opacity .32s cubic-bezier(.2,.7,.2,1)";cover.style.opacity="1";
        fadeTimer=setTimeout(clearPending,320);
      },0);
      return;
    }
    el.style.transition=still?"none":"opacity .32s cubic-bezier(.2,.7,.2,1)";el.style.opacity="";
    if(still)clearPending();
    else{clearTimeout(fadeTimer);fadeTimer=setTimeout(()=>{el.style.transition="none";clearPending()},320)}
  };
  const detach=(freeze)=>{layer.off("render",check);layer.off("remove",picture.stop);clearTimeout(fitTimer);clearTimeout(retryTimer);fitToken++;closeFit(freeze===true);cspUserInput(finish,false);root.removeEventListener("csp:reveal",onShell)};
  function finish(force){
    if(picture.ready||stopped)return;
    // The camera in this frame may be the placeholder or the pre-imagery
    // share view. Keep listening until the launch camera is the one on screen.
    if(force!==true&&typeof startupCameraPending==="function"&&startupCameraPending()){picture.defer=true;return}
    const freeze=fitted||!lidarStudio?.needsFit();
    picture.ready=true;picture.defer=false;detach(freeze);fadeIn();
    if(typeof cspWatchShownProvenance==="function")cspWatchShownProvenance(layer);
  }
  picture.resample=()=>{if(!stopped&&!picture.ready&&!reading&&!fitting)sample()};
  function check(event){
    const key=JSON.stringify(event.view);
    const viewChanged=key!==viewKey;
    if(viewChanged){viewKey=key;fitted=false;fitting=false;fitToken++;clearTimeout(fitTimer);picture.still=null;picture.snapKey="";dropHeldStill()}
    // The unfitted stretch cannot be shown. Redrawing it is not a new frame,
    // and counting it would keep Reload from appearing while the hillshade stays hidden.
    const canPublish=fitted||!lidarStudio?.needsFit?.();
    if(!picture.ready&&(viewChanged||canPublish))globalThis.CSPBoot?.notePictureProgress?.();
    latest=event;revision++;rememberFrame();sample();
  }
  function sample(){
    if(stopped||picture.ready||reading||fitting||!(latest?.coverage?.coverage>0))return;
    clearTimeout(retryTimer);retryTimer=0;
    const engine=layer.getEngine(),ticket=revision,key=viewKey;
    if(!engine?.readProvenance)return;
    reading=true;
    engine.readProvenance().then(result=>{
      reading=false;
      if(stopped||picture.ready)return;
      if(ticket!==revision){
        // A later draw may already be mixing in finer tiles. The still taken
        // with this read is the whole picture those tiles would break up.
        if(picture.still&&picture.stillRevision===ticket&&result.coverage>=.98&&!ownTilesSettled()&&onePicture(result)&&(fitted||!lidarStudio?.needsFit())&&holdShownPicture()){
          if(result?.ranks&&Object.values(result.ranks).some(n=>n>0))layer.shownProvenance=result;
          finish();return;
        }
        sample();return;
      }
      // Rank 0 is both "not drawn yet" and real nodata. Only a settled view
      // can tell them apart, so a short sample waits for the next frame
      // instead of being read again until it clears 0.98.
      const settledReport=typeof layer.settled==="function"&&!!layer.settled()?.total&&!layer.settled().refining;
      if(!(result.coverage>=.98)&&!settledReport)return;
      // An overview with a few finer tiles in it is not a picture yet. A whole
      // overview can publish only when that bitmap is held for one later fade.
      if(result.coverage>=.98&&!ownTilesSettled()&&!onePicture(result))return;
      if(fitted||!lidarStudio?.needsFit()){if(!commitFrame(result))return;finish();return}
      // A missed colour range is not the picture. Keep fitting so a slow
      // readback can still land. Never publish or freeze the default stretch.
      fitting=true;const token=++fitToken;
      const current=()=>!stopped&&!picture.ready&&token===fitToken&&key===viewKey;
      const landed=changed=>{
        if(!current())return;
        clearTimeout(fitTimer);fitToken++;fitting=false;
        if(!changed){
          // A missed fit must not mark the picture fitted or freeze this camera.
          clearTimeout(retryTimer);
          retryTimer=setTimeout(()=>{retryTimer=0;if(!stopped&&!picture.ready&&!reading&&!fitting)sample()},400);
          return;
        }
        fitted=true;
        // The pre-fit snapshot is the wrong still. The redraw is the frame to copy.
        picture.still=null;picture.snapKey="";
        layer.redraw();
      };
      fitTimer=setTimeout(()=>landed(false),600);
      fitStudio(current).then(landed,()=>landed(false));
    }).catch(()=>{
      reading=false;
      if(stopped||picture.ready)return;
      if(ticket!==revision){sample();return}
      // A fence timeout does not itself render again. Retry the same frame
      // once the GPU is quiet, without ever publishing the failed read.
      clearTimeout(retryTimer);
      retryTimer=setTimeout(()=>{retryTimer=0;if(!stopped&&!picture.ready&&ticket===revision&&!reading&&!fitting)sample()},400);
    });
  }
  picture.hideUntilReady=()=>{
    if(picture.ready||stopped||hidden)return;
    hidden=true;el.style.transition="none";el.style.opacity="0";
    root.classList.add("csp-terrain-pending");scheduleTerrainStatus();
    cspUserInput(finish,true);
  };
  // The shell can appear (its 1.6 s cap) before the 1.5 s deadline fires.
  function onShell(){picture.hideUntilReady()}
  picture.show=()=>finish(true);
  picture.stop=()=>{
    if(stopped)return;stopped=true;clearTimeout(fadeTimer);
    const cover=picture.cover;picture.cover=null;layer._cspHoldStill=false;cover?.remove?.();
    const canvas=frameCanvas();if(canvas){canvas.style.transition="none";canvas.style.opacity=""}
    detach(false);if(hidden){hidden=false;el.style.opacity=""}
    clearPending();
  };
  layer.on("render",check);layer.on("remove",picture.stop);root.addEventListener("csp:reveal",onShell,{once:true});
  return picture;
}
/* The shell's visible icons arrive with it (bounded by the same cap). */
if(window.CSPBoot)window.CSPBoot.holds.push(new Promise(resolve=>{
  document.documentElement.addEventListener("csp:ready",()=>{
    const icons=[...document.querySelectorAll("#app img")].filter(img=>img.getClientRects().length&&!img.complete);
    Promise.all(icons.map(img=>img.decode?img.decode().catch(()=>{}):Promise.resolve())).then(resolve);
  },{once:true});
}));

if("serviceWorker" in navigator && (location.protocol==="https:" || location.hostname==="localhost"))
  addEventListener("load",()=>navigator.serviceWorker.register("sw.js",{updateViaCache:"none"})
    .then(watchForNewBuild).catch(()=>{}));

/* Telling someone a fix is deployed is not the same as them having it.
   Same-origin assets are served cache-first, and the worker calls skipWaiting()
   in install - so a new build takes over the controller while the page that is
   already open keeps running the old HTML and scripts, with nothing said. On an
   installed standalone PWA it is worse: the page can sit in the background for
   days without a navigation, so the update check never even runs, and the only
   way through is to know to force-quit the app. Nobody should have to know that.

   controllerchange is the right signal precisely because of skipWaiting: the
   worker never rests in `waiting`, it activates and claims immediately. The
   guard on the previous controller is what separates an update from the first
   worker ever taking control, which is not something to interrupt anyone for. */
function watchForNewBuild(registration){
  if(!registration) return;
  let hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(hadController) offerNewBuild();
    hadController=true;
  });
  registration.addEventListener("updatefound",()=>{
    const incoming=registration.installing;
    incoming?.addEventListener("statechange",()=>{
      if(incoming.state==="installed"&&navigator.serviceWorker.controller) offerNewBuild();
    });
  });
  /* A backgrounded PWA makes no navigations, so ask on the way back in. */
  const recheck=()=>{ if(!document.hidden) registration.update().catch(()=>{}) };
  document.addEventListener("visibilitychange",recheck);
  addEventListener("focus",recheck);
}
function offerNewBuild(){
  if(document.getElementById("newBuild")) return;
  const bar=document.createElement("div");
  bar.id="newBuild";bar.setAttribute("role","status");
  bar.innerHTML='<span>A new build is ready.</span>'+
    '<button type="button" id="newBuildReload">Reload</button>'+
    '<button type="button" id="newBuildLater" aria-label="Dismiss">&times;</button>';
  document.getElementById("app").appendChild(bar);
  document.getElementById("newBuildReload").onclick=()=>location.reload();
  document.getElementById("newBuildLater").onclick=()=>bar.remove();
}

/* Desktop cursor readout and keys use the same geographic grids and color
   definitions as the map. Camera exports freeze this model once per save. */
