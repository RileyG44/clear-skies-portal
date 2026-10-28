/* Clear Skies Portal — local server
   Serves the app and proxies the few upstreams that refuse CORS
   (WA DNR lidar portal, NASA FIRMS), with an on-disk cache so repeat
   tiles are instant. Node >= 22.12; the DNR reader is bundled locally.

   The routes live in engine/, one module per concern; this file wires them
   together, owns the shared resources and serves the static app. */
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const usgs  = require("./usgs.js");
const cacheBudgetCore=require("./cache-budget.js");
const {TerrainPool}=require("./terrain-pool.js");
const {DnrStore}=require("./wadnr.js");
const SITE = require("./site.js");
const {HttpError,allowedOrigin,send,sendStatic,jsonBody}=require("./engine/http.js");
const tileCache=require("./engine/tile-cache.js");
const {upstreamLoad}=require("./engine/upstream.js");
const snapshot=require("./engine/snapshot.js");
const markup=require("./engine/markup-store.js");
const terrain=require("./engine/terrain.js");
const downloads=require("./engine/downloads.js");
const dnrRoutes=require("./engine/dnr-routes.js");
const proxies=require("./engine/proxies.js");

const ROOT  = __dirname;
const PORT  = Number(process.env.PORT || 8765);
const HOST  = process.env.HOST || "127.0.0.1";   // 0.0.0.0 in a devcontainer/Codespace
const CACHE = process.env.CSP_CACHE_DIR || path.join(ROOT, ".cache");   // packaged app redirects this outside the bundle
const AREAS = path.join(CACHE, "areas");   // one manifest per downloaded area
/* Markup (annotation) layers: one GeoJSON file per layer. Kept beside the app,
   not in the cache (they are the user's work, never evicted) and listed in
   .gitignore, so they stay on this machine. */
const MARKUP = process.env.CSP_MARKUP_DIR || path.join(ROOT, "markup");
const STARTED = Date.now();
const CHANNEL = process.env.CSP_CHANNEL==="preview" ? "preview" : "live";
const PREVIEW_REF = String(process.env.CSP_PREVIEW_REF||"").slice(0,120)||undefined;
const PREVIEW_SW = `self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(caches.keys()
  .then(keys=>Promise.all(keys.map(key=>caches.delete(key))))
  .then(()=>self.registration.unregister())));`;
fs.mkdirSync(CACHE, {recursive:true});
usgs.init(CACHE);
const dnr=new DnrStore(CACHE);
fs.mkdirSync(AREAS, {recursive:true});

/* Everything the browser may load; see site.json. app.js is built from app/. */
const APP_SCRIPT = path.join(ROOT,"app.js");
const PUBLIC_FILES = new Set([...SITE.web,"app.js",...SITE.vendor]);

const MAX_RENDER_QUEUE = 40;
/* Budget work stays off request paths. A dedicated worker scans/sorts/deletes.
   A download changes its eventual pin set, so eviction waits for its manifest. */
const cacheBudget=tileCache.init(CACHE,{canEvict:()=>!downloads.running()});
usgs.setCacheWriteGate(cacheBudgetCore.writeGate);
usgs.onCacheWrite(bytes=>cacheBudget.noteWrite(bytes));
/* CPU-heavy COG decoding and every derived terrain product live outside the
   request loop. The managed, dedicated M2 install requests six workers; the
   pool still auto-sizes conservatively for ordinary manual launches. */
const terrainPool=new TerrainPool({cacheDir:CACHE,maxQueue:MAX_RENDER_QUEUE,cacheWriteGate:cacheBudgetCore.writeGate,onCacheWrite:bytes=>cacheBudget.noteWrite(bytes)});
markup.init(MARKUP);
terrain.init(terrainPool,dnr);
dnrRoutes.init(dnr);
downloads.init({areasDir:AREAS,pool:terrainPool,budget:cacheBudget});

