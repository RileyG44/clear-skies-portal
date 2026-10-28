let map3dLoading=null,map3dStyleTimer=null;

/* Geometry and color come from different tiles on purpose.

   The mesh only needs relief, so it uses the national 3DEP tile, which skips
   the raw 1 m COG read entirely. Measured cold: the raw path runs 2-16 s per
   tile upstream and a 36-tile burst took p50 50 s, which is unusable while
   panning. National alone halves that, and capping the source at z14 cuts the
   tile count again — MapLibre over-zooms the mesh, which is invisible on
   relief but very visible in load time.

   The analytical drape keeps the full-detail path, so 1 m lidar still shows up
   where it matters: in the color. This also answers MapLibre's warning about
   sharing one source between terrain and a hillshade layer. */
const DEM_MAX_ZOOM=14;
/* The engine path renders the same USGS 3DEP service the public path reads and
   serves it from its own cache, so it can answer fine mesh tiles too. There is no
   reason for a self-hosted copy to sample the terrain more coarsely than the
   Pages copy does. */
const DEM_ENGINE_MAX_ZOOM=17;
/* How fine the 3D *mesh* is sampled, as opposed to the drape. The public pipeline
   can serve finer USGS 3DEP elevation than the engine's national mosaic - 1 m
   where a survey covers the point - and that is what gives close-up terrain its
   shape rather than its color. Each level finer is four times the elevation
   tiles per view and every tile is a five-tile skirt (centre plus four
   neighbours), so this is the one number that trades 3D detail for requests;
   17 is where a close-up still resolves the mesh without the request count
   running away (measured: see the commit that raised it). */
const DEM_MESH_MAX_ZOOM=17;
const public3dSources=new Map();
const public3dDrapeSources=new Map();
function public3dSourceText(){
  const bounds=map3d?.getBounds();
  const collect=entries=>{
    const ranks=new Set();
    if(bounds)for(const entry of entries.values()){
    const n=2**entry.z,west=entry.x/n*360-180,east=(entry.x+1)/n*360-180;
    const north=Math.atan(Math.sinh(Math.PI*(1-2*entry.y/n)))*180/Math.PI,south=Math.atan(Math.sinh(Math.PI*(1-2*(entry.y+1)/n)))*180/Math.PI;
      if(east>=bounds.getWest()&&west<=bounds.getEast()&&north>=bounds.getSouth()&&south<=bounds.getNorth())
        for(const rank of entry.ranks||[entry.rank])if(CSPPublicTerrain.SOURCES[rank])ranks.add(rank);
    }
    return ranks.size?[...ranks].sort((a,b)=>b-a).map(rank=>CSPPublicTerrain.SOURCES[rank].label).join(" + "):"waiting for data";
  };
  return `3D mesh: ${collect(public3dSources)}. Analytical drape: ${collect(public3dDrapeSources)}. Mesh sampling is capped at zoom ${PROXY?DEM_ENGINE_MAX_ZOOM:DEM_MESH_MAX_ZOOM}; loaded-tile sources are not survey coverage percentages.`;
}
/* Each DEM source asks under its own host so a refinement can tell which
   source still holds the overview for a tile (see meshStale). The revision
   only moves on a genuine reset, where every tile really must change. */
function terrainDemTiles(host="dem"){
  return [`cspmesh://${host}/{z}/{x}/{y}.png?r=${meshRevision}`];
}
/* The engine serves the same, unmodified global overview tiles from its disk
   cache. Older engines and engine-free clients retain direct AWS access. */
function overviewElevationUrl(z,x,y){
  return PROXY&&serverHealth?.features?.includes("overview-elevation")
    ?api(`/api/elev/overview/${z}/${x}/${y}.png`)
    :`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}
async function fetchOverviewResponse(url,signal){
  const cached=url.match(/\/api\/elev\/overview\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if(!cached)return fetch(url,{signal});
  try{const response=await fetch(url,{signal});if(response.ok)return response;}
  catch(error){if(signal?.aborted)throw error;}
  // A cache/server failure must not strand a phone that can reach AWS itself.
  return fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${cached[1]}/${cached[2]}/${cached[3]}.png`,{signal});
}
/* Progressive 3D mesh.

   The mesh used to wait for every tile of USGS 3DEP elevation - from the
   engine's national mosaic, or the public ImageServer - before MapLibre could
   finish its first frame. 3DEP answers in seconds per tile when it is not
   cached, and a tilted view asks for its tiles in waves (the near tiles decide
   which far ones are visible), so opening 3D over new ground took many
   seconds. Now each mesh tile races 3DEP against the global Terrarium tile
   from Amazon's CDN (10 m 3DEP in the US, SRTM/GMTED elsewhere), displaying
   whichever usable source arrives first. Visible 3DEP requests keep going;
   when a finer tile lands that tile alone is reloaded and
   answers from memory. Where 3DEP has no data (outside the US) the CDN tile
   simply stays. */
const MESH_FINE_MAX=256, MESH_OVERVIEW_MAX_ZOOM=15;
const meshFine=new Map(), meshPending=new Map();
const meshRequests=new CSPTilePipeline.RequestPool({concurrency:6,maxBytes:0});
const meshRanks=new Map();
let meshRevision=0, meshRefineTimer=null, meshRefinedAt=0;
function meshKey(z,x,y){ return `${$("#terSrc").value}:${PROXY?API:"public"}:${dnrStatus?.revision||0}:${z}/${x}/${y}` }
function resetMeshSources(){
  for(const job of meshPending.values())job.controller.abort();meshPending.clear();
  meshFine.clear();meshRanks.clear();public3dSources.clear();public3dDrapeSources.clear();meshStaleClear();
  elevCacheClear();meshRevision++;map3dBuiltKey="";elevSpectrumRevision++;
}
function rememberMeshTile(key,buffer){
  meshFine.delete(key);meshFine.set(key,buffer);
  while(meshFine.size>MESH_FINE_MAX){const oldest=meshFine.keys().next().value;meshFine.delete(oldest);meshRanks.delete(oldest);}
}
/* Bound fine mesh work independently of overview loading. Shared DEM/shade
   consumers keep the job alive; viewport pruning also catches background work
   whose overview has already completed its MapLibre request. */
function meshFineTile(z,x,y){
  const key=meshKey(z,x,y);
  if(meshFine.has(key)) return Promise.resolve(meshFine.get(key));
  if(meshPending.has(key)&&!meshPending.get(key).controller.signal.aborted) return meshPending.get(key);
  const controller=new AbortController();
  const job=meshRequests.request(key,async signal=>{
    job.startedAt=performance.now();
    if(PROXY){
      if(dnrElevationAvailable()){
        const source=await engineElevationWithFallback({z,x,y},signal,true);
        if(!source)return null;
        meshRanks.set(key,source.ranks);
        return terrariumPng(source.grid);
      }
      for(let attempt=0;attempt<3;attempt++){
        const response=await fetch(api(`/api/elev/national/${z}/${x}/${y}.png`),{signal});
        if(response.ok){
          if(response.headers.get("X-Coverage")==="none") return null;
          meshRanks.set(key,[2]);return response.arrayBuffer();
        }
        if(response.status!==503) return null;
        await waitElevationRetry(Math.min(4000,(+response.headers.get("Retry-After")||2)*1000*(attempt+1)),signal);
      }
      return null;
    }
    const url=CSPPublicTerrain.nationalUrl({z,x,y});
    const tile=await elevationRequests.request(url,signal=>fetchPublicElevation(url,signal),{signal,priority:2,group:"national"});
    if(!tile) return null;
    meshRanks.set(key,[2]);return terrariumPng(ElevationTileCore.resampleElevation(tile.grid,tile.width,tile.height,null,256,256));
  },{signal:controller.signal}).then(buffer=>{
    if(controller.signal.aborted)throw new DOMException("Aborted","AbortError");
    if(buffer)rememberMeshTile(key,buffer);return buffer;
  },error=>{if(controller.signal.aborted||error.name==="AbortError")throw new DOMException("Aborted","AbortError");return null})
    .finally(()=>{if(meshPending.get(key)===job)meshPending.delete(key);setTimeout(meshRefineAgain,0)});
  Object.assign(job,{controller,z,x,y,consumers:new Set()});
  meshPending.set(key,job);
  return job;
}
/* The CDN overview for a mesh tile: the tile itself up to z15, or its z15
   ancestor cropped and resampled for the few closer mesh levels. */
