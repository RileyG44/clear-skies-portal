const ELEV_UNIT={m:1, ft:0.3048, yd:0.9144};
let elevLayer=null;
/* The spectrum and the below/above highlights for one tile of heights, as
   straight (not premultiplied) RGBA. The 2D layer's CPU path and the 3D
   drape both color through here, so the two views cannot disagree. `stride`
   and `offset` let the 3D path read the 256x256 interior of a skirted 258
   grid in place. */
function elevationColours(elev,count,settings,out,width=count,stride=width,offset=0){
  return CSPTerrainDrape.elevationColours(elev,count,settings,out,width,stride,offset);
}
function elevMetres(){ return (+$("#elevVal").value||0) * ELEV_UNIT[$("#elevUnit").value] }
// Both the menu and map panel use the same logarithmic span range.
function elevSpanPosition(feet){
  return Math.round(Math.log(Math.max(10,Math.min(20000,+feet||300))/10)/Math.log(2000)*1000);
}
function elevSpanFromPosition(position){
  const feet=Math.exp(Math.log(10)+Math.max(0,Math.min(1000,+position))/1000*Math.log(2000));
  const preset=[50,150,300,600,1200,2500].find(value=>Math.abs(feet-value)/value<.025);
  return preset||Math.round(feet);
}
function syncElevSpanSlider(){
  const input=$("#elevSpanSlide"),feet=Math.max(10,Math.min(20000,+$("#elevSpan").value||300));
  if(document.activeElement!==input)input.value=elevSpanPosition(feet);
  input.setAttribute("aria-valuetext",feet.toLocaleString()+" feet");
}
function elevSpanMetres(){ return Math.max(3,(+$("#elevSpan").value||300)*0.3048) }
function inputPercent(id,fallback){
  const value=+$(id).value;
  return Math.max(0,Math.min(100,Number.isFinite(value)?value:fallback));
}
function elevAlpha(){ return Math.round(255*inputPercent("#elevAlpha",48)/100) }
function elevationBandState(){
  const opacity=inputPercent("#elevBandAlpha",52)/100;
  const feather=Math.max(0,+$("#elevBandFeather").value||0);
  const outline={enabled:$("#elevBandOutline").checked,color:"#ffffff",opacity:.88,width:8,unit:"ft"};
  return ElevationBands.sanitizeState({unit:"ft",bands:[
    {id:"below",label:"Below elevation",enabled:$("#elevBelowOn").checked,operator:"below",
     max:+$("#elevBelowVal").value||0,unit:"ft",color:$("#elevBelowColor").value,
     opacity,feather,outline,order:0},
    {id:"above",label:"Above elevation",enabled:$("#elevAboveOn").checked,operator:"above",
     min:+$("#elevAboveVal").value||0,unit:"ft",color:$("#elevAboveColor").value,
     opacity,feather,outline,order:1}
  ]},{defaults:false,defaultUnit:"ft"});
}
function restoreElevationBands(saved){
  if(!saved) return;
  const state=ElevationBands.sanitizeState(saved,{defaults:false,defaultUnit:"ft"});
  const byId=Object.fromEntries(state.bands.map(b=>[b.id,b]));
  const below=byId.below,above=byId.above;
  if(below){
    $("#elevBelowOn").checked=!!below.enabled; $("#elevBelowColor").value=below.color.slice(0,7);
    $("#elevBelowVal").value=Math.round(ElevationBands.fromMeters(below.maxM,"ft"));
  }
  if(above){
    $("#elevAboveOn").checked=!!above.enabled; $("#elevAboveColor").value=above.color.slice(0,7);
    $("#elevAboveVal").value=Math.round(ElevationBands.fromMeters(above.minM,"ft"));
  }
  const exemplar=below||above;
  if(exemplar){
    $("#elevBandAlpha").value=Math.round(exemplar.opacity*100);
    $("#elevBandFeather").value=Math.round(ElevationBands.fromMeters(exemplar.featherM,"ft"));
    $("#elevBandOutline").checked=!!(exemplar.outline&&exemplar.outline.enabled);
  }
}
function elevationRenderSettings(){
  const state=elevationBandState(),byId=Object.fromEntries(state.bands.map(b=>[b.id,b]));
  const below=byId.below,above=byId.above;
  const rgb=band=>(band.rgba||ElevationBands.parseColor(band.color)).slice(0,3).map(v=>v/255);
  return {spectrumOn:$("#elevSh").checked,level:elevMetres(),span:elevSpanMetres(),
    spectrumAlpha:elevAlpha()/255,
    spectrumLow:ElevationBands.parseColor($("#elevLowColor").value).slice(0,3),
    spectrumMid:ElevationBands.parseColor($("#elevMidColor").value).slice(0,3),
    spectrumHigh:ElevationBands.parseColor($("#elevHighColor").value).slice(0,3),
    below:{enabled:!!(below&&below.enabled),level:below?below.maxM:0,color:below?rgb(below):[1,0,0]},
    above:{enabled:!!(above&&above.enabled),level:above?above.minM:0,color:above?rgb(above):[0,0,1]},
    bandAlpha:inputPercent("#elevBandAlpha",52)/100,
    bandFeather:Math.max(0,(+$("#elevBandFeather").value||0)*0.3048),
    outline:$("#elevBandOutline").checked,outlineWidth:8*0.3048,
    bandCompiled:ElevationBands.compileBands(state)};
}
function elevationActive(){
  return $("#elevSh").checked||$("#elevBelowOn").checked||$("#elevAboveOn").checked;
}
function syncElevationChecks(){
  for(const [input,label] of [["#elevSh","#lb_elevSh"],["#elevBelowOn","#lb_elevBelow"],
    ["#elevAboveOn","#lb_elevAbove"],["#elevBandOutline","#lb_elevBandOutline"]])
    $(label).classList.toggle("on",$(input).checked);
}
function paintElevOut(){
  const o=$("#elevOut"); if(!o) return;
  const m=elevMetres();
  if(!$("#elevSh").checked){ o.textContent=""; return }
  const loaded=terrainLayerSummary(elevLayer);
  const source=loaded.sources.length?`Displayed: ${loaded.sources.map(s=>s.label).join(" + ")}.`:'Elevation is loading; source details appear after tiles render.';
  o.textContent=`Reference at ${Math.round(m/0.3048).toLocaleString()} ft; selected colors below and above, strongest by \u00b1${Math.round(elevSpanMetres()/0.3048).toLocaleString()} ft at ${$("#elevAlpha").value}% opacity. ${source}`;
}
function paintElevationBandOut(){
  const out=$("#elevBandOut"),parts=[];
  if($("#elevBelowOn").checked) parts.push(`below ${(+$("#elevBelowVal").value||0).toLocaleString()} ft`);
  if($("#elevAboveOn").checked) parts.push(`above ${(+$("#elevAboveVal").value||0).toLocaleString()} ft`);
  out.textContent=parts.length
    ? `Highlighting ${parts.join(" and ")} with ${(+$("#elevBandFeather").value||0).toLocaleString()} ft soft transitions. Colors update as you adjust the controls.`
    : "Enable a below or above band to highlight ground at those heights.";
}
let elevPaintFrame=0;
function scheduleElevPaint(){
  if(gpuTerrainEnabled)syncGpuTerrain();
  if(elevPaintFrame) return;
  elevPaintFrame=requestAnimationFrame(()=>{ elevPaintFrame=0; applyElev() });
}
function syncElevFromSlider(){
  const m=+$("#elevSlide").value;
  const u=ELEV_UNIT[$("#elevUnit").value];
  $("#elevVal").value = Math.round(m/u);
  scheduleElevPaint();
}
function syncElevFromBox(){
  const m=elevMetres();
  $("#elevSlide").value = Math.max(-500, Math.min(4500, Math.round(m)));
  scheduleElevPaint();
}
function applyElev(){
  paintElevOut();
  paintElevationBandOut(); syncElevationChecks();
  const on=elevationActive();
  if(gpuTerrainEnabled){syncGpuTerrain();scheduleTerrainStatus();sync3dSpectrum();return;}
  if(!on){
    if(elevLayer){ map.removeLayer(elevLayer); elevLayer=null }
    sync3dSpectrum();
    return;
  }
  const render=elevationRenderSettings();
  if(!elevLayer){
    elevLayer=new ElevLayer({...elevationSourceOptions(),
                             fallbackNativeZoom:15,nationalNativeZoom:17,render,maxZoom:VIEW_MAX,maxNativeZoom:TERRAIN_OVERZOOM,rawNativeZoom:18,
                             zIndex:450,keepBuffer:1,updateWhenIdle:true,updateWhenZooming:false,maxRetries:0});
    elevLayer.on("tileload tilerefine tileerror load",()=>{scheduleTerrainStatus();paintElevOut()});
    elevLayer.addTo(map);
  }else{
    elevLayer.setSourceOptions(elevationSourceOptions());
    elevLayer.setRender(render);
  }
  scheduleTerrainStatus();
  sync3dSpectrum();
}
/* In 3D, a spectrum setting swaps the drape's tile URL (the cached heights
   are recoloured, nothing is refetched); turning it on or off, or changing
   what it sits on, rebuilds the style. */
