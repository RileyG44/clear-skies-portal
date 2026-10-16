/* Clear Skies Portal — markup (annotation) layers.

   A markup layer is a named set of drawings: pen and highlighter strokes,
   lines and arrows, shapes, text and pins. Each mark carries its own colour,
   width and transparency; the layer's colour is only its identifier and the
   default ink. Surface marks use latitude/longitude and fixed ground sizes.
   Floating marks also store an altitude and two fixed world axes; their
   geometry encodes local coordinates in a plane, rendered by markup-3d.js.
   Font controls use pixels at placement and retain a fixed physical size.

   Storage. Each layer is one GeoJSON FeatureCollection with a `markup` header.
   The browser keeps every layer in IndexedDB, so markup works with no engine
   at all. When the terrain engine is reachable the layers are also kept there
   as files (server.js /api/markup), which is what shares them between
   devices: the newer copy of a layer wins, and a deleted layer leaves a
   tombstone so an offline device cannot resurrect it. Visibility and opacity
   are this device's view of a layer, not part of it.

   Rendering. Each layer has its own pane (so layers stack and fade
   independently) with its own SVG renderer, inside the rotating pane. Text
   and pins are SVG too, drawn into the same renderer, which is what lets the
   PNG exporter capture them with everything else.

   Editing works like a drawing program: one selected mark at a time, moved by
   dragging it, resized and rotated from a frame of handles, restyled from the
   toolbar. Geometry edits happen in Web Mercator metres, where a small
   rotation or scale keeps shapes true. */
