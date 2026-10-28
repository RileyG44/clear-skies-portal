/* Area downloads: pre-caching WA DNR and 3DEP hillshade for an area, and the
   resumable raw USGS 1 m download, each with a manifest that records what
   was fetched and the catalogue state it matched. */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const usgs = require("../usgs.js");
const cacheBudgetCore = require("../cache-budget.js");
const {HttpError,readJson,send} = require("./http.js");
const {isPng} = require("./images.js");
const {WADNR_HOST,WADNR_MAP,TILE_MS,upstream,cached} = require("./upstream.js");
const {TTL_TILE,TTL_META,key,cacheGet,cachePut} = require("./tile-cache.js");
const {validBbox,DEP_RULES} = require("./params.js");
const {TERRAIN_DOWNLOAD_STYLES,nationalElevationTiff} = require("./terrain.js");

const MAX_WARM_TILES = 40000;
let AREAS = null, terrainPool = null, cacheBudget = null;
function init({areasDir,pool,budget}){ AREAS=areasDir; terrainPool=pool; cacheBudget=budget }
const running=()=>warm.running||usgsWarm.running||usgs.warmState().running;

function atomicWriteJson(target,value){
  const tmp=`${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try{ fs.writeFileSync(tmp,JSON.stringify(value,null,1)); fs.renameSync(tmp,target) }
  catch(e){ try{ fs.unlinkSync(tmp) }catch(e2){} throw e }
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
  if(r.status!==200)throw new Error(`DNR coverage HTTP ${r.status}`);
  const j=JSON.parse(r.body.toString());
  if(!Array.isArray(j))throw new Error("Invalid DNR coverage response");
  return j;
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

const tileRange=cacheBudgetCore.tileRange;
const mercBbox=cacheBudgetCore.mercBbox;

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
      const paths=cacheBudgetCore.exportWarmPaths(job,t);
      try{
        if(layers){
          const qp=paths.qp,k=paths.wadnr;
          if(!cacheGet(k,TTL_TILE)){
            const r=await upstream({host:WADNR_HOST, path:WADNR_MAP+"/export"+qp, method:"GET",
                                    headers:{"User-Agent":"clear-skies-portal"}, __timeout:TILE_MS});
            if(r.status===200 && isPng(r.body)){ cachePut(k,200,"image/png",r.body); warm.ok++; warm.bytes+=r.body.length }
          } else { warm.ok++ }
        }
        const dp=paths.dp,dk=paths.dep;
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
    }catch(e){ console.error("area manifest not recorded:",e) }
  }
  warm.running=false;warm.stop=false;
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
      const {national:nationalKey,raw:rawKey}=cacheBudgetCore.elevationWarmKeys(t);
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
          if(out){cachePut(nationalKey,200,"image/png",out.png,{coverage:out.coverage});tileBytes+=out.png.length}
          else cachePut(nationalKey,204,"image/png",Buffer.alloc(0));
        };
        const loadRaw=async()=>{
          const hit=cacheGet(rawKey,TTL_TILE);
          if(hit){available=true;tileBytes+=hit.body.length;return}
          const out=await terrainPool.run("raw-elevation",{...t,size:256},
            {priority:5,timeoutMs:45000,signal:controller.signal});
          fetched=true;available=true;
          if(out){cachePut(rawKey,200,"image/png",out.png,{coverage:out.coverage});tileBytes+=out.png.length}
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
  if(!usgsWarm.stop&&(usgsWarm.ok||usgsWarm.skipped)){
    try{ await usgs.finalizeWarm(job,usedKeys,usgsWarm) }catch(error){ usgsWarm.error=String(error.message||error) }
  }
  usgsWarm.running=false;usgsWarm.stop=false; usgsWarm.controllers.clear();
}

function stopUsgsWarm(){
  usgsWarm.stop=true;
  for(const controller of usgsWarm.controllers) controller.abort();
  return usgsWarmState();
}

const routes={
  /* ---- pre-cache an area so it's instant (and works offline) later ---- */
  "/api/warm":async(req,res,{u,p,signal})=>{
    const job = validateWarmJob(await readJson(req,{}),"wadnr");
    if(warm.running) return send(res,409,"application/json",Buffer.from(JSON.stringify({error:"already running", ...warmState()})));
    cacheBudget.invalidatePins();
    startWarm(job).catch(err=>{
      warm.running=false; warm.error=String(err.message||err); console.error(err);
    });
    return send(res,200,"application/json",Buffer.from(JSON.stringify(warmState())));
  },
  "/api/warm/status":async(req,res,{u,p,signal})=>{
    return send(res,200,"application/json",Buffer.from(JSON.stringify(warmState())));
  },
  "/api/warm/areas":async(req,res,{u,p,signal})=>{
    return send(res,200,"application/json",Buffer.from(JSON.stringify(areaList())));
  },
  "/api/warm/check":async(req,res,{u,p,signal})=>{
    const want = u.searchParams.get("id");
    const list = areaList().filter(a=>!want || a.id===want);
    const out=[];
    for(const a of list){ try{ out.push(await areaCheck(a)) }catch(e){ out.push({...a,checkFailed:true}) } }
    return send(res,200,"application/json",Buffer.from(JSON.stringify(out)));
  },
  "/api/warm/stop":async(req,res,{u,p,signal})=>{
    warm.stop=true;
    return send(res,200,"application/json",Buffer.from(JSON.stringify(warmState())));
  },
  /* Freshness, the way WA DNR cannot do it: HEAD and compare ETag. */
  "/api/usgs/check":async(req,res,{u,p,signal})=>{
    const entries=await readJson(req,[]);
    if(!Array.isArray(entries)||entries.length>500) throw new HttpError(400,"JSON array with at most 500 entries required");
    const out=await usgs.checkFresh(entries);
    return send(res,200,"application/json",Buffer.from(JSON.stringify(out)));
  },
  /* ---- USGS 1 m: download an area, resumable ---- */
  "/api/usgs/warm":async(req,res,{u,p,signal})=>{
    const job=validateWarmJob(await readJson(req,{}),"usgs");
    const st=usgsWarmState();
    if(st.running) return send(res,409,"application/json",Buffer.from(JSON.stringify({error:"already running",...st})));
    cacheBudget.invalidatePins();
    startUsgsWarm(job).catch(err=>{ usgsWarm.running=false; usgsWarm.error=String(err.message||err); console.error(err) });
    return send(res,200,"application/json",Buffer.from(JSON.stringify(usgsWarmState())));
  },
  "/api/usgs/warm/status":async(req,res,{u,p,signal})=>{
    return send(res,200,"application/json",Buffer.from(JSON.stringify(usgsWarmState())));
  },
  "/api/usgs/warm/stop":async(req,res,{u,p,signal})=>{
    return send(res,200,"application/json",Buffer.from(JSON.stringify(stopUsgsWarm())));
  },
  "/api/usgs/areas":async(req,res,{u,p,signal})=>{
    return send(res,200,"application/json",Buffer.from(JSON.stringify(usgs.areaList())));
  },
  "/api/usgs/areas/check":async(req,res,{u,p,signal})=>{
    const want=u.searchParams.get("id");
    const list=usgs.areaList().filter(a=>!want||a.id===want);
    const out=[];
    for(const a of list){ try{ out.push(await usgs.areaCheck(a)) }catch(e){ out.push({...a,checkFailed:true}) } }
    return send(res,200,"application/json",Buffer.from(JSON.stringify(out)));
  },
  "/api/usgs/plan":async(req,res,{u,p,signal})=>{
    const bbox=(u.searchParams.get("bbox")||"").split(",").map(Number);
    const z0=+u.searchParams.get("z0"), z1=+u.searchParams.get("z1");
    if(!validBbox(bbox)||!Number.isInteger(z0)||!Number.isInteger(z1)||z0<1||z1>20||z0>z1)
      return send(res,400,"application/json",Buffer.from('{"error":"bbox,z0,z1 required"}'));
    const job=validateWarmJob({bbox,z0,z1,style:"hs"},"usgs");
    const n=job.total;
    return send(res,200,"application/json",Buffer.from(JSON.stringify({tiles:n})));
  },
};

module.exports={init,running,routes};
