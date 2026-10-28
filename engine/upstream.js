/* Upstream requests: one keep-alive HTTPS agent, a concurrency lane per host,
   and sharing of identical requests that every waiter can leave. */
"use strict";
const https = require("https");
const zlib = require("zlib");
const {TerrainPoolError} = require("../terrain-pool.js");
const {cacheGet,cachePut} = require("./tile-cache.js");

const WADNR_HOST = "lidarportal.dnr.wa.gov";
const WADNR_MAP  = "/arcgis/rest/services/lidar/wadnr_hillshade/MapServer";
const DEP_HOST   = "elevation.nationalmap.gov";
const TILE_MS    = 30000;             // WA DNR is slow; 3DEP shows underneath meanwhile

const MAX_UPSTREAM_BODY = 32*1024*1024;
const HTTPS_AGENT = new https.Agent({keepAlive:true,maxSockets:10,maxFreeSockets:5,timeout:30000});

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
/* That limit is WA DNR's. USGS 3DEP (hillshade exports and the national
   elevation behind the 1 m terrain) used to wait in the same four-wide line,
   so one slow WA composite held up every USGS tile behind it. Each host now
   has its own line: WA DNR keeps four, USGS gets twelve. */
const MAX_INFLIGHT = 4;
const LANE_LIMITS = {[WADNR_HOST]:MAX_INFLIGHT, [DEP_HOST]:Math.max(1,Math.min(32,Number(process.env.CSP_USGS_INFLIGHT)||12))};
const lanes = new Map();
const lane = host => {
  const name = host||"";
  if(!lanes.has(name)) lanes.set(name,{inflight:0,queue:[],limit:LANE_LIMITS[name]||MAX_INFLIGHT});
  return lanes.get(name);
};
const upstreamLoad = () => { let inflight=0,queued=0; for(const l of lanes.values()){ inflight+=l.inflight; queued+=l.queue.length } return {inflight,queued} };
const pending = new Map();
function slot(signal,host){
  if(signal&&signal.aborted)
    return Promise.reject(new TerrainPoolError("upstream request cancelled","ABORT_ERR"));
  const line=lane(host);
  return new Promise((resolve,reject)=>{
    let settled=false;
    const waiter={grant:null};
    const cleanup=()=>{ if(signal) signal.removeEventListener("abort",onAbort) };
    const onAbort=()=>{
      if(settled) return;
      settled=true; cleanup();
      const index=line.queue.indexOf(waiter); if(index>=0) line.queue.splice(index,1);
      reject(new TerrainPoolError("upstream request cancelled","ABORT_ERR"));
    };
    waiter.grant=()=>{
      if(settled) return;
      settled=true; cleanup(); line.inflight++; resolve();
    };
    if(signal) signal.addEventListener("abort",onAbort,{once:true});
    if(line.inflight < line.limit) waiter.grant(); else line.queue.push(waiter);
  });
}
function release(host){ const line=lane(host); line.inflight=Math.max(0,line.inflight-1); const n=line.queue.shift(); if(n) n.grant() }

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
      await slot(entry.controller.signal,opts.host);
      try{ return await upstream({...opts,signal:entry.controller.signal},body) }
      finally{ release(opts.host) }
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

/* A cancelled request: the viewer left, so there is nobody to answer. */
const terrainAborted=error=>error&&error.code==="ABORT_ERR";

module.exports={WADNR_HOST,WADNR_MAP,DEP_HOST,TILE_MS,upstream,upstreamLoad,slot,release,coalesce,cached,limitedUpstream,terrainAborted};
