/* ---------------------------------------------------------------- render */
let COLLAPSED={};
const RESULT_PAGE=12;
let RESULT_SHOWN={};

/* Next overpass, projected from this location's own acquisition history.
   These are repeat-cycle sun-synchronous orbits, so the observed interval between
   passes on the same ground track is the cycle itself - no TLE propagation needed. */
function prettyPlatform(s){
  return String(s||"").replace(/^sentinel-(\d)([a-d])?$/i,(m,a,b)=>"Sentinel-"+a+(b?b.toUpperCase():""))
                      .replace(/^landsat-(\d+)$/i,"Landsat $1")
                      .replace(/^nisar$/i,"NISAR");
}
function computePasses(){
  const groups={};
  for(const it of ITEMS){
    if(it.srcKey==="gibs") continue;
    const p=it.props||{};
    const plat=p.platform||p.constellation; if(!plat) continue;
    const t=+new Date(it.date); if(!t) continue;
    const d=new Date(t);
    const track = p["sat:relative_orbit"]!=null ? "ro"+p["sat:relative_orbit"]
                : "t"+Math.round((d.getUTCHours()*60+d.getUTCMinutes())/12);
    (groups[plat+"|"+track] ||= []).push(t);
  }
  const now=Date.now(), out=[];
  for(const k in groups){
    const ts=[...new Set(groups[k])].sort((a,b)=>a-b);
    if(ts.length<2) continue;
    const dl=[]; for(let i=1;i<ts.length;i++) dl.push(ts[i]-ts[i-1]);
    dl.sort((a,b)=>a-b);
    const med=dl[Math.floor(dl.length/2)], days=med/864e5;
    if(days<0.6||days>40) continue;                 // implausible repeat cycle
    let next=ts[ts.length-1]+med; while(next<now) next+=med;
    out.push({plat:prettyPlatform(k.split("|")[0]), cycle:days, next, last:ts[ts.length-1], n:ts.length});
  }
  // one row per platform: the soonest track
  const best={};
  for(const r of out) if(!best[r.plat]||r.next<best[r.plat].next) best[r.plat]=r;
  return Object.values(best).sort((a,b)=>a.next-b.next);
}
function until(ms){
  const h=(ms-Date.now())/36e5;
  if(h<1)  return "<1 h";
  if(h<48) return Math.round(h)+" h";
  return (h/24).toFixed(1)+" d";
}
function renderPasses(){
  const el=$("#passes"), rows=computePasses();
  showPane("passes", rows.length>0);
  setCount("passes", rows.length ? rows.length+" sats" : "");
  if(!rows.length){ el.innerHTML=""; return }
  el.innerHTML=
    rows.slice(0,6).map(r=>
      `<div class="pr"><span><b>${esc(r.plat)}</b> <span style="color:var(--ink-3)">${r.cycle.toFixed(1)}-day cycle</span></span>
       <span class="w">in ${until(r.next)}</span></div>`).join("")+
    `<div class="fine">Projected from the ${rows.reduce((a,r)=>a+r.n,0)} past acquisitions over this point,
     not from orbital elements. Accurate to a few hours; acquisition is not guaranteed on every pass.</div>`;
}

function summarise(pool){
  const el=$("#summary");
  showPane("summary", pool.length>0);
  if(!pool.length){ el.innerHTML=""; return }
  const byDate=pool.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const newest=byDate[0];
  const photo=bestPhoto(pool);
  const sharp=pool.slice().sort((a,b)=>(a.gsd??1e9)-(b.gsd??1e9))[0];
  const srcs=new Set(pool.map(x=>x.src)).size;
  const row=(k,it,extra)=> it
    ? `<div class="srow" data-id="${esc(it.id)}"><span class="k">${k}</span> <b>${esc(it.label)}</b> &middot; ${ago(it.date)}${extra||""}</div>`
    : "";
  el.innerHTML =
    row("Newest", newest, ` &middot; ${res(newest.gsd)} <span style="color:var(--ink-3)">(${esc(newest.src.split(" ")[0])})</span>`)+
    row("Best photo", photo, photo ? ` &middot; ${res(photo.gsd)}${photo.cloud!=null?" &middot; "+photo.cloud.toFixed(0)+"% cloud":""}` : "")+
    row("Sharpest", sharp, ` &middot; ${res(sharp.gsd)}`)+
    `<div><span class="k">Coverage</span> ${pool.length} scenes across ${srcs} sources</div>`;
  el.querySelectorAll(".srow").forEach(r=>r.onclick=()=>{
    const i=ITEMS.findIndex(x=>x.id===r.dataset.id); if(i>=0) select(i);
  });
  setCount("summary", pool.length+" scenes");
}

/* A "photo" here means a daylight true-color scene - the ordinary satellite
   view you get on a maps app. Explicitly not radar, not night lights, not
   false-color or infrared, none of which read as a picture of the ground. */
