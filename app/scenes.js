/* ------------------------------------------------ selection on the map */
const snapSel=$("#snapSel"),snapBox=$("#snapSelBox"),snapBar=$("#snapSelBar"),snapSize=$("#snapSelSize"),
      snapMeta=$("#snapSelMeta"),snapSaveBtn=$("#snapSelSave");
let snapRect=null,snapDrag=null,snapFocusReturn=null;
const SNAP_MIN=16;
function setSnapSelMeta(text,warn=false){ snapMeta.textContent=text;snapMeta.classList.toggle("snap-warn",!!warn) }
/* Export progress shows on the selection bar while an area is being saved,
   and in the status note by the camera for a whole-view capture. */
function snapshotReport(text,warn=false,timeout=0){
  if(snapSel.hidden) setSnapshotStatus(text,timeout);else setSnapSelMeta(text,warn);
}
function snapBounds(){ const r=$("#map").getBoundingClientRect();return {left:r.left,top:r.top,w:r.width,h:r.height} }
function snapDefaultRect(){
  const b=snapBounds(),inset=scenePanelInsets();
  let bottom=inset.bottom;
  if(document.body.classList.contains("collapsed")&&innerWidth<=760)
    bottom=Math.max(bottom,(parseFloat(getComputedStyle(document.body).getPropertyValue("--sheet-peek"))||0)+12);
  const top=inset.top+44,left=Math.min(inset.left,b.w*.3),right=inset.right;
  const availW=Math.max(SNAP_MIN*4,b.w-left-right),availH=Math.max(SNAP_MIN*4,b.h-top-bottom-60);
  const w=Math.round(availW*.72),h=Math.round(availH*.72);
  return {x:Math.round(left+(availW-w)/2),y:Math.round(top+(availH-h)/2),w,h};
}
function clampSnapRect(r){
  const b=snapBounds();
  const w=Math.max(SNAP_MIN,Math.min(b.w,r.w)),h=Math.max(SNAP_MIN,Math.min(b.h,r.h));
  return {x:Math.max(0,Math.min(b.w-w,r.x)),y:Math.max(0,Math.min(b.h-h,r.y)),w,h};
}
function layoutSnapSel(){
  if(snapSel.hidden||!snapRect) return;
  const b=snapBounds(),r=snapRect=clampSnapRect(snapRect),scale=snapshotScale();
  Object.assign(snapSel.style,{left:b.left+"px",top:b.top+"px",width:b.w+"px",height:b.h+"px"});
  Object.assign(snapBox.style,{transform:`translate(${r.x}px,${r.y}px)`,width:r.w+"px",height:r.h+"px"});
  snapBox.classList.toggle("snap-small",r.w<90||r.h<90);
  snapBox.classList.toggle("snap-size-inside",r.y<30);
  let spec=null;
  try{ spec=snapshotSpec(r,scale) }catch(error){}
  snapSize.textContent=spec?`${spec.width.toLocaleString()} × ${spec.height.toLocaleString()} · ${scale}×`:"";
  /* Resolution and map info were chosen in the camera panel; the bar only
     speaks up when this rectangle cannot be saved at that resolution. */
  if(!snapshotExporting){
    const limit=spec?snapshotLimitText(spec):"";
    setSnapSelMeta(limit,!!limit);
  }
  snapSaveBtn.disabled=snapshotExporting||!spec||!spec.ok;
  /* The bar sits under the selection, above it when there is no room, and
     inside its lower edge when the selection fills the map. */
  const bw=snapBar.offsetWidth,bh=snapBar.offsetHeight,gap=12,inset=scenePanelInsets();
  let top=r.y+r.h+gap;
  if(top+bh>b.h-inset.bottom) top=r.y-gap-bh;
  if(top<inset.top) top=Math.min(b.h-inset.bottom-bh,r.y+r.h-gap-bh);
  const left=Math.max(8,Math.min(b.w-bw-8,r.x+r.w/2-bw/2));
  snapBar.style.transform=`translate(${Math.round(left)}px,${Math.round(Math.max(8,top))}px)`;
}
function startSnapshotSelect(){
  if(!snapSel.hidden) return;
  snapshotCursorLocation=cursorLocation?{...cursorLocation}:null;
  setSnapshotPanel(false);
  if(innerWidth<=760&&!document.body.classList.contains("collapsed")) $("#sideToggle")?.click();
  snapFocusReturn=snapshotEl;
  snapshotFit3dScale();
  snapSel.hidden=false;document.body.classList.add("snap-selecting");snapshotEl.setAttribute("aria-pressed","true");
  /* Measured after the phone sheet has had its frame to drop to the peek. */
  requestAnimationFrame(()=>{ snapRect=snapRect?clampSnapRect(snapRect):snapDefaultRect();layoutSnapSel();snapBox.focus({preventScroll:true}) });
  setSnapshotStatus("",0);
}
function endSnapshotSelect(){
  if(snapSel.hidden) return;
  snapSel.hidden=true;snapDrag=null;document.body.classList.remove("snap-selecting");snapshotEl.setAttribute("aria-pressed","false");
  if(snapFocusReturn&&document.contains(snapFocusReturn)) snapFocusReturn.focus?.({preventScroll:true});
  cursorSelectionClosed();
}
function snapPoint(event){ const b=snapBounds();return {x:event.clientX-b.left,y:event.clientY-b.top} }
/* Fingers land around a handle, and an edge can be grabbed between its dots.
   Resolve that geometry before deciding an outside drag means a new area. */
