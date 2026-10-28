/* ---------------------------------------------------------------- events */
$("#op").oninput=e=>{
  const v=+e.target.value/100;
  if(overlay) overlay.setOpacity(v);
  NEIGH.forEach(n=>n.layer.setOpacity(v));
  if(MOSAIC_BACKDROP&&MOSAIC_BACKDROP.layer) MOSAIC_BACKDROP.layer.setOpacity(v);
};
$("#ctlReset").onclick=()=>{
  $("#op").value=100;$("#op").dispatchEvent(new Event("input"));saveSearchPrefs();
};
$("#mosaic").onchange=()=>{
  MOSAIC_ON=$("#mosaic").checked;
  if(MOSAIC_ON && SEL!=null) fillMosaic(ITEMS[SEL]);
  else { clearMosaic(); const s2=$("#mosStat"); if(s2) s2.textContent="" }
};
$("#fillNow").onclick=()=>{ if(SEL!=null) fillMosaic(ITEMS[SEL], true) };

/* Off releases imagery, its outline, and all pending mosaic work. Merely
   setting opacity to zero leaves tile requests and map-move handlers active. */
function clearScene(renderResults=true){
  sceneToken++;
  sceneAbort?.abort(); sceneAbort=null;
  if(overlayPending){clearTimeout(overlayPending._cspReadyTimer);map.removeLayer(overlayPending);overlayPending=null}
  if(overlay){map.removeLayer(overlay);overlay=null}
  if(footprint){map.removeLayer(footprint);footprint=null}
  clearTimeout(mosTimer); mosTimer=null;
  clearMosaic();
  // Release the fill, keep the person's Auto-fill choice for the next scene.
  MOSAIC_ON=$("#mosaic").checked;
  const status=$("#mosStat"); if(status) status.textContent="";
  hideMenu(); hideSceneControls(); SEL=null;
  if(renderResults) render();
  document.dispatchEvent(new CustomEvent("csp:layers-changed"));
}
$("#clr").onclick=()=>clearScene();
$("#sort").onchange=render;
$("#viewable").onchange=render;
$("#vis").onchange=render;
/* ---- date window UI ---------------------------------------------------- */
let PREV_DAYS=365;                       // last preset used, to seed a custom range

function syncDateUI(){
  const custom = $("#days").value==="custom";
  ["lb_drange","drange","dpre","dnote"].forEach(id=>
    document.getElementById(id).classList.toggle("hide-row", !custom));

  const w=dateWindow();
  setCount("filters", w.label);          // visible on the header while Filters is collapsed

  const note=$("#dnote"), f=$("#dFrom").value, t=$("#dTo").value;
  if(!custom){ note.textContent=""; note.classList.remove("warn"); $("#drange").classList.remove("bad"); return true }

  const bad = !!(f && t && f>t);
  $("#drange").classList.toggle("bad", bad);
  note.classList.toggle("warn", bad);
  note.textContent = bad ? "Start date is after the end date — no results possible."
    : (!f && !t) ? "Both empty searches all time. Fill one side only for an open-ended range."
    : (!f) ? "Everything up to " + t + "."
    : (!t) ? "Everything from " + f + " onwards."
    : Math.round((new Date(t)-new Date(f))/864e5 + 1) + " days selected.";
  return !bad;
}

function setRange(from, to){
  $("#dFrom").value = from || "";
  $("#dTo").value   = to   || "";
  if(syncDateUI() && LOC) run();
}

$("#days").onchange=()=>{
  const v=$("#days").value;
  if(v==="custom"){
    if(!$("#dFrom").value && !$("#dTo").value){
      // Seed from the preset the user was just on, so the range is never blank.
      const p=relWindow(PREV_DAYS);
      $("#dFrom").value = p.from ? ymd(p.from) : "";
      $("#dTo").value   = ymd(new Date());
    }
  }else PREV_DAYS=+v;
  if(syncDateUI() && LOC) run();
};
["dFrom","dTo"].forEach(id=>
  document.getElementById(id).addEventListener("change",()=>{ if(syncDateUI() && LOC) run() }));

/* Quick presets for the ranges people actually ask for. */
$("#dpre").addEventListener("click", e=>{
  const b=e.target.closest("button[data-pre]"); if(!b) return;
  const now=new Date(), Y=now.getUTCFullYear(), M=now.getUTCMonth();
  const mk=(y,m,d)=>ymd(new Date(Date.UTC(y,m,d)));
  const last=(y,m)=>new Date(Date.UTC(y,m+1,0)).getUTCDate();
  switch(b.dataset.pre){
    case "thismonth": return setRange(mk(Y,M,1), ymd(now));
    case "lastmonth": {
      const y = M===0?Y-1:Y, m = M===0?11:M-1;
      return setRange(mk(y,m,1), mk(y,m,last(y,m)));
    }
    case "ytd":       return setRange(mk(Y,0,1), ymd(now));
    case "lastyear":  return setRange(mk(Y-1,0,1), mk(Y-1,11,31));
  }
});

