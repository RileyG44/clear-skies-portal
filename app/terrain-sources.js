/* ====================================================== terrain / lidar
   Two sources, deliberately different jobs:
     3DEP   - national, CORS-clean, server-side rendering rules (hillshade,
              slope, aspect, contours). Requested straight from the browser.
     WA DNR - the state's own lidar hillshades at native project resolution,
              newer and sharper than the national blend in many places. No
              CORS, and 962 layers in one service, so it goes through the
              local proxy and is restricted to the exact project layers that
              cover the view.                                              */
const MOBILE = matchMedia("(max-width:760px)");
const MERC_R = 20037508.342789244;
/* keepBuffer holds tiles just outside the viewport so a short pan doesn't
   discard and re-fetch them; the transparent errorTileUrl stops a failed
   lidar tile from flashing a broken image. Terrain loads while a pan is still
   moving (every 300 ms) rather than only once it stops. */
const TILE_OPTS = { keepBuffer:2, updateWhenZooming:false, updateWhenIdle:false, updateInterval:300,
  crossOrigin:true, tileRetries:4 };
/* Scene imagery comes from third-party tilers (titiler.xyz among them) that
   send no Access-Control-Allow-Origin. Asking for crossOrigin there blocks the
   tile outright, so imagery takes the same buffering and error handling as the
   local layers but not that flag. */
const IMG_TILE_OPTS = {...TILE_OPTS, crossOrigin:false};
const DEP_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
/* Sharp on high-density screens. A 256 px tile on a 2x or 3x display is
   stretched over four or nine physical pixels, which is the soft, low-res look
   of zoomed-out terrain. Services that render an image for a bounding box
   (ArcGIS exports: 3DEP, WA DNR LiDAR, USGS labels) are simply asked for 512 px
   of the same area - same request count, labels at the same size (dpi 192).
   Elevation tiles are fixed at 256 px, so the elevation layer instead draws
   each tile at 128 CSS px from the next zoom down (see ElevLayer). */

const EXPORT_PX=HIDPI?512:256, EXPORT_DPI=HIDPI?192:96;
const DEP_RULE = { hs:"Hillshade Gray", hsmulti:"Hillshade Multidirectional",
                   tint:"Hillshade Elevation Tinted", slope:"Slope Map", aspect:"Aspect Map",
                   northness:"Aspect Map",
                   c2:"Preset 2ft Contour Interval", c5:"Preset 5ft Contour Interval",
                   c10:"Preset 10ft Contour Interval", c25:"Contour Smoothed 25" };
const STYLE_NAME = { hs:"Hillshade", hsmulti:"Hillshade (multi-directional)", tint:"Elevation tinted", rem:"Relative elevation",
                     slope:"Slope", aspect:"Aspect", northness:"North–south exposure", c2:"2 ft contours", c5:"5 ft contours",
                     c10:"10 ft contours", c25:"25 ft contours" };
/* WA DNR publishes one pre-rendered DTM hillshade. It cannot honestly stand in
   for local multidirectional, tint, slope, aspect, or contour calculations. */
const WADNR_OK = new Set(["hs"]);

function tileMerc(c){                       // slippy tile -> web-mercator bbox
  const n=Math.pow(2,c.z), s=2*MERC_R/n;
  const x0=-MERC_R+c.x*s, y1=MERC_R-c.y*s;
  return [x0, y1-s, x0+s, y1];
}

const DepLayer = ResilientTileLayer.extend({
  getTileUrl(c){
    const b=tileMerc(c).join(",");
    const rr=encodeURIComponent(JSON.stringify({rasterFunction:this.options.rule}));
    return `${DEP_URL}?bbox=${b}&bboxSR=3857&imageSR=3857&size=${EXPORT_PX},${EXPORT_PX}`
         + `&format=png&transparent=true&f=image&renderingRule=${rr}`;
  },
  getFallbackTileUrl(c){
    if(!PROXY) return null;
    return api(`/api/3dep?bbox=${tileMerc(c).join(",")}&rule=${encodeURIComponent(this.options.rule)}&size=${EXPORT_PX}`);
  }
});
/* USGS 3DEP 1 m DEMs, rendered from elevation by the local server. Unlike the
   two scraped sources this returns the real raster, so any style works at any
   zoom; 204 means no federal coverage for that tile and the layer underneath
   shows through. Needs server.js — the S3 bucket sets no CORS header. */