function health(){
  const terrainStats=terrainPool.stats(),{depCircuit,analysisCache}=terrain.stats();
  return {
    ok:true, cached:tileCache.count(), ...upstreamLoad(), terrainRenderVersion:terrain.TERRAIN_RENDER_VERSION,
    rendering:terrainStats.active, renderQueued:terrainStats.queued, terrain:terrainStats,
    memoryCache:tileCache.memoryStats(),
    analysisCache,
    cacheDisk:tileCache.cacheDiskStats(),cacheBudget:cacheBudget.stats(),
    nationalCircuit:{failures:depCircuit.failures,coolingDown:Date.now()<depCircuit.openUntil,
                     retryInSec:Math.max(0,Math.ceil((depCircuit.openUntil-Date.now())/1000))},
    uptimeSec:Math.floor((Date.now()-STARTED)/1000),
    /* scripts/preview.sh sets these so the page can label a preview copy */
    channel:CHANNEL, previewRef:CHANNEL==="preview"?PREVIEW_REF:undefined,
    /* What the page may ask of this engine. Without "wadnr-dpi" the page
       keeps to the 256 px WA DNR export every engine has handled. */
    features:["wadnr-dpi","wadnr-elevation","wadnr-job-cancel","markup","overview-elevation"],dnr:dnr.status()
  };
}

/* Exact paths first, then path prefixes (keys ending in "/"), longest first.
   A handler that returns false passes the request on to the static files. */
const ROUTES=Object.assign({},terrain.routes,dnrRoutes.routes,downloads.routes,proxies.routes,snapshot.routes,markup.routes,{
  "/api/health":(req,res)=>send(res,200,"application/json",jsonBody(health()),{"Cache-Control":"no-store"})
});
const PREFIXES=Object.keys(ROUTES).filter(route=>route.endsWith("/")).sort((a,b)=>b.length-a.length);
const POST_ONLY=new Set(["/api/terrain/analyze","/api/wadnr/query","/api/warm","/api/warm/stop",
  "/api/wadnr/warm","/api/wadnr/warm/stop",
  "/api/usgs/check","/api/usgs/warm","/api/usgs/warm/stop"]);

function terrainClient(req,res){
  const controller=new AbortController();
  const abort=()=>{ if(!res.writableEnded) controller.abort() };
  req.once("aborted",abort);
  res.once("close",abort);
  return {signal:controller.signal,dispose(){ req.off("aborted",abort); res.off("close",abort) }};
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
    if(POST_ONLY.has(p)&&req.method!=="POST")
      return send(res,405,"application/json",jsonBody({error:"method not allowed"}),{"Allow":"POST"});

    const route=Object.hasOwn(ROUTES,p)&&!p.endsWith("/") ? ROUTES[p] : ROUTES[PREFIXES.find(prefix=>p.startsWith(prefix))];
    if(route&&await route(req,res,{u,p,signal:client.signal})!==false) return;

    /* ---- static ---- */
    /* A preview is reloaded after every push without a build bump, and the
       offline worker serves the shell cache-first by build - so a preview tab
       would keep showing the design it first loaded. Preview engines hand out
       a worker that clears its caches and removes itself instead. */
    if(p === "/sw.js" && CHANNEL === "preview")
      return send(res,200,"text/javascript",Buffer.from(PREVIEW_SW),{"Cache-Control":"no-store"});
    const rel=path.normalize(p === "/" ? "index.html" : p.replace(/^([/\\])+/,""));
    const f=path.resolve(ROOT,rel);
    const inside=path.relative(ROOT,f);
    if(inside.startsWith(".."+path.sep)||path.isAbsolute(inside))
      return send(res,403,"text/plain",Buffer.from("forbidden"));
    const publicRel=rel.split(path.sep).join("/");
    if(!PUBLIC_FILES.has(publicRel)&&!publicRel.startsWith("vendor/potree/"))
      return send(res,404,"text/plain",Buffer.from("not found"));
    return sendStatic(req,res,f,f===APP_SCRIPT?Buffer.from(SITE.appSource(ROOT)):null);
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
  let stopping=false;
  const shutdown=()=>{
    if(stopping)return;stopping=true;
    server.close();
    Promise.all([cacheBudget.close(),dnr.close(),terrainPool.close()]).finally(()=>process.exit(0));
    setTimeout(()=>process.exit(0),5000).unref();
  };
  process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);
  server.listen(PORT,HOST,()=>{
    console.log(`Clear Skies Portal  ->  http://localhost:${PORT}`);
    console.log(`  serving ${ROOT}`);
    console.log(`  cache   ${CACHE}`);
  });
}

module.exports={
  validateSnapshotImageUrl:snapshot.validateSnapshotImageUrl,
  resolveSnapshotImageRedirect:snapshot.resolveSnapshotImageRedirect,
  send,
  closeServerResources:()=>Promise.all([cacheBudget.close(),dnr.close(),terrainPool.close()])
};
