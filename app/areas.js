/* ---------------- pre-cache the current area (works offline afterwards) --- */
let warmPoll=null, warmStatusPath="/api/warm/status";
function fmtMB(b){ return b>1e9 ? (b/1e9).toFixed(2)+" GB" : (b/1e6).toFixed(1)+" MB" }

function warmTileEstimate(b, z0, z1){
  let n=0;
  for(let z=z0; z<=z1; z++){
    const N=Math.pow(2,z);
    const xt=lon=>Math.floor((lon+180)/360*N);
    const yt=lat=>Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*N);
    n += (Math.abs(xt(b.getEast())-xt(b.getWest()))+1) * (Math.abs(yt(b.getSouth())-yt(b.getNorth()))+1);
  }
  return n;
}

/* Ground resolution of a web-mercator tile pixel, in metres, at a latitude.
   Native WA DNR lidar measured 2026-08-19: Rainier Wali 2022 resolves to
   ~1.07 m/px, Rainier 2007 to better than 0.53 m/px. z18 (0.41 m/px at 47N)
   clears both; z19 leaves headroom. The old +2/z17 cap sat at 0.82 m/px and
   was quietly throwing away detail on the sharper projects.               */
const MPP = (z,lat)=> 156543.03392 * Math.cos(lat*Math.PI/180) / Math.pow(2,z);
const WARM_SPAN=3;      /* how many levels above the target to also keep */
const WARM_WARN=8000, WARM_MAX=40000;

function warmLevelRange(b,zNow,z1){
  const z0=Math.max(1,Math.min(zNow,z1),z1-WARM_SPAN);
  return {z0,z1,tiles:warmTileEstimate(b,z0,z1)};
}
function warmPlan(){
  let b=map.getBounds();
  const pad={view:0, pad50:0.25, pad100:0.5}[$("#terExtent").value] || 0;
  if(pad>0) b=b.pad(pad);
  /* Zoom is fractional now, but everything downstream of here builds whole tile
     coordinates for the pre-cache, so round at the boundary. */
  const zNow=Math.round(map.getZoom()), mode=$("#terDepth").value,style=$("#terStyle").value;
  const nativeCeiling=chooseTerrain(style).src==="3dep"?17:18;
  const requestedZ1=Math.min(nativeCeiling,mode==="screen"?zNow+2:nativeCeiling);
  let range=warmLevelRange(b,zNow,requestedZ1);
  /* Only the finest few levels are worth downloading: they are where the
     detail is, and coarser ones are cheap and usually already cached from
     browsing. Without this, "Native" from a zoomed-out view planned
     millions of tiles and always tripped the guard. A broad-area native
     request now becomes the sharpest safe first pass; zooming closer raises
     the cap automatically until the source-native level is reached.       */
  while(range.tiles>WARM_MAX && range.z1>1){
    range=warmLevelRange(b,zNow,range.z1-1);
  }
  const lat=map.getCenter().lat;
  return {b, ...range, zNow, requestedZ1, limited:range.z1<requestedZ1,
          mpp:MPP(range.z1,lat)};
}
const TILE_BYTES = 18000;               // measured average across z13-z19
function warmPreview(){
  const el=$("#terWarmMsg"); if(!el || warmPoll) return;
  if(!PROXY || $("#terStyle").value==="off") return;
  const p=warmPlan();
  const size=fmtMB(p.tiles*TILE_BYTES);
  $("#terWarm").textContent=p.limited?"Download broad-area pass":"Download this view";
  el.innerHTML=(p.limited?`Broad-area pass \u00b7 `:"")
    + `z${p.z0}\u2013${p.z1} \u00b7 ${(p.mpp*3.28084).toFixed(2)} ft/px \u00b7 `
    + `${p.tiles.toLocaleString()} tiles \u00b7 ~${size}`
    + (p.limited ? ` <span class="ok">\u2014 native z${p.requestedZ1} unlocks as you zoom in</span>` : "")
    + (!p.limited&&p.tiles>WARM_WARN ? ` <span class="warn">\u2014 large</span>` : "");
}

