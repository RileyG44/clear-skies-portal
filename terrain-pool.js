"use strict";

const os = require("os");
const path = require("path");
const {Worker} = require("worker_threads");

class TerrainPoolError extends Error {
  constructor(message,code="TERRAIN_ERROR"){
    super(message); this.name="TerrainPoolError"; this.code=code;
  }
}

const abortError=()=>new TerrainPoolError("terrain request cancelled","ABORT_ERR");

/* Tile renders spend much of their life waiting on S3 range reads, during
   which their worker's thread is idle. Those actions may share a worker: a
   second render starts on a busy worker while the first awaits the network,
   so a cold area keeps every core busy instead of one request per core.
   CPU-bound actions (analysis, fabric, TIFF decode) still get a worker to
   themselves. Idle workers are always filled before any worker is doubled. */
const SHAREABLE=new Set(["raw-terrain","raw-elevation"]);

class TerrainPool {
  constructor({cacheDir,size,maxQueue=40,workerFile=path.join(__dirname,"terrain-worker.js"),jobsPerWorker,shareable=SHAREABLE}={}){
    const available=typeof os.availableParallelism==="function" ? os.availableParallelism() : os.cpus().length;
    const configured=Number(process.env.CSP_TERRAIN_WORKERS||size||0);
    /* Default: every core but one (up to 8). Each render is mostly waiting on
       S3 range reads and decoding, so the Mac serves raw LiDAR fastest when
       all of it is working; the one spare keeps the HTTP server responsive. */
    this.size=Math.max(1,Math.min(8,Number.isInteger(configured)&&configured>0 ? configured : Math.max(2,available-1)));
    const perWorker=Number(jobsPerWorker??process.env.CSP_TERRAIN_JOBS_PER_WORKER??2);
    this.jobsPerWorker=Math.max(1,Math.min(4,Number.isInteger(perWorker)?perWorker:2));
    this.shareable=new Set(shareable);
    this.cacheDir=cacheDir;
    this.maxQueue=maxQueue;
    this.workerFile=workerFile;
    this.queue=[];
    this.slots=[];
    this.nextId=1;
    this.sequence=1;
    this.closed=false;
    this.metrics={completed:0,failed:0,cancelled:0,timedOut:0,restarted:0,requeued:0,totalMs:0};
    this.cancelGraceMs=2000;
    for(let i=0;i<this.size;i++) this._spawn({index:i,worker:null,jobs:new Set(),replacing:false});
  }

  _spawn(slot){
    if(this.closed) return;
    const worker=new Worker(this.workerFile,{workerData:{cacheDir:this.cacheDir},resourceLimits:{maxOldGenerationSizeMb:512}});
    slot.worker=worker; slot.jobs=new Set(); slot.replacing=false;
    if(!this.slots.includes(slot)) this.slots.push(slot);
    worker.on("message",message=>this._finish(slot,message));
    worker.on("error",error=>this._workerFailed(slot,error));
    worker.on("exit",code=>{
      if(this.closed) return;
      if(slot.worker!==worker) return;
      const jobs=[...slot.jobs];
      slot.worker=null; slot.jobs=new Set();
      for(const job of jobs) this._rejectJob(job,new TerrainPoolError(`terrain worker exited (${code})`,"WORKER_EXIT"),"failed");
      this.metrics.restarted++;
      this._spawn(slot);
      this._drain();
    });
  }

  _workerFailed(slot,error){
    const first=[...slot.jobs].find(job=>!job.settled);
    if(first) this._retire(slot,first,new TerrainPoolError(String(error&&error.message||error),"WORKER_ERROR"),"failed");
  }

  run(action,args,{priority=0,timeoutMs=30000,signal,finishOnAbort=false,transferList=[]}={}){
    if(this.closed) return Promise.reject(new TerrainPoolError("terrain pool is closed","CLOSED"));
    if(signal&&signal.aborted) return Promise.reject(abortError());
    if(this.queue.length>=this.maxQueue) return Promise.reject(new TerrainPoolError("terrain queue is full","QUEUE_FULL"));
    return new Promise((resolve,reject)=>{
      if(!Array.isArray(transferList)) return reject(new TypeError("transferList must be an array"));
      const job={id:this.nextId++,sequence:this.sequence++,action,args,priority,timeoutMs,finishOnAbort,transferList,
        signal,resolve,reject,started:0,timer:null,onAbort:null,settled:false,shareable:this.shareable.has(action)};
      job.onAbort=()=>this._cancel(job);
      if(signal) signal.addEventListener("abort",job.onAbort,{once:true});
      this._enqueue(job);
      this._drain();
    });
  }