const UsgsLayer = ResilientTileLayer.extend({
  getTileUrl(c){ return api(`/api/usgs/tile/${this.options.style}/${c.z}/${c.x}/${c.y}.png?rv=terrain-v3&${RAW_COVERAGE_QUERY}`) }
});

/* Layer count barely changes how long WA DNR takes per tile, but it changes
   coverage a lot (measured: 1 layer 13%, 2 layers 42%, 4 layers 60% of a
   20-tile view filled), so ask for as many projects as plausibly overlap. */
const WA_PER_TILE = 8;

/* Preserve the same export scale when increasing image density. Engines that
   predate the dpi parameter always sent 96, so they only receive 256 px. The
   current DNR MapServer renders exports dynamically (not a fused tile cache). */
const waSharpPx=()=>serverHealth?.features?.includes("wadnr-dpi")?EXPORT_PX:256;
function waTileUrl(c,all,px=256){
  const b=tileMerc(c);
  const hit=all.filter(id=>{
    const e=WA_EXTENT[id];
    return !e || !(e[2]<b[0] || e[0]>b[2] || e[3]<b[1] || e[1]>b[3]);
  }).slice(0,WA_PER_TILE);
  const ids=(hit.length?hit:all.slice(0,WA_PER_TILE)).join(",");
  return api(`/api/wadnr/export?bbox=${b.join(",")}&size=${px},${px}&dpi=${Math.round(96*px/256)}&layers=${ids}`);
}
function depProxyTileUrl(c,style,px=256){
  return api(`/api/3dep?bbox=${tileMerc(c).join(",")}&rule=${encodeURIComponent(DEP_RULE[style]||DEP_RULE.hs)}&size=${px}`);
}

const WaLayer = ResilientTileLayer.extend({
  getTileUrl(c){ return waTileUrl(c,this.options.ids) }
});

/* A single canvas per coordinate composes the complete national product and a
   sharper local refinement. This is a true fallback: the baseline shows only
   through transparent detail pixels, rather than two translucent Leaflet
   layers darkening one another. It also lets a slow raw tile refine in place
   without ever replacing good pixels with a loading checkerboard. */
/* Sharp second passes wait their turn behind every first pass: a few at a
   time, newest first, so after a pan the tiles now on screen sharpen before
   ones that were left behind. Cancelled tiles drop out of the queue. */