// No imagery exists in the future; don't let the picker offer it.
$("#dFrom").max = $("#dTo").max = ymd(new Date());
const SEARCH_PREF_KEY="clearskies.search.v1";
function loadSearchPrefs(){
  try{
    const p=JSON.parse(localStorage.getItem(SEARCH_PREF_KEY)||"null");if(!p) return;
    for(const id of ["days","cloud","vis","sort"]){
      const el=$("#"+id),value=String(p[id]??"");if([...el.options].some(o=>o.value===value)) el.value=value;
    }
    if($("#days").value!=="custom") PREV_DAYS=+$("#days").value;
    if(/^\d{4}-\d{2}-\d{2}$/.test(p.dFrom||"")) $("#dFrom").value=p.dFrom;
    if(/^\d{4}-\d{2}-\d{2}$/.test(p.dTo||"")) $("#dTo").value=p.dTo;
    if(Number.isFinite(+p.opacity)) $("#op").value=Math.max(10,Math.min(100,+p.opacity));
    for(const id of ["viewable","fire"]) if(typeof p[id]==="boolean") $("#"+id).checked=p[id];
    // Auto-fill surroundings became on by default in prefs version 2. Older
    // saved prefs recorded it off whenever a new search reset the switch, so
    // only a choice saved since then is restored.
    if(p.prefs>=2&&typeof p.mosaic==="boolean") $("#mosaic").checked=p.mosaic;
  }catch(error){}
}
function saveSearchPrefs(){
  try{ localStorage.setItem(SEARCH_PREF_KEY,JSON.stringify({
    prefs:2,days:$("#days").value,dFrom:$("#dFrom").value,dTo:$("#dTo").value,
    cloud:$("#cloud").value,vis:$("#vis").value,sort:$("#sort").value,
    viewable:$("#viewable").checked,
    mosaic:$("#mosaic").checked,fire:$("#fire").checked,opacity:+$("#op").value
  })) }catch(error){}
}
loadSearchPrefs();MOSAIC_ON=$("#mosaic").checked;syncChecks();
initAlerts();
syncDateUI();
$("#cloud").onchange=()=>LOC&&run();
for(const id of ["days","dFrom","dTo","cloud","vis","sort","viewable","mosaic","fire"])
  $("#"+id).addEventListener("change",saveSearchPrefs);
$("#op").addEventListener("change",saveSearchPrefs);

async function doSearch(){
  const t=$("#q").value.trim(); if(!t) return;
  acCancel(); acHide();
  try{
    const ll=parseCoordinates(t);
    if(ll){ setLoc(ll.lat,ll.lng,/*keepLabel*/true,t); map.setView([ll.lat,ll.lng], Math.max(map.getZoom(),10)); }
    else{
      statusEl.dataset.kind="general",statusEl.innerHTML='<span class="spin"></span> Geocoding…';
      const g=await geocode(t);
      setLoc(g.lat,g.lng,/*keepLabel*/true,t); map.setView([g.lat,g.lng],11);
    }
    run();
  }catch(e){ statusEl.dataset.kind="general",statusEl.innerHTML=`<span class="chip err">${e.message}</span>` }
}
/* The Satellite panel's own search field drives the same location and scene
   search as the main field; its suggestions come from the same geocoder and
   coordinate parser, so a pasted Google Earth position works in both. */
