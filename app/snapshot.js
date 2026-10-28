/* ----------------------------------------------------------- map snapshot */
const snapshotEl=$("#snapshot"), snapshotStatusEl=$("#snapshotStatus");
let snapshotStatusTimer=null;
function setSnapshotStatus(text,timeout=5000){
  snapshotStatusEl.textContent=text;
  clearTimeout(snapshotStatusTimer);
  if(text) requestAnimationFrame(()=>positionToolPopover(snapshotStatusEl,snapshotEl));
  if(timeout) snapshotStatusTimer=setTimeout(()=>{ snapshotStatusEl.textContent="" },timeout);
}
function snapshotFilename(){
  return "clear-skies-"+new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z")+".png";
}
function saveBlob(blob,name){
  const link=document.createElement("a"), href=URL.createObjectURL(blob);
  link.href=href; link.download=name; link.style.display="none";
  document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}
async function deliverSnapshot(blob,name){
  const file=typeof File==="function"?new File([blob],name,{type:"image/png"}):null;
  const touchShare=matchMedia("(pointer: coarse)").matches||/iP(?:hone|ad|od)/.test(navigator.userAgent||"");
  if(touchShare&&file&&navigator.share&&navigator.canShare?.({files:[file]})){
    try{
      await navigator.share({files:[file],title:"Clear Skies map export"});
      setSnapshotStatus(`Shared ${name}.`,7000);
      return true;
    }catch(error){
      if(error?.name==="AbortError"){ setSnapshotStatus("Map export cancelled.",5000); return false }
    }
  }
  saveBlob(blob,name);
  setSnapshotStatus(NATIVE_HOST?`Choose where to save ${name} in the system sheet.`:`Downloaded ${name} to this browser's Downloads.`,7000);
  return true;
}
function snapshotElementOpacity(el,mapEl){
  let opacity=1,node=el;
  while(node&&node!==mapEl){ const value=parseFloat(getComputedStyle(node).opacity);if(Number.isFinite(value)) opacity*=value;node=node.parentElement }
  return opacity;
}
function snapshotElementFilter(el,mapEl){
  let node=el;
  while(node&&node!==mapEl){ const value=getComputedStyle(node).filter;if(value&&value!=="none") return value;node=node.parentElement }
  return "none";
}
function snapshotElementZ(el,mapEl){
  let value=[],node=el;
  while(node&&node!==mapEl){const cs=getComputedStyle(node),z=parseInt(cs.zIndex,10);if(Number.isFinite(z)||cs.transform!=="none"||Number(cs.opacity)<1)value.unshift(Number.isFinite(z)?z:0);node=node.parentElement}
  return value;
}
async function snapshotBitmap(url,cache){
  if(cache.has(url)) return cache.get(url);
  const task=(async()=>{
    /* 404 and 204 are a source saying "nothing here" (outside a scene's
       footprint, past a layer's coverage): an empty tile, not a failure, and
       not worth a second try through the proxy. */
    const fetchBlob=async target=>{
      const controller=new AbortController();
      const timer=/^https:\/\/hydro\.nationalmap\.gov\//i.test(url)?setTimeout(()=>controller.abort(),15000):null;
      try{
        const r=await fetch(target,{cache:"force-cache",signal:controller.signal});
        if(r.status===404||r.status===204) return null;
        if(!r.ok) throw new Error(`image HTTP ${r.status}`);return await r.blob();
      }finally{if(timer)clearTimeout(timer)}
    };
    let blob;
    try{ blob=await fetchBlob(url) }
    catch(error){
      if(!PROXY||!/^https:\/\//i.test(url)) throw error;
      blob=await fetchBlob(api(`/api/snapshot/image?url=${encodeURIComponent(url)}`));
    }
    if(!blob) return null;
    return typeof createImageBitmap==="function"?createImageBitmap(blob):new Promise((resolve,reject)=>{
      const src=URL.createObjectURL(blob),img=new Image();
      img.onload=()=>{URL.revokeObjectURL(src);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(src);reject(new Error("image decode failed"))};img.src=src;
    });
  })();
  cache.set(url,task);return task;
}
L.DomEvent.disableClickPropagation(snapshotEl);
L.DomEvent.disableScrollPropagation(snapshotEl);

/* Direct PNG export deliberately does not ask macOS to capture a window. The
   browser requests the source tiles for the selected geographic area instead,
   so a larger export holds genuine extra imagery detail.

   The camera button opens a Mac screenshot-style selection over the map: drag
   a rectangle (or move and resize the proposed one), pick a resolution, Save.
   Resolution is output pixels per screen point; each raster layer is fetched
   at the source zoom that puts one tile pixel on one output pixel, capped at
   what the source publishes. Everything is placed through the map's own
   projection, so a rotated map exports exactly the rectangle that was drawn. */
const snapshotPanel=$("#snapshotPanel"), snapshotScaleEl=$("#snapshotScale"),
      snapshotCaptureEl=$("#snapshotCapture"), snapshotSelectEl=$("#snapshotSelect"), snapshotMetaEl=$("#snapshotMeta");
let snapshotExporting=false, snapshotProgressAt=0;
const SNAPSHOT_SCALES=[1,2,4,8,16,32], SNAPSHOT_SCALE_KEY="clearskies.snapshot-scale.v1";
/* Exports are rendered in blocks and written as a streamed PNG (png-stream.js),
   so no canvas ever holds the whole image and the browser's canvas caps
   (16.7 MP on iPhone, 16,384 px per side) no longer bound the output. What
   remains is the finished file itself: a phone holds it in memory before the
   share sheet takes it, a desktop browser that can write straight to disk
   (the save dialog) never holds it at all.
   The tile ceiling is about the sources, not the device: 8 requests at a time
   from the browser cache first, so a big export is a steady trickle rather
   than a burst, and a runaway selection still stops short of thousands of
   gigabytes of requests. */
const SNAPSHOT_IOS=/iP(?:hone|ad|od)/.test(navigator.userAgent||"")||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const SNAPSHOT_STREAM=!!(window.CSPPngStream&&CSPPngStream.supported());
const SNAPSHOT_DISK=typeof window.showSaveFilePicker==="function"&&!SNAPSHOT_IOS;
const SNAPSHOT_MAX_PIXELS=!SNAPSHOT_STREAM?(SNAPSHOT_IOS?16_000_000:48_000_000):SNAPSHOT_IOS?200_000_000:SNAPSHOT_DISK?2_000_000_000:600_000_000,
      SNAPSHOT_MAX_EDGE=SNAPSHOT_STREAM?200_000:16384, SNAPSHOT_CANVAS_EDGE=16384,
      SNAPSHOT_MAX_TILES=30000, SNAPSHOT_FETCH_CONCURRENCY=8,
      SNAPSHOT_BLOCK_EDGE=4096, SNAPSHOT_BAND_PIXELS=4_000_000;
function snapshotScale(){ const v=Number(snapshotScaleEl.value);return SNAPSHOT_SCALES.includes(v)?v:2 }
function setSnapshotScale(v){
  if(!SNAPSHOT_SCALES.includes(v)) return;
  snapshotScaleEl.value=String(v);
  try{ localStorage.setItem(SNAPSHOT_SCALE_KEY,String(v)) }catch(e){}
  updateSnapshotPreview();layoutSnapSel();
}
try{ const saved=Number(localStorage.getItem(SNAPSHOT_SCALE_KEY));if(SNAPSHOT_SCALES.includes(saved)) snapshotScaleEl.value=String(saved) }catch(e){}
function snapshotWorldY(lat,z){
  const clamped=Math.max(-85.05112878,Math.min(85.05112878,lat)),sin=Math.sin(clamped*Math.PI/180),world=256*Math.pow(2,z);
  return (0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*world;
}
function snapshotTileRange(bounds,z){
  const world=256*Math.pow(2,z),west=(bounds.getWest()+180)/360*world;
  let east=(bounds.getEast()+180)/360*world;
  if(east<=west) east+=world;
  const north=snapshotWorldY(bounds.getNorth(),z),south=snapshotWorldY(bounds.getSouth(),z);
  if(!(east>west&&south>north)) throw new Error("The current map extent cannot be exported.");
  return {west,east,north,south,x0:Math.floor(west/256),x1:Math.ceil(east/256)-1,
    y0:Math.floor(north/256),y1:Math.ceil(south/256)-1};
}
function snapshotLayerOpacity(layer){
  const opacity=Number(layer.options?.opacity);
  return Number.isFinite(opacity)?Math.max(0,Math.min(1,opacity)):1;
}
/* Tile layers the map is actually drawing right now: on the map, visible, and
   inside their own zoom range (a layer with minZoom 10 is on the map but blank
   at z9, and must not appear in the export either). */
function snapshotRasterLayers(){
  const zoom=map.getZoom();
  return Object.values(map._layers).map((layer,index)=>({layer,index}))
    .filter(({layer})=>map.hasLayer(layer)&&typeof layer.getTileUrl==="function"&&snapshotLayerOpacity(layer)>0
      &&!(zoom<(layer.options?.minZoom??-Infinity))&&!(zoom>(layer.options?.maxZoom??Infinity))
      &&!(layer.getContainer?.()&&getComputedStyle(layer.getContainer()).display==="none"));
}
function snapshotLayerZoom(layer,scale){
  /* One tile pixel per output pixel, rounding up past a quarter level so a
     2x export of a z12.3 view is drawn from z14, not a soft z13. */
  const ideal=Math.ceil(map.getZoom()+Math.log2(scale)-0.25);
  const native=Number(layer.options?.cspNativeZoom??layer.options?.maxNativeZoom??layer.options?.maxZoom);
  const floor=Number(layer.options?.minNativeZoom);
  let z=Math.max(0,ideal);
  if(Number.isFinite(native)) z=Math.min(z,Math.floor(native));
  if(Number.isFinite(floor)) z=Math.max(z,Math.ceil(floor));
  return z;
}
/* Map container point -> source world pixel at zoom z is a similarity
   (scale, rotation, shift) for Web Mercator, so three points pin it exactly. */
function snapshotTilePlan(layer,sel,scale){
  const z=snapshotLayerZoom(layer,scale),n=Math.pow(2,z);
  const corners=[[sel.x,sel.y],[sel.x+sel.w,sel.y],[sel.x,sel.y+sel.h],[sel.x+sel.w,sel.y+sel.h]]
    .map(([x,y])=>map.project(map.containerPointToLatLng(L.point(x,y)),z));
  const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
  const x0=Math.floor(Math.min(...xs)/256),x1=Math.ceil(Math.max(...xs)/256)-1;
  const y0=Math.max(0,Math.floor(Math.min(...ys)/256)),y1=Math.min(n-1,Math.ceil(Math.max(...ys)/256)-1);
  const origin=L.point(x0*256,Math.max(0,y0)*256);
  const toContainer=p=>map.latLngToContainerPoint(map.unproject(p,z));
  const f0=toContainer(origin),f1=toContainer(origin.add(L.point(256,0))),f2=toContainer(origin.add(L.point(0,256)));
  const m=[(f1.x-f0.x)/256,(f1.y-f0.y)/256,(f2.x-f0.x)/256,(f2.y-f0.y)/256,f0.x,f0.y];
  const count=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);
  return {layer,z,x0,x1,y0,y1,m,count,opacity:snapshotLayerOpacity(layer),filter:snapshotElementFilter(layer.getContainer?.(),$("#map"))};
}
function snapshotFullSelection(){
  const size=map.getSize();return {x:0,y:0,w:size.x,h:size.y};
}
/* LiDAR terrain and elevation overlays are re-rendered for an export, and
   an export finer than the view fetches its own elevation tiles down to the
   finest level a source has (gpu-terrain-layer exportDetail): {z, live, tiles}. */
function snapshotTerrainDetail(sel,scale){
  if(map3d||!gpuTerrainEnabled||!gpuTerrainLayer||!map.hasLayer(gpuTerrainLayer)) return null;
  try{ return gpuTerrainLayer.exportDetail({sel,scale}) }catch(error){ return null }
}
function snapshotSpec(sel,scale){
  const width=Math.max(1,Math.round(sel.w*scale)),height=Math.max(1,Math.round(sel.h*scale));
  const plans=map3d?[]:snapshotRasterLayers().map(item=>snapshotTilePlan(item.layer,sel,scale)).filter(plan=>plan.count>0);
  const terrain=snapshotTerrainDetail(sel,scale);
  const tiles=plans.reduce((sum,plan)=>sum+plan.count,0)+(terrain?.tiles||0);
  const tooBig=width*height>SNAPSHOT_MAX_PIXELS||Math.max(width,height)>(map3d?SNAPSHOT_CANVAS_EDGE:SNAPSHOT_MAX_EDGE);
  /* Past 8x a step only earns its pixels if some source - imagery or the
     LiDAR elevation - has finer tiles to give; otherwise it is the 8x
     picture enlarged, and not offered. */
  const finerTerrain=!!terrain&&terrain.z>(snapshotTerrainDetail(sel,scale/2)?.z??Infinity);
  const noFinerDetail=!map3d&&scale>8&&!finerTerrain&&plans.every(plan=>plan.z===snapshotLayerZoom(plan.layer,scale/2));
  return {sel,scale,width,height,plans,terrain,tiles,tooBig,tooManyTiles:tiles>SNAPSHOT_MAX_TILES,noFinerDetail,
    ok:!tooBig&&!noFinerDetail&&tiles<=SNAPSHOT_MAX_TILES&&(!map3d||scale<=snapshotMax3dScale())};
}
/* The 3D view is captured from its WebGL canvas, which is only as fine as the
   screen; anything larger would be an enlargement, so it is not offered. */
function snapshotMax3dScale(){ return Math.max(1,Math.floor(Number(devicePixelRatio)||1)) }
function snapshotMegapixels(w,h){ return (w*h/1e6).toFixed(w*h<10_000_000?1:0) }
function snapshotGroundText(sel,scale){
  const c=map.containerPointToLatLng(L.point(sel.x+sel.w/2,sel.y+sel.h/2));
  const metres=156543.03392*Math.cos(c.lat*Math.PI/180)/Math.pow(2,map.getZoom())/scale;
  return res(metres)+"/px";
}
function snapshotLimitText(spec){
  if(spec.tooBig) return `Over the ${Math.round(SNAPSHOT_MAX_PIXELS/1e6).toLocaleString()} MP limit for this device`;
  if(spec.noFinerDetail) return "No finer source detail at this zoom; zoom in to go higher";
  if(spec.tooManyTiles) return `Needs ${spec.tiles.toLocaleString()} source tiles (limit ${SNAPSHOT_MAX_TILES.toLocaleString()})`;
  if(map3d&&spec.scale>snapshotMax3dScale()) return "3D saves at screen resolution";
  return "";
}
/* The 3D view is saved from its own canvas, so a resolution above the screen's
   is stepped down to the finest it can deliver rather than refused. */
function snapshotFit3dScale(){
  if(map3d&&snapshotScale()>snapshotMax3dScale()) snapshotScaleEl.value=String(SNAPSHOT_SCALES.filter(v=>v<=snapshotMax3dScale()).pop());
}
function updateSnapshotPreview(){
  let spec;
  snapshotSelectEl.disabled=snapshotExporting;
  snapshotCaptureEl.textContent=snapshotExporting?"Exporting…":"Capture";
  try{ spec=snapshotSpec(snapshotFullSelection(),snapshotScale()) }
  catch(error){ snapshotMetaEl.textContent=error.message;snapshotCaptureEl.disabled=true;return }
  const limit=snapshotLimitText(spec);
  snapshotMetaEl.textContent=`The whole view at ${spec.scale}× is ${spec.width.toLocaleString()} × ${spec.height.toLocaleString()} px (${snapshotMegapixels(spec.width,spec.height)} MP, ${snapshotGroundText(spec.sel,spec.scale)}).`
    +(limit?` ${limit} — choose a lower resolution or Select Area.`:"");
  snapshotCaptureEl.disabled=snapshotExporting||!spec.ok;
}
function snapshotWrappedX(x,z){ const n=Math.pow(2,z);return ((x%n)+n)%n }
function snapshotLayerTileUrl(layer,rawCoords){
  const coords={x:snapshotWrappedX(rawCoords.x,rawCoords.z),y:rawCoords.y,z:rawCoords.z},n=Math.pow(2,coords.z);
  if(typeof layer.getSnapshotTileUrl==="function")return layer.getSnapshotTileUrl(coords);
  if(typeof layer._url==="string"&&layer._url){
    const data={r:L.Browser.retina?"@2x":"",
      s:typeof layer._getSubdomain==="function"?layer._getSubdomain(coords):"a",x:coords.x,
      y:layer.options?.tms?n-1-coords.y:coords.y,z:coords.z};
    data["-y"]=n-1-coords.y;
    return L.Util.template(layer._url,data);
  }
  return layer.getTileUrl(coords);
}
async function snapshotPool(tasks,work,settled){
  const results=new Array(tasks.length);let next=0;
  const worker=async()=>{ while(next<tasks.length){ const index=next++;
    try{ results[index]=await work(tasks[index]) }catch(error){ results[index]=null }
    settled?.(results[index]);
  }};
  await Promise.all(Array.from({length:Math.min(SNAPSHOT_FETCH_CONCURRENCY,tasks.length)},worker));return results;
}
async function drawSnapshotRasterPlan(ctx,plan,spec,cache,progress,subset){
  const tiles=subset||[];
  if(!subset) for(let y=plan.y0;y<=plan.y1;y++) for(let x=plan.x0;x<=plan.x1;x++) tiles.push({x,y,z:plan.z});
  const results=await snapshotPool(tiles,async tile=>{
    const url=snapshotLayerTileUrl(plan.layer,tile);
    try{return {tile,bitmap:await snapshotBitmap(url,cache)}}catch(error){
      const fallback=plan.layer.getFallbackTileUrl?.({...tile,x:snapshotWrappedX(tile.x,tile.z)});
      if(!fallback||fallback===url)throw error;
      return {tile,bitmap:await snapshotBitmap(fallback,cache)};
    }
  },progress);
  const [a,b,c,d,e,f]=plan.m,s=spec.scale,sel=spec.sel,rotated=Math.abs(b)>1e-9||Math.abs(c)>1e-9;
  let drawn=0,failed=0;const failedTiles=[];
  ctx.save();ctx.globalAlpha=plan.opacity;ctx.imageSmoothingQuality="high";
  const needsWaterFilter=plan.filter==="grayscale(1) brightness(1.35)",nativeFilter="filter" in ctx;
  if(nativeFilter)ctx.filter=plan.filter||"none";
  if(rotated) ctx.setTransform(s*a,s*b,s*c,s*d,s*(e-sel.x),s*(f-sel.y));
  /* Half an output pixel of overlap hides the hairline a rotated edge would
     otherwise antialias through; north-up tiles instead land on shared whole
     pixels, so neighbours meet exactly with no overlap and no seam. */
  const pad=rotated?0.5/Math.max(1e-6,s*Math.hypot(a,b)):0;
  for(let index=0;index<results.length;index++){
    const result=results[index];
    if(!result){ failed++;failedTiles.push(tiles[index]);continue }
    if(!result.bitmap) continue;
    let bitmap=result.bitmap,filtered=null;
    // WebKit versions without Canvas 2D filters use the same luminance and
    // brightness transform explicitly, preserving transparency and extent.
    if(needsWaterFilter&&!nativeFilter){
      filtered=document.createElement("canvas");filtered.width=bitmap.width;filtered.height=bitmap.height;
      const filterContext=filtered.getContext("2d",{willReadFrequently:true});
      filterContext.drawImage(bitmap,0,0);
      const pixels=filterContext.getImageData(0,0,filtered.width,filtered.height),data=pixels.data;
      for(let pixel=0;pixel<data.length;pixel+=4){const grey=Math.min(255,Math.round((.2126*data[pixel]+.7152*data[pixel+1]+.0722*data[pixel+2])*1.35));data[pixel]=data[pixel+1]=data[pixel+2]=grey}
      filterContext.putImageData(pixels,0,0);bitmap=filtered;
    }
    const tx=(result.tile.x-plan.x0)*256,ty=(result.tile.y-plan.y0)*256;
    try{
      if(rotated) ctx.drawImage(bitmap,tx-pad,ty-pad,256+2*pad,256+2*pad);
      else{
        const X0=Math.round(s*(e+a*tx-sel.x)),X1=Math.round(s*(e+a*(tx+256)-sel.x));
        const Y0=Math.round(s*(f+d*ty-sel.y)),Y1=Math.round(s*(f+d*(ty+256)-sel.y));
        ctx.drawImage(bitmap,X0,Y0,X1-X0,Y1-Y0);
      }
      drawn++;
    }catch(error){ failed++ }finally{if(filtered)filtered.width=filtered.height=0}
  }
  ctx.restore();return {drawn,failed,failedTiles};
}
async function snapshotSvgBitmap(el,width,height,region){
  const clone=el.cloneNode(true),rect=el.getBoundingClientRect(),sourceWidth=Math.max(1,Math.round(parseFloat(getComputedStyle(el).width)||rect.width)),sourceHeight=Math.max(1,Math.round(parseFloat(getComputedStyle(el).height)||rect.height));
  if(!clone.getAttribute("viewBox")) clone.setAttribute("viewBox",`0 0 ${sourceWidth} ${sourceHeight}`);
  /* A block export rasterizes only the part of the overlay its block shows,
     at full output resolution, so lines stay crisp however large the export. */
  if(region){
    const vb=clone.viewBox.baseVal,kx=vb.width/sourceWidth,ky=vb.height/sourceHeight;
    clone.setAttribute("viewBox",`${vb.x+region.x*kx} ${vb.y+region.y*ky} ${region.w*kx} ${region.h*ky}`);
    clone.setAttribute("preserveAspectRatio","none");
  }
  clone.setAttribute("width",String(width));clone.setAttribute("height",String(height));
  clone.style.transform="none";
  const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:"image/svg+xml"});
  if(typeof createImageBitmap==="function"){
    try{ return await createImageBitmap(blob,{resizeWidth:width,resizeHeight:height,resizeQuality:"high"}) }
    catch(error){ try{ return await createImageBitmap(blob) }catch(e){} }
  }
  return new Promise((resolve,reject)=>{
    const src=URL.createObjectURL(blob),img=new Image();
    img.onload=()=>{URL.revokeObjectURL(src);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(src);reject(new Error("vector decode failed"))};img.src=src;
  });
}
/* Where an element's own box lands in map-container coordinates: the product
   of every transform between it and the map (tile offsets, pane pans, the
   rotation pane), each about its own transform-origin. */
