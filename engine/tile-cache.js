/* The engine's tile cache: a bounded RAM LRU in front of the disk cache, a
   free-space reserve, and the budget worker that evicts what is unpinned. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cacheBudgetCore = require("../cache-budget.js");

const TTL_TILE   = 90*24*3600*1000;   // lidar hillshade never changes
const TTL_META   = 7*24*3600*1000;
const CACHE_MIN_FREE_GIB=Math.max(0,Number(process.env.CSP_CACHE_MIN_FREE_GB)||8);
const CACHE_MIN_FREE_BYTES=CACHE_MIN_FREE_GIB*1024*1024*1024;
let CACHE = null, cacheCount = 0, cacheBudget = null;

/* canEvict reports whether eviction may run: an area download changes its
   eventual pin set, so eviction waits until its manifest is finalized. */
function init(dir,{canEvict}){
  CACHE=dir;
  cacheCount=cacheEntryCount();
  cacheBudget=new cacheBudgetCore.CacheBudget(CACHE,{
    onEvict:()=>{cacheCount=Math.max(0,cacheCount-1)},
    canEvict
  });
  return cacheBudget;
}
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
  return {body:value.body,type:value.type,status:value.status,sourceMeta:value.sourceMeta};
}
function cacheGet(k, ttl){
  const warm=memoryCacheGet(k,ttl);if(warm){cacheBudgetCore.touchAccess(path.join(CACHE,k));return warm}
  const f = path.join(CACHE, k);
  try{
    const st = fs.statSync(f);
    if(Date.now() - st.mtimeMs > ttl) return null;
    const raw = JSON.parse(fs.readFileSync(f + ".meta", "utf8"));
    const value={body: fs.readFileSync(f), ...raw};
    cacheBudgetCore.touchAccess(f,st);
    memoryCachePut(k,value,st.mtimeMs);return value;
  }catch(e){ return null }
}
function cachePut(k, status, type, body,sourceMeta){
  /* RAM stays useful even when the disk has reached its safety reserve. The
     previous ordering disabled both caches exactly when storage pressure made
     memory hits most valuable. */
  memoryCachePut(k,{status,type,body,sourceMeta});
  if(!cacheDiskStats((body&&body.length||0)+4096).writable) return true;
  const target=path.join(CACHE,k), suffix=`.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const bodyTmp=target+suffix, metaTmp=target+".meta"+suffix;
  const isNew=!fs.existsSync(target);
  try{
    cacheBudgetCore.guardedWrite(cacheBudgetCore.writeGate,()=>{
      fs.writeFileSync(bodyTmp, body);
      fs.writeFileSync(metaTmp, JSON.stringify({status,type,sourceMeta}));
      fs.renameSync(bodyTmp,target);
      fs.renameSync(metaTmp,target+".meta");
      if(isNew) cacheCount++;
      cacheBudget.noteWrite(body.length+Buffer.byteLength(JSON.stringify({status,type,sourceMeta})));
    });
    return true;
  }catch(e){
    try{ fs.unlinkSync(bodyTmp) }catch(e2){}
    try{ fs.unlinkSync(metaTmp) }catch(e2){}
  }
  return false;
}

const memoryStats=()=>({entries:cacheMemory.size,entryLimit:CACHE_MEMORY_ENTRY_LIMIT,
  MiB:+(cacheMemoryBytes/1048576).toFixed(1),limitMiB:CACHE_MEMORY_LIMIT/1048576});

module.exports={TTL_TILE,TTL_META,init,key,cacheGet,cachePut,cacheDiskStats,memoryStats,count:()=>cacheCount};