  _enqueue(job){
    this.queue.push(job);
    this.queue.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);
  }

  /* Can this slot take `job` now? An empty worker takes anything; a busy one
     only takes a shareable job, only beside shareable jobs, up to the limit. */
  _accepts(slot,job){
    if(!slot.worker||slot.replacing) return false;
    if(!slot.jobs.size) return true;
    if(!job.shareable||slot.jobs.size>=this.jobsPerWorker) return false;
    for(const running of slot.jobs) if(!running.shareable||running.abandoned) return false;
    return true;
  }

  _drain(){
    if(this.closed) return;
    for(;;){
      while(this.queue.length&&this.queue[0].signal&&this.queue[0].signal.aborted)
        this._rejectJob(this.queue.shift(),abortError(),"cancelled");
      if(!this.queue.length) return;
      const job=this.queue[0];
      /* Least-loaded worker first, so a second job only doubles up when no
         worker is idle. */
      let slot=null;
      for(const candidate of this.slots)
        if(this._accepts(candidate,job)&&(!slot||candidate.jobs.size<slot.jobs.size)) slot=candidate;
      if(!slot) return;
      this.queue.shift();
      this._start(slot,job);
    }
  }

  _start(slot,job){
    slot.jobs.add(job); job.started=Date.now();
    job.timer=setTimeout(()=>this._retire(slot,job,new TerrainPoolError("terrain render timed out","TIMEOUT"),"timedOut"),job.timeoutMs);
    try{
      if(job.transferList.some(value=>value instanceof ArrayBuffer&&value.byteLength===0))
        throw new TypeError("transferList contains a detached ArrayBuffer");
      slot.worker.postMessage({id:job.id,action:job.action,args:job.args},job.transferList);
    }
    catch(error){
      slot.jobs.delete(job);clearTimeout(job.timer);
      this._rejectJob(job,new TerrainPoolError(String(error&&error.message||error),"TRANSFER_ERROR"),"failed");
    }
  }

  _finish(slot,message){
    const job=[...slot.jobs].find(value=>value.id===message.id);
    if(!job) return;
    slot.jobs.delete(job);
    clearTimeout(job.timer);
    this._detach(job);
    this.metrics.totalMs+=Date.now()-job.started;
    if(!job.abandoned&&!job.settled){
      job.settled=true;
      if(message.ok){ this.metrics.completed++; job.resolve(message.result) }
      else { this.metrics.failed++; job.reject(new TerrainPoolError(message.error||"terrain worker failed","WORKER_TASK")) }
    }
    this._drain();
  }

  _cancel(job){
    if(job.settled) return;
    const queued=this.queue.indexOf(job);
    if(queued>=0){ this.queue.splice(queued,1); this._rejectJob(job,abortError(),"cancelled"); return }
    const slot=this.slots.find(value=>value.jobs.has(job));
    if(slot){
      /* Visible terrain routes opt into finishing an already-started render.
         The HTTP viewer may have zoomed away, but completing preserves the
         worker's decoded COG state and lets the route commit the result to the
         shared disk cache. Queued work still cancels immediately above. */
      if(job.finishOnAbort){ this.metrics.cancelled++;this._detach(job);return }
      /* Most COG jobs are already holding useful decoded blocks or range reads
         when a pan unloads their browser tile. Give them a short grace period
         to finish and keep the warm worker state. Only a genuinely stale job
         is terminated; rapid pan/zoom no longer recreates every worker. */
      job.abandoned=true;
      this._rejectJob(job,abortError(),"cancelled");
      job.timer=setTimeout(()=>this._terminateAbandoned(slot,job),this.cancelGraceMs);
    }
  }

  _terminateAbandoned(slot,job){
    if(!slot.jobs.has(job)||!job.abandoned) return;
    this._replaceWorker(slot);
  }

  _retire(slot,job,error,metric){
    if(!job||job.settled||!slot.jobs.has(job)) return;
    clearTimeout(job.timer);
    this._rejectJob(job,error,metric);
    this._replaceWorker(slot);
  }

  /* Terminating a worker takes every job on it. The ones that did nothing
     wrong - they were sharing the worker with a render that hung - go back
     to the front of the queue rather than failing with it. */
  _replaceWorker(slot){
    const bystanders=[...slot.jobs].filter(job=>!job.settled&&!job.abandoned);
    for(const job of slot.jobs) clearTimeout(job.timer);
    slot.jobs=new Set(); slot.replacing=true;
    for(const job of bystanders){ job.started=0; job.timer=null; this.metrics.requeued++; this._enqueue(job) }
    const worker=slot.worker; slot.worker=null;
    if(worker) worker.terminate().finally(()=>{ if(!this.closed){ this.metrics.restarted++; this._spawn(slot); this._drain() } });
    this._drain();
  }

  _rejectJob(job,error,metric){
    if(job.settled) return;
    job.settled=true; clearTimeout(job.timer); this._detach(job);
    if(metric&&Object.hasOwn(this.metrics,metric)) this.metrics[metric]++;
    job.reject(error);
  }

  _detach(job){ if(job.signal&&job.onAbort) job.signal.removeEventListener("abort",job.onAbort) }

  stats(){
    const active=this.slots.reduce((sum,slot)=>sum+slot.jobs.size,0);
    const avgMs=this.metrics.completed ? Math.round(this.metrics.totalMs/this.metrics.completed) : 0;
    return {workers:this.size,jobsPerWorker:this.jobsPerWorker,active,queued:this.queue.length,avgMs,...this.metrics};
  }

  async close(){
    this.closed=true;
    const error=new TerrainPoolError("terrain pool closed","CLOSED");
    for(const job of this.queue.splice(0)) this._rejectJob(job,error,"cancelled");
    const workers=this.slots.map(slot=>slot.worker).filter(Boolean);
    for(const slot of this.slots){
      for(const job of slot.jobs) this._rejectJob(job,error,"cancelled");
      slot.jobs=new Set(); slot.worker=null;
    }
    await Promise.all(workers.map(worker=>worker.terminate().catch(()=>{})));
  }
}

module.exports={TerrainPool,TerrainPoolError};
