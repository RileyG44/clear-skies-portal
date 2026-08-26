/* Clear Skies Portal — local server
   Serves the app and proxies the few upstreams that refuse CORS
   (WA DNR lidar portal, NASA FIRMS), with an on-disk cache so repeat
   tiles are instant. Node >= 22.12, no runtime dependencies.          */
const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const crypto= require("crypto");
const net   = require("net");
const zlib  = require("zlib");
const usgs  = require("./usgs.js");
const {TerrainPool,TerrainPoolError}=require("./terrain-pool.js");
const researchAnalysis=require("./research-analysis.js");

const ROOT  = __dirname;
const PORT  = Number(process.env.PORT || 8765);
const HOST  = process.env.HOST || "127.0.0.1";   // 0.0.0.0 in a devcontainer/Codespace
const CACHE = process.env.CSP_CACHE_DIR || path.join(ROOT, ".cache");   // packaged app redirects this outside the bundle
const AREAS = path.join(CACHE, "areas");   // one manifest per downloaded area
const STARTED = Date.now();
fs.mkdirSync(CACHE, {recursive:true});
usgs.init(CACHE);
fs.mkdirSync(AREAS, {recursive:true});

const MIME = {".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",
  ".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".svg":"image/svg+xml",".md":"text/markdown; charset=utf-8",".txt":"text/plain; charset=utf-8"};
const PUBLIC_FILES = new Set(["index.html","version.js","mosaic-core.js","terrain-core.js","terrain-raster.js",
  "elevation-bands.js","elevation-tile-core.js","wa-archaeology.js","glacial-research-core.js","research-analysis.js","research-worker.js","sw.js","manifest.json",
  "icon-180.png","icon-192.png","icon-512.png","vendor/maplibre-gl.mjs","vendor/maplibre-gl-shared.mjs",
  "vendor/maplibre-gl-worker.mjs","vendor/maplibre-gl.css","vendor/leaflet-rotate.umd.min.js"]);

const WADNR_HOST = "lidarportal.dnr.wa.gov";
const WADNR_MAP  = "/arcgis/rest/services/lidar/wadnr_hillshade/MapServer";
const DEP_HOST   = "elevation.nationalmap.gov";
const TTL_TILE   = 90*24*3600*1000;   // lidar hillshade never changes
const TILE_MS    = 30000;             // WA DNR is slow; 3DEP shows underneath meanwhile
const TTL_META   = 7*24*3600*1000;
const TTL_FIRMS  = 20*60*1000;
const TTL_SNOW   = 2*3600*1000;       // NOHRSC publishes four analyses per day
const TTL_SNAPSHOT = 24*3600*1000;
const MAX_BODY   = 256*1024;
const MAX_UPSTREAM_BODY = 32*1024*1024;
const MAX_SNAPSHOT_URL = 8192;
const MAX_SNAPSHOT_IMAGE = 16*1024*1024;
const MAX_SNAPSHOT_REDIRECTS = 3;
const MAX_WARM_TILES = 40000;
const MAX_RENDER_QUEUE = 40;
const MAX_ANALYSIS_BODY = researchAnalysis.LIMITS.maxCells*4;
const ANALYSIS_CACHE_LIMIT = Math.max(8,Math.min(256,Number(process.env.CSP_ANALYSIS_CACHE_MB)||64))*1024*1024;
const ANALYSIS_CACHE_TTL = 10*60*1000;
const ANALYSIS_MIME = "application/vnd.clearskies.terrain-analysis";
const TERRAIN_RENDER_VERSION = "terrain-v2";
const CACHE_MIN_FREE_GIB=Math.max(0,Number(process.env.CSP_CACHE_MIN_FREE_GB)||8);
const CACHE_MIN_FREE_BYTES=CACHE_MIN_FREE_GIB*1024*1024*1024;
const TERRAIN_STYLES = new Set(["hs","hsmulti","tint","slope","aspect","c2","c5","c10","c25"]);
const TERRAIN_DOWNLOAD_STYLES = new Set([...TERRAIN_STYLES,"northness"]);
const DEP_RULES = new Set(["Hillshade Gray","Hillshade Multidirectional","Hillshade Elevation Tinted",
  "Slope Map","Aspect Map","Preset 2ft Contour Interval","Preset 5ft Contour Interval",
  "Preset 10ft Contour Interval","Contour Smoothed 25"]);
const HTTPS_AGENT = new https.Agent({keepAlive:true,maxSockets:10,maxFreeSockets:5,timeout:30000});
/* These are the raster providers rendered by the portal today. Keep this list
   exact: the screenshot helper must never become a general-purpose proxy.
   CARTO is the sole suffix exception because Leaflet deliberately replaces
   {s} with vendor-controlled a/b/c/d subdomains. */
const SNAPSHOT_IMAGE_HOSTS = new Set([
  "planetarycomputer.microsoft.com",
  "titiler.xyz",
  "gibs.earthdata.nasa.gov",
  "basemaps.cartocdn.com",
  "elevation.nationalmap.gov",
  "s3.amazonaws.com",
  "prd-tnm.s3.amazonaws.com",
  "services.arcgisonline.com",
  "basemap.nationalmap.gov",
  "carto.nationalmap.gov",
  "mrdata.usgs.gov",
  "gis.dnr.wa.gov",
  WADNR_HOST,
  "tiles.macrostrat.org",
  "mapservices.weather.noaa.gov",
  "earthquake.usgs.gov",
  "tiles.arcgis.com"
]);
/* CPU-heavy COG decoding and every derived terrain product live outside the
   request loop. The managed, dedicated M2 install requests six workers; the
   pool still auto-sizes conservatively for ordinary manual launches. */
const terrainPool=new TerrainPool({cacheDir:CACHE,maxQueue:MAX_RENDER_QUEUE});

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

const CORS_ORIGINS = new Set(["https://rileyg44.github.io"]);
for(const value of String(process.env.CSP_CORS_ORIGINS||"").split(",")){
  const origin=value.trim(); if(origin) CORS_ORIGINS.add(origin);
}

class HttpError extends Error {
  constructor(status, message){ super(message); this.status=status }
}

function validateSnapshotImageUrl(value){
  if(typeof value!=="string"||!value.trim())
    throw new HttpError(400,"snapshot image URL is required");
  if(Buffer.byteLength(value,"utf8")>MAX_SNAPSHOT_URL)
    throw new HttpError(400,`snapshot image URL exceeds ${MAX_SNAPSHOT_URL} bytes`);
  let target;
  try{ target=new URL(value) }
  catch(e){ throw new HttpError(400,"snapshot image URL is invalid") }
  if(target.protocol!=="https:")
    throw new HttpError(400,"snapshot image URL must use HTTPS");
  if(target.username||target.password)
    throw new HttpError(400,"snapshot image URL must not contain credentials");
  if(target.port&&target.port!=="443")
    throw new HttpError(400,"snapshot image URL must use port 443");

  const rawHost=target.hostname.toLowerCase();
  const ipHost=rawHost.startsWith("[")&&rawHost.endsWith("]") ? rawHost.slice(1,-1) : rawHost;
  const hostname=ipHost.replace(/\.$/,"");
  if(net.isIP(hostname)||hostname==="localhost"||hostname.endsWith(".localhost")||
     hostname.endsWith(".local")||hostname.endsWith(".internal")||hostname.endsWith(".home.arpa"))
    throw new HttpError(403,"snapshot image URL must not use a literal or private host");
  const cartoShard=hostname.endsWith(".basemaps.cartocdn.com");
  if(!SNAPSHOT_IMAGE_HOSTS.has(hostname)&&!cartoShard)
    throw new HttpError(403,"snapshot image host is not allowed");

  target.hostname=hostname;
  target.hash="";
  return target;
}

function resolveSnapshotImageRedirect(current,location){
  if(typeof location!=="string"||!location.trim())
    throw new HttpError(502,"snapshot image upstream sent a redirect without a location");
  let next;
  try{ next=new URL(location,current) }
  catch(e){ throw new HttpError(502,"snapshot image upstream sent an invalid redirect") }
  return validateSnapshotImageUrl(next.href);
}

function allowedOrigin(req){
  const origin=req.headers.origin;
  if(!origin) return null;
  if(CORS_ORIGINS.has(origin)) return origin;
  try{
    const u=new URL(origin);
    if((u.protocol==="http:"||u.protocol==="https:") &&
       (u.hostname==="localhost"||u.hostname==="127.0.0.1"||u.hostname==="[::1]")) return origin;
  }catch(e){}
  return null;
}

async function readBody(req, limit=MAX_BODY){
  const chunks=[]; let size=0, tooLarge=false;
  for await (const chunk of req){
    size+=chunk.length;
    if(size>limit){ tooLarge=true; continue }
    chunks.push(chunk);
  }
  if(tooLarge) throw new HttpError(413, `request body exceeds ${limit} bytes`);
  return Buffer.concat(chunks);
}

async function readJson(req, fallback){
  const text=(await readBody(req)).toString().trim();
  if(!text && fallback!==undefined) return fallback;
  try{ return JSON.parse(text) }
  catch(e){ throw new HttpError(400,"invalid JSON body") }
}

function validBbox(value){
  if(!Array.isArray(value)||value.length!==4) return null;
  const b=value.map(Number), [w,s,e,n]=b;
  if(b.some(v=>!Number.isFinite(v))||w < -180||e > 180||s < -85.051129||n > 85.051129||w>=e||s>=n)
    return null;
  return b;
}

function csvNumbers(value,count){
  if(typeof value!=="string"||value.length>240||!/^-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?)*$/.test(value)) return null;
  const out=value.split(",").map(Number);
  return out.length===count&&out.every(Number.isFinite)?out:null;
}