function snapshotDomMatrix(el,root){
  let m=new DOMMatrix(),node=el;
  while(node&&node!==root){
    const cs=getComputedStyle(node);
    const left=node instanceof HTMLElement?node.offsetLeft:(parseFloat(cs.left)||0);
    const top=node instanceof HTMLElement?node.offsetTop:(parseFloat(cs.top)||0);
    let local=new DOMMatrix().translate(left,top);
    if(cs.transform&&cs.transform!=="none"){
      const [ox,oy]=(cs.transformOrigin||"0 0").split(" ").map(v=>parseFloat(v)||0);
      local=local.translate(ox,oy).multiply(new DOMMatrix(cs.transform)).translate(-ox,-oy);
    }
    m=local.multiply(m);
    node=node.parentElement;
  }
  return m;
}
/* Everything that is not a URL tile layer is drawn from what is on screen:
   canvas-rendered terrain tiles, vector overlays, markers. */
function snapshotDomItems(sel){
  const mapEl=$("#map"),box=mapEl.getBoundingClientRect();
  const left=box.left+sel.x,top=box.top+sel.y,right=left+sel.w,bottom=top+sel.h;
  return [...mapEl.querySelectorAll("canvas.leaflet-tile,canvas.leaflet-zoom-animated,img.leaflet-image-layer,img.leaflet-marker-icon,.leaflet-overlay-pane svg,.leaflet-marker-pane svg")]
    .filter(el=>!el.closest(".csp-tile-hold,.csp-markup-pane,.csp-gpu-terrain-container")&&!(el.parentElement&&el.parentElement.closest("svg")))
    .filter(el=>{ const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>left&&r.left<right&&r.bottom>top&&r.top<bottom })
    .filter(el=>snapshotElementOpacity(el,mapEl)>0.001&&getComputedStyle(el).visibility!=="hidden");
}
/* Everything about an on-screen element that a block export would otherwise
   re-read from the style system for every block. */
