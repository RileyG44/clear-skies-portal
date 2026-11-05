/* One page-wide unit (feet or metres) for every height on the Elevation page.
   The reference is held in metres, so a typed value outside the slider's
   travel, a unit switch or a reload never changes the physical height. */
const ELEV_UNIT={m:1, ft:0.3048};
const ELEV_REF_MIN_M=-500, ELEV_REF_MAX_M=8850;
const ELEV_SPAN_MIN_M=10*0.3048, ELEV_SPAN_MAX_M=20000*0.3048, ELEV_FEATHER_MAX_M=10000*0.3048;
let elevLayer=null, elevRefM=1100*0.3048, elevShownUnit="ft";
/* The spectrum and the below/above highlights for one tile of heights, as
   straight (not premultiplied) RGBA. The 2D layer's CPU path and the 3D
   drape both color through here, so the two views cannot disagree. `stride`
   and `offset` let the 3D path read the 256x256 interior of a skirted 258
   grid in place. */
function elevationColours(elev,count,settings,out,width=count,stride=width,offset=0){
  return CSPTerrainDrape.elevationColours(elev,count,settings,out,width,stride,offset);
}
function elevUnitKey(){ return ELEV_UNIT[$("#elevUnit").value]?$("#elevUnit").value:"ft" }
function elevUnitFactor(){ return ELEV_UNIT[elevUnitKey()] }
function elevMetres(){ return elevRefM }
function elevFormat(metres){
  const unit=elevUnitKey();
  return `${Math.round(metres/ELEV_UNIT[unit]).toLocaleString()} ${unit}`;
}
/* Height fields show whole units, but each remembers the exact metres it was
   last converted from. While the shown number is unchanged that exact height
   is used, so feet → metres → feet never moves a threshold, span or edge. */
const ELEV_HEIGHT_FIELDS=["#elevSpan","#elevBelowVal","#elevAboveVal","#elevBandFeather"];
function heightMetres(input,unit=elevUnitFactor()){
  const value=+input.value,exact=input.dataset?.m;
  if(input.value===""||!Number.isFinite(value)) return NaN;
  if(exact!=null&&exact!==""&&Number.isFinite(+exact)&&Math.round(+exact/unit)===value) return +exact;
  return value*unit;
}
function setHeightMetres(input,metres,unit=elevUnitFactor()){
  if(input.dataset) input.dataset.m=String(metres);
  input.value=Math.round(metres/unit);
}
/* Restate every height field in the newly chosen unit. */
function convertElevationUnit(next){
  const from=ELEV_UNIT[elevShownUnit]||ELEV_UNIT.ft,to=ELEV_UNIT[next]||ELEV_UNIT.ft;
  for(const id of ELEV_HEIGHT_FIELDS){
    const input=$(id),metres=heightMetres(input,from);
    if(Number.isFinite(metres)) setHeightMetres(input,metres,to);
  }
  elevShownUnit=ELEV_UNIT[next]?next:"ft";
  // Whole-unit bounds that contain the exact 10 ft floor (3.048 m shows as 3 m).
  $("#elevSpan").min=Math.floor(ELEV_SPAN_MIN_M/to);$("#elevSpan").max=Math.floor(ELEV_SPAN_MAX_M/to);
  $("#elevVal").min=Math.ceil(ELEV_REF_MIN_M/to);$("#elevVal").max=Math.floor(ELEV_REF_MAX_M/to);
  $("#elevBandFeather").max=Math.floor(ELEV_FEATHER_MAX_M/to);
  for(const id of ["#elevVal",...ELEV_HEIGHT_FIELDS]) $(id).step="any";
  for(const suffix of document.querySelectorAll("[data-elev-unit]")) suffix.textContent=elevShownUnit;
  showElevReference();
}
/* Shared views write raw control values; rebuild the canonical reference from
   the slider's metres and restate the fields in the restored unit. */