function validMercBbox(value){
  const b=csvNumbers(value,4); if(!b) return null;
  const [w,s,e,n]=b, limit=20037508.35;
  return Math.abs(w)<=limit&&Math.abs(e)<=limit&&Math.abs(s)<=limit&&Math.abs(n)<=limit&&w<e&&s<n ? b : null;
}

/* ------------------------------------------------------------------ cache */
const key = s => crypto.createHash("sha1").update(s).digest("hex");
function cacheEntryCount(){
  try{ return fs.readdirSync(CACHE,{withFileTypes:true})
    .filter(entry=>entry.isFile()&&!entry.name.endsWith(".meta")).length }
  catch(e){ return 0 }
}
function cacheDiskStats(extraBytes=0){
  try{
    const stat=fs.statfsSync(CACHE), free=Number(stat.bavail)*Number(stat.bsize);
    return {freeGiB:+(free/1073741824).toFixed(2),minFreeGiB:CACHE_MIN_FREE_GIB,
            writable:free-extraBytes>=CACHE_MIN_FREE_BYTES};
  }catch(e){ return {freeGiB:null,minFreeGiB:CACHE_MIN_FREE_GIB,writable:true} }
}
let cacheCount=cacheEntryCount();
const CACHE_MEMORY_LIMIT=Math.max(32,Math.min(1024,Number(process.env.CSP_MEMORY_CACHE_MB)||256))*1024*1024;
const CACHE_MEMORY_ENTRY_LIMIT=Math.max(1024,Math.min(65536,Number(process.env.CSP_MEMORY_CACHE_ENTRIES)||32768));
const cacheMemory=new Map();let cacheMemoryBytes=0;
function memoryCachePut(k,value,at=Date.now()){
  const body=value&&value.body;if(!Buffer.isBuffer(body)||body.length>16*1024*1024) return;
  /* Negative-coverage entries have an empty body. Charge a small floor and
     cap entry count as well as bytes so millions of zero-byte misses cannot
     turn the nominally bounded Map into an unbounded metadata cache. */
  const charge=Math.max(256,body.length),previous=cacheMemory.get(k);
  if(previous) cacheMemoryBytes-=previous.charge;
  cacheMemory.delete(k);cacheMemory.set(k,{...value,at,charge});cacheMemoryBytes+=charge;
  while((cacheMemoryBytes>CACHE_MEMORY_LIMIT||cacheMemory.size>CACHE_MEMORY_ENTRY_LIMIT)&&cacheMemory.size){
    const oldest=cacheMemory.keys().next().value,entry=cacheMemory.get(oldest);cacheMemory.delete(oldest);cacheMemoryBytes-=entry.charge;
  }
}
function memoryCacheGet(k,ttl){
  const value=cacheMemory.get(k);if(!value) return null;
  if(Date.now()-value.at>ttl){cacheMemory.delete(k);cacheMemoryBytes-=value.charge;return null}
  cacheMemory.delete(k);cacheMemory.set(k,value);
  return {body:value.body,type:value.type,status:value.status};
}
function cacheGet(k, ttl){
  const warm=memoryCacheGet(k,ttl);if(warm) return warm;
  const f = path.join(CACHE, k);
  try{
    const st = fs.statSync(f);
    if(Date.now() - st.mtimeMs > ttl) return null;
    const raw = JSON.parse(fs.readFileSync(f + ".meta", "utf8"));
    const value={body: fs.readFileSync(f), type: raw.type, status: raw.status};memoryCachePut(k,value,st.mtimeMs);return value;
  }catch(e){ return null }
}
function cachePut(k, status, type, body){
  /* RAM stays useful even when the disk has reached its safety reserve. The
     previous ordering disabled both caches exactly when storage pressure made
     memory hits most valuable. */
  memoryCachePut(k,{status,type,body});
  if(!cacheDiskStats((body&&body.length||0)+4096).writable) return true;
  const target=path.join(CACHE,k), suffix=`.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const bodyTmp=target+suffix, metaTmp=target+".meta"+suffix;
  const isNew=!fs.existsSync(target);
  try{
    fs.writeFileSync(bodyTmp, body);
    fs.writeFileSync(metaTmp, JSON.stringify({status,type}));
    fs.renameSync(bodyTmp,target);
    fs.renameSync(metaTmp,target+".meta");
    if(isNew) cacheCount++;
    return true;
  }catch(e){
    try{ fs.unlinkSync(bodyTmp) }catch(e2){}
    try{ fs.unlinkSync(metaTmp) }catch(e2){}
  }
  return false;
}
function atomicWriteJson(target,value){
  const tmp=`${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try{ fs.writeFileSync(tmp,JSON.stringify(value,null,1)); fs.renameSync(tmp,target) }
  catch(e){ try{ fs.unlinkSync(tmp) }catch(e2){} }
}

/* ------------------------------------------------------------- upstream */
function upstream(opts, postBody){
  return new Promise((resolve, reject)=>{
    const {__timeout,__maxBody=MAX_UPSTREAM_BODY,signal,...requestOptions}=opts;
    let done=false;
    const finish=(fn,value)=>{ if(done) return; done=true; if(signal) signal.removeEventListener("abort",onAbort); fn(value) };
    const req = https.request({...requestOptions,agent:opts.agent||HTTPS_AGENT}, res=>{
      const chunks=[]; let size=0, settled=false;
      let stream=res;
      const enc=(res.headers["content-encoding"]||"").toLowerCase();
      if(enc==="gzip") stream=res.pipe(zlib.createGunzip());
      else if(enc==="deflate") stream=res.pipe(zlib.createInflate());
      else if(enc==="br") stream=res.pipe(zlib.createBrotliDecompress());
      stream.on("data",c=>{
        size+=c.length;
        if(size>__maxBody){
          settled=true;
          const err=new Error(`upstream body exceeds ${__maxBody} bytes`);
          err.code="UPSTREAM_TOO_LARGE";
          finish(reject,err);
          stream.destroy(err);
          if(stream!==res) res.destroy();
          return;
        }
        chunks.push(c);
      });
      stream.on("end",()=>{
        if(settled) return;
        settled=true;
        finish(resolve,{status:res.statusCode,
          type:res.headers["content-type"]||"application/octet-stream",
          headers:res.headers,
          body:Buffer.concat(chunks)});
      });
      stream.on("error",err=>{ if(!settled){ settled=true; finish(reject,err) } });
    });
    const onAbort=()=>req.destroy(new TerrainPoolError("upstream request cancelled","ABORT_ERR"));
    req.on("error",error=>finish(reject,error));
    req.setTimeout(__timeout || 45000, ()=>req.destroy(new Error("upstream timeout")));
    if(signal){
      if(signal.aborted) return onAbort();
      signal.addEventListener("abort",onAbort,{once:true});
    }
    if(postBody) req.write(postBody);
    req.end();
  });
}

/* limit concurrent hits on the WA DNR service - it 504s under load */
/* ArcGIS generates uncached WA composites on demand. Sending a full viewport
   at once makes every request slower and pushes them over the timeout; four
   concurrent jobs complete sooner in practice while 3DEP remains visible. */
const MAX_INFLIGHT = 4;
let inflight = 0; const queue = [];
const pending = new Map();
function slot(signal){
  if(signal&&signal.aborted)
    return Promise.reject(new TerrainPoolError("upstream request cancelled","ABORT_ERR"));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const waiter={grant:null};
    const cleanup=()=>{ if(signal) signal.removeEventListener("abort",onAbort) };
    const onAbort=()=>{
      if(settled) return;
      settled=true; cleanup();
      const index=queue.indexOf(waiter); if(index>=0) queue.splice(index,1);
      reject(new TerrainPoolError("upstream request cancelled","ABORT_ERR"));
    };
    waiter.grant=()=>{
      if(settled) return;
      settled=true; cleanup(); inflight++; resolve();
    };
    if(signal) signal.addEventListener("abort",onAbort,{once:true});
    if(inflight < MAX_INFLIGHT) waiter.grant(); else queue.push(waiter);
  });
}
function release(){ inflight=Math.max(0,inflight-1); const n=queue.shift(); if(n) n.grant() }

