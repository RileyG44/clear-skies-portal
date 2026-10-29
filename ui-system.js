(function(){
"use strict";

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const icon=name=>`vendor/icons/${name}.svg`;
const compactShell=matchMedia("(max-width:1050px)");
const side=$("#side"),panes=$("#panes"),status=$("#status"),mapEl=$("#map");
const bridge=window.ClearSkiesPortalBridge;
/* The one supported shell is already present in the document. */
const ready=()=>document.documentElement.dispatchEvent(new Event("csp:ready"));
if(!side||!panes||!status||!mapEl||!bridge){
  window.CSPBoot?.fail("The portal could not initialize its map controls. Reload to recover.");return;
}

document.body.classList.add("csp-redesign");
document.documentElement.classList.add("csp-glass");
document.documentElement.style.setProperty("--side-w","660px");
side.style.width="660px";
/* The placeholder follows the field's own width, not the window's: the rail
   on a desktop is narrower than the field on a phone. A clipped "Search pla…"
   reads as broken; "Search" is what a system search field says anyway. */
{
  const q=$("#q"),long="Search places, layers…";
  q.placeholder=long;
  if(window.ResizeObserver) new ResizeObserver(([entry])=>{
    q.placeholder=entry.contentRect.width<190?"Search":long;
  }).observe(q);
}

const ROUTES={
  layers:{title:"Layers",description:"Everything currently drawn on the map, in render order.",icon:"layers",panes:[],custom:"layers"},
  satellite:{title:"Satellite imagery",description:"Find dated scenes, tune the search, and control the image already on the map.",icon:"satellite",panes:["summary","passes","results","overlays"],open:["results"],overlayGroup:"Imagery",overlayTitle:"Satellite base layers",custom:"satellite"},
  terrain:{title:"LiDAR",description:"Draw LiDAR terrain layers, fetch WA DNR surveys, and save areas for offline use.",icon:"radar",panes:["terrain"],open:["terrain"]},
  elevation:{title:"Elevation",description:"Color the ground by height or highlight it above and below a threshold.",icon:"mountain-snow",panes:["elevation"],open:["elevation"]},
  analyze:{title:"Analyze",description:"Measure landform patterns or reveal features in the current view.",icon:"scan-search",panes:["research"],open:["research"],researchMode:"analyze"},
  export:{title:"Export",description:"Capture the whole view or a selected area as a PNG at your chosen resolution.",icon:"download",panes:[],custom:"export"},
  conditions:{title:"Conditions",description:"Weather, earthquakes, volcanoes, fire, snow, and other time-sensitive layers.",icon:"cloud-sun",panes:["alerts","overlays"],open:["alerts","overlays"],overlayGroup:"Conditions",overlayTitle:"Conditions layers"},
  geology:{title:"Geology & hazards",description:"Surface geology, faults, seismic context, landslides, and point identification.",icon:"triangle-alert",panes:["overlays","research"],open:["overlays","research"],overlayGroup:"Geology & hazards",overlayTitle:"Geology layers",researchMode:"geology"},
  past:{title:"Past landscapes",description:"Ice-age lakes, glaciers, archaeology, and reconstructed environments.",icon:"history",panes:["overlays"],open:["overlays"],overlayGroup:"Past landscapes",overlayTitle:"Past landscape layers"},
  markup:{title:"Markup",description:"Draw, write and pin notes on the map, in layers you can switch on and off together or apart.",icon:"pen-line",panes:[],custom:"markup"},
  labels:{title:"Labels & reference",description:"Roads, trails, places, water, boundaries, and reference labels.",icon:"tags",panes:["overlays"],open:["overlays"],overlayGroup:"Labels & reference",overlayTitle:"Reference layers"},
  appearance:{title:"Appearance",description:"Personal preferences for this browser. They are saved on this device only.",icon:"sliders-horizontal",panes:[],custom:"appearance"},
  settings:{title:"Settings",description:"Terrain engine, export defaults and accessibility for this browser.",icon:"settings",panes:[],custom:"settings"}
};

const nav=$("#cspNav",side),navScroll=$("#cspNavScroll",side),workspace=$("#cspWorkspace",side),foot=$(".foot",nav);
const workspaceScroll=$("#cspWorkspaceScroll",workspace),customView=$("#cspCustomView",workspace);

const coordinateActions=document.createElement("div");coordinateActions.className="csp-coordinate-actions";
coordinateActions.innerHTML=`
  <button type="button" data-coordinate="copy" title="Copy coordinates" aria-label="Copy coordinates">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy</span>
  </button>
  <button type="button" data-coordinate="maps" title="Open coordinates in Google Maps" aria-label="Open coordinates in Google Maps">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15m6-12v15"/></svg><span>Maps</span>
  </button>
  <button type="button" data-coordinate="earth" title="Open coordinates in Google Earth" aria-label="Open coordinates in Google Earth">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg><span>Earth</span>
  </button>`;
navScroll.before(coordinateActions);

function navGroup(label,items){
  const group=document.createElement("div");
  group.innerHTML=`<div class="csp-nav-label">${label}</div>`;
  for(const key of items){
    const route=ROUTES[key],button=document.createElement("button");
    button.className="csp-nav-button";button.type="button";button.dataset.route=key;
    button.innerHTML=`<img src="${icon(route.icon)}" alt=""><span>${route.title}</span><span class="csp-nav-count" data-count="${key}"></span>`;
    group.append(button);
  }
  navScroll.append(group);
}
const NAV_GROUPS=[["Map",["layers","satellite","terrain","elevation","analyze","export"]],
  ["Layer groups",["conditions","geology","past","labels","markup"]]];
for(const [label,items] of NAV_GROUPS) navGroup(label,items);

const appearanceNav=document.createElement("div");appearanceNav.id="cspAppearanceNav";
appearanceNav.innerHTML=`<button class="csp-nav-button" type="button" data-route="appearance"><img src="${icon("sliders-horizontal")}" alt=""><span>Appearance</span></button>`;
appearanceNav.querySelector("button").addEventListener("click",()=>activateRoute("appearance"));
/* The engine's live status dot belongs to the map toolbar, where it is always
   in view; repeating it on this row only doubled it. */
const settingsNav=document.createElement("div");settingsNav.id="cspSettingsNav";
settingsNav.innerHTML=`<button class="csp-nav-button" type="button" data-route="settings"><img src="${icon("settings")}" alt=""><span>Settings</span></button>`;
settingsNav.querySelector("button").addEventListener("click",()=>activateRoute("settings"));
foot.prepend(appearanceNav,settingsNav);

/* Source references are the last group on the Settings page; the toolbar's
   Layers popover carries the same credits. The card is built once and kept, so
   the attribution observer below can update it while it is detached. */
const mapSources=document.createElement("div");mapSources.id="cspMapSources";mapSources.className="csp-card csp-map-sources";
mapSources.innerHTML=`<div id="cspMapSourcesContent" aria-live="polite"></div>`;
const mapSourcesContent=$("#cspMapSourcesContent",mapSources);
const syncMapSources=()=>{
  const attribution=bridge.map?.attributionControl?._container;
  const markup=attribution?.innerHTML.trim();
  const credits=[markup,document.body.classList.contains("terrain-3d")?$("#map3d .maplibregl-ctrl-attrib-inner")?.innerHTML:""].filter(Boolean).join("<br>");
  if(mapSourcesContent.innerHTML!==credits) mapSourcesContent.innerHTML=credits||"Source details will appear when a map layer is active.";
  const references=$("#mapSourceReferences");
  if(references&&references.innerHTML!==credits) references.innerHTML=credits;
};
const attributionNode=bridge.map?.attributionControl?._container;
if(attributionNode) new MutationObserver(syncMapSources).observe(attributionNode,{childList:true,subtree:true,characterData:true});
const attribution3d=$("#map3d");
if(attribution3d) new MutationObserver(syncMapSources).observe(attribution3d,{childList:true,subtree:true,characterData:true});
new MutationObserver(syncMapSources).observe(document.body,{attributes:true,attributeFilter:["class"]});
syncMapSources();

/* iOS can still honour a page-scale gesture in some embedded browser modes even
   with the viewport lock. Suppress only gestures that start on application
   chrome; the map surface stays untouched so two-finger zoom, rotate and tilt
   continue to belong to the map engine. */
for(const chrome of [side,$("#sideToggleDock"),$("#mapDock"),$("#serverPanel"),$("#terrainSourcePanel"),$("#ctl")].filter(Boolean)){
  for(const type of ["gesturestart","gesturechange","gestureend"])
    chrome.addEventListener(type,event=>event.preventDefault(),{passive:false});
  chrome.addEventListener("touchmove",event=>{if(event.touches.length>1) event.preventDefault()},{passive:false});
}

coordinateActions.addEventListener("click",event=>{
  const action=event.target.closest("button")?.dataset.coordinate;if(!action) return;
  if(action==="copy") $("#coordCopy")?.click();
  if(action==="maps"||action==="earth"){
    const link=$(action==="maps"?"#coordGoogleMaps":"#coordGoogleEarth");
    if(link?.href) window.open(link.href,"_blank","noopener,noreferrer");
  }
});

/* Coordinates put in the field by a map tap are replaced, not appended to,
   when you tap the field and start typing a place. */
{
  const q=$("#q"),coordinates=/^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/;
  q?.addEventListener("focus",()=>{if(coordinates.test(q.value)) setTimeout(()=>{if(document.activeElement===q) q.select()},0)});
}
const locateButton=$("#loc");
if(locateButton) locateButton.innerHTML=`<img src="${icon("navigation")}" alt=""><span class="csp-locate-label">Locate me</span>`;

const SEARCH_ROUTES=new Map([
  ["layers","layers"],["active layers","layers"],
  ["satellite","satellite"],["satellite imagery","satellite"],["imagery","satellite"],["scenes","satellite"],["filters","satellite"],
  ["terrain","terrain"],["lidar","terrain"],["terrain lidar","terrain"],["hillshade","terrain"],["wa dnr","terrain"],["dnr","terrain"],["point cloud","terrain"],
  ["elevation","elevation"],["elevation spectrum","elevation"],["spectrum","elevation"],["elevation highlights","elevation"],["elevation bands","elevation"],
  ["analyze","analyze"],["analysis","analyze"],["research","analyze"],
  ["export","export"],["snapshot","export"],["download","export"],
  ["conditions","conditions"],["weather","conditions"],["earthquakes","conditions"],["fire","conditions"],["snow","conditions"],
  ["geology","geology"],["hazards","geology"],["faults","geology"],["landslides","geology"],
  ["past landscapes","past"],["glaciers","past"],["ice age","past"],["archaeology","past"],
  ["labels","labels"],["reference","labels"],["roads","labels"],["boundaries","labels"],["markup","markup"],["annotate","markup"],["annotations","markup"],["draw","markup"],["drawing","markup"],["notes","markup"],
  ["settings","settings"],["preferences","settings"],["terrain engine","settings"],["server","settings"],["appearance","appearance"],["theme","appearance"],["accent","appearance"],["accent color","appearance"],["color","appearance"],["font","appearance"]
]);
function routeFromSearch(){
  const value=$("#q")?.value.trim().toLocaleLowerCase().replace(/\s+/g," ");
  const route=SEARCH_ROUTES.get(value);
  if(!route) return false;
  activateRoute(route);
  $("#q").select();
  return true;
}
$("#go")?.addEventListener("click",event=>{
  if(!routeFromSearch()) return;
  event.preventDefault();event.stopImmediatePropagation();
},true);
$("#q")?.addEventListener("keydown",event=>{
  if(event.key!=="Enter"||!routeFromSearch()) return;
  event.preventDefault();event.stopImmediatePropagation();
},true);

const PANE_TITLES={filters:"Search filters",alerts:"Live conditions",summary:"Best available",passes:"Acquisition timing",terrain:"LiDAR",elevation:"Elevation",research:"Analysis tools",overlays:"Layer catalog",results:"Satellite scenes"};
for(const [name,title] of Object.entries(PANE_TITLES)){
  const pane=$(`.pane[data-pane="${name}"]`,panes),label=$(".pane-t",pane),head=$(".pane-h",pane);
  if(label) label.textContent=title;
  if(head) head.setAttribute("aria-label",`Toggle ${title}`);
}

/* Rows in the T3 settings pattern. A legacy grid's label and the control after
   it become one row (title leading, control trailing); an on/off checkbox
   becomes a switch at the end of its row. The inputs themselves are moved,
   not copied, so their ids, listeners and saved state are unchanged. */
function wrapFieldRows(grid){
  if(!grid||grid.dataset.cspRows) return;
  grid.dataset.cspRows="1";
  for(const label of $$(":scope > label",grid)){
    const control=label.nextElementSibling;
    if(!control||control.tagName==="LABEL") continue;
    const row=document.createElement("div");row.className="csp-field-row";
    label.before(row);row.append(label,control);
  }
}
function toSwitchRow(label){
  const input=label?.querySelector('input[type="checkbox"]');
  if(!input||label.classList.contains("csp-switch-row")) return;
  const control=document.createElement("span");control.className="csp-switch";
  control.append(input,document.createElement("span"));
  input.setAttribute("role","switch");
  label.classList.add("csp-switch-row");label.append(control);
}
{
  wrapFieldRows($(".pane[data-pane='filters'] .fgrid",panes));
  for(const label of $$(".pane[data-pane='filters'] .toggles > .check,.pane[data-pane='alerts'] .alert-sources > .check,.pane[data-pane='alerts'] .alert-options > .check",panes)) toSwitchRow(label);
}

const spectrumBox=$("#elevSh")?.closest(".fabbox");if(spectrumBox) spectrumBox.id="elevSpectrumBox";
toSwitchRow($("#lb_elevSh"));
const bandsBox=$("#elevBandsBox"),surfaceBox=$("#surfaceResearchBox"),geologyBox=$("#geologyIdentifyBox");
const researchPane=$(".pane[data-pane='research']",panes),researchBody=$(".pane-b",researchPane);
const fabricBox=$("#fabricResearchBox");

for(const [group,elements] of Object.entries({
  analyze:[fabricBox,surfaceBox],
  geology:[geologyBox]
})) for(const element of elements) if(element) element.dataset.cspResearchGroup=group;

function filterResearch(mode){
  for(const element of [...researchBody.children]){
    element.classList.toggle("csp-route-hidden",element.dataset.cspResearchGroup!==mode);
  }
  const title=$(".pane-t",researchPane);
  if(title) title.textContent=mode==="geology"?"Identify geology":"Analysis tools";
}

/* Elevation colouring has its own page; its cards share one sectioned body. */
const elevationColour=$(".pane[data-pane='elevation'] .pane-b",panes);
elevationColour?.classList.add("elevation-colour");

/* The grouped native mode chooser is the terrain engine's single source of
   truth. Keeping it visible also keeps resets and shared links in sync. */
/* Terrain tools fold away when unused. Each closed row names what is active,
   and the panel remembers which rows were left open. */
const TERRAIN_SECTIONS_KEY="clearskies.terrain-sections.v1";
const terrainSections=["terLayerSettings","terDataOffline"];
let openTerrainSections=null;
try{openTerrainSections=JSON.parse(localStorage.getItem(TERRAIN_SECTIONS_KEY))}catch(error){}
for(const id of terrainSections){
  const section=document.getElementById(id);if(!section) continue;
  if(Array.isArray(openTerrainSections)) section.open=openTerrainSections.includes(id);
  section.addEventListener("toggle",()=>{
    if(section.open) syncTerrainSections();
    try{localStorage.setItem(TERRAIN_SECTIONS_KEY,JSON.stringify(terrainSections.filter(name=>document.getElementById(name)?.open)))}catch(error){}
  });
}
function syncTerrainSections(){
  const lidar=$("#terLidarState"),style=$("#terStyle");
  if(lidar&&style){
    const text=style.value==="off"?"off":style.selectedOptions[0]?.textContent||style.value;
    if(lidar.textContent!==text) lidar.textContent=text;
  }
}
$("#terStyle")?.addEventListener("change",syncTerrainSections);
syncTerrainSections();
for(const grid of $$(".terrain-look-grid")){
  while(grid.firstElementChild){
    const label=grid.firstElementChild,input=label.nextElementSibling,output=input?.nextElementSibling;
    if(!input||!output) break;
    const field=document.createElement("div"),row=document.createElement("div");
    field.className="elev-field";row.className="elev-label-row";
    row.append(label,output);field.append(row,input);grid.before(field);
  }
  grid.remove();
}
/* Sun direction and height share one dial, as on the iPhone. It drives the
   same two inputs, which it keeps for keyboard and screen reader use. */
{
  const azimuth=$("#terSunAz"),altitude=$("#terSunAlt");
  const fields=[azimuth,altitude].map(input=>input?.closest(".elev-field"));
  const dial=fields.every(Boolean)&&window.CSPLidarStudio?.sunDial?.({azimuth,altitude,
    azimuthOutput:$("#terSunAzOut"),altitudeOutput:$("#terSunAltOut")});
  if(dial){fields[0].before(dial);for(const field of fields) field.remove()}
}
const terrainHints={off:"Choose a layer to show the shape of the ground.",hs:"Shaded relief makes landforms easier to read.",hsmulti:"Light from several directions reveals landforms with fewer deep shadows.",tint:"Color the ground by height, with shaded relief.",rem:"Color the ground by height above the nearby valley floor.",slope:"Show how steep the ground is.",aspect:"Color each slope by the direction it faces.",northness:"Show how strongly slopes face north or south."};
function syncMenuHints(){
  const style=$("#terStyle")?.value,source=$("#terSrc")?.value;
  const setHint=(id,text)=>{const hint=$(id);if(hint)hint.textContent=text};
  if(style!=null)setHint("#terStyleHint",terrainHints[style]||"Trace lines of equal height at the selected interval.");
  if(source!=null)setHint("#terSrcHint",source==="auto"?"Uses fetched WA DNR in your selected areas and USGS elsewhere.":source==="3dep"?"National elevation coverage from USGS.":"Detailed USGS elevation where available; downloaded areas work offline.");
}
for(const id of ["terStyle","terSrc"]) $("#"+id)?.addEventListener("change",syncMenuHints);
$("#terReset")?.addEventListener("click",()=>requestAnimationFrame(syncMenuHints));
syncMenuHints();

let overlayGroup=null;
const overlayGroupSlug=group=>({
  "Imagery":"imagery",
  "Conditions":"conditions",
  "Geology & hazards":"geology",
  "Past landscapes":"past",
  "Labels & reference":"labels"
})[group]||"other";
function annotateOverlayGroups(){
  const list=$("#ovList");if(!list) return;
  let group="";
  for(const child of [...list.children]){
    if(child.classList.contains("ovgrp")) group=child.textContent.trim();
    child.dataset.cspGroup=overlayGroupSlug(group);
  }
}
new MutationObserver(annotateOverlayGroups).observe($("#ovList"),{childList:true});

/* Export and the camera share one dock-anchored panel. Do not reparent its
   live controls into the sidebar: that used to strand the camera's panel. */

const visited=new Set();
let currentRoute="layers";
function openDefaultPanes(route){
  if(visited.has(currentRoute)) return;
  for(const name of route.open||[]){
    const pane=$(`.pane[data-pane="${name}"]`,panes);
    if(!pane?.classList.contains("min")) continue;
    /* Opening a default pane must leave keyboard focus where the person is. */
    bridge.openPane(name);
  }
  visited.add(currentRoute);
}
/* Reset layout collapses every pane. The LiDAR, Elevation and Analyze pages
   hide their pane's header, so a collapsed pane there is a blank page with
   nothing to reopen it. Treat a reset like a fresh launch: each page opens its
   default panes again, starting with the one on screen. */
$("#resetPanes")?.addEventListener("click",()=>{
  visited.clear();
  const route=ROUTES[currentRoute];if(route) openDefaultPanes(route);
});

/* The scene filters live in the Search filters pane, and visit the Satellite
   page's search card while it is shown. They go home before anything clears
   the custom view, so code elsewhere that reads them (a map click starts a
   search on any page) always finds them in the document. */
const filtersBody=$(".pane[data-pane='filters'] .pane-b",panes);
const filterParts=[$(".fgrid",filtersBody),$(".toggles",filtersBody)].filter(Boolean);
function restoreFilters(){
  if(filtersBody&&filterParts.some(part=>part.parentElement!==filtersBody)) filtersBody.append(...filterParts);
  if(status.parentElement!==workspaceScroll) workspaceScroll.insertBefore(status,panes);
}
function clearCustom(){
  satelliteSearch?.dispatchEvent(new Event("csp:search-dismiss"));
  restoreFilters();
  customView.replaceChildren();
}

function layerSort(entries){
  let saved=[];
  try{saved=JSON.parse(localStorage.getItem("clearskies.active-layer-order.v1"))||[]}catch(error){}
  const rank=new Map(saved.map((id,index)=>[id,index]));
  return [...entries].sort((a,b)=>{
    if(a.locked!==b.locked) return a.locked?1:-1;
    const ar=rank.has(a.id)?rank.get(a.id):Number.MAX_SAFE_INTEGER,br=rank.has(b.id)?rank.get(b.id):Number.MAX_SAFE_INTEGER;
    return ar-br;
  });
}

function saveLayerOrder(ids){
  localStorage.setItem("clearskies.active-layer-order.v1",JSON.stringify(ids));
  bridge.setLayerOrder(ids);
}

function routeForLayer(layer){
  if(layer.id.startsWith("markup:")) return "markup";
  if(layer.id==="scene"||layer.id==="active-fires") return layer.id==="scene"?"satellite":"conditions";
  if(layer.id==="terrain") return "terrain";
  if(layer.id.startsWith("elevation-")) return "elevation";
  if(layer.id.startsWith("analysis:")) return "analyze";
  if(layer.id.startsWith("overlay:")){
    return (bridge.overlayCatalog().find(o=>`overlay:${o.id}`===layer.id)||{}).route||"labels";
  }
  return "layers";
}

function buildLayerCard(layer,index,entries,compact=false){
  const card=document.createElement("article");card.className="csp-layer-card";card.dataset.layerId=layer.id;
  if(layer.locked) card.classList.add("csp-layer-locked");
  if(compact) card.classList.add("csp-layer-compact");
  card.draggable=false;
  const title=layer.id!=="basemap"&&routeForLayer(layer)!=="layers"?'<button type="button" class="csp-layer-name csp-layer-title" data-action="edit"></button>':'<div class="csp-layer-name"></div>';
  const rail=layer.locked||compact?"":`<div class="csp-layer-rail"><button class="csp-layer-handle" type="button" aria-label="Reorder ${layer.name}" title="Drag to reorder"></button><div class="csp-layer-tools"><button class="csp-layer-tool" type="button" data-action="up" aria-label="Move ${layer.name} up" title="Move up" ${index===0?"disabled":""}><img src="${icon("chevron-up")}" alt=""></button><button class="csp-layer-tool" type="button" data-action="down" aria-label="Move ${layer.name} down" title="Move down" ${index===entries.length-2?"disabled":""}><img src="${icon("chevron-down")}" alt=""></button><button class="csp-layer-tool" type="button" data-action="edit" aria-label="Edit ${layer.name}" title="Edit"><img src="${icon("pencil")}" alt=""></button><button class="csp-layer-tool" type="button" data-action="reset" aria-label="Reset ${layer.name}" title="Reset"><img src="${icon("rotate-ccw")}" alt=""></button></div></div>`;
  card.innerHTML=`
    ${rail}
    <div class="csp-layer-main">${title}<div class="csp-layer-meta"></div>${layer.noOpacity?"":`<div class="csp-layer-opacity"><input class="csp-layer-range" type="range" min="0" max="100" step="1" value="${Math.round(layer.opacity)}"><output>${Math.round(layer.opacity)}%</output></div>`}</div>
    <label class="csp-switch" aria-label="Show ${layer.name}"><input type="checkbox" ${layer.visible?"checked":""} ${layer.locked?"disabled":""}><span></span></label>`;
  $(".csp-layer-name",card).textContent=layer.name;
  $(".csp-layer-meta",card).textContent=layer.meta||"";
  $(".csp-switch input",card)?.addEventListener("change",event=>{bridge.setLayerVisible(layer.id,event.target.checked);scheduleLayerRefresh(0)});
  const range=$(".csp-layer-range",card),output=$(".csp-layer-opacity output",card);
  range?.setAttribute("aria-label",`${layer.name} opacity`);
  range?.addEventListener("input",event=>{output.textContent=event.target.value+"%";bridge.setLayerOpacity(layer.id,event.target.value)});
  range?.addEventListener("change",()=>scheduleLayerRefresh(0));
  range?.addEventListener("blur",()=>scheduleLayerRefresh(0));
  card.addEventListener("click",event=>{
    const action=event.target.closest("button")?.dataset.action;if(!action) return;
    if(action==="edit") activateRoute(routeForLayer(layer));
    if(action==="reset"){bridge.resetLayer(layer.id);scheduleLayerRefresh(0)}
    if(action==="up"||action==="down"){
      const ids=entries.map(item=>item.id),from=ids.indexOf(layer.id),to=from+(action==="up"?-1:1);
      if(to<0||to>=ids.length-1) return;
      [ids[from],ids[to]]=[ids[to],ids[from]];saveLayerOrder(ids);scheduleLayerRefresh(0);
    }
  });
  const handle=$(".csp-layer-handle",card);
  handle?.addEventListener("keydown",event=>{
    if(event.key!=="ArrowUp"&&event.key!=="ArrowDown") return;
    event.preventDefault();const ids=entries.map(item=>item.id),from=ids.indexOf(layer.id),to=from+(event.key==="ArrowUp"?-1:1);
    if(to<0||to>=ids.length-1) return;[ids[from],ids[to]]=[ids[to],ids[from]];saveLayerOrder(ids);scheduleLayerRefresh(0);
  });
  /* Only the handle arms dragging; pressing anywhere else on the card selects,
     toggles or slides without starting a reorder. */
  let dragStarted=false;
  const disarm=()=>{if(!dragStarted){card.draggable=false}};
  handle?.addEventListener("pointerdown",()=>{card.draggable=true;window.addEventListener("pointerup",disarm,{once:true});window.addEventListener("blur",disarm,{once:true})});
  handle?.addEventListener("pointercancel",disarm);
  card.querySelectorAll("img").forEach(img=>{img.draggable=false});
  card.addEventListener("dragstart",event=>{if(!card.draggable){event.preventDefault();return}dragStarted=true;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",layer.id);card.classList.add("csp-dragging")});
  card.addEventListener("dragend",()=>{dragStarted=false;card.draggable=false;card.classList.remove("csp-dragging")});
  card.addEventListener("dragover",event=>{if(!layer.locked){event.preventDefault();event.dataTransfer.dropEffect="move"}});
  card.addEventListener("drop",event=>{
    event.preventDefault();const source=event.dataTransfer.getData("text/plain");if(!source||source===layer.id) return;
    const ids=entries.map(item=>item.id),from=ids.indexOf(source),to=ids.indexOf(layer.id);if(from<0||to<0) return;
    ids.splice(to,0,ids.splice(from,1)[0]);saveLayerOrder(ids);scheduleLayerRefresh(0);
  });
  return card;
}

/* The toolbar renderer owns its live source descriptions and sliders. Enhance
   those rows in place so refreshes preserve the controls and their full source
   text, while the sidebar keeps its inline metadata. */
const toolbarLayerBody=$("#terrainSourcePanelBody");
function syncToolbarLayerSources(){
  if(!toolbarLayerBody) return;
  toolbarLayerObserver.disconnect();
  try{
    const layers=new Map(bridge.activeLayers().map(layer=>[layer.id,layer]));
    let footer=$(".csp-layer-sources",toolbarLayerBody);
    if(!footer){
      footer=document.createElement("footer");footer.className="csp-layer-sources";
      footer.setAttribute("aria-label","Layer sources");toolbarLayerBody.append(footer);
    }
    const sources=[];
    for(const row of $$(".terrain-source-panel-row",toolbarLayerBody)){
      const layer=layers.get(row.dataset.id),meta=$(".terrain-source-panel-meta",row);
      let title=$(".terrain-source-panel-name",row);
      if(layer&&layer.id!=="basemap"&&routeForLayer(layer)!=="layers"&&title?.tagName!=="BUTTON"){
        const button=document.createElement("button");button.type="button";
        button.className="terrain-source-panel-name csp-layer-title";
        button.textContent=title.textContent;title.replaceWith(button);title=button;
        button.addEventListener("click",()=>{
          $("#terrainSourceClose")?.click();
          if(document.body.classList.contains("collapsed")) $("#sideToggle")?.click();
          activateRoute(routeForLayer(layer));
          $("#cspWorkspaceTitle").setAttribute("tabindex","-1");
          $("#cspWorkspaceTitle").focus({preventScroll:true});
        });
      }
      if(meta){
        meta.hidden=true;
        sources.push([title?.textContent||layer?.name||"Unnamed layer",meta.textContent]);
      }
    }
    const signature=JSON.stringify(sources);
    if(footer.dataset.signature!==signature){
      footer.dataset.signature=signature;footer.replaceChildren();
      const heading=document.createElement("h3");heading.textContent="Sources";footer.append(heading);
      for(const [name,meta] of sources){
        const row=document.createElement("div");row.className="csp-layer-source";
        const label=document.createElement("div");label.className="csp-layer-source-name";label.textContent=name;
        const detail=document.createElement("div");detail.className="csp-layer-source-meta";detail.textContent=meta;
        row.append(label,detail);footer.append(row);
      }
    }
    footer.hidden=!sources.length;
    // Keep credits and any existing explanations before this final source list.
    if(toolbarLayerBody.lastElementChild!==footer) toolbarLayerBody.append(footer);
  }finally{
    toolbarLayerObserver.observe(toolbarLayerBody,{childList:true,subtree:true,characterData:true});
  }
}
const toolbarLayerObserver=new MutationObserver(syncToolbarLayerSources);
syncToolbarLayerSources();

/* Where each card sat before a rebuild, so the new list can slide from there. */
const layerCardTops=root=>new Map($$(".csp-layer-card",root).map(card=>[card.dataset.layerId,card.getBoundingClientRect().top]));
function renderLayerStack(container,onlyScene=false,before=null){
  const entries=layerSort(bridge.activeLayers()).filter(layer=>!onlyScene||layer.id==="scene");
  container.replaceChildren();
  if(!entries.length){
    const empty=document.createElement("div");empty.className="csp-empty-layers";empty.textContent=onlyScene?"No satellite scene is displayed yet. Search below, then open a result.":"No research layers are active. The reference basemap remains available.";container.append(empty);return;
  }
  entries.forEach((layer,index)=>container.append(buildLayerCard(layer,index,entries,onlyScene)));
  if(!onlyScene) bridge.setLayerOrder(entries.map(layer=>layer.id));
  /* A reorder, a new layer or a removal moves cards rather than redrawing
     them in place: each slides from its old row, new ones fade in. */
  if(before?.size&&!calmMotion()) for(const card of $$(".csp-layer-card",container)){
    const top=before.get(card.dataset.layerId);
    if(top==null){card.animate([{opacity:0,transform:"scale(.98)"},{opacity:1,transform:"none"}],{duration:260,easing:"cubic-bezier(.32,.72,0,1)"});continue}
    const dy=top-card.getBoundingClientRect().top;
    if(Math.abs(dy)>1) card.animate([{transform:`translateY(${dy}px)`},{transform:"none"}],{duration:360,easing:"cubic-bezier(.32,.72,0,1)"});
  }
}

function availableLayersCard(){
  const card=document.createElement("div");card.className="csp-card";
  const options=[["satellite","Satellite imagery","Dated optical, radar, IR, and global mosaics"],["terrain","LiDAR","Hillshade, contours, WA DNR, and 3D"],["elevation","Elevation","Height spectrum and above/below highlights"],["conditions","Conditions","Weather, seismicity, fire, and snow"],["geology","Geology & hazards","Surface geology, faults, and landslides"],["past","Past landscapes","Glaciers, ice-age lakes, and archaeology"],["labels","Labels & reference","Roads, trails, water, places, and boundaries"],["markup","Markup","Your own drawings, notes and pins"]];
  for(const [route,name,meta] of options){
    const button=document.createElement("button");button.className="csp-available-row";button.type="button";
    button.innerHTML=`<strong>${name}</strong><img src="${icon("chevron-right")}" alt="" width="15" height="15"><span>${meta}</span>`;
    button.addEventListener("click",()=>activateRoute(route));card.append(button);
  }
  return card;
}

function renderLayersView(){
  const stack=$("#cspActiveLayerStack",customView),before=stack?layerCardTops(stack):null;
  clearCustom();
  const activeLabel=document.createElement("div");activeLabel.className="csp-section-label";activeLabel.textContent="Active layers";
  const active=document.createElement("div");active.className="csp-card";active.id="cspActiveLayerStack";
  customView.append(activeLabel,active);
  renderLayerStack(active,false,before);
  const availableLabel=document.createElement("div");availableLabel.className="csp-section-label";availableLabel.textContent="Add layers";
  customView.append(availableLabel,availableLayersCard());
}

/* Satellite: a scene search built for imagery. A place, address or pasted
   coordinate (with the main field's geocoder suggestions), a button that
   searches the map centre, and scene filters below the search field. Built
   once and kept, so a background refresh of this page never takes the field
   from under a person typing in it. */
let satelliteSearch=null;
function buildSatelliteSearch(){
  const wrap=document.createElement("section");wrap.className="csp-sat-search";wrap.setAttribute("aria-label","Scene search");
  wrap.innerHTML=`
    <div class="csp-section-label">Scene search</div>
    <div class="csp-card csp-sat-card">
      <form class="csp-sat-field" role="search">
        <img src="${icon("search")}" alt="">
        <input type="search" id="cspSatQuery" placeholder="Place or coordinates" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"
               aria-label="Find scenes by place or coordinates" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="cspSatSuggest" aria-describedby="cspSatNote">
        <button type="button" class="csp-sat-center" title="Search at the map centre" aria-label="Search scenes at the map centre">${svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')}</button>
        <button type="submit" class="csp-sat-go" title="Search" aria-label="Search scenes">${svg('<path d="M5 12h14M13 6l6 6-6 6"/>')}</button>
        <div class="csp-sat-suggest" id="cspSatSuggest" role="listbox" aria-label="Places" hidden></div>
      </form>
      <p class="csp-sat-note" id="cspSatNote" role="status" hidden></p>
      <div class="csp-sat-filters"></div>
    </div>`;
  const form=$(".csp-sat-field",wrap),input=$("#cspSatQuery",wrap),list=$("#cspSatSuggest",wrap);
  const message=$("#cspSatNote",wrap),note=text=>{message.textContent=text;message.hidden=!text};
  let places=[],active=-1,timer=0,request=null,generation=0,draft=false,draftLocationChanged=false,committedVersion=-1,committedLabel="";
  const hide=()=>{
    clearTimeout(timer);timer=0;request?.abort();request=null;generation++;
    list.hidden=true;list.replaceChildren();places=[];active=-1;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant");
    note("");
  };
  wrap.addEventListener("csp:search-dismiss",hide);
  const syncCommitted=()=>{
    const state=bridge.searchState?.()||{version:0,label:bridge.searchLabel?.()||""};
    if(state.version!==committedVersion){
      committedVersion=state.version;committedLabel=state.label;
      draft=draft&&input.value!==committedLabel;draftLocationChanged=draft;
      if(!draft){hide();input.value=committedLabel}
    }
    if(draftLocationChanged&&wrap.isConnected&&message.hidden) note(`Map location: ${committedLabel}. Search to use your draft.`);
  };
  document.addEventListener("csp:location",syncCommitted);
  wrap.addEventListener("csp:search-sync",syncCommitted);
  const highlight=()=>{
    [...list.children].forEach((option,index)=>option.setAttribute("aria-selected",String(index===active)));
    if(active>=0){input.setAttribute("aria-activedescendant",`cspSatOption${active}`);list.children[active]?.scrollIntoView({block:"nearest"})}
    else input.removeAttribute("aria-activedescendant");
  };
  const paint=()=>{
    if(!places.length){hide();return}
    list.replaceChildren(...places.map((place,index)=>{
      const option=document.createElement("div");option.setAttribute("role","option");option.id=`cspSatOption${index}`;
      option.setAttribute("aria-selected",String(index===active));
      option.innerHTML=`<span class="p"></span><span class="s"></span><span class="t"></span>`;
      option.children[0].textContent=place.primary;option.children[1].textContent=place.secondary||"";option.children[2].textContent=place.kind||"";
      option.addEventListener("mousedown",event=>event.preventDefault());
      option.addEventListener("click",()=>pick(index));
      return option;
    }));
    list.hidden=false;input.setAttribute("aria-expanded","true");
    highlight();
  };
  const pick=index=>{
    const place=places[index];if(!place) return;
    input.value=place.secondary?`${place.primary}, ${place.secondary.split(",").map(part=>part.trim()).slice(0,2).join(", ")}`:place.primary;
    draft=false;draftLocationChanged=false;hide();bridge.searchPlace?.(place);
  };
  input.addEventListener("input",()=>{
    draft=input.value!==committedLabel;
    if(!draft) draftLocationChanged=false;
    hide();
    const text=input.value.trim();
    if(text.length<3) return;
    const current=generation;
    timer=setTimeout(async()=>{
      timer=0;
      request=new AbortController();
      note("Searching places…");
      try{
        const found=await bridge.placeSuggestions?.(text,request.signal);
        if(current!==generation||input.value.trim()!==text||document.activeElement!==input||!wrap.isConnected) return;
        places=found||[];active=-1;
        if(places.length){note("");paint()}
        else if(found){hide();note("No matching suggestions. Press Enter to search.")}
      }catch(error){
        if(error?.name!=="AbortError"&&current===generation&&document.activeElement===input&&wrap.isConnected)
          note("Place search is unavailable. You can still paste coordinates.");
      }
    },260);
  });
  input.addEventListener("keydown",event=>{
    if(event.key==="ArrowDown"&&places.length){event.preventDefault();active=(active+1)%places.length;highlight()}
    else if(event.key==="ArrowUp"&&places.length){event.preventDefault();active=active<0?places.length-1:(active-1+places.length)%places.length;highlight()}
    else if(event.key==="Enter"&&active>=0){event.preventDefault();pick(active)}
    else if(event.key==="Escape"&&(!list.hidden||timer||request)){event.preventDefault();event.stopPropagation();hide()}
  });
  input.addEventListener("blur",()=>setTimeout(()=>{if(document.activeElement!==input) hide()},120));
  form.addEventListener("submit",event=>{
    event.preventDefault();hide();
    const text=input.value.trim();if(text){draft=false;draftLocationChanged=false;bridge.searchText?.(text)}
  });
  $(".csp-sat-center",wrap).addEventListener("click",()=>{draft=false;draftLocationChanged=false;hide();bridge.searchMapCenter?.();input.value=bridge.searchLabel?.()||""});
  return wrap;
}
function renderSatelliteView(){
  if(!satelliteSearch) satelliteSearch=buildSatelliteSearch();
  if(satelliteSearch.parentElement!==customView){
    clearCustom();
    customView.append(satelliteSearch);
    $(".csp-sat-filters",satelliteSearch).append(...filterParts);
    $(".csp-sat-card",satelliteSearch).insertBefore(status,$(".csp-sat-filters",satelliteSearch));
  }
  satelliteSearch?.dispatchEvent(new Event("csp:search-sync"));
  let shown=$("#cspSatelliteShown",customView);
  if(!shown){shown=document.createElement("div");shown.id="cspSatelliteShown";customView.append(shown)}
  const entries=bridge.activeLayers().filter(layer=>layer.id==="scene");
  shown.replaceChildren();
  if(!entries.length) return;
  const label=document.createElement("div");label.className="csp-section-label";label.textContent="Displayed now";
  const card=document.createElement("div");card.className="csp-card";shown.append(label,card);renderLayerStack(card,true);
}

function renderExportView(){
  clearCustom();
  const imageLabel=document.createElement("div");imageLabel.className="csp-section-label";imageLabel.textContent="Map image";
  const imageCard=document.createElement("div");imageCard.className="csp-card";
  const imageRow=document.createElement("button");imageRow.className="csp-available-row";imageRow.type="button";
  imageRow.innerHTML=`<strong>Export map image</strong><img src="${icon("chevron-right")}" alt="" width="15" height="15"><span>Capture the whole view, or select an area on the map</span>`;
  imageRow.addEventListener("click",()=>window.cspOpenSnapshotPanel?.());imageCard.append(imageRow);customView.append(imageLabel,imageCard);
  const label=document.createElement("div");label.className="csp-section-label";label.textContent="Offline terrain";
  const card=document.createElement("div");card.className="csp-card";
  const row=document.createElement("button");row.className="csp-available-row";row.type="button";
  row.innerHTML=`<strong>Download terrain for this view</strong><img src="${icon("chevron-right")}" alt="" width="15" height="15"><span>Warm the selected LiDAR source and extent for offline use</span>`;
  row.addEventListener("click",()=>{$("#terWarm")?.click();activateRoute("terrain")});card.append(row);customView.append(label,card);
}

/* Appearance. Colors, font and text size are one saved bundle on <html>; the
   boot script in index.html applies it before first paint, and this keeps the
   controls, the inline properties and the storage in step afterwards. The
   toggle color keeps its original storage key so older saved choices load. */
const APPEARANCE_KEY="clearskies.appearance.v1";
const CONTROL_ACCENT_KEY="clearskies.controlAccent.v1",CONTROL_ACCENT_DEFAULT="#4cd964";
const CONTROL_ACCENTS=[["Green","#4cd964"],["Mint","#00c7be"],["Teal","#30b0c7"],["Blue","#0a84ff"],["Indigo","#5e5ce6"],
  ["Purple","#bf5af2"],["Pink","#ff375f"],["Red","#ff453a"],["Orange","#ff9f0a"],["Yellow","#ffd60a"]];
/* The selected-location dot. White reads on dark imagery and the dark halo
   (ui-system.css) keeps it visible on snow and light basemaps; the blue is
   the dot's original color. */
const LOCATION_DOT_DEFAULT="#ffffff";
const LOCATION_DOT_SWATCHES=[["White","#ffffff"],["Blue","#4a9eff"],["Red","#ff453a"],["Orange","#ff9f0a"],["Yellow","#ffd60a"],
  ["Green","#4cd964"],["Pink","#ff375f"],["Purple","#bf5af2"],["Black","#000000"]];
const TRACK_SWATCHES=[["Auto",null],["Light grey","#d1d1d6"],["Grey","#8e8e93"],["Charcoal","#3a3a3c"],["Black","#000000"],["White","#ffffff"]];
const FONTS={
  system:{name:"System",stack:"-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Segoe UI\",sans-serif"},
  inter:{name:"Inter",stack:"\"Inter Variable\",-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif"},
  serif:{name:"Serif",stack:"Georgia,\"Times New Roman\",serif"},
  mono:{name:"Mono",stack:"ui-monospace,\"SF Mono\",\"JetBrains Mono\",monospace"}
};
const THEME_PRESETS=[
  {id:"meadow",name:"Meadow",toggle:"#4cd964",track:null,button:"#007aff"},
  {id:"ocean",name:"Ocean",toggle:"#30b0c7",track:null,button:"#0a84ff"},
  {id:"sunset",name:"Sunset",toggle:"#ff9f0a",track:null,button:"#ff453a"},
  {id:"berry",name:"Berry",toggle:"#bf5af2",track:null,button:"#ff375f"},
  {id:"graphite",name:"Graphite",toggle:"#98989d",track:"#3a3a3c",button:"#636366"}
];
const validColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||""))?String(value).toLowerCase():null;
const validAccent=validColor;
function loadAppearance(){
  const base={toggle:null,track:null,button:null,font:"system",fontColor:null,locationDot:null,textSize:1,preset:"meadow"};
  try{
    const saved=JSON.parse(localStorage.getItem(APPEARANCE_KEY)||"{}");
    if(saved&&typeof saved==="object"){
      base.toggle=validColor(saved.toggle);base.track=validColor(saved.track);base.button=validColor(saved.button);
      base.fontColor=validColor(saved.fontColor);
      base.locationDot=validColor(saved.locationDot);if(base.locationDot===LOCATION_DOT_DEFAULT) base.locationDot=null;
      if(FONTS[saved.font]) base.font=saved.font;
      if([0.92,1,1.12].includes(Number(saved.textSize))) base.textSize=Number(saved.textSize);
      if(typeof saved.preset==="string") base.preset=saved.preset;
    }
    if(!base.toggle) base.toggle=validColor(localStorage.getItem(CONTROL_ACCENT_KEY));
  }catch(error){}
  base.preset=derivePresetFor(base);
  return base;
}
/* The preset is a fact about the colors, not a stored label: untouched
   colors are Meadow, an exact preset palette is that preset, anything else
   (including a color migrated from the old single-color setting) is Custom.
   Font, text color, the location dot and text size never change it. */
function derivePresetFor(a){
  if(!a.toggle&&!a.track&&!a.button) return "meadow";
  const match=THEME_PRESETS.find(p=>p.toggle===a.toggle&&p.track===a.track&&p.button===a.button);
  return match?match.id:"custom";
}
let appearance=loadAppearance();
function controlAccent(){ return appearance.toggle||CONTROL_ACCENT_DEFAULT }
function applyAppearance(persist=true){
  const root=document.documentElement,toggle=appearance.toggle;
  if(toggle) root.style.setProperty("--csp-control-on",toggle);else root.style.removeProperty("--csp-control-on");
  if(appearance.track) root.style.setProperty("--csp-slider-track",appearance.track);else root.style.removeProperty("--csp-slider-track");
  if(appearance.button) root.style.setProperty("--ui-accent",appearance.button);else root.style.removeProperty("--ui-accent");
  if(appearance.fontColor) root.style.setProperty("--ui-text",appearance.fontColor);else root.style.removeProperty("--ui-text");
  if(appearance.locationDot) root.style.setProperty("--csp-location-dot",appearance.locationDot);else root.style.removeProperty("--csp-location-dot");
  if(appearance.font&&appearance.font!=="system") root.style.setProperty("--csp-font-family",FONTS[appearance.font].stack);else root.style.removeProperty("--csp-font-family");
  if(appearance.textSize&&appearance.textSize!==1) root.style.setProperty("--csp-text-zoom",String(appearance.textSize));else root.style.removeProperty("--csp-text-zoom");
  if(persist)try{
    const isDefault=!toggle&&!appearance.track&&!appearance.button&&!appearance.fontColor&&!appearance.locationDot&&appearance.font==="system"&&appearance.textSize===1;
    if(isDefault) localStorage.removeItem(APPEARANCE_KEY);else localStorage.setItem(APPEARANCE_KEY,JSON.stringify(appearance));
    if(toggle&&toggle!==CONTROL_ACCENT_DEFAULT) localStorage.setItem(CONTROL_ACCENT_KEY,toggle);else localStorage.removeItem(CONTROL_ACCENT_KEY);
  }catch(error){}
  syncAppearancePicker();
  document.dispatchEvent(new CustomEvent("csp:appearance",{detail:{locationDot:appearance.locationDot||LOCATION_DOT_DEFAULT}}));
}
function setAppearance(patch){
  appearance={...appearance,...patch};
  if(appearance.locationDot===LOCATION_DOT_DEFAULT) appearance.locationDot=null;
  appearance.preset=derivePresetFor(appearance);
  applyAppearance();
}
function setControlAccent(value){ setAppearance({toggle:validColor(value)}) }
function applyThemePreset(id){
  const preset=THEME_PRESETS.find(p=>p.id===id);if(!preset) return;
  setAppearance({toggle:preset.toggle,track:preset.track,button:preset.button});
}
function syncAppearancePicker(){
  const view=customView;if(!view||!$("#cspAppearanceCard",view)) return;
  const presetName=appearance.preset==="custom"?"Custom":(THEME_PRESETS.find(p=>p.id===appearance.preset)?.name||"Custom");
  const presetEl=$("#cspPresetName",view);if(presetEl) presetEl.textContent=presetName;
  $$("[data-theme-preset]",view).forEach(button=>button.setAttribute("aria-checked",String(button.dataset.themePreset===appearance.preset)));
  const values={toggle:appearance.toggle||CONTROL_ACCENT_DEFAULT,track:appearance.track,button:appearance.button||"#007aff",locationDot:appearance.locationDot||LOCATION_DOT_DEFAULT};
  for(const [key,value] of Object.entries(values)){
    $$(`[data-color-for="${key}"] [data-color]`,view).forEach(button=>{
      const swatchValue=button.dataset.color||null;
      button.setAttribute("aria-checked",String(swatchValue===value||(key==="track"&&swatchValue===""&&value===null)));
    });
    const custom=$(`[data-color-custom="${key}"]`,view);
    if(custom&&value) custom.value=value;
    const nameEl=$(`#cspColorName-${key}`,view);
    if(nameEl) nameEl.textContent=key==="track"&&!value?"Auto":((key==="locationDot"?LOCATION_DOT_SWATCHES:CONTROL_ACCENTS).find(([,hex])=>hex===value)?.[0]||value.toUpperCase());
  }
  /* the original accent picker's hooks, kept for the toggle color */
  const picker=$("#cspAccentPicker",view);
  if(picker){
    const preset=CONTROL_ACCENTS.find(([,hex])=>hex===values.toggle);
    $$("[data-accent]",picker).forEach(button=>{
      const on=button.dataset.accent===values.toggle;
      button.setAttribute("aria-checked",String(on));button.tabIndex=on||(!preset&&button===$$("[data-accent]",picker)[0])?0:-1;
    });
    const custom=$("[data-accent-custom]",picker);
    if(custom){custom.value=values.toggle;custom.closest(".csp-accent-custom")?.classList.toggle("is-selected",!preset);custom.closest(".csp-accent-custom")?.style.setProperty("--swatch",values.toggle)}
    const nameEl=$("#cspAccentName",view);if(nameEl) nameEl.textContent=preset?preset[0]:`Custom ${values.toggle.toUpperCase()}`;
  }
  const fontSelect=$("[data-font-select]",view);if(fontSelect) fontSelect.value=appearance.font;
  const fontColor=$("[data-font-color]",view);if(fontColor&&appearance.fontColor) fontColor.value=appearance.fontColor;
  $$("[data-text-size]",view).forEach(button=>button.setAttribute("aria-pressed",String(Number(button.dataset.textSize)===appearance.textSize)));
  const foot=$(".csp-setting-foot",view);
  if(foot) foot.hidden=appearance.preset==="meadow"&&!appearance.fontColor&&!appearance.locationDot&&appearance.font==="system"&&appearance.textSize===1;
}
function colorRow(key,label,desc,swatches,legacy=false){
  return `<div class="csp-setting-row">
      <div class="csp-setting-text"><strong>${label}</strong><span>${desc}</span></div>
      <span class="csp-accent-name" id="cspColorName-${key}" aria-live="polite"></span>
    </div>
    <div class="csp-accent-picker" ${legacy?`id="cspAccentPicker"`:`data-color-for="${key}"`}>
      <div class="csp-accent-presets" role="radiogroup" aria-label="${label}">
        ${swatches.map(([name,hex])=>legacy
          ?`<button type="button" class="csp-accent-swatch" role="radio" aria-checked="false" data-accent="${hex}" style="--swatch:${hex}" aria-label="${name}" title="${name}"></button>`
          :`<button type="button" class="csp-accent-swatch" role="radio" aria-checked="false" data-color="${hex||""}" style="--swatch:${hex||"transparent"}" aria-label="${name}" title="${name}"></button>`).join("")}
      </div>
      ${legacy
        ?`<label class="csp-accent-swatch csp-accent-custom" title="Choose any color"><input type="color" data-accent-custom aria-label="Custom ${label}"></label>`
        :`<label class="csp-accent-swatch csp-accent-custom" title="Choose any color"><input type="color" data-color-custom="${key}" aria-label="Custom ${label}"></label>`}
    </div>`;
}
function renderAppearanceView(){
  clearCustom();
  const label=document.createElement("div");label.className="csp-section-label";label.textContent="Theme";
  const card=document.createElement("div");card.className="csp-card csp-settings-card";card.id="cspAppearanceCard";
  card.innerHTML=`
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Preset</strong><span>Sets the colors below together. Change any one and it becomes Custom.</span></div>
      <span class="csp-accent-name" id="cspPresetName" aria-live="polite"></span>
    </div>
    <div class="csp-theme-presets" role="radiogroup" aria-label="Theme preset">
      ${THEME_PRESETS.map(p=>`<button type="button" class="csp-theme-preset" role="radio" aria-checked="false" data-theme-preset="${p.id}" style="--p-toggle:${p.toggle};--p-button:${p.button};--p-track:${p.track||"var(--ui-line)"}"><span class="csp-theme-thumb" aria-hidden="true"><i class="tt-line"></i><i class="tt-toggle"></i><i class="tt-slider"><b></b></i><i class="tt-button"></i></span>${p.name}</button>`).join("")}
    </div>
    ${colorRow("toggle","Toggle & slider color","Fills every switch knob and the filled part of a slider when it is on.",CONTROL_ACCENTS,true)}
    ${colorRow("track","Slider track color","The part of the slider bar after the thumb. Auto follows light and dark mode.",TRACK_SWATCHES)}
    ${colorRow("button","Button color","Coloured buttons, like Capture in the camera pop-up, and links.",CONTROL_ACCENTS)}
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Font</strong><span>The typeface for menus and panels. Map labels keep their own.</span></div>
      <select data-font-select aria-label="Font">${Object.entries(FONTS).map(([id,f])=>`<option value="${id}">${f.name}</option>`).join("")}</select>
    </div>
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Text color</strong><span>Overrides the main text color in both light and dark mode.</span></div>
      <span class="csp-font-color-control"><button type="button" class="linkbtn" data-font-color-auto>Auto</button><label class="csp-accent-swatch csp-accent-custom" title="Choose text color"><input type="color" data-font-color aria-label="Text color"></label></span>
    </div>
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Text size</strong><span>Scales the sidebar and pop-up panels.</span></div>
      <span class="csp-segmented" role="group" aria-label="Text size">
        <button type="button" data-text-size="0.92" aria-pressed="false">Small</button><button type="button" data-text-size="1" aria-pressed="false">Default</button><button type="button" data-text-size="1.12" aria-pressed="false">Large</button>
      </span>
    </div>
    ${colorRow("locationDot","Location dot color","The dot that marks the place you select on the map.",LOCATION_DOT_SWATCHES)}
    <div class="csp-setting-preview">
      <label class="csp-setting-row"><span>Preview</span><span class="csp-switch"><input type="checkbox" checked aria-label="Preview switch"><span></span></span></label>
      <input type="range" min="0" max="100" step="1" value="62" aria-label="Preview slider">
      <button type="button" class="snapshot-action snapshot-action-primary csp-preview-button">Capture</button>
    </div>
    <div class="csp-setting-foot"><button type="button" class="linkbtn" data-appearance-reset>Reset appearance</button></div>`;
  customView.append(card);
  organizeAppearance(card);
  card.addEventListener("click",event=>{
    const preset=event.target.closest("[data-theme-preset]");if(preset){applyThemePreset(preset.dataset.themePreset);return}
    if(event.target.closest("[data-font-color-auto]")){setAppearance({fontColor:null});return}
    if(event.target.closest("[data-appearance-reset]")){
      appearance={toggle:null,track:null,button:null,font:"system",fontColor:null,locationDot:null,textSize:1,preset:"meadow"};applyAppearance();return;
    }
    const size=event.target.closest("[data-text-size]");if(size){setAppearance({textSize:Number(size.dataset.textSize)});return}
    const swatch=event.target.closest("[data-accent]");if(swatch){setControlAccent(swatch.dataset.accent);return}
    const color=event.target.closest("[data-color]");if(color){
      const group=color.closest("[data-color-for]");if(group) setAppearance({[group.dataset.colorFor]:color.dataset.color||null});return;
    }
  });
  card.addEventListener("keydown",event=>{
    const group=event.target.closest?.(".csp-accent-presets");if(!group) return;
    const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];if(!step) return;
    const swatches=$$("button",group),index=swatches.indexOf(event.target);if(index<0) return;
    event.preventDefault();swatches[(index+step+swatches.length)%swatches.length].click();swatches[(index+step+swatches.length)%swatches.length].focus();
  });
  card.addEventListener("input",event=>{
    if(event.target.matches("[data-accent-custom]")) setControlAccent(event.target.value);
    else if(event.target.matches("[data-color-custom]")) setAppearance({[event.target.dataset.colorCustom]:validColor(event.target.value)});
    else if(event.target.matches("[data-font-color]")) setAppearance({fontColor:validColor(event.target.value)});
    else if(event.target.matches("[data-font-select]")) setAppearance({font:event.target.value});
  });
  syncAppearancePicker();syncRangeFill($("input[type=range]",card));
}
const syncAccentPicker=syncAppearancePicker;
applyAppearance(false);

/* CR-006: the same task groups as the native inset-grouped list. Move live
   nodes, including their listeners and values; never clone a form control. */
function menuSection(title,nodes,id){
  const section=document.createElement("section");section.className="csp-menu-section";
  if(id) section.id=id;
  const heading=document.createElement("h3");heading.className="csp-section-label";
  heading.textContent=title;heading.id=(id||"cspMenu"+(++menuSectionId))+"Heading";
  const card=document.createElement("div");card.className="csp-card csp-menu-card";
  section.setAttribute("aria-labelledby",heading.id);
  card.append(...nodes.filter(Boolean));section.append(heading,card);
  return section;
}
let menuSectionId=0;
function openMenuSection(details){
  if(!details) return;
  details.append(...$$(":scope > summary button",details));
  details.open=true;details.classList.add("csp-menu-root");
}
function organizeAppearance(card){
  const rows=[...card.children];
  const font=rows.findIndex(row=>row.querySelector("[data-font-select]"));
  const marker=rows.findIndex(row=>row.matches('[data-color-for="locationDot"]'))-1;
  const preview=rows.findIndex(row=>row.classList.contains("csp-setting-preview"));
  // Event delegation stays on this ancestor after its rows are regrouped.
  card.className="csp-menu-collection";
  const split=(title,items)=>{
    const section=menuSection(title,items);
    section.querySelector(".csp-card").classList.add("csp-settings-card");
    card.append(section);
  };
  split("Theme presets",rows.slice(0,2));
  split("Controls",rows.slice(2,font));
  split("Text",rows.slice(font,marker));
  split("Selected location",rows.slice(marker,preview));
  split("Preview & reset",rows.slice(preview));
}
function organizeSidebarMenus(){
  // LiDAR owns its two-card workflow in index.html and lidar-studio.js.
  // Never lift its live controls into the shared menu organizer.
  const elevation=$(".pane[data-pane=elevation] > .pane-b",panes),spectrum=$("#elevSpectrumBox");
  if(elevation&&spectrum){
    elevation.classList.add("csp-menu-page");
    const palette=$("#elevPaletteBox"),settings=$$(":scope > details",spectrum).filter(node=>node!==palette);
    // Reference and range before color choices, matching native PageLayout.
    for(const node of settings){openMenuSection(node);spectrum.append(node)}
    const anchor=document.createComment("Elevation groups");spectrum.before(anchor);
    if(palette){openMenuSection(palette);spectrum.after(menuSection("Palette & colors",[palette]))}
    anchor.replaceWith(menuSection("Elevation spectrum",[spectrum]));
    const bands=$("#elevBandsBox");
    if(bands){openMenuSection(bands);elevation.append(menuSection("Elevation highlights",[bands]))}
  }
  for(const label of $$("#panes .alert-sources > .check,#panes .alert-options > .check,#panes .research-live-toggle,#panes .elev-highlight-toggles > .check")) toSwitchRow(label);
}

/* Settings: the terrain engine (its controls keep their home in the map dock
   pop-up), export defaults, and accessibility. Appearance lives separately. */
function renderSettingsView(){
  clearCustom();
  const engineLabel=document.createElement("div");engineLabel.className="csp-section-label";engineLabel.textContent="Terrain engine";
  const engine=document.createElement("div");engine.className="csp-card csp-settings-card";
  engine.innerHTML=`
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Secure terrain engine</strong><span data-engine-state></span></div>
      <span class="csp-nav-dot csp-status-dot off" data-engine-dot aria-hidden="true"></span>
    </div>
    <div class="csp-setting-row" data-engine-address-row hidden><span class="csp-setting-text"><span>Address</span></span><span class="csp-accent-name" data-engine-address></span></div>
    <div class="csp-setting-row">
      <span class="csp-setting-text"><span>Connect, copy a private setup link, or forget this device.</span></span>
      <button type="button" class="snapshot-action" data-open-engine>Open controls</button>
    </div>`;
  /* The engine state lives in the dock pop-up; mirror it while this page is
     mounted so connecting there updates here without a revisit. */
  const syncEngine=()=>{
    if(!engine.isConnected) return;
    const state=$("#srvState")?.textContent.trim(),on=$("#srvDot")?.classList.contains("on"),url=$("#srvUrl")?.value.trim();
    $("[data-engine-state]",engine).textContent=state||(on?"Connected.":"Not connected. Your Mac self-heals locally; this saves and checks its Tailscale HTTPS address.");
    $("[data-engine-dot]",engine).className="csp-nav-dot csp-status-dot "+(on?"on":"off");
    $("[data-engine-address-row]",engine).hidden=!url;
    $("[data-engine-address]",engine).textContent=url||"";
  };
  syncEngine();
  const engineObserver=new MutationObserver(syncEngine);
  for(const el of [$("#srvState"),$("#srvDot")].filter(Boolean)) engineObserver.observe(el,{attributes:true,childList:true,characterData:true,subtree:true});
  $("#srvUrl")?.addEventListener("input",syncEngine);
  const exportLabel=document.createElement("div");exportLabel.className="csp-section-label";exportLabel.textContent="Export";
  const exportCard=document.createElement("div");exportCard.className="csp-card csp-settings-card";
  exportCard.innerHTML=`
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Default resolution</strong><span>Used the next time the camera pop-up opens.</span></div>
      <select data-export-scale aria-label="Default export resolution">
        ${[...$("#snapshotScale").options].map(option=>`<option value="${option.value}">${option.value}×</option>`).join("")}
      </select>
    </div>
    <label class="csp-setting-row">
      <span class="csp-setting-text"><strong>Map info in exports</strong><span>Coordinates, elevation and color keys in saved images.</span></span>
      <span class="csp-switch"><input type="checkbox" data-export-readout role="switch"><span></span></span>
    </label>`;
  const accessLabel=document.createElement("div");accessLabel.className="csp-section-label";accessLabel.textContent="Accessibility & data";
  const access=document.createElement("div");access.className="csp-card csp-settings-card";
  access.innerHTML=`
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Smoother panning</strong><span>While you drag, terrain is drawn at lower resolution and sharpens when the map stops. Auto does this only when dragging is slow.</span></div>
      <select data-pan-shading aria-label="Smoother panning">
        <option value="off">Off</option><option value="auto">Auto</option><option value="on">On</option>
      </select>
    </div>
    <label class="csp-setting-row">
      <span class="csp-setting-text"><strong>Reduce motion</strong><span>Calms pop-up and control animations, beyond the system setting.</span></span>
      <span class="csp-switch"><input type="checkbox" data-reduce-motion role="switch"><span></span></span>
    </label>
    <div class="csp-setting-row">
      <span class="csp-setting-text"><span>Clear Appearance, these settings, and saved panel choices on this device.</span></span>
      <button type="button" class="linkbtn" data-reset-all>Reset all preferences</button>
    </div>`;
  const sourcesLabel=document.createElement("div");sourcesLabel.className="csp-section-label";sourcesLabel.textContent="Map sources";
  const deviceLabel=document.createElement("div");deviceLabel.className="csp-section-label";deviceLabel.textContent="This device";
  const device=document.createElement("div");device.className="csp-card csp-settings-card csp-device-card";
  device.innerHTML=`
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Build</strong><span data-device-build></span></div>
      <button type="button" class="linkbtn" data-build-details aria-controls="buildDiag" aria-expanded="false">Build details</button>
    </div>
    <div class="csp-setting-row">
      <div class="csp-setting-text"><strong>Panel layout</strong><span>Restore the default order, sizes and collapsed panels.</span></div>
      <button type="button" class="linkbtn" data-reset-layout>Reset layout</button>
    </div>`;
  $("[data-device-build]",device).textContent="build "+(window.CSP_BUILD||"development");
  const buildDetails=$("[data-build-details]",device);
  const existingDiagnostics=$("#buildDiag");
  if(existingDiagnostics){device.append(existingDiagnostics);buildDetails.setAttribute("aria-expanded","true")}
  buildDetails.addEventListener("click",()=>{
    $("#buildStamp")?.click();
    const diagnostics=$("#buildDiag");
    if(diagnostics) device.append(diagnostics);
    buildDetails.setAttribute("aria-expanded",String(!!diagnostics));
  });
  $("[data-reset-layout]",device).addEventListener("click",()=>$("#resetPanes")?.click());
  customView.append(engineLabel,engine,exportLabel,exportCard,accessLabel,access,deviceLabel,device,sourcesLabel,mapSources);
  syncMapSources();syncEngine();
  $("[data-open-engine]",engine).addEventListener("click",()=>$("#serverToggle")?.click());
  const scaleSelect=$("[data-export-scale]",exportCard);
  try{scaleSelect.value=localStorage.getItem("clearskies.snapshot-scale.v1")||"2"}catch(error){}
  if(!scaleSelect.value) scaleSelect.value="2";
  scaleSelect.addEventListener("change",()=>{
    try{localStorage.setItem("clearskies.snapshot-scale.v1",scaleSelect.value)}catch(error){}
    const live=$("#snapshotScale");if(live){live.value=scaleSelect.value;live.dispatchEvent(new Event("change",{bubbles:true}))}
  });
  const readout=$("[data-export-readout]",exportCard),liveReadout=$("#snapshotReadout");
  readout.checked=!!liveReadout?.checked;
  readout.addEventListener("change",()=>{
    if(liveReadout&&liveReadout.checked!==readout.checked){liveReadout.checked=readout.checked;liveReadout.dispatchEvent(new Event("change",{bubbles:true}))}
  });
  /* Keep these defaults in step when the camera pop-up changes them first. */
  const liveScale=$("#snapshotScale");
  liveScale?.addEventListener("change",()=>{if(exportCard.isConnected) scaleSelect.value=liveScale.value});
  liveReadout?.addEventListener("change",()=>{if(exportCard.isConnected) readout.checked=liveReadout.checked});
  const motion=$("[data-reduce-motion]",access);
  motion.checked=document.documentElement.classList.contains("csp-reduce-motion");
  motion.addEventListener("change",()=>{
    document.documentElement.classList.toggle("csp-reduce-motion",motion.checked);
    try{if(motion.checked)localStorage.setItem("clearskies.reduceMotion.v1","1");else localStorage.removeItem("clearskies.reduceMotion.v1")}catch(error){}
  });
  const panShading=$("[data-pan-shading]",access);
  try{panShading.value=window.CSPGpuTerrainLayer?.panShadingMode(localStorage)||"off"}catch(error){panShading.value="off"}
  panShading.addEventListener("change",()=>{
    const mode=panShading.value;
    try{if(mode==="off")localStorage.removeItem("clearskies.panShading.v1");else localStorage.setItem("clearskies.panShading.v1",mode)}catch(error){}
    document.dispatchEvent(new CustomEvent("csp:pan-shading",{detail:{mode}}));
  });
  $("[data-reset-all]",access).addEventListener("click",()=>{
    /* Preferences and panel layout only; map content choices (overlays,
       terrain and markup state) are data, not preferences, and stay. */
    const keys=["clearskies.appearance.v1","clearskies.controlAccent.v1","clearskies.snapshot-scale.v1","clearskies.snapshot.readout.v1","clearskies.reduceMotion.v1","clearskies.panShading.v1","clearskies.workspace.v1","clearskies.terrain-sections.v1","clearskies.active-layer-order.v1","clearskies.panes.v1","clearskies.scenePanel.v1","clearskies.mapToolOrder.v2","clearskies.mapTheme.v1"];
    try{for(const key of keys) localStorage.removeItem(key);sessionStorage.removeItem("clearskies.panes.session.v1")}catch(error){}
    location.reload();
  });
}
try{if(localStorage.getItem("clearskies.reduceMotion.v1")==="1") document.documentElement.classList.add("csp-reduce-motion")}catch(error){}

function renderCustom(route){
  if(route.custom==="layers") renderLayersView();
  else if(route.custom==="satellite") renderSatelliteView();
  else if(route.custom==="export") renderExportView();
  else if(route.custom==="appearance") renderAppearanceView();
  else if(route.custom==="settings") renderSettingsView();
  else if(route.custom==="markup"){ clearCustom();const box=document.createElement("div");customView.append(box);window.CSPMarkup?.renderPanel(box) }
  else clearCustom();
}

/* A page change settles in (see csp-route-enter in ui-system.css). Not on the
   first page at launch, which the boot reveal already presents. */
let routesShown=0;
workspace.addEventListener("animationend",event=>{if(event.target===workspaceScroll) workspace.classList.remove("csp-route-enter")});
function activateRoute(key,options={}){
  const route=ROUTES[key];if(!route) return;
  if(routesShown++&&key!==currentRoute){
    workspace.classList.remove("csp-route-enter");void workspace.offsetWidth;workspace.classList.add("csp-route-enter");
  }
  currentRoute=key;overlayGroup=route.overlayGroup||null;
  document.body.dataset.cspRoute=key;
  // Other menu redesigns must not override LiDAR's cards, headings or controls.
  document.body.classList.toggle("csp-grouped-menus",key!=="terrain");
  if(compactShell.matches&&!options.stayOnNav) document.body.dataset.cspView="detail";
  $$(".csp-nav-button[data-route]").forEach(button=>button.setAttribute("aria-current",button.dataset.route===key?"page":"false"));
  $("#cspWorkspaceTitle").textContent=route.title;const descriptionEl=$("#cspWorkspaceDescription");descriptionEl.textContent=route.description;descriptionEl.hidden=!route.description;
  $$(".pane",panes).forEach(pane=>pane.classList.toggle("csp-route-hidden",!route.panes.includes(pane.dataset.pane)));
  filterResearch(route.researchMode);
  annotateOverlayGroups();
  const overlayTitle=$(".pane[data-pane='overlays'] .pane-t",panes);
  if(overlayTitle) overlayTitle.textContent=route.overlayTitle||"Layer catalog";
  bridge.refreshOverlayStatus?.();
  renderCustom(route);
  openDefaultPanes(route);
  workspaceScroll.scrollTop=0;
  updateCounts();
}

navScroll.addEventListener("click",event=>{const route=event.target.closest("[data-route]")?.dataset.route;if(route) activateRoute(route)});

/* The navigation pane's light. A soft disc trails the pointer on a slightly
   underdamped spring - it lags, overshoots a touch, and stretches along its
   own velocity when it has to catch up - and the row under the pointer turns
   into a small glass lens: a lifted capsule with a specular spot at the
   pointer, its content magnified about a fixed origin. Mouse and pen only;
   Reduce Motion disables the halo and lens entirely. */
const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)");
const calmMotion=()=>reducedMotion.matches||document.documentElement.classList.contains("csp-reduce-motion");
{
  const finePointer=matchMedia("(hover:hover) and (pointer:fine)");
  const enabled=()=>finePointer.matches&&!calmMotion()&&document.documentElement.classList.contains("csp-glass");
  const layer=document.createElement("div");layer.className="csp-halo-layer";layer.setAttribute("aria-hidden","true");
  const halo=document.createElement("div");halo.className="csp-cursor-halo";layer.append(halo);nav.prepend(layer);
  const STIFFNESS=170,DAMPING=19;   // critical damping would be 2*sqrt(170) = 26
  let target=null,position=null,velocity={x:0,y:0},frame=0,lastTime=0,lensRow=null;
  const paint=()=>{
    if(!position) return;
    const speed=Math.hypot(velocity.x,velocity.y),stretch=Math.min(speed/1500,.65);
    const angle=Math.atan2(velocity.y,velocity.x);
    halo.style.transform=`translate3d(${position.x.toFixed(1)}px,${position.y.toFixed(1)}px,0) rotate(${angle.toFixed(3)}rad) scale(${(1+stretch).toFixed(3)},${(1/(1+stretch*.55)).toFixed(3)})`;
  };
  const step=now=>{
    frame=0;if(!enabled()){reset();return}if(!target||!position) return;
    const dt=Math.min(.034,lastTime?(now-lastTime)/1000:1/60);lastTime=now;
    velocity.x+=(STIFFNESS*(target.x-position.x)-DAMPING*velocity.x)*dt;
    velocity.y+=(STIFFNESS*(target.y-position.y)-DAMPING*velocity.y)*dt;
    position.x+=velocity.x*dt;position.y+=velocity.y*dt;
    const settled=Math.hypot(target.x-position.x,target.y-position.y)<.3&&Math.hypot(velocity.x,velocity.y)<4;
    if(settled){velocity={x:0,y:0};lastTime=0}else frame=requestAnimationFrame(step);
    paint();
  };
  const setLens=(row,x)=>{
    if(row===lensRow) return;
    lensRow?.classList.remove("csp-lens");
    lensRow=row;row?.classList.add("csp-lens");
    if(row){
      const originX=Math.max(row.offsetWidth*.3,Math.min(row.offsetWidth*.7,x)),originY=row.offsetHeight/2;
      for(const child of row.children) child.style.transformOrigin=`${(originX-child.offsetLeft).toFixed(1)}px ${(originY-child.offsetTop).toFixed(1)}px`;
    }
  };
  const reset=()=>{
    cancelAnimationFrame(frame);frame=0;lastTime=0;target=null;position=null;velocity={x:0,y:0};
    halo.classList.remove("on");setLens(null);
  };
  nav.addEventListener("pointermove",event=>{
    if((event.pointerType!=="mouse"&&event.pointerType!=="pen")||!enabled()) return;
    const box=nav.getBoundingClientRect();
    target={x:(event.clientX-box.left)*nav.offsetWidth/box.width,y:(event.clientY-box.top)*nav.offsetHeight/box.height};
    if(!position) position={...target};
    halo.classList.add("on");
    if(!frame){lastTime=0;frame=requestAnimationFrame(step)}
    const row=event.target.closest?.(".csp-nav-button");
    if(!row||!nav.contains(row)){setLens(null);return}
    const rect=row.getBoundingClientRect(),x=(event.clientX-rect.left)*row.offsetWidth/rect.width,y=(event.clientY-rect.top)*row.offsetHeight/rect.height;
    setLens(row,x);
    row.style.setProperty("--lx",`${x.toFixed(1)}px`);row.style.setProperty("--ly",`${y.toFixed(1)}px`);
  });
  nav.addEventListener("pointerleave",reset);
  navScroll.addEventListener("scroll",()=>setLens(null),{passive:true});
  nav.addEventListener("scroll",()=>setLens(null),{passive:true});
  finePointer.addEventListener("change",reset);reducedMotion.addEventListener("change",reset);
  window.addEventListener("resize",reset);
  new MutationObserver(()=>{if(!enabled()) reset()}).observe(document.documentElement,{attributes:true,attributeFilter:["class"]});
}
$("#cspBack").addEventListener("click",()=>{document.body.dataset.cspView="nav"});
compactShell.addEventListener("change",event=>{if(!event.matches) delete document.body.dataset.cspView;else document.body.dataset.cspView="nav"});

