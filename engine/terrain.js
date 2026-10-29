/* Terrain the engine renders or decodes on its worker pool: hillshade and
   style tiles from raw 1 m lidar, elevation tiles for the browser's shaders,
   landform fabric, and viewport DEM analysis. Identical jobs are shared, and
   an abandoned job is cancelled only when its last viewer has gone. */
"use strict";
const crypto = require("crypto");
const usgs = require("../usgs.js");
const cog = require("../cog.js");
const cacheBudgetCore = require("../cache-budget.js");
const researchAnalysis = require("../research-analysis.js");
const {TerrainPoolError} = require("../terrain-pool.js");
const {tileBounds:dnrTileBounds} = require("../wadnr.js");
const {HttpError,readBody,send,jsonBody} = require("./http.js");
const {TRANSPARENT,SEA_LEVEL_DEM,isPng,isTiff} = require("./images.js");
const {DEP_HOST,upstream,slot,release,limitedUpstream,terrainAborted} = require("./upstream.js");
const {TTL_TILE,key,cacheGet,cachePut} = require("./tile-cache.js");
const {validBbox} = require("./params.js");
const mercBbox=cacheBudgetCore.mercBbox;

const MAX_ANALYSIS_BODY = researchAnalysis.LIMITS.maxCells*4;
const ANALYSIS_CACHE_LIMIT = Math.max(8,Math.min(256,Number(process.env.CSP_ANALYSIS_CACHE_MB)||64))*1024*1024;
const ANALYSIS_CACHE_TTL = 10*60*1000;
const ANALYSIS_MIME = "application/vnd.clearskies.terrain-analysis";
const TERRAIN_RENDER_VERSION = "terrain-v3";   // v3: the "relief" elevation tint
const TERRAIN_STYLES = new Set(["hs","hsmulti","tint","slope","aspect","c2","c5","c10","c25"]);
const TERRAIN_DOWNLOAD_STYLES = new Set([...TERRAIN_STYLES,"northness"]);

let terrainPool = null, dnr = null;
function init(pool,dnrStore){ terrainPool=pool; dnr=dnrStore }
/* "No 1 m coverage" is final only when the index that said so was complete
   (usgs.coverageFinal). Answers cached without that mark may come from the
   incomplete index of October 2026, so they are asked again; a genuine gap
   costs one in-memory index lookup and is then stored with the mark. */
const NONE_FINAL = Object.freeze({final:true});
const staleNone = hit => !!hit && hit.status===204 && !(hit.sourceMeta && hit.sourceMeta.final);

/* Analysis frames are cheap to regenerate and tied to the exact uploaded DEM,
   so keep only a short, bounded memory LRU. They do not belong in the long-
   lived terrain tile cache. */
const analysisCache=new Map();let analysisCacheBytes=0;
function analysisCacheGet(cacheKey){
  const entry=analysisCache.get(cacheKey);if(!entry) return null;
  if(Date.now()-entry.at>ANALYSIS_CACHE_TTL){analysisCache.delete(cacheKey);analysisCacheBytes-=entry.body.length;return null}
  analysisCache.delete(cacheKey);analysisCache.set(cacheKey,entry);return entry.body;
}
function analysisCachePut(cacheKey,body){
  if(!Buffer.isBuffer(body)||body.length>ANALYSIS_CACHE_LIMIT) return;
  const previous=analysisCache.get(cacheKey);if(previous) analysisCacheBytes-=previous.body.length;
  analysisCache.delete(cacheKey);analysisCache.set(cacheKey,{body,at:Date.now()});analysisCacheBytes+=body.length;
  while(analysisCacheBytes>ANALYSIS_CACHE_LIMIT&&analysisCache.size){
    const oldest=analysisCache.keys().next().value,entry=analysisCache.get(oldest);
    analysisCache.delete(oldest);analysisCacheBytes-=entry.body.length;
  }
}

/* A cold tile pays a one-off cost to open the project that covers it (measured
   ~2.8 s for the first USGS 1 m tile in an area); once a worker is warm its
   neighbours are far cheaper. So after a render, quietly pre-render the ring of
   neighbours around it: that hides the stall behind the pan or zoom the user is
   about to make, and turns the next screenful into cache hits.

   Deliberately conservative, because extra load is the thing we are trying to
   remove: only when the pool has nothing else to do, only the eight surrounding
   tiles, and rate-limited per window. Already-cached neighbours are skipped, so
   a busy pool is always left alone and a settled viewport costs nothing. */