/* ---- WA DNR fetched areas: explicit, map-anchored selection ------------- */
let dnrSelRect=null,dnrSelHandles=[],dnrSelBbox=null,dnrAreaLayer=null,dnrFetchPoll=null,dnrFetchToken=0;
let dnrBusy=false,dnrLargeApproved=false,dnrSuccessTimer=null,dnrJobId=null,dnrPositionFrame=0;
let dnrDownloadBbox=null,dnrBackground=false,dnrPollNow=null,dnrStartUncertain=false;
const dnrBar=$("#dnrSelectionBar"),dnrMoveBox=document.createElement("div");
dnrMoveBox.className="dnr-move-box";dnrMoveBox.hidden=true;dnrMoveBox.tabIndex=0;
dnrMoveBox.setAttribute("role","group");
dnrMoveBox.setAttribute("aria-label","WA DNR selected area. Drag to move, drag corners to resize. Arrow keys move; Escape cancels.");
map.getContainer().append(dnrMoveBox);
function dnrMsg(text,state="selecting",announce=true,shortText){
  const summary=state==="ready"?`WA DNR ready in ${dnrAreas.length} area${dnrAreas.length===1?"":"s"}`:
    !dnrBackground&&state==="selecting"?"Area selected on map":text;
  if($("#dnrAreaMsg").textContent!==summary)$("#dnrAreaMsg").textContent=summary;
  $("#dnrSelectionMsg").textContent=text;dnrBar.dataset.state=state;
  const labels={loading:"WA DNR · downloading…",warning:"WA DNR · confirm area",error:"WA DNR · needs attention",ready:"WA DNR · ready",cancelled:"WA DNR · cancelled"};
  $("#dnrDownloadSummary").textContent=shortText||labels[state]||"WA DNR download";
  $("#dnrDownloadToggle").title=text;
  if(announce&&$("#dnrAnnouncement").textContent!==text)$("#dnrAnnouncement").textContent=text;
  scheduleDnrPosition();
}
function expandDnrDownload(expanded){
  $("#dnrSelectionDetails").hidden=dnrBackground&&!expanded;
  $("#dnrDownloadToggle").setAttribute("aria-expanded",String(expanded));
  dnrBar.dataset.expanded=String(expanded);scheduleDnrPosition();
}
function showDnrDownload(expanded=false){
  dnrBackground=true;dnrBar.dataset.background="true";dnrBar.hidden=false;
  dnrBar.setAttribute("aria-label","WA DNR download");
  $("#dnrDownloadToggle").hidden=false;$("#dnrPanelTitle").textContent="WA DNR download";
  expandDnrDownload(expanded);
}
$("#dnrDownloadToggle").onclick=()=>expandDnrDownload($("#dnrSelectionDetails").hidden);
function scheduleDnrPosition(){
  if(dnrPositionFrame)return;
  dnrPositionFrame=requestAnimationFrame(()=>{dnrPositionFrame=0;positionDnrSelection()});
}
function paintDnrAvailability(){
  const select=$("#dnrSelect");if(!select)return;
  select.disabled=!PROXY||dnrBusy;
  $("#dnrViewport").disabled=!PROXY||dnrBusy;
  $("#dnrEngineHint").textContent=!PROXY?"Connect the local terrain engine to download WA DNR LiDAR.":"";
}
function paintDnrAreas(){
  if(dnrAreaLayer)map.removeLayer(dnrAreaLayer);
  dnrAreaLayer=L.layerGroup(dnrAreas.map(a=>L.rectangle([[a.bbox[1],a.bbox[0]],[a.bbox[3],a.bbox[2]]],
    {color:"#0a84ff",weight:1,fillOpacity:.04,interactive:false}))).addTo(map);
  $("#dnrAreaMsg").textContent=dnrAreas.length?`WA DNR ready in ${dnrAreas.length} area${dnrAreas.length>1?"s":""}`:"No downloaded areas";
  $("#dnrClear").hidden=!dnrAreas.length;paintDnrAvailability();
}
function positionDnrSelection(){
  if(dnrBar.hidden)return;
  const mr=map.getContainer().getBoundingClientRect();
  if(dnrBackground){
    // A collapsed status chip sits beside the toolbar, away from selection and
    // camera gestures. Its details expand only when requested or confirming.
    const br=dnrBar.getBoundingClientRect(),dock=$("#mapDock").getBoundingClientRect();
    const left=Math.max(mr.left+10,Math.min(mr.right-br.width-10,dock.left-br.width-10));
    Object.assign(dnrBar.style,{left:left+"px",top:Math.max(mr.top+10,dock.top)+"px"});
    return;
  }
  let anchor={x:mr.width/2,y:mr.height/2};
  if(dnrSelBbox){
    const points=dnrCorners(dnrSelBbox).map(ll=>map.latLngToContainerPoint(ll));
    anchor=points[1];
    const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));
    const width=Math.max(...points.map(p=>p.x))-left,height=Math.max(...points.map(p=>p.y))-top;
    Object.assign(dnrMoveBox.style,{left:left+"px",top:top+"px",width:width+"px",height:height+"px",
      clipPath:`polygon(${points.map(p=>`${p.x-left}px ${p.y-top}px`).join(",")})`});
  }
  const br=dnrBar.getBoundingClientRect(),sr=$("#side").getBoundingClientRect();
  const portrait=matchMedia("(max-width:760px) and (orientation:portrait)").matches;
  const bottom=portrait&&sr.top>mr.top?Math.min(mr.bottom,sr.top)-10:mr.bottom-10;
  const visibleLeft=!portrait&&!document.body.classList.contains("collapsed")?Math.max(mr.left,sr.right):mr.left;
  const left=Math.max(visibleLeft+10,Math.min(mr.right-br.width-10,mr.left+anchor.x-br.width));
  let top=mr.top+anchor.y+10;
  if(top+br.height>bottom)top=mr.top+anchor.y-br.height-10;
  top=Math.max(mr.top+10,Math.min(bottom-br.height,top));
  Object.assign(dnrBar.style,{left:left+"px",top:top+"px"});
}
function clearDnrSelection({keepBar=false}={}){
  if(dnrSelRect)map.removeLayer(dnrSelRect);dnrSelRect=null;dnrSelBbox=null;
  for(const h of dnrSelHandles)map.removeLayer(h);dnrSelHandles=[];
  dnrMoveBox.hidden=true;$("#dnrFetch").disabled=true;
  if(!keepBar)dnrBar.hidden=true;
  dnrLargeApproved=false;document.body.classList.remove("dnr-selecting");
}
function dnrCorners(b){return [[b[1],b[0]],[b[1],b[2]],[b[3],b[2]],[b[3],b[0]]]}
function updateDnrBounds(bbox,{announce=true}={}){
  dnrSelBbox=bbox;dnrDownloadBbox=null;dnrLargeApproved=false;
  dnrSelRect.setBounds([[bbox[1],bbox[0]],[bbox[3],bbox[2]]]);
  dnrCorners(bbox).forEach((ll,i)=>dnrSelHandles[i]?.setLatLng(ll));
  $("#dnrFetch").textContent="Download WA DNR";
  dnrMsg(`${Math.abs(bbox[2]-bbox[0]).toFixed(3)}° × ${Math.abs(bbox[3]-bbox[1]).toFixed(3)}° · Drag to move; drag a corner to resize.`,"selecting",announce);
}
function setDnrBusy(busy){
  dnrBusy=busy;$("#dnrFetch").disabled=busy;$("#dnrCancel").disabled=false;$("#dnrClear").disabled=busy;
  for(const handle of dnrSelHandles) busy?handle.dragging.disable():handle.dragging.enable();
  dnrMoveBox.setAttribute("aria-disabled",String(busy));paintDnrAvailability();
}
function setDnrSelection(bbox){
  clearTimeout(dnrSuccessTimer);dnrBackground=false;dnrDownloadBbox=null;
  dnrBar.dataset.background="false";dnrBar.setAttribute("aria-label","Download selected WA DNR area");
  $("#dnrDownloadToggle").hidden=true;$("#dnrSelectionDetails").hidden=false;
  $("#dnrPanelTitle").textContent="WA DNR area";$("#dnrDownloadProgress").hidden=true;
  dnrBar.hidden=false;$("#dnrFetch").hidden=false;$("#dnrCancel").textContent="Cancel";
  if(!dnrSelRect)dnrSelRect=L.rectangle([[bbox[1],bbox[0]],[bbox[3],bbox[2]]],
    {color:"#ff9f0a",weight:2,fillOpacity:.05,interactive:false}).addTo(map);
  for(const h of dnrSelHandles)map.removeLayer(h);dnrSelHandles=[];
  dnrSelBbox=bbox;
  dnrCorners(bbox).forEach((ll,i)=>{
    const marker=L.marker(ll,{draggable:true,interactive:true,keyboard:true,
      title:"Drag to resize WA DNR area",icon:L.divIcon({className:"dnr-handle",iconSize:[44,44],iconAnchor:[22,22]})}).addTo(map);
    marker.on("drag",()=>{
      const p=marker.getLatLng(),b=[...dnrSelBbox];
      if(i===0){b[0]=p.lng;b[1]=p.lat}if(i===1){b[2]=p.lng;b[1]=p.lat}
      if(i===2){b[2]=p.lng;b[3]=p.lat}if(i===3){b[0]=p.lng;b[3]=p.lat}
      if(b[0]<b[2]&&b[1]<b[3])updateDnrBounds(b,{announce:false});
    });
    marker.on("dragend",()=>updateDnrBounds(dnrSelBbox));dnrSelHandles.push(marker);
  });
  dnrMoveBox.hidden=false;setDnrBusy(false);updateDnrBounds(bbox);
}
let dnrDrag=null;
dnrMoveBox.addEventListener("pointerdown",event=>{
  if(dnrBusy||!dnrSelBbox||event.button!==0)return;
  event.preventDefault();event.stopPropagation();
  dnrDrag={id:event.pointerId,start:map.mouseEventToLatLng(event),bbox:[...dnrSelBbox]};
  dnrMoveBox.setPointerCapture(event.pointerId);
});
dnrMoveBox.addEventListener("pointermove",event=>{
  if(!dnrDrag||event.pointerId!==dnrDrag.id)return;
  event.preventDefault();event.stopPropagation();
  const p=map.mouseEventToLatLng(event),dx=p.lng-dnrDrag.start.lng,dy=p.lat-dnrDrag.start.lat,b=dnrDrag.bbox;
  if(b[1]+dy>-85&&b[3]+dy<85)updateDnrBounds([b[0]+dx,b[1]+dy,b[2]+dx,b[3]+dy],{announce:false});
});
for(const type of ["pointerup","pointercancel","lostpointercapture"])dnrMoveBox.addEventListener(type,()=>{if(dnrDrag&&dnrSelBbox)updateDnrBounds(dnrSelBbox);dnrDrag=null});
L.DomEvent.disableClickPropagation(dnrMoveBox);L.DomEvent.disableScrollPropagation(dnrBar);
L.DomEvent.disableClickPropagation(dnrBar);
dnrMoveBox.addEventListener("keydown",event=>{
  if(!dnrSelBbox||dnrBusy)return;
  const shifts={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]},shift=shifts[event.key];
  if(!shift)return;event.preventDefault();event.stopPropagation();
  const b=dnrSelBbox,p=map.latLngToContainerPoint([b[1],b[0]]),next=map.containerPointToLatLng(p.add(shift));
  updateDnrBounds([next.lng,next.lat,b[2]+next.lng-b[0],b[3]+next.lat-b[1]]);
});
async function stopDnrJob(jobId){
  if(!jobId||!serverHealth?.features?.includes("wadnr-job-cancel"))return;
  // The engine checks ownership atomically; an old tab cannot stop a newer job.
  const response=await fetch(api("/api/wadnr/warm/stop"),{method:"POST",body:JSON.stringify({id:jobId}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
}
function cancelDnrSelection(){
  const jobId=dnrJobId,wasBusy=dnrBusy,wasUncertain=dnrStartUncertain;
  clearTimeout(dnrSuccessTimer);const cancelToken=++dnrFetchToken;clearTimeout(dnrFetchPoll);dnrFetchPoll=null;dnrJobId=null;dnrPollNow=null;dnrDownloadBbox=null;
  setDnrBusy(false);clearDnrSelection();paintDnrAreas();$("#dnrSelect").focus({preventScroll:true});
  if(wasBusy){
    const message=wasUncertain?"Tracking dismissed. The unconfirmed engine job may continue; no area was applied.":
      serverHealth?.features?.includes("wadnr-job-cancel")?"Download request cancelled. No area was applied; an already-started file may finish caching.":"Request dismissed. The engine may finish its download; no area will be applied.";
    dnrMsg(message);
    stopDnrJob(jobId).catch(()=>{
      if(cancelToken!==dnrFetchToken)return;
      showDnrDownload();$("#dnrFetch").hidden=true;$("#dnrCancel").textContent="Dismiss";$("#dnrDownloadProgress").hidden=true;
      dnrMsg("The engine could not be reached to stop the download. It may finish in the background; no area will be applied.","error",true,"WA DNR · stop unconfirmed");
    });
  }
}
$("#dnrCancel").onclick=cancelDnrSelection;
document.addEventListener("keydown",event=>{
  if(event.key!=="Escape"||dnrBar.hidden)return;
  if(dnrBackground){
    if(!$("#dnrSelectionDetails").hidden){event.preventDefault();expandDnrDownload(false);$("#dnrDownloadToggle").focus({preventScroll:true})}
  }else{event.preventDefault();cancelDnrSelection()}
});
$("#dnrSelect").onclick=event=>{
  event.stopPropagation();
  if(!PROXY||dnrBusy){paintDnrAvailability();return}
  dnrFetchToken++; // A fresh selection also fences late cancellation messages.
  if(document.body.classList.contains("terrain-3d"))exitTerrain3d();
  pointCloudPanel?.close();
  document.dispatchEvent(new CustomEvent("csp:dnr-select"));
  document.body.classList.add("dnr-selecting");
  // Keep the initial area above the phone sheet’s peek strip.
  const size=map.getSize(),mr=map.getContainer().getBoundingClientRect(),sr=$("#side").getBoundingClientRect();
  const portrait=matchMedia("(max-width:760px) and (orientation:portrait)").matches;
  const visibleH=portrait?Math.max(160,size.y-100):size.y;
  const left=!portrait&&!document.body.classList.contains("collapsed")?Math.max(0,sr.right-mr.left):0;
  // A geographic rectangle rotates with the map. Fit all four projected
  // corners inside the initial screen area so every resize handle is reachable.
  const x0=left+(size.x-left)*.2,x1=left+(size.x-left)*.8,y0=visibleH*.2,y1=visibleH*.72;
  const projected=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(p=>map.project(map.containerPointToLatLng(p)));
  const west=Math.min(...projected.map(p=>p.x)),east=Math.max(...projected.map(p=>p.x));
  const north=Math.min(...projected.map(p=>p.y)),south=Math.max(...projected.map(p=>p.y));
  const center=L.point((west+east)/2,(north+south)/2),half=L.point((east-west)/2,(south-north)/2);
  const toBbox=scale=>{
    const nw=map.unproject(center.subtract(half.multiplyBy(scale))),se=map.unproject(center.add(half.multiplyBy(scale)));
    return [nw.lng,se.lat,se.lng,nw.lat];
  };
  const points=dnrCorners(toBbox(1)).map(ll=>map.latLngToContainerPoint(ll));
  const width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
  const height=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
  setDnrSelection(toBbox(Math.min(1,(x1-x0)/width,(y1-y0)/height)));
  requestAnimationFrame(()=>dnrMoveBox.focus({preventScroll:true}));
};
function dnrViewportBbox(){
  const view=map3d&&document.body.classList.contains("terrain-3d")?map3d:map,b=view.getBounds();
  return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
}
async function startDnrDownload(bbox){
  if(dnrBusy||!bbox)return;
  if(!PROXY){dnrMsg("Connect the terrain engine, then retry this download.","error");return}
  bbox=[...bbox];
  if(bbox.length!==4||!bbox.every(Number.isFinite)||bbox[0]>=bbox[2]||bbox[1]>=bbox[3]||bbox[0]<-180||bbox[2]>180||bbox[1]<-85||bbox[3]>85){
    dnrMsg("This view cannot be downloaded. Move the map to Washington and try again.","error");return;
  }
  const sameArea=dnrDownloadBbox?.every((v,i)=>v===bbox[i]);
  if(!sameArea)dnrLargeApproved=false;
  dnrDownloadBbox=bbox;
  const zn=65536,tx=lon=>Math.floor((lon+180)/360*zn),ty=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*zn);
  const cells=Math.max(1,(tx(bbox[2])-tx(bbox[0])+1)*(ty(bbox[1])-ty(bbox[3])+1));
  if(cells>512&&!dnrLargeApproved){
    dnrLargeApproved=true;$("#dnrFetch").textContent="Download anyway";$("#dnrFetch").hidden=false;$("#dnrFetch").disabled=false;
    if(!dnrSelBbox)showDnrDownload(true);
    dnrMsg(`Large area: about ${cells.toLocaleString()} acquisition cells. Several large surveys may be downloaded. Zoom in or choose a smaller area, or download anyway.`,"warning");return;
  }
  const token=++dnrFetchToken;dnrJobId=null;dnrPollNow=null;dnrStartUncertain=false;clearTimeout(dnrSuccessTimer);
  clearDnrSelection();showDnrDownload();setDnrBusy(true);
  document.dispatchEvent(new CustomEvent("csp:dnr-download"));
  $("#dnrDownloadToggle").focus({preventScroll:true});
  $("#dnrFetch").hidden=true;$("#dnrCancel").textContent="Cancel download";
  $("#dnrDownloadProgress").hidden=false;$("#dnrDownloadProgress").removeAttribute("value");
  dnrMsg("Starting WA DNR download. You can keep using the map.","loading",true,"WA DNR · starting…");
  const failed=text=>{
    if(token!==dnrFetchToken)return;
    setDnrBusy(false);dnrJobId=null;dnrPollNow=null;clearTimeout(dnrFetchPoll);dnrFetchPoll=null;
    $("#dnrDownloadProgress").hidden=true;$("#dnrFetch").hidden=false;$("#dnrFetch").textContent="Retry download";
    $("#dnrCancel").textContent="Dismiss";dnrMsg(text,"error");
  };
  let jobId=null,startRejected=false;
  try{
    const r=await fetch(api("/api/wadnr/warm"),{method:"POST",body:JSON.stringify({bbox}),signal:AbortSignal.timeout(20000)});
    startRejected=!r.ok;
    const value=await r.json();if(!r.ok)throw new Error(value.error||`HTTP ${r.status}`);
    if(typeof value.id!=="string"||!value.id)throw new Error("The engine did not return a download ID");
    jobId=value.id;
  }catch(error){
    if(token!==dnrFetchToken)return;
    if(startRejected){failed(`Could not start download: ${error.message}`);return}
    // A lost POST response may already have started work. Check for idle
    // before allowing a new request, without claiming an unowned global job.
    dnrStartUncertain=true;$("#dnrCancel").textContent="Dismiss";
    dnrMsg(`The start response was lost: ${error.message}. Checking the engine before allowing another download.`,"error",true,"WA DNR · checking start…");
  }
  // A cancel can arrive before the engine returns its job id.
  if(token!==dnrFetchToken){stopDnrJob(jobId).catch(()=>{});return}
  dnrJobId=jobId;clearTimeout(dnrFetchPoll);
  let polling=false;
  const poll=async()=>{
    if(token!==dnrFetchToken||polling)return;
    polling=true;clearTimeout(dnrFetchPoll);dnrFetchPoll=null;
    try{
      const r=await fetch(api("/api/wadnr/warm/status"),{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const s=await r.json();if(token!==dnrFetchToken)return;
      if(dnrStartUncertain){
        if(!s.running){failed("The engine is idle. The start response was lost, so this area was not applied. Retry to verify and complete the same area.");return}
        dnrMsg("The engine is downloading, but the start response was lost. Waiting for it to finish; this unconfirmed area will not be applied.","loading",true,"WA DNR · unconfirmed job");
        dnrFetchPoll=setTimeout(poll,5000);return;
      }
      if(jobId&&s.id&&s.id!==jobId){failed("Another download replaced this one. Your area was not applied; retry to download it.");return}
      dnrStatus=s.acquisition;
      const complete=!s.running&&!s.error&&!s.stop&&s.total>0&&s.done>=s.total&&(!jobId||s.id===jobId);
      if(s.running){
        $("#dnrFetch").hidden=true;$("#dnrDownloadProgress").hidden=false;
        if(s.total>0){$("#dnrDownloadProgress").max=s.total;$("#dnrDownloadProgress").value=s.done}
        dnrMsg(`Downloading WA DNR: ${s.done}/${s.total} areas. ${dnrAcquisitionText()}`,"loading",true,`WA DNR · ${s.done}/${s.total}`);
        dnrFetchPoll=setTimeout(poll,2000);return;
      }
      if(!complete){failed(s.error?`Download could not complete: ${s.error}`:"Download stopped before the area finished. Retry to complete it.");return}
      setDnrBusy(false);dnrJobId=null;dnrPollNow=null;
      if(!dnrAreas.some(a=>a.bbox.every((v,i)=>v===bbox[i])))dnrAreas.push({bbox,at:Date.now()});
      saveDnrAreas();paintDnrAreas();
      $("#dnrDownloadProgress").hidden=true;$("#dnrFetch").hidden=true;$("#dnrCancel").textContent="Done";
      dnrMsg(`WA DNR ready in this area · ${fmtMB(s.bytes)} added.`,"ready");
      resetMeshSources();applyTerrain(true);if(elevationActive())applyElev();schedule3dStyle();scheduleDnrStatus();
      dnrSuccessTimer=setTimeout(()=>{dnrBar.hidden=true},5000);
    }catch(error){
      if(token!==dnrFetchToken)return;
      // A missing status response is not a failed acquisition. Keep ownership
      // and both start controls locked while reconnecting to the same job.
      $("#dnrFetch").hidden=false;$("#dnrFetch").disabled=false;$("#dnrFetch").textContent="Check status";
      dnrMsg(`Download continues in the background. Status unavailable: ${error.message}. Retrying automatically.`,"error",true,"WA DNR · reconnecting…");
      dnrFetchPoll=setTimeout(poll,5000);
    }finally{polling=false}
  };
  dnrPollNow=poll;dnrFetchPoll=setTimeout(poll,2000);
}
$("#dnrFetch").onclick=()=>dnrBusy?dnrPollNow?.():startDnrDownload(dnrDownloadBbox||dnrSelBbox);
$("#dnrViewport").onclick=()=>{
  if(!PROXY||dnrBusy){paintDnrAvailability();return}
  // Freeze the active camera before clearing any selection or moving the map.
  const bbox=dnrViewportBbox();dnrFetchToken++;clearTimeout(dnrSuccessTimer);clearDnrSelection();
  dnrDownloadBbox=null;dnrLargeApproved=false;$("#dnrCancel").textContent="Cancel";
  return startDnrDownload(bbox);
};
$("#dnrClear").onclick=()=>{
  if(dnrBusy)return;
  dnrFetchToken++;clearTimeout(dnrFetchPoll);dnrFetchPoll=null;
  dnrAreas=[];saveDnrAreas();clearDnrSelection();paintDnrAreas();
  resetMeshSources();applyTerrain(true);if(elevationActive())applyElev();schedule3dStyle();
};
map.on("move zoom resize rotate",scheduleDnrPosition);
new ResizeObserver(scheduleDnrPosition).observe($("#side"));
new MutationObserver(()=>{
  if(dnrBackground||!dnrSelBbox)return;
  const mode3d=document.body.classList.contains("terrain-3d")||$("#terModePoints").getAttribute("aria-pressed")==="true";
  if(mode3d&&!dnrBusy){cancelDnrSelection();dnrMsg("Area selection closed. Select an area to return to the 2D map.");return}
}).observe(document.body,{attributes:true,attributeFilter:["class"]});
paintDnrAreas();

/* ---- cached areas: has the lidar catalogue moved since we downloaded? --- */
async function checkStaleAreas(){
  const el=$("#terStale"); if(!el || !PROXY) return;
  let areas=[];
  try{
    const paths=["/api/warm/check","/api/usgs/areas/check"];
    const both=await Promise.all(paths.map(async p=>{
      const r=await fetch(api(p)); return r.ok ? r.json() : [];
    }));
    areas=both.flat().filter(Boolean);
  }catch(e){ return }
  if(!Array.isArray(areas) || !areas.length){ el.style.display="none"; return }
  const stale=areas.filter(a=>a.stale);
  if(!stale.length){
    el.style.display="block";
    el.innerHTML=`<span class="ok">${areas.length} area${areas.length>1?"s":""} downloaded</span>`
      + ` &middot; up to date`;
    return;
  }
  const lines=stale.slice(0,3).map(a=>{
    const added=Array.isArray(a.added)?a.added:[];
    const changed=Array.isArray(a.changed)?a.changed:[];
    const bits=[];
    if(added.length)   bits.push(`${added.length} new`);
    if(changed.length) bits.push(`${changed.length} re-issued`);
    const first=added[0]||changed[0]||{};
    const who=first.project_name||first.key||"";
    return `&middot; <b>${a.label}</b> \u2014 ${bits.join(", ")}${who?` (${who})`:""}`;
  }).join("<br>");
  el.style.display="block";
  el.innerHTML=`<span class="warn">New LiDAR available.</span><br>${lines}`
    + `<br><a href="#" id="terRedl" style="color:var(--accent)">Download the updates</a>`;
  const a=$("#terRedl");
  if(a) a.onclick=(e)=>{ e.preventDefault(); $("#terWarm").click() };
}

$("#terWarm").onclick=async ()=>{
  const msg=$("#terWarmMsg");
  if(!PROXY){ msg.innerHTML='<span class="warn">Needs the local server (server.js).</span>'; return }
  const style=$("#terStyle").value;
  if(style==="off"){ msg.textContent="Pick a terrain layer first."; return }
  const plan=warmPlan(), b=plan.b, z0=plan.z0, z1=plan.z1, est=plan.tiles;
  if(est>WARM_MAX){
    msg.innerHTML=`<span class="warn">This viewport is still too large to cache safely.</span> `
      + `Zoom in, shrink the margin, or drop to Screen +2.`; return }
  if(est>WARM_WARN && !confirm(
      `${est.toLocaleString()} tiles at ${(plan.mpp*3.28084).toFixed(2)} ft/px, roughly `
      + `${fmtMB(est*TILE_BYTES)} on disk.\n\nA cold terrain download may take a while. Continue?`))
    return;
  const pick=chooseTerrain(style);
  const bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
  const projs=pick.projs||[];
  const label=projs.length ? `${projs[0].name||projs[0].project_name||"WA LiDAR"}${projs.length>1?` +${projs.length-1}`:""}`
                           : `z${z0}-${z1}`;
  const analytic=pick.src!=="wadnr";
  const startPath=analytic ? "/api/usgs/warm" : "/api/warm";
  warmStatusPath=analytic ? "/api/usgs/warm/status" : "/api/warm/status";
  const body=analytic
    ? {bbox,z0,z1,style,label,raw:pick.src==="usgs1m"}
    : {bbox,z0,z1,rule:DEP_RULE[style]||DEP_RULE.hs,label,
       layers:pick.src==="wadnr" ? (pick.ids||[]).join(",") : ""};
  msg.innerHTML=`<span class="spin"></span> starting${plan.limited?" broad-area pass":""} &mdash; `
    + `${est.toLocaleString()} tiles at ${(plan.mpp*3.28084).toFixed(2)} ft/px`;
  try{
    const r=await fetch(api(startPath),{method:"POST",body:JSON.stringify(body)});
    if(!r.ok){ const j=await r.json().catch(()=>({})); throw new Error(j.error||`HTTP ${r.status}`) }
  }catch(e){ msg.textContent=`Could not start: ${e.message}`; return }
  clearInterval(warmPoll);
  let pollFailures=0;
  warmPoll=setInterval(async ()=>{
    let s;
    try{
      const r=await fetch(api(warmStatusPath)); if(!r.ok) throw new Error(`HTTP ${r.status}`);
      s=await r.json(); pollFailures=0;
    }catch(e){
      if(++pollFailures<5) return;
      clearInterval(warmPoll); warmPoll=null;
      msg.innerHTML='<span class="warn">Lost contact with the LiDAR server.</span> The download may still be running; reconnect and try again to resume.';
      return;
    }
    const pct = s.total ? Math.round(100*s.done/s.total) : 0;
    if(s.running){
      msg.innerHTML=`<div class="bar"><i style="width:${pct}%"></i></div>`
        + `${s.done.toLocaleString()} / ${s.total.toLocaleString()} tiles &middot; ${fmtMB(s.bytes)}`;
    }else{
      clearInterval(warmPoll); warmPoll=null;
      const skipped=s.skipped ? ` &middot; ${s.skipped.toLocaleString()} reused` : "";
      const partial=s.error&&!(s.ok||s.skipped);
      msg.innerHTML=partial
        ? `<span class="warn">Download could not complete.</span> ${esc(s.error)} — try again to resume.`
        : `<span class="ok">Downloaded.</span> ${s.done.toLocaleString()} tiles${skipped} &middot; ${fmtMB(s.bytes)} on disk${s.error?` <span class="warn">&mdash; some tiles will retry next time</span>`:""} &mdash; this area now loads instantly and works with no network.`;
      checkStaleAreas();
    }
  }, 900);
};

["#terDepth","#terExtent","#terStyle","#terSrc"].forEach(id=>{
  const el=$(id); if(el) el.addEventListener("change", warmPreview);
});
map.on("zoomend", warmPreview);
setTimeout(()=>{ warmPreview(); checkStaleAreas() }, 1200);