function snapHandleAt(p,r,slop){
  if(!r||p.x<r.x-slop||p.x>r.x+r.w+slop||p.y<r.y-slop||p.y>r.y+r.h+slop) return "";
  const horizontal=[["w",Math.abs(p.x-r.x)],["e",Math.abs(p.x-r.x-r.w)]].sort((a,b)=>a[1]-b[1]);
  const vertical=[["n",Math.abs(p.y-r.y)],["s",Math.abs(p.y-r.y-r.h)]].sort((a,b)=>a[1]-b[1]);
  const h=horizontal[0][1]<=slop?horizontal[0][0]:"",v=vertical[0][1]<=slop?vertical[0][0]:"";
  return v+h;
}
snapSel.addEventListener("pointerdown",event=>{
  if(event.button!==0||snapshotExporting||!snapRect||snapBar.contains(event.target)) return;
  event.preventDefault();event.stopPropagation();
  if(snapDrag) return;
  const p=snapPoint(event),handle=event.target.closest?.("[data-h]")?.dataset.h||snapHandleAt(p,snapRect,event.pointerType==="mouse"?10:26);
  const r={...snapRect};
  if(handle) snapDrag={mode:"resize",handle,start:p,r,id:event.pointerId};
  else if(snapBox.contains(event.target)) snapDrag={mode:"move",start:p,r,id:event.pointerId};
  else snapDrag={mode:"draw",start:p,r,prev:r,id:event.pointerId};
  snapSel.setPointerCapture?.(event.pointerId);
});
snapSel.addEventListener("pointermove",event=>{
  if(!snapDrag||event.pointerId!==snapDrag.id) return;
  event.preventDefault();event.stopPropagation();
  const b=snapBounds(),p=snapPoint(event),dx=p.x-snapDrag.start.x,dy=p.y-snapDrag.start.y,r=snapDrag.r;
  const cx=v=>Math.max(0,Math.min(b.w,v)),cy=v=>Math.max(0,Math.min(b.h,v));
  if(snapDrag.mode==="move") snapRect={...r,x:r.x+dx,y:r.y+dy};
  else if(snapDrag.mode==="draw"){
    const x0=cx(snapDrag.start.x),y0=cy(snapDrag.start.y),x1=cx(p.x),y1=cy(p.y);
    snapRect={x:Math.min(x0,x1),y:Math.min(y0,y1),w:Math.abs(x1-x0),h:Math.abs(y1-y0)};
  }else{
    let l=r.x,t=r.y,rt=r.x+r.w,bt=r.y+r.h;const h=snapDrag.handle;
    if(h.includes("w")) l=Math.min(cx(r.x+dx),rt-SNAP_MIN);
    if(h.includes("e")) rt=Math.max(cx(r.x+r.w+dx),l+SNAP_MIN);
    if(h.includes("n")) t=Math.min(cy(r.y+dy),bt-SNAP_MIN);
    if(h.includes("s")) bt=Math.max(cy(r.y+r.h+dy),t+SNAP_MIN);
    snapRect={x:l,y:t,w:rt-l,h:bt-t};
  }
  if(snapDrag.mode!=="draw"||(snapRect.w>=SNAP_MIN&&snapRect.h>=SNAP_MIN)) layoutSnapSel();
});
const endSnapDrag=event=>{
  if(!snapDrag||event.pointerId!==snapDrag.id) return;
  event.stopPropagation();
  /* A click (or a scribble) on the dimmed map keeps the previous selection. */
  if(event.type==="pointercancel") snapRect=snapDrag.r;
  else if(snapDrag.mode==="draw"&&(snapRect.w<SNAP_MIN||snapRect.h<SNAP_MIN)) snapRect=snapDrag.prev;
  snapDrag=null;layoutSnapSel();
};
for(const type of ["pointerup","pointercancel","lostpointercapture"]) snapSel.addEventListener(type,endSnapDrag);
L.DomEvent.disableClickPropagation(snapSel);
snapBox.addEventListener("dblclick",event=>{ event.preventDefault();event.stopPropagation();saveSnapshotSelection() });
/* Zooming stays live while choosing: the wheel and Safari's trackpad pinch are
   handed to the map underneath, and the rectangle stays where it was drawn. */
snapSel.addEventListener("wheel",event=>{
  event.preventDefault();
  $("#map").dispatchEvent(new WheelEvent("wheel",{deltaX:event.deltaX,deltaY:event.deltaY,deltaMode:event.deltaMode,
    ctrlKey:event.ctrlKey,clientX:event.clientX,clientY:event.clientY,bubbles:true,cancelable:true}));
},{passive:false});
for(const type of ["gesturestart","gesturechange","gestureend"]) snapSel.addEventListener(type,event=>{
  event.preventDefault();const forwarded=new Event(type,{bubbles:true,cancelable:true});forwarded.scale=event.scale;$("#map").dispatchEvent(forwarded);
},{passive:false});
snapSel.addEventListener("keydown",event=>{
  if(event.key==="Escape"){ event.preventDefault();if(!snapshotExporting) endSnapshotSelect();return }
  if(event.key==="Enter"&&event.target===snapBox){ event.preventDefault();saveSnapshotSelection();return }
  const step=event.shiftKey?10:1,move={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];
  if(move&&event.target===snapBox){ event.preventDefault();snapRect={...snapRect,x:snapRect.x+move[0],y:snapRect.y+move[1]};layoutSnapSel() }
});
$("#snapSelCancel").onclick=()=>{ if(!snapshotExporting) endSnapshotSelect() };
/* The selection lives inside the map: its buttons must not also count as a
   tap on the ground (that put the spot's coordinates in the search field). */