const isPhoto = it => !!it.tiles && it.vis==="rgb" && it.kind!=="Night";
/* Ties on date go to the finer product. Sentinel-2 and HLS often carry the
   same acquisition to the minute, and 10 m beats 30 m. */
const newestOf = arr => arr.slice().sort((a,b)=>
  (new Date(b.date)-new Date(a.date)) || ((a.gsd??1e9)-(b.gsd??1e9)))[0];

/* Collections that ship a ready-made true-color composite. HLS is nominally
   true color too, but it is 30 m band maths that the provider renders with a
   gamma curve and no rescale, so it lands dark and muddy beside Sentinel-2's
   `visual` asset. Open on something that looks like the ground. */
const NATIVE_RGB = new Set(["sentinel-2-l2a","landsat-c2-l2","naip"]);

/* newest daylight true-color scene, preferring sharp and clear */
function bestPhoto(pool){
  const photo = pool.filter(isPhoto);
  if(!photo.length) return null;
  const tiers = set => {
    const sharp = set.filter(x=>(x.gsd??1e9)<=60);      // real imagery, not a 375 m weather layer
    return newestOf(sharp.filter(x=>x.cloud!=null && x.cloud<20))
        || newestOf(sharp.filter(x=>x.cloud==null || x.cloud<50))
        || newestOf(sharp)
        || newestOf(set.filter(x=>x.cloud==null || x.cloud<50))   // coarse but still true color
        || newestOf(set);
  };
  // Sentinel-2 / Landsat / NAIP first, and only fall back to the rest — HLS,
  // ASTER — when none of them covers this point in the window.
  return tiers(photo.filter(x=>NATIVE_RGB.has(x.coll))) || tiers(photo);
}

/* The scenes the result filters currently allow; the list, the Best available
   summary and the native best-imagery button all read this one pool. */
function resultPool(){
  const vonly=$("#viewable").checked, vwant=$("#vis").value;
  return ITEMS.filter(it=>(!vonly || it.tiles) && (vwant==="all" || it.vis===vwant));
}
function render(enter=false){
  clearTimeout(resultEntryTimer);
  resEl.classList.toggle("csp-results-enter",enter===true&&ITEMS.length>0);
  if(!ITEMS.length){
    resEl.innerHTML = LOC ? '<div class="empty">No imagery found.<br>Widen the date range or cloud filter.</div>'
                          : `<div class="empty">No search yet.<br>Try <b>Moses Lake</b>, <b>Zermatt</b>, or double-${MAP_TAP} the map.</div>`;
    setCount("results","");
    return;
  }
  const mode=$("#sort").value, pool=resultPool();
  const groups={};
  for(const it of pool) (groups[it.src] ||= []).push(it);
  const itemIndex=new Map(ITEMS.map((it,i)=>[it,i]));
  summarise(pool);
  const order=Object.keys(groups).sort((a,b)=>{
    const na=Math.min(...groups[a].map(x=>+new Date(x.date)));
    const xa=Math.max(...groups[a].map(x=>+new Date(x.date)));
    const xb=Math.max(...groups[b].map(x=>+new Date(x.date)));
    return xb-xa;
  });

  let h="";
  for(const g of order){
    const list=groups[g].slice().sort((a,b)=>
      mode==="res" ? ((a.gsd??1e9)-(b.gsd??1e9)) || (new Date(b.date)-new Date(a.date))
                   : (new Date(b.date)-new Date(a.date)));
    const col=!!COLLAPSED[g];
    h+=`<div class="grp" data-g="${encodeURIComponent(g)}">${esc(g)} &middot; ${list.length}<span class="car">${col?"\u25B8 show":"\u25BE hide"}</span></div>`;
    if(col) continue;
    const selectedAt=list.findIndex(it=>itemIndex.get(it)===SEL);
    const shown=Math.max(RESULT_SHOWN[g]||RESULT_PAGE, selectedAt>=0?selectedAt+1:0);
    for(const it of list.slice(0,shown)){
      const i=itemIndex.get(it);
      h+=`<div class="item ${SEL===i?'sel':''}" data-i="${i}">
        ${it.thumb?`<img class="thumb" loading="lazy" src="${esc(it.thumb)}" onerror="this.style.visibility='hidden'">`
                  :`<div class="thumb"></div>`}
        <div class="meta">
          <div class="ttl">${esc(it.label)}</div>
          <div class="dt">${esc(it.date.slice(0,10))} &nbsp;<span style="color:var(--dim)">${esc(it.date.slice(11,16))}Z</span></div>
          <div class="tags">
            <span class="tag ${freshClass(it.date)}">${ago(it.date)}</span>
            ${it.gsd!=null?`<span class="tag res">${res(it.gsd)}</span>`:""}
            ${it.kind?`<span class="tag">${esc(it.kind)}</span>`:""}
            ${it.vis&&it.vis!=="rgb"?`<span class="tag">${esc(VIS_LABEL[it.vis]||it.vis)}</span>`:""}
            ${it.cloud!=null?`<span class="tag cloud">${it.cloud.toFixed(0)}% cloud</span>`:""}
            ${!it.tiles?`<span class="tag">no map tiles</span>`:""}
          </div>
        </div>
      </div>`;
    }
    if(shown<list.length)
      h+=`<button type="button" class="more-items" data-more="${encodeURIComponent(g)}">Show ${Math.min(RESULT_PAGE,list.length-shown)} more · ${list.length-shown} remaining</button>`;
  }
  resEl.innerHTML=h;
  if(enter===true) resultEntryTimer=setTimeout(()=>{resEl.classList.remove("csp-results-enter");resultEntryTimer=0},500);
  setCount("results", pool.length ? pool.length+" of "+ITEMS.length : "");
  resEl.querySelectorAll(".item").forEach(el=>el.onclick=()=>select(+el.dataset.i));
  resEl.querySelectorAll(".grp").forEach(el=>el.onclick=()=>{
    const k=decodeURIComponent(el.dataset.g); COLLAPSED[k]=!COLLAPSED[k]; render(); });
  resEl.querySelectorAll(".more-items").forEach(el=>el.onclick=()=>{
    const k=decodeURIComponent(el.dataset.more); RESULT_SHOWN[k]=(RESULT_SHOWN[k]||RESULT_PAGE)+RESULT_PAGE; render(); });
}