async function meshOverviewTile(z,x,y,signal){
  const oz=Math.min(z,MESH_OVERVIEW_MAX_ZOOM),factor=2**(z-oz),ox=Math.floor(x/factor),oy=Math.floor(y/factor);
  const url=overviewElevationUrl(oz,ox,oy);
  if(factor===1){
    const response=await fetchOverviewResponse(url,signal);
    if(!response.ok) throw new Error(`overview elevation HTTP ${response.status}`);
    return response.arrayBuffer();
  }
  const tile=await elevationRequests.request(url,s=>fetchElevation(url,s),{signal,priority:1,group:"overview"});
  if(!tile) throw new Error("overview elevation unavailable");
  const crop={x:(x%factor)*tile.width/factor,y:(y%factor)*tile.height/factor,width:tile.width/factor,height:tile.height/factor};
  return terrariumPng(ElevationTileCore.resampleElevation(tile.grid,tile.width,tile.height,crop,256,256));
}
function terrariumPng(grid){
  const canvas=scratch(256,"encode"),context=canvas.getContext("2d"),image=context.createImageData(256,256);
  for(let i=0;i<grid.length;i++){
    const value=grid[i];if(!ElevationTileCore.isElevation(value))continue;
    const encoded=Math.round((value+32768)*256),offset=i*4;
    image.data[offset]=Math.floor(encoded/65536);image.data[offset+1]=Math.floor(encoded/256)%256;
    image.data[offset+2]=encoded%256;image.data[offset+3]=255;
  }
  context.putImageData(image,0,0);return pngBuffer(canvas);
}
/* Mesh tiles each DEM source is still showing the overview for, keyed like
   meshFine, `ready` once their 3DEP is in memory.

   Refinement used to bump meshRevision and setTiles on both sources. The new
   URL made MapLibre drop and reload every DEM tile it held - re-decode, border
   backfill, texture upload, terrain mesh and drapes rebuilt - about once a
   second while 3DEP streamed in, which read as a periodic hitch and a faint
   breathing of the ground. Map#refreshTiles reloads only the tiles named, and
   keeps each one's old relief on screen until the new one is decoded.

   It only reaches tiles in view, though, and setTiles had also emptied
   MapLibre's off-screen cache; a tile that left the view holding the overview
   would come back with it. So an entry stays until its source is served that
   tile again - by the refresh that catches it back in view (moveend, or a DEM
   tile load in 3D), or by a fresh request once MapLibre has dropped it.

   Neighbours need their borders redone too. Each DEM tile keeps a one-sample
   border copied from its eight neighbours (MapLibre's backfill), marked done
   per neighbour key. A reloaded tile rebuilds its own borders, but neighbours
   keep its old elevation along their shared edge, and two adjacent tiles that
   reload together can also leave the later one with its own clamped edge
   (its fresh flags get set against its old DEM). Either way: wrong edge
   gradients and a seam in hillshade and mesh; test-mesh-borders.js reproduces
   both with the vendored code.
   So after every decoded DEM replacement, including an overview reload after
   the fine cache evicts a tile, meshBackfill redoes both shared borders with the
   loaded neighbours - whichever of two adjacent tiles lands last fixes both -
   and releases their draped textures. Neighbours not in view get a pending
   reload, which runs the same pass when they come back. */
const meshStale={dem:new Map(),demShade:new Map()}, MESH_STALE_MAX=1024;
const meshCompatibility=new Set(),meshCompatibilityPending=new Set();
let meshSeenDem=new WeakMap(),meshCompatibilityWarned=false;
function meshStaleClear(){ for(const map of Object.values(meshStale)) map.clear();meshCompatibility.clear();meshCompatibilityPending.clear();meshSeenDem=new WeakMap() }
function capMeshMap(map,max){ while(map.size>max) map.delete(map.keys().next().value) }
/* fine: the pending 3DEP when the overview was served, true when 3DEP (or DNR)
   was served, false for a final overview or an error. */
function markMeshTile(source,key,tile,fine){
  const stale=meshStale[source];if(!stale) return;
  stale.delete(key);
  if(fine===true) return;
  if(!fine) return;
  const entry={tile,ready:false,pending:true};stale.set(key,entry);capMeshMap(stale,MESH_STALE_MAX);
  fine.then(buffer=>{ if(stale.get(key)!==entry) return;
    entry.pending=false;
    if(buffer){ entry.ready=true;scheduleMeshRefine() }else stale.delete(key)
  },error=>{if(stale.get(key)!==entry)return;entry.pending=false;if(error.name!=="AbortError")stale.delete(key)});
}
/* Source-data events include ordinary reloads too: a fine tile can return as
   overview after its bytes leave the bounded cache. Track DEM identity, not
   quality, so upgrades, downgrades and same-quality replacements all repair. */
function meshSourceData(event){
  const stale=meshStale[event.sourceId],tile=event.tile;
  if(!tile?.dem||!stale||tile.state!=="loaded") return;
  const c=(event.coord||tile.tileID)?.canonical;if(!c) return;
  const previous=meshSeenDem.get(tile);if(previous===tile.dem) return;
  meshSeenDem.set(tile,tile.dem);
  /* A compatibility reset creates fresh tile objects. Their first loads use
     MapLibre's normal backfill; only another replacement needs another reset. */
  if(meshCompatibility.has(event.sourceId)){
    if(previous){ meshCompatibilityPending.add(event.sourceId);scheduleMeshRefine() }
  }else{
    const missing=meshBackfill(event.sourceId,tile,c);
    if(missing===null){
      meshCompatibility.add(event.sourceId);meshCompatibilityPending.add(event.sourceId);
      if(!meshCompatibilityWarned){ console.warn("3D mesh borders: MapLibre internals unavailable; rebuilding DEM sources and terrain textures.");meshCompatibilityWarned=true }
      scheduleMeshRefine();
    }else for(const tile of missing){
      const key=meshKey(tile.z,tile.x,tile.y);
      stale.set(key,{tile,ready:true});capMeshMap(stale,MESH_STALE_MAX);
    }
  }
  meshRefineAgain();
}
/* Public source replacement, rather than refreshTiles/setTiles: both reuse
   tile objects whose neighbour flags may still describe the old DEM. Removing
   the source discards that cache; recreating terrain also discards every drape
   RTT without depending on releaseRTT. Keep source options and layer order. */
function meshResetSource(sourceId){
  const style=map3d.getStyle(),source=style.sources[sourceId];if(!source) return;
  const terrain=map3d.getTerrain(),layers=style.layers||[];
  /* The source cache is about to be discarded, including out-of-view holders:
     their pending border reloads must not start another whole-source reset. */
  meshStale[sourceId].clear();
  if(terrain) map3d.setTerrain(null);
  try{
    for(const layer of layers) if(layer.source===sourceId) map3d.removeLayer(layer.id);
    map3d.removeSource(sourceId);map3d.addSource(sourceId,source);
    for(let i=layers.length-1;i>=0;i--) if(layers[i].source===sourceId) map3d.addLayer(layers[i],layers[i+1]?.id);
  }finally{ if(terrain) map3d.setTerrain(terrain) }
}
/* MapLibre's own neighbour backfill (its `lo`), run in both directions without
   its done-flags, on tile internals: tile.dem (DEMData), the needs*Prepare
   texture flags, neighboringTiles, and terrain.tileManager.releaseRTT for the
   draped render-to-texture tiles. MapLibre 6.6 exposes no public way to do
   this. Guarded: a missing internal requests a bounded source reset instead
   (null), never a recursive neighbour reload. Returns neighbours not loaded in
   view now: out of view, or in MapLibre's off-screen cache. */
