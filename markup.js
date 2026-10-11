/* Clear Skies Portal — markup (annotation) layers.

   A markup layer is a named, coloured set of drawings: freehand pen, lines,
   arrows, areas, rectangles, circles, text and pins. Each is anchored to the
   ground: positions are latitude/longitude and every size (stroke width, text
   height, pin height, circle radius) is in metres, so marks grow and shrink
   with the map like ink on a paper map, and stay where they were put at any
   zoom or rotation.

   Storage. Each layer is one GeoJSON FeatureCollection with a `markup` header.
   The browser keeps every layer in IndexedDB, so markup works with no engine
   at all (in the field, on the phone). When the terrain engine is reachable
   the layers are also kept there as files (server.js /api/markup), which is
   what shares them between devices: the newer copy of a layer wins, and a
   deleted layer leaves a tombstone so an offline device cannot resurrect it.
   Visibility and opacity are this device's view of a layer, not part of it.

   Rendering. Each layer has its own pane (so layers stack and fade
   independently) with its own SVG renderer, inside the rotating pane. Text
   and pins are SVG too, drawn into the same renderer, which is what lets the
   PNG exporter capture them with everything else. */
(function(){
"use strict";
const B=window.ClearSkiesPortalBridge,L=window.L;
if(!B||!B.map||!L) return;
const map=B.map;
const $=(s,r=document)=>r.querySelector(s);
const SVGNS="http://www.w3.org/2000/svg";
const PALETTE=["#ff3b30","#ff9500","#ffcc00","#34c759","#00c7be","#0a84ff","#5e5ce6","#bf5af2","#ffffff","#1c1c1e"];
/* The layer colour picker: ten hue rows of five, light to dark, the most
   used hues first. The middle column is each hue at full strength. */
const COLOR_GRID=[
  ["#ffb3ae","#ff7a70","#ff3b30","#d70015","#8e0b0b"],   // red
  ["#ffd2a1","#ffb35c","#ff9500","#c96a00","#7a3e00"],   // orange
  ["#fff2a8","#ffe066","#ffcc00","#c99a00","#7a5c00"],   // yellow
  ["#b7f0c4","#6fdc8c","#34c759","#248a3d","#14532d"],   // green
  ["#a8d4ff","#5eb0ff","#0a84ff","#0055c4","#003170"],   // blue
  ["#a6f0ec","#4fdcd4","#00c7be","#00918a","#00524e"],   // teal
  ["#e3c4f7","#cf8ef0","#af52de","#8a2bb8","#521571"],   // purple
  ["#ffc2d6","#ff8fb1","#ff2d55","#c2002e","#70001c"],   // pink
  ["#e8d2b8","#c9a77c","#a2845e","#7a5c3a","#4a3520"],   // earth
  ["#ffffff","#d1d1d6","#8e8e93","#3a3a3c","#000000"]    // neutral
].flat();
const VIEW_KEY="clearskies.markup.view.v1";
const icon=name=>`vendor/icons/${name}.svg`;

/* ---------------------------------------------------------------- geometry */
const mpp=(lat,zoom)=>40075016.686*Math.cos(lat*Math.PI/180)/Math.pow(2,zoom+8);
const here=()=>mpp(map.getCenter().lat,map.getZoom());
const proj=ll=>L.CRS.EPSG3857.project(L.latLng(ll));
const unproj=p=>L.CRS.EPSG3857.unproject(L.point(p.x,p.y));
const toLL=c=>L.latLng(c[1],c[0]);
const toC=ll=>[+ll.lng.toFixed(7),+ll.lat.toFixed(7)];
const rid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
function slug(name){
  const base=String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"layer";
  return `${base}-${Math.random().toString(36).slice(2,8)}`;
}
/* Arrow head as a ground-anchored triangle: Web Mercator metres are ground
   metres stretched by 1/cos(lat), so the head is sized in the same frame. */
function arrowHead(latlngs,widthM){
  if(latlngs.length<2) return null;
  const a=proj(latlngs[latlngs.length-2]),b=proj(latlngs[latlngs.length-1]);
  const k=1/Math.cos(latlngs[latlngs.length-1].lat*Math.PI/180);
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
  if(!len) return null;
  const ux=dx/len,uy=dy/len,h=Math.min(len*0.6,Math.max(widthM*5,widthM*2+4)*k),w=h*0.62;
  const bx=b.x-ux*h,by=b.y-uy*h;
  return [unproj(b),unproj({x:bx-uy*w,y:by+ux*w}),unproj({x:bx+uy*w,y:by-ux*w})];
}
const luminance=hex=>{ const n=parseInt(hex.slice(1),16);return (0.299*(n>>16)+0.587*((n>>8)&255)+0.114*(n&255))/255 };
const haloFor=color=>luminance(color)>0.82?"rgba(20,20,22,.8)":"rgba(255,255,255,.95)";

/* Text and pins: SVG in the layer's own renderer, sized in metres. */
const MarkupPoint=L.Layer.extend({
  initialize(latlng,options){ this._latlng=L.latLng(latlng);L.setOptions(this,options) },
  onAdd(map){
    this._renderer=map.getRenderer(this);
    const g=this._el=document.createElementNS(SVGNS,"g");
    g.setAttribute("class","csp-mk-point leaflet-interactive");
    this._build();
    this._renderer._rootGroup.appendChild(g);
    this._renderer.on("update",this._reset,this);
    map.on("zoomend viewreset",this._reset,this);
    g.addEventListener("click",event=>{ L.DomEvent.stop(event);this.fire("click",{originalEvent:event,latlng:this._latlng}) });
    this._reset();
  },
  onRemove(map){
    this._el?.remove();
    this._renderer?.off("update",this._reset,this);
    map.off("zoomend viewreset",this._reset,this);
  },
  getLatLng(){ return this._latlng },
  getElement(){ return this._el },
  setLatLng(ll){ this._latlng=L.latLng(ll);this._reset();return this },
  _build(){
    const g=this._el,o=this.options;g.replaceChildren();
    const text=t=>{
      const el=document.createElementNS(SVGNS,"text");
      el.setAttribute("fill",o.color);el.setAttribute("stroke",haloFor(o.color));
      el.setAttribute("paint-order","stroke");el.setAttribute("stroke-linejoin","round");
      el.setAttribute("font-family","-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter Variable',system-ui,sans-serif");
      el.setAttribute("font-weight","650");
      const lines=String(t).split("\n");
      lines.forEach((line,i)=>{ const span=document.createElementNS(SVGNS,"tspan");span.setAttribute("x",el.getAttribute("x")||"0");
        span.setAttribute("dy",i?"1.2em":String(-(lines.length-1)*0.6)+"em");span.textContent=line||" ";el.append(span) });
      return el;
    };
    if(o.kind==="pin"){
      const body=document.createElementNS(SVGNS,"path");
      body.setAttribute("d","M12 1.5C7.6 1.5 4.5 4.8 4.5 9c0 5.6 7.5 13.5 7.5 13.5S19.5 14.6 19.5 9c0-4.2-3.1-7.5-7.5-7.5z");
      body.setAttribute("fill",o.color);body.setAttribute("stroke",haloFor(o.color));body.setAttribute("stroke-width","1.2");
      const dot=document.createElementNS(SVGNS,"circle");
      dot.setAttribute("cx","12");dot.setAttribute("cy","9");dot.setAttribute("r","2.8");dot.setAttribute("fill",haloFor(o.color));
      const pin=document.createElementNS(SVGNS,"g");pin.append(body,dot);this._pin=pin;g.append(pin);
      if(o.text){ const label=text(o.text);label.setAttribute("text-anchor","start");label.setAttribute("dominant-baseline","central");this._label=label;g.append(label) }
      else this._label=null;
    }else{
      const label=text(o.text||"");label.setAttribute("text-anchor","middle");label.setAttribute("dominant-baseline","central");
      this._label=label;this._pin=null;g.append(label);
    }
  },
  _reset(){
    if(!this._map||!this._el) return;
    const pt=this._map.latLngToLayerPoint(this._latlng),px=this.options.size/mpp(this._latlng.lat,this._map.getZoom());
    this._el.setAttribute("transform",`translate(${pt.x.toFixed(2)},${pt.y.toFixed(2)})`);
    this._el.style.display=px<0.8?"none":"";
    if(this._pin){
      const k=px/24;
      this._pin.setAttribute("transform",`scale(${k}) translate(-12,-22.5)`);
      if(this._label){ const fs=px*0.55;this._label.setAttribute("font-size",fs.toFixed(2));this._label.setAttribute("x",(px*0.38).toFixed(2));
        this._label.setAttribute("y",(-px*0.6).toFixed(2));this._label.setAttribute("stroke-width",(fs*0.22).toFixed(2));
        for(const span of this._label.children) span.setAttribute("x",(px*0.38).toFixed(2)) }
    }else if(this._label){
      this._label.setAttribute("font-size",px.toFixed(2));this._label.setAttribute("stroke-width",(px*0.16).toFixed(2));
    }
  }
});

/* ------------------------------------------------------------------ storage */
const idb=(()=>{
  let opening=null;
  const open=()=>opening||(opening=new Promise((resolve,reject)=>{
    if(!window.indexedDB) return reject(new Error("no IndexedDB"));
    const request=indexedDB.open("clearskies-markup",1);
    request.onupgradeneeded=()=>{ request.result.createObjectStore("layers");request.result.createObjectStore("meta") };
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  }));
  const run=(store,mode,fn)=>open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(store,mode),request=fn(tx.objectStore(store));
    tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  }));
  return {
    all:()=>run("layers","readonly",s=>s.getAll()).catch(()=>[]),
    put:doc=>run("layers","readwrite",s=>s.put(doc,doc.markup.id)).catch(()=>{}),
    del:id=>run("layers","readwrite",s=>s.delete(id)).catch(()=>{}),
    getMeta:key=>run("meta","readonly",s=>s.get(key)).catch(()=>undefined),
    setMeta:(key,value)=>run("meta","readwrite",s=>s.put(value,key)).catch(()=>{})
  };
})();
function readView(){ try{ return JSON.parse(localStorage.getItem(VIEW_KEY))||{} }catch(e){ return {} } }
function writeView(){
  const view={};for(const [id,layer] of layers) view[id]={on:layer.visible,op:layer.opacity,rank:layer.rank};
  try{ localStorage.setItem(VIEW_KEY,JSON.stringify(view)) }catch(e){}
}