async function cspPlaceSuggestions(text,signal){
  const t=String(text||"").trim();
  try{ if(t.length<3||parseCoordinates(t)) return [] }catch(error){ return [] }
  const r=await fetch(PHOTON+"/api/?limit=6&q="+encodeURIComponent(t),{signal});
  if(!r.ok) throw new Error("geocoder "+r.status);
  const seen=new Set();
  return ((await r.json()).features||[]).filter(f=>f.geometry&&f.geometry.coordinates).map(f=>{
    const s=splitName(f);
    return {primary:s.primary,secondary:s.secondary,kind:kindOf(f),lat:f.geometry.coordinates[1],lng:f.geometry.coordinates[0],extent:f.properties.extent||null};
  }).filter(place=>{
    const key=[place.primary,place.secondary,place.kind].join("|").toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key);return true;
  });
}
function cspSearchPlace(place){
  if(!place||!Number.isFinite(place.lat)||!Number.isFinite(place.lng)) return;
  acCancel();acHide();
  $("#q").value=place.secondary?`${place.primary}, ${place.secondary.split(",").map(x=>x.trim()).slice(0,2).join(", ")}`:place.primary;
  setLoc(place.lat,place.lng,/*keepLabel*/true,$("#q").value.trim());
  const e=place.extent;          // [minLon, maxLat, maxLon, minLat]
  if(e) map.fitBounds([[e[3],e[0]],[e[1],e[2]]],{maxZoom:13});
  else map.setView([place.lat,place.lng],12);
  run();
}
function cspSearchText(text){
  const t=String(text||"").trim();if(!t) return;
  $("#q").value=t;updateCoordinateActions();
  return doSearch();
}
function cspSearchMapCenter(){
  const c=map3d?map3d.getCenter():map.getCenter();
  setLoc(c.lat,c.lng,/*keepLabel*/false);
  run();
}
/* The iPhone menu's Go button for a place already selected on the map (a tap
   that staged it without the double-tap): the same scene search the
   double-tap runs, without moving the selection or applying a scene. */
function cspSearchSelected(){
  if(!LOC) return false;
  run();
  return true;
}
/* The iPhone map's imagery button: an explicit request to search the selected
   place and apply its Best photo, the same scene the Best available summary
   offers. Ordinary searches still only list scenes. Auto-fill surroundings,
   when on, then fills the view around the applied scene. */
async function cspSearchBestImagery(){
  if(!LOC) return {applied:false,message:"Select a place on the map first."};
  const searching=run(),token=searchToken;
  await searching;
  if(token!==searchToken) return {applied:false,message:""};
  const pick=bestPhoto(resultPool());
  if(!pick) return {applied:false,message:ITEMS.length
    ? "No clear true-color scene here. Widen the date range or cloud filter."
    : "No imagery found here. Widen the date range or cloud filter."};
  await select(ITEMS.indexOf(pick));
  const cloud=pick.cloud!=null?` · ${pick.cloud.toFixed(0)}% cloud`:"";
  return {applied:true,message:`Loading ${pick.label} · ${pick.date.slice(0,10)} · ${res(pick.gsd)}${cloud}`};
}
$("#go").onclick=doSearch;
$("#loc").onclick=geolocate;
$("#q").addEventListener("input",()=>{ acInput();updateCoordinateActions() });
$("#q").addEventListener("keydown",acKey);
$("#qClear").onclick=()=>{ clearLoc();if(!NATIVE_HOST) $("#q").focus({preventScroll:true}) };
/* Escape clears the selection from the search field or the map, but only
   once nothing else wanted it: an open menu, a markup edit or an area
   selection takes Escape first. Those are read before any handler runs,
   since some close themselves without claiming the key. */
let escapeBusy=false;
window.addEventListener("keydown",e=>{
  if(e.key==="Escape") escapeBusy=document.body.classList.contains("csp-markup-editing")||document.body.classList.contains("dnr-selecting");
},true);
window.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||e.defaultPrevented||escapeBusy) return;
  const t=e.target;
  if(t!==document.body&&t!==$("#q")&&!t.closest?.("#map")) return;
  if(clearLoc()) e.preventDefault();
});
updateCoordinateActions();
/* Installed to the home screen the app runs without browser chrome, so the
   worker is what keeps it opening when the Mac is asleep or off-network.
   Registration needs a secure context: it takes over https:// and localhost,
   and is simply skipped on a plain-http LAN address. */
/* The address is remembered, so the installed app keeps its server across
   launches. A page served by server.js itself needs none of this and shows the
   field already connected. */
/* Printed in the panel and on the console. Without it there is no way to tell
   a missing feature from a cached old page, which is exactly the confusion a
   service worker with no invalidation produced. */
const CSP_BUILD=window.CSP_BUILD||"development";
console.log("Clear Skies Portal build "+CSP_BUILD);
/* Tap the build stamp for the numbers that describe this device's viewport.
   A layout bug that only appears on a real phone cannot be reasoned about from
   a desktop; what settles it is whether the page fills the window and whether
   the window fills the screen, which are two different failures with two
   different fixes and are indistinguishable in a photograph. */
/* Installed app: flags standalone mode and reports the display's corner radius
   so the phone sheet can sit concentric with it. Deliberately measures nothing
   about the window height - see the status-bar-style meta. */