/* View mode lives in the map-button capsule, as the map-type button does in
   Maps: its glyph shows the current mode, and it opens a small glass menu of
   the three. The hidden mode actions retain the terrain engine's handlers. */
const MODE_GLYPHS={
  "2d":'<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  "3d":'<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  points:'<circle cx="7.5" cy="7.5" r="1" fill="currentColor"/><circle cx="18.5" cy="5.5" r="1" fill="currentColor"/><circle cx="11.5" cy="11.5" r="1" fill="currentColor"/><circle cx="7.5" cy="16.5" r="1" fill="currentColor"/><circle cx="17.5" cy="14.5" r="1" fill="currentColor"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/>'
};
const MODES=[
  {mode:"2d",label:"2D map",detail:"Flat map with every layer",control:"#terMode2d"},
  {mode:"3d",label:"3D terrain",detail:"Tilt and fly over the relief",control:"#terMode3d"},
  {mode:"points",label:"Point cloud",detail:"LiDAR returns in 3D",control:"#terModePoints"}
];
const svg=body=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const modeToggle=$("#mapModeToggle");
const modeMenu=document.createElement("div");
modeMenu.id="mapModeMenu";modeMenu.className="tool-popover csp-mode-menu";modeMenu.hidden=true;
modeMenu.setAttribute("role","menu");modeMenu.setAttribute("aria-label","Map view");
modeMenu.innerHTML=`<div class="csp-mode-menu-title">Map view</div>`+MODES.map(item=>
  `<button type="button" role="menuitemradio" aria-checked="false" data-mode="${item.mode}">
     <span class="csp-mode-glyph">${svg(MODE_GLYPHS[item.mode])}</span>
     <span class="csp-mode-text"><span class="csp-mode-label">${item.label}</span><span class="csp-mode-detail">${item.detail}</span></span>
     <span class="csp-mode-check">${svg('<path d="M20 6 9 17l-5-5"/>')}</span>
   </button>`).join("");