/* ------------------------------------------------------------------- layers */
const layers=new Map();       // id -> layer state
let editing=null,tool="pan",selected=null,penColor=null,penWidth=1;   // penWidth: index into WIDTHS
const WIDTHS=[{label:"Fine",px:2},{label:"Medium",px:4},{label:"Bold",px:7}];
const undoStacks=new Map();

function makeLayer(doc,view={}){
  const id=doc.markup.id,paneName=`csp-markup-${id}`;
  const parent=map._rotatePane||map.getPane("mapPane");
  const pane=map.getPane(paneName)||map.createPane(paneName,parent);
  pane.classList.add("csp-markup-pane");
  const layer={doc,pane,paneName,renderer:L.svg({pane:paneName,padding:0.5}),group:L.featureGroup(),
    items:new Map(),visible:view.on!==false,opacity:Number.isFinite(view.op)?view.op:100,rank:view.rank??0,syncedAt:null};
  layer.group.addTo(map);
  layers.set(id,layer);
  renderLayer(layer);applyView(layer);
  return layer;
}
function applyView(layer){
  layer.pane.style.display=layer.visible?"":"none";
  layer.pane.style.opacity=String(layer.opacity/100);
}
function applyOrder(){
  /* Highest rank on top; the Layers list order sets the ranks. All markup
     sits above imagery and overlays, below map buttons. */
  for(const layer of layers.values()) layer.pane.style.zIndex=String(450+Math.max(0,Math.min(140,layer.rank)));
}
function featureLayers(layer,feature){
  const p=feature.properties,color=p.color||layer.doc.markup.color,g=feature.geometry;
  const lat=g.type==="Point"?g.coordinates[1]:(g.type==="Polygon"?g.coordinates[0][0][1]:g.coordinates[0][1]);
  const base={renderer:layer.renderer,pane:layer.paneName,color,opacity:1,lineCap:"round",lineJoin:"round",bubblingMouseEvents:false};
  const weight=()=>Math.max(0.6,(p.width||2)/mpp(lat,map.getZoom()));
  const out=[];
  if(p.kind==="pen"||p.kind==="line"||p.kind==="arrow"){
    const latlngs=g.coordinates.map(toLL);
    out.push(L.polyline(latlngs,{...base,weight:weight()}));
    if(p.kind==="arrow"){ const head=arrowHead(latlngs,p.width||2);if(head) out.push(L.polygon(head,{...base,weight:weight()*0.6,fill:true,fillColor:color,fillOpacity:1})) }
  }else if(p.kind==="area"||p.kind==="rect"){
    out.push(L.polygon(g.coordinates[0].slice(0,-1).map(toLL),{...base,weight:weight(),fill:true,fillColor:color,fillOpacity:p.fill??0.18}));
  }else if(p.kind==="circle"){
    out.push(L.circle(toLL(g.coordinates),{...base,radius:p.radius,weight:weight(),fill:true,fillColor:color,fillOpacity:p.fill??0.18}));
  }else if(p.kind==="text"||p.kind==="pin"){
    out.push(new MarkupPoint(toLL(g.coordinates),{renderer:layer.renderer,pane:layer.paneName,kind:p.kind,text:p.text||"",size:p.size||20,color}));
  }
  for(const item of out){
    item._mkWeight=weight;
    item.on("click",event=>{ if(editing===layer&&tool==="select"){ L.DomEvent.stop(event.originalEvent||event);select(feature.properties.fid) } });
  }
  return out;
}
function renderFeature(layer,feature){
  const old=layer.items.get(feature.properties.fid);
  old?.layers.forEach(l=>layer.group.removeLayer(l));
  const built=featureLayers(layer,feature);
  built.forEach(l=>layer.group.addLayer(l));
  layer.items.set(feature.properties.fid,{feature,layers:built});
  if(selected?.layer===layer&&selected.fid===feature.properties.fid) markSelected(true);
}
function renderLayer(layer){
  layer.group.clearLayers();layer.items.clear();
  for(const feature of layer.doc.features) renderFeature(layer,feature);
}
map.on("zoomend",()=>{
  for(const layer of layers.values()) for(const {layers:parts} of layer.items.values())
    for(const part of parts) if(part._mkWeight&&part.setStyle) part.setStyle({weight:part instanceof L.Polygon&&part.options.fillOpacity===1?part._mkWeight()*0.6:part._mkWeight()});
});