L.DomEvent.disableClickPropagation(snapBar);
snapSaveBtn.onclick=()=>saveSnapshotSelection();
addEventListener("resize",()=>layoutSnapSel());
map.on("zoomend moveend",()=>layoutSnapSel());
function saveSnapshotSelection(){
  if(snapSel.hidden||!snapRect) return;
  exportSnapshot(()=>clampSnapRect(snapRect));
}
/* Capture: the whole map view at the chosen resolution, straight from the
   panel. It renders from the same tile plan as a selection, so the sidebar
   and buttons floating over the map are never part of the image. */
function captureSnapshotView(){
  if(snapshotExporting||!snapSel.hidden) return;
  snapshotFit3dScale();
  snapshotCursorLocation=cursorLocation?{...cursorLocation}:null;
  setSnapshotPanel(false,true);setSnapshotStatus("",0);
  exportSnapshot(snapshotFullSelection);
}
async function exportSnapshot(selection){
  if(snapshotExporting) return;
  snapshotExporting=true;snapshotEl.disabled=true;layoutSnapSel();snapshotProgressAt=0;
  try{
    /* The save dialog has to open inside the click that asked for it, so a
       large desktop export picks its destination before anything else. */
    const name=snapshotFilename();
    const early=snapshotSpec(selection(),snapshotScale());
    if(!early.ok) throw new Error(snapshotLimitText(early)||"This selection cannot be exported.");
    let sink=null;
    if(snapshotStreamNeeded(early)){
      try{ sink=await snapshotSink(name,SNAPSHOT_DISK) }
      catch(error){ if(error?.name==="AbortError"){ snapshotReport("Save cancelled.",false,5000);return } throw error }
    }
    await snapshotSettled();
    const spec=snapshotSpec(selection(),snapshotScale());
    if(!spec.ok) throw new Error(snapshotLimitText(spec)||"This selection cannot be exported.");
    if($("#snapshotReadout").checked)spec.readout=await createSnapshotReadout(spec);
    snapshotReport(`Preparing ${spec.width.toLocaleString()} × ${spec.height.toLocaleString()}…`,true);
    let result,blob;
    if(sink&&snapshotStreamNeeded(spec)){
      try{ result=await composeSnapshotStream(spec,sink.write);blob=await sink.close() }
      catch(error){ sink.abort();throw error }
    }else{ sink?.abort();result=await composeSnapshot(spec);blob=result.blob }
    snapshotExporting=false;endSnapshotSelect();
    const delivered=blob?await deliverSnapshot(blob,name):(setSnapshotStatus(`Saved ${sink.name} (${spec.width.toLocaleString()} × ${spec.height.toLocaleString()} px).`,8000),true);
    if(delivered&&result.failed) setSnapshotStatus(`Saved; ${result.failed} source tile${result.failed===1?" was":"s were"} unavailable and left blank.`,7000);
  }catch(error){
    if(!snapSel.hidden) setSnapSelMeta(error?.message||"The map could not be saved.",true);
    setSnapshotStatus((error?.message||"Map export could not be completed.")+" Try a lower resolution or a smaller area.",8000);
  }finally{
    snapshotExporting=false;snapshotEl.disabled=false;layoutSnapSel();updateSnapshotPreview();
  }
}

function positionSnapshotPanel(){
  positionToolPopover(snapshotPanel,snapshotEl);
}
function setSnapshotPanel(open,restoreFocus=false){
  if(open){ announceToolPopover(snapshotPanel);snapshotFit3dScale() }
  snapshotPanel.hidden=!open;snapshotEl.setAttribute("aria-expanded",String(open));
  if(open){ updateSnapshotPreview();requestAnimationFrame(positionSnapshotPanel) }
  else if(restoreFocus) snapshotEl.focus({preventScroll:true});
}
window.cspStartSnapshotSelect=startSnapshotSelect;
window.cspOpenSnapshotPanel=()=>setSnapshotPanel(true);
snapshotEl.setAttribute("aria-pressed","false");
snapshotEl.setAttribute("aria-haspopup","dialog");
snapshotEl.setAttribute("aria-controls","snapshotPanel");
snapshotEl.onclick=()=>snapSel.hidden?setSnapshotPanel(snapshotPanel.hidden):endSnapshotSelect();
snapshotEl.addEventListener("click",event=>{
  if(event.detail===0&&!snapshotPanel.hidden)snapshotScaleEl.focus({preventScroll:true});
});
document.addEventListener("pointerdown",event=>{
  if(!snapshotPanel.hidden&&!snapshotPanel.contains(event.target)&&!snapshotEl.contains(event.target)) setSnapshotPanel(false);
});
document.addEventListener("keydown",event=>{
  if(event.key==="Escape"&&!snapshotPanel.hidden){event.preventDefault();setSnapshotPanel(false,true)}
});
snapshotScaleEl.oninput=snapshotScaleEl.onchange=()=>setSnapshotScale(Number(snapshotScaleEl.value));
snapshotCaptureEl.onclick=captureSnapshotView;snapshotSelectEl.onclick=startSnapshotSelect;
$("#snapshotClose").onclick=()=>setSnapshotPanel(false,true);
map.on("moveend",()=>{ if(!snapshotExporting) updateSnapshotPreview() });
L.DomEvent.disableClickPropagation(snapshotPanel);L.DomEvent.disableScrollPropagation(snapshotPanel);