const WARM_RING_WINDOW_MS=5000;
const WARM_RING_MAX=12;                 // prefetches started per window
const warmRingSeen=new Set();           // jobKeys queued or running right now
let warmRingStarted=0, warmRingSince=0;
function warmNeighbourTiles(style,z,x,y){
  if(z<11||z>19) return;                // outside the 1 m layers worth warming
  const stats=terrainPool.stats();
  if(stats.active||stats.queued) return; // never compete with a real request
  const now=Date.now();
  if(now-warmRingSince>WARM_RING_WINDOW_MS){ warmRingSince=now; warmRingStarted=0 }
  /* Zooming in is the gesture this is really for, and it lands on a different
     tile set: the ring above only ever helps a lateral pan. So also warm the
     four children one level down. */
  const targets=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]
    .map(([dx,dy])=>({z,x:x+dx,y:y+dy}));
  if(z<19) targets.push({z:z+1,x:x*2,y:y*2},{z:z+1,x:x*2+1,y:y*2},
                        {z:z+1,x:x*2,y:y*2+1},{z:z+1,x:x*2+1,y:y*2+1});
  for(const target of targets){
    if(warmRingStarted>=WARM_RING_MAX) return;
    const tz=target.z, nx=target.x, ny=target.y, limit=Math.pow(2,tz);
    if(nx<0||ny<0||nx>=limit||ny>=limit) continue;
    const nk=key(`${TERRAIN_RENDER_VERSION}:${style}:${tz}/${nx}/${ny}`);
    const cached=cacheGet(nk,TTL_TILE);
    if(warmRingSeen.has(nk)||cached&&!staleNone(cached)) continue;
    warmRingSeen.add(nk); warmRingStarted++;
    terrainTask(`raw-terrain:${nk}`,"raw-terrain",{style,z:tz,x:nx,y:ny,size:256},{priority:-10,timeoutMs:30000})
      .then(out=>{ if(out&&out.provisional) return;
        if(out) cachePut(nk,200,"image/png",out.png); else cachePut(nk,204,"image/png",Buffer.alloc(0),NONE_FINAL) })
      .catch(()=>{})
      .finally(()=>warmRingSeen.delete(nk));
  }
}

/* Coalesce identical terrain jobs while letting extra viewers cancel their
   own waits. If the final viewer leaves, queued work is discarded but an
   already-running render finishes and is cached instead of killing a warm
   M2 worker and repeating the same COG reads after the next pan. */
const terrainPending=new Map();
function terrainTask(jobKey,action,args,options,signal){
  if(signal&&signal.aborted) return Promise.reject(new TerrainPoolError("terrain request cancelled","ABORT_ERR"));
  let entry=terrainPending.get(jobKey);
  if(!entry){
    const finishOnAbort=!options||options.finishOnAbort!==false;
    entry={controller:new AbortController(),waiters:new Set(),promise:null};
    terrainPending.set(jobKey,entry);
    entry.promise=terrainPool.run(action,args,{...options,signal:entry.controller.signal,finishOnAbort})
      .finally(()=>terrainPending.delete(jobKey));
  }
  const waiter={}; entry.waiters.add(waiter);
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{
      if(settled) return; settled=true;
      entry.waiters.delete(waiter);
      if(signal) signal.removeEventListener("abort",onAbort);
    };
    const onAbort=()=>{
      /* If another viewer is waiting, only this response can leave. For the
         final viewer, signal the pool: queued work is discarded, while an
         active render is allowed to finish so this route can cache it. */
      if(entry.waiters.size>1){ cleanup();reject(new TerrainPoolError("terrain request cancelled","ABORT_ERR"));return }
      if(signal) signal.removeEventListener("abort",onAbort);
      entry.controller.abort();
    };
    if(signal) signal.addEventListener("abort",onAbort,{once:true});
    entry.promise.then(value=>{ cleanup(); resolve(value) },error=>{ cleanup(); reject(error) });
  });
}

function validateAnalysisParams(searchParams){
  const product=searchParams.get("product")||"",scale=searchParams.get("scale")||"";
  const width=Number(searchParams.get("width")),height=Number(searchParams.get("height"));
  const resolution=Number(searchParams.get("resolution")),limits=researchAnalysis.LIMITS;
  if(!researchAnalysis.PRODUCTS.includes(product)) throw new HttpError(400,"unknown terrain analysis product");
  if(!Object.hasOwn(researchAnalysis.SCALES,scale)) throw new HttpError(400,"unknown terrain analysis scale");
  if(!Number.isInteger(width)||width<3||width>limits.maxWidth||
     !Number.isInteger(height)||height<3||height>limits.maxHeight||width*height>limits.maxCells)
    throw new HttpError(400,"terrain analysis dimensions are outside the safe bounds");
  if(!Number.isFinite(resolution)||resolution<limits.minResolution||resolution>limits.maxResolution)
    throw new HttpError(400,"terrain analysis resolution is outside the safe bounds");
  const options=researchAnalysis.analysisOptions({options:{dayOfYear:searchParams.get("day")??undefined,
    latitude:searchParams.get("lat")??undefined,windAzimuth:searchParams.get("wind")??undefined}});
  return {product,scale,width,height,resolution,options,bytes:width*height*4};
}

