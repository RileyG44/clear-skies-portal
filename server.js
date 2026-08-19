/* Clear Skies Portal — local server
   Serves the app and proxies the few upstreams that refuse CORS
   (WA DNR lidar portal, NASA FIRMS), with an on-disk cache so repeat
   tiles are instant. Node >= 18, no dependencies.                     */
const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const crypto= require("crypto");
const zlib  = require("zlib");

const ROOT  = __dirname;
const PORT  = Number(process.env.PORT || 8765);
const HOST  = process.env.HOST || "127.0.0.1";   // 0.0.0.0 in a devcontainer/Codespace
const CACHE = path.join(ROOT, ".cache");
const AREAS = path.join(CACHE, "areas");   // one manifest per downloaded area
fs.mkdirSync(CACHE, {recursive:true});
fs.mkdirSync(AREAS, {recursive:true});

const MIME = {".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",
  ".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".svg":"image/svg+xml",".md":"text/markdown; charset=utf-8",".txt":"text/plain; charset=utf-8"};

const WADNR_HOST = "lidarportal.dnr.wa.gov";
const WADNR_MAP  = "/arcgis/rest/services/lidar/wadnr_hillshade/MapServer";
const TTL_TILE   = 90*24*3600*1000;   // lidar hillshade never changes
const TTL_MISS   = 10*60*1000;        // remember failures briefly so we stop hammering
const TILE_MS    = 18000;             // WA DNR is slow; 3DEP shows underneath meanwhile
const TTL_META   = 7*24*3600*1000;
const TTL_FIRMS  = 20*60*1000;

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
  try{
    fs.writeFileSync(path.join(CACHE,k), body);
    fs.writeFileSync(path.join(CACHE,k)+".meta", JSON.stringify({status,type}));
  }catch(e){}
}

/* ------------------------------------------------------------- upstream */
function upstream(opts, postBody){
  return new Promise((resolve, reject)=>{
    const req = https.request(opts, res=>{
      const chunks=[];
      let stream=res;
      const enc=(res.headers["content-encoding"]||"").toLowerCase();
      if(enc==="gzip") stream=res.pipe(zlib.createGunzip());
      else if(enc==="deflate") stream=res.pipe(zlib.createInflate());
      else if(enc==="br") stream=res.pipe(zlib.createBrotliDecompress());
      stream.on("data",c=>chunks.push(c));
      stream.on("end",()=>resolve({status:res.statusCode,
        type:res.headers["content-type"]||"application/octet-stream",
        body:Buffer.concat(chunks)}));
      stream.on("error",reject);
    });
    req.on("error",reject);
    req.setTimeout(opts.__timeout || 45000, ()=>req.destroy(new Error("upstream timeout")));
    if(postBody) req.write(postBody);
    req.end();
  });
}

/* limit concurrent hits on the WA DNR service - it 504s under load */
let inflight = 0; const queue = [];
function slot(){
  if(inflight < 10){ inflight++; return Promise.resolve() }
  return new Promise(r=>queue.push(r)).then(()=>{ inflight++ });
}
function release(){ inflight--; const n=queue.shift(); if(n) n() }

async function cached(k, ttl, fn){
  const hit = cacheGet(k, ttl);
  if(hit) return {...hit, hit:true};
  await slot();
  try{
    const r = await fn();
    if(r.status === 200 && r.body.length) cachePut(k, r.status, r.type, r.body);
    return {...r, hit:false};
  } finally { release() }
}

const TRANSPARENT = Buffer.from(
 "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=","base64");