($("#app")||document.body).append(modeMenu);
for(const type of ["gesturestart","gesturechange","gestureend"]) modeMenu.addEventListener(type,event=>event.preventDefault(),{passive:false});
const currentMode=()=>$("#terModePoints")?.getAttribute("aria-pressed")==="true"?"points":$("#terMode3d")?.getAttribute("aria-pressed")==="true"?"3d":"2d";
function placeModeMenu(){
  if(!modeToggle||modeMenu.hidden) return;
  // beside the capsule, top-aligned with the button, kept inside the window
  const a=modeToggle.getBoundingClientRect(),app=($("#app")||document.body).getBoundingClientRect();
  const w=modeMenu.offsetWidth,h=modeMenu.offsetHeight,gap=10,pad=8;
  let left=a.left-app.left-w-gap;
  if(left<pad) left=a.right-app.left+gap;
  left=Math.max(pad,Math.min(left,app.width-w-pad));
  const top=Math.max(pad,Math.min(a.top-app.top,app.height-h-pad));
  modeMenu.style.left=`${Math.round(left)}px`;modeMenu.style.top=`${Math.round(top)}px`;modeMenu.style.right="auto";
}
function setModeMenu(open,{focus=false,restore=false}={}){
  if(!modeToggle) return;
  if(open) bridge.announceToolPopover?.(modeMenu);
  modeMenu.hidden=!open;
  modeToggle.setAttribute("aria-expanded",String(open));
  if(open){
    syncModeBar();placeModeMenu();
    if(focus) $('[aria-checked="true"]',modeMenu)?.focus();
  }else if(restore) modeToggle.focus({preventScroll:true});
}
modeToggle?.addEventListener("click",event=>{
  event.stopPropagation();
  // keyboard activation lands focus in the menu; a pointer does not need it
  setModeMenu(modeMenu.hidden,{focus:event.detail===0});
});
modeMenu.addEventListener("click",event=>{
  const item=event.target.closest("[data-mode]");if(!item) return;
  const target=MODES.find(entry=>entry.mode===item.dataset.mode);
  /* The mode buttons live inside the sheet. A bubbling click reached the
     sheet's tap-to-open handler while it peeked, and opening the sheet on a
     phone closes the point cloud that the same click had just opened. */
  if(target&&currentMode()!==target.mode) $(target.control)?.dispatchEvent(new MouseEvent("click",{bubbles:false,cancelable:true}));
  syncModeBar();
  setModeMenu(false,{restore:event.detail===0});
});
modeMenu.addEventListener("keydown",event=>{
  const items=$$("[data-mode]",modeMenu),index=items.indexOf(document.activeElement);
  if(event.key==="Escape"){setModeMenu(false,{restore:true});event.preventDefault();return}
  if(event.key==="ArrowDown"||event.key==="ArrowUp"){
    const next=items[(index+(event.key==="ArrowDown"?1:items.length-1))%items.length];
    next?.focus();event.preventDefault();
  }
});
document.addEventListener("pointerdown",event=>{
  if(!modeMenu.hidden&&!modeMenu.contains(event.target)&&!modeToggle?.contains(event.target)) setModeMenu(false);
},true);
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!modeMenu.hidden) setModeMenu(false,{restore:true})});
document.addEventListener("csp:tool-popover-open",event=>{if(event.detail.id!==modeMenu.id)setModeMenu(false)});
addEventListener("resize",placeModeMenu);
function syncModeBar(){
  syncTerrainSections();
  const mode=currentMode(),entry=MODES.find(item=>item.mode===mode);
  $$("[data-mode]",modeMenu).forEach(item=>item.setAttribute("aria-checked",String(item.dataset.mode===mode)));
  if(modeToggle&&modeToggle.dataset.mode!==mode){
    modeToggle.dataset.mode=mode;
    modeToggle.innerHTML=svg(MODE_GLYPHS[mode]);
    modeToggle.title=modeToggle.ariaLabel=`Map view: ${entry.label}`;
    modeToggle.setAttribute("aria-label",`Map view: ${entry.label}`);
  }
}