(function standaloneViewport(){
  const root=document.documentElement;
  const standalone=()=>(navigator.standalone===true)||matchMedia("(display-mode: standalone)").matches;
  /* Display corner radius in CSS px by screen size: Dynamic Island models 55,
     iPhone 12-14 47, X-11 39. Anything else is treated as square. */
  const cornerRadius=()=>{
    const h=Math.max(screen.width,screen.height);
    return [852,874,932,956].includes(h)?55:[844,926].includes(h)?47:[812,896].includes(h)?39:0;
  };
  function apply(){
    const on=standalone(),radius=cornerRadius();
    root.classList.toggle("csp-standalone",on);
    root.style.setProperty("--screen-radius",radius+"px");
    root.classList.toggle("csp-round-screen",on&&radius>0);
  }
  apply();
  addEventListener("resize",apply);
})();
(function stamp(){
  const el=document.getElementById("buildStamp");
  if(!el) return;
  el.textContent="build "+CSP_BUILD;
  el.setAttribute("role","button");
  el.tabIndex=0;
  const probe=document.createElement("div");
  probe.style.cssText="position:fixed;left:-9999px;top:0;"+
    "padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) "+
    "env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  const round=value=>Math.round(value*10)/10;
  function report(){
    document.body.appendChild(probe);
    const pad=getComputedStyle(probe);
    const inset={top:parseFloat(pad.paddingTop)||0,right:parseFloat(pad.paddingRight)||0,
                 bottom:parseFloat(pad.paddingBottom)||0,left:parseFloat(pad.paddingLeft)||0};
    probe.remove();
    const app=document.getElementById("app").getBoundingClientRect();
    const vv=window.visualViewport;
    const standalone=(navigator.standalone===true)||matchMedia("(display-mode: standalone)").matches;
    /* The two failures this is here to separate. */
    const pageFillsWindow=Math.abs(app.bottom-innerHeight)<1;
    const windowFillsScreen=Math.abs(innerHeight-screen.height)<1;
    return [
      `build ${CSP_BUILD}`,
      `standalone ${standalone?"yes":"no"}  dpr ${devicePixelRatio}`,
      `screen ${screen.width}x${screen.height}`,
      `window ${innerWidth}x${innerHeight}`,
      vv?`visual ${round(vv.width)}x${round(vv.height)} off ${round(vv.offsetTop)}`:"visual n/a",
      `client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
      `#app top ${round(app.top)} bottom ${round(app.bottom)} h ${round(app.height)}`,
      `safe t${round(inset.top)} r${round(inset.right)} b${round(inset.bottom)} l${round(inset.left)}`,
      `corners ${getComputedStyle(document.documentElement).getPropertyValue("--screen-radius").trim()||"0px"}`,
      `page fills window: ${pageFillsWindow?"yes":"NO"}`,
      `window fills screen: ${windowFillsScreen?"yes":"NO"}`
    ].join("\n");
  }
  function toggle(){
    const open=document.getElementById("buildDiag");
    if(open){ open.remove(); return }
    const box=document.createElement("pre");
    box.id="buildDiag";box.textContent=report();
    el.insertAdjacentElement("afterend",box);
  }
  el.addEventListener("click",toggle);
  el.addEventListener("keydown",event=>{
    if(event.key==="Enter"||event.key===" "){ event.preventDefault();toggle() }
  });

})();