function coalesce(id,fn){
  if(pending.has(id)) return pending.get(id);
  const task=Promise.resolve().then(fn).finally(()=>pending.delete(id));
  pending.set(id,task);
  return task;
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

function terrainClient(req,res){
  const controller=new AbortController();
  const abort=()=>{ if(!res.writableEnded) controller.abort() };
  req.once("aborted",abort);
  res.once("close",abort);
  return {signal:controller.signal,dispose(){ req.off("aborted",abort); res.off("close",abort) }};
}

const terrainAborted=error=>error&&error.code==="ABORT_ERR";

async function cached(k, ttl, fn){
  const hit = cacheGet(k, ttl);
  if(hit) return {...hit, hit:true};
  return coalesce("cache:"+k,async()=>{
    const late=cacheGet(k,ttl);
    if(late) return {...late,hit:true};
    await slot();
    try{
      const r = await fn();
      if(r.status === 200 && r.body.length) cachePut(k, r.status, r.type, r.body);
      return {...r, hit:false};
    } finally { release() }
  });
}

/* A rapid pan, zoom, or style change can abandon dozens of remote image
   requests. Keep identical requests shared, but remove cancelled waiters from
   the concurrency queue and abort the upstream as soon as the last viewer has
   left. Otherwise obsolete tiles sit ahead of the current viewport for up to
   TILE_MS each and make a healthy server look frozen. */
const limitedPending=new Map();
function limitedUpstream(id,opts,body,signal){
  if(signal&&signal.aborted)
    return Promise.reject(new TerrainPoolError("upstream request cancelled","ABORT_ERR"));
  const taskKey="upstream:"+id;
  let entry=limitedPending.get(taskKey);
  if(entry&&entry.controller.signal.aborted){ limitedPending.delete(taskKey); entry=null }
  if(!entry){
    entry={controller:new AbortController(),waiters:new Set(),promise:null};
    limitedPending.set(taskKey,entry);
    entry.promise=(async()=>{
      await slot(entry.controller.signal);
      try{ return await upstream({...opts,signal:entry.controller.signal},body) }
      finally{ release() }
    })().finally(()=>limitedPending.delete(taskKey));
  }
  const waiter={}; entry.waiters.add(waiter);
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{
      if(settled) return; settled=true; entry.waiters.delete(waiter);
      if(signal) signal.removeEventListener("abort",onAbort);
    };
    const onAbort=()=>{
      cleanup();
      if(!entry.waiters.size) entry.controller.abort();
      reject(new TerrainPoolError("upstream request cancelled","ABORT_ERR"));
    };
    if(signal) signal.addEventListener("abort",onAbort,{once:true});
    entry.promise.then(value=>{ cleanup(); resolve(value) },error=>{ cleanup(); reject(error) });
  });
}

const TRANSPARENT = Buffer.from(
 "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=","base64");
/* A 256x256 tile encoding a constant 0 m in Terrarium, for the DEM route only.
   Terrarium reads elevation = (R*256 + G + B/256) - 32768, so 0 m is RGB(128,0,0).
   The 1x1 TRANSPARENT tile below is correct for a 2D overlay but catastrophic as
   terrain geometry: its RGB(0,0,0) decodes to -32768 m, which punches a 32 km
   pit into the mesh wherever elevation data runs out (most obviously at the
   coast, where it was also cached `immutable` for a week). */
const SEA_LEVEL_DEM = (() => {
  const W=256, row=W*4+1, raw=Buffer.alloc(row*W);
  for(let y=0;y<W;y++){
    const o=y*row; raw[o]=0;                       // filter: none
    for(let x=0;x<W;x++){ const p=o+1+x*4; raw[p]=128; raw[p+1]=0; raw[p+2]=0; raw[p+3]=255 }
  }
  const crcT=new Int32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; crcT[n]=c }
  const crc=b=>{ let c=0xffffffff; for(let i=0;i<b.length;i++) c=crcT[(c^b[i])&0xff]^(c>>>8); return (c^0xffffffff)>>>0 };
  const chunk=(type,data)=>{
    const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
    const td=Buffer.concat([Buffer.from(type,"ascii"),data]);
    const c=Buffer.alloc(4); c.writeUInt32BE(crc(td),0);
    return Buffer.concat([len,td,c]);
  };
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(W,4);
  ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR",ihdr), chunk("IDAT",zlib.deflateSync(raw,{level:9})), chunk("IEND",Buffer.alloc(0))]);
})();

const isPng = body => Buffer.isBuffer(body)&&body.length>8&&body[0]===0x89&&body[1]===0x50&&
  body[2]===0x4e&&body[3]===0x47&&body[4]===0x0d&&body[5]===0x0a&&body[6]===0x1a&&body[7]===0x0a;
const isTiff = body => Buffer.isBuffer(body)&&body.length>8&&
  ((body[0]===0x49&&body[1]===0x49&&body[2]===0x2a&&body[3]===0x00) ||
   (body[0]===0x4d&&body[1]===0x4d&&body[2]===0x00&&body[3]===0x2a));
const isJpeg = body => Buffer.isBuffer(body)&&body.length>3&&
  body[0]===0xff&&body[1]===0xd8&&body[2]===0xff;
const isWebp = body => Buffer.isBuffer(body)&&body.length>=12&&
  body.toString("ascii",0,4)==="RIFF"&&body.toString("ascii",8,12)==="WEBP";
const SNAPSHOT_IMAGE_TYPES = new Map([
  ["image/png",isPng],
  ["image/jpeg",isJpeg],
  ["image/webp",isWebp]
]);
const SNAPSHOT_REDIRECT_STATUSES = new Set([301,302,303,307,308]);

async function fetchSnapshotImage(initial){
  let target=validateSnapshotImageUrl(initial instanceof URL ? initial.href : initial);
  const visited=new Set();
  for(let redirects=0;;redirects++){
    if(visited.has(target.href))
      throw new HttpError(502,"snapshot image upstream redirect loop");
    visited.add(target.href);
    let result;
    try{
      result=await upstream({
        hostname:target.hostname,
        port:443,
        path:target.pathname+target.search,
        method:"GET",
        __timeout:TILE_MS,
        __maxBody:MAX_SNAPSHOT_IMAGE,
        headers:{
          "User-Agent":"clear-skies-portal",
          "Accept":"image/png,image/jpeg,image/webp",
          "Accept-Encoding":"gzip, deflate, br"
        }
      });
    }catch(error){
      if(error&&error.code==="UPSTREAM_TOO_LARGE")
        throw new HttpError(502,`snapshot image exceeds ${MAX_SNAPSHOT_IMAGE} bytes`);
      throw new HttpError(502,`snapshot image upstream request failed: ${String(error&&error.message||error)}`);
    }
    if(SNAPSHOT_REDIRECT_STATUSES.has(result.status)){
      if(redirects>=MAX_SNAPSHOT_REDIRECTS)
        throw new HttpError(502,"snapshot image upstream sent too many redirects");
      target=resolveSnapshotImageRedirect(target,result.headers&&result.headers.location);
      continue;
    }
    if(result.status!==200)
      throw new HttpError(502,`snapshot image upstream returned HTTP ${result.status}`);
    const type=String(result.type||"").split(";",1)[0].trim().toLowerCase();
    const matches=SNAPSHOT_IMAGE_TYPES.get(type);
    if(!matches)
      throw new HttpError(415,"snapshot image upstream did not return PNG, JPEG, or WebP");
    if(!matches(result.body))
      throw new HttpError(502,`snapshot image upstream returned invalid ${type} data`);
    return {status:200,type,body:result.body};
  }
}

/* ------------------------------------------------------------------ app */
function send(res, status, type, body, extra={}){
  if(res.destroyed||res.writableEnded) return;
  const origin=allowedOrigin(res.req);
  const headers={"Content-Type":type,"X-Content-Type-Options":"nosniff",...extra};
  if(origin){ headers["Access-Control-Allow-Origin"]=origin; headers.Vary="Origin" }
  res.writeHead(status,headers).end(body);
}