function meshBackfill(sourceId,tile,c){
  const limit=2**c.z,missing=new Map();
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const y=c.y+dy,x=((c.x+dx)%limit+limit)%limit;
    if(y>=0&&y<limit&&!(x===c.x&&y===c.y)) missing.set(`${x}/${y}`,{z:c.z,x,y});
  }
  const manager=map3d?.style?.tileManagers?.[sourceId];
  if(typeof tile.dem?.backfillBorder!=="function"||typeof manager?.getIds!=="function"||typeof manager.getTileByID!=="function"||
    (map3d.terrain&&typeof map3d.terrain.tileManager?.releaseRTT!=="function")) return null;
  let changed=false;
  for(const key of manager.getIds()){
    const other=manager.getTileByID(key),o=other?.tileID?.canonical;
    if(!o||other===tile||o.z!==c.z) continue;
    let dx=o.x-c.x;const dy=o.y-c.y;
    if(Math.abs(dx)>1) dx+=dx>0?-limit:limit;
    if(Math.abs(dx)>1||Math.abs(dy)>1||(!dx&&!dy)) continue;
    /* Still on its first load: MapLibre backfills it from this tile when it lands. */
    if(!other.hasData?.()){ missing.delete(`${o.x}/${o.y}`);continue }
    if(typeof other.dem?.backfillBorder!=="function") return null;
    try{ tile.dem.backfillBorder(other.dem,dx,dy);other.dem.backfillBorder(tile.dem,-dx,-dy) }catch{ return null }
    for(const t of [tile,other]) t.needsHillshadePrepare=t.needsTerrainPrepare=t.needsColorReliefPrepare=true;
    if(tile.neighboringTiles?.[key]) tile.neighboringTiles[key].backfilled=true;
    if(other.neighboringTiles?.[tile.tileID.key]) other.neighboringTiles[tile.tileID.key].backfilled=true;
    map3d.terrain?.tileManager?.releaseRTT?.(other.tileID);
    missing.delete(`${o.x}/${o.y}`);changed=true;
  }
  if(changed) map3d.triggerRepaint?.();
  return [...missing.values()];
}
/* Swap arrived 3DEP tiles in, those tiles only. Batched, and never more than
   about once a second, so a burst of arrivals is one refresh. */
function scheduleMeshRefine(){
  if(meshRefineTimer) return;
  const wait=Math.max(700,1200-(performance.now()-meshRefinedAt));
  meshRefineTimer=setTimeout(()=>{
    meshRefineTimer=null;meshRefinedAt=performance.now();
    for(const [id,stale] of Object.entries(meshStale)){
      const tiles=[];for(const entry of stale.values()) if(entry.ready) tiles.push(entry.tile);
      const reset=meshCompatibilityPending.delete(id);
      if((!tiles.length&&!reset)||!map3d?.getSource?.(id)) continue;
      try{ if(reset||meshCompatibility.has(id)) meshResetSource(id);else map3d.refreshTiles(id,tiles) }catch(error){ console.warn("3D mesh refine:",error) }
    }
  },wait);
}
function meshViewContains(){
  const held=new Set();
  for(const id of ["dem","demShade"]){
    const manager=map3d?.style?.tileManagers?.[id];
    for(const key of manager?.getIds?.()||[]){
      const c=manager.getTileByID?.(key)?.tileID?.canonical;
      if(c)held.add(`${c.z}/${c.x}/${c.y}`);
    }
  }
  let bounds;try{
    bounds=map3d?.getBounds?.();
    if(bounds)[bounds.getWest(),bounds.getEast(),bounds.getSouth(),bounds.getNorth()];
  }catch{bounds=null}
  const lat=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
  return tile=>{
    if(held.has(`${tile.z}/${tile.x}/${tile.y}`)||!bounds)return true;
    const n=2**tile.z,left=(tile.x-1)/n*360-180,right=(tile.x+2)/n*360-180;
    const west=bounds.getWest();let east=bounds.getEast();if(east<west)east+=360;
    const shift=360*Math.round(((west+east)/2-(left+right)/2)/360);
    return lat(Math.max(0,tile.y-1)/n)>=bounds.getSouth()&&lat(Math.min(n,tile.y+2)/n)<=bounds.getNorth()&&
      right+shift>=west&&left+shift<=east;
  };
}
function pruneMeshRequests(){
  if(!map3d)return;
  const visible=meshViewContains();
  for(const job of meshPending.values())if(!visible(job))job.controller.abort();
}
/* Put new demand first in the queue. Only stalled background work yields a
   slot; healthy visible refinements keep their already-paid network progress. */
function prioritizeMeshRequest(fine){
  if(!fine.controller||meshRequests.active<meshRequests.concurrency)return;
  const queued=meshRequests.jobs.get(meshKey(fine.z,fine.x,fine.y));
  if(!queued||queued.started)return;
  queued.priority=1;
  for(const other of meshPending.values()){
    if(other===fine||other.controller.signal.aborted)continue;
    const active=meshRequests.jobs.get(meshKey(other.z,other.x,other.y));
    if(active?.started&&performance.now()-other.startedAt>=4000&&[...other.consumers].every(c=>!c.foreground)){
      other.controller.abort();break;
    }
  }
}
function meshRefineAgain(){
  const visible=meshViewContains();
  for(const [source,stale] of Object.entries(meshStale))for(const [key,entry] of stale){
    if(map3d&&!entry.ready&&!entry.pending&&visible(entry.tile)&&meshRequests.active<meshRequests.concurrency){
      const {z,x,y}=entry.tile;markMeshTile(source,key,entry.tile,meshFineTile(z,x,y));
    }
  }
  if(!meshRefineTimer&&Object.values(meshStale).some(stale=>{ for(const entry of stale.values()) if(entry.ready) return true;return false })) scheduleMeshRefine();
}
async function meshTile(z,x,y,signal,source="dem"){
  const limit=2**z;
  if(z<0||y<0||y>=limit) throw new Error("mesh tile outside the world");
  x=((x%limit)+limit)%limit;
  const key=meshKey(z,x,y);
  /* What each mesh tile is made of, for the source note in the 3D panel. */
  const note=ranks=>{ public3dSources.set(key,{z,x,y,ranks:Array.isArray(ranks)?ranks:[ranks]});
    while(public3dSources.size>160) public3dSources.delete(public3dSources.keys().next().value);
    scheduleTerrainStatus() };
  const tile={z,x,y};
  if(meshFine.has(key)){
    /* Touch bytes actually used, without pinning visible tiles above the cap. */
    const buffer=meshFine.get(key);rememberMeshTile(key,buffer);markMeshTile(source,key,tile,true);note(meshRanks.get(key)||[2]);return buffer.slice(0);
  }
  if(signal?.aborted)throw new DOMException("Aborted","AbortError");
  const fine=meshFineTile(z,x,y),consumer={foreground:true};
  fine.consumers?.add(consumer);
  prioritizeMeshRequest(fine);
  const abort=()=>{fine.consumers?.delete(consumer);if(fine.consumers&&!fine.consumers.size)fine.controller.abort()};
  signal?.addEventListener("abort",abort,{once:true});
  const cleanup=()=>{signal?.removeEventListener("abort",abort);fine.consumers?.delete(consumer)};
  fine.then(cleanup,cleanup);
  let abortWait;
  const cancelled=new Promise((resolve,reject)=>{abortWait=()=>reject(new DOMException("Aborted","AbortError"));signal?.addEventListener("abort",abortWait,{once:true})});
  const awaitTile=async promise=>{try{return await Promise.race([promise,cancelled])}finally{signal?.removeEventListener("abort",abortWait)}};
  // Start both immediately. Either useful response can put terrain on screen;
  // a slow overview must never hold up fine data that has already arrived.
  const overviewController=new AbortController(),cancelOverview=()=>overviewController.abort();
  signal?.addEventListener("abort",cancelOverview,{once:true});
  const overview=meshOverviewTile(z,x,y,overviewController.signal);
  try{
    const result=await awaitTile(Promise.any([
      fine.then(buffer=>{if(!buffer)throw new Error("No fine elevation");return {buffer,fine:true}}),
      overview.then(buffer=>({buffer,fine:false}))
    ]));
    if(signal?.aborted)throw new DOMException("Aborted","AbortError");
    if(result.fine){overviewController.abort();markMeshTile(source,key,tile,true);note(meshRanks.get(key)||[2]);return result.buffer.slice(0)}
    consumer.foreground=false;
    if(fine.consumers&&[...fine.consumers].every(c=>!c.foreground)){
      const queued=meshRequests.jobs.get(key);if(queued&&!queued.started)queued.priority=0;
    }
    markMeshTile(source,key,tile,fine);note(1);return result.buffer;
  }catch(error){if(error instanceof AggregateError)throw error.errors.find(e=>e.name==="AbortError")||error.errors.at(-1);throw error}
  finally{signal?.removeEventListener("abort",cancelOverview)}
}
function terrainTheme(){ return $("#map").dataset.basemapTheme==="dark"?"dark":"light" }
/* A physical-relief tint, taken straight from the elevation the mesh is built
   from: green low, tan in the middle, rock and snow high. Deliberately subtle -
   the shading carries the shape, this only stops the ground reading as flat
   white paper when a hillshade is the only thing draped on it. */