function paintServerBox(){
  paintDnrAvailability();
  const dot=$("#srvDot"), st=$("#srvState"), meta=$("#srvMeta");
  const connect=$("#srvConnect"), copy=$("#srvCopyLink"), forget=$("#srvForget");
  const tool=$("#serverToggle");
  if(!dot) return;
  dot.className = "dot " + (PROXY ? "on" : "off");
  if(connect) connect.textContent=PROXY?"Check again":"Connect";
  if(copy) copy.disabled=!API;
  if(forget) forget.disabled=!API;
  if(meta){ meta.className=""; meta.textContent="" }
  if(PROXY){
    st.textContent = API ? "connected" : "connected (this page)";
    if(tool){ tool.title="Terrain engine: "+st.textContent; tool.setAttribute("aria-label",tool.title) }
    if(meta){
      const bits=[];
      if(Number.isFinite(+serverHealth?.uptimeSec)) bits.push("online "+fmtUptime(+serverHealth.uptimeSec));
      if(Number.isFinite(+serverHealth?.cached)) bits.push(Number(serverHealth.cached).toLocaleString()+" cached");
      const terrain=serverHealth?.terrain;
      if(terrain&&+terrain.workers) bits.push(`${terrain.active||0}/${terrain.workers} M2 workers`);
      if(terrain&&+terrain.avgMs) bits.push(`${(terrain.avgMs/1000).toFixed(1)}s avg uncached render`);
      const disk=serverHealth?.cacheDisk;
      if(disk&&Number.isFinite(+disk.freeGiB)) bits.push(`${(+disk.freeGiB).toFixed(1)} GiB disk free`);
      if(disk&&disk.writable===false) bits.push("cache paused for disk safety");
      if(+serverHealth?.renderQueued) bits.push(serverHealth.renderQueued+" terrain queued");
      else if(+serverHealth?.queued) bits.push(serverHealth.queued+" LiDAR queued");
      if(serverHealth?.nationalCircuit?.coolingDown) bits.push(`browser fallback ${serverHealth.nationalCircuit.retryInSec}s`);
      meta.className="ok"; meta.textContent=bits.join(" · ")||"Health check passed.";
    }
    return;
  }
  if(!API){
    st.textContent = "not configured";
    if(tool){ tool.title="Terrain engine: not configured"; tool.setAttribute("aria-label",tool.title) }
    if(meta) meta.textContent="Paste a Tailscale HTTPS address, then connect once on this device.";
    return;
  }
  const blocked=location.protocol==="https:" && /^http:\/\//i.test(API);
  st.textContent=blocked ? "blocked \u2014 needs https" : "unreachable";
  if(tool){ tool.title="Terrain engine: "+st.textContent; tool.setAttribute("aria-label",tool.title) }
  if(meta){
    meta.className="warn";
    meta.textContent=blocked
      ? "GitHub Pages can only reach an HTTPS engine."
      : "No response. The Mac service self-retries locally; check Tailscale, then press Connect.";
  }
}
function fmtUptime(seconds){
  const s=Math.max(0,Math.floor(seconds||0));
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
  return h ? h+"h "+m+"m" : Math.max(1,m)+"m";
}
function setServerBase(value){
  API=normaliseBase(value);
  if(NATIVE_HOST) nativeEngineSync=NATIVE_HOST.setEngineBase(API).catch(()=>{});
  const wasOnline=PROXY;
  PROXY=false; serverHealth=null; WA_EXTENT={}; waSeen.clear(); coverBounds=null; terrainQueryToken++;
  if(!API) localStorage.removeItem("cspServer");
  const field=$("#srvUrl"); if(field) field.value=API;
  paintServerBox();
  /* A different engine has different markup layers: let go of this one's. */
  if(wasOnline) document.dispatchEvent(new CustomEvent("csp:server",{detail:{online:false}}));
  return API;
}
async function connectServer(){
  const field=$("#srvUrl"), button=$("#srvConnect");
  const base=setServerBase(field&&field.value);
  if(!base&&(NATIVE_HOST||/\.github\.io$/i.test(location.hostname))){ paintServerBox(); return false }
  if(button){ button.disabled=true; button.textContent="Checking\u2026"; }
  const ok=await probeServer();
  if(button) button.disabled=false;
  if(ok){
    await refreshTerrainCoverage(true);
    warmPreview();
  }
  return ok;
}
async function copyServerSetupLink(){
  if(!API) return;
  /* The app's own page address opens nowhere else, so it shares the engine
     address itself; any other device pastes it into its own engine box. */
  const link=NATIVE_HOST?API:location.origin+location.pathname+"#engine="+encodeURIComponent(API);
  try{ await navigator.clipboard.writeText(link) }
  catch(e){
    const helper=document.createElement("textarea");
    helper.value=link; helper.style.position="fixed"; helper.style.opacity="0";
    document.body.append(helper); helper.select(); document.execCommand("copy"); helper.remove();
  }
  const meta=$("#srvMeta");
  if(meta){ meta.className="ok"; meta.textContent=NATIVE_HOST?"Engine address copied.":"Private setup link copied \u2014 open it once on another Tailscale device."; }
}
(function initServerBox(){
  const el=$("#srvUrl"); if(!el) return;
  el.value=API;
  $("#srvConnect").onclick=connectServer;
  $("#srvCopyLink").onclick=copyServerSetupLink;
  if(NATIVE_HOST) $("#srvCopyLink").textContent="Copy engine address";
  $("#srvForget").onclick=()=>{
    setServerBase("");
    refreshTerrainCoverage(true);
    warmPreview();
  };
  el.addEventListener("change", connectServer);
  el.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); connectServer() } });
  paintServerBox();
})();

/* The tiles carry elevation rather than a picture of it, so changing the
   reference or color span repaints local pixels instead of refetching every
   tile. White is the chosen height; values below move red and values above
   move blue, preserving continuous relief information in either direction. */