async function select(i){
  const token=++sceneToken;
  sceneAbort?.abort();
  const controller=new AbortController(); sceneAbort=controller;
  if(overlayPending){ clearTimeout(overlayPending._cspReadyTimer); map.removeLayer(overlayPending); overlayPending=null }
  SEL=i; render();
  const it=ITEMS[i];
  if(!it) return;
  if(+$("#op").value===0) $("#op").value=+$("#op").dataset.lastVisible||100;
  showSceneControls();
  $("#ctlName").textContent=it.label+"  ·  "+it.src;
  $("#ctlDate").textContent=it.date.slice(0,10)+"  ("+ago(it.date)+")";
  const providerLink=safeHttpUrl(it.link);
  $("#ctlLink").innerHTML = providerLink?`<a href="${esc(providerLink)}" target="_blank" rel="noopener">Open in provider viewer &rarr;</a>`:"";

  if(footprint){map.removeLayer(footprint);footprint=null}
  mosToken++;mosAbort?.abort();cancelPendingNeighbours(); hideMenu();

  if(it.geom){
    footprint=L.geoJSON(it.geom,{style:{color:"#4a9eff",weight:1.5,fill:false,dashArray:"4 3"}}).addTo(map);
  }
  if(!it.tiles){
    clearMosaic();
    if(overlay){ map.removeLayer(overlay); overlay=null }
    $("#ctlName").textContent += "  (no map tiles)";
    return;
  }

  if(it.bbox && it.srcKey!=="gibs"){
    // keep current view unless the item is off-screen
    const b=L.latLngBounds([it.bbox[1],it.bbox[0]],[it.bbox[3],it.bbox[2]]);
    if(!map.getBounds().intersects(b)) map.fitBounds(b);
  }
  let url;
  try{ url=await tileUrl(it,controller.signal) }
  catch(e){
    if(token===sceneToken) $("#ctlName").textContent+="  (imagery unavailable — kept previous scene)";
    return;
  }
  if(token!==sceneToken) return;

  const previous=overlay, started=performance.now();
  let loaded=0, errors=0, settled=false;
  const next=resilientLayer(url,imageryLayerOptions(it,{opacity:0,
    maxZoom:VIEW_MAX,zIndex:410,attribution:it.src,keepBuffer:1,tileRetries:1}));
  trackLayerHealth(next);
  overlayPending=next;
  const settle=()=>{
    if(settled||token!==sceneToken) return;
    settled=true; clearTimeout(next._cspReadyTimer); overlayPending=null;
    const total=loaded+errors, expected=Math.max(total,Object.keys(next._tiles||{}).length);
    const ratio=expected?loaded/expected:0;
    next._cspLoadStats={loaded,errors,total,expected,ratio};
    if(!loaded||ratio<0.9){
      map.removeLayer(next);
      recordProviderOutcome(it.srcKey,performance.now()-started,false);
      $("#ctlName").textContent+="  (imagery was too incomplete — kept previous scene)";
      return;
    }
    recordProviderOutcome(it.srcKey,performance.now()-started,true);
    if(previous&&map.hasLayer(previous)) map.removeLayer(previous);
    clearMosaic();
    next.setOpacity(+$("#op").value/100);next.setZIndex(400); overlay=next;
    if(errors||loaded<expected) $("#ctlName").textContent+="  (partial footprint; basemap preserved beneath)";
    if(MOSAIC_ON||$("#mosaic").checked) fillMosaic(it);
  };
  next.on("tileload",()=>{ loaded++ });
  next.on("tileerror",()=>{ errors++ });
  next.on("load",settle);
  next.addTo(map);
  next._cspReadyTimer=setTimeout(settle,12000);
  // On a phone the sheet covers the map, so a scene would load out of sight.
  if(MOBILE.matches) document.body.classList.add("collapsed");
  if(!MOSAIC_ON&&!$("#mosaic").checked){ const s=$("#mosStat"); if(s) s.textContent="" }
}