function snapshotDomInfo(el){
  const mapEl=$("#map"),cs=getComputedStyle(el),w=parseFloat(cs.width)||el.width||0,h=parseFloat(cs.height)||el.height||0;
  if(!(w>0&&h>0)) return null;
  return {el,w,h,m:snapshotDomMatrix(el,mapEl),opacity:snapshotElementOpacity(el,mapEl),filter:snapshotElementFilter(el,mapEl)};
}
async function drawSnapshotDomItem(ctx,el,spec,cache,info=snapshotDomInfo(el)){
  if(!info) return false;
  const {w,h,m}=info,s=spec.scale;
  const out=new DOMMatrix().scale(s,s).translate(-spec.sel.x,-spec.sel.y).multiply(m);
  let bitmap=null,owned=false,region=null;
  try{
    if(el instanceof HTMLCanvasElement) bitmap=el;
    else if(el instanceof SVGElement){
      const k=s*Math.sqrt(Math.abs(m.a*m.d-m.b*m.c))||s;
      /* Only the part of the overlay this canvas covers: the canvas corners
         taken back into the SVG's own pixels, clamped to the SVG. */
      const inv=out.inverse(),cw=ctx.canvas.width,ch=ctx.canvas.height;
      const pts=[[0,0],[cw,0],[0,ch],[cw,ch]].map(([x,y])=>inv.transformPoint(new DOMPoint(x,y)));
      const rx=Math.max(0,Math.floor(Math.min(...pts.map(p=>p.x)))),ry=Math.max(0,Math.floor(Math.min(...pts.map(p=>p.y))));
      const rr=Math.min(w,Math.ceil(Math.max(...pts.map(p=>p.x)))),rb=Math.min(h,Math.ceil(Math.max(...pts.map(p=>p.y))));
      if(!(rr>rx&&rb>ry)) return false;
      region={x:rx,y:ry,w:rr-rx,h:rb-ry};
      bitmap=await snapshotSvgBitmap(el,Math.max(1,Math.min(SNAPSHOT_CANVAS_EDGE,Math.round(region.w*k))),Math.max(1,Math.min(SNAPSHOT_CANVAS_EDGE,Math.round(region.h*k))),region);owned=true;
    }else{ const url=el.currentSrc||el.src;if(url) bitmap=await snapshotBitmap(url,cache) }
    if(!bitmap) return false;
    ctx.save();ctx.setTransform(out);ctx.globalAlpha=info.opacity;ctx.filter=info.filter;
    ctx.imageSmoothingQuality="high";
    if(region) ctx.drawImage(bitmap,region.x,region.y,region.w,region.h);
    else ctx.drawImage(bitmap,0,0,w,h);
    ctx.restore();
    return true;
  }catch(error){ return false }finally{ if(owned) bitmap?.close?.() }
}
/* Paint order follows the page's own stacking: pane and layer z-indexes,
   then document order within them. */