/* -------------------------------------------------------------- persistence */
let syncTimer=null,syncing=false,syncAgain=false,lastStatus="";
const serverState=()=>B.server?.()||{online:false};
function touch(layer){
  layer.doc.markup.updated=Date.now();
  idb.put(layer.doc);
  clearTimeout(syncTimer);syncTimer=setTimeout(syncAll,900);
  changed();
}
function pushUndo(layer){
  const stack=undoStacks.get(layer.doc.markup.id)||[];
  stack.push(JSON.stringify(layer.doc.features));if(stack.length>100) stack.shift();
  undoStacks.set(layer.doc.markup.id,stack);
}
function undo(){
  if(!editing) return;
  const stack=undoStacks.get(editing.doc.markup.id);if(!stack?.length) return;
  editing.doc.features=JSON.parse(stack.pop());
  deselect();renderLayer(editing);touch(editing);paintBar();
}
async function pendingDeletes(){ return (await idb.getMeta("pendingDeletes"))||{} }
async function syncAll(){
  const server=serverState();
  if(!server.online) return status();
  if(syncing){ syncAgain=true;return }
  syncing=true;status("syncing");
  try{
    const pending=await pendingDeletes();
    for(const [id,at] of Object.entries(pending)){
      const r=await fetch(B.api(`/api/markup/${id}/delete`),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({at})});
      if(r.ok){ delete pending[id];await idb.setMeta("pendingDeletes",pending) }
    }
    const list=await (await fetch(B.api("/api/markup"),{cache:"no-store"})).json();
    const remote=new Map((list.layers||[]).map(l=>[l.id,l]));
    for(const [id,at] of Object.entries(list.deleted||{})){
      const local=layers.get(id);
      if(local&&local.doc.markup.updated<=at) removeLocal(id);
    }
    for(const info of remote.values()){
      const local=layers.get(info.id);
      if(local&&local.doc.markup.updated>=info.updated){ if(local.doc.markup.updated===info.updated) local.syncedAt=info.updated;continue }
      const r=await fetch(B.api(`/api/markup/${info.id}`),{cache:"no-store"});
      if(r.ok) adopt(await r.json());
    }
    for(const layer of [...layers.values()]){
      const info=remote.get(layer.doc.markup.id);
      if(!info||layer.doc.markup.updated>info.updated) await push(layer);
    }
    status("synced");
  }catch(error){ status("error") }
  finally{
    syncing=false;changed();
    if(syncAgain){ syncAgain=false;syncAll() }
  }
}
async function push(layer){
  const doc=layer.doc,sent=doc.markup.updated;
  const r=await fetch(B.api(`/api/markup/${doc.markup.id}`),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc)});
  if(r.ok) layer.syncedAt=sent;
  else if(r.status===409) adopt(await r.json());
  else if(r.status===410) removeLocal(doc.markup.id);
  else throw new Error(`markup save HTTP ${r.status}`);
}
function adopt(doc){
  if(!doc?.markup?.id) return;
  const local=layers.get(doc.markup.id);
  idb.put(doc);
  if(local){ local.doc=doc;local.syncedAt=doc.markup.updated;if(selected?.layer===local) deselect();renderLayer(local) }
  else{ const view=readView()[doc.markup.id]||{};const layer=makeLayer(doc,view);layer.syncedAt=doc.markup.updated;layer.rank=nextRank();applyOrder() }
}
function removeLocal(id){
  const layer=layers.get(id);if(!layer) return;
  if(editing===layer) stopEditing();
  layer.group.remove();layer.renderer.remove?.();layer.pane.remove();
  layers.delete(id);idb.del(id);undoStacks.delete(id);writeView();changed();
}
function status(state){ if(state) lastStatus=state;changed() }
document.addEventListener("csp:server",()=>syncAll());
setInterval(()=>{ if(serverState().online&&!document.hidden) syncAll() },60000);