const compositeFirstPass={active:0,start(){ this.active++ },end(){ if(--this.active===0) compositeSharpen.kick() }};
const compositeSharpen=(()=>{
  const queue=[];let active=0;
  const next=()=>{
    /* Only once every tile has its first pass: a sharper copy of what is on
       screen never takes the engine's time from a tile still showing nothing. */
    while(active<4&&queue.length&&!compositeFirstPass.active){
      const item=queue.pop();
      if(item.signal.aborted){ item.resolve();continue }
      active++;
      Promise.resolve().then(item.run).catch(()=>{}).then(()=>{ active--;item.resolve();next() });
    }
  };
  const sharpen=(signal,run)=>new Promise(resolve=>{ queue.push({signal,run,resolve});next() });
  sharpen.kick=next;
  return sharpen;
})();
const CompositeTerrainLayer = L.GridLayer.extend({
  initialize:function(opts){ L.setOptions(this,opts); this._pending=new Map();
    this.on("tileunload",event=>{
      const key=this._tileCoordsToKey(event.coords),job=this._pending.get(key);
      if(job){ job.controller.abort(); for(const bitmap of job.bitmaps) if(bitmap.close) bitmap.close(); this._pending.delete(key) }
      releaseCanvas(event.tile);
    });
  },
  _bitmap:async function(blob){
    if(typeof createImageBitmap==="function") return createImageBitmap(blob);
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(blob),img=new Image();
      img.onload=()=>{ URL.revokeObjectURL(url); resolve(img) };
      img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error("image decode failed")) };
      img.src=url;
    });
  },
  _fetch:async function(url,controller,attempt=0){
    const requestController=new AbortController();
    const abort=()=>requestController.abort();
    controller.signal.addEventListener("abort",abort,{once:true});
    const timeout=setTimeout(()=>requestController.abort(),15000);
    try{
      const response=await fetch(url,{signal:requestController.signal,cache:"default"});
      const softError=response.headers.get("X-CSP-Error");
      if(response.ok&&!softError){
        if(response.headers.get("X-Coverage")==="none") return null;
        return this._bitmap(await response.blob());
      }
      if(attempt>=3||(!softError&&![429,500,502,503,504].includes(response.status))) return null;
      const retry=Math.max(400,Math.min(5000,(+response.headers.get("Retry-After")||0)*1000||500*Math.pow(2,attempt)));
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(resolve,retry+Math.random()*160);
        controller.signal.addEventListener("abort",()=>{ clearTimeout(timer);reject(new DOMException("Aborted","AbortError")) },{once:true});
      });
      return this._fetch(url,controller,attempt+1);
    }catch(error){
      if(controller.signal.aborted||attempt>=3) return null;
      await new Promise(resolve=>setTimeout(resolve,500*Math.pow(2,attempt)+Math.random()*160));
      return this._fetch(url,controller,attempt+1);
    }finally{
      clearTimeout(timeout); controller.signal.removeEventListener("abort",abort);
    }
  },
  createTile:function(coords,done){
    /* Backed at twice its CSS size on high-density screens, to hold the 512 px
       exports (see EXPORT_PX) without resampling them away. */
    const css=this.getTileSize(),density=EXPORT_PX/256,size=L.point(css.x*density,css.y*density);
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
    canvas.width=size.x;canvas.height=size.y;
    const key=this._tileCoordsToKey(coords),controller=new AbortController();
    const job={controller,bitmaps:new Set(),base:null,detail:null,settled:false};
    this._pending.set(key,job);
    const repaint=()=>{
      if(controller.signal.aborted) return;
      ctx.clearRect(0,0,size.x,size.y);
      // Record actual alpha contributions; a successful transparent detail
      // response must never be labelled as rendered WA LiDAR.
      let basePixels=null,detailPixels=null;
      if(job.detail){ctx.drawImage(job.detail,0,0,size.x,size.y);detailPixels=ctx.getImageData(0,0,size.x,size.y).data;ctx.clearRect(0,0,size.x,size.y)}
      if(job.base) ctx.drawImage(job.base,0,0,size.x,size.y);
      if(job.base)basePixels=ctx.getImageData(0,0,size.x,size.y).data;
      if(job.detail) ctx.drawImage(job.detail,0,0,size.x,size.y);
      let baseCount=0,detailCount=0;
      for(let i=3;i<size.x*size.y*4;i+=4){const d=(detailPixels?.[i]||0)/255;detailCount+=d;baseCount+=(basePixels?.[i]||0)/255*(1-d)}
      canvas._cspSourceCounts={2:baseCount,4:detailCount};
      canvas.dataset.cspElevationSource=[4,2].filter(rank=>canvas._cspSourceCounts[rank]>0).map(rank=>CSPPublicTerrain.SOURCES[rank].label).join(" + ");
      /* ArcGIS sometimes answers 200 with a syntactically valid but completely
         transparent PNG. Treating that as a loaded tile is what left permanent
         blank squares at close zoom. Inspect alpha after the single composite
         and only promote pixels that actually exist. */
      if(job.base||job.detail){
        const pixels=ctx.getImageData(0,0,size.x,size.y).data;
        canvas._cspHasContent=false;
        for(let alpha=3;alpha<pixels.length;alpha+=4) if(pixels[alpha]){canvas._cspHasContent=true;break}
      }
      if(!job.settled&&canvas._cspHasContent){ job.settled=true; done(null,canvas) }
      this.fire("tilerefine",{tile:canvas,coords});
    };
    const take=(kind,url)=>this._fetch(url,controller).then(bitmap=>{
      if(controller.signal.aborted){ if(bitmap&&bitmap.close) bitmap.close(); return }
      if(bitmap){ job.bitmaps.add(bitmap);job[kind]=bitmap;repaint() }
    });
    const baseUrl=this.options.baseUrl(coords),detailUrl=this.options.detailUrl(coords);
    /* Keep enough non-rendering metadata for the server panel and automated QA
       to explain a failed tile without scraping opaque canvas pixels. */
    canvas._cspCoords={x:coords.x,y:coords.y,z:coords.z};
    canvas._cspSourceResolution={2:sourceSampleMeters(coords),4:sourceSampleMeters(coords)};
    canvas._cspRefining=true;
    canvas.dataset.cspZ=String(coords.z);canvas.dataset.cspRenderer="composite";
    canvas._cspUrls={base:baseUrl,detail:detailUrl};
    const base=take("base",baseUrl),detail=take("detail",detailUrl);
    compositeFirstPass.start();
    Promise.allSettled([base,detail]).then(()=>compositeFirstPass.end());
    const finish=()=>{
      for(const bitmap of job.bitmaps) if(bitmap.close) bitmap.close();
      job.bitmaps.clear();
      if(this._pending.get(key)===job) this._pending.delete(key);
      canvas._cspRefining=false;canvas._cspRefineFailed=!job.detail;
      this.fire("tilerefine",{tile:canvas,coords});
    };
    Promise.allSettled([base,detail]).then(()=>{
      if(controller.signal.aborted) return;
      /* Never report a transparent, failed composite as a loaded tile. That
         permanently cached a black/empty square and let an incomplete layer
         replace the last healthy viewport. */
      if(!job.settled){ job.settled=true;done(new Error("terrain sources returned no pixels"),canvas) }
      /* The first pass is the 256 px export every engine has cached, so the
         map fills as fast as it always did. The sharp 512 px copy of whichever
         source is on top follows at low priority and replaces it in place. */
      const sharp=this.options.sharpPx?.()||{};
      // By pixels drawn, not responses: outside a survey WA DNR answers with
      // a transparent image, and then 3DEP is the source worth sharpening.
      const counts=canvas._cspSourceCounts||{};
      const kind=counts[4]>0?(sharp.detail>256?"detail":null):counts[2]>0&&sharp.base>256?"base":null;
      if(!kind) return finish();
      const url=this.options[kind+"Url"](coords,sharp[kind]);
      compositeSharpen(controller.signal,()=>this._fetch(url,controller).then(bitmap=>{
        if(controller.signal.aborted){ if(bitmap&&bitmap.close) bitmap.close(); return }
        if(!bitmap) return;
        const old=job[kind];job.bitmaps.add(bitmap);job[kind]=bitmap;
        if(old){ job.bitmaps.delete(old);if(old.close) old.close() }
        canvas._cspUrls[kind]=url;repaint();
      })).finally(()=>{ if(!controller.signal.aborted) finish() });
    });
    return canvas;
  }
});