let refreshTimer=0,lastLayerSignature="";
function scheduleLayerRefresh(delay=80){
  clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{
    if(document.activeElement?.classList.contains("csp-layer-range")) return;
    const signature=JSON.stringify([currentRoute,layerSort(bridge.activeLayers())]);
    if(signature!==lastLayerSignature){
      lastLayerSignature=signature;
      if(currentRoute==="layers")renderLayersView();else if(currentRoute==="satellite")renderSatelliteView();
    }
    updateCounts();syncModeBar();
  },delay);
}

function updateCounts(){
  const active=bridge.activeLayers(),catalog=bridge.overlayCatalog();
  const set=(key,value)=>{const el=$(`[data-count="${key}"]`);if(el) el.textContent=value||""};
  set("layers",String(active.filter(layer=>!layer.locked).length));
  set("satellite",($("#n_results")?.textContent||"").match(/\d[\d,]*/)?.[0]||"");
  set("terrain",active.some(layer=>layer.id==="terrain")?"1":"");
  const elevationCount=active.filter(layer=>layer.id.startsWith("elevation-")).length;
  set("elevation",elevationCount?String(elevationCount):"");
  const analysisCount=active.filter(layer=>layer.id.startsWith("analysis:")).length;set("analyze",analysisCount?String(analysisCount):"");
  const markupCount=active.filter(layer=>layer.id.startsWith("markup:")).length;set("markup",markupCount?String(markupCount):"");
  // The Satellite count is its search results; the overlay groups count active layers.
  for(const key of new Set(catalog.map(item=>item.route).filter(route=>route&&route!=="satellite"))){
    const ids=new Set(catalog.filter(item=>item.route===key).map(item=>`overlay:${item.id}`));
    const count=active.filter(layer=>ids.has(layer.id)).length;set(key,count?String(count):"");
  }
  const copy=coordinateActions.querySelector('[data-coordinate="copy"]'),maps=coordinateActions.querySelector('[data-coordinate="maps"]'),earth=coordinateActions.querySelector('[data-coordinate="earth"]');
  const coordinateUnavailable=$("#coordOpen")?.disabled!==false;
  if(copy) copy.hidden=$("#coordCopy")?.disabled!==false;
  if(maps) maps.hidden=coordinateUnavailable||!$("#coordGoogleMaps")?.href;
  if(earth) earth.hidden=coordinateUnavailable||!$("#coordGoogleEarth")?.href;
  coordinateActions.hidden=[copy,maps,earth].every(button=>!button||button.hidden);
}