/* ------------------------------------------------- side panel: resize + collapse */
const sideEl=$("#side"), dragEl=$("#drag");
const SIDE_MIN=520, SIDE_MAX=880, SIDE_TOGGLE_GUTTER=68, PANEL_GAP=52;
let SIDE_W=580, dragging=false;
let pointCloudPanel=null;

/* The side panel overlays a full-bleed map. Apart from allowing the map to
   shine through the panel, this keeps the map's viewport stable while the
   panel is resized or hidden: no compensating pan and no tile jump. */
function compactSidebar(){ return matchMedia("(max-width:760px)").matches }
function sideMaxWidth(){
  const css=getComputedStyle(document.documentElement), inset=name=>parseFloat(css.getPropertyValue(name))||0;
  const reserve=pointCloudPanel?.active?380+PANEL_GAP+16:SIDE_TOGGLE_GUTTER;
  const available=document.documentElement.clientWidth-inset("--safe-left")-inset("--safe-right")-reserve;
  return Math.max(SIDE_MIN,Math.min(SIDE_MAX,available));
}
function clampSideWidth(value){ return Math.max(SIDE_MIN,Math.min(sideMaxWidth(),value)) }
function syncSideWidth(width=SIDE_W){ document.documentElement.style.setProperty("--side-w",width+"px") }
function reflowMap(){ map.invalidateSize({pan:false, animate:false}) }
function syncFloatingPanels(source="right"){
  if(compactSidebar()||!pointCloudPanel)return;
  const css=getComputedStyle(document.documentElement),safeLeft=parseFloat(css.getPropertyValue("--safe-left"))||0;
  if(!pointCloudPanel.active){SIDE_W=clampSideWidth(SIDE_W);sideEl.style.width=SIDE_W+"px";syncSideWidth();restoreScenePanelPosition?.();return}
  if(document.body.classList.contains("collapsed")){
    pointCloudPanel.fitAgainstLeft(safeLeft+8,PANEL_GAP);syncSideWidth();return;
  }
  if(source==="left"){
    SIDE_W=clampSideWidth(SIDE_W);sideEl.style.width=SIDE_W+"px";syncSideWidth();pointCloudPanel.fitAgainstLeft(sideEl.getBoundingClientRect().right,PANEL_GAP);
  }else{
    pointCloudPanel.fitAgainstLeft(sideEl.getBoundingClientRect().left+SIDE_MIN,PANEL_GAP);
    const allowed=Math.max(SIDE_MIN,$("#pointCloudPanel").getBoundingClientRect().left-sideEl.getBoundingClientRect().left-PANEL_GAP);
    const actual=Math.min(SIDE_W,allowed);sideEl.style.width=actual+"px";syncSideWidth(actual);
    pointCloudPanel.fitAgainstLeft(sideEl.getBoundingClientRect().right,PANEL_GAP);
  }
  restoreScenePanelPosition?.();
}
function applySide(){
  if(compactSidebar()){ sideEl.style.width="";return }
  SIDE_W=clampSideWidth(SIDE_W);sideEl.style.width=SIDE_W+"px";syncSideWidth();syncFloatingPanels("left");reflowMap();
}

dragEl.addEventListener("mousedown", e=>{
  if(compactSidebar()) return;
  e.preventDefault(); dragging=true;
  dragEl.classList.add("act"); document.body.classList.add("dragging");
});
window.addEventListener("mousemove", e=>{
  if(!dragging) return;
  const left=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-left"))||0;
  SIDE_W=clampSideWidth(e.clientX-left);
  sideEl.style.width=SIDE_W+"px";
  syncSideWidth();
  syncFloatingPanels("left");
});
window.addEventListener("mouseup", ()=>{
  if(!dragging) return;
  dragging=false; dragEl.classList.remove("act"); document.body.classList.remove("dragging");
  reflowMap();
});
dragEl.addEventListener("dblclick", ()=>{ SIDE_W=580; applySide() });
window.addEventListener("resize",()=>{
  if(compactSidebar()){ sideEl.style.width="";return }
  const next=clampSideWidth(SIDE_W);
  if(next!==SIDE_W){ SIDE_W=next;applySide() }
});

function setCollapsed(on){
  /* In the iPhone app (docs/ios CR-001) a native sheet replaces this panel,
     which stays collapsed and out of sight. Opening it would also close the
     point cloud on a phone. Read at call time: this can run during startup. */
  if(!on&&window.CSPNativeHost) return;
  if(!on&&compactSidebar()&&pointCloudPanel?.active) pointCloudPanel.close();
  document.body.classList.toggle("collapsed", on);
  sideEl.inert=on;
  $("#sideToggle").title = (on?"Show panel":"Collapse panel")+" (Ctrl+B)";
  $("#sideToggle").setAttribute("aria-expanded",String(!on));
  reflowMap();
  syncFloatingPanels(on?"right":"left");
  restoreScenePanelPosition();
  setTimeout(()=>{reflowMap();restoreScenePanelPosition()},380);
}
/* The sidebar is a sheet on a phone, so it answers the gestures a sheet
   answers: swipe it back toward its own edge to dismiss, or tap the map beside
   it. Without these the only way out was a 44px button in the far corner.

   touch-action:pan-y on #side (see the stylesheet) is what makes this safe -
   the browser keeps vertical scrolling and only the horizontal axis is ours,
   which is the same split the point-cloud sheet needed. */