CompositeTerrainLayer.prototype._cspExpensive=true;   // loads once per pinch, at lift-off

/* Where server.js lives. Empty means "same origin as this page", which is the
   case when the Mac serves the page itself. Hosted elsewhere (GitHub Pages, the
   home screen app) it can point at a reachable copy — a Tailscale address, say
   — and server.js explicitly allows this GitHub Pages origin, so the
   cross-origin call is allowed without exposing the server to arbitrary sites. Everything that does not need the proxy keeps
   working regardless of what this is set to. */
/* A bare "my-mac.tail1234.ts.net" is not a URL: concatenated onto "/api/health"
   it becomes a path relative to this page, quietly 404s, and reports as
   "unreachable" while looking perfectly correct in the box. Give it a scheme. */
function normaliseBase(v){
  v = String(v||"").trim().replace(/\/+$/,"");
  if(!v) return "";
  if(!/^https?:\/\//i.test(v)) v = (location.protocol==="http:" ? "http://" : "https://") + v;
  try{
    const u=new URL(v);
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password) return "";
    const tail=u.pathname.replace(/\/+$/,"");
    return u.origin+(tail&&tail!=="/"?tail:"");
  }catch(e){ return "" }
}
function takeSharedServerBase(){
  const hash=new URLSearchParams(location.hash.slice(1));
  if(!hash.has("engine")) return "";
  const shared=normaliseBase(hash.get("engine"));
  hash.delete("engine");
  history.replaceState(null,"",location.pathname+location.search+(hash.size?"#"+hash.toString():""));
  return shared;
}
const SHARED_SERVER=takeSharedServerBase();
/* Inside the iPhone app (docs/ios CR-001) the engine address belongs to the
   app, which keeps what is entered here on the device. Every /api request stays
   relative and the app forwards it to that address, so nothing is cross-origin
   and the engine needs no change. Anywhere else CSPNativeHost does not exist
   and none of this behaves differently. */