function hypsometricRamp(){
  /* Muted toward grey: this is a depth cue over the ground texture, not a paint
     job. At full saturation it swallowed the basemap's streets and labels at close
     zoom, where flat ground has no relief to explain the color. */
  return ["interpolate",["linear"],["elevation"],
    0,"#5f7a6c",250,"#7d8f74",500,"#9aa67f",900,"#b3ab8c",
    1400,"#bda98a",1900,"#b2957c",2500,"#9d8b7c",3000,"#ada49e",3600,"#e6e4e1"];
}
/* Sky and atmosphere for the 3D view.

   The 3D view had no sky at all - terrain ended in a flat background color,
   which is most of why it read as a sheet rather than a landscape. A sky layer
   gives it a horizon, and fog-ground-blend gives it aerial perspective: distant
   ground fades toward the horizon color the way it does in a photograph, which
   is the strongest depth cue a 3D map can carry. The palette follows the sun that
   is already driving the shading, so moving the sun moves the whole scene rather
   than just the shadows. */
function terrainSky(theme,light){
  const lerp=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
  const rgb=(c)=>`rgb(${c[0]},${c[1]},${c[2]})`;
  const day ={sky:[63,127,196],horizon:[207,224,238],fog:[195,211,223]};
  const gold={sky:[74,111,165],horizon:[232,195,154],fog:[205,181,155]};
  const dusk={sky:[34,45,70],  horizon:[214,152,104],fog:[186,143,116]};
  const night={sky:[14,21,36], horizon:[46,58,77],  fog:[38,48,63]};
  const t=Math.max(0,Math.min(1,(light.altitude-8)/47));      // 8deg low sun .. 55deg high
  const low=light.altitude<12?dusk:gold;
  let sky=lerp(low.sky,day.sky,t), horizon=lerp(low.horizon,day.horizon,t), fog=lerp(low.fog,day.fog,t);
  if(theme==="dark"){                                          // never a bright sky over the dark basemap
    sky=lerp(sky,night.sky,.78); horizon=lerp(horizon,night.horizon,.82); fog=lerp(fog,night.fog,.82);
  }
  return {
    "sky-color":rgb(sky),"horizon-color":rgb(horizon),"fog-color":rgb(fog),
    "sky-horizon-blend":.55,"horizon-fog-blend":.3,"fog-ground-blend":.9,"atmosphere-blend":.6};
}
/* What the 3D style is made of. A slider can repaint in place; a change in
   this key (terrain style, terrain on/off, spectrum on/off) needs a new style. */