/* ------------------------------------------------------------- public: CRUD */
function nextRank(){ return Math.max(0,...[...layers.values()].map(l=>l.rank+1)) }
function createLayer(name,color){
  const doc={type:"FeatureCollection",markup:{id:slug(name),name:name.trim().slice(0,120)||"Markup",color,created:Date.now(),updated:Date.now()},features:[]};
  const layer=makeLayer(doc,{on:true,op:100});layer.rank=nextRank();applyOrder();writeView();
  idb.put(doc);syncAll();changed();
  return layer;
}
function renameLayer(layer,name){ if(!name.trim()) return;layer.doc.markup.name=name.trim().slice(0,120);touch(layer) }
function recolorLayer(layer,color){ layer.doc.markup.color=color;touch(layer) }
async function deleteLayer(layer){
  const id=layer.doc.markup.id,at=Date.now();
  removeLocal(id);
  const pending=await pendingDeletes();pending[id]=at;await idb.setMeta("pendingDeletes",pending);
  syncAll();
}

/* ------------------------------------------------------------------ editing */
const mapEl=map.getContainer();
const capture=document.createElement("div");capture.id="mkCapture";capture.hidden=true;mapEl.append(capture);
L.DomEvent.disableClickPropagation(capture);
/* Leaflet starts its own drag from mousedown and touchstart; the drawing
   surface keeps those to itself. The wheel is left to bubble, so zooming
   still works while a drawing tool is active. */
for(const type of ["mousedown","touchstart","dblclick"]) capture.addEventListener(type,event=>event.stopPropagation(),{passive:true});
const bar=document.createElement("div");bar.id="mkBar";bar.hidden=true;bar.setAttribute("role","toolbar");bar.setAttribute("aria-label","Markup tools");
document.getElementById("app").append(bar);
L.DomEvent.disableClickPropagation(bar);L.DomEvent.disableScrollPropagation(bar);
const TOOLS=[["pan","hand","Pan the map"],["select","mouse-pointer-2","Select, move and edit"],["pen","pencil","Freehand pen"],["line","minus","Line"],
  ["arrow","move-up-right","Arrow"],["area","pentagon","Area (tap points, then ✓)"],["rect","square","Rectangle"],["circle","circle","Circle"],
  ["text","type","Text"],["pin","map-pin","Pin"]];
let draft=null;          // in-progress drawing
function startEditing(layer){
  if(editing&&editing!==layer) stopEditing();
  editing=layer;layer.visible=true;applyView(layer);writeView();
  penColor=penColor||layer.doc.markup.color;tool=tool==="pan"?"pen":tool;
  /* Lower the phone sheet once the tap that chose Draw has finished; doing it
     inside that tap let the same click land on the lowered sheet and raise it. */
  if(innerWidth<=760) setTimeout(()=>{ if(editing&&!document.body.classList.contains("collapsed")) $("#sideToggle")?.click() },60);
  document.body.classList.add("csp-markup-editing");
  setTool(tool);changed();
}
function stopEditing(){
  cancelDraft();deselect();editing=null;tool="pan";
  capture.hidden=true;bar.hidden=true;document.body.classList.remove("csp-markup-editing");
  map.dragging.enable();changed();
}
function setTool(next){
  cancelDraft();if(next!=="select") deselect();
  tool=next;
  const drawing=!["pan","select"].includes(tool);
  capture.hidden=!drawing;capture.dataset.tool=tool;
  paintBar();
}
function paintBar(){
  if(!editing){ bar.hidden=true;return }
  bar.hidden=false;
  const sel=selected&&selected.layer===editing?editing.items.get(selected.fid)?.feature:null;
  const color=sel?(sel.properties.color||editing.doc.markup.color):penColor;
  const pending=draft&&draft.kind==="area";
  bar.innerHTML=`
    <div class="mk-row mk-tools">${TOOLS.map(([id,ic,label])=>`<button type="button" class="mk-tool" data-tool="${id}" aria-pressed="${tool===id}" title="${label}" aria-label="${label}"><img src="${icon(ic)}" alt=""></button>`).join("")}</div>
    <div class="mk-row mk-style">
      <span class="mk-layer-name"></span>
      <div class="mk-swatches mk-scroll">${[...new Set([editing.doc.markup.color,...(color&&!PALETTE.includes(color)?[color]:[]),...PALETTE])].map(c=>`<button type="button" class="mk-swatch" data-color="${c}" style="--c:${c}" aria-pressed="${c===color}" aria-label="Colour ${c}"></button>`).join("")}</div>
      <button type="button" class="mk-text-btn" data-act="width" title="Stroke width">${WIDTHS[penWidth].label}</button>
      ${sel&&(sel.properties.kind==="text"||sel.properties.kind==="pin")?`<button type="button" class="mk-text-btn" data-act="edit-text">Edit text</button>`:""}
      ${sel?`<button type="button" class="mk-icon-btn" data-act="delete" title="Delete" aria-label="Delete selected"><img src="${icon("trash-2")}" alt=""></button>`:""}
      <button type="button" class="mk-icon-btn" data-act="undo" title="Undo" aria-label="Undo" ${undoStacks.get(editing.doc.markup.id)?.length?"":"disabled"}><img src="${icon("undo-2")}" alt=""></button>
      <button type="button" class="mk-done" data-act="${pending?"finish":"done"}">${pending?"Finish area":"Done"}</button>
    </div>`;
  $(".mk-layer-name",bar).textContent=editing.doc.markup.name;
  placeBar();
}
/* On a wide screen the bar is centred over the map, clear of the sidebar;
   on a phone the stylesheet spans it across the top. */