function snapshotPaintOrder(items){
  const mapEl=$("#map");
  return items.map((item,index)=>({...item,index,z:snapshotElementZ(item.el,mapEl)}))
    .sort((a,b)=>{let z=0;for(let i=0;i<Math.max(a.z.length,b.z.length);i++){z=(a.z[i]||0)-(b.z[i]||0);if(z)break}return z||(a.el===b.el?0:(a.el.compareDocumentPosition(b.el)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1))||a.index-b.index});
}
async function composeSnapshot(spec){
  const mapEl=$("#map"),canvas=document.createElement("canvas");canvas.width=spec.width;canvas.height=spec.height;
  const ctx=canvas.getContext("2d",{alpha:false});
  if(!ctx) throw new Error("The browser could not allocate an image this large.");
  ctx.fillStyle=getComputedStyle(mapEl).backgroundColor||(mapEl.dataset.basemapTheme==="dark"?"#111416":"#dbe6eb");
  ctx.fillRect(0,0,spec.width,spec.height);
  const cache=new Map();let settled=0,drawn=0,failed=0,items=[];
  const progress=()=>{ settled++;if(performance.now()-snapshotProgressAt>130){ snapshotProgressAt=performance.now();
    snapshotReport(`Fetching ${settled.toLocaleString()} / ${spec.tiles.toLocaleString()} tiles…`,true) } };
  try{
    if(map3d) drawn+=await drawSnapshot3d(ctx,spec);
    else{
      items=snapshotPaintOrder([
        ...spec.plans.map(plan=>({kind:"tiles",plan,el:plan.layer.getContainer?.()||mapEl})),
        ...snapshotDomItems(spec.sel).map(el=>({kind:"dom",el})),
        ...(window.CSPMarkup?.snapshotEntries()||[]),
        ...(gpuTerrainEnabled?[gpuTerrainLayer.snapshotEntry(spec,{onTile:progress})].filter(Boolean):[])
      ]);
      for(const item of items){
        if(item.kind==="tiles"){ const r=await drawSnapshotRasterPlan(ctx,item.plan,spec,cache,progress);drawn+=r.drawn;failed+=r.failed }
        else if(item.kind==="gpu-terrain"){ctx.drawImage(await item.canvas(),0,0);drawn++;}
        else if(item.kind==="markup"){if(window.CSPMarkup.drawSnapshotLayer(ctx,item.id,spec))drawn++}
        else if(await drawSnapshotDomItem(ctx,item.el,spec,cache)) drawn++;
      }
    }
  }finally{ for(const item of items) item.dispose?.();for(const task of cache.values()) task.then(bitmap=>bitmap.close?.()).catch(()=>{}) }
  if(!drawn) throw new Error("No visible map layers were ready to export.");
  drawSnapshotReadout(ctx,spec);
  snapshotReport("Encoding PNG…",true);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("The browser could not encode an image this large.")),"image/png"));
  canvas.width=canvas.height=0;
  return {blob,drawn,failed};
}
/* The large-export path. The output is cut into bands of full-width rows and
   each band into blocks no wider than SNAPSHOT_BLOCK_EDGE; every block is
   drawn on one small reusable canvas with the same layers, order and geometry
   as composeSnapshot (the selection is shifted by the block's offset, which
   is all a block is), read back, and the band goes to the PNG stream. Each
   block fetches only the source tiles it overlaps, and a tile's bitmap is
   released after the last band that needs it, so memory stays flat no matter
   how large the image is. */
