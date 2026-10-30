/* CR-013: opt-in, settled-view acquisition. Tile/export/readout requests stay
   cache-only. A picture is never evidence of numeric elevation coverage. */
let dnrAutoTimer=null,dnrAutoMotion=false;
const dnrAutoAttempts=new Map(); // engine -> boxes attempted, including cancels/failures
function scheduleAutomaticDnr(){
  clearTimeout(dnrAutoTimer);
  dnrAutoTimer=setTimeout(checkAutomaticDnr,700);
}
function automaticDnrGaps(layer,view){
  if(!layer||!map.hasLayer(layer))return null;
  if(layer===gpuTerrainLayer)return gpuTerrainStore.detailGaps(layer._tilesNeeded());
  if(!(layer instanceof ElevLayer))return null;
  const tiles=Object.values(layer._tiles||{}).map(t=>t.el).filter(cv=>cv?._cspCoords&&bboxIntersects(tileBbox(cv._cspCoords.z,cv._cspCoords.x,cv._cspCoords.y),view));
  if(!tiles.length||tiles.some(cv=>cv._cspRefining||cv._cspRefineFailed))return null;
  return tiles.filter(cv=>{
    const c=cv._cspNumericCounts;
    return !c||(c[3]||0)+(c[5]||0)<cv.width*cv.height;
  }).map(cv=>cv._cspCoords);
}
function checkAutomaticDnr(){
  dnrAutoTimer=null;
  if(!PROXY||!serverHealth?.features?.includes("wadnr-auto")||!dnrElevationAvailable()||dnrAutoMotion||
     dnrBusy||dnrSelBbox||terrainSwap||map.getZoom()<15||$("#terSrc").value!=="auto"||
     document.body.classList.contains("terrain-3d")||snapshotExporting||!snapshotPanel.hidden||
     document.body.classList.contains("dnr-selecting")||researchStack.some(e=>e.status==="busy"))return;
  if($("#terStyle").value==="off"&&!elevationActive())return;
  const view=dnrViewportBbox(),layer=gpuTerrainLayer&&map.hasLayer(gpuTerrainLayer)?gpuTerrainLayer:terLayer||elevLayer;
  const gaps=automaticDnrGaps(layer,view);
  if(!gaps?.length)return;
  // Catalogue outlines are only acquisition candidates. Numeric pixel winners
  // above establish the gap; no catalogue match means no attempted download.
  if(!["ready","stale"].includes(waCoverageState)||!waCover?.some(p=>p.dtmDataset!=null&&bboxIntersects(p.bounds,view)))return;
  const boxes=gaps.map(c=>tileBbox(c.z,c.x,c.y));
  const bbox=[Math.max(view[0],Math.min(...boxes.map(b=>b[0]))),Math.max(view[1],Math.min(...boxes.map(b=>b[1]))),
    Math.min(view[2],Math.max(...boxes.map(b=>b[2]))),Math.min(view[3],Math.max(...boxes.map(b=>b[3])))];
  if(bbox[0]>=bbox[2]||bbox[1]>=bbox[3]||dnrStatus?.cachedBounds?.some(b=>bboxContains(b,bbox)))return;
  const attempts=dnrAutoAttempts.get(API)||[];
  if(attempts.some(b=>bboxContains(b,bbox)))return;
  attempts.push(bbox);dnrAutoAttempts.set(API,attempts);
  startDnrDownload(bbox,{automatic:true});
}
map.on("movestart zoomstart rotatestart",()=>{dnrAutoMotion=true;clearTimeout(dnrAutoTimer)});
map.on("moveend zoomend rotateend",()=>{dnrAutoMotion=false;scheduleAutomaticDnr()});