function gpu3dPreferred(){
  if(gpu3dFailed||typeof createImageBitmap!=="function"||typeof ImageData!=="function"||!window.CSPGpuTerrain3DLayer||!window.CSPGpuTerrain3DRenderer||!window.CSPGpuTerrain3DCache)return false;
  let storage;try{storage=localStorage}catch{}
  return CSPGpuTerrain3DLayer.resolveFlag(location.search,storage);
}
function map3dStructureKey(){
  if(gpu3dPreferred()){
    const pick=chooseTerrain($("#terStyle").value);
    return ["gpu",$("#terSrc").value,PROXY?API:"public",terrainTheme(),pick.src==="wadnr"?pick.ids?.join(","):"analytic"].join("|");
  }
  return [$("#terStyle").value,$("#terSrc").value,elevationActive()?"elev":"-",PROXY?API:"public"].join("|");
}
function gpu3dStates(){
  const style=$("#terStyle").value;
  const stack=studioStack(style==="off"?null:style,{flat:true});
  return {analysis:{terrain:{style:style==="off"?"hs":style,opacity:1,look:terrainLook(style),
    ...(stack||["hs","hsmulti","tint","off"].includes(style)?{lighting:terrainLighting()}:{}),...(stack?{stack}:{})},spectrumOpacity:0},
    elevspec:{terrain:{style:"off"},spectrum:elevationRenderSettings(),spectrumOpacity:1}};
}
function initGpu3d(module){
  if(!gpu3dPreferred()){document.documentElement.dataset.gpu3d="off";return;}
  gpu3d=CSPGpuTerrain3DLayer.create({map:map3d,version:module.getVersion?.()||module.version,
    maxBytes:(matchMedia("(pointer:coarse)").matches?64:192)*1024*1024,
    loadGrid:(z,x,y,signal)=>drapeElevation(z,x,y,signal),groundResolution:tileGroundResolution,getStates:gpu3dStates,
    onStatus:(enabled)=>{document.documentElement.dataset.gpu3d=enabled?"on":"off";},
    onFallback:reason=>{
      gpu3dFailed=true;console.warn("3D GPU analytical textures: using worker fallback:",reason);
      setTimeout(()=>{if(!map3d)return;if(map3d.isStyleLoaded())refresh3dStyle();else map3d.once("load",()=>{if(map3d)refresh3dStyle();});},0);
    }});
}
let map3dBuiltKey="",elevSpectrumRevision=0;
function terrainRasterStyle(){
  map3dBuiltKey=map3dStructureKey();
  /* With no terrain style but the spectrum on, the spectrum stands on its own:
     no analytical drape, just a light hillshade so the ground still reads as
     ground. With neither on, 3D shows the default hillshade as before. */
  const spectrumAlone=$("#terStyle").value==="off"&&elevationActive();
  const theme=terrainTheme(),style=$("#terStyle").value==="off"?"hs":$("#terStyle").value,gpu=gpu3dPreferred();
  /* A styled scene (LiDAR Studio colors or layers) draws through the GPU
     analysis drape, never MapLibre's own hillshade and tint. */
  const styled=gpu&&!!studioStack($("#terStyle").value),plain=(style==="hs"||style==="hsmulti")&&!styled;
  const light=terrainLighting(),opacity=terrainOpacity()/100,pick=chooseTerrain(style);
  const directions=style==="hsmulti"?[light.azimuth,(light.azimuth+90)%360,(light.azimuth+180)%360,(light.azimuth+270)%360]:light.azimuth;
  const altitudes=style==="hsmulti"?[light.altitude,light.altitude,light.altitude,light.altitude]:light.altitude;
  const sources={
    basemap:{type:"raster",tiles:[`${ESRI_CANVAS}/World_${theme==="dark"?"Dark":"Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
      tileSize:256,maxzoom:16,attribution:"Esri, HERE, Garmin, © OpenStreetMap contributors"},
    dem:{type:"raster-dem",tiles:terrainDemTiles("dem"),tileSize:256,maxzoom:PROXY?DEM_ENGINE_MAX_ZOOM:DEM_MESH_MAX_ZOOM,encoding:"terrarium",
      attribution:"WA DNR elevation / USGS 3DEP / AWS overview (see rendered source status)"},
    /* The same elevation again for the hillshade and relief tint. MapLibre
       warns that sharing the terrain source with a hillshade degrades
       rendering; the mesh tiles are cached in memory, so the second source
       costs no extra network. */
    demShade:{type:"raster-dem",tiles:terrainDemTiles("shade"),tileSize:256,maxzoom:PROXY?DEM_ENGINE_MAX_ZOOM:DEM_MESH_MAX_ZOOM,encoding:"terrarium"}
  };
  const layers=[
    {id:"background",type:"background",paint:{"background-color":theme==="dark"?"#111416":"#dbe6eb"}},
    /* The reference basemap is drawn on the terrain as its ground texture. At full
       strength its roads and labels read as a flat map lying on the landscape; at
       half strength the relief and the sky carry the depth instead. */
    {id:"basemap",type:"raster",source:"basemap",paint:{"raster-fade-duration":0,"raster-opacity":.5}}
  ];
  /* Elevation tint under the shading, for every case where the ground would
     otherwise be bare hillshade or a published drape. */
  if(gpu||!spectrumAlone&&(style==="hs"||style==="hsmulti"||pick.src==="wadnr")) layers.push({id:"terrain-relief",type:"color-relief",source:"demShade",
    layout:{visibility:!spectrumAlone&&(plain||!styled&&pick.src==="wadnr")?"visible":"none"},
    paint:{"color-relief-color":hypsometricRamp(),"color-relief-opacity":theme==="dark"?.32:.4}});
  if(gpu||style==="hs"||style==="hsmulti") layers.push({id:"terrain-hillshade",type:"hillshade",source:"demShade",layout:{visibility:plain?"visible":"none"},paint:{
    "hillshade-method":style==="hsmulti"?"multidirectional":"standard",
    "hillshade-illumination-direction":directions,"hillshade-illumination-altitude":altitudes,
    "hillshade-illumination-anchor":"map","hillshade-exaggeration":Math.max(.05,Math.min(1,opacity*1.15)),
    /* Cool shadow, warm highlight: closer to how sunlight on ground actually
       reads than black and white, and it stops the lit slopes blowing out. */
    "hillshade-shadow-color":`rgba(22,28,36,${Math.max(.2,1-light.ambient).toFixed(2)})`,
    "hillshade-highlight-color":`rgba(255,247,235,${Math.max(.3,Math.min(1,opacity*1.1)).toFixed(2)})`,
    "hillshade-accent-color":"#5f6d79"
  }});
  if(gpu||!(style==="hs"||style==="hsmulti")){
    sources.analysis={type:"raster",tiles:[gpu?"cspgpu3d://analysis/{z}/{x}/{y}.png":`cspterrain://${style}/{z}/{x}/{y}.png?r=${++map3dStyleRevision}`],tileSize:256,maxzoom:18};
    layers.push({id:"terrain-analysis",type:"raster",source:"analysis",layout:{visibility:!plain?"visible":"none"},paint:{"raster-opacity":opacity,"raster-fade-duration":0}});
  }
  if(spectrumAlone){
    /* The hillshade above was built at full terrain strength; standing alone
       under the spectrum it is only there for form, so it is lightened. */
    const shade=layers.find(layer=>layer.id==="terrain-hillshade");
    if(shade){ shade.paint["hillshade-exaggeration"]=.45;shade.paint["hillshade-highlight-color"]="rgba(255,255,255,0)" }
  }
  if(!spectrumAlone&&pick.src==="wadnr"&&pick.ids?.length){
    sources.wadnr={type:"raster",tiles:[`cspwa://${pick.ids.join(",")}/{z}/{x}/{y}.png`],tileSize:256,maxzoom:18,
      attribution:"WA DNR LiDAR"};
    layers.push({id:"wadnr-drape",type:"raster",source:"wadnr",paint:{"raster-opacity":opacity,"raster-fade-duration":0}});
  }
  /* The elevation spectrum and highlights, draped over whatever terrain or
     lidar layer is on (or on their own). Color is baked into the tile, so a
     setting change swaps the tile URL rather than rebuilding the style. */
  if(gpu||elevationActive()){
    sources.elevspec={type:"raster",tiles:[gpu?"cspgpu3d://elevspec/{z}/{x}/{y}.png":`cspelev://s/{z}/{x}/{y}.png?r=${elevSpectrumRevision}`],tileSize:256,maxzoom:18};
    layers.push({id:"elev-spectrum",type:"raster",source:"elevspec",layout:{visibility:elevationActive()?"visible":"none"},paint:{"raster-opacity":1,"raster-fade-duration":0}});
  }
  /* `sky` is a style-level object in MapLibre, not a layer - a "sky" layer type is
     rejected by the style validator and takes the whole style down with it. */
  return {version:8,sources,layers,sky:terrainSky(theme,light),terrain:{source:"dem",exaggeration:light.exaggeration}};
}
async function imageBitmapFromBlob(blob){
  if(typeof createImageBitmap==="function") return createImageBitmap(blob);
  return new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),image=new Image();
    image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("terrain tile decode failed"))};image.src=url});
}
async function pngBuffer(canvas){
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("terrain tile encode failed")),"image/png"));
  return blob.arrayBuffer();
}
/* One scratch canvas for the whole session. A canvas per tile is a fresh
   allocation and a GC pause on every pan - and on iOS it is worse than slow.
   Safari caps the total memory of all canvases (~384 MB) and counts a
   discarded canvas until the garbage collector happens to reclaim it; past
   the cap, new canvases silently fail to draw, which is tiles going black.
   So temporary work shares scratch canvases, and canvases the map is done
   with are released explicitly (releaseCanvas). */