function snapshotStreamNeeded(spec){
  return SNAPSHOT_STREAM&&!map3d&&(spec.width*spec.height>12_000_000||Math.max(spec.width,spec.height)>8192);
}
async function composeSnapshotStream(spec,write){
  const mapEl=$("#map"),W=spec.width,H=spec.height,s=spec.scale,sel=spec.sel;
  const background=getComputedStyle(mapEl).backgroundColor||(mapEl.dataset.basemapTheme==="dark"?"#111416":"#dbe6eb");
  const bandH=Math.max(8,Math.min(1024,Math.floor(SNAPSHOT_BAND_PIXELS/W))),bands=Math.ceil(H/bandH);
  const cols=Math.ceil(W/SNAPSHOT_BLOCK_EDGE),colW=Math.ceil(W/cols);
  /* Every source tile's footprint in output pixels, and the last band that
     touches it. */
  const planTiles=new Map(),lastBand=new Map();
  let drawn=0,fetched=0;
  const progress=()=>{ fetched++ };
  for(const plan of spec.plans){
    const [a,b,c,d,e,f]=plan.m,list=[];
    for(let y=plan.y0;y<=plan.y1;y++) for(let x=plan.x0;x<=plan.x1;x++){
      const tx=(x-plan.x0)*256,ty=(y-plan.y0)*256,X=[],Y=[];
      for(const [px,py] of [[tx,ty],[tx+256,ty],[tx,ty+256],[tx+256,ty+256]]){ X.push(s*(a*px+c*py+e-sel.x));Y.push(s*(b*px+d*py+f-sel.y)) }
      const tile={x,y,z:plan.z,x0:Math.min(...X)-1,x1:Math.max(...X)+1,y0:Math.min(...Y)-1,y1:Math.max(...Y)+1};
      if(tile.x1<=0||tile.x0>=W||tile.y1<=0||tile.y0>=H) continue;
      tile.url=snapshotLayerTileUrl(plan.layer,tile);
      list.push(tile);
      const last=Math.min(bands-1,Math.floor(Math.max(0,tile.y1)/bandH));
      lastBand.set(tile.url,Math.max(lastBand.get(tile.url)??-1,last));
      const fallback=plan.layer.getFallbackTileUrl?.({...tile,x:snapshotWrappedX(tile.x,tile.z)});
      if(fallback)lastBand.set(fallback,Math.max(lastBand.get(fallback)??-1,last));
    }
    planTiles.set(plan,list);
  }
  const items=snapshotPaintOrder([
    ...spec.plans.map(plan=>({kind:"tiles",plan,el:plan.layer.getContainer?.()||mapEl})),
    ...snapshotDomItems(sel).map(el=>({kind:"dom",el})),
    ...(window.CSPMarkup?.snapshotEntries()||[]),
    ...(gpuTerrainEnabled?[gpuTerrainLayer.snapshotEntry(spec,{onTile:progress})].filter(Boolean):[])
  ]).map(item=>{
    if(item.kind!=="dom") return item;
    const info=snapshotDomInfo(item.el);if(!info) return null;
    /* Output footprint, to skip blocks the element does not reach. */
    const out=new DOMMatrix().scale(s,s).translate(-sel.x,-sel.y).multiply(info.m);
    const pts=[[0,0],[info.w,0],[0,info.h],[info.w,info.h]].map(([x,y])=>out.transformPoint(new DOMPoint(x,y)));
    return {...item,info,x0:Math.min(...pts.map(p=>p.x)),x1:Math.max(...pts.map(p=>p.x)),y0:Math.min(...pts.map(p=>p.y)),y1:Math.max(...pts.map(p=>p.y))};
  }).filter(Boolean);
  const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d",{alpha:false,willReadFrequently:true});
  if(!ctx) throw new Error("The browser could not allocate a drawing surface.");
  const png=CSPPngStream.create({width:W,height:H,write});
  const cache=new Map(),failedUrls=new Set(),band=new Uint8ClampedArray(W*bandH*4);
  const report=rows=>{ if(performance.now()-snapshotProgressAt>150){ snapshotProgressAt=performance.now();
    snapshotReport(`Rendering ${Math.floor(rows/H*100)}% · ${fetched.toLocaleString()} tiles`,true) } };
  /* Every layer's tiles for a band are requested together (each source with
     its own few-at-a-time pool), and the next band's while this one is drawn
     and compressed, so a big export is limited by the network, not by
     waiting on one layer after another. The draw then finds them cached. */
  const fetchBand=index=>{
    const y0=index*bandH,y1=Math.min(H,y0+bandH);
    if(y0>=H) return Promise.resolve();
    return Promise.all(spec.plans.map(plan=>{
      const tiles=planTiles.get(plan).filter(t=>t.y1>y0&&t.y0<y1&&!cache.has(t.url));
      return snapshotPool(tiles,tile=>snapshotBitmap(tile.url,cache),progress);
    }));
  };
  let ahead=fetchBand(0);
  try{
    for(let bandIndex=0,y0=0;y0<H;bandIndex++,y0+=bandH){
      const h=Math.min(bandH,H-y0);
      await ahead;ahead=fetchBand(bandIndex+1);
      for(let col=0;col<cols;col++){
        const x0=col*colW,w=Math.min(colW,W-x0);if(w<=0) break;
        if(canvas.width!==w||canvas.height!==h){ canvas.width=w;canvas.height=h }
        ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.filter="none";ctx.fillStyle=background;ctx.fillRect(0,0,w,h);
        const blockSpec={...spec,sel:{...sel,x:sel.x+x0/s,y:sel.y+y0/s}};
        const hits=box=>box.x1>x0&&box.x0<x0+w&&box.y1>y0&&box.y0<y0+h;
        for(const item of items){
          if(item.kind==="tiles"){
            const subset=planTiles.get(item.plan).filter(hits);if(!subset.length) continue;
            const r=await drawSnapshotRasterPlan(ctx,item.plan,blockSpec,cache,null,subset);
            drawn+=r.drawn;for(const t of r.failedTiles) failedUrls.add(t.url);
          }else if(item.kind==="gpu-terrain"){
            /* One export cut into blocks, not one export per block: the
               terrain's layer stack filters across the whole image. */
            ctx.drawImage(await item.canvas({x:x0,y:y0,width:w,height:h}),0,0);drawn++;
          }else if(item.kind==="markup"){if(window.CSPMarkup.drawSnapshotLayer(ctx,item.id,blockSpec))drawn++}
          else if(hits(item)&&await drawSnapshotDomItem(ctx,item.el,blockSpec,cache,item.info)) drawn++;
        }
        drawSnapshotReadout(ctx,spec,x0,y0);
        const pixels=ctx.getImageData(0,0,w,h).data;
        for(let r=0;r<h;r++) band.set(pixels.subarray(r*w*4,(r+1)*w*4),(r*W+x0)*4);
        report(y0+h*(col+1)/cols);
      }
      await png.writeRows(band,h);
      for(const [url,last] of lastBand){
        if(last>bandIndex) continue;
        cache.get(url)?.then(bitmap=>bitmap.close?.()).catch(()=>{});
        cache.delete(url);lastBand.delete(url);
      }
    }
    if(!drawn) throw new Error("No visible map layers were ready to export.");
    snapshotReport("Finishing PNG…",true);
    await png.finish();
  }catch(error){ png.abort(error);throw error }
  finally{ for(const item of items) item.dispose?.();for(const task of cache.values()) task.then(bitmap=>bitmap.close?.()).catch(()=>{});canvas.width=canvas.height=0 }
  return {drawn,failed:failedUrls.size};
}
/* Where a streamed export goes. A desktop browser that can write files asks
   for a destination and writes as it goes; anywhere else the pieces are kept
   as Blobs (which the browser may page to disk) and handed over at the end. */
