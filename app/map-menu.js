/* ------------------------------------------------- active fires (NIFC / WFIGS) */
const FIRE_POLY="https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
               +"WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";
const FIRE_PTS ="https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/"
               +"USA_Wildfires_v1/FeatureServer/0/query";
const FIRE_VIEW_TTL=10*60*1000;
let fireLayer=null, fireTimer=null, fireCoverage=null, fireFetchedAt=0,
    fireController=null, fireToken=0;

function arcgisUrl(base, fields, b){
  const env=`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
  return `${base}?where=1%3D1&outFields=${encodeURIComponent(fields)}&geometry=${env}`
       + `&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326`
       + `&spatialRel=esriSpatialRelIntersects&returnGeometry=true&resultRecordCount=2000&f=geojson`;
}

function fireQueryBounds(){
  /* Fetch a generous geographic halo once, then let Leaflet pan the already
     rendered vectors. Resize/move events inside this halo do no network work. */
  const padded=map.getBounds().pad(map.getZoom()<5?.2:.7);
  let west=padded.getWest(),east=padded.getEast();
  if(east-west>=360){west=-180;east=180}
  else{west=Math.max(-180,west);east=Math.min(180,east)}
  return L.latLngBounds(
    [Math.max(-85,padded.getSouth()),west],
    [Math.min(85,padded.getNorth()),east]
  );
}

function clearFires(){
  clearTimeout(fireTimer);fireTimer=null;
  fireController?.abort();fireController=null;++fireToken;
  if(fireLayer){map.removeLayer(fireLayer);fireLayer=null}
  fireCoverage=null;fireFetchedAt=0;
}

async function loadFires(force=false){
  if(!$("#fire").checked){clearFires();return}
  const viewport=map.getBounds();
  if(!force&&fireLayer&&fireCoverage?.contains(viewport)&&Date.now()-fireFetchedAt<FIRE_VIEW_TTL) return;

  fireController?.abort();
  const controller=new AbortController(),token=++fireToken,b=fireQueryBounds();
  fireController=controller;
  const num=v=>(v==null?null:Number(v));
  const request=async (url)=>{
    const response=await fetch(url,{signal:controller.signal,cache:"default"});
    if(!response.ok) throw new Error(`Fire feed returned ${response.status}`);
    const data=await response.json();
    if(data?.error) throw new Error(data.error.message||"Fire feed query failed");
    return data;
  };
  const [perimeters,incidents]=await Promise.allSettled([
    request(arcgisUrl(FIRE_POLY,"poly_IncidentName,poly_GISAcres,attr_PercentContained",b)),
    request(arcgisUrl(FIRE_PTS,"IncidentName,DailyAcres,PercentContained,FireDiscoveryDateTime",b))
  ]);
  if(controller.signal.aborted||token!==fireToken||!$("#fire").checked) return;
  if(perimeters.status!=="fulfilled"&&incidents.status!=="fulfilled") return;

  const next=L.layerGroup();
  if(perimeters.status==="fulfilled"){
    L.geoJSON(perimeters.value,{
      style:{color:"#f85149",weight:2,fillColor:"#f85149",fillOpacity:.22},
      onEachFeature:(f,l)=>{ const p=f.properties||{};
        l.bindPopup(`<b>${p.poly_IncidentName||"Fire"}</b><br>${(num(p.poly_GISAcres)||0).toLocaleString()} acres`
                   +`<br>${num(p.attr_PercentContained)??0}% contained`) }
    }).addTo(next);
  }
  if(incidents.status==="fulfilled"){
    L.geoJSON(incidents.value,{
      pointToLayer:(f,ll)=>{ const a=num((f.properties||{}).DailyAcres)||0;
        return L.circleMarker(ll,{radius:Math.max(5,Math.min(16,Math.log10(a+10)*5)),
          color:"#ff7b72",weight:2,fillColor:"#f85149",fillOpacity:.8}) },
      onEachFeature:(f,l)=>{ const p=f.properties||{};
        const name=esc(p.IncidentName||"Fire incident"),acres=(num(p.DailyAcres)||0).toLocaleString(),contained=num(p.PercentContained)??0;
        l.bindTooltip(`<b>${name}</b><br>${acres} acres · ${contained}% contained`,
                      {direction:"top",offset:[0,-7],opacity:.98,className:"csp-point-tip"});
        l.bindPopup(`<b>${name}</b><br>${acres} acres<br>${contained}% contained`) }
    }).addTo(next);
  }
  next.addTo(map);
  const previous=fireLayer;fireLayer=next;fireCoverage=b;fireFetchedAt=Date.now();
  if(previous) map.removeLayer(previous);
  if(fireController===controller) fireController=null;
}
$("#fire").onchange=()=>$("#fire").checked?loadFires(true):clearFires();
map.on("moveend", ()=>{ if($("#fire").checked){ clearTimeout(fireTimer); fireTimer=setTimeout(()=>loadFires(false),400) } });

/* ------------------------------------------ geology identification at point
   Macrostrat intentionally returns every map compilation covering a point,
   not one fabricated "best" answer. Keep a small session LRU because the
   geology is static, and abort an obsolete click so a slow response cannot
   overwrite a newer result. */
const GEOLOGY_IDENTIFY_MAX=128;
const geologyIdentifyCache=new Map();
let geologyIdentifyController=null,geologyIdentifyToken=0;

function geologyCacheGet(key){
  if(!geologyIdentifyCache.has(key)) return null;
  const value=geologyIdentifyCache.get(key);
  geologyIdentifyCache.delete(key);geologyIdentifyCache.set(key,value);
  return value;
}
function geologyCachePut(key,value){
  geologyIdentifyCache.delete(key);geologyIdentifyCache.set(key,value);
  while(geologyIdentifyCache.size>GEOLOGY_IDENTIFY_MAX)
    geologyIdentifyCache.delete(geologyIdentifyCache.keys().next().value);
}
function geologyAge(unit){
  const top=String(unit.t_int_name||"").trim(),bottom=String(unit.b_int_name||"").trim();
  const interval=top&&bottom&&top!==bottom?`${bottom}–${top}`:(top||bottom||unit.best_int_name||"Age not supplied");
  const younger=Number(unit.t_age),older=Number(unit.b_age);
  if(!Number.isFinite(younger)||!Number.isFinite(older)) return interval;
  const age=n=>n.toLocaleString(undefined,{maximumFractionDigits:n<10?3:1});
  return `${interval} · ${age(younger)}–${age(older)} Ma`;
}
function geologyColour(value){
  return /^#[0-9a-f]{6}$/i.test(String(value||""))?value:"#c98f6a";
}
function geologyResultHtml(ll,result){
  const units=result.units||[],refs=result.refs||{};
  if(!units.length) return `<div class="geo-result-head"><strong>No mapped unit returned</strong><span>${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</span></div>`+
    `<div class="note">Macrostrat has no surface compilation at this point. This does not establish that bedrock or surficial geology is absent.</div>`;
  const cards=units.map(unit=>{
    const sourceId=String(unit.source_id==null?"":unit.source_id),source=refs[sourceId]||`Macrostrat source ${sourceId||"not supplied"}`;
    const details=[geologyAge(unit),unit.lith,unit.strat_name].filter(Boolean).map(esc).join(" · ");
    return `<article class="geo-unit"><span class="geo-swatch" style="background:${geologyColour(unit.color)}"></span><div>`+
      `<div class="geo-name">${esc(unit.name||"Unnamed mapped unit")}</div>`+
      `<div class="geo-meta">${details||"No lithology supplied"}</div>`+
      `<div class="geo-source">${esc(source)}</div></div></article>`;
  }).join("");
  return `<div class="geo-result-head"><strong>${units.length} overlapping ${units.length===1?"compilation":"compilations"}</strong>`+
    `<span>${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</span></div><div class="geo-units">${cards}</div>`+
    `<div class="note">Surface map compilations overlap and vary in scale. Treat these as mapped interpretations, cite the listed source, and do not infer subsurface conditions from this readout.</div>`;
}
async function fetchGeologyAt(ll){
  const key=`${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}`,cached=geologyCacheGet(key);
  if(cached) return cached;
  geologyIdentifyController?.abort();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  geologyIdentifyController=controller;
  try{
    const url="https://macrostrat.org/api/v2/geologic_units/map"
      +`?lat=${encodeURIComponent(ll.lat)}&lng=${encodeURIComponent(ll.lng)}`;
    const response=await fetch(url,{mode:"cors",credentials:"omit",cache:"force-cache",signal:controller.signal});
    if(!response.ok) throw new Error(`Macrostrat returned HTTP ${response.status}`);
    const payload=await response.json(),envelope=payload&&typeof payload.success==="object"?payload.success:payload;
    const result={units:Array.isArray(envelope?.data)?envelope.data:[],refs:envelope?.refs||{}};
    geologyCachePut(key,result);return result;
  }finally{
    clearTimeout(timer);if(geologyIdentifyController===controller) geologyIdentifyController=null;
  }
}
async function identifyGeologyAt(ll,openPane){
  if(openPane) openResearchAt(ll); else setLoc(ll.lat,ll.lng,true);
  const output=$("#geologyOut"),button=$("#geologyIdentify"),token=++geologyIdentifyToken;
  output.innerHTML='<span class="spin"></span> Reading mapped surface units…';
  button.disabled=true;
  try{
    const result=await fetchGeologyAt(ll);
    if(token===geologyIdentifyToken) output.innerHTML=geologyResultHtml(ll,result);
  }catch(error){
    if(token!==geologyIdentifyToken||error?.name==="AbortError") return;
    output.innerHTML=`<span class="warn">Geology lookup unavailable: ${esc(error.message||"source did not respond")}.</span>`+
      '<div class="note">The map and other research tools remain available; try this point again when the connection improves.</div>';
  }finally{ if(token===geologyIdentifyToken) button.disabled=false }
}
$("#geologyIdentify").onclick=()=>identifyGeologyAt(map.getCenter(),false);

/* ------------------------------------------------- right-click map menu */
const menuEl=$("#menu");
/* The menu sits inside the map; choosing an item must not also count as a
   tap on the ground under the item. */
L.DomEvent.disableClickPropagation(menuEl);L.DomEvent.disableScrollPropagation(menuEl);
function hideMenu(){ menuEl.style.display="none" }
document.addEventListener("click", e=>{ if(!e.target.closest("#menu")) hideMenu() });
map.on("movestart zoomstart", hideMenu);
const sceneIdentity=it=>it?`${it.srcKey||it.src||""}|${it.id||""}`:"";
function menuCandidates(key,current){
  if(!current) return [];
  const all=[...(CAND[key]||[]),...ITEMS.filter(it=>it&&it.tiles&&patchKey(it)===key&&it.coll===current.coll),current];
  const seen=new Set(),out=[];
  for(const it of all){ const id=sceneIdentity(it);if(!id||seen.has(id)) continue;seen.add(id);out.push(it) }
  return out.sort(qualitySort(ITEMS[SEL]||current)).slice(0,16);
}
function positionMapMenu(clientX,clientY){
  const app=$("#app").getBoundingClientRect(),pad=scenePanelInsets();
  const x=clientX-app.left,y=clientY-app.top;
  const left=Math.max(pad.left,Math.min(x,app.width-menuEl.offsetWidth-pad.right));
  const top=Math.max(pad.top,Math.min(y,app.height-menuEl.offsetHeight-pad.bottom));
  menuEl.style.left=Math.round(left)+"px";menuEl.style.top=Math.round(top)+"px";
}
async function copyMapCoordinates(ll){
  const text=`${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
  try{ await navigator.clipboard.writeText(text) }
  catch(e){ const ta=document.createElement("textarea");ta.value=text;document.body.append(ta);ta.select();document.execCommand("copy");ta.remove() }
  setSnapshotStatus(`Copied ${text}`,3000);
}

/* The search-row coordinate controls follow the committed map point, while a
   valid coordinate pair being typed takes precedence immediately. Google Maps
   uses its documented cross-platform URL; Earth accepts decimal coordinates
   in the web search path and hands off to an installed app where supported. */
function coordinateForActions(){
  let typed;
  try{ typed=parseCoordinates($("#q").value) }catch(error){ return null }
  const ll=typed||LOC;
  return ll&&Number.isFinite(ll.lat)&&Number.isFinite(ll.lng)&&Math.abs(ll.lat)<=90&&Math.abs(ll.lng)<=180 ? ll : null;
}
function coordinateLinks(ll){
  const compact=`${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`;
  return {
    maps:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(compact)}`,
    earth:`https://earth.google.com/web/search/${compact}/`
  };
}
function hideCoordinateMenu(){
  const menu=$("#coordMenu"),button=$("#coordOpen");
  menu.hidden=true;button.setAttribute("aria-expanded","false");
}
function updateCoordinateActions(){
  const ll=coordinateForActions(),copy=$("#coordCopy"),open=$("#coordOpen");
  $("#qClear").hidden=!(LOC||$("#q").value);
  copy.disabled=open.disabled=!ll;
  const title=ll?`${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`:"Select a point or enter coordinates first";
  copy.title=ll?`Copy ${title}`:title;open.title=ll?`Open ${title}`:title;
  if(!ll){ hideCoordinateMenu();return }
  const links=coordinateLinks(ll);
  $("#coordGoogleMaps").href=links.maps;$("#coordGoogleEarth").href=links.earth;
}
$("#coordCopy").onclick=async()=>{
  const ll=coordinateForActions();if(!ll) return;
  await copyMapCoordinates(ll);
  const button=$("#coordCopy"),label=button.textContent;button.textContent="Copied";
  setTimeout(()=>{ if(button.textContent==="Copied") button.textContent=label },1400);
};
$("#coordOpen").onclick=event=>{
  event.stopPropagation();const ll=coordinateForActions();if(!ll) return;
  updateCoordinateActions();
  const menu=$("#coordMenu"),open=menu.hidden;menu.hidden=!open;
  $("#coordOpen").setAttribute("aria-expanded",String(open));
  if(open) requestAnimationFrame(()=>$("#coordGoogleMaps").focus({preventScroll:true}));
};
$("#coordMenu").querySelectorAll("a").forEach(link=>link.addEventListener("click",hideCoordinateMenu));
document.addEventListener("click",event=>{ if(!event.target.closest(".coord-launch")) hideCoordinateMenu() });
document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!$("#coordMenu").hidden){
    event.preventDefault();hideCoordinateMenu();$("#coordOpen").focus({preventScroll:true});
  }
});
function openResearchAt(ll){
  setCollapsed(false);paneState.min.research=false;applyPanes();savePanes();
  const pane=paneEl("research");pane?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"});
  setLoc(ll.lat,ll.lng,true);setCount("research",`${ll.lat.toFixed(3)}, ${ll.lng.toFixed(3)}`);
}
map.on("contextmenu",e=>{
  L.DomEvent.preventDefault(e.originalEvent);
  const ll=e.latlng,inside=it=>CSPMosaic.itemContains(it,ll.lng,ll.lat);
  let key=null,current=null,neighbour=null;
  for(const n of [...NEIGH].reverse()) if(map.hasLayer(n.layer)&&inside(n.item)){ key=n.key;current=n.item;neighbour=n;break }
  if(!key&&SEL!=null&&ITEMS[SEL]&&inside(ITEMS[SEL])){ key=patchKey(ITEMS[SEL]);current=ITEMS[SEL] }
  const list=menuCandidates(key,current),primary=ITEMS[SEL],isPrimary=!!(current&&primary&&sceneIdentity(current)===sceneIdentity(primary));
  const title=current?`${isPrimary?"Selected":"Surrounding"} scene · ${key}`:`Map point · ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
  const scenes=list.map((it,i)=>`<div class="m ${sceneIdentity(current)===sceneIdentity(it)?"cur":""}" role="menuitem" tabindex="-1" data-scene="${i}">
      <div class="a">${esc(it.label)} &middot; ${esc(it.date.slice(0,10))}</div>
      <div class="b">${ago(it.date)} &middot; ${res(it.gsd)}${it.cloud!=null?" &middot; "+it.cloud.toFixed(0)+"% cloud":""} &middot; ${esc(it.src.split(" ")[0])}</div>
    </div>`).join("");
  const place=coordinateLinks(ll);
  menuEl.innerHTML=`<div class="h">${esc(title)}</div>`+
    `<div class="m" role="menuitem" tabindex="-1" data-action="copy"><div class="a">Copy coordinates</div></div>`+
    `<div class="m" role="menuitem" tabindex="-1" data-action="maps"><div class="a">Open in Google Maps</div></div>`+
    `<div class="m" role="menuitem" tabindex="-1" data-action="earth"><div class="a">Open in Google Earth</div></div>`+
    scenes+
    (neighbour?`<div class="m" role="menuitem" tabindex="-1" data-action="remove"><div class="a">Remove this surrounding scene</div></div>`:"")+
    `<div class="m" role="menuitem" tabindex="-1" data-action="search"><div class="a">Search imagery here</div><div class="b">${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}</div></div>`+
    `<div class="m" role="menuitem" tabindex="-1" data-action="geology"><div class="a">Identify surface geology here</div><div class="b">Shows every overlapping map compilation</div></div>`+
    `<div class="m" role="menuitem" tabindex="-1" data-action="research"><div class="a">Open terrain research tools here</div></div>`+
    `<div class="m ${SEL==null?"disabled":""}" role="menuitem" tabindex="${SEL==null?"-1":"0"}" aria-disabled="${SEL==null}" data-action="fill"><div class="a">Fill surroundings for this viewport</div><div class="b">${SEL==null?"Select a scene first":"Uses the best available matching images"}</div></div>`;
  menuEl.style.display="block";positionMapMenu(e.originalEvent.clientX,e.originalEvent.clientY);
  menuEl.querySelectorAll("[role=menuitem]").forEach(el=>el.onclick=async()=>{
    if(el.getAttribute("aria-disabled")==="true") return;
    const sceneIndex=el.dataset.scene,action=el.dataset.action;hideMenu();
    if(sceneIndex!=null){
      const pick=list[+sceneIndex];if(!pick) return;
      if(isPrimary){ const idx=ITEMS.findIndex(x=>sceneIdentity(x)===sceneIdentity(pick));if(idx>=0) select(idx);else{ ITEMS.push(pick);select(ITEMS.length-1) } }
      else await swapNeighbour(key,pick);
    }else if(action==="remove"&&neighbour){ map.removeLayer(neighbour.layer);NEIGH=NEIGH.filter(x=>x!==neighbour) }
    else if(action==="search"){ setLoc(ll.lat,ll.lng);run() }
    else if(action==="copy") await copyMapCoordinates(ll);
    else if(action==="maps"||action==="earth"){
      const opened=window.open(action==="maps"?place.maps:place.earth,"_blank","noopener,noreferrer");
      if(opened) opened.opener=null;
    }
    else if(action==="geology") await identifyGeologyAt(ll,true);
    else if(action==="research") openResearchAt(ll);
    else if(action==="fill"&&SEL!=null) fillMosaic(ITEMS[SEL],true);
  });
  requestAnimationFrame(()=>menuEl.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus({preventScroll:true}));
});
/* A hardware keyboard and assistive technology should reach the same map menu
   without having to emulate a mouse. Shift+F10 opens it at map centre, matching
   the platform context-menu convention. */
map.getContainer().addEventListener("keydown",e=>{
  if(!(e.shiftKey&&e.key==="F10")) return;
  e.preventDefault();
  const r=map.getContainer().getBoundingClientRect();
  map.fire("contextmenu",{
    latlng:map.getCenter(),
    originalEvent:new MouseEvent("contextmenu",{
      clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true
    })
  });
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&menuEl.style.display!=="none"){ e.preventDefault();hideMenu();map.getContainer().focus({preventScroll:true}) }
});

/* refill when the view changes */
/* Pan and zoom change which scenes the view needs, so the mosaic is recomputed
   against the new bounds: what is still on screen stays untouched, what left is
   dropped, and only the newly exposed ground is fetched. Previously this only
   ran for the checkbox, so a fill started from the button never followed the
   map. */
map.on("moveend", ()=>{
  if((!MOSAIC_ON&&!MOSAIC_ONCE) || SEL==null) return;
  clearTimeout(mosTimer);
  mosTimer=setTimeout(()=>fillMosaic(ITEMS[SEL],MOSAIC_ONCE), 450);
});
map.on("movestart zoomstart",()=>{
  if(!mosAbort&&!PENDING_NEIGH.size) return;
  mosToken++; if(mosAbort){ mosAbort.abort(); mosAbort=null }
  cancelPendingNeighbours();
});

/* checked toggles get the tinted "on" treatment */
function syncChecks(){
  [["viewable","lb_viewable"],["fire","lb_fire"],["mosaic","lb_mosaic"]].forEach(([i,l])=>{
    const c=document.getElementById(i), b=document.getElementById(l);
    if(c&&b) b.classList.toggle("on", c.checked);
  });
}
["viewable","fire","mosaic"].forEach(i=>document.getElementById(i).addEventListener("change",syncChecks));
syncChecks();