/* ------------------------------------------------- surrounding-scene mosaic */
let NEIGH=[];            // [{key, item, layer}]
let CAND={};             // geometry-aware patch key -> [quality-ranked candidates]
let mosTimer=null;
let mosToken=0, mosAbort=null;
let MOSAIC_BACKDROP=null;
const PENDING_NEIGH=new Set();
const tjCache=new Map();
const mosaicCatalogCache=new Map();
const PROVIDER_HEALTH=new Map();

function recordProviderOutcome(key,ms,ok){
  if(!key) return;
  const h=PROVIDER_HEALTH.get(key)||{ema:null,ok:0,fail:0,streak:0,cooldown:0};
  const t=Math.max(1,Number(ms)||1);
  h.ema=h.ema==null?t:h.ema*.72+t*.28;
  if(ok){ h.ok++; h.streak=0; h.cooldown=0 }
  else { h.fail++; h.streak++; if(h.streak>=2) h.cooldown=Date.now()+30000*Math.min(4,h.streak-1) }
  PROVIDER_HEALTH.set(key,h);
}
function providerPenalty(key){
  const h=PROVIDER_HEALTH.get(key);
  if(!h) return ({es:0,pc:1,nisar:2}[key]??3);
  return (h.cooldown>Date.now()?10000:0)+(h.ema||1200)/1000+h.fail/Math.max(1,h.ok+h.fail)*8;
}

/* Planetary Computer's HLS tilejson asks titiler for raw B04/B03/B02 with a
   gamma curve and no `rescale`. HLS surface reflectance is int16 scaled by
   10000 and land sits around 500-3000, so with no stretch the scene comes back
   dark and muddy. Supply the stretch the provider omits. */
/* Sentinel-2 reaches us two ways for the same collection id. AWS Earth Search
   offers a "visual" asset — TCI, already 8-bit natural color, which is what
   the primary scene usually is. The Planetary Computer's tiler instead serves
   the raw bands, and asked for B04/B03/B02 with no color formula it stretches
   each scene by itself: one comes back near-black, the next violet, the next
   olive. That is the mosaic going strange colors and staying black, and it
   only showed on neighbours because the primary came from the other provider.
   Give the raw-band request the natural-color formula the Planetary Computer
   documents for this collection. Not a rescale as well — with both, the tile
   blows out to white. */
const MPC_NATURAL = "gamma RGB 3.2 saturation 0.8 sigmoidal RGB 25 0.35";
function tuneTileUrl(url, it){
  if(!url) return url;
  if(/planetarycomputer\.microsoft\.com/.test(url) && /[?&]assets=B\d/i.test(url)
     && !/[?&]color_formula=/.test(url))
    url += "&color_formula=" + encodeURIComponent(MPC_NATURAL);
  if(!/^hls2-/.test(it.coll||"") || /[?&]rescale=/.test(url)) return url;
  const softer = encodeURIComponent("gamma RGB 1.4, saturation 1.3");
  return (/[?&]color_formula=/.test(url)
            ? url.replace(/([?&]color_formula=)[^&]*/, "$1"+softer)
            : url) + "&rescale=0,3000";
}