async function snapshotSink(name,useDisk){
  if(useDisk){
    const handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:"PNG image",accept:{"image/png":[".png"]}}]});
    const file=await handle.createWritable();
    return {write:bytes=>file.write(bytes),close:async()=>{ await file.close();return null },abort:()=>file.abort?.().catch(()=>{}),name:handle.name};
  }
  const parts=[];let pending=[],size=0;
  const flush=()=>{ if(pending.length){ parts.push(new Blob(pending));pending=[];size=0 } };
  return {write:bytes=>{ pending.push(bytes.slice());size+=bytes.length;if(size>=8<<20) flush() },
          close:async()=>{ flush();return new Blob(parts,{type:"image/png"}) },abort:()=>{ parts.length=0;pending=[] },name};
}
/* MapLibre clears its drawing buffer after each frame, so the pixels are read
   inside the render event, before that happens. */
async function drawSnapshot3d(ctx,spec){
  await window.CSPMarkup?.prepare3d();
  return new Promise((resolve,reject)=>{
    const canvas=map3d.getCanvas(),mapBox=$("#map").getBoundingClientRect(),glBox=canvas.getBoundingClientRect();
    const kx=canvas.width/glBox.width,ky=canvas.height/glBox.height;
    const timer=setTimeout(()=>reject(new Error("The 3D view did not redraw.")),4000);
    map3d.once("render",()=>{
      clearTimeout(timer);
      try{
        ctx.drawImage(canvas,(mapBox.left+spec.sel.x-glBox.left)*kx,(mapBox.top+spec.sel.y-glBox.top)*ky,spec.sel.w*kx,spec.sel.h*ky,0,0,spec.width,spec.height);
        resolve(1);
      }catch(error){ reject(error) }
    });
    map3d.triggerRepaint();
  });
}
/* A capture waits for the map to be still: mid-ease, the picture on screen
   and the map's own position disagree, and the tiles would be placed for the
   committed view rather than the one that was selected. */
let snapshotLastMotion=0;
map.on("zoomanim zoom move",()=>{ snapshotLastMotion=performance.now() });
async function snapshotSettled(){
  for(let i=0;i<30&&performance.now()-snapshotLastMotion<420;i++) await new Promise(r=>setTimeout(r,90));
}