for(const element of [$("#coordCopy"),$("#coordOpen"),$("#coordGoogleMaps"),$("#coordGoogleEarth")]){
  if(element) new MutationObserver(updateCounts).observe(element,{attributes:true,attributeFilter:["disabled","href"]});
}

document.addEventListener("input",event=>{if(event.target.closest("#side")||event.target.closest("#pointCloudPanel")) scheduleLayerRefresh(120)},true);
document.addEventListener("change",()=>scheduleLayerRefresh(0),true);
document.addEventListener("csp:layers-changed",()=>scheduleLayerRefresh(80));
/* Other modules can send the person to a section, e.g. Draw with no markup layer yet. */
document.addEventListener("csp:open-route",event=>{
  activateRoute(event.detail?.route);
  if(document.body.classList.contains("collapsed")) $("#sideToggle")?.click();
});
new MutationObserver(()=>scheduleLayerRefresh(80)).observe($("#ctl"),{attributes:true,childList:true,subtree:true,characterData:true});
new MutationObserver(()=>scheduleLayerRefresh(80)).observe($("#panes"),{attributes:true,subtree:true,attributeFilter:["class","hidden","aria-pressed"]});
if($("#n_results")) new MutationObserver(updateCounts).observe($("#n_results"),{childList:true,characterData:true,subtree:true});