let elev3dTimer=0;
function sync3dSpectrum(){
  clearTimeout(elev3dTimer);
  if(!map3d) return;
  if(gpu3d?.enabled&&apply3dLighting())return;
  elev3dTimer=setTimeout(()=>{
    if(!map3d) return;
    // A legacy timer can outlive initial style loading or GPU activation.
    // Never replace resident GPU URLs with CPU spectrum URLs when it fires.
    if(gpu3d?.enabled){if(!apply3dLighting())schedule3dStyle();return;}
    if(map3dBuiltKey!==map3dStructureKey()){ refresh3dStyle();return }
    const source=map3d.getSource?.("elevspec");
    if(source?.setTiles) source.setTiles([`cspelev://s/{z}/{x}/{y}.png?r=${++elevSpectrumRevision}`]);
  },140);
}

/* Numbers for what an aspect map only suggests. Everything here is measured
   over the current view; the band matters, because unbanded "fabric" is mostly
   the drainage grain of ordinary topography. */
const fabOut=()=>document.getElementById("fabOut");
function fabRow(k,v,cls){ return `<div class="fr"><span class="fk">${k}</span><span class="fv ${cls||""}">${v}</span></div>` }
async function runFabric(){
  const el=fabOut(); if(!el) return;
  if(!PROXY){ el.innerHTML='<span class="warn">Needs the LiDAR server.</span>'; return }
  const b=map.getBounds();
  const [lo,hi]=$("#fabBand").value.split(",");
  el.innerHTML='<span class="spin"></span> measuring\u2026';
  let j;
  try{
    const view=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
    // The DNR fabric sampler masks each sample to fetched areas and fills
    // the rest from USGS, so a partly-overlapping view is safe to measure.
    const dnr=dnrElevationAvailable()&&dnrAreas.some(a=>bboxIntersects(view,a.bbox));
    const path=dnr?"/api/wadnr/fabric":"/api/usgs/fabric";
    const areas=dnr?`&areas=${encodeURIComponent(JSON.stringify(dnrAreas.map(a=>a.bbox)))}`:"";
    const r=await fetch(api(`${path}?bbox=${view.map(v=>v.toFixed(5)).join(",")}&lo=${lo}&hi=${hi}&strict=0${areas}`));
    j=await r.json();
  }catch(e){ el.innerHTML='<span class="warn">Measurement failed.</span>'; return }
  if(!j.ok){ el.innerHTML=`<span class="warn">${j.reason||"no result"}</span>`; return }
  const g=j.grain, sl=j.slope, tr=j.transport;
  const strength = g.anisotropyPct>=6 ? "strong" : g.anisotropyPct>=3 ? "moderate" : "weak";
  /* Loose granular material cannot stand past its angle of repose, so a hard
     ceiling near 34 deg says sand where anything cohesive would show scarps. */
  const capped = sl.pctOver36 < 0.05;
  let note = capped
    ? `Slopes stop at ${sl.max}\u00b0 with ${sl.pctOver36}% steeper than 36\u00b0 \u2014 an angle-of-repose ceiling, as loose granular material gives.`
    : `${sl.pctOver36}% of slopes exceed 36\u00b0 (max ${sl.max}\u00b0) \u2014 steeper than loose material holds, so cohesive ground, rock or cut faces.`;
  if(tr.concentration < 0.35) note += " Steep faces point every which way, so the direction below is not well determined.";
  el.innerHTML =
    fabRow("Grain trend", g.trendDeg+"\u00b0 / "+((g.trendDeg+180)%360)+"\u00b0")
  + fabRow("Anisotropy", g.anisotropyPct+"% ("+strength+", isotropic "+g.isotropicPct+"%)")
  + fabRow("Grain relief", Math.round(g.amplitudeRms*3.28084)+" ft RMS in "+Math.round(j.band[0]*3.28084)+"\u2013"+Math.round(j.band[1]*3.28084)+" ft")
  + fabRow("Local relief", Math.round(j.elevation.relief*3.28084).toLocaleString()+" ft")
  + fabRow("Slope p50 / p95 / max", sl.p50+"\u00b0 / "+sl.p95+"\u00b0 / "+sl.max+"\u00b0")
  + fabRow("Steeper than 36\u00b0", sl.pctOver36+"%", capped?"":"warn")
  + fabRow("Steep faces toward", (tr.steepFaceAzimuth==null?"\u2014":tr.steepFaceAzimuth+"\u00b0")+"  (R "+tr.concentration+")")
  + fabRow("Across-grain skew", tr.asymmetrySkew)
  + fabRow("Sampled at", (j.res*3.28084).toFixed(1)+" ft \u00b7 "+Math.round(j.covered*100)+"% covered")
  + `<div class="note">${note}<br>Source: ${j.sources.join(", ")}</div>`;
}
document.getElementById("fabRun").onclick=runFabric;
const SPECTRUM_COLOR_IDS=["#elevLowColor","#elevMidColor","#elevHighColor"];
const SPECTRUM_PALETTES={
  classic:["#f85c6c","#fffffa","#46a0ff"],
  "orange-blue":["#b35806","#f7f7f7","#2166ac"],
  terrain:["#24553b","#d9bd87","#f4f7ff"],
  ember:["#230d26","#ec592c","#fff3b0"],
  glacier:["#102632","#348e9b","#d5ffff"],
  viridis:["#440154","#21918c","#fde725"]
};
function spectrumHexColors(){return SPECTRUM_COLOR_IDS.map(id=>$(id).value.toLowerCase())}
function syncSpectrumPalette(){
  const colors=spectrumHexColors();
  $("#elevPalette").value=Object.keys(SPECTRUM_PALETTES).find(id=>SPECTRUM_PALETTES[id].every((v,i)=>v===colors[i]))||"custom";
  const level=elevMetres(),span=elevSpanMetres();
  const gradient="linear-gradient(90deg,"+Array.from({length:17},(_,i)=>`rgb(${elevRampRgb(level-span+i*span/8,level,span,spectrumHexColors().map(hex=>ElevationBands.parseColor(hex).slice(0,3))).join(",")}) ${i/16*100}%`).join(",")+")";
  for(const id of ["#elevPalettePreview","#elevRangePreview"])$(id).style.background=gradient;
}
function applySpectrumColors(colors){
  SPECTRUM_COLOR_IDS.forEach((id,i)=>$(id).value=colors[i]);
  syncSpectrumPalette();saveTerrainPrefs();scheduleElevPaint();
}
$("#elevPalette").addEventListener("change",()=>{const colors=SPECTRUM_PALETTES[$("#elevPalette").value];if(colors){$("#elevSh").checked=true;applySpectrumColors(colors)}});
for(const id of SPECTRUM_COLOR_IDS){
  $(id).addEventListener("input",()=>{syncSpectrumPalette();scheduleElevPaint()});
  $(id).addEventListener("change",()=>{syncSpectrumPalette();saveTerrainPrefs();scheduleElevPaint()});
}
$("#elevPaletteReverse").onclick=()=>applySpectrumColors(spectrumHexColors().reverse());
$("#elevPaletteReset").onclick=()=>applySpectrumColors(SPECTRUM_PALETTES.classic);
syncSpectrumPalette();
loadTerrainPrefs();
// The studio mounts before preferences hydrate the native style field.
// Reconcile its rows and selected look with the restored map, including Off.
lidarStudio?.refresh();
syncElevSpanSlider();
syncTerrainOpacity();
syncTerrainLookControls();
syncTerrainLighting();
syncElevationChecks();
$("#elevSh").addEventListener("change",()=>{ saveTerrainPrefs(); applyElev() });
$("#elevSlide").addEventListener("input", syncElevFromSlider);
$("#elevVal").addEventListener("input", syncElevFromBox);
$("#elevVal").addEventListener("change",saveTerrainPrefs);
$("#elevSlide").addEventListener("change",saveTerrainPrefs);
$("#elevSpan").addEventListener("input",()=>{syncElevSpanSlider();scheduleElevPaint()});
$("#elevSpanSlide").addEventListener("input",()=>{
  const span=$("#elevSpan");span.value=elevSpanFromPosition($("#elevSpanSlide").value);
  $("#elevSpanSlide").setAttribute("aria-valuetext",Number(span.value).toLocaleString()+" feet");
  span.dispatchEvent(new Event("input",{bubbles:true}));
});
$("#elevSpanSlide").addEventListener("change",()=>$("#elevSpan").dispatchEvent(new Event("change",{bubbles:true})));
$("#elevSpan").addEventListener("change",()=>{ $("#elevSpan").value=Math.max(10,Math.min(20000,+$("#elevSpan").value||300));syncElevSpanSlider();saveTerrainPrefs();applyElev() });
$("#elevAlpha").addEventListener("input",()=>{ $("#elevAlphaOut").textContent=$("#elevAlpha").value+"%"; scheduleElevPaint() });
$("#elevAlpha").addEventListener("change",saveTerrainPrefs);
$("#elevUnit").addEventListener("change", ()=>{        // keep the height, restate the number
  const m=+$("#elevSlide").value;
  $("#elevVal").value=Math.round(m/ELEV_UNIT[$("#elevUnit").value]);
  saveTerrainPrefs(); applyElev();
});
for(const id of ["#elevBelowOn","#elevAboveOn","#elevBandOutline"])
  $(id).addEventListener("change",()=>{ saveTerrainPrefs(); applyElev() });