/* The raw USGS 1 m archive is deliberately selective. For a spectrum overlay
   that works everywhere in the United States, fall back to the national 3DEP
   ImageServer's native Float32 export, then pack it in the same Terrarium
   format used by raw lidar. This preserves one client-side shader for both
   sources instead of baking a colour ramp on the server. */
const depCircuit={failures:0,openUntil:0};
function depFailed(){
  depCircuit.failures++;
  if(depCircuit.failures>=2) depCircuit.openUntil=Date.now()+Math.min(120000,15000*Math.pow(2,depCircuit.failures-2));
}
function depSucceeded(){ depCircuit.failures=0; depCircuit.openUntil=0 }

async function nationalElevationTiff(z,x,y,size,signal){
  if(Date.now()<depCircuit.openUntil) throw new TerrainPoolError("3DEP circuit is cooling down","CIRCUIT_OPEN");
  const bbox=mercBbox(z,x,y);
  const requestPath=`/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`
    + `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${size},${size}&format=tiff&f=image`;
  await slot(signal,DEP_HOST);
  try{
    const r=await upstream({host:DEP_HOST,path:requestPath,method:"GET",signal,
      headers:{"User-Agent":"clear-skies-portal"},__timeout:18000});
    if(r.status!==200||!isTiff(r.body)) throw new Error("3DEP elevation export failed");
    depSucceeded();
    return r.body;
  }catch(error){
    if(!terrainAborted(error)) depFailed();
    throw error;
  }finally{ release(DEP_HOST) }
}

/* Landform fabric over the current view: orientation and strength of the
   grain in a chosen wavelength band, its relief, whether the slopes are
   capped at a granular angle of repose, and which way the steep faces
   look. Band-limiting is the point — without it the ridge-and-valley grain
   of ordinary dissected topography swamps whatever fine lineation is being
   asked about. */
async function fabric(req,res,{u,p,signal}){
  const bs=(u.searchParams.get("bbox")||"").split(",").map(Number);
  if(!validBbox(bs)||bs[2]-bs[0]>5||bs[3]-bs[1]>5)
    return send(res,400,"application/json",Buffer.from('{"error":"bbox=w,s,e,n in degrees"}'));
  const opt={ n:+u.searchParams.get("n")||0,
              lo:+u.searchParams.get("lo")||0, hi:+u.searchParams.get("hi")||0 };
  const action=p==="/api/wadnr/fabric"?"dnr-fabric":"fabric";
  if(action==="dnr-fabric"){
    try{const areas=JSON.parse(u.searchParams.get("areas")||"[]");
      if(Array.isArray(areas)){
        // Keep every fetched box intersecting the actual sampling
        // footprint: the square UTM grid usgs.fabric builds from bs.
        const zone=cog.utmZone((bs[0]+bs[2])/2);
        const cs=bs.length?[[bs[0],bs[1]],[bs[2],bs[1]],[bs[0],bs[3]],[bs[2],bs[3]]].map(([x,y])=>cog.lonLatToUTM(x,y,zone)):[];
        const minE=Math.min(...cs.map(p=>p.e)),maxE=Math.max(...cs.map(p=>p.e));
        const minN=Math.min(...cs.map(p=>p.n)),maxN=Math.max(...cs.map(p=>p.n));
        const fn=Math.max(48,Math.min(320,(opt.n|0)||192));
        const res=Math.max((maxE-minE)/fn,(maxN-minN)/fn,1);
        // Projected edges curve between corners, so bound the whole
        // perimeter lattice (plus a hair) rather than four corners.
        const fc=[];
        for(let i=0;i<=32;i++){const t=i/32*fn*res;
          fc.push([minE+t,minN],[minE+t,minN+fn*res],[minE,minN+t],[minE+fn*res,minN+t]);}
        const fl=fc.map(([x,y])=>cog.utmToLonLat(x,y,zone)),EPS=0.001;
        const fp=[Math.min(...fl.map(p=>p.lon))-EPS,Math.min(...fl.map(p=>p.lat))-EPS,Math.max(...fl.map(p=>p.lon))+EPS,Math.max(...fl.map(p=>p.lat))+EPS];
        opt.areas=areas.filter(a=>validBbox(a)&&a[0]<fp[2]&&a[2]>fp[0]&&a[1]<fp[3]&&a[3]>fp[1]).slice(0,256);
      }}catch{}
  }
  opt.strict=u.searchParams.get("strict")==="1";
  let out; try{ out=await terrainTask(`${action}:${dnr.index.revision}:${key(JSON.stringify([bs,opt]))}`,action,{bbox:bs,options:opt},
    {priority:20,timeoutMs:45000,finishOnAbort:false},signal) }
  catch(e){
    if(terrainAborted(e)) return;
    return send(res,503,"application/json",Buffer.from(JSON.stringify({error:String(e.message||e)})));
  }
  return send(res,200,"application/json",Buffer.from(JSON.stringify(out)),{"Cache-Control":"no-store"});
}