function syncElevationFromControls(){
  if(!ELEV_UNIT[$("#elevUnit").value]) $("#elevUnit").value="ft";
  elevShownUnit=$("#elevUnit").value;convertElevationUnit(elevShownUnit);
  const m=+$("#elevSlide").value;if(Number.isFinite(m)) elevRefM=m;
  $("#elevVal").value=Math.round(elevRefM/elevUnitFactor());showElevReference();
}
function showElevReference(){
  if(document.activeElement!==$("#elevVal")) $("#elevVal").value=Math.round(elevRefM/elevUnitFactor());
  const slide=$("#elevSlide");
  slide.value=Math.max(ELEV_REF_MIN_M,Math.min(ELEV_REF_MAX_M,Math.round(elevRefM)));
  slide.setAttribute("aria-valuetext",elevFormat(elevRefM));
}
// Both the menu and map panel use the same logarithmic span range, in feet.
function elevSpanLimitsFt(){ return [10,20000] }
function elevSpanFt(){
  const metres=heightMetres($("#elevSpan")),feet=metres>0?metres/0.3048:300;
  return Math.max(10,Math.min(20000,feet));
}
function setElevSpanFt(feet){
  const input=$("#elevSpan"),metres=Math.max(10,Math.min(20000,feet))*0.3048,unit=elevUnitFactor();
  setHeightMetres(input,metres,unit);
}
function elevSpanPosition(feet){
  return Math.round(Math.log(Math.max(10,Math.min(20000,+feet||300))/10)/Math.log(2000)*1000);
}
function elevSpanFromPosition(position){
  const feet=Math.exp(Math.log(10)+Math.max(0,Math.min(1000,+position))/1000*Math.log(2000));
  const preset=[50,150,300,600,1200,2500].find(value=>Math.abs(feet-value)/value<.025);
  return preset||Math.round(feet);
}
function syncElevSpanSlider(){
  const input=$("#elevSpanSlide"),feet=elevSpanFt();
  if(document.activeElement!==input)input.value=elevSpanPosition(feet);
  input.setAttribute("aria-valuetext",elevFormat(feet*0.3048));
}
function elevSpanMetres(){ return Math.max(3,elevSpanFt()*0.3048) }
/* Soft edge in metres, clamped to the field's stated range. */
function elevFeatherMetres(){
  const metres=heightMetres($("#elevBandFeather"));
  return Math.max(0,Math.min(ELEV_FEATHER_MAX_M,Number.isFinite(metres)?metres:0));
}
function elevFeatherValue(){ return Math.round(elevFeatherMetres()/elevUnitFactor()) }
function inputPercent(id,fallback){
  const value=+$(id).value;
  return Math.max(0,Math.min(100,Number.isFinite(value)?value:fallback));
}
function elevAlpha(){ return Math.round(255*inputPercent("#elevAlpha",48)/100) }
function elevationBandState(){
  const opacity=inputPercent("#elevBandAlpha",52)/100;
  const unit="m",feather=elevFeatherMetres(),height=id=>{const m=heightMetres($(id));return Number.isFinite(m)?m:0};
  const outline={enabled:$("#elevBandOutline").checked,color:"#ffffff",opacity:.88,width:8,unit:"ft"};
  return ElevationBands.sanitizeState({unit,bands:[
    {id:"below",label:"Below elevation",enabled:$("#elevBelowOn").checked,operator:"below",
     max:height("#elevBelowVal"),unit,color:$("#elevBelowColor").value,
     opacity,feather,outline,order:0},
    {id:"above",label:"Above elevation",enabled:$("#elevAboveOn").checked,operator:"above",
     min:height("#elevAboveVal"),unit,color:$("#elevAboveColor").value,
     opacity,feather,outline,order:1}
  ]},{defaults:false,defaultUnit:unit});
}
function restoreElevationBands(saved){
  if(!saved) return;
  const state=ElevationBands.sanitizeState(saved,{defaults:false,defaultUnit:"ft"}),unit=elevUnitKey();
  const byId=Object.fromEntries(state.bands.map(b=>[b.id,b]));
  const below=byId.below,above=byId.above;
  if(below){
    $("#elevBelowOn").checked=!!below.enabled; $("#elevBelowColor").value=below.color.slice(0,7);
    setHeightMetres($("#elevBelowVal"),below.maxM);
  }
  if(above){
    $("#elevAboveOn").checked=!!above.enabled; $("#elevAboveColor").value=above.color.slice(0,7);
    setHeightMetres($("#elevAboveVal"),above.minM);
  }
  const exemplar=below||above;
  if(exemplar){
    $("#elevBandAlpha").value=Math.round(exemplar.opacity*100);
    setHeightMetres($("#elevBandFeather"),exemplar.featherM);
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
    bandFeather:elevFeatherMetres(),
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
  $("#elevSpectrumBox")?.classList.toggle("ev-on",$("#elevSh").checked);
  $("#elevBandsBox")?.classList.toggle("ev-on",$("#elevBelowOn").checked||$("#elevAboveOn").checked);
  for(const id of ["Below","Above"]) $(`#elev${id}On`).closest(".ev-band-row")?.classList.toggle("ev-on",$(`#elev${id}On`).checked);
}
/* The one color scale: its ends are the heights where colors reach full strength. */
function paintElevLegend(){
  const m=elevMetres(),span=elevSpanMetres();
  const set=(id,text)=>{const el=$(id);if(el&&el.textContent!==text) el.textContent=text};
  set("#elevKeyLow",elevFormat(m-span));set("#elevKeyMid",elevFormat(m));set("#elevKeyHigh",elevFormat(m+span));
  $("#elevKey")?.setAttribute("aria-label",`Color scale from ${elevFormat(m-span)} through ${elevFormat(m)} to ${elevFormat(m+span)}`);
}
function paintElevSpectrumSummary(){
  const out=$("#elevSpectrumMoreValue");if(!out) return;
  const palette=$("#elevPalette").selectedOptions[0]?.textContent||"Custom";
  const text=`${elevFormat(elevMetres())} ± ${elevFormat(elevSpanMetres())} · ${palette}${$("#elevSh").checked?` · ${$("#elevAlpha").value}%`:""}`;
  if(out.textContent!==text) out.textContent=text;
}
/* Both task statuses name the data behind them, so they refresh together
   whenever tiles change what is drawn. */
function paintElevationStatus(){ paintElevOut();paintElevationBandOut() }
function paintElevOut(){
  paintElevLegend();
  const o=$("#elevOut"); if(!o) return;
  paintElevSpectrumSummary();
  if(!$("#elevSh").checked){ o.textContent="Coloring is off. These settings are kept and apply when you switch it on."; o.dataset.state="off"; return }
  o.dataset.state="on";
  const source=elevSourceText();
  o.textContent=source?`On the map from ${source}.`:"On. Elevation is loading; its source appears once tiles render.";
}
/* Which elevation data is drawn and how finely it is sampled here, so a
   precise threshold can be judged against the data behind it. */
function elevSourceText(){
  const loaded=terrainLayerSummary(elevLayer);
  if(!loaded.sources.length) return "";
  return loaded.sources.map(source=>{
    const spacing=Number.isFinite(source.sampleMeters)&&source.sampleMeters>0?`~${res(source.sampleMeters)} samples`:"sample spacing not reported";
    // Survey metadata names its vertical datum; other sources do not publish one here.
    const datums=[...new Set((source.surveys||[]).map(survey=>survey.verticalDatum).filter(Boolean))];
    const vertical=datums.length?`vertical reference ${datums.join(" / ")}`:"vertical reference not reported";
    return [source.label,loaded.sources.length>1?Math.round(source.percent)+"% of view":"",spacing,vertical].filter(Boolean).join(" · ");
  }).join(" + ");
}
function paintElevationBandOut(){
  const out=$("#elevBandOut"),unit=elevUnitKey(),parts=[];
  const below=+$("#elevBelowVal").value||0,above=+$("#elevAboveVal").value||0;
  const belowOn=$("#elevBelowOn").checked,aboveOn=$("#elevAboveOn").checked;
  if(belowOn) parts.push(`below ${below.toLocaleString()} ${unit}`);
  if(aboveOn) parts.push(`above ${above.toLocaleString()} ${unit}`);
  let text=parts.length?`Highlighting ground ${parts.join(" and ")}.`:"";
  if(parts.length){ const source=elevSourceText(); if(source) text+=` Heights from ${source}.` }
  if(belowOn&&aboveOn&&above<below) text+=` Between ${above.toLocaleString()} and ${below.toLocaleString()} ${unit} both apply, so their colors mix.`;
  out.textContent=text;out.dataset.state=parts.length?"on":"off";
  const feather=elevFeatherValue(),more=$("#elevBandMoreValue");
  if(more) more.textContent=`${$("#elevBandAlpha").value}% · ${feather?`${feather.toLocaleString()} ${unit} soft edge`:"sharp edge"}${$("#elevBandOutline").checked?" · outlined":""}`;
}
let elevPaintFrame=0;
function scheduleElevPaint(){
  if(gpuTerrainEnabled)syncGpuTerrain();
  if(elevPaintFrame) return;
  elevPaintFrame=requestAnimationFrame(()=>{ elevPaintFrame=0; applyElev() });
}
function syncElevFromSlider(){
  elevRefM=+$("#elevSlide").value;
  $("#elevVal").value=Math.round(elevRefM/elevUnitFactor());
  $("#elevValHint").hidden=true;$("#elevVal").removeAttribute("aria-invalid");
  showElevReference();scheduleElevPaint();
}
/* A typed height is used as typed when it is a real elevation on Earth; the
   slider shows the nearest point of its travel and never rewrites the value. */
function elevTypedMetres(){
  const raw=$("#elevVal").value,value=+raw;
  if(raw===""||!Number.isFinite(value)) return null;
  return value*elevUnitFactor();
}
function syncElevFromBox(){
  const m=elevTypedMetres(),hint=$("#elevValHint");
  const valid=m!=null&&m>=ELEV_REF_MIN_M&&m<=ELEV_REF_MAX_M;
  hint.hidden=valid;
  if(valid){ $("#elevVal").removeAttribute("aria-invalid");elevRefM=m;showElevReference();scheduleElevPaint();return }
  $("#elevVal").setAttribute("aria-invalid","true");
  hint.textContent=`Enter a height between ${elevFormat(ELEV_REF_MIN_M)} and ${elevFormat(ELEV_REF_MAX_M)}.`;
}
function commitElevFromBox(){
  const m=elevTypedMetres();
  elevRefM=m==null?elevRefM:Math.max(ELEV_REF_MIN_M,Math.min(ELEV_REF_MAX_M,m));
  $("#elevValHint").hidden=true;$("#elevVal").removeAttribute("aria-invalid");
  $("#elevVal").value=Math.round(elevRefM/elevUnitFactor());
  showElevReference();saveTerrainPrefs();applyElev();
}
function applyElev(){
  paintElevOut();
  paintElevationBandOut(); syncElevationChecks();
  const on=elevationActive();
  // As in applyTerrain: no layer before the renderer is decided at start-up.
  if(!gpuTerrainDecided)return;
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
    elevLayer.on("tileload tilerefine tileerror load",()=>{scheduleTerrainStatus();paintElevationStatus()});
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
    // The cache-only DNR sampler keeps valid pixels and fills gaps from USGS.
    const dnr=dnrBboxAllowed(view);
    const path=dnr?"/api/wadnr/fabric":"/api/usgs/fabric";
    const r=await fetch(api(`${path}?bbox=${view.map(v=>v.toFixed(5)).join(",")}&lo=${lo}&hi=${hi}&strict=0`));
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
  $("#elevRangePreview").style.background=gradient;
}
function applySpectrumColors(colors){
  SPECTRUM_COLOR_IDS.forEach((id,i)=>$(id).value=colors[i]);
  syncSpectrumPalette();saveTerrainPrefs();scheduleElevPaint();
}
// Color edits never switch coloring on or off; Show on map alone does that.
$("#elevPalette").addEventListener("change",()=>{const colors=SPECTRUM_PALETTES[$("#elevPalette").value];if(colors) applySpectrumColors(colors)});
for(const id of SPECTRUM_COLOR_IDS){
  $(id).addEventListener("input",()=>{syncSpectrumPalette();scheduleElevPaint()});
  $(id).addEventListener("change",()=>{syncSpectrumPalette();saveTerrainPrefs();scheduleElevPaint()});
}
$("#elevPaletteReverse").onclick=()=>applySpectrumColors(spectrumHexColors().reverse());
$("#elevPaletteReset").onclick=()=>applySpectrumColors(SPECTRUM_PALETTES.classic);
syncSpectrumPalette();
loadTerrainPrefs();
if (cspFreshView && lidarStudio) {
  // Hydrate the existing model before the normal csp:ready renderer starts;
  // do not synthesize a user change or start a second startup rendering path.
  // The launch view is the Missoula preset: Rivers & lakes at 10% on top
  // (overlays.js), ground below 2,320 ft shaded water blue at 35%, then the
  // Missoula LiDAR look, in CSP_STARTUP_LAYER_ORDER.
  const look = CSPLidarRender.LOOKS.find(look => look.id === "missoula");
  const result = CSPLidarRender.applyScene(lidarStudio.state(), look.scene, look.id);
  $("#terStyle").value = result.style;
  $("#terOp").value = look.opacity;
  lidarStudio.restoreDisplay({state:result.state});
  $("#elevSh").checked = false;
  $("#elevAboveOn").checked = false;
  $("#elevBelowOn").checked = true;
  $("#elevBelowColor").value = "#006981";
  $("#elevBelowVal").value = 2320;
  $("#elevBandAlpha").value = 35;
  $("#elevBandAlphaOut").textContent = "35%";
  $("#elevBandFeather").value = 40;
  $("#elevBandOutline").checked = false;
  saveTerrainPrefs();
  try {
    localStorage.setItem(CSPLidarStudio.STORAGE_KEY, JSON.stringify(result.state));
    localStorage.setItem("clearskies.active-layer-order.v1", JSON.stringify(CSP_STARTUP_LAYER_ORDER));
  } catch (_) {}
}
// The studio mounts before preferences hydrate the native style field.
// Reconcile its rows and selected look with the restored map, including Off.
lidarStudio?.refresh();
syncElevSpanSlider();
syncTerrainOpacity();
syncTerrainLookControls();
syncTerrainLighting();
syncElevationChecks();
/* The editor opens with the overlay and folds away when it is switched off,
   so an inactive editor never stands between the person and Highlights. */
$("#elevSh").addEventListener("change",()=>{ $("#elevSpectrumMore").open=$("#elevSh").checked; saveTerrainPrefs(); applyElev() });
$("#elevSpectrumMore").open=$("#elevSh").checked;
$("#elevSlide").addEventListener("input", syncElevFromSlider);
$("#elevVal").addEventListener("input", syncElevFromBox);
$("#elevVal").addEventListener("change",commitElevFromBox);
$("#elevSlide").addEventListener("change",saveTerrainPrefs);
$("#elevSpan").addEventListener("input",()=>{syncElevSpanSlider();scheduleElevPaint()});
$("#elevSpanSlide").addEventListener("input",()=>{
  const span=$("#elevSpan");setElevSpanFt(elevSpanFromPosition($("#elevSpanSlide").value));
  $("#elevSpanSlide").setAttribute("aria-valuetext",elevFormat(elevSpanFt()*0.3048));
  span.dispatchEvent(new Event("input",{bubbles:true}));
});
$("#elevSpanSlide").addEventListener("change",()=>$("#elevSpan").dispatchEvent(new Event("change",{bubbles:true})));
$("#elevSpan").addEventListener("change",()=>{ setElevSpanFt(elevSpanFt());syncElevSpanSlider();saveTerrainPrefs();applyElev() });
$("#elevAlpha").addEventListener("input",()=>{ $("#elevAlphaOut").textContent=$("#elevAlpha").value+"%"; scheduleElevPaint() });
$("#elevAlpha").addEventListener("change",saveTerrainPrefs);
$("#elevUnit").addEventListener("change", ()=>{        // keep every height, restate the numbers
  convertElevationUnit(elevUnitKey());$("#elevVal").value=Math.round(elevRefM/elevUnitFactor());
  syncElevSpanSlider();saveTerrainPrefs();applyElev();
});
$("#elevBandFeather").addEventListener("change",()=>{ setHeightMetres($("#elevBandFeather"),elevFeatherMetres()) },true);
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
  $("#elevSh").checked=false;$("#elevSpectrumMore").open=false;
  elevRefM=1100*0.3048;setElevSpanFt(300);$("#elevVal").value=Math.round(elevRefM/elevUnitFactor());showElevReference();syncElevSpanSlider();$("#elevAlpha").value=48;$("#elevAlphaOut").textContent="48%";
  saveTerrainPrefs();applyElev();announceLayers();
  // The button just folded away with its editor; return to the editor's toggle.
  $("#elevSpectrumMore > summary")?.focus({preventScroll:true});
};
$("#elevBandsReset").onclick=()=>{
  // Defaults are physical heights (1,000 ft, 1,500 ft, 40 ft) in either unit.
  $("#elevBelowOn").checked=false;$("#elevBelowColor").value="#f85c6c";setHeightMetres($("#elevBelowVal"),1000*0.3048);
  $("#elevAboveOn").checked=false;$("#elevAboveColor").value="#46a0ff";setHeightMetres($("#elevAboveVal"),1500*0.3048);
  setHeightMetres($("#elevBandFeather"),40*0.3048);$("#elevBandAlpha").value=52;$("#elevBandAlphaOut").textContent="52%";
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
