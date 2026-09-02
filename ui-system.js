(function(){
"use strict";

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const icon=name=>`vendor/icons/${name}.svg`;
const compactShell=matchMedia("(max-width:1050px)");
const side=$("#side"),panes=$("#panes"),status=$("#status"),mapEl=$("#map");
const bridge=window.ClearSkiesPortalBridge;
/* The page is held at first paint until this fires; every exit from here has to
   reach it, including the one where the redesign declines to run at all. */
const ready=()=>document.documentElement.dispatchEvent(new Event("csp:ready"));
if(!side||!panes||!status||!mapEl||!bridge){ ready(); return; }

document.body.classList.add("csp-redesign");
document.documentElement.style.setProperty("--side-w","720px");
side.style.width="720px";
$("#q").placeholder="Search places, layers…";

const ROUTES={
  layers:{title:"Layers",description:"Everything currently drawn on the map, in render order.",icon:"layers",panes:[],custom:"layers"},
  satellite:{title:"Satellite imagery",description:"Find dated scenes, tune the search, and control the image already on the map.",icon:"satellite",panes:["filters","summary","passes","results","overlays"],open:["filters","results"],overlayGroup:"Imagery",overlayTitle:"Satellite base layers",custom:"satellite"},
  terrain:{title:"Terrain & LiDAR",description:"Render elevation, analytical terrain, 3D surfaces, and point clouds from the best available source.",icon:"mountain-snow",panes:["terrain","research"],open:["terrain","research"],researchMode:"terrain"},
  analyze:{title:"Analyze",description:"Measure landform fabric and derive research rasters from cached elevation.",icon:"scan-search",panes:["research"],open:["research"],researchMode:"analyze"},
  export:{title:"Export",description:"Save the exact current extent at screen, detail, or archival resolution.",icon:"download",panes:[],custom:"export"},
  conditions:{title:"Conditions",description:"Weather, earthquakes, volcanoes, fire, snow, and other time-sensitive layers.",icon:"cloud-sun",panes:["alerts","overlays"],open:["alerts","overlays"],overlayGroup:"Conditions",overlayTitle:"Conditions layers"},
  geology:{title:"Geology & hazards",description:"Surface geology, faults, seismic context, landslides, and point identification.",icon:"triangle-alert",panes:["overlays","research"],open:["overlays","research"],overlayGroup:"Geology & hazards",overlayTitle:"Geology layers",researchMode:"geology"},
  past:{title:"Past landscapes",description:"Ice-age lakes, glaciers, archaeology, and reconstructed environments.",icon:"history",panes:["overlays"],open:["overlays"],overlayGroup:"Past landscapes",overlayTitle:"Past landscape layers"},
  labels:{title:"Labels & reference",description:"Roads, trails, places, water, boundaries, and reference labels.",icon:"tags",panes:["overlays"],open:["overlays"],overlayGroup:"Labels & reference",overlayTitle:"Reference layers"}
};

const oldHeader=$(":scope > header",side),searchbox=$(":scope > .searchbox",side),foot=$(":scope > .foot",side),drag=$("#drag",side);
const nav=document.createElement("nav");nav.id="cspNav";nav.setAttribute("aria-label","Clear Skies workspace");
const navScroll=document.createElement("div");navScroll.id="cspNavScroll";
const workspace=document.createElement("main");workspace.id="cspWorkspace";
workspace.innerHTML=`
  <header id="cspWorkspaceHeader">
    <button id="cspBack" type="button"><img src="${icon("arrow-left")}" alt=""> All tools</button>
    <h2 id="cspWorkspaceTitle"></h2>
    <p id="cspWorkspaceDescription"></p>
  </header>
  <div id="cspWorkspaceScroll"><div id="cspCustomView"></div></div>`;

side.insertBefore(nav,oldHeader);
nav.append(oldHeader,searchbox);

const coordinateActions=document.createElement("div");coordinateActions.className="csp-coordinate-actions";
coordinateActions.innerHTML=`<button type="button" data-coordinate="copy">Copy coordinates</button><button type="button" data-coordinate="maps">Google Maps</button><button type="button" data-coordinate="earth">Google Earth</button>`;
nav.append(coordinateActions,navScroll);
nav.append(foot);
side.insertBefore(workspace,drag);
const workspaceScroll=$("#cspWorkspaceScroll",workspace),customView=$("#cspCustomView",workspace);
workspaceScroll.append(status,panes);

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
navGroup("Map",["layers","satellite","terrain","analyze","export"]);
navGroup("Layer groups",["conditions","geology","past","labels"]);

const engineNav=document.createElement("div");engineNav.id="cspEngineNav";
engineNav.innerHTML=`<button class="csp-nav-button" type="button"><img src="${icon("settings-2")}" alt=""><span>Terrain engine</span><span class="csp-nav-dot"></span></button>`;
foot.prepend(engineNav);
engineNav.querySelector("button").addEventListener("click",()=>$("#serverToggle")?.click());

coordinateActions.addEventListener("click",event=>{
  const action=event.target.closest("button")?.dataset.coordinate;if(!action) return;
  if(action==="copy") $("#coordCopy")?.click();
  if(action==="maps"||action==="earth"){
    const link=$(action==="maps"?"#coordGoogleMaps":"#coordGoogleEarth");
    if(link?.href) window.open(link.href,"_blank","noopener,noreferrer");
  }
});

const locateButton=$("#loc");
if(locateButton) locateButton.innerHTML=`<img src="${icon("map-pinned")}" alt="">`;

const SEARCH_ROUTES=new Map([
  ["layers","layers"],["active layers","layers"],
  ["satellite","satellite"],["satellite imagery","satellite"],["imagery","satellite"],["scenes","satellite"],["filters","satellite"],
  ["terrain","terrain"],["lidar","terrain"],["terrain lidar","terrain"],["elevation","terrain"],["hillshade","terrain"],
  ["analyze","analyze"],["analysis","analyze"],["research","analyze"],
  ["export","export"],["snapshot","export"],["download","export"],
  ["conditions","conditions"],["weather","conditions"],["earthquakes","conditions"],["fire","conditions"],["snow","conditions"],
  ["geology","geology"],["hazards","geology"],["faults","geology"],["landslides","geology"],
  ["past landscapes","past"],["glaciers","past"],["ice age","past"],["archaeology","past"],
  ["labels","labels"],["reference","labels"],["roads","labels"],["boundaries","labels"]
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

const PANE_TITLES={filters:"Search filters",alerts:"Live conditions",summary:"Best available",passes:"Acquisition timing",terrain:"Terrain rendering",research:"Analysis tools",overlays:"Layer catalog",results:"Satellite scenes"};
for(const [name,title] of Object.entries(PANE_TITLES)){
  const pane=$(`.pane[data-pane="${name}"]`,panes),label=$(".pane-t",pane),head=$(".pane-h",pane);
  if(label) label.textContent=title;
  if(head) head.setAttribute("aria-label",`Toggle ${title}`);
}

const spectrumBox=$("#elevSh")?.closest(".fabbox");if(spectrumBox) spectrumBox.id="elevSpectrumBox";
const bandsBox=$("#elevBandsBox"),surfaceBox=$("#researchProduct")?.closest(".fabbox"),geologyBox=$("#geologyIdentifyBox");
const researchPane=$(".pane[data-pane='research']",panes),researchBody=$(".pane-b",researchPane);
const fabricAction=$(":scope > .terrain-action-row",researchBody),fabricOutput=$("#fabOut");

for(const [group,elements] of Object.entries({
  terrain:[spectrumBox,bandsBox],
  analyze:[fabricAction,fabricOutput,surfaceBox],
  geology:[geologyBox]
})) for(const element of elements) if(element) element.dataset.cspResearchGroup=group;

function filterResearch(mode){
  for(const element of [...researchBody.children]){
    element.classList.toggle("csp-route-hidden",element.dataset.cspResearchGroup!==mode);
  }
  const title=$(".pane-t",researchPane);
  if(title) title.textContent=mode==="terrain"?"Elevation tools":mode==="geology"?"Identify geology":"Analysis tools";
}

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

const snapshotPanel=$("#snapshotPanel"),snapshotHome=snapshotPanel?.parentElement;
if($("#snapshot")) $("#snapshot").onclick=()=>activateRoute("export");

const visited=new Set();
let currentRoute="layers";
function openDefaultPanes(route){
  if(visited.has(currentRoute)) return;
  for(const name of route.open||[]){
    const pane=$(`.pane[data-pane="${name}"]`,panes);
    if(pane?.classList.contains("min")) $(".pane-x",pane)?.click();
  }
  visited.add(currentRoute);
}

function clearCustom(){
  if(snapshotPanel?.parentElement===customView) customView.removeChild(snapshotPanel);
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
  if(layer.id==="scene"||layer.id==="active-fires") return layer.id==="scene"?"satellite":"conditions";
  if(layer.id==="terrain"||layer.id.startsWith("elevation-")) return "terrain";
  if(layer.id==="surface-analysis") return "analyze";
  if(layer.id.startsWith("overlay:")){
    const group=(bridge.overlayCatalog().find(o=>`overlay:${o.id}`===layer.id)||{}).group;
    return group==="Imagery"?"satellite":group==="Conditions"?"conditions":group==="Geology & hazards"?"geology":group==="Past landscapes"?"past":"labels";
  }
  return "layers";
}

function buildLayerCard(layer,index,entries,compact=false){
  const card=document.createElement("article");card.className="csp-layer-card";card.dataset.layerId=layer.id;
  if(layer.locked) card.classList.add("csp-layer-locked");
  if(compact) card.classList.add("csp-layer-compact");
  card.draggable=!layer.locked&&!compact;
  card.innerHTML=`
    <button class="csp-layer-handle" type="button" aria-label="Reorder ${layer.name}" ${layer.locked||compact?"hidden":""}></button>
    <div class="csp-layer-main"><div class="csp-layer-name"></div><div class="csp-layer-meta"></div></div>
    <label class="csp-switch" aria-label="Show ${layer.name}"><input type="checkbox" ${layer.visible?"checked":""} ${layer.locked?"disabled":""}><span></span></label>
    ${layer.noOpacity?"":`<div class="csp-layer-opacity"><label>Opacity</label><input class="csp-layer-range" type="range" min="0" max="100" step="1" value="${Math.round(layer.opacity)}"><output>${Math.round(layer.opacity)}%</output></div>`}
    ${layer.locked||compact?"":`<div class="csp-layer-actions"><span>Order</span><button class="csp-layer-move" type="button" data-action="up" aria-label="Move ${layer.name} up" title="Move up" ${index===0?"disabled":""}><img src="${icon("chevron-up")}" alt=""></button><button class="csp-layer-move" type="button" data-action="down" aria-label="Move ${layer.name} down" title="Move down" ${index===entries.length-2?"disabled":""}><img src="${icon("chevron-down")}" alt=""></button><button type="button" data-action="edit">Edit</button><button type="button" data-action="reset">Reset</button></div>`}`;
  $(".csp-layer-name",card).textContent=layer.name;
  $(".csp-layer-meta",card).textContent=layer.meta||"";
  $(".csp-switch input",card)?.addEventListener("change",event=>{bridge.setLayerVisible(layer.id,event.target.checked);scheduleLayerRefresh(0)});
  const range=$(".csp-layer-range",card),output=$(".csp-layer-opacity output",card);
  range?.addEventListener("input",event=>{output.textContent=event.target.value+"%";bridge.setLayerOpacity(layer.id,event.target.value)});
  range?.addEventListener("change",()=>scheduleLayerRefresh(0));
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
  $(".csp-layer-handle",card)?.addEventListener("keydown",event=>{
    if(event.key!=="ArrowUp"&&event.key!=="ArrowDown") return;
    event.preventDefault();const ids=entries.map(item=>item.id),from=ids.indexOf(layer.id),to=from+(event.key==="ArrowUp"?-1:1);
    if(to<0||to>=ids.length-1) return;[ids[from],ids[to]]=[ids[to],ids[from]];saveLayerOrder(ids);scheduleLayerRefresh(0);
  });
  card.addEventListener("dragstart",event=>{event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",layer.id);card.classList.add("csp-dragging")});
  card.addEventListener("dragend",()=>card.classList.remove("csp-dragging"));
  card.addEventListener("dragover",event=>{if(!layer.locked){event.preventDefault();event.dataTransfer.dropEffect="move"}});
  card.addEventListener("drop",event=>{
    event.preventDefault();const source=event.dataTransfer.getData("text/plain");if(!source||source===layer.id) return;
    const ids=entries.map(item=>item.id),from=ids.indexOf(source),to=ids.indexOf(layer.id);if(from<0||to<0) return;
    ids.splice(to,0,ids.splice(from,1)[0]);saveLayerOrder(ids);scheduleLayerRefresh(0);
  });
  return card;
}

function renderLayerStack(container,onlyScene=false){
  const entries=layerSort(bridge.activeLayers()).filter(layer=>!onlyScene||layer.id==="scene");
  container.replaceChildren();
  if(!entries.length){
    const empty=document.createElement("div");empty.className="csp-empty-layers";empty.textContent=onlyScene?"No satellite scene is displayed yet. Search below, then open a result.":"No research layers are active. The reference basemap remains available.";container.append(empty);return;
  }
  entries.forEach((layer,index)=>container.append(buildLayerCard(layer,index,entries,onlyScene)));
  if(!onlyScene) bridge.setLayerOrder(entries.map(layer=>layer.id));
}

function availableLayersCard(){
  const card=document.createElement("div");card.className="csp-card";
  const options=[["satellite","Satellite imagery","Dated optical, radar, IR, and global mosaics"],["terrain","Terrain & LiDAR","Hillshade, elevation, contours, and 3D"],["conditions","Conditions","Weather, seismicity, fire, and snow"],["geology","Geology & hazards","Surface geology, faults, and landslides"],["past","Past landscapes","Glaciers, ice-age lakes, and archaeology"],["labels","Labels & reference","Roads, trails, water, places, and boundaries"]];
  for(const [route,name,meta] of options){
    const button=document.createElement("button");button.className="csp-available-row";button.type="button";
    button.innerHTML=`<strong>${name}</strong><img src="${icon("chevron-right")}" alt="" width="15" height="15"><span>${meta}</span>`;
    button.addEventListener("click",()=>activateRoute(route));card.append(button);
  }
  return card;
}

function renderLayersView(){
  clearCustom();
  const activeLabel=document.createElement("div");activeLabel.className="csp-section-label";activeLabel.textContent="Active — drag to reorder";
  const active=document.createElement("div");active.className="csp-card";active.id="cspActiveLayerStack";
  customView.append(activeLabel,active);
  renderLayerStack(active);
  const availableLabel=document.createElement("div");availableLabel.className="csp-section-label";availableLabel.textContent="Add layers";
  customView.append(availableLabel,availableLayersCard());
}

function renderSatelliteView(){
  clearCustom();
  const entries=bridge.activeLayers().filter(layer=>layer.id==="scene");
  if(!entries.length) return;
  const label=document.createElement("div");label.className="csp-section-label";label.textContent="Displayed now";
  const card=document.createElement("div");card.className="csp-card";customView.append(label,card);renderLayerStack(card,true);
}

function renderExportView(){
  clearCustom();
  if(snapshotPanel){snapshotPanel.hidden=false;snapshotPanel.classList.add("csp-inline-export");customView.append(snapshotPanel);$("#snapshotScale")?.dispatchEvent(new Event("change",{bubbles:true}))}
  const label=document.createElement("div");label.className="csp-section-label";label.textContent="Offline terrain";
  const card=document.createElement("div");card.className="csp-card";
  const row=document.createElement("button");row.className="csp-available-row";row.type="button";
  row.innerHTML=`<strong>Download terrain for this view</strong><img src="${icon("chevron-right")}" alt="" width="15" height="15"><span>Warm the selected LiDAR source and extent for offline use</span>`;
  row.addEventListener("click",()=>{$("#terWarm")?.click();activateRoute("terrain")});card.append(row);customView.append(label,card);
}

function renderCustom(route){
  if(route.custom==="layers") renderLayersView();
  else if(route.custom==="satellite") renderSatelliteView();
  else if(route.custom==="export") renderExportView();
  else clearCustom();
}

function activateRoute(key,options={}){
  const route=ROUTES[key];if(!route) return;
  currentRoute=key;overlayGroup=route.overlayGroup||null;
  document.body.dataset.cspRoute=key;
  if(compactShell.matches&&!options.stayOnNav) document.body.dataset.cspView="detail";
  $$(".csp-nav-button[data-route]").forEach(button=>button.setAttribute("aria-current",button.dataset.route===key?"page":"false"));
  $("#cspWorkspaceTitle").textContent=route.title;$("#cspWorkspaceDescription").textContent=route.description;
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
$("#cspBack").addEventListener("click",()=>{document.body.dataset.cspView="nav"});
compactShell.addEventListener("change",event=>{if(!event.matches) delete document.body.dataset.cspView;else document.body.dataset.cspView="nav"});

const modeBar=document.createElement("div");modeBar.id="cspMapMode";modeBar.setAttribute("role","group");modeBar.setAttribute("aria-label","Map view mode");
modeBar.innerHTML=`<button type="button" data-mode="2d">2D</button><button type="button" data-mode="3d">3D terrain</button><button type="button" data-mode="points">Point cloud</button>`;
mapEl.append(modeBar);
modeBar.addEventListener("click",event=>{
  const mode=event.target.closest("button")?.dataset.mode;if(!mode) return;
  $(mode==="2d"?"#terMode2d":mode==="3d"?"#terMode3d":"#terModePoints")?.click();syncModeBar();
});
function syncModeBar(){
  const mode=$("#terModePoints")?.getAttribute("aria-pressed")==="true"?"points":$("#terMode3d")?.getAttribute("aria-pressed")==="true"?"3d":"2d";
  $$("button",modeBar).forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.mode===mode)));
}

let refreshTimer=0;
function scheduleLayerRefresh(delay=80){
  clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{
    if(document.activeElement?.classList.contains("csp-layer-range")) return;
    if(currentRoute==="layers") renderLayersView();else if(currentRoute==="satellite") renderSatelliteView();
    updateCounts();syncModeBar();
  },delay);
}

function updateCounts(){
  const active=bridge.activeLayers(),catalog=bridge.overlayCatalog();
  const set=(key,value)=>{const el=$(`[data-count="${key}"]`);if(el) el.textContent=value||""};
  set("layers",String(active.filter(layer=>!layer.locked).length));
  set("satellite",$("#n_results")?.textContent||"");
  const terrainCount=active.filter(layer=>layer.id==="terrain"||layer.id.startsWith("elevation-")).length;
  set("terrain",terrainCount?String(terrainCount):"");
  set("analyze",active.some(layer=>layer.id==="surface-analysis")?"1":"");
  for(const [key,group] of [["conditions","Conditions"],["geology","Geology & hazards"],["past","Past landscapes"],["labels","Labels & reference"]]){
    const ids=new Set(catalog.filter(item=>item.group===group).map(item=>`overlay:${item.id}`));
    const count=active.filter(layer=>ids.has(layer.id)).length;set(key,count?String(count):"");
  }
  const copy=coordinateActions.querySelector('[data-coordinate="copy"]'),maps=coordinateActions.querySelector('[data-coordinate="maps"]'),earth=coordinateActions.querySelector('[data-coordinate="earth"]');
  const coordinateUnavailable=$("#coordOpen")?.disabled!==false;
  if(copy) copy.hidden=$("#coordCopy")?.disabled!==false;
  if(maps) maps.hidden=coordinateUnavailable||!$("#coordGoogleMaps")?.href;
  if(earth) earth.hidden=coordinateUnavailable||!$("#coordGoogleEarth")?.href;
  coordinateActions.hidden=[copy,maps,earth].every(button=>!button||button.hidden);
  const dot=$(".csp-nav-dot",engineNav),source=$("#srvDot");if(dot&&source) dot.className="csp-nav-dot "+(source.classList.contains("on")?"on":"off");
}

for(const element of [$("#coordCopy"),$("#coordOpen"),$("#coordGoogleMaps"),$("#coordGoogleEarth")]){
  if(element) new MutationObserver(updateCounts).observe(element,{attributes:true,attributeFilter:["disabled","href"]});
}

document.addEventListener("input",event=>{if(event.target.closest("#side")||event.target.closest("#pointCloudPanel")) scheduleLayerRefresh(120)},true);
document.addEventListener("change",()=>scheduleLayerRefresh(0),true);
document.addEventListener("csp:layers-changed",()=>scheduleLayerRefresh(80));
new MutationObserver(()=>scheduleLayerRefresh(80)).observe($("#ctl"),{attributes:true,childList:true,subtree:true,characterData:true});
new MutationObserver(()=>scheduleLayerRefresh(80)).observe($("#panes"),{attributes:true,subtree:true,attributeFilter:["class","hidden","aria-pressed"]});
setInterval(()=>scheduleLayerRefresh(0),1800);

const savedRoute=localStorage.getItem("clearskies.workspace.v1");
activateRoute(Object.prototype.hasOwnProperty.call(ROUTES,savedRoute)?savedRoute:"layers",{stayOnNav:compactShell.matches});
document.body.dataset.cspView=compactShell.matches?"nav":"detail";
$$(".csp-nav-button[data-route]").forEach(button=>button.addEventListener("click",()=>localStorage.setItem("clearskies.workspace.v1",button.dataset.route)));
syncModeBar();updateCounts();
/* One frame later, so the reveal shows a settled layout rather than the route
   activating in front of the user. */
requestAnimationFrame(ready);
})();