async function tileUrl(it,signal){
  if(!it.tiles) return null;
  if(it.tiles.type!=="tilejson"){
    const direct=sharpSceneUrl(tuneTileUrl(it.tiles.url,it));
    if(!/^https?:\/\//i.test(direct||"")) throw new Error("unsupported tile URL");
    return direct;
  }
  const cached=tjCache.get(it.tiles.url);
  if(cached&&Date.now()-cached.at<30*60*1000) return cached.value;
  const controller=new AbortController(), abort=()=>controller.abort();
  if(signal){
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    signal.addEventListener("abort",abort,{once:true});
  }
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const r=await fetch(it.tiles.url,{signal:controller.signal});
    if(!r.ok) throw new Error(`tile metadata HTTP ${r.status}`);
    const tj=await r.json(), raw=tj&&Array.isArray(tj.tiles)&&tj.tiles[0];
    const value=sharpSceneUrl(tuneTileUrl(raw,it));
    if(!/^https?:\/\//i.test(value||"")) throw new Error("tile metadata has no usable URL");
    tjCache.set(it.tiles.url,{value,at:Date.now()});
    while(tjCache.size>64) tjCache.delete(tjCache.keys().next().value);
    return value;
  }finally{
    clearTimeout(timer);
    if(signal) signal.removeEventListener("abort",abort);
  }
}

function itemLeafletBounds(it){
  const b=it&&it.bbox;
  return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<=b[2]
    ? L.latLngBounds([b[1],b[0]],[b[3],b[2]]) : null;
}
function imageryNativeZoom(it){
  /* Number(null) is 0. Most STAC scenes intentionally leave nativeMax null
     and describe their detail with gsd; treating that null as z0 turns the
     entire planet into one blurry square stretched over the scene footprint. */
  const rawNative=it&&it.nativeMax;
  const given=rawNative==null||rawNative==="" ? NaN : Number(rawNative);
  const gsd=Number(it&&it.gsd);
  return Number.isFinite(given)
    ? given : Number.isFinite(gsd)&&gsd>0 ? Math.max(6,Math.min(20,Math.ceil(Math.log2(156543.03392/gsd)))) : 19;
}
function imageryLayerOptions(it,extra){
  const bounds=itemLeafletBounds(it), o={...IMG_TILE_OPTS,...(extra||{})};
  if(bounds){ o.bounds=bounds; o.noWrap=true }
  o.maxNativeZoom=imageryNativeZoom(it);
  o.maxZoom=VIEW_MAX;
  return o;
}

/* a stable id for "the same patch of ground" across dates and providers */
/* Fraction of the visible map a scene's footprint covers. Neighbours were
   taken in whatever order Object.keys produced and then cut to a fixed count,
   so the scene filling the gap you were looking at could be dropped in favour
   of one barely clipping the corner. */
function viewOverlap(it, vb){
  if(!it || !it.bbox) return 0;
  const [w,s,e,n]=it.bbox;
  const iw=Math.max(0, Math.min(e,vb.getEast())  - Math.max(w,vb.getWest()));
  const ih=Math.max(0, Math.min(n,vb.getNorth()) - Math.max(s,vb.getSouth()));
  const va=(vb.getEast()-vb.getWest())*(vb.getNorth()-vb.getSouth());
  return va>0 ? (iw*ih)/va : 0;
}

function footprintKey(it){
  return CSPMosaic.footprintBase(it);
}
const patchKey=it=>CSPMosaic.patchKey(it);
const productKey=it=>CSPMosaic.productKey(it);

async function stacBbox(src,coll,bbox,win,cloudMax,signal){
  const ck=[src.key,coll,win&&win.stac||"all"].join("|");
  const hit=mosaicCatalogCache.get(ck);
  if(hit&&Date.now()-hit.at<3*60*1000&&CSPMosaic.bboxContains(hit.bbox,bbox))
    return hit.items.filter(x=>x.cloud==null||x.cloud<=cloudMax);
  const body={collections:[coll],bbox,limit:160,
              sortby:[{field:"properties.datetime",direction:"desc"}]};
  if(win && win.stac) body.datetime=win.stac;
  const started=performance.now(), requestController=new AbortController();
  let timedOut=false;
  const abort=()=>requestController.abort();
  if(signal){
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    signal.addEventListener("abort",abort,{once:true});
  }
  const timer=setTimeout(()=>{ timedOut=true; requestController.abort() },6500);
  try{
    const r=await fetch(src.api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:requestController.signal});
    if(!r.ok) throw new Error(src.name+" "+r.status);
    const items=((await r.json()).features||[]).map(f=>norm(f,src)).filter(Boolean);
    mosaicCatalogCache.set(ck,{bbox:bbox.slice(),items,at:Date.now()});
    while(mosaicCatalogCache.size>24) mosaicCatalogCache.delete(mosaicCatalogCache.keys().next().value);
    recordProviderOutcome(src.key,performance.now()-started,true);
    return items.filter(x=>x.cloud==null||x.cloud<=cloudMax);
  }catch(e){
    if(signal&&signal.aborted) throw new DOMException("Aborted","AbortError");
    recordProviderOutcome(src.key,performance.now()-started,false);
    if(timedOut) throw new Error(src.name+" catalog timed out");
    throw e;
  }finally{
    clearTimeout(timer);
    if(signal) signal.removeEventListener("abort",abort);
  }
}

function cancelPendingNeighbours(){
  for(const layer of [...PENDING_NEIGH]){
    if(layer._cspCancelWait) layer._cspCancelWait();
    if(map.hasLayer(layer)) map.removeLayer(layer);
  }
  PENDING_NEIGH.clear();
}
function clearMosaic(cancel=true){
  if(cancel){ MOSAIC_ONCE=false; mosToken++; if(mosAbort){ mosAbort.abort(); mosAbort=null } }
  cancelPendingNeighbours();
  NEIGH.forEach(n=>{ if(n.layer) map.removeLayer(n.layer) });
  NEIGH=[];
  if(MOSAIC_BACKDROP&&MOSAIC_BACKDROP.layer) map.removeLayer(MOSAIC_BACKDROP.layer);
  MOSAIC_BACKDROP=null;
}

/* Whether the mosaic is live. It used to be tied to the checkbox alone, so a
   fill started from the button never refreshed when the map moved: you got
   whatever happened to be adjacent at the moment you pressed it and bare
   basemap everywhere you panned afterwards. */
let MOSAIC_ON=false, MOSAIC_ONCE=false;

