function cspActiveLayers(){
  const layers=[];
  if(overlay||overlayPending||footprint){
    layers.push({id:"scene",name:$("#ctlName").textContent||"Satellite scene",
      meta:[$("#ctlDate").textContent,"Satellite imagery"].filter(Boolean).join(" · "),
      opacity:+$("#op").value,visible:+$("#op").value>0,kind:"imagery"});
  }
  if($("#terStyle").value!=="off"){
    layers.push({id:"terrain",name:$("#terStyle").selectedOptions[0]?.textContent||"Terrain",
      meta:`${$("#terSrc").selectedOptions[0]?.textContent||"Best available"} · LiDAR`,
      opacity:+$("#terOp").value,visible:true,kind:"terrain"});
  }
  if($("#elevSh").checked){
    layers.push({id:"elevation-spectrum",name:"Elevation spectrum",
      meta:`Reference ${$("#elevVal").value} ${$("#elevUnit").value} · span ${$("#elevSpan").value} ft`,
      opacity:+$("#elevAlpha").value,visible:true,kind:"analysis"});
  }
  if($("#elevBelowOn").checked||$("#elevAboveOn").checked){
    layers.push({id:"elevation-bands",name:"Elevation highlights",
      meta:"Below / above range shading · Elevation",
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
  syncTerrainLookControls();syncTerrainLighting();syncSpectrumPalette();syncElevSpanSlider();syncElevationChecks();
  PREV_DAYS=+$("#days").value;syncDateUI();syncChecks();
  setMapTheme(state.theme,false);
  await B.restoreSession({...state.view,mode:"2d"});
  // Theme, controls and camera are in place: the shell may now fade in.
  cspShareShown?.();
  // Terrain layers and the GPU warning below depend on the renderer, which
  // start-up decides once the shell has faded in.
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
/* A shared link opens straight into its view: index.html holds the shell's
   fade-in (for at most 1.5 s) until the link's theme and camera are applied. */
if(new URLSearchParams(location.hash.slice(1)).has("csp")&&window.CSPBoot)
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
    cspShareShown?.();   // a failed link must not keep the shell hidden
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
}),{once:true});

/* The first map picture appears whole rather than tile by tile.
   csp-map-staging keeps the map pane (basemap, terrain, overlays) transparent
   and the shell waits on cspMapReady (index.html), so both appear in one fade.
   Map controls sit outside the pane. */
let cspMapShown;
const cspMapReady=new Promise(resolve=>cspMapShown=resolve);
if(window.CSPBoot)(window.CSPBoot.holds||(window.CSPBoot.holds=[])).push(cspMapReady);
function cspReleaseMap(){document.documentElement.classList.remove("csp-map-staging");cspMapShown()}
/* Staging gives way only when the person takes the map. Programmatic camera
   moves (a shared link's view, the fresh-view fit) keep it waiting for the
   picture of the view they land on. */
function cspUserInput(fn,on){
  const el=map.getContainer();
  for(const name of ["pointerdown","wheel","keydown","touchstart"])
    on?el.addEventListener(name,fn,{passive:true}):el.removeEventListener(name,fn,{passive:true});
}
/* One coordinator for the first picture. Which renderer draws it settles over
   the first moments (a shared link's restored controls can add the GPU layer a
   frame after the GPU block; a late GPU failure hands terrain to the CPU
   renderer; WA DNR published hillshade is a CPU tile layer). Every 50 ms:
   terrain is ready when the GPU picture is covered and fitted, or when no CPU
   tile layer or terrain swap is busy; the basemap is ready when it has loaded
   its first view. Release the map when both are (after a 200 ms grace). At the
   1.5 s deadline the map is shown anyway, but an unfinished GPU picture stays
   hidden on its own and fades in whole when it is ready. Taking the map shows
   everything at once. */
function cspStageFirstPicture(){
  let done=false,gpu=null;const started=performance.now();
  const cpuBusy=()=>!!terrainSwap||[terBase,terLayer,elevLayer].some(layer=>layer&&map.hasLayer(layer)&&layer.isLoading?.());
  const baseBusy=()=>!!(baseLayer&&map.hasLayer(baseLayer)&&baseLayer.isLoading?.());
  const stop=()=>{done=true;clearInterval(poll);clearTimeout(timer);cspUserInput(onInput,false)};
  const release=()=>{if(done)return;stop();cspReleaseMap()};
  const onInput=()=>{gpu?.show();release()};
  const deadline=()=>{gpu?.hideUntilReady();release()};
  const step=()=>{
    if(done)return;
    const gpuOn=gpuTerrainEnabled&&gpuTerrainLayer&&map.hasLayer(gpuTerrainLayer);
    if(gpu&&(!gpuOn||gpu.layer!==gpuTerrainLayer)){gpu.stop();gpu=null}
    if(gpuOn&&!gpu)gpu=cspGpuPicture(gpuTerrainLayer);
    const terrainReady=gpu?gpu.ready:!cpuBusy();
    if(terrainReady&&!baseBusy()&&performance.now()-started>=200)release();
  };
  const poll=setInterval(step,50),timer=setTimeout(deadline,1500);
  cspUserInput(onInput,true);step();
}
/* The GPU picture is ready once the terrain covers the view and its automatic
   colour ranges are fitted (the frame after the fit carries the fitted
   colours, so the picture does not re-colour after it appears). If the map
   had to be shown first, the terrain canvas waits hidden and fades in whole
   when ready, at the latest 8 s later. */
function cspGpuPicture(layer){
  const el=layer.getContainer(),root=document.documentElement;
  const picture={layer,ready:false};
  let phase="cover",stopped=false,hidden=false,cap=0;
  const fadeIn=()=>{
    if(!hidden)return;hidden=false;
    const still=root.classList.contains("csp-reduce-motion")||matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.style.transition=still?"none":"opacity .32s cubic-bezier(.2,.7,.2,1)";el.style.opacity="";
    if(!still)setTimeout(()=>{el.style.transition="none"},400);
  };
  const detach=()=>{layer.off("render",check);clearTimeout(cap);cspUserInput(finish,false);root.removeEventListener("csp:reveal",onShell)};
  function finish(){if(picture.ready||stopped)return;picture.ready=true;detach();fadeIn()}
  function check(event){
    if(phase==="refitted"){finish();return}
    if(phase!=="cover"||!(event.coverage?.coverage>=.98))return;
    if(!lidarStudio?.needsFit()){finish();return}
    phase="fitting";
    const fallback=setTimeout(finish,600);   // a fenced readback, bounded
    // Once the picture is out (cap, input), a late fit is dropped.
    fitStudio(()=>!picture.ready&&!stopped)
      .then(refit=>{if(refit)phase="refitted";else{clearTimeout(fallback);finish()}})   // a refit re-renders; that frame finishes
      .catch(error=>{console.warn("Initial range fit failed",error);clearTimeout(fallback);finish()});
  }
  picture.hideUntilReady=()=>{
    if(picture.ready||stopped||hidden)return;
    hidden=true;el.style.transition="none";el.style.opacity="0";
    cspUserInput(finish,true);cap=setTimeout(finish,8000);
  };
  // The shell can appear (its 1.6 s cap) before the 1.5 s deadline fires.
  function onShell(){picture.hideUntilReady()}
  picture.show=finish;
  picture.stop=()=>{if(stopped)return;stopped=true;detach();if(hidden){hidden=false;el.style.opacity=""}};
  layer.on("render",check);root.addEventListener("csp:reveal",onShell,{once:true});
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
