"use strict";
/* Only disposable SHA1 bodies in the two known directories belong to this
   budget. Saved areas, catalogues and the independent DNR store are never
   walked. Reads explicitly touch atime: macOS volume policy is not an LRU. */
const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto");
const {Worker,isMainThread,workerData,parentPort}=require("worker_threads");
const GIB=1073741824, HOUR=3600000, YOUNG_MS=10*60000;
/* Atomic replacements and a sweep's final check/unlink share a nonblocking
   gate across terrain workers. Writers return their result without persisting
   if busy; nobody waits on the HTTP thread, and young replacements cannot be
   removed between the final lstat and unlink. */
const writeGate=new SharedArrayBuffer(4);
const acquire=gate=>Atomics.compareExchange(new Int32Array(gate),0,0,-1)===0;
const release=gate=>Atomics.store(new Int32Array(gate),0,0);
function guardedWrite(gate,write){
  /* Positive counts allow independent writers to proceed together; -1 is an
     exclusive deletion. CAS retries contend only on a few atomic operations,
     never on I/O or another worker's completion. */
  const state=new Int32Array(gate);let n=Atomics.load(state,0);
  while(n>=0){if(Atomics.compareExchange(state,0,n,n+1)===n)break;n=Atomics.load(state,0)}
  if(n<0)return false;
  try{write();return true}finally{Atomics.sub(state,0,1)}
}
const sha1=value=>crypto.createHash("sha1").update(value).digest("hex");
const yieldIO=()=>new Promise(resolve=>setImmediate(resolve));
function maxGiB(value=process.env.CSP_CACHE_MAX_GB){
  const n=Number(value);return Number.isFinite(n)&&n>0?n:15;
}
function tileRange(bbox,z){
  const [w,s,e,n]=bbox,N=2**z;
  const xt=lon=>Math.floor((lon+180)/360*N);
  const yt=lat=>Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*N);
  return {x0:Math.max(0,xt(w)),x1:Math.min(N-1,xt(e)),y0:Math.max(0,yt(n)),y1:Math.min(N-1,yt(s))};
}
function mercBbox(z,x,y){
  const R=20037508.342789244,sp=2*R/2**z,x0=-R+x*sp,y1=R-y*sp;
  return `${x0},${y1-sp},${x0+sp},${y1}`;
}
function exportWarmPaths(job,{z,x,y}){
  const bb=mercBbox(z,x,y),layers=String(job.layers||"").replace(/[^\d,]/g,"");
  const qp=`?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&dpi=96&f=image&layers=show:${layers}`;
  const rr=encodeURIComponent(JSON.stringify({rasterFunction:String(job.rule||"Hillshade Gray")}));
  const dp=`/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&renderingRule=${rr}`;
  return {qp,dp,wadnr:layers?sha1("wadnr:export:"+qp):null,dep:sha1("3dep:"+dp)};
}
const elevationWarmKeys=({z,x,y})=>({national:sha1(`elevation-national-v1:${z}/${x}/${y}`),raw:sha1(`usgselev:${z}/${x}/${y}`)});
const renderedWarmKey=(style,z,x,y,version="terrain-v3")=>sha1(`${version}:${style}:${z}/${x}/${y}`);
function* manifestKeys(job,kind){
  const b=job&&job.bbox;
  if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]>=b[2]||b[1]>=b[3]||b[0]<-180||b[2]>180||b[1]<-85.051129||b[3]>85.051129||
     !Number.isInteger(job.z0)||!Number.isInteger(job.z1)||job.z0<1||job.z1>20||job.z0>job.z1) throw new Error("invalid saved-area bounds");
  for(let z=job.z0;z<=job.z1;z++){
    const r=tileRange(b,z);
    for(let x=r.x0;x<=r.x1;x++) for(let y=r.y0;y<=r.y1;y++){
      if(kind==="areas"){
        const keys=exportWarmPaths(job,{z,x,y});yield keys.dep;if(keys.wadnr)yield keys.wadnr;
      }else{
        /* Older manifests describe baked styles; current downloads save DEMs
           used by browser shaders. Old manifests omitted raw, so protect it
           conservatively. COG ranges are unnecessary for these disk hits. */
        yield renderedWarmKey(String(job.style||"hs"),z,x,y);
        const keys=elevationWarmKeys({z,x,y});yield keys.national;
        if(job.raw!==false&&z>=13)yield keys.raw;
      }
    }
  }
}
async function lstat(file){try{return await fsp.lstat(file)}catch(e){if(e.code==="ENOENT")return null;throw e}}
async function readPins(dir){
  const pins=new Set(),errors=[];let manifests=0,n=0;
  const rawDir=await lstat(path.join(dir,"usgs"));
  if(rawDir&&(!rawDir.isDirectory()||rawDir.isSymbolicLink()))throw new Error("unsafe USGS cache directory");
  for(const kind of ["areas","usgs/areas"]){
    const folder=path.join(dir,kind),st=await lstat(folder);
    if(!st)continue;
    if(!st.isDirectory()||st.isSymbolicLink()){errors.push(`${kind}: unsafe directory`);continue}
    for(const entry of await fsp.readdir(folder,{withFileTypes:true})){
      if(!entry.name.endsWith(".json")||!entry.isFile())continue;
      try{
        const job=JSON.parse(await fsp.readFile(path.join(folder,entry.name),"utf8"));
        for(const key of manifestKeys(job,kind)){pins.add(key);if(++n%512===0)await yieldIO()}
        manifests++;
      }catch(e){errors.push(`${kind}/${entry.name}: ${e.message}`)}
    }
  }
  return {pins,manifests,errors};
}
const touchPending=new Map();
function touchAccess(file,stat,now=Date.now()){
  /* A small attempt table also throttles RAM hits (which have no disk stat).
     Open + futimes keeps a concurrent atomic replacement's mtime untouched. */
  if(stat&&now-stat.atimeMs<HOUR)return Promise.resolve(false);
  const previous=touchPending.get(file);
  if(previous&&now-previous.at<HOUR)return previous.work;
  const work=(async()=>{
    let handle;
    try{
      handle=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const st=await handle.stat();if(!st.isFile()||now-st.atimeMs<HOUR)return false;
      await handle.utimes(now/1000,st.mtimeMs/1000);return true;
    }catch(e){return false}finally{if(handle)await handle.close()}
  })();
  touchPending.set(file,{at:now,work});
  if(touchPending.size>16384)touchPending.delete(touchPending.keys().next().value);
  return work;
}
function category(){return {bytes:0,pinnedBytes:0,evictableBytes:0,protectedBytes:0,evictedBytes:0,evictedCount:0}}
async function scan(dir,{pins,now=Date.now(),youngMs=YOUNG_MS}={}){
  const entries=[],categories={root:category(),usgs:category()};
  for(const name of ["root","usgs"]){
    const folder=name==="root"?dir:path.join(dir,"usgs"),st=await lstat(folder);
    if(!st)continue;
    if(!st.isDirectory()||st.isSymbolicLink())throw new Error(`unsafe cache directory: ${folder}`);
    const files=await fsp.readdir(folder,{withFileTypes:true}),names=new Set(files.filter(e=>e.isFile()).map(e=>e.name));
    let batch=[];
    const inspect=async entry=>{
      /* Pair orphan metadata too, but never follow a symlink or include tmp,
         JSON, other subdirectories, or files whose names we don't own. */
      if(!entry.isFile()||!/^([a-f0-9]{40})(\.meta)?$/.test(entry.name))return;
      const key=entry.name.slice(0,40);if(entry.name.endsWith(".meta")&&names.has(key))return;
      const body=path.join(folder,key),bodyStat=await lstat(body),metaStat=await lstat(body+".meta");
      const parts=[{file:body,stat:bodyStat},{file:body+".meta",stat:metaStat}].filter(p=>p.stat);
      if(!parts.length||parts.some(p=>!p.stat.isFile()||p.stat.isSymbolicLink()))return;
      const bytes=parts.reduce((n,p)=>n+p.stat.size,0),pinned=name==="root"&&pins.has(key);
      const young=parts.some(p=>now-p.stat.mtimeMs<youngMs),atime=(bodyStat||metaStat).atimeMs;
      const c=categories[name];c.bytes+=bytes;
      if(pinned)c.pinnedBytes+=bytes;else if(young)c.protectedBytes+=bytes;else c.evictableBytes+=bytes;
      entries.push({key,category:name,parts,bytes,pinned,young,atime});
    };
    for(const entry of files){batch.push(inspect(entry));if(batch.length===32){await Promise.all(batch);batch=[];await yieldIO()}}
    await Promise.all(batch);
  }
  return {entries,categories};
}
function planEviction(entries,capBytes,lowWater=.9){
  const bytes=entries.reduce((n,e)=>n+e.bytes,0),pinnedBytes=entries.filter(e=>e.pinned).reduce((n,e)=>n+e.bytes,0);
  const candidates=entries.filter(e=>!e.pinned&&!e.young).sort((a,b)=>a.atime-b.atime||a.category.localeCompare(b.category)||a.key.localeCompare(b.key));
  return {bytes,pinnedBytes,targetBytes:Math.floor(capBytes*lowWater),pinnedOverCap:pinnedBytes>capBytes,candidates:bytes>capBytes?candidates:[]};
}
async function sweep(dir,{capBytes=maxGiB()*GIB,lowWater=.9,now=Date.now(),youngMs=YOUNG_MS,dryRun=false,canEvict=()=>true,onEvict=()=>{},deleting=new Set(),gate=writeGate}={}){
  const protectedSet=await readPins(dir),{entries,categories}=await scan(dir,{pins:protectedSet.pins,now,youngMs});
  const plan=planEviction(entries,capBytes,lowWater);
  const out={bytes:plan.bytes,capGiB:capBytes/GIB,pinnedBytes:plan.pinnedBytes,pinnedOverCap:plan.pinnedOverCap,
    targetBytes:plan.targetBytes,evictableBytes:Object.values(categories).reduce((n,c)=>n+c.evictableBytes,0),
    protectedBytes:Object.values(categories).reduce((n,c)=>n+c.protectedBytes,0),lastSweepTime:new Date(now).toISOString(),
    evictedCount:0,evictedBytes:0,rootBodiesEvicted:0,manifests:protectedSet.manifests,errors:protectedSet.errors,categories,dryRun};
  /* An unreadable manifest means we cannot establish its pins. Fail closed;
     this also makes partially-written legacy manifests safe on startup. */
  if(out.errors.length)return {...out,overCap:out.bytes>capBytes};
  for(const entry of plan.candidates){
    if(out.bytes<=plan.targetBytes&&!plan.pinnedOverCap)break;
    if(!canEvict()){out.interrupted=true;break}
    if(!dryRun){
      if(!acquire(gate)){await yieldIO();continue}
      deleting.add(entry.key);
      let removed=false,rootRemoved=false;
      try{
        /* This runs in the sweep worker. Never await with the exclusive gate
           held: synchronous re-check/unlink confines writer skips to this
           entry, and the yield below gives writers a gap between entries. */
        let unchanged=true;
        for(const part of entry.parts){
          const st=fs.lstatSync(part.file),old=part.stat;
          if(!st||!st.isFile()||st.ino!==old.ino||st.size!==old.size||st.mtimeMs!==old.mtimeMs||
             st.atimeMs!==old.atimeMs||Date.now()-st.mtimeMs<youngMs){unchanged=false;break}
        }
        if(unchanged&&canEvict())for(const part of entry.parts){
          fs.unlinkSync(part.file);removed=true;
          out.bytes-=part.stat.size;out.evictedBytes+=part.stat.size;categories[entry.category].evictedBytes+=part.stat.size;
          if(entry.category==="root"&&!part.file.endsWith(".meta")){out.rootBodiesEvicted++;rootRemoved=true}
        }
      }catch(e){if(e.code!=="ENOENT")out.errors.push(e.message)}finally{deleting.delete(entry.key);release(gate)}
      if(rootRemoved)onEvict(entry.key);
      if(removed){out.evictedCount++;categories[entry.category].evictedCount++}
    }else{out.bytes-=entry.bytes;out.evictedBytes+=entry.bytes;categories[entry.category].evictedBytes+=entry.bytes;
      if(entry.category==="root"&&entry.parts.some(p=>!p.file.endsWith(".meta")))out.rootBodiesEvicted++;
      out.evictedCount++;categories[entry.category].evictedCount++}
    if(!dryRun||out.evictedCount%32===0)await yieldIO();
  }
  out.overCap=out.bytes>capBytes;return out;
}
class CacheBudget {
  constructor(dir,{onEvict=()=>{},canEvict=()=>true,startupMs=15000,intervalMs=12*60000,writeThreshold=256*1048576,dryRun=false}={}){
    this.dir=dir;this.capBytes=maxGiB()*GIB;this.dryRun=dryRun;this.stopSignal=new SharedArrayBuffer(4);this.onEvict=onEvict;this.canEvict=canEvict;this.writeThreshold=writeThreshold;
    this.written=0;this.running=null;this.closed=false;this.generation=0;
    this.state={bytes:null,capGiB:this.capBytes/GIB,pinnedBytes:null,lastSweepTime:null,evictedCount:0,evictedBytes:0};
    this.startup=setTimeout(()=>this.run(),startupMs);this.startup.unref();
    this.periodic=setInterval(()=>this.run(),intervalMs);this.periodic.unref();
  }
  invalidatePins(){this.generation++;Atomics.store(new Int32Array(this.stopSignal),0,this.generation)}
  noteWrite(bytes){
    this.written+=bytes;
    if(!this.closed&&this.written>=this.writeThreshold&&!this.scheduled&&!this.running){
      this.scheduled=setTimeout(()=>{this.scheduled=null;this.run()},1000);this.scheduled.unref();
    }
  }
  run(){
    if(this.closed||this.running)return this.running;
    const generation=this.generation,written=this.written;let succeeded=false;
    /* Even sorting a large LRU and materializing readdir results can pause
       for >100 ms. Keep the complete scan/plan/delete in a short-lived worker,
       with only tiny usage/counter messages crossing the HTTP event loop. */
    this.running=new Promise((resolve,reject)=>{
      const worker=new Worker(__filename,{workerData:{cacheBudgetSweep:true,dir:this.dir,capBytes:this.capBytes,
        gate:writeGate,stopSignal:this.stopSignal,generation,allowEvict:this.canEvict(),dryRun:this.dryRun}});
      let completed=false;
      worker.on("message",message=>{
        if(message.rootEvicted)this.onEvict();
        else if(message.result){completed=true;resolve(message.result)}
        else if(message.error){completed=true;reject(new Error(message.error))}
      });
      worker.on("error",reject);
      worker.on("exit",code=>{if(!completed)reject(new Error(`cache sweep worker exited (${code})`))});
    })
      .then(result=>{succeeded=true;this.state=result;this.written=Math.max(0,this.written-written);
        if(result.pinnedOverCap)console.warn(`Cache budget: saved areas use ${(result.pinnedBytes/GIB).toFixed(2)} GiB, above ${result.capGiB} GiB cap; kept all pins`);
        if(result.errors.length)console.warn("Cache budget:",result.errors.join("; "));
        return result})
      .catch(error=>{this.state={...this.state,error:error.message};console.warn("Cache budget:",error.message)})
      .finally(()=>{this.running=null;if(succeeded)this.noteWrite(0)});return this.running;
  }
  stats(){return {...this.state,bytesWrittenSinceSweep:this.written,sweeping:!!this.running}}
  async close(){this.closed=true;this.invalidatePins();clearTimeout(this.startup);clearTimeout(this.scheduled);clearInterval(this.periodic);await this.running}
}
module.exports={writeGate,guardedWrite,CacheBudget,GIB,HOUR,YOUNG_MS,maxGiB,sha1,tileRange,mercBbox,exportWarmPaths,elevationWarmKeys,renderedWarmKey,manifestKeys,readPins,touchAccess,scan,planEviction,sweep};

/* The same shipped file supplies the worker entry point; terrain workers also
   import its key/touch helpers, so only this explicit flag starts a sweep. */
if(!isMainThread&&workerData&&workerData.cacheBudgetSweep){
  sweep(workerData.dir,{capBytes:workerData.capBytes,gate:workerData.gate,dryRun:workerData.dryRun,
    canEvict:()=>workerData.allowEvict&&Atomics.load(new Int32Array(workerData.stopSignal),0)===workerData.generation,
    onEvict:()=>parentPort.postMessage({rootEvicted:1})})
    .then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:error.message}));
}