const jsonBody = value => Buffer.from(JSON.stringify(value));

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
  return {product,scale,width,height,resolution,bytes:width*height*4};
}

/* -------------------------------------------------- area manifests
   A downloaded area records which WA DNR datasets covered it at the
   time. The portal sends no ETag/Last-Modified, so staleness is found
   by re-querying the catalogue and diffing ids / byte counts.        */
function bboxPoly(b){                       // [w,s,e,n] -> GeoJSON Polygon
  const [w,s,e,n]=b;
  return {type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]};
}
async function waQuery(bbox){
  const gj   = JSON.stringify(bboxPoly(bbox));
  const form = "geojson=" + encodeURIComponent(gj);
  const r = await cached(key("wadnr:query:"+gj), TTL_META, ()=>upstream({
    host:WADNR_HOST, path:"/query", method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded",
             "Content-Length":Buffer.byteLength(form),
             "User-Agent":"clear-skies-portal"}}, form));
  try{ const j=JSON.parse(r.body.toString()); return Array.isArray(j)?j:[] }catch(e){ return [] }
}
const dsFingerprint = rows => rows.map(d=>({
  dataset_id:d.dataset_id, project_name:d.project_name,
  dataset_name:d.dataset_name, files:d.files, bytes:d.bytes}));

function areaList(){
  try{
    return fs.readdirSync(AREAS).filter(f=>f.endsWith(".json")).map(f=>{
      try{ return JSON.parse(fs.readFileSync(path.join(AREAS,f),"utf8")) }catch(e){ return null }
    }).filter(Boolean).sort((a,b)=>(b.created||0)-(a.created||0));
  }catch(e){ return [] }
}
function areaSave(a){
  atomicWriteJson(path.join(AREAS,a.id+".json"),a);
}
/* Compare a stored manifest against the catalogue as it stands now. */
async function areaCheck(a){
  const now = await waQuery(a.bbox);
  if(!now.length) return {...a, checkFailed:true};
  const was = new Map((a.datasets||[]).map(d=>[d.dataset_id,d]));
  const added=[], changed=[];
  for(const d of now){
    const p = was.get(d.dataset_id);
    if(!p) added.push({project_name:d.project_name, dataset_name:d.dataset_name, bytes:d.bytes});
    else if(p.bytes!==d.bytes || p.files!==d.files)
      changed.push({project_name:d.project_name, dataset_name:d.dataset_name,
                    was:p.bytes, now:d.bytes});
  }
  const out = {...a, checked:Date.now(), added, changed, stale:!!(added.length||changed.length)};
  areaSave(out);
  return out;
}

/* ------------------------------------------------------------ pre-cache */
const warm = {running:false, stop:false, total:0, done:0, ok:0, bytes:0, label:"",error:""};
const warmState = () => ({running:warm.running, total:warm.total, done:warm.done,
                          ok:warm.ok, bytes:warm.bytes, label:warm.label,error:warm.error});

function tileRange(bbox, z){          // bbox = [w,s,e,n] in degrees
  const [w,s,e,n]=bbox, N=Math.pow(2,z);
  const xt = lon => Math.floor((lon+180)/360*N);
  const yt = lat => Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*N);
  return {x0:Math.max(0,xt(w)), x1:Math.min(N-1,xt(e)), y0:Math.max(0,yt(n)), y1:Math.min(N-1,yt(s))};
}
function mercBbox(z,x,y){
  const R=20037508.342789244, N=Math.pow(2,z), sp=2*R/N;
  const x0=-R+x*sp, y1=R-y*sp;
  return `${x0},${y1-sp},${x0+sp},${y1}`;
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
  await slot(signal);
  try{
    const r=await upstream({host:DEP_HOST,path:requestPath,method:"GET",signal,
      headers:{"User-Agent":"clear-skies-portal"},__timeout:18000});
    if(r.status!==200||!isTiff(r.body)) throw new Error("3DEP elevation export failed");
    depSucceeded();
    return r.body;
  }catch(error){
    if(!terrainAborted(error)) depFailed();
    throw error;
  }finally{ release() }
}

function validateWarmJob(value, source){
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new HttpError(400,"JSON object required");
  const bbox=validBbox(value.bbox);
  const z0=Number(value.z0), z1=Number(value.z1);
  if(!bbox) throw new HttpError(400,"bbox must be [west,south,east,north]");
  if(!Number.isInteger(z0)||!Number.isInteger(z1)||z0<1||z1>20||z0>z1)
    throw new HttpError(400,"z0 and z1 must be integers from 1 to 20");
  let total=0;
  for(let z=z0;z<=z1;z++){
    const r=tileRange(bbox,z);
    total+=(r.x1-r.x0+1)*(r.y1-r.y0+1);
    if(total>MAX_WARM_TILES) throw new HttpError(413,`download exceeds ${MAX_WARM_TILES} tiles`);
  }
  const label=String(value.label||`z${z0}-${z1}`).replace(/[\u0000-\u001f\u007f]/g,"").slice(0,120);
  if(source==="usgs"){
    const style=String(value.style||"hs");
    if(!TERRAIN_DOWNLOAD_STYLES.has(style)) throw new HttpError(400,"unsupported terrain style");
    return {bbox,z0,z1,style,label,total,raw:value.raw!==false};
  }
  const rule=String(value.rule||"Hillshade Gray");
  if(!DEP_RULES.has(rule)) throw new HttpError(400,"unsupported 3DEP rendering rule");
  const layers=String(value.layers||"");
  if(layers && (!/^\d+(,\d+)*$/.test(layers)||layers.split(",").length>14))
    throw new HttpError(400,"layers must contain at most 14 numeric ids");
  return {bbox,z0,z1,rule,layers,label,total};
}

async function startWarm(job){
  const bbox = job.bbox, z0 = Math.max(1,job.z0|0), z1 = Math.min(20,job.z1|0);
  const layers = String(job.layers||"").replace(/[^\d,]/g,"");
  const rule = String(job.rule||"Hillshade Gray");
  const tiles=[];
  for(let z=z0; z<=z1; z++){
    const r=tileRange(bbox,z);
    for(let x=r.x0; x<=r.x1; x++) for(let y=r.y0; y<=r.y1; y++) tiles.push({z,x,y});
  }
  Object.assign(warm,{running:true, stop:false, total:tiles.length, done:0, ok:0, bytes:0,
                      label:`z${z0}-${z1}`,error:""});
  const worker = async ()=>{
    while(tiles.length && !warm.stop){
      const t=tiles.pop(); if(!t) break;
      const bb=mercBbox(t.z,t.x,t.y);
      try{
        if(layers){
          const qp=`?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&dpi=96&f=image&layers=show:${layers}`;
          const k=key("wadnr:export:"+qp);
          if(!cacheGet(k,TTL_TILE)){
            const r=await upstream({host:WADNR_HOST, path:WADNR_MAP+"/export"+qp, method:"GET",
                                    headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS});
            if(r.status===200 && isPng(r.body)){ cachePut(k,200,"image/png",r.body); warm.ok++; warm.bytes+=r.body.length }
          } else { warm.ok++ }
        }
        const rr=encodeURIComponent(JSON.stringify({rasterFunction:rule}));
        const dp=`/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`
               + `?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&renderingRule=${rr}`;
        const dk=key("3dep:"+dp);
        if(!cacheGet(dk,TTL_TILE)){
          const r2=await upstream({host:"elevation.nationalmap.gov", path:dp, method:"GET",
                                   headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS});
          if(r2.status===200 && isPng(r2.body)){ cachePut(dk,200,"image/png",r2.body); warm.bytes+=r2.body.length }
        }
      }catch(e){ warm.error=String(e.message||e) }
      warm.done++;
    }
  };
  await Promise.all(Array.from({length:3}, worker));
  warm.running=false;
  /* record what was downloaded, and the catalogue state it matched */
  if(!warm.stop && warm.ok){
    try{
      const rows = await waQuery(bbox);
      areaSave({
        id: key(JSON.stringify([bbox,z0,z1,rule,layers])).slice(0,12),
        label: job.label || `z${z0}-${z1}`,
        bbox, z0, z1, rule, layers,
        tiles: warm.total, ok: warm.ok, bytes: warm.bytes,
        created: Date.now(), checked: Date.now(),
        datasets: dsFingerprint(rows), stale:false, added:[], changed:[]
      });
    }catch(e){}
  }
  warm.stop=false;
}