(function(){
"use strict";
const B=window.ClearSkiesPortalBridge,L=window.L;
if(!B||!B.map||!L) return;
const map=B.map;
const $=(s,r=document)=>r.querySelector(s);
const SVGNS="http://www.w3.org/2000/svg";
/* The colour picker: ten hue rows of five, light to dark, the most used hues
   first. The middle column is each hue at full strength. */
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
const DEFAULT_COLOR="#ff3b30";
const VIEW_KEY="clearskies.markup.view.v1",STYLE_KEY="clearskies.markup.style.v1",LAST_KEY="clearskies.markup.last.v1";
const icon=name=>`vendor/icons/${name}.svg`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------------------------------------------------------------- geometry */
const MERC=40075016.686;
const mpp=(lat,zoom)=>MERC*Math.cos(lat*Math.PI/180)/Math.pow(2,zoom+8);
const view3d=()=>B.map3d?.()||null;
/* MapLibre zoom uses a 512px world tile; Leaflet and annotation raster
   addressing use 256px. Normalize only screen-size calculations. */
const viewZoom=()=>{const v=view3d();return v?v.getZoom()+1:map.getZoom()};
const here=()=>mpp((view3d()?.getCenter()||map.getCenter()).lat,viewZoom());
const feet=m=>m/0.3048;
const proj=ll=>L.CRS.EPSG3857.project(L.latLng(ll));
const unproj=p=>L.CRS.EPSG3857.unproject(L.point(p.x,p.y));
const toLL=c=>L.latLng(c[1],c[0]);
const toC=ll=>[+ll.lng.toFixed(10),+ll.lat.toFixed(10)];
const cToP=c=>proj(toLL(c)),pToC=p=>toC(unproj(p));
const rid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function slug(name){
  const base=String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)||"layer";
  return `${base}-${Math.random().toString(36).slice(2,8)}`;
}
/* Arrow head as a ground-anchored triangle at the end of a→b: Web Mercator
   metres are ground metres stretched by 1/cos(lat), so the head is sized in
   the same frame. Returns the triangle and the point where the shaft should
   stop, so a see-through arrow does not darken where shaft and head meet. */
function arrowHead(a,b,widthM){
  const A=proj(a),Bp=proj(b),k=1/Math.cos(b.lat*Math.PI/180);
  const dx=Bp.x-A.x,dy=Bp.y-A.y,len=Math.hypot(dx,dy);
  if(!len) return null;
  const ux=dx/len,uy=dy/len,h=Math.min(len*0.6,Math.max(widthM*4.5,widthM*2+4)*k),w=h*0.6;
  const bx=Bp.x-ux*h,by=Bp.y-uy*h;
  return {tri:[unproj(Bp),unproj({x:bx-uy*w,y:by+ux*w}),unproj({x:bx+uy*w,y:by-ux*w})],stop:unproj({x:Bp.x-ux*h*0.75,y:Bp.y-uy*h*0.75})};
}
const luminance=hex=>{ const n=parseInt(hex.slice(1),16);return (0.299*(n>>16)+0.587*((n>>8)&255)+0.114*(n&255))/255 };
const haloFor=color=>luminance(color)>0.82?"rgba(20,20,22,.8)":"rgba(255,255,255,.95)";

/* Shapes, as outlines in a unit box (x right, y down) fitted to the box the
   user drags. Lines are drawn end to end instead. */
const regular=(n,inner)=>{ const out=[],count=inner?n*2:n;
  for(let i=0;i<count;i++){ const a=-Math.PI/2+i*2*Math.PI/count,r=inner&&i%2?inner:1;out.push([.5+.5*r*Math.cos(a),.5+.5*r*Math.sin(a)]) }
  return out };
const SHAPES=[
  {id:"line",label:"Line",line:true},
  {id:"arrow",label:"Arrow",line:true},
  {id:"arrow2",label:"Double arrow",line:true},
  {id:"rect",label:"Rectangle",gen:()=>[[0,0],[1,0],[1,1],[0,1]]},
  {id:"roundrect",label:"Rounded rectangle",gen:(w,h)=>{
    const r=Math.min(w,h)*0.18,rx=r/w,ry=r/h,out=[],arc=(cx,cy,a0)=>{ for(let i=0;i<=8;i++){ const a=a0+i*Math.PI/16;out.push([cx+rx*Math.cos(a),cy+ry*Math.sin(a)]) } };
    arc(1-rx,ry,-Math.PI/2);arc(1-rx,1-ry,0);arc(rx,1-ry,Math.PI/2);arc(rx,ry,Math.PI);return out }},
  {id:"ellipse",label:"Oval",gen:()=>Array.from({length:72},(_,i)=>{ const a=i*Math.PI/36;return [.5+.5*Math.cos(a),.5+.5*Math.sin(a)] })},
  {id:"triangle",label:"Triangle",gen:()=>[[.5,0],[1,1],[0,1]]},
  {id:"rtriangle",label:"Right triangle",gen:()=>[[0,0],[1,1],[0,1]]},
  {id:"diamond",label:"Diamond",gen:()=>[[.5,0],[1,.5],[.5,1],[0,.5]]},
  {id:"pentagon",label:"Pentagon",gen:()=>regular(5)},
  {id:"hexagon",label:"Hexagon",gen:()=>[[.25,0],[.75,0],[1,.5],[.75,1],[.25,1],[0,.5]]},
  {id:"octagon",label:"Octagon",gen:()=>[[.3,0],[.7,0],[1,.3],[1,.7],[.7,1],[.3,1],[0,.7],[0,.3]]},
  {id:"star",label:"Star",gen:()=>regular(5,.4)},
  {id:"star4",label:"Four-point star",gen:()=>regular(4,.36)},
  {id:"blockarrow",label:"Block arrow",gen:()=>[[0,.28],[.6,.28],[.6,0],[1,.5],[.6,1],[.6,.72],[0,.72]]},
  {id:"heart",label:"Heart",gen:()=>{ const pts=Array.from({length:64},(_,i)=>{ const t=i*Math.PI/32;
      return [16*Math.sin(t)**3,-(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))] });
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    return pts.map(([x,y])=>[(x-x0)/(x1-x0),(y-y0)/(y1-y0)]) }},
  {id:"lightning",label:"Lightning",gen:()=>[[.4,0],[.62,.3],[.53,.34],[.82,.6],[.72,.64],[1,1],[.48,.71],[.59,.67],[.22,.45],[.33,.4],[.02,.14]]},
  {id:"freeform",label:"Freeform (tap points)"}
];
const shapeById=id=>SHAPES.find(s=>s.id===id)||SHAPES[3];
function shapePreview(s){
  if(s.line){
    const heads={arrow:'<path d="M13 3h8v8"/>',arrow2:'<path d="M13 3h8v8"/><path d="M11 21H3v-8"/>'}[s.id]||"";
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="mk-line-glyph"><path d="M3 21L21 3"/>${heads}</svg>`;
  }
  if(s.id==="freeform") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 7 5l7 4 6-3-2 13-8 1Z"/></svg>`;
  const pts=s.gen(20,20).map(([x,y])=>`${(3+x*18).toFixed(1)},${(3+y*18).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="${pts}"/></svg>`;
}

/* Text and pins: SVG in the layer's own renderer, sized in metres. */
const MarkupPoint=L.Layer.extend({
  initialize(latlng,options){ this._latlng=L.latLng(latlng);L.setOptions(this,options) },
  onAdd(map){
    this._renderer=map.getRenderer(this);
    const g=this._el=document.createElementNS(SVGNS,"g");
    g.setAttribute("class","csp-mk-point");
    this._build();
    this._renderer._rootGroup.appendChild(g);
    this._renderer.on("update",this._reset,this);
    map.on("zoomend viewreset",this._reset,this);
    this._reset();
  },
  onRemove(map){
    this._el?.remove();
    this._renderer?.off("update",this._reset,this);
    map.off("zoomend viewreset",this._reset,this);
  },
  getLatLng(){ return this._latlng },
  getElement(){ return this._el },
  _build(){
    const g=this._el,o=this.options;g.replaceChildren();
    g.setAttribute("opacity",String(o.opacity??1));
    const text=t=>{
      const el=document.createElementNS(SVGNS,"text");
      el.setAttribute("fill",o.color);el.setAttribute("stroke",haloFor(o.color));
      el.setAttribute("paint-order","stroke");el.setAttribute("stroke-linejoin","round");
      el.setAttribute("font-family","-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter Variable',system-ui,sans-serif");
      el.setAttribute("font-weight","650");
      const lines=String(t).split("\n");
      lines.forEach((line,i)=>{ const span=document.createElementNS(SVGNS,"tspan");span.setAttribute("x","0");
        span.setAttribute("dy",i?"1.2em":String(-(lines.length-1)*0.6)+"em");span.textContent=line||" ";el.append(span) });
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
    const rot=this.options.kind==="text"&&this.options.rot?` rotate(${(-this.options.rot*180/Math.PI).toFixed(2)})`:"";
    this._el.setAttribute("transform",`translate(${pt.x.toFixed(2)},${pt.y.toFixed(2)})${rot}`);
    this._el.style.display=px<0.8?"none":"";
    if(this._pin){
      const k=px/24;
      this._pin.setAttribute("transform",`scale(${k}) translate(-12,-22.5)`);
      if(this._label){ const fs=px*0.55;this._label.setAttribute("font-size",fs.toFixed(2));
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
const store={
  get(key,fallback){ try{ const v=JSON.parse(localStorage.getItem(key));return v??fallback }catch(e){ return fallback } },
  set(key,value){ try{ localStorage.setItem(key,JSON.stringify(value)) }catch(e){} }
};
function readView(){ return store.get(VIEW_KEY,{}) }
function writeView(){
  const view={};for(const [id,layer] of layers) view[id]={on:layer.visible,op:layer.opacity,rank:layer.rank};
  store.set(VIEW_KEY,view);
}

/* ---------------------------------------------------------- drawing styles
   What the next mark will look like. Widths are screen pixels at the moment
   of drawing (stored on the mark in metres); opacities are percentages. */
const STYLE_DEFAULT={ink:{color:null,width:4,opacity:100},highlight:{color:"#ffcc00",width:22,opacity:40},
  fill:{color:"auto",opacity:20},text:{size:22},eraser:{size:28},placement:{snap:true,textSnap:false,distance:300},shape:"rect"};
const styles=(()=>{ const s=store.get(STYLE_KEY,{});
  return {ink:{...STYLE_DEFAULT.ink,...s.ink,color:null},highlight:{...STYLE_DEFAULT.highlight,...s.highlight},fill:{...STYLE_DEFAULT.fill,...s.fill},
    placement:{...STYLE_DEFAULT.placement,...s.placement},text:{...STYLE_DEFAULT.text,...s.text,size:s.text?.groundSize!=null?22:Math.round(clamp(Number(s.text?.size)||22,8,160))},eraser:{...STYLE_DEFAULT.eraser,...s.eraser},shape:SHAPES.some(x=>x.id===s.shape)?s.shape:STYLE_DEFAULT.shape} })();
const saveStyles=()=>store.set(STYLE_KEY,styles);

/* ------------------------------------------------------------------- layers */
const layers=new Map();       // id -> layer state
let editing=null,tool="pan",selected=null;
const undoStacks=new Map(),redoStacks=new Map();

function makeLayer(doc,view={}){
  const id=doc.markup.id,paneName=`csp-markup-${id}`;
  const parent=map._rotatePane||map.getPane("mapPane");
  const pane=map.getPane(paneName)||map.createPane(paneName,parent);
  pane.classList.add("csp-markup-pane");
  const layer={doc,pane,paneName,renderer:L.svg({pane:paneName,padding:0.5}),group:L.featureGroup(),
    items:new Map(),visible:view.on!==false,opacity:Number.isFinite(view.op)?view.op:100,rank:view.rank??0,syncedAt:null,renderRevision:0};
  layer.group.addTo(map);
  layers.set(id,layer);
  renderLayer(layer);applyView(layer);
  return layer;
}
function applyView(layer){
  layer.pane.style.display=layer.visible?"":"none";
  layer.pane.style.opacity=String(layer.opacity/100);schedule3d();
}
function applyOrder(){
  /* Highest rank on top; the Layers list order sets the ranks. All markup
     sits above imagery and overlays, below map buttons. */
  for(const layer of layers.values()) layer.pane.style.zIndex=String(450+Math.max(0,Math.min(140,layer.rank)));
  schedule3d();
}
const LINES=new Set(["pen","highlight","line","arrow","arrow2"]),AREAS=new Set(["area","rect","shape","circle"]);
const featureLat=f=>{ const g=f.geometry;return g.type==="Point"?g.coordinates[1]:(g.type==="Polygon"?g.coordinates[0][0][1]:g.coordinates[0][1]) };
const strokePx=(f,zoom=viewZoom())=>{
  const p=f.properties;if(p.space3d&&view3d()){
    const c=projectedPoints(f)[0],a=featurePx(f,unproj(c)),b=featurePx(f,unproj({x:c.x+(p.width||0)/Math.cos(p.space3d.anchor[1]*Math.PI/180),y:c.y}));
    return a.distanceTo(b);
  }
  return (p.width||0)/mpp(featureLat(f),zoom);
};
function featureLayers(layer,feature){
  const p=feature.properties,color=p.color||layer.doc.markup.color,g=feature.geometry;
  if(p.space3d)return [];
  const opacity=p.opacity??(p.kind==="highlight"?0.4:1);
  const base={renderer:layer.renderer,pane:layer.paneName,color,opacity,lineCap:"round",lineJoin:"round",interactive:false};
  const weight=()=>Math.max(0.6,strokePx(feature));
  const out=[];
  if(LINES.has(p.kind)){
    let latlngs=g.coordinates.map(toLL);
    const heads=[];
    if((p.kind==="arrow"||p.kind==="arrow2")&&latlngs.length>=2){
      const n=latlngs.length,end=arrowHead(latlngs[n-2],latlngs[n-1],p.width||2);
      if(end){ heads.push(end.tri);latlngs=[...latlngs.slice(0,-1),end.stop] }
      if(p.kind==="arrow2"){ const start=arrowHead(latlngs[1],latlngs[0],p.width||2);if(start){ heads.push(start.tri);latlngs=[start.stop,...latlngs.slice(1)] } }
    }
    const line=L.polyline(latlngs,{...base,weight:weight(),className:p.kind==="highlight"?"csp-mk-hl":""});line._mkWeight=weight;out.push(line);
    for(const tri of heads){ const h=L.polygon(tri,{...base,weight:weight()*0.6,fill:true,fillColor:color,fillOpacity:opacity});h._mkWeight=()=>weight()*0.6;out.push(h) }
  }else if(AREAS.has(p.kind)){
    const fill=p.fillColor===null?{fill:false}:{fill:true,fillColor:p.fillColor||color,fillOpacity:p.fill??0.18};
    const stroke=(p.width??1)>0?{stroke:true,weight:weight()}:{stroke:false};
    const shape=p.kind==="circle"?L.circle(toLL(g.coordinates),{...base,radius:p.radius,...stroke,...fill})
      :L.polygon(g.coordinates[0].slice(0,-1).map(toLL),{...base,...stroke,...fill});
    shape._mkWeight=weight;out.push(shape);
  }else if(p.kind==="text"||p.kind==="pin"){
    out.push(new MarkupPoint(toLL(g.coordinates),{renderer:layer.renderer,pane:layer.paneName,kind:p.kind,text:p.text||"",size:p.size||20,color,opacity,rot:p.rot||0}));
  }
  return out;
}
function renderFeature(layer,feature){
  const old=layer.items.get(feature.properties.fid);
  old?.layers.forEach(l=>layer.group.removeLayer(l));
  const built=featureLayers(layer,feature);
  built.forEach(l=>layer.group.addLayer(l));
  layer.items.set(feature.properties.fid,{feature,layers:built});
  layer.renderRevision++;schedule3d();
}
function renderLayer(layer){
  layer.group.clearLayers();layer.items.clear();layer.renderRevision++;schedule3d();
  for(const feature of layer.doc.features) renderFeature(layer,feature);
}
map.on("zoomend",()=>{
  for(const layer of layers.values()) for(const {layers:parts} of layer.items.values())
    for(const part of parts) if(part._mkWeight&&part.setStyle&&part.options.stroke!==false) part.setStyle({weight:part._mkWeight()});
});

/* Ground rendering is shared by PNG exports and terrain raster tiles. Paths,
   text and pins use geographic positions and ground dimensions; screen zoom,
   pitch and bearing never rewrite the saved marks. */
function drawGround(ctx,features,color,project,metresPerPixel){
  for(const f of features){
    const p=f.properties,g=f.geometry,ink=p.color||color,layerAlpha=ctx.globalAlpha;
    const lat=featureLat(f),unit=metresPerPixel(lat),width=(p.width||0)/unit;
    const point=c=>project(toLL(c));
    const path=(coords,close=false)=>{ctx.beginPath();coords.forEach((c,i)=>{const q=point(c);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});if(close)ctx.closePath()};
    ctx.save();ctx.globalAlpha*=p.opacity??(p.kind==="highlight"?.4:1);
    ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.lineWidth=width;ctx.lineCap="round";ctx.lineJoin="round";
    if(LINES.has(p.kind)){
      let cs=g.coordinates,heads=[];
      if((p.kind==="arrow"||p.kind==="arrow2")&&cs.length>1){
        const end=arrowHead(toLL(cs[cs.length-2]),toLL(cs[cs.length-1]),p.width||2);
        if(end){heads.push(end.tri.map(toC));cs=[...cs.slice(0,-1),toC(end.stop)]}
        if(p.kind==="arrow2"){const start=arrowHead(toLL(cs[1]),toLL(cs[0]),p.width||2);if(start){heads.push(start.tri.map(toC));cs=[toC(start.stop),...cs.slice(1)]}}
      }
      path(cs);if(width>0)ctx.stroke();
      for(const h of heads){path(h,true);ctx.fill()}
    }else if(AREAS.has(p.kind)){
      if(p.kind==="circle"){const q=point(g.coordinates);ctx.beginPath();ctx.arc(q.x,q.y,p.radius/unit,0,Math.PI*2)}
      else path(g.coordinates[0],true);
      if(p.fillColor!==null){ctx.save();ctx.globalAlpha=layerAlpha*(p.fill??.18);ctx.fillStyle=p.fillColor||ink;ctx.fill("evenodd");ctx.restore()}
      if(width>0)ctx.stroke();
    }else if(p.kind==="text"||p.kind==="pin"){
      const q=point(g.coordinates),size=(p.size||20)/unit;
      ctx.translate(q.x,q.y);ctx.rotate(-(p.rot||0));ctx.scale(size/24,size/24);
      ctx.lineJoin="round";
      const label=(text,x,y,fs,align)=>{
        ctx.font=`650 ${fs}px -apple-system, BlinkMacSystemFont, sans-serif`;ctx.textAlign=align;ctx.textBaseline="middle";
        ctx.strokeStyle=haloFor(ink);ctx.fillStyle=ink;ctx.lineWidth=fs*.16;
        const lines=String(text||"").split("\n");lines.forEach((t,i)=>{const Y=y+(i-(lines.length-1)/2)*fs*1.2;ctx.strokeText(t,x,Y);ctx.fillText(t,x,Y)});
      };
      if(p.kind==="pin"){
        ctx.save();ctx.translate(-12,-22.5);ctx.fillStyle=ink;ctx.strokeStyle=haloFor(ink);ctx.lineWidth=1.2;
        const pin=new Path2D("M12 1.5C7.6 1.5 4.5 4.8 4.5 9c0 5.6 7.5 13.5 7.5 13.5S19.5 14.6 19.5 9c0-4.2-3.1-7.5-7.5-7.5z");ctx.fill(pin);ctx.stroke(pin);
        ctx.beginPath();ctx.arc(12,9,2.8,0,Math.PI*2);ctx.fillStyle=haloFor(ink);ctx.fill();ctx.restore();
        if(p.text)label(p.text,24*.38,-24*.6,24*.55,"left");
      }else label(p.text,0,0,24,"center");
    }
    ctx.restore();
  }
}
function snapshotEntries(){return [...layers.values()].filter(l=>l.visible&&l.opacity>0&&l.doc.features.length).map(l=>({kind:"markup",id:l.doc.markup.id,el:l.pane}))}
function drawSnapshotLayer(ctx,id,spec){
  const layer=layers.get(id);if(!layer?.visible||!layer.opacity)return false;
  const z=map.getZoom(),o=map.project(map.getCenter(),z);
  const at=p=>map.latLngToContainerPoint(map.unproject(p,z)),a=at(o),b=at(o.add([256,0])),c=at(o.add([0,256])),k=spec.scale;
  let surface=null,paint=ctx;
  if(layer.opacity<100){surface=document.createElement("canvas");surface.width=ctx.canvas.width;surface.height=ctx.canvas.height;paint=surface.getContext("2d");if(!paint)throw new Error("The annotation drawing surface could not be allocated.")}
  paint.save();paint.globalAlpha=1;
  paint.setTransform(k*(b.x-a.x)/256,k*(b.y-a.y)/256,k*(c.x-a.x)/256,k*(c.y-a.y)/256,k*(a.x-spec.sel.x),k*(a.y-spec.sel.y));
  drawGround(paint,layer.doc.features.filter(f=>!f.properties.space3d),layer.doc.markup.color,ll=>map.project(ll,z).subtract(o),lat=>mpp(lat,z));
  paint.restore();
  if(surface){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=layer.opacity/100;ctx.drawImage(surface,0,0);ctx.restore();surface.width=surface.height=0}
  return true;
}
let terrainView=null,terrainModule=null,terrainTimer=null,terrainSyncing=false,worldLayer=null;
const terrainIds=new Set();
function schedule3d(){clearTimeout(terrainTimer);terrainTimer=setTimeout(sync3d,45)}
function sync3d(){
  const v=terrainView;if(!v||v!==view3d()||terrainSyncing||!v.getLayer("background"))return;
  terrainSyncing=true;
  try{
    for(const id of [...terrainIds])if(!layers.has(id)){if(v.getLayer(`mk-${id}`))v.removeLayer(`mk-${id}`);if(v.getSource(`mk-${id}`))v.removeSource(`mk-${id}`);terrainIds.delete(id)}
    for(const layer of [...layers.values()].sort((a,b)=>a.rank-b.rank)){
      const id=layer.doc.markup.id,key=`mk-${id}`,url=`csp-markup://${id}/${layer.renderRevision}/{z}/{x}/{y}`;
      let source=v.getSource(key);
      if(!source){v.addSource(key,{type:"raster",tiles:[url],tileSize:256,minzoom:0,maxzoom:22,attribution:""});source=v.getSource(key);source._mkRevision=layer.renderRevision}
      else if(source._mkRevision!==layer.renderRevision){source._mkRevision=layer.renderRevision;source.setTiles([url])}
      if(!v.getLayer(key))v.addLayer({id:key,type:"raster",source:key,layout:{visibility:layer.visible&&layer.opacity>0?"visible":"none"},paint:{"raster-opacity":1,"raster-fade-duration":0}});
      const visibility=layer.visible&&layer.opacity>0?"visible":"none";
      if(v.getLayoutProperty(key,"visibility")!==visibility)v.setLayoutProperty(key,"visibility",visibility);
      terrainIds.add(id);
    }
    if(!v.getLayer("csp-world-markup")&&window.CSPMarkup3D){worldLayer=window.CSPMarkup3D.createLayer(terrainModule,v,()=>[...layers.values()],drawGround);v.addLayer(worldLayer)}
    worldLayer?.refresh();
    const ordered=[...layers.values()].sort((a,b)=>a.rank-b.rank).map(l=>`mk-${l.doc.markup.id}`);
    const current=v.getStyle().layers.filter(l=>l.id.startsWith("mk-")).map(l=>l.id);
    if(current.join()!==ordered.join())for(const key of ordered)v.moveLayer(key,"csp-world-markup");
  }finally{terrainSyncing=false}
}
/* Cache geographic bounds once per layer revision, rather than project every
   vertex of every drawing for every visible tile. Margins cover caps, heads,
   rotated text and labelled pins. */
const featureBounds=new WeakMap();
function featuresForTile(layer,z,x,y){
  const span=MERC/2**z,left=-MERC/2+x*span,top=MERC/2-y*span;
  return layer.doc.features.filter(f=>{
    if(f.properties.space3d)return false;
    let cached=featureBounds.get(f);
    if(cached?.revision!==layer.renderRevision){
      const g=f.geometry,p=f.properties,coords=g.type==="Point"?[g.coordinates]:g.type==="Polygon"?g.coordinates[0]:g.coordinates;
      const lat=featureLat(f),stretch=1/Math.max(.001,Math.cos(lat*Math.PI/180));
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(const c of coords){const p=cToP(c);x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y)}
      const lines=String(p.text||"").split("\n"),textExtent=(p.size||20)*(Math.max(1,...lines.map(l=>l.length))+lines.length+2);
      const margin=Math.max((p.width||2)*6+8,(p.radius||0)+(p.kind==="circle"?(p.width||2)*6+8:0),(p.kind==="text"||p.kind==="pin")?textExtent:0)*stretch;
      cached={revision:layer.renderRevision,x0:x0-margin,x1:x1+margin,y0:y0-margin,y1:y1+margin};
      featureBounds.set(f,cached);
    }
    return cached.x1>=left&&cached.x0<=left+span&&cached.y1>=top-span&&cached.y0<=top;
  });
}
async function prepare3d(){
  const v=view3d();if(!v)return;
  const deadline=performance.now()+8000;
  while(view3d()===v){
    sync3d();
    const ready=snapshotEntries().every(item=>{const key=`mk-${item.id}`;return !!v.getSource(key)&&v.isSourceLoaded(key)});
    if(ready)return;
    if(performance.now()>deadline)throw new Error("Annotation layers are still loading. Wait a moment and save again.");
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error("The map view changed while preparing the image.");
}
function attach3d(module,v){
  if(!terrainModule){
    module.addProtocol("csp-markup",async(params,abort)=>{
      const match=/^csp-markup:\/\/([^/]+)\/\d+\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
      if(!match)throw new Error("Invalid annotation tile");
      const [,id,Z,X,Y]=match,z=+Z,x=+X,y=+Y,layer=layers.get(id),canvas=document.createElement("canvas");canvas.width=canvas.height=512;
      const ctx=canvas.getContext("2d");ctx.scale(2,2);
      if(layer){
        drawGround(ctx,featuresForTile(layer,z,x,y),layer.doc.markup.color,ll=>map.project(ll,z).subtract([x*256,y*256]),lat=>mpp(lat,z));
        if(layer.opacity<100){ctx.globalCompositeOperation="destination-in";ctx.globalAlpha=layer.opacity/100;ctx.fillStyle="#000";ctx.fillRect(0,0,256,256)}
      }
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Annotation tile could not be encoded")),"image/png"));
      if(abort.signal.aborted)throw new DOMException("Cancelled","AbortError");
      return {data:await blob.arrayBuffer()};
    });terrainModule=module;
  }
  terrainView=v;worldLayer=null;terrainIds.clear();
  v.on("styledata",schedule3d);v.on("load",schedule3d);v.on("move",()=>{if(selected&&!gesture)drawFrame();redrawDraft()});
  v.on("render",()=>{if(selected&&!gesture)drawFrame();if(draft)redrawDraft()});
  v.on("moveend",paintBarValues);if(editing)paintBar();schedule3d();
}

/* -------------------------------------------------------------- persistence */
let syncTimer=null,syncing=false,syncAgain=false,lastStatus="";
const serverState=()=>B.server?.()||{online:false};
function touch(layer){
  layer.doc.markup.updated=Date.now();
  idb.put(layer.doc);
  clearTimeout(syncTimer);syncTimer=setTimeout(syncAll,900);
  changed();
}
const stackFor=(stacks,layer)=>{ const id=layer.doc.markup.id;if(!stacks.has(id)) stacks.set(id,[]);return stacks.get(id) };
function pushUndo(layer){
  const stack=stackFor(undoStacks,layer);
  stack.push(JSON.stringify(layer.doc.features));if(stack.length>100) stack.shift();
  stackFor(redoStacks,layer).length=0;
  if(editing===layer)syncHistoryButtons();
}
function dropUndo(layer){ stackFor(undoStacks,layer).pop();if(editing===layer)syncHistoryButtons() }
function undoRedo(redo){
  if(!editing) return;
  const from=stackFor(redo?redoStacks:undoStacks,editing),to=stackFor(redo?undoStacks:redoStacks,editing);
  if(!from.length) return;
  to.push(JSON.stringify(editing.doc.features));
  editing.doc.features=JSON.parse(from.pop());
  deselect();renderLayer(editing);touch(editing);paintBar();
}
async function pendingDeletes(){ return (await idb.getMeta("pendingDeletes"))||{} }
async function syncAll(){
  const server=serverState();
  if(!server.online) return status();
  if(syncing){ syncAgain=true;return }
  syncing=true;status("syncing");
  try{
    const listed=await fetch(B.api("/api/markup"),{cache:"no-store"});
    /* An engine from before markup answers 404: nothing is wrong with the
       layers, they just stay on this device until the engine is updated. */
    if(listed.status===404){ status("unsupported");return }
    if(!listed.ok) throw new Error(`markup list HTTP ${listed.status}`);
    const list=await listed.json();
    const pending=await pendingDeletes();
    for(const [id,at] of Object.entries(pending)){
      const r=await fetch(B.api(`/api/markup/${id}/delete`),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({at})});
      if(r.ok){ delete pending[id];await idb.setMeta("pendingDeletes",pending) }
    }
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
  if(local&&editing===local&&gesture) return;      // never pull a mark out from under the pointer
  idb.put(doc);
  if(local){ local.doc=doc;local.syncedAt=doc.markup.updated;if(selected?.layer===local) deselect();renderLayer(local) }
  else{ const view=readView()[doc.markup.id]||{};const layer=makeLayer(doc,view);layer.syncedAt=doc.markup.updated;layer.rank=nextRank();applyOrder() }
}
function removeLocal(id){
  const layer=layers.get(id);if(!layer) return;
  if(editing===layer) stopEditing();
  layer.group.remove();layer.renderer.remove?.();layer.pane.remove();
  layers.delete(id);schedule3d();idb.del(id);undoStacks.delete(id);redoStacks.delete(id);writeView();changed();
}
function status(state){ if(state) lastStatus=state;changed() }
document.addEventListener("csp:server",()=>syncAll());
setInterval(()=>{ if(serverState().online&&!document.hidden) syncAll() },60000);

/* ------------------------------------------------------------- public: CRUD */
function nextRank(){ return Math.max(0,...[...layers.values()].map(l=>l.rank+1)) }
function createLayer(name,color){
  const doc={type:"FeatureCollection",markup:{id:slug(name),name:name.trim().slice(0,120)||"Markup",description:"",color,created:Date.now(),updated:Date.now()},features:[]};
  const layer=makeLayer(doc,{on:true,op:100});layer.rank=nextRank();applyOrder();writeView();
  idb.put(doc);syncAll();changed();
  return layer;
}
function renameLayer(layer,name){ if(!name.trim()||name.trim()===layer.doc.markup.name) return;layer.doc.markup.name=name.trim().slice(0,120);touch(layer);if(editing===layer) paintBar() }
function clearLayer(layer){
  if(!layer.doc.features.length) return;
  pushUndo(layer);
  if(selected?.layer===layer) deselect();
  layer.doc.features=[];renderLayer(layer);touch(layer);if(editing===layer) paintBar();
}
async function deleteLayer(layer){
  const id=layer.doc.markup.id,at=Date.now();
  removeLocal(id);
  const pending=await pendingDeletes();pending[id]=at;await idb.setMeta("pendingDeletes",pending);
  syncAll();
}

/* ------------------------------------------------------------------ editing */
const mapEl=map.getContainer();
/* The drawing surface: present while a drawing tool is active, so strokes go
   to the pen instead of panning the map. The wheel still zooms. */
const capture=document.createElement("div");capture.id="mkCapture";capture.hidden=true;mapEl.append(capture);
L.DomEvent.disableClickPropagation(capture);
for(const type of ["mousedown","touchstart","dblclick"]) capture.addEventListener(type,event=>event.stopPropagation(),{passive:true});
/* Selection frame and handles live in their own layer above the map. */
const draftCanvas=document.createElement("canvas");draftCanvas.id="mkDraft";mapEl.append(draftCanvas);
let draftPainted=false;
function redrawDraft(){
  if(!view3d()||!draft||!editing){if(draftPainted){draftCanvas.getContext("2d").clearRect(0,0,draftCanvas.width,draftCanvas.height);draftPainted=false}return}
  if(draftCanvas.width!==mapEl.clientWidth)draftCanvas.width=mapEl.clientWidth;
  if(draftCanvas.height!==mapEl.clientHeight)draftCanvas.height=mapEl.clientHeight;
  const ctx=draftCanvas.getContext("2d");ctx.clearRect(0,0,draftCanvas.width,draftCanvas.height);draftPainted=true;
  const screen=ll=>llPx(ll,draft.space3d),pts=draft.points.map(screen),family=draft.kind==="highlight"?styles.highlight:styles.ink;
  const widthM=family.groundWidth??family.width*placementUnit(draft.space3d),ll=draft.points[0],origin=proj(ll),east=unproj({x:origin.x+widthM/Math.cos(ll.lat*Math.PI/180),y:origin.y}),widthPx=screen(ll).distanceTo(screen(east));
  ctx.strokeStyle=family.color||editing.doc.markup.color;ctx.lineWidth=Math.max(.01,widthPx);ctx.globalAlpha=family.opacity/100;ctx.lineCap="round";ctx.lineJoin="round";
  ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
  if(draft.kind==="shape"){ctx.closePath();const fill=fillProps();if(fill.fillColor!==null){ctx.save();ctx.globalAlpha=fill.fill;ctx.fillStyle=fill.fillColor;ctx.fill();ctx.restore()}}
  if(widthM>0)ctx.stroke();
  if((draft.kind==="arrow"||draft.kind==="arrow2")&&draft.points.length>1){
    const ps=draft.points,heads=[arrowHead(ps[ps.length-2],ps[ps.length-1],widthM)];if(draft.kind==="arrow2")heads.push(arrowHead(ps[1],ps[0],widthM));
    ctx.fillStyle=ctx.strokeStyle;for(const head of heads){if(!head)continue;ctx.beginPath();head.tri.map(screen).forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill()}
  }
}
const overlay=document.createElement("div");overlay.id="mkOverlay";mapEl.append(overlay);
L.DomEvent.disableClickPropagation(overlay);
const eraserRing=document.createElement("div");eraserRing.className="mk-eraser-ring";eraserRing.hidden=true;mapEl.append(eraserRing);
const bar=document.createElement("div");bar.id="mkBar";bar.className="tool-popover csp-markup-popover";bar.hidden=true;
bar.setAttribute("role","dialog");bar.setAttribute("aria-modal","false");bar.setAttribute("aria-labelledby","mkBarTitle");
document.getElementById("app").append(bar);
L.DomEvent.disableClickPropagation(bar);L.DomEvent.disableScrollPropagation(bar);
const pop=document.createElement("div");pop.id="mkPop";pop.className="tool-popover";pop.hidden=true;pop.setAttribute("role","dialog");
document.getElementById("app").append(pop);
L.DomEvent.disableClickPropagation(pop);L.DomEvent.disableScrollPropagation(pop);

const TOOLS=[
  ["select","mouse-pointer-2","Select, move and resize (V)"],
  ["pan","hand","Pan the map (H)"],
  null,
  ["pen","pencil","Pen (P)"],
  ["highlight","highlighter","Highlighter (I)"],
  ["eraser","eraser","Eraser (E)"],
  ["shape","shapes","Shapes (S)"],
  ["text","type","Text (T)"],
  ["pin","map-pin","Pin"]
];
let draft=null;          // a mark being drawn
let gesture=null;        // a selection being moved, resized or rotated
let pointsMode=false;    // editing the points of a selected shape
let toolsOpen=false;     // dismissing the popover must not turn off the pen
let layerDetailsDraft=null,groundEdit=null;
let lastLayerId=store.get(LAST_KEY,null);
const notifyEditing=()=>document.dispatchEvent(new CustomEvent("csp:markup-editing",{detail:{editing:!!editing,expanded:!!editing&&toolsOpen,layer:editing?.doc.markup.id||null}}));
function setToolsOpen(open,restoreFocus=false){
  if(!open){finishLayerDetails(true,false);finishGroundEdit()}
  toolsOpen=!!editing&&open;
  if(toolsOpen) B.announceToolPopover?.(bar);else closePop();
  paintBar();notifyEditing();
  if(restoreFocus) document.getElementById("quickDraw")?.focus({preventScroll:true});
}
function startEditing(layer){
  if(editing&&editing!==layer) stopEditing();
  B.ensureMap?.();
  const newLayer=lastLayerId!==layer.doc.markup.id;
  editing=layer;layer.visible=true;applyView(layer);writeView();
  lastLayerId=layer.doc.markup.id;store.set(LAST_KEY,lastLayerId);
  /* The layer's colour is the default ink for that layer. */
  if(newLayer||!styles.ink.color) styles.ink.color=layer.doc.markup.color;
  tool=tool==="pan"||tool==="select"?"pen":tool;
  /* Lower the phone sheet once the tap that chose Draw has finished; doing it
     inside that tap let the same click land on the lowered sheet and raise it. */
  if(innerWidth<=760) setTimeout(()=>{ if(editing&&!document.body.classList.contains("collapsed")) $("#sideToggle")?.click() },60);
  document.body.classList.add("csp-markup-editing");
  toolsOpen=true;
  B.announceToolPopover?.(bar);
  setTool(tool);changed();notifyEditing();
}
function stopEditing(restoreFocus=false){
  finishLayerDetails(true,false);finishGroundEdit();
  cancelDraft();deselect();closePop();editing=null;tool="pan";toolsOpen=false;
  capture.hidden=true;bar.hidden=true;eraserRing.hidden=true;document.body.classList.remove("csp-markup-editing");
  map.dragging.enable();view3d()?.dragPan.enable();mapEl.classList.remove("mk-hover");changed();notifyEditing();
  if(restoreFocus) document.getElementById("quickDraw")?.focus({preventScroll:true});
}
document.addEventListener("csp:tool-popover-open",event=>{if(editing&&event.detail.id!==bar.id)stopEditing()});
/* A tap on the drawing surface dismisses the controls, not the pen. The
   dock remains available to reopen them without obstructing the next stroke. */
mapEl.addEventListener("pointerdown",event=>{
  if(toolsOpen&&!event.target.closest(".tool-popover,#mapDock,#sideToggleDock,.leaflet-control,#ctl"))setToolsOpen(false);
},{capture:true,passive:true});
function setTool(next){
  finishLayerDetails(true,false);finishGroundEdit();
  const switched=next!==tool;
  cancelDraft();closePop();
  if(next!=="select") deselect();
  tool=next;mapEl.classList.remove("mk-hover");
  const isLine=["pen","highlight"].includes(tool)||(tool==="shape"&&shapeById(styles.shape).line);
  const ink=tool==="highlight"?styles.highlight:styles.ink;
  if(isLine&&(ink.groundWidth??ink.width*here())<=0){ink.groundWidth=.03048;ink.width=ink.groundWidth/here();saveStyles()}
  const drawing=!["pan","select"].includes(tool);
  capture.hidden=!drawing;capture.dataset.tool=tool;
  eraserRing.hidden=tool!=="eraser";
  paintBar();
  if(switched&&!matchMedia("(prefers-reduced-motion: reduce)").matches)
    bar.querySelector(`[data-tool="${next}"]`)?.animate([{scale:.94},{scale:1.015,offset:.65},{scale:1}],{duration:200,easing:"cubic-bezier(.2,.8,.2,1)"});
}
/* Layer details are edited in place, with no permanent form chrome. A draft
   stays attached to its original layer even when the active layer changes. */
function layerContextHtml(){
  const m=editing.doc.markup,draft=layerDetailsDraft?.layer===editing?layerDetailsDraft:null;
  const picker=`<label class="mk-layer-picker" title="Switch markup layer"><img src="${icon("layers")}" alt=""><img class="mk-caret" src="${icon("chevron-down")}" alt=""><select aria-label="Active markup layer" data-layer-select>${[...layers.values()].sort((a,b)=>b.rank-a.rank).map(layer=>`<option value="${esc(layer.doc.markup.id)}" ${layer===editing?"selected":""}>${esc(layer.doc.markup.name)}</option>`).join("")}</select></label>`;
  return `<div class="mk-context-row"><span class="mk-dot" style="--c:${m.color}"></span><div class="mk-context-title">${draft
    ?`<input class="mk-meta-input mk-layer-name" data-layer-detail="name" maxlength="120" aria-label="Markup layer name" value="${esc(draft.name)}">`
    :`<button type="button" class="mk-context-text mk-layer-name" data-edit-detail="name" title="Edit layer name">${esc(m.name)}</button>`}</div><div class="mk-context-actions">${draft
    ?`<button type="button" class="mk-detail-button" data-act="save-layer-details" aria-label="Save layer details" title="Save layer details"><img src="${icon("check")}" alt=""></button><button type="button" class="mk-detail-button" data-act="cancel-layer-details" aria-label="Cancel layer edits" title="Cancel layer edits">&times;</button>`
    :`<button type="button" class="mk-detail-button" data-act="edit-layer-details" aria-label="Edit layer details" title="Edit name and description"><img src="${icon("pen-line")}" alt=""></button>`}${picker}</div></div>${draft
    ?`<textarea class="mk-meta-input mk-layer-description" data-layer-detail="description" rows="2" maxlength="1000" aria-label="Markup layer description" placeholder="Add a description">${esc(draft.description)}</textarea>`
    :`<button type="button" class="mk-context-text mk-layer-description${m.description?"":" mk-placeholder"}" data-edit-detail="description" title="Edit layer description">${esc(m.description||"Add a description")}</button>`}`;
}
function paintLayerContext(){
  const context=bar.querySelector(".mk-context");if(context&&editing){context.innerHTML=layerContextHtml();placeBar()}
}
function beginLayerDetails(field="name"){
  if(!editing)return;
  if(!layerDetailsDraft)layerDetailsDraft={layer:editing,name:editing.doc.markup.name,description:editing.doc.markup.description||""};
  paintLayerContext();
  const input=bar.querySelector(`[data-layer-detail="${field}"]`);input?.focus();input?.select();
}
function finishLayerDetails(commit,repaint=true){
  if(!layerDetailsDraft)return;
  const {layer,name,description}=layerDetailsDraft;layerDetailsDraft=null;
  if(commit){
    const m=layer.doc.markup,nextName=name.trim().slice(0,120)||m.name,nextDescription=description.trim().slice(0,1000);
    if(m.name!==nextName||(m.description||"")!==nextDescription){m.name=nextName;m.description=nextDescription;touch(layer)}
  }
  if(repaint)paintLayerContext();
}
/* A logarithmic slider covers sub-foot marks and large landscape annotations;
   the feet field remains exact and can extend the slider beyond its range. */
function widthRangePosition(value,min,max){
  return Math.round(1000*Math.log((Math.max(min,Math.min(max,value))+.1)/(min+.1))/Math.log((max+.1)/(min+.1)));
}
function widthRangeFeet(position,min,max){
  return +(Math.exp(Math.max(0,Math.min(1000,position))/1000*Math.log((max+.1)/(min+.1)))*(min+.1)-.1).toFixed(4);
}
function syncWidthRange(value,fromRange=false){
  const range=bar.querySelector("[data-ground-range]"),number=bar.querySelector('[data-ground="width"]');if(!range||!number)return;
  const min=Number(number.min),max=Math.max(10000,Number(range.dataset.feetMax)||0,value);
  range.dataset.feetMax=max;
  if(fromRange)number.value=value;else range.value=widthRangePosition(value,min,max);
  range.setAttribute("aria-valuetext",`${value.toLocaleString()} feet`);
}
function finishGroundEdit(){if(groundEdit){touch(groundEdit.layer);groundEdit=null;drawFrame()}}
function applyGroundValue(key,value,final){
  if(!editing||!Number.isFinite(value))return;
  const m=value*.3048,f=selectedFeature();
  if(f){
    if(groundEdit?.feature!==f){finishGroundEdit();pushUndo(editing);groundEdit={layer:editing,feature:f}}
    f.properties[key]=m;renderFeature(editing,f);drawFrame();if(final)finishGroundEdit();
  }else{
    if(key==="size"){if(tool==="pin")styles.text.pinGroundSize=m;else styles.text.groundSize=m;styles.text.size=m/here()}
    else{const ink=currentStyle().family==="highlight"?styles.highlight:styles.ink;ink.groundWidth=m;ink.width=m/here()}
    saveStyles();
  }
}
/* A colour chip, a slider and the like, as small HTML pieces. */
const chip=(act,color,label,none=false)=>`<div class="mk-color-option"><span>${label}</span><button type="button" class="mk-chip${none?" mk-none":""}" data-pop="${act}" style="--c:${color||"transparent"}" aria-label="${label}" title="${label}"><span></span></button></div>`;
const slider=(key,label,value,min,max,step,unit)=>`<label class="mk-slider" title="${label}"><span>${label}</span><input type="range" data-style="${key}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><output>${value}${unit}</output></label>`;
const sep=`<span class="mk-sep" aria-hidden="true"></span>`;
function selectedFeature(){ return selected&&selected.layer===editing?editing.items.get(selected.fid)?.feature||null:null }
function familyOf(kind){ return kind==="highlight"?"highlight":kind==="text"||kind==="pin"?"text":AREAS.has(kind)?"shape":kind==="eraser"?"eraser":LINES.has(kind)?"line":null }
/* The options row reads from the selected mark when there is one, otherwise
   from the style the current tool will draw with. */
function currentStyle(){
  const f=selectedFeature();
  if(f){
    const p=f.properties,color=p.color||editing.doc.markup.color;
    return {family:familyOf(p.kind),color,width:Math.round(clamp(strokePx(f),0,80)),opacity:Math.round((p.opacity??(p.kind==="highlight"?.4:1))*100),
      fillColor:p.fillColor===undefined?"auto":p.fillColor,fillOpacity:Math.round((p.fill??0.18)*100),size:Math.round(clamp(p.fontSize||(p.size||20)/mpp(featureLat(f),viewZoom()),6,160))};
  }
  const family=tool==="shape"?(shapeById(styles.shape).line?"line":"shape"):familyOf(tool);
  const ink=family==="highlight"?styles.highlight:styles.ink;
  return {family,color:ink.color,width:ink.width,opacity:ink.opacity,fillColor:styles.fill.color,fillOpacity:styles.fill.opacity,size:styles.text.size,eraser:styles.eraser.size};
}
function paintBar(){
  if(!editing||!toolsOpen){ bar.hidden=true;return }
  // Background source/view refreshes must not replace the field being typed in.
  if(layerDetailsDraft?.layer===editing&&bar.contains(document.activeElement)&&document.activeElement.matches("[data-layer-detail]"))return;
  bar.hidden=false;
  const f=selectedFeature(),s=currentStyle(),m=editing.doc.markup;
  const shape=shapeById(styles.shape);
  const ground=(key,label,px)=>{
    const metres=f?(f.properties[key]||0):(key==="size"?(tool==="pin"?styles.text.pinGroundSize??(styles.text.groundSize!=null?styles.text.groundSize*1.4:undefined):styles.text.groundSize):(s.family==="highlight"?styles.highlight:styles.ink).groundWidth)??px*here(),value=+feet(metres).toFixed(4),min=s.family==="shape"?0:.1,max=Math.max(10000,value);
    const number=`<label class="mk-ground"><span>${label}</span><input type="number" data-ground="${key}" min="${min}" step="any" value="${value}" aria-label="${label} in feet"><span>ft</span></label>`;
    return key!=="width"?number:`<div class="mk-width-control">${number}<input class="mk-width-range" type="range" data-ground-range="width" min="0" max="1000" step="1" value="${widthRangePosition(value,min,max)}" data-feet-max="${max}" aria-label="${label}" aria-valuetext="${value} feet"></div>`;
  };
  const tools=TOOLS.map(t=>t?`<button type="button" class="mk-tool" data-tool="${t[0]}" aria-pressed="${tool===t[0]}" title="${t[2]}" aria-label="${t[2].replace(/ \(.\)$/,"")}">${
    t[0]==="shape"?`<span class="mk-shape-icons"><span class="mk-shape-glyph">${shapePreview(shape)}</span><img class="mk-caret" src="${icon("chevron-down")}" alt=""></span>`:`<img src="${icon(t[1])}" alt="">`}<span class="mk-tool-label">${{select:"Select",pan:"Pan",pen:"Pen",highlight:"Highlight",eraser:"Eraser",shape:"Shapes",text:"Text",pin:"Pin"}[t[0]]}</span></button>`:sep).join("");
  const undoCount=stackFor(undoStacks,editing).length,redoCount=stackFor(redoStacks,editing).length;
  let opts="";
  const fam=s.family;
  if(fam==="eraser") opts=slider("eraser","Size",s.eraser,8,120,1,"px")+`<span class="mk-hint">Drag across marks to erase them</span>`;
  else if(fam==="line"||fam==="highlight") opts=chip("color",s.color,"Colour")+ground("width","Width",s.width)+slider("opacity","Opacity",s.opacity,5,100,1,"%");
  else if(fam==="shape") opts=chip("color",s.color,s.width?"Outline colour":"Outline colour (no outline)")+ground("width","Outline",s.width)+slider("opacity","Opacity",s.opacity,5,100,1,"%")+sep+
    chip("fill",s.fillColor==="auto"?s.color:s.fillColor,s.fillColor===null?"Fill: none":"Fill colour",s.fillColor===null)+(s.fillColor===null?"":slider("fillOpacity","Fill",s.fillOpacity,0,100,1,"%"));
  else if(fam==="text") opts=chip("color",s.color,"Colour")+((f?.properties.kind||tool)==="pin"?ground("size","Size",s.size):slider("size","Font size",s.size,8,160,1,"px"))+slider("opacity","Opacity",s.opacity,5,100,1,"%");
  else opts=`<span class="mk-hint">${tool==="select"?"Click a mark to select it · drag to move · handles resize and rotate":"Drag to move around the map"}</span>`;
  if(view3d()&&fam&&fam!=="eraser"){
    const snapped=f?!f.properties.space3d:placementSnaps();
    opts+=sep+`<label class="mk-snap"><input type="checkbox" data-placement="snap" ${snapped?"checked":""}>Snap to surface</label>`;
    if(!snapped){
      const elevation=f?.properties.space3d?.anchor[2];
      opts+=`<label class="mk-ground"><span>${f?"Elevation":"Distance"}</span><input type="number" data-placement="${f?"elevation":"distance"}" value="${+(f?feet(elevation):styles.placement.distance).toFixed(2)}" ${f?"":"min=1"} step="any" aria-label="${f?"Elevation above sea level":"Placement distance"} in feet"><span>ft</span></label>`;
    }
  }
  let actions="";
  if(f){
    const p=f.properties;
    if(p.kind==="text"||p.kind==="pin") actions+=`<button type="button" class="mk-text-btn" data-act="edit-text">Edit text</button>`;
    if(p.kind==="area"||p.kind==="shape"||p.kind==="rect") actions+=`<button type="button" class="mk-text-btn" data-act="points" aria-pressed="${pointsMode}">Edit points</button>`;
    actions+=`<button type="button" class="mk-icon-btn" data-act="duplicate" title="Duplicate (Ctrl+D)" aria-label="Duplicate"><img src="${icon("copy")}" alt=""></button>
      <button type="button" class="mk-icon-btn mk-danger" data-act="delete" title="Delete (Delete key)" aria-label="Delete selected"><img src="${icon("trash-2")}" alt=""></button>`;
  }
  const pending=draft&&draft.kind==="area";
  bar.innerHTML=`
    <div class="tool-popover-head"><div class="tool-popover-title" id="mkBarTitle">Markup</div><button type="button" class="tool-close" data-act="close" aria-label="Close markup tools">&times;</button></div>
    <div class="mk-context">${layerContextHtml()}</div>
    <div class="mk-tools" role="toolbar" aria-label="Markup tools">${tools}</div>
    <div class="mk-opts">${opts}${actions?`<div class="mk-selection-actions">${actions}</div>`:""}</div>
    <div class="mk-footer"><div class="mk-history">
      <button type="button" class="mk-icon-btn" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo" ${undoCount?"":"disabled"}><img src="${icon("undo-2")}" alt=""></button>
      <button type="button" class="mk-icon-btn" data-act="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" ${redoCount?"":"disabled"}><img src="${icon("redo-2")}" alt=""></button>
    </div>
    <div class="mk-finish"><button type="button" class="mk-done" data-act="${pending?"finish":"done"}">${pending?"Finish shape":"Done"}</button></div></div>`;
  placeBar();
}
/* Use the same dock anchor and safe-area positioning as Layers and the
   terrain engine, rather than a separate screen-spanning toolbar. */
function placeBar(){
  if(bar.hidden) return;
  B.positionToolPopover?.(bar,document.getElementById("quickDraw"));
}
function syncHistoryButtons(){
  if(!editing)return;
  for(const [act,stacks] of [["undo",undoStacks],["redo",redoStacks]]){
    const button=bar.querySelector(`[data-act="${act}"]`);if(button)button.disabled=!stackFor(stacks,editing).length;
  }
}
new ResizeObserver(placeBar).observe(document.getElementById("mapDock"));
new MutationObserver(placeBar).observe(document.getElementById("mapDock"),{childList:true});
addEventListener("resize",()=>{ placeBar();closePop() });
let last3dMode=!!view3d();
new MutationObserver(()=>{const mode=!!view3d();if(mode!==last3dMode){last3dMode=mode;cancelDraft();deselect();if(editing)paintBar()}requestAnimationFrame(placeBar)}).observe(document.body,{attributes:true,attributeFilter:["class"]});

/* Restyling: from the toolbar to the style the tool draws with and, when a
   mark is selected, to that mark. A slider drag is one undo step. */
let styleEdit=false;
function applyStyle(key,value,final){
  const f=selectedFeature(),s=currentStyle(),fam=s.family;
  const ink=fam==="highlight"?styles.highlight:styles.ink;
  if(key==="color") ink.color=value;
  else if(key==="width") ink.width=value;
  else if(key==="opacity") ink.opacity=value;
  else if(key==="fill") styles.fill.color=value;
  else if(key==="fillOpacity") styles.fill.opacity=value;
  else if(key==="size"){styles.text.size=value;delete styles.text.groundSize;}
  else if(key==="eraser"){ styles.eraser.size=value;sizeEraser() }
  saveStyles();
  if(f){
    if(!styleEdit){ pushUndo(editing);styleEdit=true }
    const p=f.properties,lat=featureLat(f),m=mpp(lat,viewZoom());
    if(key==="color") p.color=value;
    else if(key==="width") p.width=+(value*m).toFixed(3);
    else if(key==="opacity") p.opacity=value/100;
    else if(key==="fill"){ p.fillColor=value==="auto"?(p.color||editing.doc.markup.color):value }
    else if(key==="fillOpacity") p.fill=value/100;
    else if(key==="size"){p.size=+(value*(p.size/(p.fontSize||((p.size||20)/m)))).toFixed(6);p.fontSize=value;}
    renderFeature(editing,f);
    if(final){ styleEdit=false;touch(editing);drawFrame() }
  }
}
/* Surface/space is a property of each mark, and a remembered default for
   the current tool. Conversion preserves its current screen footprint. */
function changePlacement(snap){
  const f=selectedFeature(),text=(f?.properties.kind||tool)==="text";
  const field=text?"textSnap":"snap";
  if(!f){styles.placement[field]=snap;saveStyles();cancelDraft();paintBar();return;}
  const old=f.properties.space3d;if(snap===!old)return;
  const center=projectedPoints(f).reduce((a,q)=>({x:a.x+q.x,y:a.y+q.y}),{x:0,y:0}),count=projectedPoints(f).length;
  center.x/=count;center.y/=count;
  const px=featurePx(f,unproj(center)),space=snap?null:window.CSPMarkup3D?.createPlacement(view3d(),px,Math.max(1,styles.placement.distance)*.3048);
  if(!snap&&!space)return;
  let invalid=false;
  const converted=JSON.parse(JSON.stringify(f));
  mapCoords(converted,c=>{const screen=featurePx(f,toLL(c));if(!onGround(screen,space)){invalid=true;return c;}const ll=pxLL(screen,space);if(!ll){invalid=true;return c;}return toC(ll);});
  if(invalid){paintBar();return;}
  /* Transform a one-metre baseline through the current view. Placement-time
     pixel scale would resize a sign after navigation, and screenRot would
     erase the user's rotation. Preserve both with this actual baseline. */
  const p=converted.properties,rot=f.properties.rot||0,latitude=old?.anchor[1]??featureLat(f),stretch=1/Math.cos(latitude*Math.PI/180);
  const end=featurePx(f,unproj({x:center.x+Math.cos(rot)*stretch,y:center.y+Math.sin(rot)*stretch}));
  const startLL=pxLL(px,space),endLL=pxLL(end,space);
  if(!startLL||!endLL||!onGround(end,space)){paintBar();return;}
  const a=proj(startLL),b=proj(endLL),dx=b.x-a.x,dy=b.y-a.y;
  const ratio=Math.hypot(dx,dy)*Math.cos((space?.anchor[1]??startLL.lat)*Math.PI/180);
  if(!Number.isFinite(ratio)||ratio<=0){paintBar();return;}
  if(p.kind==="text"||p.kind==="pin")p.size*=ratio;
  p.rot=Math.atan2(dy,dx);
  if(p.width!=null)p.width*=ratio;
  if(space)p.space3d=space;else delete p.space3d;
  pushUndo(editing);f.geometry=converted.geometry;f.properties=p;
  styles.placement[field]=snap;saveStyles();renderFeature(editing,f);touch(editing);drawFrame();paintBar();
}
bar.addEventListener("change",event=>{
  const input=event.target.closest("[data-placement]");if(!input||!editing||!view3d())return;
  const key=input.dataset.placement;
  if(key==="snap"){changePlacement(input.checked);return;}
  const value=Number(input.value);if(!Number.isFinite(value)||(key==="distance"&&value<1)){paintBar();return;}
  if(key==="distance"){styles.placement.distance=value;saveStyles();return;}
  const f=selectedFeature();if(key==="elevation"&&f?.properties.space3d){pushUndo(editing);f.properties.space3d.anchor[2]=value*.3048;renderFeature(editing,f);touch(editing);drawFrame();}
});
bar.addEventListener("change",event=>{
  const input=event.target.closest("[data-ground]");if(!input||!editing)return;
  const value=Number(input.value);if(!Number.isFinite(value)||value<Number(input.min)){paintBar();return;}
  applyGroundValue(input.dataset.ground,value,true);if(input.dataset.ground==="width")syncWidthRange(value);
});
bar.addEventListener("input",event=>{
  const input=event.target;
  if(input.dataset.layerDetail&&layerDetailsDraft)layerDetailsDraft[input.dataset.layerDetail]=input.value;
  if(input.matches('[data-ground="width"]')&&input.value!==""&&Number.isFinite(input.valueAsNumber))syncWidthRange(input.valueAsNumber);
  if(input.matches("[data-ground-range]")){
    const number=bar.querySelector('[data-ground="width"]'),value=widthRangeFeet(+input.value,+number.min,+input.dataset.feetMax);
    syncWidthRange(value,true);applyGroundValue("width",value,false);
  }
});
bar.addEventListener("change",event=>{
  const input=event.target;
  if(input.matches("[data-ground-range]"))applyGroundValue("width",Number(bar.querySelector('[data-ground="width"]').value),true);
  if(input.matches("[data-layer-select]")){
    const layer=layers.get(input.value);if(layer&&layer!==editing){finishLayerDetails(true,false);startEditing(layer)}
  }
});
bar.addEventListener("keydown",event=>{
  if(!event.target.matches("[data-layer-detail]"))return;
  if(event.key==="Escape"){event.preventDefault();event.stopPropagation();finishLayerDetails(false);bar.querySelector('[data-act="edit-layer-details"]')?.focus()}
  else if(event.key==="Enter"&&(event.target.dataset.layerDetail==="name"||event.ctrlKey||event.metaKey)){
    event.preventDefault();finishLayerDetails(true);bar.querySelector('[data-act="edit-layer-details"]')?.focus();
  }
});
bar.addEventListener("input",event=>{
  const input=event.target.closest("input[data-style]");if(!input) return;
  const out=input.parentElement.querySelector("output"),unit=input.dataset.style==="opacity"||input.dataset.style==="fillOpacity"?"%":"px";
  out.textContent=input.value+unit;
  applyStyle(input.dataset.style,+input.value,false);
});
bar.addEventListener("change",event=>{
  const input=event.target.closest("input[data-style]");if(!input) return;
  applyStyle(input.dataset.style,+input.value,true);
  /* Outline 0 and back changes which controls apply. */
  if(input.dataset.style==="width") paintBar();
});
bar.addEventListener("click",event=>{
  const button=event.target.closest("button");if(!button||!editing) return;
  if(button.dataset.editDetail){beginLayerDetails(button.dataset.editDetail);return}
  if(button.dataset.act==="edit-layer-details"){beginLayerDetails();return}
  if(button.dataset.act==="save-layer-details"||button.dataset.act==="cancel-layer-details"){
    finishLayerDetails(button.dataset.act==="save-layer-details");bar.querySelector('[data-act="edit-layer-details"]')?.focus();return;
  }
  if(button.dataset.tool){
    if(button.dataset.tool==="shape"){
      if(tool==="shape"&&!pop.hidden&&pop.dataset.kind==="shape"){ closePop();return }
      if(tool!=="shape") setTool("shape");
      openPop("shape",bar.querySelector('[data-tool="shape"]'));return;
    }
    setTool(button.dataset.tool);return;
  }
  if(button.dataset.pop){ pop.hidden||pop.dataset.kind!==button.dataset.pop?openPop(button.dataset.pop,button):closePop();return }
  const act=button.dataset.act;
  if(act==="undo") undoRedo(false);
  else if(act==="redo") undoRedo(true);
  else if(act==="delete") deleteSelected();
  else if(act==="duplicate") duplicateSelected();
  else if(act==="edit-text") editSelectedText();
  else if(act==="points"){ pointsMode=!pointsMode;drawFrame();paintBar() }
  else if(act==="finish") finishArea();
  else if(act==="close") setToolsOpen(false,true);
  else if(act==="done") stopEditing(true);
});

/* Popovers from the toolbar: the colour grid and the shape gallery. */
function closePop(){ pop.hidden=true;pop.dataset.kind="";bar.querySelectorAll("[data-pop][aria-expanded]").forEach(b=>b.removeAttribute("aria-expanded")) }
function openPop(kind,anchor){
  pop.dataset.kind=kind;
  pop.setAttribute("aria-label",kind==="shape"?"Shapes":kind==="fill"?"Fill colour":"Colour");
  const s=currentStyle();
  if(kind==="shape"){
    const group=(title,items)=>`<div class="mk-pop-label">${title}</div><div class="mk-shape-grid">${items.map(x=>
      `<button type="button" class="mk-shape-btn" data-shape="${x.id}" aria-pressed="${styles.shape===x.id}" title="${x.label}" aria-label="${x.label}">${shapePreview(x)}</button>`).join("")}</div>`;
    pop.innerHTML=group("Lines",SHAPES.filter(x=>x.line))+group("Shapes",SHAPES.filter(x=>!x.line));
  }else{
    const current=kind==="fill"?s.fillColor:s.color;
    pop.innerHTML=`<div class="mk-pop-label">${kind==="fill"?"Fill":s.family==="shape"?"Outline":"Colour"}</div>
      ${kind==="fill"?`<div class="mk-pop-row"><button type="button" class="mk-text-btn" data-pick="none" aria-pressed="${current===null}">No fill</button><button type="button" class="mk-text-btn" data-pick="auto" aria-pressed="${current==="auto"}">Same as outline</button></div>`:""}
      <div class="mk-color-grid">${COLOR_GRID.map(c=>`<button type="button" class="mk-swatch" data-pick="${c}" style="--c:${c}" aria-pressed="${c===current}" aria-label="Colour ${c}"></button>`).join("")}</div>
      <label class="mk-custom"><span>Custom colour</span><input type="color" value="${/^#[0-9a-f]{6}$/i.test(current||"")?current:"#ff3b30"}"></label>`;
    fadeGrid($(".mk-color-grid",pop));
  }
  pop.hidden=false;anchor.setAttribute("aria-expanded","true");
  const a=anchor.getBoundingClientRect(),app=document.getElementById("app").getBoundingClientRect();
  const w=pop.offsetWidth,h=pop.offsetHeight;
  let left=clamp(a.left-app.left+a.width/2-w/2,8,app.width-w-8),top=a.bottom-app.top+8;
  if(top+h>app.height-8) top=Math.max(8,a.top-app.top-h-8);
  pop.style.left=left+"px";pop.style.top=top+"px";
}
pop.addEventListener("click",event=>{
  const b=event.target.closest("button");if(!b) return;
  if(b.dataset.shape){
    styles.shape=b.dataset.shape;saveStyles();closePop();
    if(tool!=="shape") setTool("shape");else{ cancelDraft();paintBar() }
    return;
  }
  if(b.dataset.pick){
    const v=b.dataset.pick==="none"?null:b.dataset.pick;
    applyStyle(pop.dataset.kind==="fill"?"fill":"color",v,true);closePop();paintBar();
  }
});
pop.addEventListener("change",event=>{
  if(event.target.type!=="color") return;
  applyStyle(pop.dataset.kind==="fill"?"fill":"color",event.target.value,true);closePop();paintBar();
});
document.addEventListener("pointerdown",event=>{ if(!pop.hidden&&!pop.contains(event.target)&&!event.target.closest("[data-pop],[data-tool='shape']")) closePop() },true);
function fadeGrid(grid){
  if(!grid) return;
  const edges=()=>{ grid.classList.toggle("mk-at-top",grid.scrollTop<2);grid.classList.toggle("mk-at-end",grid.scrollTop+grid.clientHeight>=grid.scrollHeight-2) };
  grid.addEventListener("scroll",edges,{passive:true});requestAnimationFrame(edges);
}

const KEYS={v:"select",h:"pan",p:"pen",i:"highlight",e:"eraser",s:"shape",t:"text"};
document.addEventListener("keydown",event=>{
  if(!editing) return;
  if(event.key==="Escape"&&bar.contains(event.target)){
    event.preventDefault();if(!pop.hidden)closePop();else setToolsOpen(false,true);return;
  }
  if(/^(input|textarea|select)$/i.test(event.target.tagName)||event.target.isContentEditable) return;
  const mod=event.metaKey||event.ctrlKey,k=event.key.toLowerCase();
  if(event.key==="Escape"){ if(!pop.hidden) closePop();else if(draft) cancelDraft();else if(pointsMode){ pointsMode=false;drawFrame() }else if(selected) deselect();else if(toolsOpen)setToolsOpen(false,true);else stopEditing(true);paintBar() }
  else if(mod&&k==="z"){ event.preventDefault();undoRedo(event.shiftKey) }
  else if(mod&&k==="y"){ event.preventDefault();undoRedo(true) }
  else if(mod&&k==="d"&&selected){ event.preventDefault();duplicateSelected() }
  else if((event.key==="Delete"||event.key==="Backspace")&&selected){ event.preventDefault();deleteSelected() }
  else if(event.key==="Enter"&&draft?.kind==="area") finishArea();
  else if(!mod&&!event.altKey&&KEYS[k]){ setTool(KEYS[k]) }
});

/* --------------------------------------------------------------- drawing */
const onGround=(px,space=null)=>{if(space)return !!window.CSPMarkup3D?.screenToGround(view3d(),px,space);const v=view3d();if(!v)return true;const ll=v.unproject([px.x,px.y]),q=v.project(ll);return Number.isFinite(ll.lat)&&Number.isFinite(ll.lng)&&Math.hypot(q.x-px.x,q.y-px.y)<12};
const pointPx=event=>{ const r=mapEl.getBoundingClientRect();return L.point(event.clientX-r.left,event.clientY-r.top) };
const pxLL=(px,space=null)=>{if(space){const ll=window.CSPMarkup3D.screenToGround(view3d(),px,space);return ll?L.latLng(ll.lat,ll.lng):null;}const v=view3d();if(!v)return map.containerPointToLatLng(px);const ll=v.unproject([px.x,px.y]);return L.latLng(ll.lat,ll.lng)};
const llPx=(ll,space=null)=>{if(space&&view3d()){const q=window.CSPMarkup3D.project(view3d(),[ll.lng,ll.lat],space);return L.point(q?.x??NaN,q?.y??NaN);}const v=view3d();return v?L.point(v.project([ll.lng,ll.lat])):map.latLngToContainerPoint(ll)};
const featurePx=(f,ll)=>llPx(ll,f.properties.space3d);
const featureLL=(f,px)=>pxLL(px,f.properties.space3d);
const placementSnaps=()=>((selectedFeature()?.properties.kind||tool)==="text"?styles.placement.textSnap:styles.placement.snap);
const placementUnit=space=>space?.metresPerPixel||here();
function drawingSpace(px){
  if(!view3d()||placementSnaps())return null;
  return window.CSPMarkup3D?.createPlacement(view3d(),px,Math.max(1,styles.placement.distance)*.3048)||null;
}
function addFeature(kind,geometry,extra={}){
  if(!editing) return;
  pushUndo(editing);
  const feature={type:"Feature",geometry,properties:{fid:rid(),kind,...extra}};
  editing.doc.features.push(feature);renderFeature(editing,feature);touch(editing);paintBar();
  return feature;
}
function inkProps(family,space=null){
  const ink=family==="highlight"?styles.highlight:styles.ink,m=placementUnit(space);
  return {color:ink.color||editing.doc.markup.color,width:ink.groundWidth??+(ink.width*m).toFixed(3),opacity:ink.opacity/100};
}
function fillProps(){
  const ink=styles.ink.color||editing.doc.markup.color,f=styles.fill;
  return f.color===null?{fillColor:null}:{fillColor:f.color==="auto"?ink:f.color,fill:f.opacity/100};
}
function previewStyle(family){
  const ink=family==="highlight"?styles.highlight:styles.ink,color=ink.color||editing.doc.markup.color;
  const fill=fillProps();
  return {renderer:editing.renderer,pane:editing.paneName,color,weight:Math.max(ink.groundWidth!=null?ink.groundWidth/here():ink.width,family==="shape"?0.0001:1),opacity:ink.opacity/100,lineCap:"round",lineJoin:"round",
    interactive:false,stroke:family!=="shape"||ink.width>0,fill:family==="shape"&&fill.fillColor!==null,fillColor:fill.fillColor||color,fillOpacity:fill.fill??0,
    className:family==="highlight"?"csp-mk-hl":""};
}
function cancelDraft(){ if(draft?.preview) draft.preview.forEach(p=>p.remove());draft=null;redrawDraft() }
/* The direction of "screen right" on the ground, so a shape drawn on a
   rotated map is recorded at the angle it was drawn. */
function screenRot(c=L.point(mapEl.clientWidth/2,mapEl.clientHeight/2),space=null){
  const a=proj(pxLL(c,space)),b=proj(pxLL(c.add([10,0]),space));
  return Math.atan2(b.y-a.y,b.x-a.x);
}
function boxShape(shape,a,c,square,space=null){
  let w=c.x-a.x,h=c.y-a.y;
  if(square){ const s=Math.max(Math.abs(w),Math.abs(h));w=Math.sign(w||1)*s;h=Math.sign(h||1)*s }
  const x0=Math.min(a.x,a.x+w),y0=Math.min(a.y,a.y+h),aw=Math.abs(w),ah=Math.abs(h);
  return shape.gen(aw,ah).map(([x,y])=>pxLL(L.point(x0+x*aw,y0+y*ah),space));
}
capture.addEventListener("pointerdown",event=>{
  if(!editing||event.button>0) return;
  event.preventDefault();event.stopPropagation();closePop();
  if(tool==="eraser"){startErase(event);return;}
  const px=pointPx(event),space=draft?.space3d||drawingSpace(px);
  if(view3d()&&!placementSnaps()&&!space&&tool!=="eraser")return;
  if(!onGround(px,space))return;
  const ll=pxLL(px,space);
  if(tool==="text"||tool==="pin"){ placeText(tool,ll,px,space);return }
  const shape=tool==="shape"?shapeById(styles.shape):null;
  if(shape?.id==="freeform"){
    if(!draft){ draft={kind:"area",space3d:space,points:[ll],px:[px],preview:[L.polyline([ll],previewStyle("shape")).addTo(map)]};paintBar() }
    else{
      if(draft.px.length>=3&&px.distanceTo(draft.px[0])<14){ finishArea();return }
      draft.points.push(ll);draft.px.push(px);draft.preview[0].setLatLngs(draft.points);redrawDraft();
    }
    return;
  }
  capture.setPointerCapture?.(event.pointerId);
  const kind=tool==="shape"?(shape.line?shape.id:"shape"):tool;
  draft={kind,shape,space3d:space,start:ll,startPx:px,points:[ll],px:[px],pointerId:event.pointerId,preview:[]};
  const family=kind==="highlight"?"highlight":kind==="shape"?"shape":"line";
  const style=previewStyle(family);
  if(kind==="shape") draft.preview.push(L.polygon([ll,ll,ll],style).addTo(map));
  else draft.preview.push(L.polyline([ll],style).addTo(map));
});
capture.addEventListener("pointerdown",()=>requestAnimationFrame(redrawDraft));
capture.addEventListener("pointermove",()=>requestAnimationFrame(redrawDraft));
capture.addEventListener("pointermove",event=>{
  if(tool==="eraser"){ moveEraserRing(event);if(erasing) eraseMove(event);return }
  if(!draft||draft.pointerId!==event.pointerId||!onGround(pointPx(event),draft.space3d)) return;
  const ll=pxLL(pointPx(event),draft.space3d),px=pointPx(event),preview=draft.preview[0];
  if(draft.kind==="pen"||draft.kind==="highlight"){
    if(px.distanceTo(draft.px[draft.px.length-1])<2) return;
    draft.points.push(ll);draft.px.push(px);preview.setLatLngs(draft.points);
  }else if(draft.kind==="shape"){
    draft.px=[draft.startPx,px];draft.square=event.shiftKey;
    draft.points=boxShape(draft.shape,draft.startPx,px,event.shiftKey,draft.space3d);preview.setLatLngs(draft.points);
  }else{
    let end=px;
    if(event.shiftKey){ /* lines snap to 15° steps */
      const d=px.subtract(draft.startPx),a=Math.round(Math.atan2(d.y,d.x)/(Math.PI/12))*(Math.PI/12),r=Math.hypot(d.x,d.y);
      end=draft.startPx.add([r*Math.cos(a),r*Math.sin(a)]);
    }
    draft.points=[draft.start,pxLL(end,draft.space3d)];draft.px=[draft.startPx,end];preview.setLatLngs(draft.points);
  }
});
capture.addEventListener("pointerleave",()=>{ if(tool==="eraser"&&!erasing) eraserRing.hidden=true });
capture.addEventListener("pointerenter",()=>{ if(tool==="eraser") eraserRing.hidden=false });
const endStroke=event=>{
  if(tool==="eraser"){ endErase();return }
  if(!draft||draft.pointerId!==event.pointerId) return;
  const d=draft;cancelDraft();
  const space=d.space3d,placement=space?{space3d:space}:{};
  const span=d.px.length>1?d.px[0].distanceTo(d.px[d.px.length-1]):0;
  if((d.kind==="pen"||d.kind==="highlight")&&d.points.length>1) addFeature(d.kind,{type:"LineString",coordinates:simplify(d.points,d.px).map(toC)},{...inkProps(d.kind==="highlight"?"highlight":"ink",space),...placement});
  else if((d.kind==="pen"||d.kind==="highlight")){ /* a tap is a dot */
    const ll2=pxLL(d.px[0].add([0.5,0.5]),space);addFeature(d.kind,{type:"LineString",coordinates:[toC(d.points[0]),toC(ll2)]},{...inkProps(d.kind==="highlight"?"highlight":"ink",space),...placement});
  }
  else if(["line","arrow","arrow2"].includes(d.kind)&&span>=4) addFeature(d.kind,{type:"LineString",coordinates:d.points.map(toC)},{...inkProps("ink",space),...placement});
  else if(d.kind==="shape"&&d.px.length>1&&Math.abs(d.px[0].x-d.px[1].x)>=4&&Math.abs(d.px[0].y-d.px[1].y)>=4){
    const ring=d.points.map(toC);ring.push(ring[0]);
    addFeature("shape",{type:"Polygon",coordinates:[ring]},{shape:d.shape.id,rot:+screenRot(d.startPx,space).toFixed(5),...inkProps("ink",space),...fillProps(),...placement});
  }
};
capture.addEventListener("pointerup",endStroke);capture.addEventListener("pointercancel",()=>{ if(draft&&draft.kind!=="area") cancelDraft();if(erasing) endErase() });
capture.addEventListener("dblclick",event=>{ event.preventDefault();if(draft?.kind==="area") finishArea() });
function finishArea(){
  if(!draft||draft.kind!=="area") return;
  const d=draft;cancelDraft();
  const space=d.space3d,placement=space?{space3d:space}:{};
  if(d.points.length>=3){ const ring=d.points.map(toC);ring.push(ring[0]);addFeature("area",{type:"Polygon",coordinates:[ring]},{...inkProps("ink",space),...fillProps(),...placement}) }
  paintBar();
}
/* Drop points closer than ~1 screen px to the line through their neighbours
   (Ramer–Douglas–Peucker on the screen trace). */
function simplify(points,px,tol=1){
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
function textEditor(px,initial,color,onDone){
  const box=document.createElement("textarea");box.className="mk-text-input";box.value=initial||"";box.rows=1;
  box.style.fontSize=styles.text.size+"px";box.style.left=px.x+"px";box.style.top=px.y+"px";box.style.color=color;
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
function placeText(kind,ll,px,space=null){
  const color=styles.ink.color||editing.doc.markup.color,unit=placementUnit(space),rot=screenRot(px,space),fontSize=styles.text.size;
  textEditor(px,"",color,value=>{
    if(value===null||!editing) return;
    if(kind==="text"&&!value) return;
    const size=kind==="pin"?styles.text.pinGroundSize??(styles.text.groundSize??fontSize*unit)*1.4:fontSize*unit;
    addFeature(kind,{type:"Point",coordinates:toC(ll)},{text:value,size:+size.toFixed(6),fontSize,rot:+rot.toFixed(6),...(space?{space3d:space}:{}),color,opacity:styles.ink.opacity/100});
  });
}

/* ------------------------------------------------------------------ eraser
   Strokes (pen and highlighter) are cut where the eraser passes, like ink;
   anything else the eraser touches is removed whole. */
let erasing=null;
function sizeEraser(){ const s=styles.eraser.size;eraserRing.style.width=eraserRing.style.height=s+"px" }
function moveEraserRing(event){ const p=pointPx(event);eraserRing.hidden=false;eraserRing.style.transform=`translate(${p.x-styles.eraser.size/2}px,${p.y-styles.eraser.size/2}px)` }
function startErase(event){
  capture.setPointerCapture?.(event.pointerId);
  pushUndo(editing);erasing={changed:false,last:pointPx(event)};
  eraseAt(erasing.last);
}
function eraseMove(event){
  const p=pointPx(event),last=erasing.last,r=styles.eraser.size/2,steps=Math.max(1,Math.ceil(p.distanceTo(last)/(r*0.5)));
  for(let i=1;i<=steps;i++) eraseAt(last.add(p.subtract(last).multiplyBy(i/steps)));
  erasing.last=p;
}
function endErase(){
  if(!erasing) return;
  const e=erasing;erasing=null;
  if(e.changed){ touch(editing);paintBar() } else dropUndo(editing);
}
/* Parts of segment a→b outside the circle (c, r), as [t0,t1] intervals. */
function outsideCircle(a,b,c,r){
  const dx=b.x-a.x,dy=b.y-a.y,fx=a.x-c.x,fy=a.y-c.y,A=dx*dx+dy*dy,Bq=2*(fx*dx+fy*dy),C=fx*fx+fy*fy-r*r;
  if(A<1e-9) return C<=0?[]:[[0,1]];
  const disc=Bq*Bq-4*A*C;if(disc<=0) return [[0,1]];
  const s=Math.sqrt(disc),t1=(-Bq-s)/(2*A),t2=(-Bq+s)/(2*A);
  if(t2<=0||t1>=1) return [[0,1]];
  const out=[];if(t1>0) out.push([0,t1]);if(t2<1) out.push([t2,1]);return out;
}
function eraseAt(c){
  const layer=editing;if(!layer) return;
  const r=styles.eraser.size/2;let changed=false;const next=[];
  for(const f of layer.doc.features){
    const p=f.properties;
    if(p.space3d&&(!view3d()||window.CSPMarkup3D.isVisible?.(view3d(),p.space3d)===false)){next.push(f);continue;}
    if(p.kind==="pen"||p.kind==="highlight"){
      const pts=f.geometry.coordinates.map(cc=>featurePx(f,toLL(cc))),half=strokePx(f)/2,R=r+half;
      const box=L.bounds(pts);if(c.x<box.min.x-R||c.x>box.max.x+R||c.y<box.min.y-R||c.y>box.max.y+R){ next.push(f);continue }
      const pieces=[];let cur=[];
      for(let i=0;i<pts.length-1;i++){
        const a=pts[i],b=pts[i+1],keep=outsideCircle(a,b,c,R);
        if(keep.length===1&&keep[0][0]===0&&keep[0][1]===1){ if(!cur.length) cur.push(f.geometry.coordinates[i]);cur.push(f.geometry.coordinates[i+1]);continue }
        for(const [t0,t1] of keep){
          const at=t=>toC(featureLL(f,L.point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t)));
          if(t0===0){ if(!cur.length) cur.push(f.geometry.coordinates[i]) } else { if(cur.length>1) pieces.push(cur);cur=[at(t0)] }
          cur.push(t1===1?f.geometry.coordinates[i+1]:at(t1));
          if(t1<1){ pieces.push(cur);cur=[] }
        }
        if(!keep.length){ if(cur.length>1) pieces.push(cur);cur=[] }
      }
      if(cur.length>1) pieces.push(cur);
      const unchanged=pieces.length===1&&pieces[0].length===f.geometry.coordinates.length&&pieces[0].every((q,i)=>q===f.geometry.coordinates[i]);
      if(unchanged){ next.push(f);continue }
      changed=true;
      for(const piece of pieces){
        const len=piece.reduce((s,q,i)=>i?s+featurePx(f,toLL(q)).distanceTo(featurePx(f,toLL(piece[i-1]))):0,0);
        if(len<0.75) continue;
        next.push({type:"Feature",geometry:{type:"LineString",coordinates:piece},properties:{...p,fid:rid()}});
      }
    }else if(hitFeature(f,c,r)){ changed=true }
    else next.push(f);
  }
  if(changed){ layer.doc.features=next;renderLayer(layer);erasing.changed=true }
}

/* ---------------------------------------------------------------- hit tests */
function distToSeg(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
  const t=l?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l,0,1):0;
  return Math.hypot(p.x-(a.x+dx*t),p.y-(a.y+dy*t));
}
function inside(p,poly){
  let c=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i],b=poly[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) c=!c }
  return c;
}
function pointElement(f){ return editing?.items.get(f.properties.fid)?.layers[0]?.getElement?.() }
function hitFeature(f,p,slop=6){
  const k=f.properties.kind,g=f.geometry;
  if(f.properties.space3d&&(!view3d()||window.CSPMarkup3D.isVisible(view3d(),f.properties.space3d)===false))return false;
  if(k==="text"||k==="pin"){
    if(view3d()){const fr=frameOf(f);return !!fr&&inside(p,fr.c)}
    const el=pointElement(f);if(!el) return false;
    const r=el.getBoundingClientRect(),m=mapEl.getBoundingClientRect();
    return p.x>=r.left-m.left-slop&&p.x<=r.right-m.left+slop&&p.y>=r.top-m.top-slop&&p.y<=r.bottom-m.top+slop;
  }
  const half=Math.max(0,strokePx(f))/2+slop;
  if(k==="circle"){ const c=featurePx(f,toLL(g.coordinates)),rr=f.properties.radius/mpp(featureLat(f),viewZoom());const d=p.distanceTo(c);return d<=rr+half&&(f.properties.fillColor!==null||d>=rr-half) }
  const pts=(g.type==="Polygon"?g.coordinates[0]:g.coordinates).map(c=>featurePx(f,toLL(c)));
  for(let i=0;i<pts.length-1;i++) if(distToSeg(p,pts[i],pts[i+1])<=half) return true;
  if(pts.length===1) return p.distanceTo(pts[0])<=half;
  /* A shape is picked up by its inside too, filled or not: an outline-only
     box is still a box you can grab. */
  return g.type==="Polygon"&&inside(p,pts);
}
function hitTest(p){
  if(!editing) return null;
  const fs=editing.doc.features;
  for(let i=fs.length-1;i>=0;i--) if(hitFeature(fs[i],p)&&fs[i].geometry.type!=="Polygon") return fs[i];
  for(let i=fs.length-1;i>=0;i--) if(hitFeature(fs[i],p)) return fs[i];
  return null;
}

/* ---------------------------------------------------------------- selection */
function deselect(){ selected=null;pointsMode=false;drawFrame() }
function select(fid){ selected={layer:editing,fid};pointsMode=false;drawFrame();paintBar() }
function deleteSelected(){
  if(!selected) return;
  pushUndo(editing);
  editing.doc.features=editing.doc.features.filter(f=>f.properties.fid!==selected.fid);editing.renderRevision++;schedule3d();
  const item=editing.items.get(selected.fid);item?.layers.forEach(l=>editing.group.removeLayer(l));editing.items.delete(selected.fid);
  deselect();touch(editing);paintBar();
}
function duplicateSelected(){
  const f=selectedFeature();if(!f) return;
  const copy=JSON.parse(JSON.stringify(f));copy.properties.fid=rid();
  const d=16*MERC/Math.pow(2,viewZoom()+8);   // 16 px down and right, in Mercator metres
  mapCoords(copy,c=>pToC({x:cToP(c).x+d,y:cToP(c).y-d}));
  pushUndo(editing);editing.doc.features.push(copy);renderFeature(editing,copy);touch(editing);select(copy.properties.fid);
}
function editSelectedText(){
  const f=selectedFeature();if(!f) return;
  const px=featurePx(f,toLL(f.geometry.coordinates));
  textEditor(px,f.properties.text,f.properties.color||editing.doc.markup.color,value=>{
    if(value===null||!editing) return;
    if(f.properties.kind==="text"&&!value){ deleteSelected();return }
    pushUndo(editing);f.properties.text=value;renderFeature(editing,f);touch(editing);drawFrame();paintBar();
  });
}
function mapCoords(f,fn){
  const g=f.geometry;
  if(g.type==="Point") g.coordinates=fn(g.coordinates);
  else if(g.type==="LineString") g.coordinates=g.coordinates.map(fn);
  else g.coordinates=[g.coordinates[0].map(fn)];
}
/* An old-style circle becomes an oval the first time it is reshaped. */
function circleToShape(f){
  const p=f.properties;if(p.kind!=="circle") return;
  const c=cToP(f.geometry.coordinates),r=p.radius/Math.cos(featureLat(f)*Math.PI/180);
  const ring=Array.from({length:72},(_,i)=>{ const a=i*Math.PI/36;return pToC({x:c.x+r*Math.cos(a),y:c.y+r*Math.sin(a)}) });ring.push(ring[0]);
  f.geometry={type:"Polygon",coordinates:[ring]};p.kind="shape";p.shape="ellipse";p.rot=0;delete p.radius;
}

/* The frame: the mark's extent in its own orientation (rot, radians,
   counter-clockwise from east on the ground). Handles sit on its corners and
   edges; the rotate handle stands off the top edge. */
const frameAxes=rot=>({u:{x:Math.cos(rot),y:Math.sin(rot)},d:{x:Math.sin(rot),y:-Math.cos(rot)}});
function projectedPoints(f){
  const g=f.geometry;
  if(f.properties.kind==="circle"){ const c=cToP(g.coordinates),r=f.properties.radius/Math.cos(featureLat(f)*Math.PI/180);return [{x:c.x-r,y:c.y-r},{x:c.x+r,y:c.y+r}] }
  return (g.type==="Point"?[g.coordinates]:g.type==="LineString"?g.coordinates:g.coordinates[0].slice(0,-1)).map(cToP);
}
function frameOf(f){
  const p=f.properties,rot=p.rot||0,{u,d}=frameAxes(rot);
  if(p.space3d&&(!view3d()||window.CSPMarkup3D.isVisible(view3d(),p.space3d)===false))return null;
  if(p.kind==="text"||p.kind==="pin"){
    if(view3d()){
      const c=cToP(f.geometry.coordinates),size=(p.size||20)/Math.cos(featureLat(f)*Math.PI/180),lines=String(p.text||"").split("\n");
      const w=Math.max(1,...lines.map(x=>x.length))*.7*size,h=Math.max(1,lines.length)*1.2*size;
      const box=p.kind==="pin"?[-size*.5,-size,w+size*.5,h*.5]:[-w/2,-h/2,w/2,h/2];
      const corners=[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]].map(([x,y])=>featurePx(f,unproj({x:c.x+u.x*x+d.x*y,y:c.y+u.y*x+d.y*y})));
      return {screen:true,c:corners};
    }
    /* Text and pins are measured where they are drawn, on screen. */
    const el=pointElement(f);if(!el) return null;
    const box=el.getBBox?.();const ctm=el.getScreenCTM?.();if(!box||!ctm) return null;
    const m=mapEl.getBoundingClientRect(),pad=3;
    const corner=(x,y)=>{ const q=new DOMPoint(x,y).matrixTransform(ctm);return L.point(q.x-m.left,q.y-m.top) };
    return {screen:true,c:[corner(box.x-pad,box.y-pad),corner(box.x+box.width+pad,box.y-pad),corner(box.x+box.width+pad,box.y+box.height+pad),corner(box.x-pad,box.y+box.height+pad)]};
  }
  const pts=projectedPoints(f),o=pts[0];
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const q of pts){ const x=(q.x-o.x)*u.x+(q.y-o.y)*u.y,y=(q.x-o.x)*d.x+(q.y-o.y)*d.y;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y) }
  const at=(x,y)=>({x:o.x+u.x*x+d.x*y,y:o.y+u.y*x+d.y*y});
  return {o,u,d,rot,x0,x1,y0,y1,at,toLocal:q=>({x:(q.x-o.x)*u.x+(q.y-o.y)*u.y,y:(q.x-o.x)*d.x+(q.y-o.y)*d.y}),
    c:[at(x0,y0),at(x1,y0),at(x1,y1),at(x0,y1)].map(q=>featurePx(f,unproj(q)))};
}
const HANDLES=[["nw",0,0],["n",.5,0],["ne",1,0],["e",1,.5],["se",1,1],["s",.5,1],["sw",0,1],["w",0,.5]];
function drawFrame(){
  overlay.replaceChildren();
  const f=selectedFeature();if(!f||!editing) return;
  const k=f.properties.kind;
  if(f.properties.space3d&&window.CSPMarkup3D.isVisible?.(view3d(),f.properties.space3d)===false)return;
  const dot=(cls,pt,data)=>{ const h=document.createElement("div");h.className=`mk-handle ${cls}`;h.style.transform=`translate(${pt.x}px,${pt.y}px)`;Object.assign(h.dataset,data);overlay.append(h);return h };
  if(k==="line"||k==="arrow"||k==="arrow2"){
    const cs=f.geometry.coordinates,pts=cs.map(c=>featurePx(f,toLL(c)));
    const svg=document.createElementNS(SVGNS,"svg");svg.setAttribute("class","mk-frame");
    const line=document.createElementNS(SVGNS,"polyline");line.setAttribute("points",pts.map(q=>`${q.x},${q.y}`).join(" "));svg.append(line);overlay.append(svg);
    dot("mk-h-end",pts[0],{h:"v0"});dot("mk-h-end",pts[pts.length-1],{h:`v${pts.length-1}`});
    return;
  }
  const fr=frameOf(f);if(!fr||fr.c.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y))) return;
  const c=fr.c,svg=document.createElementNS(SVGNS,"svg");svg.setAttribute("class","mk-frame");
  const poly=document.createElementNS(SVGNS,"polygon");poly.setAttribute("points",c.map(q=>`${q.x},${q.y}`).join(" "));svg.append(poly);
  const top=c[0].add(c[1]).divideBy(2),mid=c[0].add(c[2]).divideBy(2),dir=top.subtract(mid),len=Math.hypot(dir.x,dir.y)||1;
  const knob=top.add(dir.multiplyBy(26/len));
  if(k!=="pin"){ const stem=document.createElementNS(SVGNS,"line");stem.setAttribute("x1",top.x);stem.setAttribute("y1",top.y);stem.setAttribute("x2",knob.x);stem.setAttribute("y2",knob.y);svg.append(stem) }
  overlay.append(svg);
  if(pointsMode&&f.geometry.type==="Polygon"){
    f.geometry.coordinates[0].slice(0,-1).forEach((cc,i)=>dot("mk-h-vertex",featurePx(f,toLL(cc)),{h:`v${i}`}));
    return;
  }
  const lerp=(a,b,t)=>a.add(b.subtract(a).multiplyBy(t));
  for(const [name,x,y] of HANDLES){
    if((k==="text"||k==="pin")&&name.length===1) continue;    // text scales from its corners only
    const pt=lerp(lerp(c[0],c[1],x),lerp(c[3],c[2],x),y);
    dot(`mk-h-${name.length===1?"edge":"corner"}`,pt,{h:name,cursor:name});
  }
  if(k!=="pin") dot("mk-h-rotate",knob,{h:"rotate"});
}
map.on("move zoom viewreset rotate resize",()=>{ if(selected&&!gesture) requestAnimationFrame(drawFrame) });
map.on("zoomend",()=>{ if(selected) drawFrame();if(editing) paintBarValues() });
/* After zooming, the width and size sliders show the selected mark at the
   new scale. */
function paintBarValues(){ if(selectedFeature()&&!bar.contains(document.activeElement)) paintBar() }

/* Pointer gestures in Select: grab a mark to move it, a handle to resize or
   rotate it. They take the pointer before the map can start a pan. */
function beginGesture(event,type,f,extra={}){
  event.preventDefault();event.stopPropagation();
  map.dragging.disable();view3d()?.dragPan.disable();
  pushUndo(editing);
  if(type!=="move"&&type!=="vertex") circleToShape(f);
  gesture={type,f,id:event.pointerId,start:pointPx(event),startP:proj(featureLL(f,pointPx(event))),
    snap:JSON.parse(JSON.stringify(f.geometry)),props:JSON.parse(JSON.stringify(f.properties)),moved:false,...extra};
  gesture.frame=type==="move"||type==="vertex"?null:frameOf(f);
  overlay.classList.add("mk-active");
}
function runGesture(event){
  const G=gesture,f=G.f,p=f.properties,now=pointPx(event);
  if(!onGround(now,p.space3d))return;
  if(!G.moved&&now.distanceTo(G.start)<3) return;
  G.moved=true;
  f.geometry=JSON.parse(JSON.stringify(G.snap));
  const P=proj(featureLL(f,now));
  if(G.type==="move"){
    const dx=P.x-G.startP.x,dy=P.y-G.startP.y;
    mapCoords(f,c=>pToC({x:cToP(c).x+dx,y:cToP(c).y+dy}));
  }else if(G.type==="vertex"){
    const i=G.index,g=f.geometry;
    if(g.type==="LineString"){
      let end=now;
      if(event.shiftKey&&g.coordinates.length===2){ const o=featurePx(f,toLL(g.coordinates[1-i])),d=now.subtract(o),a=Math.round(Math.atan2(d.y,d.x)/(Math.PI/12))*(Math.PI/12),r=Math.hypot(d.x,d.y);end=o.add([r*Math.cos(a),r*Math.sin(a)]) }
      g.coordinates[i]=toC(featureLL(f,end));
    }else{ const ring=g.coordinates[0];ring[i]=toC(featureLL(f,now));if(i===0) ring[ring.length-1]=ring[0] }
  }else if(G.type==="rotate"){
    const fr=G.frame;
    const cx=fr.screen?fr.c[0].add(fr.c[2]).divideBy(2):featurePx(f,unproj(fr.at((fr.x0+fr.x1)/2,(fr.y0+fr.y1)/2)));
    const a0=Math.atan2(G.start.y-cx.y,G.start.x-cx.x),a1=Math.atan2(now.y-cx.y,now.x-cx.x);
    let rot=(G.props.rot||0)-(a1-a0);
    if(event.shiftKey){ const step=Math.PI/12;rot=Math.round(rot/step)*step }
    const delta=rot-(G.props.rot||0);
    p.rot=+rot.toFixed(5);
    if(p.kind!=="text"){
      const C=proj(featureLL(f,cx)),cos=Math.cos(delta),sin=Math.sin(delta);
      mapCoords(f,c=>{ const q=cToP(c),x=q.x-C.x,y=q.y-C.y;return pToC({x:C.x+x*cos-y*sin,y:C.y+x*sin+y*cos}) });
    }
  }else if(G.type==="resize"){
    const fr=G.frame,h=G.handle,spec=HANDLES.find(x=>x[0]===h);
    if(fr.screen){
      /* Text and pins scale evenly, from the opposite corner (text) or the
         pin's point (pins). */
      const idx={nw:0,ne:1,se:2,sw:3}[h],A=fr.c[(idx+2)%4],H=fr.c[idx];
      const v=H.subtract(A),s=Math.max(0.1,((now.x-A.x)*v.x+(now.y-A.y)*v.y)/(v.x*v.x+v.y*v.y||1));
      p.size=+(G.props.size*s).toFixed(6);if(G.props.fontSize)p.fontSize=G.props.fontSize*s;
      if(p.kind==="text"){ const C0=featurePx(f,toLL(G.snap.coordinates)),C1=A.add(C0.subtract(A).multiplyBy(s));f.geometry.coordinates=toC(featureLL(f,C1)) }
    }else{
      const [ ,hx,hy]=spec,ax=1-hx,ay=1-hy;
      const lx=t=>fr.x0+(fr.x1-fr.x0)*t,ly=t=>fr.y0+(fr.y1-fr.y0)*t;
      const A={x:lx(ax),y:ly(ay)},H={x:lx(hx),y:ly(hy)},Q=fr.toLocal(P);
      let sx=hx===.5?1:(Q.x-A.x)/((H.x-A.x)||1),sy=hy===.5?1:(Q.y-A.y)/((H.y-A.y)||1);
      const uniform=event.shiftKey&&hx!==.5&&hy!==.5;
      if(uniform){ const s=(Math.abs(sx)+Math.abs(sy))/2;sx=Math.sign(sx||1)*s;sy=Math.sign(sy||1)*s }
      const tiny=v=>Math.abs(v)<0.02?Math.sign(v||1)*0.02:v;sx=tiny(sx);sy=tiny(sy);
      mapCoords(f,c=>{ const q=fr.toLocal(cToP(c));return pToC(fr.at(A.x+(q.x-A.x)*sx,A.y+(q.y-A.y)*sy)) });
    }
  }
  renderFeature(editing,f);
  requestAnimationFrame(drawFrame);
}
function endGesture(){
  const G=gesture;gesture=null;overlay.classList.remove("mk-active");
  map.dragging.enable();view3d()?.dragPan.enable();
  if(!G) return;
  if(G.moved) touch(editing);else dropUndo(editing);
  drawFrame();paintBar();
  suppressClickUntil=performance.now()+350;
}
let suppressClickUntil=0;
/* Capture phase on the map: decide before Leaflet sees the press. */
mapEl.addEventListener("pointerdown",event=>{
  if(!editing||tool!=="select"||event.button>0||gesture) return;
  if(event.target.closest("#mkBar,#mkPop,.mk-text-input,.leaflet-control,#mapDock")) return;
  closePop();
  const p=pointPx(event),handleEl=event.target.closest(".mk-handle");
  const f=selectedFeature();
  if(handleEl&&f){
    const h=handleEl.dataset.h;
    if(h==="rotate") beginGesture(event,"rotate",f);
    else if(h.startsWith("v")) beginGesture(event,"vertex",f,{index:+h.slice(1)});
    else beginGesture(event,"resize",f,{handle:h});
    return;
  }
  const hit=hitTest(p);
  if(!hit) return;               // empty map: pans as usual; a click deselects
  if(selected?.fid!==hit.properties.fid) select(hit.properties.fid);
  beginGesture(event,"move",hit);
},true);
for(const type of ["mousedown","touchstart"]) mapEl.addEventListener(type,event=>{ if(gesture) event.stopPropagation() },true);
/* A tap also sends mouseover, which preventDefault cannot stop; it would open
   a hover tooltip from a layer under the mark. */
for(const type of ["mouseover","mousemove"]) mapEl.addEventListener(type,event=>{ if(gesture||performance.now()<suppressClickUntil) event.stopPropagation() },true);
addEventListener("pointermove",event=>{ if(gesture&&event.pointerId===gesture.id) runGesture(event) });
addEventListener("pointerup",event=>{ if(gesture&&event.pointerId===gesture.id) endGesture() });
addEventListener("pointercancel",event=>{ if(gesture&&event.pointerId===gesture.id){ const G=gesture;G.f.geometry=G.snap;G.f.properties=G.props;renderFeature(editing,G.f);G.moved=false;endGesture() } });
mapEl.addEventListener("dblclick",event=>{
  if(!editing||tool!=="select") return;
  const f=selectedFeature();
  if(f&&(f.properties.kind==="text"||f.properties.kind==="pin")&&hitFeature(f,pointPx(event))){ event.stopPropagation();event.preventDefault();editSelectedText() }
},true);
mapEl.addEventListener("pointermove",event=>{
  if(!editing||tool!=="select"||gesture||event.pointerType==="touch") return;
  const over=!event.target.closest(".mk-handle")&&!!hitTest(pointPx(event));
  mapEl.classList.toggle("mk-hover",over);
},{passive:true});
/* The click that ends a press on a mark is the mark's, not the map's: it must
   not also open a popup from a layer underneath. */
mapEl.addEventListener("click",event=>{
  if(!editing||tool!=="select") return;
  if(performance.now()<suppressClickUntil||hitTest(pointPx(event))){ event.stopPropagation();event.preventDefault() }
},true);
map.on("click",()=>{ if(performance.now()<suppressClickUntil) return;if(editing&&tool==="select"&&selected){ deselect();paintBar() } });

/* ---------------------------------------------------------------- the panel */
let panel=null,changeTimer=null,confirm=null;
function changed(){
  clearTimeout(changeTimer);
  changeTimer=setTimeout(()=>{
    /* Never redraw the list under someone renaming a layer. */
    if(panel?.isConnected&&!panel.querySelector(".mk-rename:focus,.mk-new-name:focus")) renderPanel(panel);
    document.dispatchEvent(new CustomEvent("csp:layers-changed"));
  },60);
}
function statusText(layer){
  const server=serverState();
  if(!server.online) return "Saved on this device";
  if(lastStatus==="unsupported") return "Saved on this device · engine needs an update to keep markup";
  if(layer.syncedAt===layer.doc.markup.updated) return "Saved to the engine";
  return lastStatus==="error"?"Saved on this device · engine save failed":"Saving…";
}
const countText=n=>`${n} item${n===1?"":"s"}`;
function renderPanel(container){
  panel=container;
  const list=[...layers.values()].sort((a,b)=>b.rank-a.rank);
  const server=serverState();
  const creating=container.querySelector(".mk-new:not([hidden])");
  const draftName=creating?$(".mk-new-name",container)?.value:"";
  const draftColor=creating?container.querySelector('[data-new-color][aria-pressed="true"]')?.dataset.newColor:null;
  container.innerHTML=`
    <div class="csp-section-label">Markup layers</div>
    <div class="csp-card mk-panel">
      <div class="mk-new" hidden>
        <input class="mk-new-name" type="text" maxlength="120" placeholder="Layer name, e.g. Pangborn Bar" aria-label="New layer name">
        <div class="mk-pop-label">Layer colour <span>· the default ink and the layer's tag</span></div>
        <div class="mk-color-grid" role="radiogroup" aria-label="Layer colour">${COLOR_GRID.map(c=>`<button type="button" class="mk-swatch" role="radio" data-new-color="${c}" style="--c:${c}" aria-pressed="${c===(draftColor||DEFAULT_COLOR)}" aria-checked="${c===(draftColor||DEFAULT_COLOR)}" aria-label="Colour ${c}"></button>`).join("")}</div>
        <div class="mk-new-actions"><button type="button" class="mk-btn" data-act="cancel-new">Cancel</button><button type="button" class="mk-btn mk-btn-primary" data-act="create">Create layer</button></div>
      </div>
      <button type="button" class="mk-add" data-act="new"><img src="${icon("plus")}" alt=""><span>New markup layer · 2D &amp; 3D</span></button>
      <div class="mk-list"></div>
      <div class="mk-note">${!server.online?"Layers are saved on this device. Connect the terrain engine to keep them there too and share them between devices."
        :lastStatus==="unsupported"?"This terrain engine was installed before markup existed, so layers stay on this device. Update the engine to the latest code to keep and share them."
        :"Layers are kept by the terrain engine and on this device, so they are here offline too."}</div>
    </div>`;
  if(creating){ $(".mk-new",container).hidden=false;$(".mk-add",container).hidden=true;$(".mk-new-name",container).value=draftName }
  const listEl=$(".mk-list",container);
  if(!list.length){ const empty=document.createElement("div");empty.className="mk-empty";empty.textContent="No markup layers yet.";listEl.append(empty) }
  for(const layer of list){
    const m=layer.doc.markup,n=layer.doc.features.length,active=editing===layer;
    const row=document.createElement("article");row.className="mk-layer";row.dataset.id=m.id;row.classList.toggle("mk-active",active);
    const ask=confirm?.id===m.id?confirm.act:null;
    row.innerHTML=`
      <span class="mk-dot" style="--c:${m.color}"></span>
      <div class="mk-layer-main">
        <button type="button" class="mk-layer-title" data-act="rename" title="Rename"></button>
        <div class="mk-layer-meta">2D &amp; 3D · ${countText(n)} · ${esc(statusText(layer))}</div>
      </div>
      <label class="csp-switch" aria-label="Show ${esc(m.name)}"><input type="checkbox" ${layer.visible?"checked":""}><span></span></label>
      ${ask?`<div class="mk-confirm" role="alert">
          <p>${ask==="clear"?`Clear all ${countText(n)} from this layer? The layer stays.`:`Delete this layer and its ${countText(n)}?`}</p>
          <div class="mk-actions"><button type="button" class="mk-btn" data-act="cancel-confirm">Cancel</button>
          <button type="button" class="mk-btn mk-btn-danger" data-act="${ask}-yes">${ask==="clear"?"Clear":"Delete"}</button></div></div>`
      :`<div class="mk-actions">
        <button type="button" class="mk-btn mk-draw" data-act="edit" aria-pressed="${active}"><img src="${icon(active?"check":"pencil")}" alt=""><span>${active?"Drawing":"Draw"}</span></button>
        <button type="button" class="mk-btn" data-act="zoom" ${n?"":"disabled"}>Zoom to</button>
        <button type="button" class="mk-btn" data-act="clear" ${n?"":"disabled"}>Clear</button>
        <button type="button" class="mk-btn mk-btn-danger-text" data-act="delete">Delete</button>
      </div>`}`;
    $(".mk-layer-title",row).textContent=m.name;
    $(".csp-switch input",row).addEventListener("change",event=>setVisible(m.id,event.target.checked));
    listEl.append(row);
  }
  container.onclick=event=>{
    const button=event.target.closest("button");if(!button) return;
    const row=button.closest(".mk-layer"),layer=row&&layers.get(row.dataset.id),act=button.dataset.act;
    if(button.dataset.newColor){ container.querySelectorAll("[data-new-color]").forEach(b=>{ b.setAttribute("aria-pressed",String(b===button));b.setAttribute("aria-checked",String(b===button)) });return }
    if(act==="new"){ $(".mk-new",container).hidden=false;button.hidden=true;$(".mk-new-name",container).focus();return }
    if(act==="cancel-new"){ $(".mk-new",container).hidden=true;renderPanel(container);return }
    if(act==="create"){
      const name=$(".mk-new-name",container).value.trim()||`Markup ${layers.size+1}`;
      const color=container.querySelector('[data-new-color][aria-pressed="true"]')?.dataset.newColor||DEFAULT_COLOR;
      $(".mk-new",container).hidden=true;
      const created=createLayer(name,color);startEditing(created);return;
    }
    if(!layer) return;
    if(act==="edit"){ if(editing===layer) stopEditing();else startEditing(layer) }
    else if(act==="zoom"){ const b=layer.group.getBounds();if(b.isValid()){if(view3d())view3d().fitBounds([[b.getWest(),b.getSouth()],[b.getEast(),b.getNorth()]],{padding:40,maxZoom:18});else map.fitBounds(b,{padding:[40,40],maxZoom:18})} }
    else if(act==="rename") beginRename(button,layer);
    else if(act==="clear"||act==="delete"){ confirm={id:layer.doc.markup.id,act};renderPanel(container);container.querySelector(`.mk-layer[data-id="${layer.doc.markup.id}"] [data-act="${act}-yes"]`)?.focus() }
    else if(act==="cancel-confirm"){ confirm=null;renderPanel(container) }
    else if(act==="clear-yes"){ confirm=null;clearLayer(layer);renderPanel(container) }
    else if(act==="delete-yes"){ confirm=null;deleteLayer(layer) }
  };
  fadeGrid($(".mk-color-grid",container));
  $(".mk-new-name",container)?.addEventListener("keydown",event=>{ if(event.key==="Enter") container.querySelector('[data-act="create"]').click() });
}
/* Renaming in place: the title becomes a field of the same size and weight. */
function beginRename(title,layer){
  const input=document.createElement("input");
  input.type="text";input.value=layer.doc.markup.name;input.className="mk-rename";input.maxLength=120;input.setAttribute("aria-label","Layer name");
  title.replaceWith(input);input.focus();input.select();
  let done=false;
  const finish=commit=>{ if(done) return;done=true;if(commit) renameLayer(layer,input.value);renderPanel(panel) };
  input.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault();finish(true) } else if(e.key==="Escape"){ e.preventDefault();finish(false) } });
  input.addEventListener("blur",()=>finish(true));
}