/* The viewport as a coarse grid, so "is the view actually filled?" is a
   countable question rather than a guess from bounding-box overlap. */
function coverGrid(vb, G){
  return CSPMosaic.makeCoverageGrid({w:vb.getWest(),s:vb.getSouth(),e:vb.getEast(),n:vb.getNorth()},G);
}
const cellsGained=(cov,it,mark)=>CSPMosaic.cellsGained(cov,it,mark);
const coveredFrac=cov=>CSPMosaic.coveredFraction(cov);

function qualitySort(primary){
  const t0=+new Date(primary.date), psrc=primary.srcKey;
  const tier=it=>it.cloud==null?2:it.cloud<15?0:it.cloud<30?1:it.cloud<50?2:3;
  return (a,b)=>tier(a)-tier(b)
    || Math.abs(+new Date(a.date)-t0)-Math.abs(+new Date(b.date)-t0)
    || (a.cloud??50)-(b.cloud??50)
    || (a.srcKey===psrc?0:1)-(b.srcKey===psrc?0:1)
    || providerPenalty(a.srcKey)-providerPenalty(b.srcKey);
}

function groupMosaicCandidates(found,primary){
  CAND={}; const seen=new Set();
  for(const it of [primary,...found]){
    if(!it||!it.tiles||it.coll!==primary.coll) continue;
    const signature=patchKey(it)+"|"+productKey(it)+"|"+it.srcKey;
    if(seen.has(signature)) continue; seen.add(signature);
    (CAND[patchKey(it)] ||= []).push(it);
  }
  const sorter=qualitySort(primary);
  Object.values(CAND).forEach(list=>list.sort(sorter));
}

function possibleCoverage(primary,items,vb){
  const cov=coverGrid(vb,28); cellsGained(cov,primary,true);
  for(const it of items) cellsGained(cov,it,true);
  return coveredFrac(cov);
}

function overviewItem(primary){
  if(!primary||primary.vis!=="rgb") return null;
  const g=GIBS.find(x=>x.id==="MODIS_Terra_CorrectedReflectance_TrueColor")||GIBS.find(x=>x.vis==="rgb");
  if(!g) return null;
  const ds=String(primary.date||new Date().toISOString()).slice(0,10), tms=g.tms||"GoogleMapsCompatible_Level9";
  return {id:`mosaic-context/${g.id}/${ds}`,src:"NASA GIBS (global context)",srcKey:"gibs",props:{},
    coll:g.id,label:g.label,kind:"Optical context",vis:"rgb",gsd:g.gsd,date:ds+"T12:00:00Z",cloud:null,
    tiles:{type:"xyz",url:`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${g.id}/default/${ds}/${tms}/{z}/{y}/{x}.jpg`},
    bbox:null,geom:null,nativeMax:+((tms.match(/Level(\d+)/)||[])[1]||9)};
}

function mosaicBudget(primary){
  const z=map.getZoom(),mpp=CSPMosaic.metersPerPixel(map.getCenter().lat,z);
  if(primary.vis==="rgb"&&primary.gsd&&mpp>primary.gsd*18) return 0;
  return z>=13?12:z>=11?10:8;
}

async function ensureMosaicBackdrop(primary,token){
  const item=overviewItem(primary); if(!item) return false;
  if(MOSAIC_BACKDROP&&MOSAIC_BACKDROP.item.id===item.id) return true;
  let layer=null;
  try{
    const url=await tileUrl(item,mosAbort&&mosAbort.signal);
    if(token!==mosToken) return false;
    layer=resilientLayer(url,imageryLayerOptions(item,{opacity:+$("#op").value/100,maxZoom:VIEW_MAX,
      maxNativeZoom:item.nativeMax,zIndex:110,keepBuffer:1,tileRetries:1,className:"mosaic-context"}));
    const result=await waitForLayerTiles(layer,token,6500);
    if(!result.ready||token!==mosToken){ if(map.hasLayer(layer)) map.removeLayer(layer); return false }
    const old=MOSAIC_BACKDROP; MOSAIC_BACKDROP={item,layer}; layer.setZIndex(110);layer.setOpacity(+$("#op").value/100);
    if(old&&old.layer&&map.hasLayer(old.layer)) map.removeLayer(old.layer);
    return true;
  }catch(e){ if(layer&&map.hasLayer(layer)) map.removeLayer(layer); return false }
}