/* Raw-COG offline downloads share the M2 worker pool with interactive tiles.
   Three low-priority lanes keep the chip busy while preserving one worker and
   priority queue headroom for a pan, shader tile, or analysis request. */
const usgsWarm={running:false,stop:false,total:0,done:0,ok:0,skipped:0,bytes:0,label:"",error:"",controllers:new Set()};
const usgsWarmState=()=>({running:usgsWarm.running,total:usgsWarm.total,done:usgsWarm.done,ok:usgsWarm.ok,
  skipped:usgsWarm.skipped,bytes:usgsWarm.bytes,label:usgsWarm.label,error:usgsWarm.error});
async function startUsgsWarm(job){
  const tiles=[];
  for(let z=job.z0;z<=job.z1;z++){
    const r=tileRange(job.bbox,z);
    for(let x=r.x0;x<=r.x1;x++) for(let y=r.y0;y<=r.y1;y++) tiles.push({z,x,y});
  }
  Object.assign(usgsWarm,{running:true,stop:false,total:tiles.length,done:0,ok:0,skipped:0,bytes:0,
    label:`z${job.z0}-${job.z1} ${job.style}`,error:""});
  const usedKeys=new Set();
  const lane=async()=>{
    while(tiles.length&&!usgsWarm.stop){
      const t=tiles.pop(); if(!t) break;
      const nationalKey=key(`elevation-national-v1:${t.z}/${t.x}/${t.y}`);
      const rawKey=key(`usgselev:${t.z}/${t.x}/${t.y}`);
      const controller=new AbortController();usgsWarm.controllers.add(controller);
      let fetched=false,available=false,tileBytes=0;
      try{
        const loadNational=async()=>{
          const hit=cacheGet(nationalKey,TTL_TILE);
          if(hit){available=true;tileBytes+=hit.body.length;return}
          const body=await nationalElevationTiff(t.z,t.x,t.y,256,controller.signal);
          const out=await terrainPool.run("terrarium-tiff",{body},
            {priority:5,timeoutMs:15000,signal:controller.signal});
          fetched=true;available=true;
          if(out){cachePut(nationalKey,200,"image/png",out.png);tileBytes+=out.png.length}
          else cachePut(nationalKey,204,"image/png",Buffer.alloc(0));
        };
        const loadRaw=async()=>{
          const hit=cacheGet(rawKey,TTL_TILE);
          if(hit){available=true;tileBytes+=hit.body.length;return}
          const out=await terrainPool.run("raw-elevation",{...t,size:256},
            {priority:5,timeoutMs:45000,signal:controller.signal});
          fetched=true;available=true;
          if(out){cachePut(rawKey,200,"image/png",out.png);tileBytes+=out.png.length}
          else cachePut(rawKey,204,"image/png",Buffer.alloc(0));
        };
        const work=[loadNational()];
        if(job.raw&&t.z>=13) work.push(loadRaw());
        const outcomes=await Promise.allSettled(work);
        for(const outcome of outcomes) if(outcome.status==="rejected"&&outcome.reason&&outcome.reason.code!=="ABORT_ERR")
          usgsWarm.error=String(outcome.reason.message||outcome.reason);
        if(available){
          usgsWarm.bytes+=tileBytes;
          if(fetched) usgsWarm.ok++;else usgsWarm.skipped++;
        }else if(outcomes.every(outcome=>outcome.status==="rejected")){
          const reason=outcomes[0].reason;
          if(reason&&reason.code!=="ABORT_ERR") usgsWarm.error=String(reason.message||reason);
          }
      }catch(error){
        if(error&&error.code!=="ABORT_ERR") usgsWarm.error=String(error.message||error);
      }finally{
        usgsWarm.controllers.delete(controller);
      }
      usgsWarm.done++;
    }
  };
  await Promise.all(Array.from({length:Math.max(3,terrainPool.size-2)},lane));
  usgsWarm.running=false;
  if(!usgsWarm.stop&&(usgsWarm.ok||usgsWarm.skipped)){
    try{ await usgs.finalizeWarm(job,usedKeys,usgsWarm) }catch(error){ usgsWarm.error=String(error.message||error) }
  }
  usgsWarm.stop=false; usgsWarm.controllers.clear();
}

function stopUsgsWarm(){
  usgsWarm.stop=true;
  for(const controller of usgsWarm.controllers) controller.abort();
  return usgsWarmState();
}