let tileScratch=null, skirtScratch=null;
/* Give a canvas's pixel memory back now rather than whenever it is collected. */
function releaseCanvas(canvas){ if(canvas&&canvas.width){ canvas.width=0;canvas.height=0 } }
function releaseCanvasesIn(root){ if(root) for(const canvas of root.querySelectorAll("canvas")) releaseCanvas(canvas) }
const scratchCanvases={};
function scratch(size,which="tile"){
  let c=which==="skirt"?skirtScratch:which==="tile"?tileScratch:scratchCanvases[which];
  if(!c){ c=document.createElement("canvas");
    if(which==="skirt") skirtScratch=c; else if(which==="tile") tileScratch=c; else scratchCanvases[which]=c }
  if(c.width!==size||c.height!==size){ c.width=c.height=size }
  return c;
}
const elevTileUrl=(z,x,y)=>PROXY?api(`/api/elev/${z}/${x}/${y}.png?${RAW_COVERAGE_QUERY}`)
  :`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/* Cache source tiles rather than assembled skirts: adjacent drapes share
   four neighbours. Keep 160 source grids (~40 MiB): the old 48-skirt
   budget evicted the visible desktop set plus its neighbour ring, so changing
   the light refetched elevation. Typed arrays do not use Safari canvas memory.
   Palette/light revisions are deliberately absent from meshKey. RequestPool
   deduplicates concurrent readers without letting one reader abort the others. */
const ELEV_CACHE_BYTES=160*256*256*4;
const newElevCache=()=>new CSPTilePipeline.RequestPool({concurrency:8,maxBytes:ELEV_CACHE_BYTES,ttl:Infinity});
let elevCache=newElevCache();
const drapeWorkers=new CSPTerrainDrapePool.Pool({
  size:Math.max(1,Math.min(4,(navigator.hardwareConcurrency||2)-1)),
  workerFactory:typeof Worker==="function"&&typeof OffscreenCanvas==="function"&&typeof createImageBitmap==="function"
    ?()=>new Worker("./terrain-drape-worker.js"):null,
  fallback:async(job,signal)=>{
    if(signal?.aborted)throw new DOMException("aborted","AbortError");
    if(job.op==="elevation")return decodeElevationBlob(job.blob);
    if(job.op==="decode"){
      const bitmap=await imageBitmapFromBlob(job.blob);
      try{
        const canvas=scratch(256,"drape-decode"),ctx=canvas.getContext("2d",{willReadFrequently:true});
        ctx.clearRect(0,0,256,256);ctx.drawImage(bitmap,0,0,256,256);
        return ElevationTileCore.decodeTerrarium(ctx.getImageData(0,0,256,256).data,256,256);
      }finally{bitmap.close?.()}
    }
    const rgba=CSPTerrainDrape.render(job);
    if(typeof createImageBitmap==="function")return createImageBitmap(new ImageData(rgba,256,256),CSPTerrainDrape.BITMAP_OPTIONS);
    return encodeTileRgba(rgba);
  }
});
function elevCacheClear(){
  gpu3d?.clear();
  const old=elevCache;elevCache=newElevCache();
  for(const job of old.jobs.values()){job.controller.abort();old._settle(job,new DOMException("aborted","AbortError"))}
  old.queue=[];old.cache.clear();old.bytes=0;drapeWorkers.clear();
}
async function drapeElevation(z,x,y,signal){
  const limit=2**z;if(z<0||y<0||y>=limit)return null;
  const wx=((x%limit)+limit)%limit,key=meshKey(z,wx,y);
  const tile=await elevCache.request(key,async signal=>{
    if(!PROXY)return publicElevationWithFallback({z,x:wx,y},signal);
    if(dnrElevationAvailable())
      return engineElevationWithFallback({z,x:wx,y},signal,false);
    /* 503 is a briefly saturated terrain pool. Honor Retry-After and keep
       retries abortable so abandoned viewports leave no work behind. */
    for(let attempt=0;;attempt++){
      const response=await fetch(elevTileUrl(z,wx,y),{signal});
      if(response.ok){
        const grid=await drapeWorkers.run({op:"decode",blob:await response.blob()},signal);
        return {grid,rank:response.headers.get("X-Elevation-Source")==="usgs-1m"?3:2};
      }
      if(response.status!==503||attempt>=2)throw new Error(`elevation tile HTTP ${response.status}`);
      await waitElevationRetry(Math.min(4000,((+response.headers.get("Retry-After")||2)*1000)*(attempt+1)),signal);
    }
  },{signal});
  if(signal?.aborted)throw new DOMException("aborted","AbortError");
  if(tile){
    public3dDrapeSources.set(`${z}/${wx}/${y}`,{z,x:wx,y,...(tile.ranks?{ranks:tile.ranks}:{rank:tile.rank})});
    while(public3dDrapeSources.size>160)public3dDrapeSources.delete(public3dDrapeSources.keys().next().value);
    scheduleTerrainStatus();
  }
  return tile?.grid||null;
}
async function renderDrapeTile(style,z,x,y,signal){
  // Missing neighbours retain the old centre-edge clamp. Cancellation is not
  // missing coverage: it must propagate, including when all grids are cached.
  const neighbour=(x,y)=>drapeElevation(z,x,y,signal).catch(error=>{if(signal?.aborted)throw error;return null});
  const tiles=await Promise.all([drapeElevation(z,x,y,signal),neighbour(x-1,y),neighbour(x+1,y),neighbour(x,y-1),neighbour(x,y+1)]);
  const job={style,tiles,groundRes:reliefResolution(tileGroundResolution({z,x,y}),style),lighting:terrainLighting()};
  if(style==="spectrum"){
    const settings=elevationRenderSettings();job.settings={...settings,bandState:settings.bandCompiled.state};delete job.settings.bandCompiled;
  }
  return drapeWorkers.run(job,signal);
}

async function encodeTileRgba(rgba){
  const canvas=scratch(256,"tile"),ctx=canvas.getContext("2d",{willReadFrequently:true});
  const image=ctx.createImageData(256,256);image.data.set(rgba);ctx.putImageData(image,0,0);
  return pngBuffer(canvas);
}

async function installMaplibreProtocols(module){
  if(maplibreProtocolReady) return;
  module.addProtocol("cspgpu3d",async(params,controller)=>{
    const match=params.url.match(/^cspgpu3d:\/\/(analysis|elevspec)\/(\d+)\/(\d+)\/(\d+)\.png/);
    if(!match)throw new Error("invalid 3D GPU texture request");
    const [,kind,z,x,y]=match;
    if(!gpu3d?.enabled)return {data:await renderDrapeTile(kind==="elevspec"?"spectrum":$("#terStyle").value,+z,+x,+y,controller.signal)};
    await gpu3d.prepare(+z,+x,+y,controller.signal);
    if(controller.signal.aborted)throw new DOMException("aborted","AbortError");
    // One blank upload creates MapLibre's native mipmapped texture. Before
    // presentation the custom offscreen pass shades it directly on the GPU.
    gpu3dBlank??=new ImageData(256,256);
    return {data:await createImageBitmap(gpu3dBlank,CSPTerrainDrape.BITMAP_OPTIONS)};
  });
  module.addProtocol("cspmesh",async(params,controller)=>{
    const match=params.url.match(/^cspmesh:\/\/(dem|shade)\/(\d+)\/(\d+)\/(\d+)\.png/);
    if(!match) throw new Error("invalid mesh tile");
    return {data:await meshTile(+match[2],+match[3],+match[4],controller.signal,match[1]==="shade"?"demShade":"dem")};
  });
  module.addProtocol("cspterrain",async(params,controller)=>{
    const match=params.url.match(/^cspterrain:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png/);
    if(!match) throw new Error("invalid terrain tile request");
    const [,style,zs,xs,ys]=match,z=+zs,x=+xs,y=+ys;
    return {data:await renderDrapeTile(style,z,x,y,controller.signal)};
  });
  module.addProtocol("cspelev",async(params,controller)=>{
    const match=params.url.match(/^cspelev:\/\/s\/(\d+)\/(\d+)\/(\d+)\.png/);
    if(!match) throw new Error("invalid elevation spectrum tile request");
    return {data:await renderDrapeTile("spectrum",+match[1],+match[2],+match[3],controller.signal)};
  });
  module.addProtocol("cspwa",async(params,controller)=>{
    const match=params.url.match(/^cspwa:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png/);
    if(!match) throw new Error("invalid WA LiDAR tile request");
    const ids=match[1].split(",").map(Number).filter(Number.isFinite),coords={z:+match[2],x:+match[3],y:+match[4]};
    const response=await fetch(waTileUrl(coords,ids,waSharpPx()),{signal:controller.signal});if(!response.ok) throw new Error(`WA LiDAR tile HTTP ${response.status}`);
    return {data:await response.arrayBuffer()};
  });
  maplibreProtocolReady=true;
}
/* A trackpad zoom calls setZoom/jumpTo each frame, which emits movestart and
   moveend synchronously each time. Removing the glass override on moveend
   would therefore re-enable the Retina backdrop blur every frame. Keep one
   material for the whole gesture and restore it after 200 ms without a move;
   only the first move and the quiet callback write to the DOM. */
let map3dGlassTimer=null,map3dGlassMoving=false;
function reset3dGlassMotion(){
  clearTimeout(map3dGlassTimer);map3dGlassTimer=null;
  if(map3dGlassMoving){map3dGlassMoving=false;document.body.classList.remove("map3d-moving")}
}
function mark3dGlassMotion(){
  if(!map3d||!document.body.classList.contains("terrain-3d")) return;
  if(!map3dGlassMoving){map3dGlassMoving=true;document.body.classList.add("map3d-moving")}
  clearTimeout(map3dGlassTimer);map3dGlassTimer=setTimeout(reset3dGlassMotion,200);
}
function setTerrainModeUi(on,status){
  if(!on) reset3dGlassMotion();
  document.body.classList.toggle("terrain-3d",on);$("#map3d").setAttribute("aria-hidden",String(!on));
  $("#terMode2d").setAttribute("aria-pressed",String(!on));$("#terMode3d").setAttribute("aria-pressed",String(on));
  $("#terModeNote").textContent=status||(on?(matchMedia("(pointer:coarse)").matches?"Two fingers rotate, pitch, and zoom.":"Orbit with right-drag or Control-drag. Two fingers rotate, pitch, and zoom."):"Drag to pan. Pinch to zoom. North reset is on the map.");
  syncBearingButton();
  syncLocationPin();
}
/* A real capability probe: MapLibre needs a WebGL2 context it can actually
   allocate. Losing the context immediately keeps this cheap to call. */
function webgl2Capable(){
  try{
    const c=document.createElement("canvas");
    const gl=c.getContext("webgl2",{failIfMajorPerformanceCaveat:false});
    if(!gl) return false;
    const ok=!!gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  }catch(e){ return false }
}

const MAP3D_PITCH=58;
const MAP3D_COMPACT=matchMedia("(pointer: coarse)").matches||/iP(?:hone|ad|od)/.test(navigator.userAgent||"");
/* The 3D engine is ~260 KB of modules and a worker. Fetch and evaluate it
   while the page is idle after start-up, on devices that can run it, so the
   first switch to 3D does not start with a download. */
function preloadMaplibre(){
  if(maplibreModule||navigator.connection?.saveData) return;
  const go=()=>{ if(maplibreModule||!webgl2Capable()) return;
    maplibreModule=import("./vendor/maplibre-gl.mjs").catch(error=>{ maplibreModule=null;throw error });
    /* prewarm() starts MapLibre's tile workers too - each loads its own copy
       of the shared module - so they are parsed and waiting when 3D opens. */
    maplibreModule.then(module=>{ try{ module.prewarm?.() }catch(error){} },()=>{});loadMaplibreStyles() };
  ("requestIdleCallback" in window)?requestIdleCallback(go,{timeout:8000}):setTimeout(go,4000);
}
addEventListener("load",()=>setTimeout(preloadMaplibre,2500),{once:true});
let maplibreStyles=null;
function loadMaplibreStyles(){
  return maplibreStyles||(maplibreStyles=new Promise(resolve=>{
    const link=document.createElement("link");link.rel="stylesheet";link.href="vendor/maplibre-gl.css";
    link.onload=link.onerror=()=>resolve();document.head.append(link);
  }));
}
async function enterTerrain3d(){
  if(map3d||map3dLoading) return map3dLoading;
  if($("#terStyle").value==="off"&&!elevationActive()){ $("#terStyle").value="hs";syncTerrainLookControls();saveTerrainPrefs();applyTerrain(true);announceLayers() }
  setTerrainModeUi(true,"Starting the GPU terrain viewer…");
  map3dWanted=true;
  map3dLoading=(async()=>{
    /* The 3D stylesheet arrives with the 3D module rather than blocking the
       first paint of every visit that never opens 3D. */
    const [module]=await Promise.all([maplibreModule||(maplibreModule=import("./vendor/maplibre-gl.mjs").catch(error=>{ maplibreModule=null;throw error })),loadMaplibreStyles()]);
    /* MapLibre removed the `supported()` helper in v5; the vendored 6.6.0 does
       not export it, so `module.supported?.()` was always undefined and this
       guard threw on every device — 3D could never start. Probe WebGL2
       directly instead, which is what that helper used to do. */
    if(!webgl2Capable()) throw new Error("This device does not provide the WebGL2 features required for 3D terrain.");
    await installMaplibreProtocols(module);
    const center=map.getCenter(),bearing=map.getBearing?.()||0;
    /* Opens looking straight down - the tiles under the view are all the
       first frame needs - and tilts once that frame is up, so the horizon's
       tiles stream in behind a motion instead of in front of a spinner. */
    map3d=new module.Map({container:"map3d",style:terrainRasterStyle(),center:[center.lng,center.lat],zoom:map.getZoom(),bearing,pitch:0,
      /* scrollZoom is off so one handler owns the wheel in either view, with the
         settle that keeps the 3D rest state on a native level instead of the
         1.41x upscale MapLibre's own easing would leave it on. */
      /* Phones: 3x pixel density with 4x multisampling is several times the
         GPU memory of a laptop's view, and iOS answers memory pressure by
         dropping textures - black tiles. Render at up to 2x there, without
         MSAA; desktops keep full density and antialiasing. */
      pixelRatio:MAP3D_COMPACT?Math.min(2,Number(devicePixelRatio)||1):undefined,
      maxZoom:22,maxPitch:85,renderWorldCopies:false,scrollZoom:false,canvasContextAttributes:{antialias:!MAP3D_COMPACT,powerPreference:"high-performance"},
      attributionControl:true,fadeDuration:0});
    /* MapLibre 6's jumpTo looks up the ground under the centre at the requested
       zoom itself, and a fractional zoom names no tile, so the lookup returns 0.
       Every eased wheel/pinch frame (setZoom -> jumpTo) therefore dropped the
       camera to sea level - underground once zoomed past ~z16 - and the whole
       view went to the blank background until the zoom settled on a level.
       Supply the elevation from the whole tile level instead. The lookup also
       reads 0 when that level's tile under the centre is not resident (zooming
       out past it), so then keep the current elevation: zooming about the
       centre does not change the ground beneath it. MapLibre 6 routes the map's
       setZoom/jumpTo through its internal camera, so that is what is wrapped. */
    {
      const camera=map3d._camera||map3d,jumpTo=camera.jumpTo;
      camera.jumpTo=function(options,eventData){
        if(options&&"zoom" in options&&!("elevation" in options)&&this.terrain){
          const center=options.center!=null?module.LngLat.convert(options.center):this.transform.center;
          const ground=this.terrain.getElevationForLngLatZoom(center,Math.floor(options.zoom));
          options={...options,elevation:ground||this.transform.elevation};
        }
        return jumpTo.call(this,options,eventData);
      };
    }
    initGpu3d(module);
    window.CSPMarkup?.attach3d(module,map3d);
    map3d.on("movestart",mark3dGlassMotion);map3d.on("move",mark3dGlassMotion);
    map3d.on("move",syncLocationPin);map3d.on("idle",syncLocationPin);
    map3d.on("move",cursorCameraMoved);map3d.on("idle",cursorCameraIdle);
    map3d.on("rotate",syncBearingButton);map3d.on("pitch",syncBearingButton);
    map3d.on("moveend",scheduleTerrainStatus);map3d.on("idle",scheduleTerrainStatus);
    map3d.on("load",()=>{setTerrainModeUi(true);map3d.resize();
      if(map3d.getPitch()<1) map3d.easeTo({pitch:MAP3D_PITCH,duration:matchMedia("(prefers-reduced-motion: reduce)").matches?0:1100})});
    map3d.on("error",event=>{if(event?.error) console.warn("3D terrain:",event.error)});
    /* Overview tiles that come back into view, or finish decoding after their
       3DEP already landed, still need their refresh; a refined tile's load
       queues its neighbours' (see meshStale). */
    meshStaleClear();map3d.on("moveend",meshRefineAgain);
    map3d.on("sourcedata",meshSourceData);
    map3d.on("moveend",pruneMeshRequests);
    if(!map3dWanted){ map3d.remove(); map3d=null; return null }   // left 3D while loading
    map.keyboard?.disable();return map3d;
  })().catch(error=>{console.warn(error);map3d?.remove();map3d=null;setTerrainModeUi(false,error.message||"3D terrain could not start.");throw error})
    .finally(()=>{map3dLoading=null});
  return map3dLoading;
}
function exitTerrain3d(){
  reset3dGlassMotion();map3dWanted=false;
  map3dStylePending=null;
  clearTimeout(map3dLightTimer);
  elevCacheClear();
  if(!map3d){setTerrainModeUi(false);return}
  const center=map3d.getCenter(),zoom=map3d.getZoom(),bearing=map3d.getBearing();
  map3d.remove();map3d=null;gpu3d=null;clearTimeout(map3dStyleTimer);map.setView([center.lat,center.lng],zoom,{animate:false});map.setBearing?.(bearing);
  map.keyboard?.enable();setTerrainModeUi(false);map.invalidateSize({pan:false});
}
function refresh3dStyle(){
  if(!map3d)return;
  const current=map3d;
  if(map3dStylePending?.map===current){map3dStylePending.again=true;return;}
  const center=current.getCenter(),camera={center:[center.lng,center.lat],zoom:current.getZoom(),bearing:current.getBearing(),pitch:current.getPitch(),elevation:current.getCenterElevation()};
  const pending={map:current,again:false};map3dStylePending=pending;
  const style=terrainRasterStyle();
  // The outgoing terrain's depth pass must not run against the new style
  // before its projection exists. New terrain initialization resets focal
  // elevation, so restore the complete camera after style.load.
  current.setTerrain(null);
  current.once("style.load",()=>{
    if(map3d!==current||map3dStylePending!==pending)return;
    current.jumpTo(camera);map3dStylePending=null;
    if(pending.again||map3dBuiltKey!==map3dStructureKey())refresh3dStyle();
  });
  current.setStyle(style,{diff:false});
}
/* A lighting change does not need a new style. Rebuilding with {diff:false}
   tears down every source and layer and refetches all of them, which is why
   dragging a slider used to stutter. Hillshade lighting is paint state, and
   relief is a terrain property; both can be set in place. Only the analytical
   styles need new tiles, because their color is baked into the raster. */
function analyticalStyle(){ const v=$("#terStyle").value; return v!=="off"&&v!=="hs"&&v!=="hsmulti" }

/* Sun, relief and sky are all paint state, so a slider drag repaints them in
   place; only the analytical styles need new tiles, because their color is baked
   into the raster. Both callers below share these so the live path and the
   freshly-built style can never drift apart. */
function paint3dSky(light){ map3d?.setSky?.(terrainSky(terrainTheme(),light)) }
function paint3dHillshade(light,opacity,style){
  if(!map3d?.getLayer("terrain-hillshade")) return;
  const multi=style==="hsmulti";
  map3d.setPaintProperty("terrain-hillshade","hillshade-illumination-direction",
    multi?[light.azimuth,(light.azimuth+90)%360,(light.azimuth+180)%360,(light.azimuth+270)%360]:light.azimuth);
  map3d.setPaintProperty("terrain-hillshade","hillshade-illumination-altitude",
    multi?[light.altitude,light.altitude,light.altitude,light.altitude]:light.altitude);
  map3d.setPaintProperty("terrain-hillshade","hillshade-exaggeration",Math.max(.05,Math.min(1,opacity*1.15)));
  map3d.setPaintProperty("terrain-hillshade","hillshade-shadow-color",`rgba(22,28,36,${Math.max(.2,1-light.ambient).toFixed(2)})`);
  map3d.setPaintProperty("terrain-hillshade","hillshade-highlight-color",`rgba(255,247,235,${Math.max(.3,Math.min(1,opacity*1.1)).toFixed(2)})`);
}
function apply3dLighting(){
  if(!map3d||!map3d.isStyleLoaded?.()) return false;
  if(map3dBuiltKey!==map3dStructureKey()) return false;
  const light=terrainLighting(),opacity=terrainOpacity()/100,style=$("#terStyle").value;
  try{
    if(map3d.getTerrain()?.exaggeration!==light.exaggeration)map3d.setTerrain({source:"dem",exaggeration:light.exaggeration});
    if(gpu3d?.enabled){
      const actual=style==="off"?"hs":style,pick=chooseTerrain(actual),spectrumAlone=style==="off"&&elevationActive();
      const plain=(actual==="hs"||actual==="hsmulti")&&!studioStack(style);
      const visible={"terrain-analysis":!plain,"terrain-hillshade":plain,
        "terrain-relief":!spectrumAlone&&(plain||!studioStack(style)&&pick.src==="wadnr"),"elev-spectrum":elevationActive()};
      for(const [id,on] of Object.entries(visible))if(map3d.getLayer(id)&&map3d.getLayoutProperty(id,"visibility")!==(on?"visible":"none"))map3d.setLayoutProperty(id,"visibility",on?"visible":"none");
      map3d.setPaintProperty("terrain-hillshade","hillshade-method",actual==="hsmulti"?"multidirectional":"standard");
      gpu3d.update();
    }
    paint3dHillshade(light,opacity,style);
    if(gpu3d?.enabled&&style==="off"&&elevationActive()&&map3d.getLayer("terrain-hillshade")){
      map3d.setPaintProperty("terrain-hillshade","hillshade-exaggeration",.45);
      map3d.setPaintProperty("terrain-hillshade","hillshade-highlight-color","rgba(255,255,255,0)");
    }
    paint3dSky(light);
    if(map3d.getLayer("terrain-analysis")) map3d.setPaintProperty("terrain-analysis","raster-opacity",opacity);
    if(map3d.getLayer("wadnr-drape")) map3d.setPaintProperty("wadnr-drape","raster-opacity",opacity);
    return gpu3d?.enabled||!analyticalStyle();
  }catch(e){ return false }
}

function schedule3dStyle(){
  if(!map3d) return;
  if(gpu3d?.enabled&&apply3dLighting())return;
  clearTimeout(map3dLightTimer);
  map3dLightTimer=setTimeout(()=>{
    if(apply3dLighting()) return;       // handled in place
    clearTimeout(map3dStyleTimer);
    map3dStyleTimer=setTimeout(refresh3dStyle,90);
  },60);
}
$("#terMode2d").onclick=()=>{ pointCloudPanel?.close();exitTerrain3d() };
$("#terMode3d").onclick=()=>{ pointCloudPanel?.close();enterTerrain3d().catch(()=>{}) };
pointCloudPanel=CSPPointCloud.install({map,onBearingChange:syncBearingButton,
  beforeOpen:()=>{
    if(document.body.classList.contains("dnr-selecting")&&!dnrBusy){clearDnrSelection();paintDnrAreas()}
    exitTerrain3d();if(compactSidebar())setCollapsed(true)
  },
  onLayoutChange:source=>syncFloatingPanels(source)});

/* is the local proxy there? without it, WA DNR simply isn't reachable */