/* ------------------------------------------------------------------ app */
const send = (res, status, type, body, extra={}) =>
  res.writeHead(status, {"Content-Type":type, "Access-Control-Allow-Origin":"*", ...extra}).end(body);

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
  try{ fs.writeFileSync(path.join(AREAS, a.id+".json"), JSON.stringify(a,null,1)) }catch(e){}
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
const warm = {running:false, stop:false, total:0, done:0, ok:0, bytes:0, label:""};
const warmState = () => ({running:warm.running, total:warm.total, done:warm.done,
                          ok:warm.ok, bytes:warm.bytes, label:warm.label});

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
                      label:`z${z0}-${z1}`});
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
            if(r.status===200 && r.body.length>100){ cachePut(k,200,r.type,r.body); warm.ok++; warm.bytes+=r.body.length }
          } else { warm.ok++ }
        }
        const rr=encodeURIComponent(JSON.stringify({rasterFunction:rule}));
        const dp=`/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`
               + `?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&renderingRule=${rr}`;
        const dk=key("3dep:"+dp);
        if(!cacheGet(dk,TTL_TILE)){
          const r2=await upstream({host:"elevation.nationalmap.gov", path:dp, method:"GET",
                                   headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS});
          if(r2.status===200 && r2.body.length>100){ cachePut(dk,200,r2.type,r2.body); warm.bytes+=r2.body.length }
        }
      }catch(e){}
      warm.done++;
    }
  };
  await Promise.all(Array.from({length:5}, worker));
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
  const u = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(u.pathname);

  try{
    /* ---- WA DNR: which lidar projects cover this polygon? ---- */
    if(p === "/api/wadnr/query" && req.method === "POST"){
      const chunks=[]; for await (const c of req) chunks.push(c);
      const geojson = Buffer.concat(chunks).toString();
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
      if(!/^[-\d.,]+$/.test(bbox) || !/^[\d,]+$/.test(size) || !/^[\d,]*$/.test(layers))
        return send(res,400,"application/json",Buffer.from('{"error":"bad params"}'));
      let qp = `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${size}`
             + `&format=png32&transparent=true&dpi=96&f=image`;
      if(layers) qp += `&layers=show:${layers}`;
      const k = key("wadnr:export:"+qp);
      const good = cacheGet(k, TTL_TILE);
      if(good) return send(res,200,good.type,good.body,
                           {"X-Cache":"HIT","Cache-Control":"public, max-age=604800"});
      const bad = cacheGet(k+".miss", TTL_MISS);
      if(bad) return send(res,200,"image/png",TRANSPARENT,
                          {"X-Cache":"MISS-CACHED","Cache-Control":"public, max-age=600"});
      await slot();
      let r=null;
      try{
        r = await upstream({host:WADNR_HOST, path:WADNR_MAP+"/export"+qp, method:"GET",
                            headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS});
      }catch(e){ r=null } finally { release() }
      if(r && r.status===200 && r.body.length>100 && /image/.test(r.type)){
        cachePut(k, 200, r.type, r.body);
        return send(res,200,r.type,r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=604800"});
      }
      cachePut(k+".miss", 200, "image/png", Buffer.from("1"));
      return send(res,200,"image/png",TRANSPARENT,
                  {"X-Cache":"EMPTY","Cache-Control":"public, max-age=600"});
    }

    /* ---- 3DEP terrain tiles (cached, so warmed areas work offline) ---- */
    if(p === "/api/3dep"){
      const bbox=u.searchParams.get("bbox")||"";
      const rule=u.searchParams.get("rule")||"Hillshade Gray";
      if(!/^[-\d.,]+$/.test(bbox)) return send(res,400,"application/json",Buffer.from('{"error":"bad bbox"}'));
      const rr=encodeURIComponent(JSON.stringify({rasterFunction:rule}));
      const dp=`/arcgis/rest/services/3DEPElevation/ImageServer/exportImage`
             + `?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&renderingRule=${rr}`;
      const k=key("3dep:"+dp);
      const hit=cacheGet(k,TTL_TILE);
      if(hit) return send(res,200,hit.type,hit.body,{"X-Cache":"HIT","Cache-Control":"public, max-age=604800"});
      await slot();
      let r=null;
      try{ r=await upstream({host:"elevation.nationalmap.gov", path:dp, method:"GET",
                             headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS}) }
      catch(e){ r=null } finally { release() }
      if(r && r.status===200 && r.body.length>100){
        cachePut(k,200,r.type,r.body);
        return send(res,200,r.type,r.body,{"X-Cache":"MISS","Cache-Control":"public, max-age=604800"});
      }
      return send(res,200,"image/png",TRANSPARENT,{"X-Cache":"EMPTY"});
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
      const chunks=[]; for await (const c of req) chunks.push(c);
      const job = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if(warm.running) return send(res,409,"application/json",Buffer.from(JSON.stringify({error:"already running", ...warmState()})));
      startWarm(job);
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

    if(p === "/api/warm/stop"){ warm.stop=true; return send(res,200,"application/json",Buffer.from(JSON.stringify(warmState()))); }

    if(p === "/api/health"){
      let n=0; try{ n=fs.readdirSync(CACHE).filter(f=>!f.endsWith(".meta")).length }catch(e){}
      return send(res,200,"application/json",Buffer.from(JSON.stringify({ok:true,cached:n,inflight})));
    }

    /* ---- static ---- */
    let f = path.join(ROOT, path.normalize(p === "/" ? "/index.html" : p).replace(/^([/\\])+/,""));
    if(!f.startsWith(ROOT)) return send(res,403,"text/plain",Buffer.from("forbidden"));
    fs.readFile(f,(e,buf)=>{
      if(e) return send(res,404,"text/plain",Buffer.from("not found"));
      send(res,200, MIME[path.extname(f).toLowerCase()] || "application/octet-stream", buf,
           {"Cache-Control":"no-store"});
    });
  }catch(err){
    send(res,500,"application/json",Buffer.from(JSON.stringify({error:String(err.message||err)})));
  }
});

server.listen(PORT,HOST,()=>{
  console.log(`Clear Skies Portal  ->  http://localhost:${PORT}`);
  console.log(`  serving ${ROOT}`);
  console.log(`  cache   ${CACHE}`);
});