const NATIVE_HOST=window.CSPNativeHost||null;
let nativeEngineSync=Promise.resolve();
let API = normaliseBase(NATIVE_HOST ? NATIVE_HOST.engineBase() : (SHARED_SERVER || localStorage.getItem("cspServer") || ""));
const api = p => (NATIVE_HOST ? "" : API) + p;
/* Bumped when the engine's 1 m coverage changes under an unchanged tile URL
   (2: projects crossing a UTM zone boundary were half-indexed; 3: an index
   with failed project listings answered "no 1 m here" for most of Washington
   from 2026-10-21). Those tiles are immutable in the browser cache, so this
   query lets corrected ones in. */
const RAW_COVERAGE_QUERY="ix=4";

let terLayer=null, terBase=null, PROXY=false, waCover=null, terTimer=null;
// One engine/store for both analytical terrain and elevation. The published
// DNR image layer retains its own path. No tile-pane layer uses z441..449:
// imagery is 410, terrain 440, spectrum 450 and research 455.
let gpuTerrainLayer=null,gpuTerrainStore=null,gpuTerrainEnabled=false,gpuTerrainDecided=false,gpuSourceKey=null,gpuTerrainOrderZ=null;
let gpuSourceSpecs=null,gpuSourceSpecsKey=null;
/* LiDAR Studio (lidar-studio.js) is mounted with the terrain controls below;
   until then, and without a GPU, terrain draws its classic look. */