for(const id of ["#elevBelowColor","#elevAboveColor","#elevBelowVal","#elevAboveVal","#elevBandFeather"]){
  $(id).addEventListener("input",scheduleElevPaint);
  $(id).addEventListener("change",()=>{ saveTerrainPrefs(); applyElev() });
}
$("#elevBandAlpha").addEventListener("input",()=>{
  $("#elevBandAlphaOut").textContent=$("#elevBandAlpha").value+"%"; scheduleElevPaint();
});
$("#elevBandAlpha").addEventListener("change",saveTerrainPrefs);
$("#elevSpectrumReset").onclick=()=>{
  SPECTRUM_COLOR_IDS.forEach((id,i)=>$(id).value=SPECTRUM_PALETTES.classic[i]);syncSpectrumPalette();
  $("#elevSh").checked=false;
  $("#elevUnit").value="ft";$("#elevVal").value=1100;$("#elevSlide").value=335;
  $("#elevSpan").value=300;syncElevSpanSlider();$("#elevAlpha").value=48;$("#elevAlphaOut").textContent="48%";
  saveTerrainPrefs();applyElev();announceLayers();
};
$("#elevBandsReset").onclick=()=>{
  $("#elevBelowOn").checked=false;$("#elevBelowColor").value="#f85c6c";$("#elevBelowVal").value=1000;
  $("#elevAboveOn").checked=false;$("#elevAboveColor").value="#46a0ff";$("#elevAboveVal").value=1500;
  $("#elevBandFeather").value=40;$("#elevBandAlpha").value=52;$("#elevBandAlphaOut").textContent="52%";
  $("#elevBandOutline").checked=false;
  saveTerrainPrefs();applyElev();announceLayers();
};
for(const id of ["#terDepth","#terExtent","#fabBand"]){ const el=$(id); if(el) el.addEventListener("change",saveTerrainPrefs) }
let terrainLightFrame=0;
function repaintTerrainLighting(){
  syncTerrainLighting();
  if(gpuTerrainEnabled)syncGpuTerrain();
  if(terrainLightFrame)return;
  terrainLightFrame=requestAnimationFrame(()=>{terrainLightFrame=0;paintTerrainLightingFrame();});
}
function paintTerrainLightingFrame(){
  const light=syncTerrainLighting();
  if(gpuTerrainEnabled)syncGpuTerrain();
  paintTerrainLegend($("#terStyle").value);
  for(const layer of [terBase,terLayer]) if(layer?._store)
    layer._store.forEach(tile=>layer._paint(tile.cv,tile.elev,tile.coords));
  if(gpu3d?.enabled){apply3dLighting();}
  else if(map3d?.getLayer("terrain-hillshade")){
    paint3dHillshade(light,terrainOpacity()/100,$("#terStyle").value);
    paint3dSky(light);
    map3d.setTerrain({source:"dem",exaggeration:light.exaggeration});
  }else schedule3dStyle();
  saveTerrainPrefs();
}
for(const id of ["#terSunAz","#terSunAlt","#terAmbient","#terExaggeration"]){
  $(id).addEventListener("input",repaintTerrainLighting);
  $(id).addEventListener("change",saveTerrainPrefs);
}
$("#terLightReset").onclick=()=>{
  $("#terSunAz").value=315;$("#terSunAlt").value=45;$("#terAmbient").value=12;$("#terExaggeration").value=125;
  repaintTerrainLighting();
};

/* A deliberately small public bridge for the task-oriented shell. The map
   engine keeps owning the real layers; the interface asks this bridge for a
   live render stack and never duplicates scientific state. */