function placeBar(){
  if(bar.hidden) return;
  if(innerWidth<=760){ bar.style.left="";return }
  const side=document.getElementById("side"),open=side&&!document.body.classList.contains("collapsed");
  const dock=document.getElementById("mapDock")?.getBoundingClientRect();
  const left=open?side.getBoundingClientRect().right+12:12,right=dock&&dock.width?dock.left-12:innerWidth-12,width=bar.offsetWidth;
  bar.style.left=Math.max(left+width/2,Math.min(right-width/2,(left+right)/2))+"px";
}
addEventListener("resize",placeBar);
new MutationObserver(()=>requestAnimationFrame(placeBar)).observe(document.body,{attributes:true,attributeFilter:["class"]});
bar.addEventListener("click",event=>{
  const button=event.target.closest("button");if(!button||!editing) return;
  if(button.dataset.tool){ setTool(button.dataset.tool);return }
  if(button.dataset.color){
    const c=button.dataset.color;penColor=c;
    if(selected) mutate(f=>{ f.properties.color=c });
    paintBar();return;
  }
  const act=button.dataset.act;
  if(act==="width"){
    penWidth=(penWidth+1)%WIDTHS.length;
    if(selected) mutate(f=>{ if(f.properties.width) f.properties.width=WIDTHS[penWidth].px*here(); if(f.properties.kind==="text"||f.properties.kind==="pin") f.properties.size=(f.properties.kind==="text"?[14,20,30]:[22,30,42])[penWidth]*here() });
    paintBar();
  }
  else if(act==="undo") undo();
  else if(act==="delete") deleteSelected();
  else if(act==="edit-text") editSelectedText();
  else if(act==="finish") finishArea();
  else if(act==="done") stopEditing();
});
document.addEventListener("keydown",event=>{
  if(!editing||/^(input|textarea|select)$/i.test(event.target.tagName)) return;
  if(event.key==="Escape"){ if(draft) cancelDraft();else if(selected) deselect();else stopEditing();paintBar() }
  else if((event.key==="z"||event.key==="Z")&&(event.metaKey||event.ctrlKey)){ event.preventDefault();undo() }
  else if((event.key==="Delete"||event.key==="Backspace")&&selected){ event.preventDefault();deleteSelected() }
  else if(event.key==="Enter"&&draft?.kind==="area") finishArea();
});

/* Drawing on the capture surface. One pointer draws; the wheel still zooms. */
const pointLL=event=>{ const r=mapEl.getBoundingClientRect();return map.containerPointToLatLng(L.point(event.clientX-r.left,event.clientY-r.top)) };
const pointPx=event=>{ const r=mapEl.getBoundingClientRect();return L.point(event.clientX-r.left,event.clientY-r.top) };
function addFeature(kind,geometry,extra={}){
  if(!editing) return;
  pushUndo(editing);
  const feature={type:"Feature",geometry,properties:{fid:rid(),kind,color:penColor,...extra}};
  editing.doc.features.push(feature);renderFeature(editing,feature);touch(editing);paintBar();
  return feature;
}
function previewStyle(){ return {renderer:editing.renderer,pane:editing.paneName,color:penColor,weight:WIDTHS[penWidth].px,opacity:.9,lineCap:"round",lineJoin:"round",interactive:false,fillColor:penColor,fillOpacity:.18} }
function cancelDraft(){ if(draft?.preview) draft.preview.forEach(p=>p.remove());draft=null }
capture.addEventListener("pointerdown",event=>{
  if(!editing||event.button>0) return;
  event.preventDefault();event.stopPropagation();
  const ll=pointLL(event),px=pointPx(event);
  if(tool==="text"||tool==="pin"){ placeText(tool,ll,px);return }
  if(tool==="area"){
    if(!draft){ draft={kind:"area",points:[ll],px:[px],preview:[L.polyline([ll],previewStyle()).addTo(map)]};paintBar() }
    else{
      if(draft.px.length>=3&&px.distanceTo(draft.px[0])<14){ finishArea();return }
      draft.points.push(ll);draft.px.push(px);draft.preview[0].setLatLngs(draft.points);
    }
    return;
  }
  capture.setPointerCapture?.(event.pointerId);
  draft={kind:tool,start:ll,startPx:px,points:[ll],px:[px],pointerId:event.pointerId,preview:[]};
  const style=previewStyle();
  if(tool==="pen"||tool==="line"||tool==="arrow") draft.preview.push(L.polyline([ll],style).addTo(map));
  else if(tool==="rect") draft.preview.push(L.polygon([ll,ll,ll,ll],style).addTo(map));
  else if(tool==="circle") draft.preview.push(L.circle(ll,{...style,radius:1}).addTo(map));
});
capture.addEventListener("pointermove",event=>{
  if(!draft||draft.pointerId!==event.pointerId) return;
  const ll=pointLL(event),px=pointPx(event),preview=draft.preview[0];
  if(draft.kind==="pen"){
    if(px.distanceTo(draft.px[draft.px.length-1])<2.5) return;
    draft.points.push(ll);draft.px.push(px);preview.setLatLngs(draft.points);
  }else if(draft.kind==="line"||draft.kind==="arrow"){ draft.points=[draft.start,ll];draft.px=[draft.startPx,px];preview.setLatLngs(draft.points) }
  else if(draft.kind==="rect"){
    const a=draft.startPx,c=px,corners=[a,L.point(c.x,a.y),c,L.point(a.x,c.y)].map(p=>map.containerPointToLatLng(p));
    draft.points=corners;draft.px=[a,c];preview.setLatLngs(corners);
  }else if(draft.kind==="circle"){ draft.radius=map.distance(draft.start,ll);draft.px=[draft.startPx,px];preview.setRadius(draft.radius) }
});
const endStroke=event=>{
  if(!draft||draft.pointerId!==event.pointerId) return;
  const d=draft;cancelDraft();
  const span=d.px.length>1?d.px[0].distanceTo(d.px[d.px.length-1]):0;
  const width=WIDTHS[penWidth].px*here();
  if(d.kind==="pen"&&d.points.length>1) addFeature("pen",{type:"LineString",coordinates:simplify(d.points,d.px).map(toC)},{width});
  else if((d.kind==="line"||d.kind==="arrow")&&span>=4) addFeature(d.kind,{type:"LineString",coordinates:d.points.map(toC)},{width});
  else if(d.kind==="rect"&&d.px.length>1&&Math.abs(d.px[0].x-d.px[1].x)>=4&&Math.abs(d.px[0].y-d.px[1].y)>=4){
    const ring=d.points.map(toC);ring.push(ring[0]);addFeature("rect",{type:"Polygon",coordinates:[ring]},{width});
  }else if(d.kind==="circle"&&span>=4) addFeature("circle",{type:"Point",coordinates:toC(d.start)},{width,radius:+d.radius.toFixed(2)});
};
capture.addEventListener("pointerup",endStroke);capture.addEventListener("pointercancel",()=>{ if(draft&&draft.kind!=="area") cancelDraft() });
capture.addEventListener("dblclick",event=>{ event.preventDefault();if(draft?.kind==="area") finishArea() });
function finishArea(){
  if(!draft||draft.kind!=="area") return;
  const d=draft;cancelDraft();
  if(d.points.length>=3){ const ring=d.points.map(toC);ring.push(ring[0]);addFeature("area",{type:"Polygon",coordinates:[ring]},{width:WIDTHS[penWidth].px*here()}) }
  paintBar();
}
/* Drop points closer than ~1.5 screen px to the line through their
   neighbours (Ramer–Douglas–Peucker on the screen trace). */