let lidarStudio=null,studioFitTimer=0;
function studioStack(style,options){ return style&&style!=="off"&&lidarStudio?lidarStudio.stack(style,options):null }
/* Auto ranges follow the view once the terrain has settled after a pan. */
function scheduleStudioFit(){
  if(!lidarStudio?.needsFit())return;
  clearTimeout(studioFitTimer);
  studioFitTimer=setTimeout(()=>lidarStudio?.fitFromView(),450);
}
function initGpuTerrain(){
  if(gpuTerrainDecided)return gpuTerrainEnabled;
  gpuTerrainDecided=true;
  let storage;try{storage=localStorage}catch{}
  if(window.CSPGpuTerrainLayer?.resolveFlag(location.search,storage)&&window.CSPGpuTerrainStore&&L.cspGpuTerrainLayer){
    gpuTerrainStore=new CSPGpuTerrainStore.ElevationTileStore({
      sources:gpuElevationSources,request:gpuElevationRequest,
      maxBytes:(matchMedia("(pointer:coarse)").matches?64:192)*1024*1024});
    gpuTerrainLayer=L.cspGpuTerrainLayer({store:gpuTerrainStore,state:gpuTerrainState(),zIndex:440,
      maxTextureBytes:(matchMedia("(pointer:coarse)").matches?64:192)*1024*1024,
      panShading:window.CSPGpuTerrainLayer.panShadingMode(storage)});
    /* Settings → Smoother panning (CR-008). */
    document.addEventListener("csp:pan-shading",event=>gpuTerrainLayer?.setPanShading(event.detail?.mode));
    gpuTerrainEnabled=!!gpuTerrainLayer.getEngine();
    gpuTerrainLayer.on("render",scheduleStudioFit);
    gpuTerrainStore.on("error",scheduleTerrainStatus);
    if(!gpuTerrainEnabled){gpuTerrainLayer.destroy();gpuTerrainLayer=null;
      try{gpuTerrainStore.destroy()}catch{}gpuTerrainStore=null;}
  }
  document.documentElement.dataset.gpu2d=gpuTerrainEnabled?"on":"off";
  if(!gpuTerrainEnabled)lidarStudio?.refresh();
  return gpuTerrainEnabled;
}
function gpuElevationRequest(url,options={}){
  const {kind,...requestOptions}=options;
  return elevationRequests.request(url,signal=>(kind==="lerc"||url.includes("/exportImage?"))
    ?fetchPublicElevation(url,signal):fetchElevation(url,signal),requestOptions).then(tile=>tile||{
      // fetchElevation uses null for explicit X-Coverage:none / empty DEM.
      // Cache that confirmed absence; transport errors still reject/retry.
      grid:new Float32Array([NaN]),width:1,height:1,noCoverage:true});
}
function gpuElevationSources(){
  const options={...elevationSourceOptions(),fallbackNativeZoom:15,nationalNativeZoom:17,rawNativeZoom:18,refineOverview:true};
  const key=options.sourceKey+":"+(HIDPI?1:0);
  if(gpuSourceSpecs&&gpuSourceSpecsKey===key)return gpuSourceSpecs;
  gpuSourceSpecsKey=key;
  // buildSources' environment is the only adapter seam with Workstream D.
  const env={proxy:PROXY,api,dz:HIDPI?1:0,dnrTileAllowed,dnrRevision:dnrStatus?.revision||0,
    rawCoverageQuery:RAW_COVERAGE_QUERY,nationalUrl:CSPPublicTerrain.nationalUrl,sourceSampleMeters};
  if(CSPGpuTerrainStore.buildSources)return gpuSourceSpecs=CSPGpuTerrainStore.buildSources(options,env);
  // Contract-only fallback for stores without the optional builder. Native
  // grids stay native; no resampling or masking occurs on the display path.
  const sources=[],add=(id,rank,label,max,url,allowed,kind)=>sources.push({id,rank,label,
    nativeZoom:z=>Math.min(z,max),url,allowed,kind,group:rank===5?"dnr":rank===3?"detail":rank===2?"national":"overview",sharper:true});
  if(PROXY&&options.dnrEndpoint)add("dnr",5,"WA DNR elevation",18,(z,x,y)=>api(`${options.dnrEndpoint}/${z}/${x}/${y}.png?acquire=0&revision=${env.dnrRevision}`),dnrTileAllowed);
  if(PROXY&&options.rawEndpoint)add("raw",3,"USGS 3.3 ft",18,(z,x,y)=>api(`${options.rawEndpoint}/${z}/${x}/${y}.png?${RAW_COVERAGE_QUERY}`),c=>c.z-env.dz>=13);
  if(PROXY&&options.nationalEndpoint)add("national",2,"National elevation",17,(z,x,y)=>api(`${options.nationalEndpoint}/${z}/${x}/${y}.png`),()=>true);
  if(!PROXY)add("national",2,"USGS 3DEP elevation",18,(z,x,y)=>CSPPublicTerrain.nationalUrl({z,x,y}),()=>true,"lerc");
  add("overview",1,"Overview elevation",15,(z,x,y)=>options.fallback.replace("{z}",z).replace("{x}",x).replace("{y}",y),()=>true);
  return gpuSourceSpecs=sources;
}
function gpuTerrainState(){
  const style=$("#terStyle").value;
  const staging=terrainSwap?.displayedLayer===gpuTerrainLayer||terLayer===gpuTerrainLayer;
  const drawn=style!=="off"&&(chooseTerrain(style).src!=="wadnr"||staging)?style:"off";
  const state=CSPGpuTerrainLayer.buildState({style:drawn,
    opacity:terrainOpacity()/100,look:terrainLook(style),lighting:terrainLighting(),
    spectrum:elevationRenderSettings(),spectrumOpacity:1});
  const stack=drawn!=="off"?studioStack(drawn):null;
  if(stack)state.terrain.stack=stack;
  return state;
}
function syncGpuTerrain(){
  if(!gpuTerrainEnabled)return;
  const sourceKey=elevationSourceOptions().sourceKey;
  if(gpuSourceKey!==null&&gpuSourceKey!==sourceKey){
    // SourceSpecs invalidate only changed URLs, ranks and validity masks.
    // Keeping the other native grids avoids blanking the whole viewport when
    // DNR availability changes or a source preference is updated.
    gpuTerrainLayer.redraw();
  }
  gpuSourceKey=sourceKey;
  const state=gpuTerrainState();gpuTerrainLayer.setState(state);
  const active=state.terrain.style!=="off"||elevationActive();
  // Published DNR images keep the existing spectrum-over-image order.
  gpuTerrainLayer.setZIndex(gpuTerrainOrderZ??(state.terrain.style==="off"&&$("#terStyle").value!=="off"?450:440));
  if(active&&!map.hasLayer(gpuTerrainLayer))gpuTerrainLayer.addTo(map);
  else if(!active&&map.hasLayer(gpuTerrainLayer))map.removeLayer(gpuTerrainLayer);
  scheduleTerrainStatus();
}
function terrainLayerSummary(layer){
  if(!gpuTerrainEnabled||layer&&layer!==gpuTerrainLayer)return CSPPublicTerrain.summarize(Object.values(layer?._tiles||{}));
  if(!map.hasLayer(gpuTerrainLayer))return {sources:[],coverage:0,total:0,ready:0,refining:false,failed:false};
  const status=gpuTerrainLayer.settled(),provenance=gpuTerrainLayer.provenance()||{},ranks=provenance.ranks||{};
  const total=Object.values(ranks).reduce((sum,n)=>sum+n,0);
  const sources=Object.entries(ranks).filter(([rank,n])=>n>0&&CSPPublicTerrain.SOURCES[rank]).sort((a,b)=>b[0]-a[0])
    .map(([rank,n])=>({...CSPPublicTerrain.SOURCES[rank],rank:+rank,pixels:n,percent:total?100*n/total:0,
      surveys:provenance.surveys||[],sampleMeters:provenance.sampleMeters?.[rank]}));
  return {sources,coverage:Math.round(status.ratio*100),total:status.total,ready:status.complete,refining:status.refining,failed:!!status.failed};
}
let probeToken=0, terrainQueryToken=0, serverHealth=null, serverProbeTimer=null;
let waCoverageState="unknown",waCoverageError="",dnrStatus=null,dnrStatusTimer=null,dnrLastError="",dnrRenderedRevision=-1;
const dnrElevationAvailable=()=>PROXY&&serverHealth?.features?.includes("wadnr-elevation");
/* Prefer WA DNR already held by the engine, including explicit downloads.
   Tile reads stay cache-only; dnr-auto.js coordinates opt-in gap acquisition.
   Device-local areas record downloads/outlines, not permission to render. */