(function sidebarDismissGestures(){
  const compact=()=>matchMedia("(max-width:760px)").matches;
  let startX=0,startY=0,tracking=false,horizontal=null;
  sideEl.addEventListener("pointerdown",event=>{
    if(!compact()||event.pointerType==="mouse"||document.body.classList.contains("collapsed")) return;
    startX=event.clientX;startY=event.clientY;tracking=true;horizontal=null;
  },{passive:true});
  sideEl.addEventListener("pointermove",event=>{
    if(!tracking) return;
    const dx=event.clientX-startX,dy=event.clientY-startY;
    /* Decide the axis once, from the first decisive movement, so a diagonal
       drag does not flip between scrolling and dismissing mid-gesture. */
    if(horizontal===null){
      if(Math.abs(dx)<10&&Math.abs(dy)<10) return;
      horizontal=Math.abs(dx)>Math.abs(dy);
    }
    if(horizontal&&dx<-56){
      tracking=false;
      /* The redesign puts a detail view inside the sheet. Swiping back from
         there used to close the whole panel, so you lost the sheet AND stayed
         stranded on the detail route - reopening dropped you right back where
         you had just tried to leave. Mirror the back control when there is
         somewhere to go back to, and only dismiss from the top level. */
      const back=document.getElementById("cspBack");
      if(document.body.dataset.cspView==="detail"&&back&&getComputedStyle(back).display!=="none") back.click();
      else setCollapsed(true);
    }
  },{passive:true});
  const stop=()=>{tracking=false};
  sideEl.addEventListener("pointerup",stop,{passive:true});
  sideEl.addEventListener("pointercancel",stop,{passive:true});
  /* Tap the map beside the sheet. Pointerdown on the map, not a document
     click, so it cannot be swallowed by Leaflet's own handlers. */
  document.getElementById("map").addEventListener("pointerdown",()=>{
    if(compact()&&!document.body.classList.contains("collapsed")) setCollapsed(true);
  },{capture:true,passive:true});
})();
$("#sideToggle").setAttribute("aria-controls","side");
$("#sideToggle").setAttribute("aria-expanded","true");
$("#sideToggle").onclick=()=>setCollapsed(!document.body.classList.contains("collapsed"));

/* Reorderable floating dock. Pointer dragging follows the held button while
   neighbouring tools use FLIP motion to settle into their new slots. */
const sideToggleDock=$("#sideToggleDock"), dockEl=$("#mapDock"), serverPanel=$("#serverPanel"), serverToggle=$("#serverToggle"),
      terrainSourcePanel=$("#terrainSourcePanel"), terrainSourceToggle=$("#terrainSourceToggle");