/* Slider groove fill. A range cannot style its own filled portion in WebKit,
   so the value is mirrored into --csp-fill. Scripts that set a value (resets,
   presets, restored links) fire no input event, so the value setter itself
   refreshes the fill, and a changed min or max does the same. */
function syncRangeFill(input){
  if(!input) return;
  const min=+input.min||0,max=input.max===""?100:+input.max,value=+input.value;
  const ratio=max>min?Math.max(0,Math.min(1,(value-min)/(max-min))):0;
  const fill=`${Math.round(ratio*1000)/10}%`,share=String(Math.round(ratio*10000)/10000);
  if(input.style.getPropertyValue("--csp-fill")!==fill) input.style.setProperty("--csp-fill",fill);
  if(input.style.getPropertyValue("--csp-fill-n")!==share) input.style.setProperty("--csp-fill-n",share);
}
const syncAllRangeFills=()=>{for(const input of document.querySelectorAll('input[type="range"]')) syncRangeFill(input)};
document.addEventListener("input",event=>{if(event.target.matches?.('input[type="range"]')) syncRangeFill(event.target)},true);
{
  const value=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
  Object.defineProperty(HTMLInputElement.prototype,"value",{...value,set(next){value.set.call(this,next);if(this.type==="range") syncRangeFill(this)}});
}
new MutationObserver(records=>{for(const record of records) if(record.target.type==="range") syncRangeFill(record.target)})
  .observe(document.body,{attributes:true,subtree:true,attributeFilter:["min","max","value"]});