async function fillMosaic(primary, force){
  if(force&&!MOSAIC_ON) MOSAIC_ONCE=true;
  const token=++mosToken;
  if(mosAbort) mosAbort.abort();
  cancelPendingNeighbours();
  const controller=new AbortController(); mosAbort=controller;
  const stat=$("#mosStat");
  /* force is one run for the button; only the checkbox enables continuous fill. */
  if((!force&&!MOSAIC_ON&&!MOSAIC_ONCE) || !primary || !primary.tiles || primary.srcKey==="gibs"){
    clearMosaic(false); mosAbort=null;
    if(!MOSAIC_ON) MOSAIC_ONCE=false;
    if(stat) stat.textContent = primary && primary.srcKey==="gibs"
      ? "Global layer \u2014 already covers the whole view." : "";
    return;
  }
  if(stat) stat.innerHTML='<span class="spin"></span> building best available coverage\u2026';

  const budget=mosaicBudget(primary);
  if(budget===0){
    const ok=await ensureMosaicBackdrop(primary,token);
    if(token!==mosToken) return;
    mosAbort=null;
    if(!MOSAIC_ON) MOSAIC_ONCE=false;
    NEIGH.forEach(n=>map.removeLayer(n.layer)); NEIGH=[];
    if(stat) stat.textContent=ok
      ? `Complete ${res(overviewItem(primary).gsd)} context · zoom in for ${res(primary.gsd)} ${primary.label} detail.`
      : "High-resolution scenes exceed screen detail here; zoom in to assemble them.";
    return;
  }

  const vb=map.getBounds();
  const found=await findMosaicCandidates(primary,vb,controller.signal);
  if(!found||token!==mosToken) return;
  groupMosaicCandidates(found,primary);
  const {use,cov}=chooseMosaicPatches(primary,vb,budget);
  let backdropPromise=coveredFrac(cov)<0.995
    ? ensureMosaicBackdrop(primary,token) : Promise.resolve(false);
  if(!await publishNeighbours(use,token)) return;
  mosAbort=null;
  const {filled,renderPct,tilesPending}=mosaicCoverage(primary,vb);
  if((filled<99||renderPct<98||tilesPending)&&!MOSAIC_BACKDROP)
    backdropPromise=ensureMosaicBackdrop(primary,token);
  let backdrop=(await backdropPromise)||!!MOSAIC_BACKDROP;
  if(token!==mosToken) return;
  if(!MOSAIC_ON) MOSAIC_ONCE=false;
  if(stat) stat.textContent=mosaicStatus(NEIGH.length,filled,renderPct,backdrop);
}
/* Scenes of the primary's collection that could fill the view: those the
   search already found, then each catalogue in turn until the view could be
   covered. Null when the fill was cancelled. */
async function findMosaicCandidates(primary,vb,signal){
  const b=vb.pad(0.65);
  const bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
  const searchBoxes=CSPMosaic.splitBbox(bbox);
  const srcs=SOURCES.filter(s=>s.key!=="cdse" && s.colls.includes(primary.coll));
  srcs.sort((a,b)=>(a.key===primary.srcKey?-100:providerPenalty(a.key))
                    -(b.key===primary.srcKey?-100:providerPenalty(b.key)));

  let found=ITEMS.filter(it=>it&&it.tiles&&it.coll===primary.coll&&it!==primary&&viewOverlap(it,b)>0);
  try{
    // Neighbours normally need a wider net than the primary search, but a named
    // range is era-specific: honour it so the mosaic doesn't mix in recent scenes.
    const mw=dateWindow(), bw = mw.mode==="abs" ? mw : relWindow(540);
    const cloudMax=+$("#cloud").value;
    for(const src of possibleCoverage(primary,found,vb)>=0.995 ? [] : srcs){
      let got=[];
      try{ got=(await Promise.all(searchBoxes.map(box=>
        stacBbox(src,primary.coll,box,bw,cloudMax,signal)))).flat() }
      catch(e){ if(e.name==="AbortError") throw e }
      found.push(...got);
      if(possibleCoverage(primary,found,vb)>=0.995) break; // stop after the fastest sufficient catalog
    }
  }catch(e){ if(e.name==="AbortError") return null }
  return found;
}
/* Fill the view, rather than collecting whatever overlaps it. Ranking by
   overlap and taking the top N says nothing about whether the result covers
   anything: two scenes can both score highly and sit on top of each other,
   leaving the same hole. Mark off what the primary already covers, then
   repeatedly take whichever candidate closes the most of what is still open,
   and stop once the view is full or the next one would barely help. */
function chooseMosaicPatches(primary,vb,budget){
  const pk=patchKey(primary);
  const keys=Object.keys(CAND).filter(k=>k!==pk);
  const cov=coverGrid(vb,32);
  cellsGained(cov,primary,true);
  const pool=keys.filter(k=>CAND[k][0]);
  const use=[];
  while(use.length<budget && coveredFrac(cov)<0.995){
    let best=null, bestGain=0;
    for(const k of pool){
      if(use.includes(k)) continue;
      const g=cellsGained(cov,CAND[k][0],false);
      if(g>bestGain){ bestGain=g; best=k }
    }
    if(!best || bestGain < cov.G*cov.G*0.004) break;   // under 0.4% of the view
    cellsGained(cov,CAND[best][0],true);
    use.push(best);
  }
  return {use,cov};
}
/* Stage replacements before removing good layers, so a failed candidate
   cannot punch a hole in a previously useful mosaic. False when a newer fill
   has taken over. */