const DOCK_ORDER_KEY="clearskies.mapToolOrder.v2";
const DOCK_DEFAULT=["mapModeToggle","quickDraw","mapInfoToggle","terrainSourceToggle","snapshot","mapTheme","bearingReset","serverToggle"];
const allDockButtons=()=>[...dockEl.querySelectorAll(".map-tool")];
const dockButtons=()=>allDockButtons().filter(el=>!el.hidden);
function saveDockOrder(){
  try{ localStorage.setItem(DOCK_ORDER_KEY,JSON.stringify(allDockButtons().map(x=>x.id))) }catch(e){}
}
function loadDockOrder(){
  let order=[];
  try{ order=JSON.parse(localStorage.getItem(DOCK_ORDER_KEY))||[] }catch(e){}
  order=[...order.filter(id=>DOCK_DEFAULT.includes(id)),...DOCK_DEFAULT.filter(id=>!order.includes(id))];
  order.forEach(id=>{ const el=document.getElementById(id); if(el) dockEl.appendChild(el) });
}
function dockRects(){ return new Map(dockButtons().map(el=>[el,el.getBoundingClientRect()])) }
function animateDockFlip(before,skip){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  dockButtons().forEach(el=>{
    if(el===skip) return;
    const a=before.get(el), b=el.getBoundingClientRect();
    if(!a||Math.abs(a.top-b.top)<.5) return;
    el.animate([{transform:`translateY(${a.top-b.top}px)`},{transform:"translateY(0)"}],
      {duration:260,easing:"cubic-bezier(.2,.85,.25,1)"});
  });
}
function moveDockTool(el,index,animate=true){
  const before=dockRects(), others=dockButtons().filter(x=>x!==el);
  index=Math.max(0,Math.min(others.length,index));
  if(index===others.length) dockEl.appendChild(el); else dockEl.insertBefore(el,others[index]);
  if(animate) animateDockFlip(before,el);
}
function positionToolPopover(panel,anchor){
  if(!panel||!anchor||panel.hidden) return;
  const a=anchor.getBoundingClientRect(),app=$("#app").getBoundingClientRect(),pad=scenePanelInsets(),gap=10;
  const w=panel.offsetWidth, h=panel.offsetHeight;
  let left=a.right-app.left+gap;
  if(left+w>app.width-pad.right) left=a.left-app.left-w-gap;
  // Keep the dock gap even when an expanded sidebar leaves too little room;
  // overlapping the sidebar is preferable to pushing controls off-screen.
  const minLeft=Math.min(pad.left,Math.max(10,a.left-app.left-w-gap));
  left=Math.max(10,Math.min(Math.max(minLeft,left),app.width-w-pad.right));
  const top=Math.max(pad.top,Math.min(a.top-app.top,app.height-h-pad.bottom));
  panel.style.right="auto";panel.style.left=Math.round(left)+"px"; panel.style.top=Math.round(top)+"px";
}
function announceToolPopover(panel){
  document.dispatchEvent(new CustomEvent("csp:tool-popover-open",{detail:{id:panel.id}}));
}
function setServerPanel(open,restoreFocus=false){
  if(open) announceToolPopover(serverPanel);
  serverPanel.hidden=!open;
  serverToggle.setAttribute("aria-expanded",String(open));
  if(open) requestAnimationFrame(()=>positionToolPopover(serverPanel,serverToggle));
  else if(restoreFocus) serverToggle.focus({preventScroll:true});
}
function setTerrainSourcePanel(open,restoreFocus=false){
  if(open) announceToolPopover(terrainSourcePanel);
  terrainSourcePanel.hidden=!open;
  terrainSourceToggle.setAttribute("aria-expanded",String(open));
  if(open){ renderTerrainSourcePanel?.(); requestAnimationFrame(()=>positionToolPopover(terrainSourcePanel,terrainSourceToggle)); }
  else if(restoreFocus) terrainSourceToggle.focus({preventScroll:true});
}
serverToggle.onclick=()=>setServerPanel(serverPanel.hidden);
$("#srvClose").onclick=()=>setServerPanel(false,true);
terrainSourceToggle.onclick=()=>setTerrainSourcePanel(terrainSourcePanel.hidden);
/* Quick draw: straight into markup on the last layer drawn on (or a new one),
   without opening the side menu. Pressed while drawing. */