function simplify(points,px,tol=1.5){
  if(points.length<3) return points;
  const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
  const stack=[[0,points.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();let best=0,index=-1;
    const ax=px[a].x,ay=px[a].y,dx=px[b].x-ax,dy=px[b].y-ay,len=Math.hypot(dx,dy)||1;
    for(let i=a+1;i<b;i++){ const d=Math.abs(dy*(px[i].x-ax)-dx*(px[i].y-ay))/len;if(d>best){ best=d;index=i } }
    if(best>tol){ keep[index]=1;stack.push([a,index],[index,b]) }
  }
  return points.filter((_,i)=>keep[i]);
}

/* Text entry in place: Enter commits (Shift+Enter for a new line), Escape
   cancels, an empty pin is a plain pin, an empty text is nothing. */
function textEditor(px,initial,onDone){
  const box=document.createElement("textarea");box.className="mk-text-input";box.value=initial||"";box.rows=1;
  box.style.left=px.x+"px";box.style.top=px.y+"px";box.style.color=penColor;
  mapEl.append(box);L.DomEvent.disableClickPropagation(box);
  let done=false;
  const finish=commit=>{ if(done) return;done=true;const value=box.value.replace(/\s+$/,"");box.remove();onDone(commit?value:null) };
  box.addEventListener("keydown",event=>{
    event.stopPropagation();
    if(event.key==="Enter"&&!event.shiftKey){ event.preventDefault();finish(true) }
    else if(event.key==="Escape"){ event.preventDefault();finish(false) }
  });
  box.addEventListener("blur",()=>finish(true));
  setTimeout(()=>box.focus({preventScroll:true}),0);
}
function placeText(kind,ll,px){
  textEditor(px,"",value=>{
    if(value===null) return;
    if(kind==="text"&&!value) return;
    const size=(kind==="text"?[14,20,30]:[22,30,42])[penWidth]*here();
    addFeature(kind,{type:"Point",coordinates:toC(ll)},{text:value,size:+size.toFixed(3)});
  });
}

/* ---------------------------------------------------------------- selection */
const handles=[];
function deselect(){ markSelected(false);selected=null;clearHandles() }
function select(fid){
  deselect();selected={layer:editing,fid};markSelected(true);buildHandles();paintBar();
}
function markSelected(on){
  if(!selected) return;
  const item=selected.layer.items.get(selected.fid);if(!item) return;
  for(const part of item.layers){ const el=part._path||part.getElement?.();el?.classList.toggle("csp-mk-selected",on) }
}
function mutate(fn){
  if(!selected) return;
  const item=editing.items.get(selected.fid);if(!item) return;
  pushUndo(editing);fn(item.feature);renderFeature(editing,item.feature);touch(editing);buildHandles();
}
function deleteSelected(){
  if(!selected) return;
  pushUndo(editing);
  editing.doc.features=editing.doc.features.filter(f=>f.properties.fid!==selected.fid);
  const item=editing.items.get(selected.fid);item?.layers.forEach(l=>editing.group.removeLayer(l));editing.items.delete(selected.fid);
  deselect();touch(editing);paintBar();
}
function editSelectedText(){
  const item=editing.items.get(selected?.fid);if(!item) return;
  const f=item.feature,px=map.latLngToContainerPoint(toLL(f.geometry.coordinates));
  textEditor(px,f.properties.text,value=>{ if(value===null) return;if(f.properties.kind==="text"&&!value){ deleteSelected();return }
    mutate(feature=>{ feature.properties.text=value });paintBar() });
}
map.on("click",()=>{ if(editing&&tool==="select"&&selected){ deselect();paintBar() } });

function clearHandles(){ while(handles.length) handles.pop().remove() }
function handle(ll,kind,onDrag,onStart){
  const marker=L.marker(ll,{draggable:true,keyboard:false,zIndexOffset:1000,
    icon:L.divIcon({className:`csp-mk-handle csp-mk-handle-${kind}`,iconSize:kind==="move"?[30,30]:[18,18]})}).addTo(map);
  marker.on("dragstart",()=>{ pushUndo(editing);onStart?.() });
  marker.on("drag",event=>onDrag(event.target.getLatLng()));
  marker.on("dragend",()=>{ touch(editing);buildHandles();paintBar() });
  handles.push(marker);return marker;
}
function buildHandles(){
  clearHandles();
  const item=selected&&editing?.items.get(selected.fid);if(!item) return;
  const f=item.feature,p=f.properties,g=f.geometry;
  const redraw=()=>renderFeature(editing,f);
  /* Moving the whole mark: every vertex is shifted by the handle's travel in
     Web Mercator metres, so its shape is kept exactly. */
  const moveAll=(anchor)=>{
    let origin=null,coords=null;
    return [ll=>{ const d=proj(ll),o=origin;if(!o) return;
      const shift=c=>toC(unproj({x:proj(toLL(c)).x+d.x-o.x,y:proj(toLL(c)).y+d.y-o.y}));
      if(g.type==="Point") g.coordinates=shift(coords);
      else if(g.type==="LineString") g.coordinates=coords.map(shift);
      else g.coordinates=[coords[0].map(shift)];
      origin=d;coords=JSON.parse(JSON.stringify(g.coordinates));redraw() },
      ()=>{ origin=proj(anchor);coords=JSON.parse(JSON.stringify(g.coordinates)) }];
  };
  if(g.type==="Point"){
    const [drag,start]=moveAll(toLL(g.coordinates));
    handle(toLL(g.coordinates),"move",drag,start);
    if(p.kind==="circle"){
      const center=toLL(g.coordinates),edge=unproj({x:proj(center).x+p.radius/Math.cos(center.lat*Math.PI/180),y:proj(center).y});
      handle(edge,"vertex",ll=>{ p.radius=+map.distance(toLL(g.coordinates),ll).toFixed(2);redraw() });
    }
    return;
  }
  const ring=g.type==="Polygon";
  const pts=ring?g.coordinates[0].slice(0,-1):g.coordinates;
  if(p.kind!=="pen") pts.forEach((c,i)=>handle(toLL(c),"vertex",ll=>{
    if(p.kind==="rect"){
      /* A rectangle stays a rectangle: the opposite corner is fixed and the
         two neighbours slide along their edges. */
      const P=g.coordinates[0].slice(0,-1).map(x=>proj(toLL(x))),o=P[(i+2)%4],n1=P[(i+1)%4],n3=P[(i+3)%4],q=proj(ll);
      const unit=(a)=>{ const l=Math.hypot(a.x-o.x,a.y-o.y)||1;return {x:(a.x-o.x)/l,y:(a.y-o.y)/l} };
      const u=unit(n1),v=unit(n3),a=(q.x-o.x)*u.x+(q.y-o.y)*u.y,b=(q.x-o.x)*v.x+(q.y-o.y)*v.y;
      P[(i+1)%4]={x:o.x+u.x*a,y:o.y+u.y*a};P[(i+3)%4]={x:o.x+v.x*b,y:o.y+v.y*b};P[i]=q;
      const next=P.map(x=>toC(unproj(x)));next.push(next[0]);g.coordinates=[next];
    }else{
      pts[i]=toC(ll);
      if(ring){ const r=[...pts,pts[0]];g.coordinates=[r] }
    }
    redraw();
  }));
  const center=L.latLngBounds(pts.map(toLL)).getCenter();
  const [drag,start]=moveAll(center);
  handle(center,"move",drag,start);
}

/* ---------------------------------------------------------------- the panel */
let panel=null;
let changeTimer=null;
function changed(){
  clearTimeout(changeTimer);
  changeTimer=setTimeout(()=>{ if(panel?.isConnected) renderPanel(panel);document.dispatchEvent(new CustomEvent("csp:layers-changed")) },60);
}
function statusText(layer){
  const server=serverState();
  if(!server.online) return "Saved on this device";
  if(layer.syncedAt===layer.doc.markup.updated) return "Saved on your PC";
  return lastStatus==="error"?"Not saved to your PC yet":"Saving to your PC…";
}
function renderPanel(container){
  panel=container;
  const list=[...layers.values()].sort((a,b)=>b.rank-a.rank);
  const server=serverState();
  container.innerHTML=`
    <div class="csp-section-label">Markup layers</div>
    <div class="csp-card mk-panel">
      <div class="mk-new" hidden>
        <input class="mk-new-name" type="text" maxlength="120" placeholder="Layer name, e.g. Pangborn Bar" aria-label="New layer name">
        <div class="mk-color-grid" role="radiogroup" aria-label="Layer colour">${COLOR_GRID.map((c,i)=>`<button type="button" class="mk-swatch" role="radio" data-new-color="${c}" style="--c:${c}" aria-pressed="${i===2}" aria-checked="${i===2}" aria-label="Colour ${c}"></button>`).join("")}</div>
        <div class="mk-new-actions"><button type="button" class="mk-text-btn" data-act="cancel-new">Cancel</button><button type="button" class="mk-done" data-act="create">Create layer</button></div>
      </div>
      <button type="button" class="mk-add" data-act="new"><img src="${icon("plus")}" alt=""><span>New markup layer</span></button>
      <div class="mk-list"></div>
      <div class="mk-note">${server.online?"Layers are kept on your PC by the terrain engine and on this device, so they are here offline too.":"Layers are saved on this device. Connect the terrain engine to keep them on your PC and share them between devices."}</div>
    </div>`;
  const listEl=$(".mk-list",container);
  if(!list.length){ const empty=document.createElement("div");empty.className="csp-empty-layers";empty.textContent="No markup layers yet.";listEl.append(empty) }
  for(const layer of list){
    const m=layer.doc.markup,row=document.createElement("article");row.className="mk-layer";row.dataset.id=m.id;
    row.innerHTML=`
      <span class="mk-dot" style="--c:${m.color}"></span>
      <div class="mk-layer-main"><div class="mk-layer-title"></div><div class="mk-layer-meta"></div></div>
      <label class="csp-switch" aria-label="Show ${m.name.replace(/"/g,"")}"><input type="checkbox" ${layer.visible?"checked":""}><span></span></label>
      <div class="mk-layer-actions">
        <button type="button" class="mk-text-btn mk-primary" data-act="edit">${editing===layer?"Drawing…":"Draw"}</button>
        <button type="button" class="mk-text-btn" data-act="rename">Rename</button>
        <button type="button" class="mk-text-btn" data-act="zoom" ${m&&layer.doc.features.length?"":"disabled"}>Zoom to</button>
        <button type="button" class="mk-text-btn mk-danger" data-act="delete">Delete</button>
      </div>`;
    $(".mk-layer-title",row).textContent=m.name;
    $(".mk-layer-meta",row).textContent=`${layer.doc.features.length} item${layer.doc.features.length===1?"":"s"} · ${statusText(layer)}`;
    $(".csp-switch input",row).addEventListener("change",event=>setVisible(m.id,event.target.checked));
    listEl.append(row);
  }
  container.onclick=event=>{
    const button=event.target.closest("button");if(!button) return;
    const row=button.closest(".mk-layer"),layer=row&&layers.get(row.dataset.id),act=button.dataset.act;
    if(button.dataset.newColor){ container.querySelectorAll("[data-new-color]").forEach(b=>{ b.setAttribute("aria-pressed",String(b===button));b.setAttribute("aria-checked",String(b===button)) });return }
    if(act==="new"){ $(".mk-new",container).hidden=false;button.hidden=true;$(".mk-new-name",container).focus();return }
    if(act==="cancel-new"){ renderPanel(container);return }
    if(act==="create"){
      const name=$(".mk-new-name",container).value.trim()||`Markup ${layers.size+1}`;
      const color=container.querySelector('[data-new-color][aria-pressed="true"]')?.dataset.newColor||PALETTE[0];
      const created=createLayer(name,color);penColor=color;startEditing(created);return;
    }
    if(!layer) return;
    if(act==="edit"){ if(editing===layer) stopEditing();else startEditing(layer) }
    else if(act==="zoom"){ const b=layer.group.getBounds();if(b.isValid()) map.fitBounds(b,{padding:[40,40],maxZoom:18}) }
    else if(act==="rename"){
      const title=$(".mk-layer-title",row),input=document.createElement("input");
      input.type="text";input.value=layer.doc.markup.name;input.className="mk-rename";input.maxLength=120;title.replaceWith(input);input.focus();input.select();
      const done=commit=>{ if(commit) renameLayer(layer,input.value);renderPanel(container) };
      input.addEventListener("keydown",e=>{ if(e.key==="Enter") done(true);else if(e.key==="Escape") done(false) });
      input.addEventListener("blur",()=>done(true));
    }else if(act==="delete"){
      /* No browser dialog: the button asks once more in place. */
      if(button.dataset.confirm){ deleteLayer(layer);return }
      button.dataset.confirm="1";button.textContent="Delete for good?";setTimeout(()=>{ if(button.isConnected){ delete button.dataset.confirm;button.textContent="Delete" } },4000);
    }
  };
  /* The grid fades out below its fifth row; the fade lifts once it has
     scrolled to the end, and a matching fade appears at the top once it has
     scrolled away from it. */
  const grid=$(".mk-color-grid",container);
  if(grid){
    const edges=()=>{ grid.classList.toggle("mk-at-top",grid.scrollTop<2);grid.classList.toggle("mk-at-end",grid.scrollTop+grid.clientHeight>=grid.scrollHeight-2) };
    grid.addEventListener("scroll",edges,{passive:true});requestAnimationFrame(edges);
  }
  $(".mk-new-name",container)?.addEventListener("keydown",event=>{ if(event.key==="Enter") container.querySelector('[data-act="create"]').click() });
}

/* ----------------------------------------------- the Layers list and export */
function setVisible(id,on){
  const layer=layers.get(id);if(!layer) return;
  layer.visible=!!on;if(!on&&editing===layer) stopEditing();
  applyView(layer);writeView();changed();
}
function setOpacity(id,value){ const layer=layers.get(id);if(!layer) return;layer.opacity=Math.max(0,Math.min(100,+value||0));applyView(layer);writeView() }
function setOrder(ids){
  const markupIds=ids.filter(id=>layers.has(id));
  markupIds.forEach((id,index)=>{ layers.get(id).rank=markupIds.length-index });
  applyOrder();writeView();
}
function activeEntries(){
  return [...layers.values()].filter(l=>l.visible).sort((a,b)=>b.rank-a.rank).map(l=>({
    id:`markup:${l.doc.markup.id}`,name:l.doc.markup.name,
    meta:`Markup · ${l.doc.features.length} item${l.doc.features.length===1?"":"s"}`,
    opacity:l.opacity,visible:true,kind:"markup"}));
}

window.CSPMarkup={renderPanel,activeEntries,setVisible,setOpacity,setOrder,
  resetLayer:id=>setOpacity(id,100),count:()=>[...layers.values()].filter(l=>l.visible).length,
  sync:syncAll,_layers:layers};

/* ------------------------------------------------------------------- start */
(async()=>{
  const view=readView();
  for(const doc of await idb.all()) if(doc?.markup?.id&&!layers.has(doc.markup.id)) makeLayer(doc,view[doc.markup.id]||{});
  applyOrder();changed();
  syncAll();
})();
})();