const DNR_AREA_KEY="clearskies.wadnrAreas.v1";
let dnrAreas=(()=>{try{const v=JSON.parse(localStorage.getItem(DNR_AREA_KEY)||"[]");
  return Array.isArray(v)?v.filter(a=>Array.isArray(a?.bbox)&&a.bbox.length===4&&a.bbox.every(Number.isFinite)&&a.bbox[0]<a.bbox[2]&&a.bbox[1]<a.bbox[3]):[]}catch{return[]}})();
function saveDnrAreas(){try{localStorage.setItem(DNR_AREA_KEY,JSON.stringify(dnrAreas))}catch{}}
function dnrAreasKey(){return dnrAreas.map(a=>a.bbox.map(v=>v.toFixed(5)).join(",")).join(";")}
function tileBbox(z,x,y){const n=2**z,lon=xx=>xx/n*360-180,lat=yy=>Math.atan(Math.sinh(Math.PI*(1-2*yy/n)))*180/Math.PI;
  return [lon(x),lat(y+1),lon(x+1),lat(y)]}
function bboxIntersects(a,b){return a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1]}
function bboxContains(outer,inner){return outer[0]<=inner[0]&&outer[1]<=inner[1]&&outer[2]>=inner[2]&&outer[3]>=inner[3]}
function dnrBboxAllowed(bbox){
  if(!dnrElevationAvailable()||$("#terSrc").value!=="auto")return false;
  const cached=dnrStatus?.cachedBounds;
  // Older engines expose only a file count. Probe their cache-only endpoint
  // rather than hiding useful data from a device without a download record.
  if(!Array.isArray(cached)&&dnrStatus?.files!==0)return true;
  const valid=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3];
  return (Array.isArray(cached)?cached:[]).some(b=>valid(b)&&bboxIntersects(bbox,b))||dnrAreas.some(a=>bboxIntersects(bbox,a.bbox));
}
function dnrTileAllowed(coords){return dnrBboxAllowed(tileBbox(coords.z,coords.x,coords.y))}
function elevationSourceOptions(){
  const want=$("#terSrc").value;
  const dnr=want==="auto"&&dnrElevationAvailable();
  return {nationalEndpoint:"/api/elev/national",rawEndpoint:want==="3dep"?null:"/api/usgs/elev",
    dnrEndpoint:dnr?"/api/wadnr/elev":null,dnrAcquire:false,dnrMaskKey:dnr?"available-v1":"",
    fallback:overviewElevationUrl("{z}","{x}","{y}"),
    sourceKey:[want,dnr?`dnr:available-v1:${dnrStatus?.revision||0}:${dnrAreasKey()}`:"",PROXY?API:"public",
      serverHealth?.features?.includes("overview-elevation")?"overview-cache":"overview-direct"].join("|")};
}
function dnrAcquisitionText(){
  const active=dnrStatus?.active;
  if(!active)return dnrLastError?`DNR elevation unavailable · ${dnrLastError}`:"";
  if(active.state==="restoring")return `Loading DNR elevation from iCloud · ${active.project}`;
  if(active.state==="archiving")return "Moving older DNR elevation to iCloud to make room";
  return active.state==="preparing"?`Preparing DNR elevation overviews · ${active.project}`:
    `Downloading DNR elevation · ${active.project}${active.bytes?` · ${(active.bytes/1048576).toFixed(0)} MiB`:""}`;
}
function scheduleDnrStatus(){
  if(dnrStatusTimer)return;
  dnrStatusTimer=setTimeout(async()=>{
    dnrStatusTimer=null;
    if(!dnrElevationAvailable())return;
    if($("#terStyle").value==="off"&&!elevationActive()&&!document.body.classList.contains("terrain-3d"))return;
    try{
      const response=await fetch(api("/api/wadnr/status"),{signal:AbortSignal.timeout(8000),cache:"no-store"});
      if(response.ok){
        const value=await response.json(),changed=value.revision!==dnrRenderedRevision;
        dnrStatus=value;
        if(changed){dnrRenderedRevision=value.revision;resetMeshSources();applyTerrain(true);if(elevationActive())applyElev();schedule3dStyle();}
        scheduleTerrainStatus();paintTerrainInfo();
      }
    }catch{}
    scheduleDnrStatus();
  },5000);
}