const quickDrawEl=$("#quickDraw");
quickDrawEl.setAttribute("aria-haspopup","dialog");
quickDrawEl.setAttribute("aria-controls","mkBar");
quickDrawEl.setAttribute("aria-expanded","false");
quickDrawEl.onclick=()=>window.CSPMarkup?.quickDraw();
quickDrawEl.addEventListener("click",event=>{
  if(event.detail===0&&quickDrawEl.getAttribute("aria-expanded")==="true")
    document.querySelector('#mkBar [data-tool][aria-pressed="true"]')?.focus({preventScroll:true});
});
document.addEventListener("csp:markup-editing",e=>{
  const on=!!e.detail?.editing,expanded=on&&!!e.detail?.expanded;
  quickDrawEl.setAttribute("aria-pressed",String(on));
  quickDrawEl.setAttribute("aria-expanded",String(expanded));
  quickDrawEl.title=on?(expanded?"Hide markup tools":"Show markup tools"):"Draw on the map";quickDrawEl.setAttribute("aria-label",quickDrawEl.title);
});
$("#terrainSourceClose").onclick=()=>setTerrainSourcePanel(false,true);
document.addEventListener("csp:layers-changed",()=>{ if(!terrainSourcePanel.hidden) renderTerrainSourcePanel?.() });
document.addEventListener("csp:tool-popover-open",e=>{
  if(e.detail.id!==serverPanel.id) setServerPanel(false);
  if(e.detail.id!==terrainSourcePanel.id) setTerrainSourcePanel(false);
  if(e.detail.id!=="snapshotPanel") setSnapshotPanel(false);
});
document.addEventListener("pointerdown",e=>{
  if(!serverPanel.hidden&&!serverPanel.contains(e.target)&&!serverToggle.contains(e.target)) setServerPanel(false);
  if(!terrainSourcePanel.hidden&&!terrainSourcePanel.contains(e.target)&&!terrainSourceToggle.contains(e.target)) setTerrainSourcePanel(false);
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&!serverPanel.hidden){ e.preventDefault(); setServerPanel(false,true) }
  if(e.key==="Escape"&&!terrainSourcePanel.hidden){ e.preventDefault(); setTerrainSourcePanel(false,true) }
});
let dockDrag=null, suppressDockClickUntil=0;
dockEl.addEventListener("click",e=>{
  if(performance.now()<suppressDockClickUntil){ e.preventDefault(); e.stopImmediatePropagation() }
},true);
allDockButtons().forEach(el=>{
  el.setAttribute("aria-keyshortcuts","Alt+ArrowUp Alt+ArrowDown");
  el.addEventListener("keydown",e=>{
    if(!e.altKey||(e.key!=="ArrowUp"&&e.key!=="ArrowDown")) return;
    e.preventDefault();
    const old=dockButtons().indexOf(el), next=old+(e.key==="ArrowUp"?-1:1);
    if(next<0||next>=dockButtons().length) return;
    dockEl.classList.add("dock-reordering"); moveDockTool(el,next); saveDockOrder();
    setTimeout(()=>dockEl.classList.remove("dock-reordering"),280);
    requestAnimationFrame(()=>{ el.focus({preventScroll:true}); positionToolPopover(serverPanel,serverToggle) });
  });
  el.addEventListener("pointerdown",e=>{
    if(e.button!==0) return;
    const r=el.getBoundingClientRect();
    dockDrag={el,pointerId:e.pointerId,x0:e.clientX,y0:e.clientY,grabY:e.clientY-r.top,moved:false};
    try{ el.setPointerCapture(e.pointerId) }catch(err){}
  });
  el.addEventListener("pointermove",e=>{
    const d=dockDrag; if(!d||d.el!==el||d.pointerId!==e.pointerId) return;
    if(!d.moved){
      if(Math.hypot(e.clientX-d.x0,e.clientY-d.y0)<6) return;
      d.moved=true; setServerPanel(false); setSnapshotPanel(false); dockEl.classList.add("dock-reordering"); el.classList.add("dock-dragging");
      navigator.vibrate?.(8);
    }
    e.preventDefault();
    const siblings=dockButtons().filter(x=>x!==el);
    const target=siblings.reduce((n,x)=>n+(e.clientY>x.getBoundingClientRect().top+x.getBoundingClientRect().height/2),0);
    const old=dockButtons().indexOf(el);
    if(target!==old) moveDockTool(el,target);
    el.style.transform="none";
    const baseTop=el.getBoundingClientRect().top;
    el.style.transform=`translate3d(0,${e.clientY-d.grabY-baseTop}px,0) scale(1.08)`;
  });
  const finish=e=>{
    const d=dockDrag; if(!d||d.el!==el||d.pointerId!==e.pointerId) return;
    dockDrag=null;
    if(!d.moved) return;
    const visual=el.getBoundingClientRect();
    el.style.transform="none"; el.classList.remove("dock-dragging");
    const final=el.getBoundingClientRect(), dy=visual.top-final.top;
    if(!matchMedia("(prefers-reduced-motion: reduce)").matches)
      el.animate([{transform:`translateY(${dy}px) scale(1.08)`},{transform:"translateY(0) scale(1)"}],
        {duration:300,easing:"cubic-bezier(.2,.9,.25,1)"});
    suppressDockClickUntil=performance.now()+320; saveDockOrder(); navigator.vibrate?.(5);
    setTimeout(()=>dockEl.classList.remove("dock-reordering"),300);
  };
  el.addEventListener("pointerup",finish); el.addEventListener("pointercancel",finish);
});
loadDockOrder();
addEventListener("resize",()=>{
  positionToolPopover(serverPanel,serverToggle);
  positionToolPopover(terrainSourcePanel,terrainSourceToggle);
  if(!snapshotPanel?.hidden) positionSnapshotPanel();
  if(snapshotStatusEl?.textContent) positionToolPopover(snapshotStatusEl,snapshotEl);
  restoreScenePanelPosition();
});

/* The dock sits inside #map; stop tool gestures reaching Leaflet and turning
   them into map clicks, zooms, or accidental location searches. */
L.DomEvent.disableClickPropagation(dockEl); L.DomEvent.disableScrollPropagation(dockEl);
L.DomEvent.disableClickPropagation(sideToggleDock); L.DomEvent.disableScrollPropagation(sideToggleDock);
L.DomEvent.disableClickPropagation(serverPanel); L.DomEvent.disableScrollPropagation(serverPanel);
L.DomEvent.disableClickPropagation(terrainSourcePanel); L.DomEvent.disableScrollPropagation(terrainSourcePanel);
window.addEventListener("keydown", e=>{
  if((e.ctrlKey||e.metaKey) && (e.key==="b"||e.key==="B")){
    e.preventDefault(); setCollapsed(!document.body.classList.contains("collapsed"));
  }
});

/* Displayed-imagery panel. Its normalized position and open state persist;
   collapse removes the panel entirely and leaves a reorderable dock button. */