/* Panels that rebuild their sliders (markup tools, layer cards, popovers) are
   filled as the new inputs arrive. */
const rangeArrivals=new MutationObserver(records=>{
  for(const record of records) for(const node of record.addedNodes){
    if(node.nodeType!==1) continue;
    if(node.matches('input[type="range"]')) syncRangeFill(node);
    else node.querySelectorAll('input[type="range"]').forEach(syncRangeFill);
  }
});
for(const root of [side,$("#mkBar"),$("#pointCloudPanel"),$("#terrainSourcePanel"),$("#ctl")].filter(Boolean))
  rangeArrivals.observe(root,{childList:true,subtree:true});
syncAllRangeFills();

/* Phone bottom sheet, modelled on the Maps sheet in iOS 26. Three resting
   heights:

     peek    - "collapsed": the grabber and the search field (or the current
               page's title) stay above the bottom edge.
     medium  - about half the screen, the top of the map still in view.
     large   - nearly full height.

   Like Maps, the sheet is moved by dragging anywhere on it, not just the
   grabber. At peek and medium a vertical drag always moves the sheet (the
   content does not scroll at medium - swipe up for large). At large the
   content scrolls, and once it is scrolled to the top, pulling down takes
   the sheet with it. The finger's speed at release is projected forward and
   the sheet settles on the detent nearest that point, so a flick carries it
   on and a slow drag lands where it is let go. Past the ends it rubber-bands.

   Closing and opening still go through the existing toggle, so every other
   close path (tapping the map, the back swipe, the point-cloud viewer) lands
   on peek. A phone on its side uses the leading-edge card instead and keeps
   hide-and-toggle, because a peek strip would cover most of its height. */
const phoneSheet=matchMedia("(max-width:760px)");
const peekLayout=matchMedia("(max-width:760px) and (orientation:portrait)");
const glassOn=()=>document.documentElement.classList.contains("csp-glass");
const isCollapsed=()=>document.body.classList.contains("collapsed");
const sheetMode=()=>peekLayout.matches&&glassOn();
const peeking=()=>sheetMode()&&isCollapsed();
const toggleSheet=()=>$("#sideToggle")?.click();
const grabber=document.createElement("button");
grabber.id="cspGrabber";grabber.type="button";
side.prepend(grabber);
const currentDetent=()=>isCollapsed()?"peek":document.body.dataset.cspDetent||"medium";
const sheetTools=$("#mapDock");
const syncSheetTools=(progress=null)=>{
  if(!sheetTools) return;
  const dragProgress=sheetTools.style.getPropertyValue("--csp-dock-hide");
  if(progress===null&&dragProgress!=="") progress=Number(dragProgress);
  const hidden=sheetMode()&&(progress===null?currentDetent()==="large":progress>=.99);
  if(sheetTools.inert!==hidden) sheetTools.inert=hidden;
  if(hidden) sheetTools.setAttribute("aria-hidden","true");else sheetTools.removeAttribute("aria-hidden");
};
const syncGrabber=()=>{
  grabber.setAttribute("aria-label",peeking()?"Show panel":"Resize panel");
  grabber.setAttribute("aria-expanded",String(currentDetent()==="large"));
};
const setDetent=detent=>{
  document.body.dataset.cspDetent=detent;
  side.style.height="";
  syncGrabber();
  syncSheetTools();
};
const openSheet=(detent="medium")=>{setDetent(detent);if(isCollapsed()) toggleSheet()};
const goToDetent=detent=>{
  if(detent!=="peek"){openSheet(detent);return}
  // the next open starts at medium, as it does in Maps
  setDetent("medium");
  if(!isCollapsed()) toggleSheet();
};
setDetent("medium");
document.addEventListener("csp:dnr-select",()=>{if(phoneSheet.matches) goToDetent("peek")});
document.addEventListener("csp:dnr-download",()=>{if(phoneSheet.matches) goToDetent("peek")});
/* setCollapsed() makes the whole panel inert, which is right when it is hidden
   and wrong when it peeks: the search field is on screen and must work. The
   rows below the strip are hidden by CSS (visibility), so they stay out of the
   tab order without inert. */
const syncPeek=()=>{
  if(sheetMode()) side.inert=false;
  else side.inert=isCollapsed();
  syncGrabber();
  syncSheetTools();
};
new MutationObserver(syncPeek).observe(document.body,{attributes:true,attributeFilter:["class"]});
peekLayout.addEventListener("change",()=>{sheetTools?.style.removeProperty("--csp-dock-hide");syncPeek()});
syncPeek();
/* A portrait phone opens on the map: the sheet starts at peek, search field
   ready, as Maps does. Placed without animation so it does not slide down on
   launch. */