const server = http.createServer(async (req,res)=>{
  const client=terrainClient(req,res);
  try{
    const u = new URL(req.url, "http://localhost");
    let p;
    try{ p=decodeURIComponent(u.pathname) }
    catch(e){ throw new HttpError(400,"invalid URL encoding") }

    if(req.headers.origin && !allowedOrigin(req))
      return send(res,403,"application/json",jsonBody({error:"origin not allowed"}));
    if(req.method==="OPTIONS")
      return send(res,204,"text/plain",Buffer.alloc(0),{
        "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type",
        "Access-Control-Max-Age":"86400"
      });
    const postOnly=new Set(["/api/terrain/analyze","/api/wadnr/query","/api/warm","/api/warm/stop",
      "/api/usgs/check","/api/usgs/warm","/api/usgs/warm/stop"]);
    if(postOnly.has(p)&&req.method!=="POST")
      return send(res,405,"application/json",jsonBody({error:"method not allowed"}),{"Allow":"POST"});

    /* ---- bounded M2 offload for viewport DEM surface analysis ---- */
    if(p==="/api/terrain/analyze"&&req.method==="POST"){
      const type=String(req.headers["content-type"]||"").split(";",1)[0].trim().toLowerCase();
      if(type!=="application/octet-stream") throw new HttpError(415,"terrain analysis body must be application/octet-stream Float32 data");
      const params=validateAnalysisParams(u.searchParams);
      const declared=req.headers["content-length"];
      if(declared!==undefined&&(!/^\d+$/.test(String(declared))||Number(declared)!==params.bytes))
        throw new HttpError(400,"terrain analysis content length does not match its dimensions");
      const upload=await readBody(req,MAX_ANALYSIS_BODY);
      if(upload.length!==params.bytes) throw new HttpError(400,"terrain analysis payload length does not match its dimensions");
      const digest=crypto.createHash("sha256").update(upload).digest("hex");
      const analysisKey=`research-v1:${params.product}:${params.scale}:${params.width}x${params.height}:${params.resolution}:${digest}`;
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
          {priority:65,timeoutMs:45000,transferList:[grid.buffer]},client.signal);
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
    }

    /* ---- safe raster proxy for cross-origin map snapshots ---- */
    if(p==="/api/snapshot/image"&&req.method!=="GET")
      return send(res,405,"application/json",jsonBody({error:"method not allowed"}),{"Allow":"GET"});
    if(p==="/api/snapshot/image"){
      const target=validateSnapshotImageUrl(u.searchParams.get("url"));
      const result=await cached(key("snapshot:image:v1:"+target.href),TTL_SNAPSHOT,
        ()=>fetchSnapshotImage(target));
      return send(res,200,result.type,result.body,{
        "X-Cache":result.hit?"HIT":"MISS",
        "Cache-Control":"public, max-age=86400"
      });
    }

    /* ---- WA DNR: which lidar projects cover this polygon? ---- */
    if(p === "/api/wadnr/query" && req.method === "POST"){
      const geojson = (await readBody(req)).toString();
      let geometry;
      try{ geometry=JSON.parse(geojson) }catch(e){ throw new HttpError(400,"valid GeoJSON required") }
      if(!geometry||geometry.type!=="Polygon"||!Array.isArray(geometry.coordinates)||!geometry.coordinates.length)
        throw new HttpError(400,"GeoJSON Polygon required");
      const form = "geojson=" + encodeURIComponent(geojson);
      const k = key("wadnr:query:"+geojson);
      const hit=cacheGet(k,TTL_META);
      if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT"});
      let r=null;
      try{
        r=await limitedUpstream(k,{host:WADNR_HOST,path:"/query",method:"POST",__timeout:10000,
          headers:{"Content-Type":"application/x-www-form-urlencoded",
                   "Content-Length":Buffer.byteLength(form),
                   "User-Agent":"clear-skies-portal"}},form,client.signal);
      }catch(error){ if(terrainAborted(error)) return }
      if(r&&r.status===200&&r.body.length){
        cachePut(k,200,r.type,r.body);
        return send(res,200,r.type,r.body,{"X-Cache":"MISS"});
      }
      /* WA coverage discovery is an optional refinement. A portal timeout is
         equivalent to "no WA source right now" and must leave the national
         terrain path usable rather than surfacing a noisy 500 in the map. */
      return send(res,200,"application/json",Buffer.from("[]"),
                  {"X-Cache":"ERROR","Cache-Control":"no-store"});
    }

    /* ---- WA DNR: layer tree (project name -> raster layer ids) ---- */
    if(p === "/api/wadnr/layers"){
      const k=key("wadnr:layers"),hit=cacheGet(k,TTL_META);
      if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT"});
      let r=null;
      try{
        r=await limitedUpstream(k,{host:WADNR_HOST,path:WADNR_MAP+"/layers?f=json",method:"GET",__timeout:10000,
          headers:{"User-Agent":"clear-skies-portal","Accept-Encoding":"gzip"}},null,client.signal);
      }catch(error){ if(terrainAborted(error)) return }
      if(r&&r.status===200&&r.body.length){
        cachePut(k,200,r.type,r.body);
        return send(res,200,r.type,r.body,{"X-Cache":"MISS"});
      }
      return send(res,200,"application/json",Buffer.from('{"layers":[]}'),
                  {"X-Cache":"ERROR","Cache-Control":"no-store"});
    }

    /* ---- WA DNR: hillshade image for a bbox, restricted to given layers ---- */
    if(p === "/api/wadnr/export"){
      const bbox   = u.searchParams.get("bbox")   || "";
      const size   = u.searchParams.get("size")   || "256,256";
      const layers = u.searchParams.get("layers") || "";
      const dims=csvNumbers(size,2);
      if(!validMercBbox(bbox)||!dims||dims.some(v=>!Number.isInteger(v)||v<1||v>1024)||
         (layers&&(!/^\d+(,\d+)*$/.test(layers)||layers.split(",").length>14)))
        return send(res,400,"application/json",Buffer.from('{"error":"bad params"}'));
      let qp = `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${size}`
             + `&format=png32&transparent=true&dpi=96&f=image`;
      if(layers) qp += `&layers=show:${layers}`;
      const k = key("wadnr:export:"+qp);
      const good = cacheGet(k, TTL_TILE);
      if(good) return send(res,200,good.type,good.body,
                           {"X-Cache":"HIT","Cache-Control":"public, max-age=604800"});
      let r=null;
      try{
        r = await limitedUpstream(k,{host:WADNR_HOST, path:WADNR_MAP+"/export"+qp, method:"GET",
                                    headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS},null,client.signal);
      }catch(e){ if(terrainAborted(e)) return; r=null }
      if(r && r.status===200 && isPng(r.body)){
        cachePut(k, 200, "image/png", r.body);
        return send(res,200,"image/png",r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=604800"});
      }
      /* A transport or upstream failure is not an empty lidar tile. Returning
         a successful transparent image made the browser stop retrying and the
         map appeared to give up. Preserve the error so the resilient tile
         client can back off and retry it. */
      return send(res,204,"image/png",Buffer.alloc(0),
                  {"X-Cache":"ERROR","X-CSP-Error":"upstream","Cache-Control":"no-store","Retry-After":"2"});
    }

    /* ---- 3DEP terrain tiles (cached, so warmed areas work offline) ---- */
    if(p === "/api/3dep"){
      const bbox=u.searchParams.get("bbox")||"";
      const rule=u.searchParams.get("rule")||"Hillshade Gray";
      if(!validMercBbox(bbox)||!DEP_RULES.has(rule))
        return send(res,400,"application/json",Buffer.from('{"error":"bad bbox or rendering rule"}'));
      const rr=encodeURIComponent(JSON.stringify({rasterFunction:rule}));
      const dp=`/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`
             + `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&renderingRule=${rr}`;
      const k=key("3dep:"+dp);
      const hit=cacheGet(k,TTL_TILE);
      if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT","Cache-Control":"public, max-age=604800"});
      let r=null;
      try{ r=await limitedUpstream(k,{host:"elevation.nationalmap.gov", path:dp, method:"GET",
                                     headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS},null,client.signal) }
      catch(e){ if(terrainAborted(e)) return; r=null }
      /* ArcGIS answers 200 with a JSON error body when a request upsets it, and
         this used to cache anything over 100 bytes without looking at what it
         was. A bad answer then stuck around for TTL_TILE — 90 days — which is
         how one wrong tile becomes permanent. Check it is really a PNG. */
      if(r && r.status===200 && isPng(r.body)){
        cachePut(k,200,r.type,r.body);
        return send(res,200,r.type,r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=604800"});
      }
      return send(res,204,"image/png",Buffer.alloc(0),
                  {"X-Cache":"ERROR","X-CSP-Error":"upstream","Cache-Control":"no-store","Retry-After":"2"});
    }

    /* ---- NASA FIRMS: 24 h active-fire hotspots (no CORS upstream) ---- */
    if(p === "/api/firms"){
      const sat = (u.searchParams.get("sat")||"J1").toUpperCase();
      const map = {J1:"noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
                   J2:"noaa-21-viirs-c2/csv/J2_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
                   SV:"suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv"};
      const rel = map[sat] || map.J1;
      const r = await cached(key("firms:"+rel), TTL_FIRMS, ()=>upstream({
        host:"firms.modaps.eosdis.nasa.gov", path:"/data/active_fire/"+rel, method:"GET",
        headers:{"User-Agent":"clear-skies-portal","Accept-Encoding":"gzip"}}));
      return send(res, r.status, "text/csv; charset=utf-8", r.body, {"X-Cache": r.hit?"HIT":"MISS"});
    }

    /* ---- pre-cache an area so it's instant (and works offline) later ---- */
    if(p === "/api/warm" && req.method === "POST"){
      const job = validateWarmJob(await readJson(req,{}),"wadnr");
      if(warm.running) return send(res,409,"application/json",Buffer.from(JSON.stringify({error:"already running", ...warmState()})));
      startWarm(job).catch(err=>{
        warm.running=false; warm.error=String(err.message||err); console.error(err);
      });
      return send(res,200,"application/json",Buffer.from(JSON.stringify(warmState())));
    }
    if(p === "/api/warm/status")
      return send(res,200,"application/json",Buffer.from(JSON.stringify(warmState())));
    if(p === "/api/warm/areas")
      return send(res,200,"application/json",Buffer.from(JSON.stringify(areaList())));

    if(p === "/api/warm/check"){
      const want = u.searchParams.get("id");
      const list = areaList().filter(a=>!want || a.id===want);
      const out=[];
      for(const a of list){ try{ out.push(await areaCheck(a)) }catch(e){ out.push({...a,checkFailed:true}) } }
      return send(res,200,"application/json",Buffer.from(JSON.stringify(out)));
    }

    if(p === "/api/warm/stop" && req.method === "POST"){
      warm.stop=true;
      return send(res,200,"application/json",Buffer.from(JSON.stringify(warmState())));
    }

    /* ---- USGS 3DEP 1 m DEM: does this point have federal lidar coverage? ---- */
    if(p === "/api/usgs/cover"){
      const latS=u.searchParams.get("lat"), lonS=u.searchParams.get("lon");
      const lat=+latS, lon=+lonS;
      // Note the null check: +null is 0 and isFinite(0) is true, so a missing
      // parameter would otherwise be answered for a point in the Gulf of Guinea.
      if(latS===null||lonS===null||!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)
        return send(res,400,"application/json",Buffer.from(JSON.stringify({error:"lat and lon required"})));
      const r=await usgs.findCells(lon,lat);
      return send(res,200,"application/json",Buffer.from(JSON.stringify(r)),
                  {"Cache-Control":"max-age=3600"});
    }

    /* Rebuild the S3 project index. Cheap to serve, ~20 s to build, 30-day TTL. */
    if(p === "/api/usgs/index"){
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
    }

    /* Terrain rendered here from elevation: /api/usgs/tile/<style>/<z>/<x>/<y>.png */
    if(p.startsWith("/api/usgs/tile/")){
      const m=p.match(/^\/api\/usgs\/tile\/([a-z0-9]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if(!m) return send(res,400,"text/plain",Buffer.from("bad tile path"));
      const [,style,zs,xs,ys]=m;
      const z=+zs, x=+xs, y=+ys;
      const limit=Math.pow(2,z);
      if(z<0||z>22||x<0||y<0||x>=limit||y>=limit||!TERRAIN_STYLES.has(style))
        return send(res,400,"text/plain",Buffer.from("bad tile coordinates or style"));
      const ck=key(`${TERRAIN_RENDER_VERSION}:${style}:${z}/${x}/${y}`);
      const hit=cacheGet(ck, TTL_TILE);
      if(hit) return hit.status===204
        ? send(res,200,"image/png",TRANSPARENT,{"X-Cache":"hit","X-Coverage":"none","Cache-Control":"public, max-age=604800, immutable"})
        : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit","Cache-Control":"public, max-age=604800, immutable"});
      let out=null;
      /* Several Leaflet tiles can ask for the same raw-COG render while a
         pan/zoom is settling. Share that expensive range-read/PNG job. */
      try{ out=await terrainTask(`raw-terrain:${ck}`,"raw-terrain",{style,z,x,y,size:256},
          {priority:40,timeoutMs:30000},client.signal) }
      catch(e){
        if(terrainAborted(e)) return;
        return send(res,503,"image/png",TRANSPARENT,{"X-Cache":"BUSY","Cache-Control":"no-store","Retry-After":"2"});
      }
      if(!out){                       // no federal coverage here — caller falls back
        cachePut(ck,204,"image/png",Buffer.alloc(0));
        return send(res,200,"image/png",TRANSPARENT,{"X-Coverage":"none","Cache-Control":"public, max-age=604800, immutable"});
      }
      cachePut(ck,200,"image/png",out.png);
      return send(res,200,"image/png",out.png,
        {"X-Coverage":String(out.meta.coverage), "X-Ground-Res":String(out.meta.groundRes),
         "X-Sources":out.meta.sources.map(s2=>s2.project+"@"+s2.res+"m").join(","), "X-Cache":"miss",
         "Cache-Control":"public, max-age=604800, immutable"});
    }

    /* Fast baseline for the elevation spectrum. National Float32 elevation
       renders first; the raw 1 m layer below this handler refines it without
       leaving the viewport empty while a large COG is opening. */
    if(p.startsWith("/api/elev/national/")){
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
        const body=await nationalElevationTiff(z,x,y,256,client.signal);
        out=await terrainTask(`national-decode:${ck}`,"terrarium-tiff",{body},
          {priority:100,timeoutMs:25000},client.signal);
      }catch(e){
        if(terrainAborted(e)) return;
        return send(res,503,"image/png",TRANSPARENT,{"X-Cache":"BUSY","X-Elevation-Source":"fallback",
          "Cache-Control":"no-store","Retry-After":String(e&&e.code==="CIRCUIT_OPEN"?15:2)});
      }
      if(!out){
        cachePut(ck,204,"image/png",Buffer.alloc(0));
        return send(res,200,"image/png",TRANSPARENT,{"X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":"public, max-age=604800, immutable"});
      }
      cachePut(ck,200,"image/png",out.png);
      return send(res,200,"image/png",out.png,{"X-Coverage":String(out.coverage),"X-Elevation-Source":"3dep",
        "X-Cache":"miss","Cache-Control":"public, max-age=604800, immutable"});
    }

    /* Elevation values for the browser spectrum. Prefer raw 1 m lidar, but
       make the feature continuous by falling back to national 3DEP Float32
       pixels when the staged lidar catalogue has a real gap. */
    if(p.startsWith("/api/elev/")){
      const m=p.match(/^\/api\/elev\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if(!m) return send(res,400,"text/plain",Buffer.from("bad elevation tile path"));
      const z=+m[1], x=+m[2], y=+m[3], limit=Math.pow(2,z);
      if(z<0||z>22||x<0||y<0||x>=limit||y>=limit)
        return send(res,400,"text/plain",Buffer.from("bad tile coordinates"));
      const ck=key(`elevation-v3:${z}/${x}/${y}`);
      const hit=cacheGet(ck,TTL_TILE);
      if(hit) return hit.status===204
        ? send(res,200,"image/png",SEA_LEVEL_DEM,{"X-Cache":"hit","X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":"public, max-age=604800, immutable"})
        : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit","X-Elevation-Source":"cached","Cache-Control":"public, max-age=604800, immutable"});
      let out=null;
      try{
        let raw=null;
        /* A one-metre COG cannot add information to a continental/region-scale
           tile. Skip that expensive path below z13 and use the national DEM;
           close views still receive the newest raw project data. */
        if(z>=13) try{ raw=await terrainTask(`raw-elevation:${ck}`,"raw-elevation",{z,x,y,size:256},
          {priority:55,timeoutMs:30000},client.signal) }catch(e){ if(terrainAborted(e)) throw e }
        if(raw) out={...raw,source:"usgs-1m"};
        else{
          const body=await nationalElevationTiff(z,x,y,256,client.signal);
          const national=await terrainTask(`national-decode:${ck}`,"terrarium-tiff",{body},
            {priority:100,timeoutMs:25000},client.signal);
          out=national ? {...national,source:"3dep"} : null;
        }
      }catch(e){
        if(terrainAborted(e)) return;
        return send(res,503,"image/png",TRANSPARENT,{"X-Cache":"BUSY","X-Elevation-Source":"fallback","Cache-Control":"no-store","Retry-After":"2"});
      }
      if(!out){
        cachePut(ck,204,"image/png",Buffer.alloc(0));
        // Sea level, not transparent: this tile is terrain geometry.
        return send(res,200,"image/png",SEA_LEVEL_DEM,{"X-Coverage":"none","X-Elevation-Source":"none","Cache-Control":"public, max-age=604800, immutable"});
      }
      cachePut(ck,200,"image/png",out.png);
      return send(res,200,"image/png",out.png,{"X-Coverage":String(out.coverage),"X-Elevation-Source":out.source,
        "X-Cache":"miss","Cache-Control":"public, max-age=604800, immutable"});
    }

    /* Landform fabric over the current view: orientation and strength of the
       grain in a chosen wavelength band, its relief, whether the slopes are
       capped at a granular angle of repose, and which way the steep faces
       look. Band-limiting is the point — without it the ridge-and-valley grain
       of ordinary dissected topography swamps whatever fine lineation is being
       asked about. */
    if(p === "/api/usgs/fabric"){
      const bs=(u.searchParams.get("bbox")||"").split(",").map(Number);
      if(!validBbox(bs)||bs[2]-bs[0]>5||bs[3]-bs[1]>5)
        return send(res,400,"application/json",Buffer.from('{"error":"bbox=w,s,e,n in degrees"}'));
      const opt={ n:+u.searchParams.get("n")||0,
                  lo:+u.searchParams.get("lo")||0, hi:+u.searchParams.get("hi")||0 };
      let out; try{ out=await terrainTask(`fabric:${key(JSON.stringify([bs,opt]))}`,"fabric",{bbox:bs,options:opt},
        {priority:20,timeoutMs:45000,finishOnAbort:false},client.signal) }
      catch(e){
        if(terrainAborted(e)) return;
        return send(res,503,"application/json",Buffer.from(JSON.stringify({error:String(e.message||e)})));
      }
      return send(res,200,"application/json",Buffer.from(JSON.stringify(out)),{"Cache-Control":"no-store"});
    }

    /* Elevation, encoded rather than drawn, so a threshold can be moved in the
       browser without a round trip per step. */
    if(p.startsWith("/api/usgs/elev/")){
      const m=p.match(/^\/api\/usgs\/elev\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if(!m) return send(res,400,"text/plain",Buffer.from("bad tile path"));
      const z=+m[1], x=+m[2], y=+m[3];
      const limit=Math.pow(2,z);
      if(z<0||z>22||x<0||y<0||x>=limit||y>=limit)
        return send(res,400,"text/plain",Buffer.from("bad tile coordinates"));
      const ck=key(`usgselev:${z}/${x}/${y}`);
      const hit=cacheGet(ck, TTL_TILE);
      if(hit) return hit.status===204
        ? send(res,200,"image/png",TRANSPARENT,{"X-Cache":"hit","X-Coverage":"none","Cache-Control":"public, max-age=604800, immutable"})
        : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit","Cache-Control":"public, max-age=604800, immutable"});
      let out=null;
      try{ out=await terrainTask(`raw-elevation:${ck}`,"raw-elevation",{z,x,y,size:256},
          {priority:55,timeoutMs:30000},client.signal) }
      catch(e){
        if(terrainAborted(e)) return;
        return send(res,503,"image/png",TRANSPARENT,{"X-Cache":"BUSY","Cache-Control":"no-store","Retry-After":"2"});
      }
      if(!out){ cachePut(ck,204,"image/png",Buffer.alloc(0));
                return send(res,200,"image/png",TRANSPARENT,{"X-Coverage":"none","Cache-Control":"public, max-age=604800, immutable"}) }
      cachePut(ck,200,"image/png",out.png);
      return send(res,200,"image/png",out.png,{"X-Coverage":String(out.coverage),"X-Cache":"miss",
                                                  "Cache-Control":"public, max-age=604800, immutable"});
    }

    /* Freshness, the way WA DNR cannot do it: HEAD and compare ETag. */
    if(p === "/api/usgs/check" && req.method === "POST"){
      const entries=await readJson(req,[]);
      if(!Array.isArray(entries)||entries.length>500) throw new HttpError(400,"JSON array with at most 500 entries required");
      const out=await usgs.checkFresh(entries);
      return send(res,200,"application/json",Buffer.from(JSON.stringify(out)));
    }

    /* ---- USGS 1 m: download an area, resumable ---- */
    if(p === "/api/usgs/warm" && req.method === "POST"){
      const job=validateWarmJob(await readJson(req,{}),"usgs");
      const st=usgsWarmState();
      if(st.running) return send(res,409,"application/json",Buffer.from(JSON.stringify({error:"already running",...st})));
      startUsgsWarm(job).catch(err=>{ usgsWarm.running=false; usgsWarm.error=String(err.message||err); console.error(err) });
      return send(res,200,"application/json",Buffer.from(JSON.stringify(usgsWarmState())));
    }
    if(p === "/api/usgs/warm/status")
      return send(res,200,"application/json",Buffer.from(JSON.stringify(usgsWarmState())));
    if(p === "/api/usgs/warm/stop" && req.method === "POST")
      return send(res,200,"application/json",Buffer.from(JSON.stringify(stopUsgsWarm())));
    if(p === "/api/usgs/areas")
      return send(res,200,"application/json",Buffer.from(JSON.stringify(usgs.areaList())));
    if(p === "/api/usgs/areas/check"){
      const want=u.searchParams.get("id");
      const list=usgs.areaList().filter(a=>!want||a.id===want);
      const out=[];
      for(const a of list){ try{ out.push(await usgs.areaCheck(a)) }catch(e){ out.push({...a,checkFailed:true}) } }
      return send(res,200,"application/json",Buffer.from(JSON.stringify(out)));
    }
    if(p === "/api/usgs/plan"){
      const bbox=(u.searchParams.get("bbox")||"").split(",").map(Number);
      const z0=+u.searchParams.get("z0"), z1=+u.searchParams.get("z1");
      if(!validBbox(bbox)||!Number.isInteger(z0)||!Number.isInteger(z1)||z0<1||z1>20||z0>z1)
        return send(res,400,"application/json",Buffer.from('{"error":"bbox,z0,z1 required"}'));
      const job=validateWarmJob({bbox,z0,z1,style:"hs"},"usgs");
      const n=job.total;
      return send(res,200,"application/json",Buffer.from(JSON.stringify({tiles:n})));
    }

    /* ---- optional warm-cache path for Macrostrat geology tiles ------------
       Current browsers can load these directly with CORS. Retain the exact,
       bounded route for installed/offline clients and older saved builds. */
    if(p.startsWith("/api/geo/")){
      const m=p.match(/^\/api\/geo\/(macrostrat)\/(\d+)\/(\d+)\/(\d+)\.png$/);
      if(!m) return send(res,400,"text/plain",Buffer.from("bad geo tile path"));
      const [,which,z,x,y]=m;
      const host="tiles.macrostrat.org", pth=`/carto/${z}/${x}/${y}.png`;
      const k=key("geo:"+which+":"+pth);
      const hit=cacheGet(k, TTL_TILE);          // bedrock geology is not news
      if(hit) return send(res,200,hit.type,hit.body,
                          {"X-Cache":"HIT","Cache-Control":"public, max-age=2592000"});
      let r=null;
      try{ r=await limitedUpstream(k,{host, path:pth, method:"GET",
                                     headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS},null,client.signal) }
      catch(e){ if(terrainAborted(e)) return; r=null }
      if(r && r.status===200 && isPng(r.body)){
        cachePut(k,200,"image/png",r.body);
        return send(res,200,"image/png",r.body,
                    {"X-Cache":"MISS","Cache-Control":"public, max-age=2592000"});
      }
      return send(res,204,"image/png",Buffer.alloc(0),
                  {"X-Cache":"ERROR","X-CSP-Error":"upstream","Cache-Control":"no-store","Retry-After":"2"});
    }

    /* ---- current snow analysis --------------------------------------------
       The browser can now use NOHRSC directly, but this route remains the
       preferred warm M2 cache and a resilient fallback. NOHRSC refreshes four
       times per day, so two hours keeps the cache useful without hiding a new
       analysis for most of an update cycle. */
    if(p === "/api/snow"){
      const bbox=u.searchParams.get("bbox")||"";
      const layer=u.searchParams.get("layer")||"3";
      if(!validMercBbox(bbox)) return send(res,400,"application/json",Buffer.from('{"error":"bad bbox"}'));
      if(!["3","7"].includes(layer))                 // 3 = snow depth, 7 = SWE
        return send(res,400,"application/json",Buffer.from('{"error":"bad layer"}'));
      const pth="/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export"
              + `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256`
              + `&format=png32&transparent=true&f=image&layers=show:${layer}`;
      const k=key("snow:"+pth);
      const hit=cacheGet(k, TTL_SNOW);
      if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT","Cache-Control":"public, max-age=3600"});
      let r=null;
      try{ r=await limitedUpstream(k,{host:"mapservices.weather.noaa.gov", path:pth, method:"GET",
                                     headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS},null,client.signal) }
      catch(e){ if(terrainAborted(e)) return; r=null }
      if(r && r.status===200 && isPng(r.body)){
        cachePut(k,200,"image/png",r.body);
        return send(res,200,"image/png",r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=3600"});
      }
      return send(res,204,"image/png",Buffer.alloc(0),
                  {"X-Cache":"ERROR","X-CSP-Error":"upstream","Cache-Control":"no-store","Retry-After":"2"});
    }

    if(p === "/api/health"){
      const terrain=terrainPool.stats();
      return send(res,200,"application/json",Buffer.from(JSON.stringify({
        ok:true, cached:cacheCount, inflight, queued:queue.length, terrainRenderVersion:TERRAIN_RENDER_VERSION,
        rendering:terrain.active, renderQueued:terrain.queued, terrain,
        memoryCache:{entries:cacheMemory.size,entryLimit:CACHE_MEMORY_ENTRY_LIMIT,
          MiB:+(cacheMemoryBytes/1048576).toFixed(1),limitMiB:CACHE_MEMORY_LIMIT/1048576},
        analysisCache:{entries:analysisCache.size,MiB:+(analysisCacheBytes/1048576).toFixed(1),limitMiB:ANALYSIS_CACHE_LIMIT/1048576},
        cacheDisk:cacheDiskStats(),
        nationalCircuit:{failures:depCircuit.failures,coolingDown:Date.now()<depCircuit.openUntil,
                         retryInSec:Math.max(0,Math.ceil((depCircuit.openUntil-Date.now())/1000))},
        uptimeSec:Math.floor((Date.now()-STARTED)/1000)
      })),{"Cache-Control":"no-store"});
    }

    /* ---- static ---- */
    const rel=path.normalize(p === "/" ? "index.html" : p.replace(/^([/\\])+/,""));
    const f=path.resolve(ROOT,rel);
    const inside=path.relative(ROOT,f);
    if(inside.startsWith(".."+path.sep)||path.isAbsolute(inside))
      return send(res,403,"text/plain",Buffer.from("forbidden"));
    const publicRel=rel.split(path.sep).join("/");
    if(!PUBLIC_FILES.has(publicRel))
      return send(res,404,"text/plain",Buffer.from("not found"));
    fs.readFile(f,(e,buf)=>{
      if(e) return send(res,404,"text/plain",Buffer.from("not found"));
      send(res,200, MIME[path.extname(f).toLowerCase()] || "application/octet-stream", buf,
           {"Cache-Control":"no-store"});
    });
  }catch(err){
    const status=Number(err&&err.status)||500;
    if(status>=500) console.error(err);
    if(!res.headersSent) send(res,status,"application/json",jsonBody({error:String(err.message||err)}));
    else res.end();
  }finally{
    client.dispose();
  }
});

if(require.main===module){
  server.listen(PORT,HOST,()=>{
    console.log(`Clear Skies Portal  ->  http://localhost:${PORT}`);
    console.log(`  serving ${ROOT}`);
    console.log(`  cache   ${CACHE}`);
  });
}

module.exports={
  validateSnapshotImageUrl,
  resolveSnapshotImageRedirect,
  closeServerResources:()=>terrainPool.close()
};