const scenePanel=$("#ctl"), sceneToggle=$("#mapInfoToggle"), sceneHead=$("#ctlHead");
const SCENE_PANEL_KEY="clearskies.scenePanel.v1";
let scenePanelState={open:true,x:null,y:null};
try{ scenePanelState={...scenePanelState,...JSON.parse(localStorage.getItem(SCENE_PANEL_KEY)||"null")} }catch(e){}
function saveScenePanel(){
  try{ localStorage.setItem(SCENE_PANEL_KEY,JSON.stringify(scenePanelState)) }catch(e){}
}
function scenePanelInsets(){
  const css=getComputedStyle(document.documentElement),num=name=>parseFloat(css.getPropertyValue(name))||0;
  const app=$("#app").getBoundingClientRect(),side=$("#side").getBoundingClientRect();
  const sideClear=!document.body.classList.contains("collapsed")&&innerWidth>760?Math.max(0,side.right-app.left)+54:0;
  return {top:num("--safe-top")+10,right:num("--safe-right")+54,bottom:num("--safe-bottom")+10,left:Math.max(num("--safe-left")+10,sideClear)};
}
function clampScenePanel(left,top,remember=true){
  if(scenePanel.hidden) return;
  const app=$("#app").getBoundingClientRect(), r=scenePanel.getBoundingClientRect(), pad=scenePanelInsets();
  const minX=pad.left,maxX=Math.max(minX,app.width-r.width-pad.right);
  const minY=pad.top,maxY=Math.max(minY,app.height-r.height-pad.bottom);
  left=Math.max(minX,Math.min(maxX,left)); top=Math.max(minY,Math.min(maxY,top));
  scenePanel.style.left=Math.round(left)+"px"; scenePanel.style.top=Math.round(top)+"px"; scenePanel.style.right="auto";
  if(remember){
    scenePanelState.x=maxX>minX?(left-minX)/(maxX-minX):0;
    scenePanelState.y=maxY>minY?(top-minY)/(maxY-minY):0;
    saveScenePanel();
  }
}
function restoreScenePanelPosition(){
  if(scenePanel.hidden) return;
  const app=$("#app").getBoundingClientRect(),r=scenePanel.getBoundingClientRect(),pad=scenePanelInsets();
  const minX=pad.left,maxX=Math.max(minX,app.width-r.width-pad.right);
  const minY=pad.top,maxY=Math.max(minY,app.height-r.height-pad.bottom);
  const x=scenePanelState.x!=null&&Number.isFinite(+scenePanelState.x)?minX+(maxX-minX)*Math.max(0,Math.min(1,+scenePanelState.x)):maxX;
  const y=scenePanelState.y!=null&&Number.isFinite(+scenePanelState.y)?minY+(maxY-minY)*Math.max(0,Math.min(1,+scenePanelState.y)):minY;
  clampScenePanel(x,y,false);
}
function setScenePanel(open,restoreFocus=false){
  scenePanelState.open=!!open; scenePanel.hidden=!open;
  sceneToggle.setAttribute("aria-expanded",String(!!open)); saveScenePanel();
  if(open) requestAnimationFrame(()=>{ restoreScenePanelPosition(); scenePanel.focus?.({preventScroll:true}) });
  else if(restoreFocus) sceneToggle.focus({preventScroll:true});
}
function showSceneControls(){
  sceneToggle.hidden=false;
  setScenePanel(scenePanelState.open!==false);
}
function hideSceneControls(){
  scenePanel.hidden=true; sceneToggle.hidden=true; sceneToggle.setAttribute("aria-expanded","false");
}
sceneToggle.onclick=()=>setScenePanel(true);
$("#ctlCollapse").onclick=e=>{ e.stopPropagation(); setScenePanel(false,true) };
let sceneDrag=null;
sceneHead.addEventListener("pointerdown",e=>{
  if(e.button!==0||e.target.closest("button,input,a,select")) return;
  e.preventDefault();
  const r=scenePanel.getBoundingClientRect();
  sceneDrag={pointerId:e.pointerId,x0:e.clientX,y0:e.clientY,left:r.left-$("#app").getBoundingClientRect().left,top:r.top-$("#app").getBoundingClientRect().top,moved:false};
  try{ sceneHead.setPointerCapture(e.pointerId) }catch(err){}
});
sceneHead.addEventListener("pointermove",e=>{
  const d=sceneDrag;if(!d||d.pointerId!==e.pointerId) return;
  const dx=e.clientX-d.x0,dy=e.clientY-d.y0;
  if(!d.moved&&Math.hypot(dx,dy)<5) return;
  d.moved=true; e.preventDefault(); scenePanel.classList.add("dragging");
  clampScenePanel(d.left+dx,d.top+dy,false);
});
function finishSceneDrag(e){
  const d=sceneDrag;if(!d||d.pointerId!==e.pointerId) return;
  sceneDrag=null; scenePanel.classList.remove("dragging");
  if(d.moved){
    const app=$("#app").getBoundingClientRect(),r=scenePanel.getBoundingClientRect();
    clampScenePanel(r.left-app.left,r.top-app.top,true);
  }
}
sceneHead.addEventListener("pointerup",finishSceneDrag);
sceneHead.addEventListener("pointercancel",finishSceneDrag);
L.DomEvent.disableClickPropagation(scenePanel);L.DomEvent.disableScrollPropagation(scenePanel);