if(sheetMode()&&!isCollapsed()){
  document.body.classList.add("csp-sheet-dragging");
  toggleSheet();
  requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.remove("csp-sheet-dragging")));
}
{
  const probeHeight=variable=>{
    const probe=document.createElement("div");probe.style.cssText=`position:absolute;visibility:hidden;height:var(${variable})`;
    document.body.append(probe);const height=probe.getBoundingClientRect().height;probe.remove();return height;
  };
  const detentHeights=()=>({peek:probeHeight("--sheet-peek"),medium:probeHeight("--sheet-medium"),large:probeHeight("--sheet-large")});
  /* Controls that own their own drags. A slider, a picker, the layer reorder
     handle and the suggestion list keep the gesture. */
  const OWN_GESTURE='input[type="range"],select,textarea,[contenteditable="true"],.csp-layer-handle,#ac,.csp-sat-suggest';
  const scrollerFor=target=>{
    for(let el=target;el&&el!==side;el=el.parentElement){
      const overflow=getComputedStyle(el).overflowY;
      if((overflow==="auto"||overflow==="scroll")&&el.scrollHeight>el.clientHeight+1) return el;
    }
    return null;
  };
  let gesture=null,suppressClick=false,suppressTimer=0;
  /* A touch tap is followed by a compatibility click. On Chrome that click can
     arrive after a 0ms timer, and it would step the detent straight back.
     Hold the swallow long enough for the late click, and release it once the
     click has been seen so the next press still counts. */
  const suppressNextClick=()=>{
    suppressClick=true;
    clearTimeout(suppressTimer);
    suppressTimer=setTimeout(()=>{suppressClick=false},400);
  };
  const begin=(x,y,target,source)=>{
    gesture={x,y,startH:side.getBoundingClientRect().height,from:currentDetent(),target,source,
             onGrabber:target===grabber,scroller:scrollerFor(target),mode:null,samples:[{y,t:performance.now()}]};
  };
  // Returns true while the sheet owns the gesture, so the caller can stop the
  // browser scrolling underneath it.
  const move=(x,y)=>{
    const g=gesture;if(!g) return false;
    const dx=x-g.x,dy=y-g.y;
    if(g.mode===null){
      if(Math.abs(dx)<8&&Math.abs(dy)<8) return false;
      if(Math.abs(dx)>Math.abs(dy)||(!g.onGrabber&&g.target.closest(OWN_GESTURE))){g.mode="none";return false}
      if(g.onGrabber||g.from!=="large") g.mode="sheet";
      // at large, the content scrolls until it is at its top and pulled down
      else g.mode=dy>0&&(!g.scroller||g.scroller.scrollTop<=0)?"sheet":"none";
      if(g.mode==="sheet"){
        g.limits=detentHeights();
        document.body.classList.add("csp-sheet-dragging");
      }
    }
    if(g.mode!=="sheet") return false;
    const {peek,large}=g.limits;
    let height=g.startH-dy;
    // rubber-band past either end instead of stopping dead
    if(height>large) height=large+(height-large)*.22;
    if(height<peek) height=Math.max(peek*.6,peek-(peek-height)*.22);
    side.style.height=`${height}px`;
    if(sheetMode()&&sheetTools){
      /* Clear the tools before the rising sheet reaches them. While a finger
         owns the sheet, opacity and position follow its height directly. */
      const fadeSpan=Math.max(1,Math.min(120,(large-g.limits.medium)*.5));
      const progress=Math.max(0,Math.min(1,(height-g.limits.medium)/fadeSpan));
      sheetTools.style.setProperty("--csp-dock-hide",progress.toFixed(3));
      syncSheetTools(progress);
    }
    const now=performance.now();
    g.samples.push({y,t:now});
    while(g.samples.length>2&&now-g.samples[0].t>100) g.samples.shift();
    return true;
  };
  const end=()=>{
    const g=gesture;gesture=null;if(!g) return;
    document.body.classList.remove("csp-sheet-dragging");
    const settleTools=()=>{sheetTools?.style.removeProperty("--csp-dock-hide");syncSheetTools()};
    if(g.mode===null){
      // a tap: the grabber steps through the detents; a tap elsewhere on a
      // peeking strip is handled by the click listener below
      if(g.onGrabber){
        suppressNextClick();
        goToDetent(g.from==="peek"?"medium":g.from==="medium"?"large":"medium");
      }
      settleTools();
      return;
    }
    if(g.mode!=="sheet"){settleTools();return}
    suppressNextClick();
    const first=g.samples[0],last=g.samples[g.samples.length-1];
    const velocity=last.t>first.t?(last.y-first.y)/(last.t-first.t):0; // px per ms, positive = down
    const height=side.getBoundingClientRect().height;
    // Project the release speed forward, as UIKit does for sheets: a moderate
    // flick carries one detent, a hard one carries two, a slow drag stays
    // where it is let go. (300ms is gentler than scroll views' ~500ms.)
    const projected=height-velocity*300;
    const heights=g.limits;
    let target="peek",best=Infinity;
    for(const detent of ["peek","medium","large"]){
      const distance=Math.abs(heights[detent]-projected);
      if(distance<best){best=distance;target=detent}
    }
    if(target===g.from) side.style.height="";
    else goToDetent(target);
    settleTools();
  };
  const active=()=>phoneSheet.matches&&glassOn();
  /* Touch: non-passive, so the first move can claim the gesture before the
     browser starts scrolling. */
  side.addEventListener("touchstart",event=>{
    if(!active()||event.touches.length!==1) {gesture=null;return}
    if(!sheetMode()&&event.target!==grabber) return;
    const touch=event.touches[0];begin(touch.clientX,touch.clientY,event.target,"touch");
  },{passive:true});
  side.addEventListener("touchmove",event=>{
    if(!gesture||gesture.source!=="touch") return;
    if(event.touches.length!==1){gesture.mode="none";return}
    const touch=event.touches[0];
    if(move(touch.clientX,touch.clientY)&&event.cancelable) event.preventDefault();
  },{passive:false});
  side.addEventListener("touchend",()=>{if(gesture?.source==="touch") end()});
  side.addEventListener("touchcancel",()=>{if(gesture?.source==="touch") end()});
  /* Mouse (a narrow desktop window, or testing): the grabber and the peek
     strip drag; content does not, because a mouse has a wheel for it. */
  side.addEventListener("pointerdown",event=>{
    if(event.pointerType!=="mouse"||!active()) return;
    if(event.target!==grabber&&!peeking()) return;
    begin(event.clientX,event.clientY,event.target,"mouse");
  });
  side.addEventListener("pointermove",event=>{
    if(gesture?.source!=="mouse") return;
    if(move(event.clientX,event.clientY)&&!side.hasPointerCapture(event.pointerId)){
      try{side.setPointerCapture(event.pointerId)}catch{}
    }
  });
  side.addEventListener("pointerup",()=>{if(gesture?.source==="mouse") end()});
  side.addEventListener("pointercancel",()=>{if(gesture?.source==="mouse") end()});
  side.addEventListener("click",event=>{
    if(suppressClick){suppressClick=false;clearTimeout(suppressTimer);return}
    if(event.target===grabber){
      // keyboard activation, or a tap the gesture code did not see
      goToDetent(currentDetent()==="peek"?"medium":currentDetent()==="medium"?"large":"medium");
      return;
    }
    if(!peeking()) return;
    openSheet("medium");
  });
  side.addEventListener("focusin",event=>{
    if(peeking()&&event.target.closest("#q")) openSheet("large");
  });
  /* The search capsule takes two taps, as in Maps: the first opens the sheet
     with no keyboard; the next, with the sheet open, focuses the field. A tap
     on the collapsed field must not focus it - iOS would raise the keyboard
     while the field is at the bottom of the screen and pan the whole page up
     to keep it in view. preventDefault on touchend (and mousedown) stops the
     focus; the tap then opens the sheet itself. */
  const q=$("#q");
  let qTouch=null;
  q.addEventListener("touchstart",event=>{
    const t=event.touches[0];qTouch=peeking()&&t?{x:t.clientX,y:t.clientY}:null;
  },{passive:true});
  q.addEventListener("touchend",event=>{
    if(!qTouch||!peeking()) return;
    const t=event.changedTouches[0],tap=t&&Math.hypot(t.clientX-qTouch.x,t.clientY-qTouch.y)<10;
    qTouch=null;
    if(!tap) return;          // a drag: the sheet gesture handles it
    if(event.cancelable) event.preventDefault();
    openSheet("medium");
  },{passive:false});
  q.addEventListener("mousedown",event=>{if(peeking()) event.preventDefault()});
  /* Focusing with the sheet open: the sheet rises to full height so the
     suggestions have room, and the keyboard covers the lower part of the
     sheet rather than shoving the page up. iOS may still pan the document a
     little while the keyboard animates; undo that while the field has focus. */
  const focusSearch=input=>{
    if(!sheetMode()) return;
    if(currentDetent()!=="large") openSheet("large");
    const until=performance.now()+900;
    const pin=()=>{
      if(window.scrollY||document.documentElement.scrollTop) window.scrollTo(0,0);
      if(performance.now()<until&&document.activeElement===input) requestAnimationFrame(pin);
    };
    requestAnimationFrame(pin);
  };
  q.addEventListener("focus",()=>focusSearch(q));
  side.addEventListener("focusin",event=>{if(event.target.id==="cspSatQuery") focusSearch(event.target)});
  window.visualViewport?.addEventListener("scroll",()=>{
    if(sheetMode()&&document.activeElement?.matches("#q,#cspSatQuery")&&window.scrollY) window.scrollTo(0,0);
  });
  /* With the keyboard up, a tap anywhere outside the search row dismisses it.
     A tap on the map also lowers the sheet back to the capsule (the existing
     map handler does that). */
  document.addEventListener("pointerdown",event=>{
    if(!sheetMode()||!document.activeElement?.matches("#q,#cspSatQuery")) return;
    if(event.target.closest(".search-row,#ac,.csp-sat-field")) return;
    document.activeElement.blur();
  },true);
  grabber.addEventListener("keydown",event=>{
    const detent=currentDetent();
    if(event.key==="ArrowUp"){if(detent!=="large") goToDetent(detent==="peek"?"medium":"large")}
    else if(event.key==="ArrowDown"){
      if(detent==="large") goToDetent("medium");
      else if(detent==="medium"&&sheetMode()) goToDetent("peek");
    }
    else return;
    event.preventDefault();
  });
}

/* A preview engine (scripts/preview.sh) labels itself, so a preview tab can
   never be mistaken for the live portal. */
if(/^https?:$/.test(location.protocol)&&!/\.github\.io$/.test(location.hostname)){
  fetch("api/health",{cache:"no-store"}).then(response=>response.ok?response.json():null).then(health=>{
    if(health?.channel!=="preview") return;
    document.documentElement.dataset.cspChannel="preview";
    const stamp=$("#buildStamp");
    if(stamp&&!$(".csp-preview-badge",stamp.parentElement)){
      const badge=document.createElement("span");badge.className="csp-preview-badge";badge.textContent="Preview";
      badge.title=health.previewRef?`Preview of ${health.previewRef}`:"Preview build, not the live portal";
      stamp.after(badge);
    }
    document.title=`Preview · ${document.title.replace(/^Preview · /,"")}`;
  }).catch(()=>{});
}

organizeSidebarMenus();
let savedRoute=null;try{savedRoute=localStorage.getItem("clearskies.workspace.v1")}catch(_){}
activateRoute(Object.prototype.hasOwnProperty.call(ROUTES,savedRoute)?savedRoute:"layers",{stayOnNav:compactShell.matches});
document.body.dataset.cspView=compactShell.matches?"nav":"detail";
$$(".csp-nav-button[data-route]").forEach(button=>button.addEventListener("click",()=>{try{localStorage.setItem("clearskies.workspace.v1",button.dataset.route)}catch(_){}}));
syncModeBar();updateCounts();
/* The iPhone app (docs/ios CR-001) draws this shell natively. It lists these
   routes and opens them here, so each page keeps its live controls and this
   page stays their source of truth. Only the app defines CSPNativeHost. */
if(window.CSPNativeHost) window.CSPShell=Object.freeze({
  groups:()=>[...NAV_GROUPS,["",["appearance","settings"]]].map(([label,keys])=>({label,
    routes:keys.map(key=>({key,title:ROUTES[key].title,description:ROUTES[key].description,icon:ROUTES[key].icon}))})),
  activate:key=>{
    if(!ROUTES[key]) return false;
    activateRoute(key);try{localStorage.setItem("clearskies.workspace.v1",key)}catch(_){}
    return true;
  },
  current:()=>currentRoute,
  appearance:()=>({...appearance}),
  routeForText:text=>SEARCH_ROUTES.get(String(text||"").trim().toLocaleLowerCase().replace(/\s+/g," "))||null,
  /* The words the search field already accepts for each page, so the app's
     search can offer a page while it is typed. */
  keywords:()=>[...SEARCH_ROUTES]
});
/* One frame later, so the reveal shows a settled layout rather than the route
   activating in front of the user. */
requestAnimationFrame(ready);
})();