async function publishNeighbours(use,token){
  const want=new Map(use.map(k=>[k, CAND[k][0]]));
  const existing=new Map(NEIGH.map(n=>[n.key,n])), additions=[];
  for(const [k,it] of want){
    const old=existing.get(k);
    if(!old||productKey(old.item)!==productKey(it)||old.item.srcKey!==it.srcKey) additions.push([k,it]);
  }
  const staged=await pooled(additions,3,([k,it])=>loadNeighbour(k,it,token));
  if(token!==mosToken){for(const nb of staged.filter(Boolean))if(map.hasLayer(nb.layer))map.removeLayer(nb.layer);return false;}
  for(const nb of staged.filter(Boolean)){
    const old=NEIGH.find(x=>x.key===nb.key);
    if(old&&map.hasLayer(old.layer)) map.removeLayer(old.layer);
    nb.layer.setOpacity(+$("#op").value/100);
    NEIGH=NEIGH.filter(x=>x!==old); NEIGH.push(nb);
  }
  for(const old of NEIGH.slice()) if(staged.every(Boolean)&&!want.has(old.key)){
    map.removeLayer(old.layer); NEIGH=NEIGH.filter(x=>x!==old);
  }
  return true;
}
/* How much of the view the published scenes cover, and how much of it has drawn. */
function mosaicCoverage(primary,vb){
  const actual=coverGrid(vb,32); cellsGained(actual,primary,true);
  NEIGH.forEach(n=>cellsGained(actual,n.item,true));
  const filled=Math.round(coveredFrac(actual)*100);
  const stats=[layerHealth(overlay),...NEIGH.map(n=>layerHealth(n.layer))].filter(Boolean);
  const rendered=stats.reduce((n,s)=>n+(s.loaded||0),0);
  const expected=stats.reduce((n,s)=>n+(s.expected||s.total||0),0);
  return {filled,renderPct:expected?Math.round(rendered/expected*100):100,tilesPending:stats.some(s=>s.pending)};
}
function mosaicStatus(n,filled,renderPct,backdrop){
  return n
    ? `${n} high-res scene${n>1?"s":""} · ${filled}% footprint${renderPct<100?` · ${renderPct}% visible tiles rendered`:""}${backdrop?" · MODIS context protects gaps":""} — right-click to swap.`
    : (filled>=99 ? "Primary scene already covers the view."
                  : backdrop ? "Global context fills the view; no compatible high-res neighbours were needed."
                             : "No compatible neighbouring scenes are available for the gaps.");
}

function waitForLayerTiles(layer,token,timeout=8000){
  return new Promise(resolve=>{
    let loaded=0, errors=0, finished=false, timer=null;
    const done=()=>{
      if(finished) return; finished=true; if(timer) clearTimeout(timer);
      layer.off("tileload",onLoad); layer.off("tileerror",onError); layer.off("load",onComplete);
      layer._cspCancelWait=null; PENDING_NEIGH.delete(layer);
      const total=loaded+errors, expected=Math.max(total,Object.keys(layer._tiles||{}).length);
      const ratio=expected?loaded/expected:0, settled=expected?total/expected:0;
      resolve({ready:loaded>0&&ratio>=0.9&&settled>=0.9,loaded,errors,total,expected,ratio,settled});
    };
    const onLoad=()=>{ loaded++ };
    const onError=()=>{ errors++ };
    const onComplete=done;
    layer.on("tileload",onLoad); layer.on("tileerror",onError); layer.on("load",onComplete);
    layer._cspCancelWait=done; PENDING_NEIGH.add(layer);
    timer=setTimeout(done,timeout);
    layer.setOpacity(0);layer.addTo(map);
    if(token!=null&&token!==mosToken) done();
  });
}

async function pooled(items,limit,fn){
  const out=new Array(items.length); let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(next<items.length){ const i=next++; out[i]=await fn(items[i],i) }
  }));
  return out;
}

async function loadNeighbour(key,it,token,exact=false){
  const candidates=[it,...(exact?[]:CAND[key]||[])].filter((v,i,a)=>v&&a.findIndex(x=>x.id===v.id&&x.srcKey===v.srcKey)===i).slice(0,4);
  for(const candidate of candidates){
    if(token!=null&&token!==mosToken)return null;
    let layer=null,started=performance.now();
    try{
      const url=await tileUrl(candidate,mosAbort&&mosAbort.signal); if(!url) continue;
      if(token!=null&&token!==mosToken) return false;
      layer=resilientLayer(url,imageryLayerOptions(candidate,{keepBuffer:0,updateWhenIdle:true,tileRetries:1,
        opacity:+$("#op").value/100,maxZoom:VIEW_MAX,zIndex:200,className:"nb"}));
      trackLayerHealth(layer);
      const result=await waitForLayerTiles(layer,token);
      if(!result.ready||(token!=null&&token!==mosToken)){
        recordProviderOutcome(candidate.srcKey,performance.now()-started,false);
        if(map.hasLayer(layer)) map.removeLayer(layer); continue;
      }
      recordProviderOutcome(candidate.srcKey,performance.now()-started,true);
      const list=CAND[key]||[];
      CAND[key]=[candidate,...list.filter(x=>x!==candidate)];
      return {key,item:candidate,layer,stats:result};
    }catch(e){ recordProviderOutcome(candidate.srcKey,performance.now()-started,false);
      if(layer&&map.hasLayer(layer)) map.removeLayer(layer) }
  }
  return null;
}

async function swapNeighbour(key, it){
  const n=NEIGH.find(x=>x.key===key);
  const next=await loadNeighbour(key,it,mosToken);
  if(!next) return;
  next.layer.setOpacity(+$("#op").value/100);
  if(n&&map.hasLayer(n.layer)) map.removeLayer(n.layer);
  NEIGH=NEIGH.filter(x=>x!==n); NEIGH.push(next);
}