/* ----------------------------------------------- the Layers list and export */
function setVisible(id,on){
  const layer=layers.get(id);if(!layer) return;
  layer.visible=!!on;if(!on&&editing===layer) stopEditing();
  applyView(layer);writeView();changed();
}
function setOpacity(id,value){ const layer=layers.get(id);if(!layer) return;layer.opacity=Math.max(0,Math.min(100,+value||0));layer.renderRevision++;applyView(layer);writeView() }
function setOrder(ids){
  const markupIds=ids.filter(id=>layers.has(id));
  markupIds.forEach((id,index)=>{ layers.get(id).rank=markupIds.length-index });
  applyOrder();writeView();
}
function activeEntries(){
  return [...layers.values()].filter(l=>l.visible).sort((a,b)=>b.rank-a.rank).map(l=>({
    id:`markup:${l.doc.markup.id}`,name:l.doc.markup.name,
    meta:`Markup · 2D & 3D · ${countText(l.doc.features.length)}`,
    opacity:l.opacity,visible:true,kind:"markup"}));
}
/* The map's quick-draw button: back to the layer last drawn on, or the top
   visible one, or a new layer when there is none. */
function quickDraw(){
  if(editing){ setToolsOpen(!toolsOpen);return true }
  const all=[...layers.values()].sort((a,b)=>b.rank-a.rank);
  const layer=layers.get(lastLayerId)||all.find(l=>l.visible)||all[0]||createLayer(`Markup ${layers.size+1}`,DEFAULT_COLOR);
  startEditing(layer);return true;
}

window.CSPMarkup={prepare3d,attach3d,snapshotEntries,drawSnapshotLayer,renderPanel,activeEntries,setVisible,setOpacity,setOrder,quickDraw,
  isEditing:()=>!!editing,
  resetLayer:id=>setOpacity(id,100),count:()=>[...layers.values()].filter(l=>l.visible).length,
  sync:syncAll,_layers:layers,_select:fid=>{ if(editing){ setTool("select");select(fid) } }};

/* ------------------------------------------------------------------- start */
sizeEraser();
(async()=>{
  const view=readView();
  for(const doc of await idb.all()) if(doc?.markup?.id&&!layers.has(doc.markup.id)) makeLayer(doc,view[doc.markup.id]||{});
  applyOrder();changed();
  syncAll();
})();
})();
