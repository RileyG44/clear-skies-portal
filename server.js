/* Clear Skies Portal — local server
   Serves the app and proxies the few upstreams that refuse CORS
   (WA DNR lidar portal, NASA FIRMS), with an on-disk cache so repeat
   tiles are instant. Node >= 22.12, no runtime dependencies.          */
const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const crypto= require("crypto");
const zlib  = require("zlib");
const usgs  = require("./usgs.js");

const ROOT  = __dirname;
const PORT  = Number(process.env.PORT || 8765);
const HOST  = process.env.HOST || "127.0.0.1";   // 0.0.0.0 in a devcontainer/Codespace
const CACHE = process.env.CSP_CACHE_DIR || path.join(ROOT, ".cache");   // packaged app redirects this outside the bundle
const AREAS = path.join(CACHE, "areas");   // one manifest per downloaded area
fs.mkdirSync(CACHE, {recursive:true});
usgs.init(CACHE);
fs.mkdirSync(AREAS, {recursive:true});

const MIME = {".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",
  ".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".svg":"image/svg+xml",".md":"text/markdown; charset=utf-8",".txt":"text/plain; charset=utf-8"};
const PUBLIC_FILES = new Set(["index.html","version.js","sw.js","manifest.json",
  "icon-180.png","icon-192.png","icon-512.png"]);

const WADNR_HOST = "lidarportal.dnr.wa.gov";
const WADNR_MAP  = "/arcgis/rest/services/lidar/wadnr_hillshade/MapServer";
const TTL_TILE   = 90*24*3600*1000;   // lidar hillshade never changes
const TILE_MS    = 30000;             // WA DNR is slow; 3DEP shows underneath meanwhile
const TTL_META   = 7*24*3600*1000;
const TTL_FIRMS  = 20*60*1000;
const TTL_SNOW   = 6*3600*1000;       // SNODAS is re-run daily
const MAX_BODY   = 256*1024;
const MAX_UPSTREAM_BODY = 32*1024*1024;
const MAX_WARM_TILES = 40000;
const TERRAIN_STYLES = new Set(["hs","hsmulti","tint","slope","aspect","c2","c5","c10","c25"]);
const DEP_RULES = new Set(["Hillshade Gray","Hillshade Multidirectional","Hillshade Elevation Tinted",
  "Slope Map","Aspect Map","Preset 2ft Contour Interval","Preset 5ft Contour Interval",
  "Preset 10ft Contour Interval","Contour Smoothed 25"]);
const HTTPS_AGENT = new https.Agent({keepAlive:true,maxSockets:10,maxFreeSockets:5,timeout:30000});

const CORS_ORIGINS = new Set(["https://rileyg44.github.io"]);
for(const value of String(process.env.CSP_CORS_ORIGINS||"").split(",")){
  const origin=value.trim(); if(origin) CORS_ORIGINS.add(origin);
}

class HttpError extends Error {
  constructor(status, message){ super(message); this.status=status }
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
function cacheGet(k, ttl){
  const f = path.join(CACHE, k);
  try{
    const st = fs.statSync(f);
    if(Date.now() - st.mtimeMs > ttl) return null;
    const raw = JSON.parse(fs.readFileSync(f + ".meta", "utf8"));
    return {body: fs.readFileSync(f), type: raw.type, status: raw.status};
  }catch(e){ return null }
}
function cachePut(k, status, type, body){
  const target=path.join(CACHE,k), suffix=`.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const bodyTmp=target+suffix, metaTmp=target+".meta"+suffix;
  try{
    fs.writeFileSync(bodyTmp, body);
    fs.writeFileSync(metaTmp, JSON.stringify({status,type}));
    fs.renameSync(bodyTmp,target);
    fs.renameSync(metaTmp,target+".meta");
  }catch(e){
    try{ fs.unlinkSync(bodyTmp) }catch(e2){}
    try{ fs.unlinkSync(metaTmp) }catch(e2){}
  }
}
function atomicWriteJson(target,value){
  const tmp=`${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try{ fs.writeFileSync(tmp,JSON.stringify(value,null,1)); fs.renameSync(tmp,target) }
  catch(e){ try{ fs.unlinkSync(tmp) }catch(e2){} }
}

/* ------------------------------------------------------------- upstream */
function upstream(opts, postBody){
  return new Promise((resolve, reject)=>{
    const req = https.request({...opts,agent:opts.agent||HTTPS_AGENT}, res=>{
      const chunks=[]; let size=0, settled=false;
      let stream=res;
      const enc=(res.headers["content-encoding"]||"").toLowerCase();
      if(enc==="gzip") stream=res.pipe(zlib.createGunzip());
      else if(enc==="deflate") stream=res.pipe(zlib.createInflate());
      else if(enc==="br") stream=res.pipe(zlib.createBrotliDecompress());
      stream.on("data",c=>{
        size+=c.length;
        if(size>MAX_UPSTREAM_BODY){
          settled=true;
          const err=new Error(`upstream body exceeds ${MAX_UPSTREAM_BODY} bytes`);
          reject(err);
          stream.destroy(err);
          return;
        }
        chunks.push(c);
      });
      stream.on("end",()=>{
        if(settled) return;
        settled=true;
        resolve({status:res.statusCode,
          type:res.headers["content-type"]||"application/octet-stream",
          body:Buffer.concat(chunks)});
      });
      stream.on("error",err=>{ if(!settled){ settled=true; reject(err) } });
    });
    req.on("error",reject);
    req.setTimeout(opts.__timeout || 45000, ()=>req.destroy(new Error("upstream timeout")));
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
function slot(){
  if(inflight < MAX_INFLIGHT){ inflight++; return Promise.resolve() }
  return new Promise(r=>queue.push(r)).then(()=>{ inflight++ });
}
function release(){ inflight--; const n=queue.shift(); if(n) n() }

function coalesce(id,fn){
  if(pending.has(id)) return pending.get(id);
  const task=Promise.resolve().then(fn).finally(()=>pending.delete(id));
  pending.set(id,task);
  return task;
}

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

function limitedUpstream(id,opts,body){
  return coalesce("upstream:"+id,async()=>{
    await slot();
    try{ return await upstream(opts,body) }finally{ release() }
  });
}

const TRANSPARENT = Buffer.from(
 "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=","base64");
const isPng = body => Buffer.isBuffer(body)&&body.length>8&&body[0]===0x89&&body[1]===0x50&&
  body[2]===0x4e&&body[3]===0x47&&body[4]===0x0d&&body[5]===0x0a&&body[6]===0x1a&&body[7]===0x0a;

/* ------------------------------------------------------------------ app */
function send(res, status, type, body, extra={}){
  const origin=allowedOrigin(res.req);
  const headers={"Content-Type":type,"X-Content-Type-Options":"nosniff",...extra};
  if(origin){ headers["Access-Control-Allow-Origin"]=origin; headers.Vary="Origin" }
  res.writeHead(status,headers).end(body);
}

const jsonBody = value => Buffer.from(JSON.stringify(value));

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
    if(!TERRAIN_STYLES.has(style)) throw new HttpError(400,"unsupported terrain style");
    return {bbox,z0,z1,style,label,total};
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

const server = http.createServer(async (req,res)=>{
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
    const postOnly=new Set(["/api/wadnr/query","/api/warm","/api/warm/stop",
      "/api/usgs/check","/api/usgs/warm","/api/usgs/warm/stop"]);
    if(postOnly.has(p)&&req.method!=="POST")
      return send(res,405,"application/json",jsonBody({error:"method not allowed"}),{"Allow":"POST"});

    /* ---- WA DNR: which lidar projects cover this polygon? ---- */
    if(p === "/api/wadnr/query" && req.method === "POST"){
      const geojson = (await readBody(req)).toString();
      let geometry;
      try{ geometry=JSON.parse(geojson) }catch(e){ throw new HttpError(400,"valid GeoJSON required") }
      if(!geometry||geometry.type!=="Polygon"||!Array.isArray(geometry.coordinates)||!geometry.coordinates.length)
        throw new HttpError(400,"GeoJSON Polygon required");
      const form = "geojson=" + encodeURIComponent(geojson);
      const k = key("wadnr:query:"+geojson);
      const r = await cached(k, TTL_META, ()=>upstream({
        host:WADNR_HOST, path:"/query", method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded",
                 "Content-Length":Buffer.byteLength(form),
                 "User-Agent":"clear-skies-portal"}}, form));
      return send(res, r.status, r.type, r.body, {"X-Cache": r.hit?"HIT":"MISS"});
    }

    /* ---- WA DNR: layer tree (project name -> raster layer ids) ---- */
    if(p === "/api/wadnr/layers"){
      const r = await cached(key("wadnr:layers"), TTL_META, ()=>upstream({
        host:WADNR_HOST, path:WADNR_MAP+"/layers?f=json", method:"GET",
        headers:{"User-Agent":"clear-skies-portal","Accept-Encoding":"gzip"}}));
      return send(res, r.status, r.type, r.body, {"X-Cache": r.hit?"HIT":"MISS"});
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
                                    headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS});
      }catch(e){ r=null }
      if(r && r.status===200 && isPng(r.body)){
        cachePut(k, 200, "image/png", r.body);
        return send(res,200,"image/png",r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=604800"});
      }
      /* A transport or upstream failure is not an empty lidar tile. Returning
         a successful transparent image made the browser stop retrying and the
         map appeared to give up. Preserve the error so the resilient tile
         client can back off and retry it. */
      return send(res,502,"image/png",TRANSPARENT,
                  {"X-Cache":"ERROR","Cache-Control":"no-store","Retry-After":"2"});
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
                                     headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS}) }
      catch(e){ r=null }
      /* ArcGIS answers 200 with a JSON error body when a request upsets it, and
         this used to cache anything over 100 bytes without looking at what it
         was. A bad answer then stuck around for TTL_TILE — 90 days — which is
         how one wrong tile becomes permanent. Check it is really a PNG. */
      if(r && r.status===200 && isPng(r.body)){
        cachePut(k,200,r.type,r.body);
        return send(res,200,r.type,r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=604800"});
      }
      return send(res,502,"image/png",TRANSPARENT,
                  {"X-Cache":"ERROR","Cache-Control":"no-store","Retry-After":"2"});
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
      const ck=key(`usgs:${style}:${z}/${x}/${y}`);
      const hit=cacheGet(ck, TTL_TILE);
      if(hit) return hit.status===204
        ? send(res,200,"image/png",TRANSPARENT,{"X-Cache":"hit","X-Coverage":"none"})
        : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit"});
      let out=null;
      try{ out=await usgs.renderTile(style,z,x,y,256) }
      catch(e){ return send(res,500,"text/plain",Buffer.from(String(e.message||e))) }
      if(!out){                       // no federal coverage here — caller falls back
        cachePut(ck,204,"image/png",Buffer.alloc(0));
        return send(res,200,"image/png",TRANSPARENT,{"X-Coverage":"none"});
      }
      cachePut(ck,200,"image/png",out.png);
      return send(res,200,"image/png",out.png,
        {"X-Coverage":String(out.meta.coverage), "X-Ground-Res":String(out.meta.groundRes),
         "X-Sources":out.meta.sources.map(s2=>s2.project+"@"+s2.res+"m").join(","), "X-Cache":"miss"});
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
      let out; try{ out=await usgs.fabric(bs,opt) }
      catch(e){ return send(res,500,"application/json",Buffer.from(JSON.stringify({error:String(e.message||e)}))) }
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
        ? send(res,200,"image/png",TRANSPARENT,{"X-Cache":"hit","X-Coverage":"none"})
        : send(res,hit.status,hit.type,hit.body,{"X-Cache":"hit"});
      let out=null;
      try{ out=await usgs.elevTile(z,x,y,256) }
      catch(e){ return send(res,500,"text/plain",Buffer.from(String(e.message||e))) }
      if(!out){ cachePut(ck,204,"image/png",Buffer.alloc(0));
                return send(res,200,"image/png",TRANSPARENT,{"X-Coverage":"none"}) }
      cachePut(ck,200,"image/png",out.png);
      return send(res,200,"image/png",out.png,{"X-Coverage":String(out.coverage),"X-Cache":"miss"});
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
      const st=usgs.warmState();
      if(st.running) return send(res,409,"application/json",Buffer.from(JSON.stringify({error:"already running",...st})));
      /* Share the server's disk cache so a stopped job resumes: tiles already
         rendered are counted as skipped rather than fetched again. */
      const tileCache={
        get:(style,z,x,y)=>{ const h=cacheGet(key(`usgs:${style}:${z}/${x}/${y}`),TTL_TILE);
                             return h && h.status===200 && h.body.length ? h.body : null },
        put:(style,z,x,y,buf)=>cachePut(key(`usgs:${style}:${z}/${x}/${y}`),200,"image/png",buf)
      };
      usgs.startWarm(job, tileCache).catch(err=>console.error(err));
      return send(res,200,"application/json",Buffer.from(JSON.stringify(usgs.warmState())));
    }
    if(p === "/api/usgs/warm/status")
      return send(res,200,"application/json",Buffer.from(JSON.stringify(usgs.warmState())));
    if(p === "/api/usgs/warm/stop" && req.method === "POST")
      return send(res,200,"application/json",Buffer.from(JSON.stringify(usgs.stopWarm())));
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

    /* ---- geologic map tiles (Macrostrat sends no CORS, so it is proxied) ---- */
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
                                     headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS}) }
      catch(e){ r=null }
      if(r && r.status===200 && isPng(r.body)){
        cachePut(k,200,"image/png",r.body);
        return send(res,200,"image/png",r.body,
                    {"X-Cache":"MISS","Cache-Control":"public, max-age=2592000"});
      }
      return send(res,502,"image/png",TRANSPARENT,
                  {"X-Cache":"ERROR","Cache-Control":"no-store","Retry-After":"2"});
    }

    /* ---- current snow analysis (NOHRSC sends no CORS, so it is proxied) ----
       SNODAS is re-run daily, so this caches for six hours rather than the
       90 days a bedrock or lidar tile gets. */
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
      if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT","Cache-Control":"public, max-age=21600"});
      let r=null;
      try{ r=await limitedUpstream(k,{host:"mapservices.weather.noaa.gov", path:pth, method:"GET",
                                     headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS}) }
      catch(e){ r=null }
      if(r && r.status===200 && isPng(r.body)){
        cachePut(k,200,"image/png",r.body);
        return send(res,200,"image/png",r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=21600"});
      }
      return send(res,502,"image/png",TRANSPARENT,
                  {"X-Cache":"ERROR","Cache-Control":"no-store","Retry-After":"2"});
    }

    if(p === "/api/health"){
      let n=0; try{ n=fs.readdirSync(CACHE).filter(f=>!f.endsWith(".meta")).length }catch(e){}
      return send(res,200,"application/json",Buffer.from(JSON.stringify({ok:true,cached:n,inflight})));
    }

    /* ---- static ---- */
    const rel=path.normalize(p === "/" ? "index.html" : p.replace(/^([/\\])+/,""));
    const f=path.resolve(ROOT,rel);
    const inside=path.relative(ROOT,f);
    if(inside.startsWith(".."+path.sep)||path.isAbsolute(inside))
      return send(res,403,"text/plain",Buffer.from("forbidden"));
    if(!PUBLIC_FILES.has(rel))
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
  }
});

server.listen(PORT,HOST,()=>{
  console.log(`Clear Skies Portal  ->  http://localhost:${PORT}`);
  console.log(`  serving ${ROOT}`);
  console.log(`  cache   ${CACHE}`);
});