const routes={
  /* ---- bounded M2 offload for viewport DEM surface analysis ---- */
  "/api/terrain/analyze":async(req,res,{u,p,signal})=>{
    const type=String(req.headers["content-type"]||"").split(";",1)[0].trim().toLowerCase();
    if(type!=="application/octet-stream") throw new HttpError(415,"terrain analysis body must be application/octet-stream Float32 data");
    const params=validateAnalysisParams(u.searchParams);
    const declared=req.headers["content-length"];
    if(declared!==undefined&&(!/^\d+$/.test(String(declared))||Number(declared)!==params.bytes))
      throw new HttpError(400,"terrain analysis content length does not match its dimensions");
    const upload=await readBody(req,MAX_ANALYSIS_BODY);
    if(upload.length!==params.bytes) throw new HttpError(400,"terrain analysis payload length does not match its dimensions");
    const digest=crypto.createHash("sha256").update(upload).digest("hex");
    const analysisKey=`research-v1:${params.product}:${params.scale}:${params.width}x${params.height}:${params.resolution}:${JSON.stringify(params.options)}:${digest}`;
    const hit=analysisCacheGet(analysisKey);
    if(hit) return send(res,200,ANALYSIS_MIME,hit,{"X-Cache":"HIT","X-CSP-Analysis-Engine":"m2-worker-thread","Cache-Control":"no-store"});

    /* Buffer pools are not safe to detach. Copy once into an exact backing
       store, then transfer ownership into a worker instead of cloning the
       DEM through the worker_threads serializer. */
    const bytes=new Uint8Array(params.bytes);bytes.set(upload);
    const grid=new Float32Array(bytes.buffer);
    let encoded;
    try{
      encoded=await terrainTask(analysisKey,"research-analysis",{...params,grid},
        {priority:65,timeoutMs:45000,transferList:[grid.buffer]},signal);
    }catch(error){
      if(terrainAborted(error)) return;
      if(error&&error.code==="WORKER_TASK") throw new HttpError(422,String(error.message||"invalid terrain analysis payload"));
      return send(res,503,"application/json",jsonBody({error:"terrain analysis engine is busy"}),
        {"Retry-After":"2","Cache-Control":"no-store"});
    }
    let frame;
    try{ researchAnalysis.decodeResult(encoded);frame=Buffer.from(encoded) }
    catch(error){ throw new HttpError(500,"terrain analysis worker returned an invalid frame") }
    analysisCachePut(analysisKey,frame);
    return send(res,200,ANALYSIS_MIME,frame,{"X-Cache":"MISS","X-CSP-Analysis-Engine":"m2-worker-thread","Cache-Control":"no-store"});
  },
  /* ---- USGS 3DEP 1 m DEM: does this point have federal lidar coverage? ---- */
  "/api/usgs/cover":async(req,res,{u,p,signal})=>{
    const latS=u.searchParams.get("lat"), lonS=u.searchParams.get("lon");
    const lat=+latS, lon=+lonS;
    // Note the null check: +null is 0 and isFinite(0) is true, so a missing
    // parameter would otherwise be answered for a point in the Gulf of Guinea.
    if(latS===null||lonS===null||!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)
      return send(res,400,"application/json",Buffer.from(JSON.stringify({error:"lat and lon required"})));
    const r=await usgs.findCells(lon,lat);
    return send(res,200,"application/json",Buffer.from(JSON.stringify(r)),
                {"Cache-Control":"max-age=3600"});
  },
  /* Rebuild the S3 project index. Cheap to serve, ~20 s to build, 30-day TTL. */
  "/api/usgs/index":async(req,res,{u,p,signal})=>{
    const force = u.searchParams.get("force")==="1";
    // ?states=WA_,OR_ narrows the build; omitted, it follows CSP_USGS_STATES
    // (default: Washington; use CSP_USGS_STATES=ALL for the whole archive).
    const sp = u.searchParams.get("states");
    const states = sp ? sp.split(",").map(x=>x.trim()).filter(Boolean)
                        .map(x=>x.endsWith("_")?x:x+"_") : null;
    if(states&&(states.length>60||states.some(x=>!/^[A-Z]{2}_$/.test(x))))
      return send(res,400,"application/json",jsonBody({error:"states must be two-letter prefixes"}));
    const idx=await usgs.buildIndex(states, force);
    const projects=Object.keys(idx.projects).map(k=>({
      project:k, zone:idx.projects[k].zone, year:usgs.projectYear(k),
      tiles:Object.keys(idx.projects[k].cells).length,
      bytes:Object.values(idx.projects[k].cells).reduce((a,c)=>a+(c.size||0),0)}));
    projects.sort((a,b)=>b.year-a.year);
    return send(res,200,"application/json",Buffer.from(JSON.stringify({
      built:idx.built, projects,
      totals:{projects:projects.length,
              tiles:projects.reduce((a,p2)=>a+p2.tiles,0),
              bytes:projects.reduce((a,p2)=>a+p2.bytes,0)}})));
  },
  /* Terrain rendered here from elevation: /api/usgs/tile/<style>/<z>/<x>/<y>.png */
  "/api/usgs/tile/":async(req,res,{u,p,signal})=>{
    const m=p.match(/^\/api\/usgs\/tile\/([a-z0-9]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if(!m) return send(res,400,"text/plain",Buffer.from("bad tile path"));
    const [,style,zs,xs,ys]=m;
    const z=+zs, x=+xs, y=+ys;
    const limit=Math.pow(2,z);
    if(z<0||z>22||x<0||y<0||x>=limit||y>=limit||!TERRAIN_STYLES.has(style))
      return send(res,400,"text/plain",Buffer.from("bad tile coordinates or style"));
    const ck=key(`${TERRAIN_RENDER_VERSION}:${style}:${z}/${x}/${y}`);
    const hit=cacheGet(ck, TTL_TILE);
    /* Also warm from a hit: otherwise the ring only ever extends one tile from
       a cold render, and a steady pan walks off the warm edge (measured:
       first pan a 4 ms hit, the next still a 0.9 s miss). Warming here makes
       the ring travel with the user. */
    if(hit&&!staleNone(hit)){ warmNeighbourTiles(style,z,x,y); return hit.status===204
      ? send(res,200,"image/png",TRANSPARENT,{"X-Cache":"hit","X-Coverage":"none","Cache-Control":"public, max-age=604800, immutable"})
      : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit","Cache-Control":"public, max-age=604800, immutable"}) }
    let out=null;
    /* Several Leaflet tiles can ask for the same raw-COG render while a
       pan/zoom is settling. Share that expensive range-read/PNG job. */
    try{ out=await terrainTask(`raw-terrain:${ck}`,"raw-terrain",{style,z,x,y,size:256},
        {priority:40,timeoutMs:30000},signal) }
    catch(e){
      if(terrainAborted(e)) return;
      return send(res,503,"image/png",TRANSPARENT,{"X-Cache":"BUSY","Cache-Control":"no-store","Retry-After":"2"});
    }
    if(out&&out.provisional)        // coverage unknown: the 1 m index is incomplete
      return send(res,503,"image/png",TRANSPARENT,{"X-Coverage":"unknown","Cache-Control":"no-store","Retry-After":"10"});
    if(!out){                       // no federal coverage here — caller falls back
      cachePut(ck,204,"image/png",Buffer.alloc(0),NONE_FINAL);
      return send(res,200,"image/png",TRANSPARENT,{"X-Coverage":"none","Cache-Control":"public, max-age=604800, immutable"});
    }
    cachePut(ck,200,"image/png",out.png);
    warmNeighbourTiles(style,z,x,y);   // hide the next pan's cold start
    return send(res,200,"image/png",out.png,
      {"X-Coverage":String(out.meta.coverage), "X-Ground-Res":String(out.meta.groundRes),
       "X-Sources":out.meta.sources.map(s2=>s2.project+"@"+s2.res+"m").join(","), "X-Cache":"miss",
       "Cache-Control":"public, max-age=604800, immutable"});
  },
  /* Cache the existing global Terrarium source verbatim, once for every
     elevation style and both renderers. Fixed host/path, bounded upstream,
     shared cancellation and the ordinary disk/RAM budgets still apply. */
  "/api/elev/overview/":async(req,res,{u,p,signal})=>{
    if(req.method!=="GET")return send(res,405,"text/plain",Buffer.from("method not allowed"),{"Allow":"GET"});
    const m=p.match(/^\/api\/elev\/overview\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if(!m)return send(res,400,"text/plain",Buffer.from("bad overview elevation tile path"));
    const z=+m[1],x=+m[2],y=+m[3],limit=2**z;
    if(z>15||!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||x>=limit||y>=limit)
      return send(res,400,"text/plain",Buffer.from("bad tile coordinates"));
    const ck=cacheBudgetCore.overviewWarmKey({z,x,y}),hit=cacheGet(ck,TTL_TILE);
    const headers={"X-Elevation-Source":"overview","Cache-Control":"public, max-age=604800"};
    if(hit)return send(res,hit.status,hit.type,hit.body,{...headers,"X-Cache":"hit"});
    const result=await limitedUpstream(ck,{host:"s3.amazonaws.com",
      path:`/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,method:"GET",__timeout:8000,__maxBody:1024*1024},null,signal);
    if(result.status!==200||!isPng(result.body)||result.body.length<24||
       result.body.readUInt32BE(16)!==256||result.body.readUInt32BE(20)!==256)
      return send(res,502,"text/plain",Buffer.from("overview elevation unavailable"),{"Cache-Control":"no-store"});
    cachePut(ck,200,"image/png",result.body);
    return send(res,200,"image/png",result.body,{...headers,"X-Cache":"miss"});
  },
  /* Fast baseline for the elevation spectrum. National Float32 elevation
     renders first; the raw 1 m layer below this handler refines it without
     leaving the viewport empty while a large COG is opening. */
  "/api/elev/national/":async(req,res,{u,p,signal})=>{
    const m=p.match(/^\/api\/elev\/national\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if(!m) return send(res,400,"text/plain",Buffer.from("bad national elevation tile path"));
    const z=+m[1], x=+m[2], y=+m[3], limit=Math.pow(2,z);
    if(z<0||z>22||x<0||y<0||x>=limit||y>=limit)
      return send(res,400,"text/plain",Buffer.from("bad tile coordinates"));
    const ck=key(`elevation-national-v1:${z}/${x}/${y}`);
    const hit=cacheGet(ck,TTL_TILE);
    if(hit) return hit.status===204
      ? send(res,200,"image/png",TRANSPARENT,{"X-Cache":"hit","X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":"public, max-age=604800, immutable"})
      : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit","X-Elevation-Source":"3dep","Cache-Control":"public, max-age=604800, immutable"});
    let out=null;
    try{
      const body=await nationalElevationTiff(z,x,y,256,signal);
      out=await terrainTask(`national-decode:${ck}`,"terrarium-tiff",{body},
        {priority:100,timeoutMs:25000},signal);
    }catch(e){
      if(terrainAborted(e)) return;
      return send(res,503,"image/png",TRANSPARENT,{"X-Cache":"BUSY","X-Elevation-Source":"fallback",
        "Cache-Control":"no-store","Retry-After":String(e&&e.code==="CIRCUIT_OPEN"?15:2)});
    }
    if(!out){
      cachePut(ck,204,"image/png",Buffer.alloc(0));
      return send(res,200,"image/png",TRANSPARENT,{"X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":"public, max-age=604800, immutable"});
    }
    cachePut(ck,200,"image/png",out.png,{coverage:out.coverage});
    return send(res,200,"image/png",out.png,{"X-Coverage":String(out.coverage),"X-Elevation-Source":"3dep",
      "X-Cache":"miss","Cache-Control":"public, max-age=604800, immutable"});
  },
  /* Elevation values for the browser spectrum. Prefer raw 1 m lidar, but
     make the feature continuous by falling back to national 3DEP Float32
     pixels when the staged lidar catalogue has a real gap. */
  "/api/elev/":async(req,res,{u,p,signal})=>{
    const m=p.match(/^\/api\/elev\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if(!m) return send(res,400,"text/plain",Buffer.from("bad elevation tile path"));
    const z=+m[1], x=+m[2], y=+m[3], limit=Math.pow(2,z);
    if(z<0||z>22||x<0||y<0||x>=limit||y>=limit)
      return send(res,400,"text/plain",Buffer.from("bad tile coordinates"));
    // v4: v3 cached national ground where a newer project's holes or a failed
    // read hid 1 m data, and kept it for 90 days. v5: v4 did the same wherever
    // an incomplete 1 m index said "no coverage" (October 2026).
    const ck=key(`elevation-v5:${z}/${x}/${y}`);
    const hit=cacheGet(ck,TTL_TILE);
    if(hit) return hit.status===204
      ? send(res,200,"image/png",SEA_LEVEL_DEM,{"X-Cache":"hit","X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":"public, max-age=604800, immutable"})
      : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit","X-Elevation-Source":"cached","Cache-Control":"public, max-age=604800, immutable"});
    /* Saved areas pin these exact 256 px Terrarium worker products, not
       the underlying COG ranges. Reuse one only where it is exactly what
       this route would compute: the raw 1 m tile, or the national DEM where
       raw is skipped (z<13) or known to have no coverage. A national tile
       that merely happens to be cached must not stand in for 1 m lidar -
       the 2D layer caches national almost everywhere, and caching it here
       would serve coarser ground for 90 days. */
    let rawHit=z>=13?cacheGet(key(`usgselev:${z}/${x}/${y}`),TTL_TILE):null;
    if(staleNone(rawHit)) rawHit=null;
    const nationalKey=key(`elevation-national-v1:${z}/${x}/${y}`);
    const exactNational=z<13||(rawHit&&rawHit.status===204);
    const saved=rawHit&&rawHit.status===200?rawHit:exactNational?cacheGet(nationalKey,TTL_TILE):null;
    if(saved&&(saved.status===200||saved.status===204)){
      cachePut(ck,saved.status,saved.type,saved.body,saved.sourceMeta);
      if(saved.status===204)return send(res,200,"image/png",SEA_LEVEL_DEM,
        {"X-Cache":"hit","X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":"public, max-age=604800, immutable"});
      const headers={"X-Cache":"hit","X-Elevation-Source":saved===rawHit?"usgs-1m":"3dep","Cache-Control":"public, max-age=604800, immutable"};
      // Older saved bodies have no coverage metadata, just like older hits.
      if(saved.sourceMeta&&saved.sourceMeta.coverage!=null)headers["X-Coverage"]=String(saved.sourceMeta.coverage);
      return send(res,saved.status,saved.type,saved.body,headers);
    }
    let out=null, rawFailed=false;
    try{
      let raw=null;
      /* A one-metre COG cannot add information to a continental/region-scale
         tile. Skip that expensive path below z13 and use the national DEM;
         close views still receive the newest raw project data. */
      if(z>=13) try{ raw=await terrainTask(`raw-elevation:${ck}`,"raw-elevation",{z,x,y,size:256},
        {priority:55,timeoutMs:30000},signal) }catch(e){ if(terrainAborted(e)) throw e; rawFailed=true }
      // Unknown 1 m coverage serves national now without storing it, like a failed read.
      if(raw&&raw.provisional){ raw=null; rawFailed=true }
      if(raw) out={...raw,source:"usgs-1m"};
      else{
        const body=await nationalElevationTiff(z,x,y,256,signal);
        const national=await terrainTask(`national-decode:${ck}`,"terrarium-tiff",{body},
          {priority:100,timeoutMs:25000},signal);
        out=national ? {...national,source:"3dep"} : null;
      }
    }catch(e){
      if(terrainAborted(e)) return;
      /* Offline (or upstream down) over a saved area whose COG ranges were
         evicted: the saved national DEM is the best ground available. Serve
         it, but never cache it under this key, so 1 m lidar is fetched again
         once the network returns. */
      const fallback=z>=13?cacheGet(nationalKey,TTL_TILE):null;
      if(fallback&&fallback.status===204)return send(res,200,"image/png",SEA_LEVEL_DEM,
        {"X-Cache":"saved-fallback","X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":"no-store"});
      if(fallback&&fallback.status===200){
        const headers={"X-Cache":"saved-fallback","X-Elevation-Source":"3dep","Cache-Control":"no-store"};
        if(fallback.sourceMeta&&fallback.sourceMeta.coverage!=null)headers["X-Coverage"]=String(fallback.sourceMeta.coverage);
        return send(res,200,fallback.type,fallback.body,headers);
      }
      return send(res,503,"image/png",TRANSPARENT,{"X-Cache":"BUSY","X-Elevation-Source":"fallback","Cache-Control":"no-store","Retry-After":"2"});
    }
    /* A failed or timed-out 1 m read is not missing coverage: serve the
       national stand-in now, but never store it as this tile's answer. */
    const keep=rawFailed?"no-store":"public, max-age=604800, immutable";
    if(!out){
      if(!rawFailed) cachePut(ck,204,"image/png",Buffer.alloc(0));
      // Sea level, not transparent: this tile is terrain geometry.
      return send(res,200,"image/png",SEA_LEVEL_DEM,{"X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":keep});
    }
    if(!rawFailed) cachePut(ck,200,"image/png",out.png);
    return send(res,200,"image/png",out.png,{"X-Coverage":String(out.coverage),"X-Elevation-Source":out.source,
      "X-Cache":rawFailed?"raw-failed":"miss","Cache-Control":keep});
  },
  "/api/usgs/fabric":fabric,
  "/api/wadnr/fabric":fabric,
  /* Raw DNR metres, with transparent true no-data. Acquisition is detached
     from tile rendering and has its own single-worker resource budget. */
  "/api/wadnr/elev/":async(req,res,{u,p,signal})=>{
    const m=p.match(/^\/api\/wadnr\/elev\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if(!m)throw new HttpError(400,"bad DNR elevation tile path");
    const z=+m[1],x=+m[2],y=+m[3],limit=2**z;
    if(z<0||z>18||x>=limit||y>=limit)throw new HttpError(400,"bad tile coordinates");
    let state={state:"ready",revision:dnr.index.revision};
    if(u.searchParams.get("acquire")==="0")dnr.touch(dnrTileBounds(z,x,y));
    else{
      try{state=await dnr.ensureTile(z,x,y);}
      catch(error){state={state:"error",error:String(error.message||error),revision:dnr.index.revision};}
    }
    const ck=key(`dnr-elevation-v1:${dnr.index.revision}:${z}/${x}/${y}`);
    const hit=cacheGet(ck,TTL_TILE);
    let out=hit?{png:hit.body,...hit.sourceMeta}:null;
    if(!hit&&dnr.index.files.length){
      try{out=await terrainTask(`dnr-elevation:${ck}`,"dnr-elevation",{z,x,y,size:256},{priority:50,timeoutMs:25000},signal);}
      catch(error){
        if(terrainAborted(error))return;
        return send(res,503,"application/json",Buffer.from(JSON.stringify({state:"error",error:"DNR elevation tile could not be decoded"})),{"Cache-Control":"no-store","Retry-After":"5"});
      }
    }
    const headers={"Cache-Control":"no-store","X-DNR-Status":state.state,
      "X-DNR-Revision":String(dnr.index.revision),"X-Elevation-Source":"wadnr-dtm"};
    if(!out){
      if(state.state==="pending")
        return send(res,202,"application/json",Buffer.from(JSON.stringify({...state,acquisition:dnr.status()})),{...headers,"X-Elevation-Source":"pending","Retry-After":"5"});
      if(state.state==="error")
        return send(res,503,"application/json",Buffer.from(JSON.stringify(state)),{...headers,"X-Elevation-Source":"unknown","Retry-After":"30"});
      return send(res,200,"image/png",TRANSPARENT,{...headers,"X-Elevation-Source":"none","X-Coverage":"none"});
    }
    const sourceMeta={coverage:out.coverage,groundRes:out.groundRes,sources:out.sources};
    if(!hit)cachePut(ck,200,"image/png",out.png,sourceMeta);
    return send(res,200,"image/png",out.png,{...headers,
      "X-Coverage":String(out.coverage),"X-Ground-Res":String(out.groundRes),
      "X-DNR-Sources":encodeURIComponent(JSON.stringify(out.sources||[])),
      "X-Cache":hit?"hit":"miss"});
  },
  /* Elevation, encoded rather than drawn, so a threshold can be moved in the
     browser without a round trip per step. */
  "/api/usgs/elev/":async(req,res,{u,p,signal})=>{
    const m=p.match(/^\/api\/usgs\/elev\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if(!m) return send(res,400,"text/plain",Buffer.from("bad tile path"));
    const z=+m[1], x=+m[2], y=+m[3];
    const limit=Math.pow(2,z);
    if(z<0||z>22||x<0||y<0||x>=limit||y>=limit)
      return send(res,400,"text/plain",Buffer.from("bad tile coordinates"));
    const ck=key(`usgselev:${z}/${x}/${y}`);
    const hit=cacheGet(ck, TTL_TILE);
    if(hit&&!staleNone(hit)) return hit.status===204
      ? send(res,200,"image/png",TRANSPARENT,{"X-Cache":"hit","X-Coverage":"none","Cache-Control":"public, max-age=604800, immutable"})
      : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit","Cache-Control":"public, max-age=604800, immutable"});
    let out=null;
    try{ out=await terrainTask(`raw-elevation:${ck}`,"raw-elevation",{z,x,y,size:256},
        {priority:55,timeoutMs:30000},signal) }
    catch(e){
      if(terrainAborted(e)) return;
      return send(res,503,"image/png",TRANSPARENT,{"X-Cache":"BUSY","Cache-Control":"no-store","Retry-After":"2"});
    }
    if(out&&out.provisional)
      return send(res,503,"image/png",TRANSPARENT,{"X-Coverage":"unknown","Cache-Control":"no-store","Retry-After":"10"});
    if(!out){ cachePut(ck,204,"image/png",Buffer.alloc(0),NONE_FINAL);
              return send(res,200,"image/png",TRANSPARENT,{"X-Coverage":"none","Cache-Control":"public, max-age=604800, immutable"}) }
    cachePut(ck,200,"image/png",out.png,{coverage:out.coverage});
    /* Mirror the tile route: say which project and what ground resolution were
       actually used, so the client can size its zoom ceiling to the source
       rather than to a fixed z. */
    return send(res,200,"image/png",out.png,{"X-Coverage":String(out.coverage),
                                                "X-Ground-Res":out.groundRes==null?"":String(out.groundRes),
                                                "X-Sources":(out.sources||[]).map(s2=>`${s2.project}@${s2.res}m`).join(","),
                                                "X-Cache":"miss",
                                                "Cache-Control":"public, max-age=604800, immutable"});
  },
};

module.exports={TERRAIN_RENDER_VERSION,TERRAIN_DOWNLOAD_STYLES,init,terrainTask,nationalElevationTiff,
  stats:()=>({depCircuit,analysisCache:{entries:analysisCache.size,MiB:+(analysisCacheBytes/1048576).toFixed(1),limitMiB:ANALYSIS_CACHE_LIMIT/1048576}}),routes};
