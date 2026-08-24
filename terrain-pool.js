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

class TerrainPool {
  constructor({cacheDir,size,maxQueue=40,workerFile=path.join(__dirname,"terrain-worker.js")}={}){
    const available=typeof os.availableParallelism==="function" ? os.availableParallelism() : os.cpus().length;
    const configured=Number(process.env.CSP_TERRAIN_WORKERS||size||0);
    this.size=Math.max(1,Math.min(6,Number.isInteger(configured)&&configured>0 ? configured : Math.min(4,Math.max(2,available-2))));
    this.cacheDir=cacheDir;
    this.maxQueue=maxQueue;
    this.workerFile=workerFile;
    this.queue=[];
    this.slots=[];
    this.nextId=1;
    this.sequence=1;
    this.closed=false;
    this.metrics={completed:0,failed:0,cancelled:0,timedOut:0,restarted:0,totalMs:0};
    for(let i=0;i<this.size;i++) this._spawn({index:i,worker:null,job:null,replacing:false});
  }

  _spawn(slot){
    if(this.closed) return;
    const worker=new Worker(this.workerFile,{workerData:{cacheDir:this.cacheDir},resourceLimits:{maxOldGenerationSizeMb:512}});
    slot.worker=worker; slot.job=null; slot.replacing=false;
    if(!this.slots.includes(slot)) this.slots.push(slot);
    worker.on("message",message=>this._finish(slot,message));
    worker.on("error",error=>this._workerFailed(slot,error));
    worker.on("exit",code=>{
      if(this.closed) return;
      if(slot.worker!==worker) return;
      const job=slot.job;
      slot.worker=null; slot.job=null;
      if(job) this._rejectJob(job,new TerrainPoolError(`terrain worker exited (${code})`,"WORKER_EXIT"),"failed");
      this.metrics.restarted++;
      this._spawn(slot);
      this._drain();
    });
  }

  _workerFailed(slot,error){
    if(slot.job) this._retire(slot,new TerrainPoolError(String(error&&error.message||error),"WORKER_ERROR"),"failed");
  }

  run(action,args,{priority=0,timeoutMs=30000,signal}={}){
    if(this.closed) return Promise.reject(new TerrainPoolError("terrain pool is closed","CLOSED"));
    if(signal&&signal.aborted) return Promise.reject(abortError());
    if(this.queue.length>=this.maxQueue) return Promise.reject(new TerrainPoolError("terrain queue is full","QUEUE_FULL"));
    return new Promise((resolve,reject)=>{
      const job={id:this.nextId++,sequence:this.sequence++,action,args,priority,timeoutMs,
        signal,resolve,reject,started:0,timer:null,onAbort:null,settled:false};
      job.onAbort=()=>this._cancel(job);
      if(signal) signal.addEventListener("abort",job.onAbort,{once:true});
      this.queue.push(job);
      this.queue.sort((a,b)=>b.priority-a.priority||a.sequence-b.sequence);
      this._drain();
    });
  }

  _drain(){
    if(this.closed) return;
    for(const slot of this.slots){
      if(!slot.worker||slot.job||slot.replacing) continue;
      let job=null;
      while(this.queue.length&&!job){
        const candidate=this.queue.shift();
        if(candidate.signal&&candidate.signal.aborted) this._rejectJob(candidate,abortError(),"cancelled");
        else job=candidate;
      }
      if(!job) continue;
      slot.job=job; job.started=Date.now();
      job.timer=setTimeout(()=>this._retire(slot,new TerrainPoolError("terrain render timed out","TIMEOUT"),"timedOut"),job.timeoutMs);
      slot.worker.postMessage({id:job.id,action:job.action,args:job.args});
    }
  }

  _finish(slot,message){
    const job=slot.job;
    if(!job||message.id!==job.id) return;
    slot.job=null;
    clearTimeout(job.timer);
    this._detach(job);
    job.settled=true;
    this.metrics.totalMs+=Date.now()-job.started;
    if(message.ok){ this.metrics.completed++; job.resolve(message.result) }
    else { this.metrics.failed++; job.reject(new TerrainPoolError(message.error||"terrain worker failed","WORKER_TASK")) }
    this._drain();
  }

  _cancel(job){
    if(job.settled) return;
    const queued=this.queue.indexOf(job);
    if(queued>=0){ this.queue.splice(queued,1); this._rejectJob(job,abortError(),"cancelled"); return }
    const slot=this.slots.find(value=>value.job===job);
    if(slot) this._retire(slot,abortError(),"cancelled");
  }

  _retire(slot,error,metric){
    const job=slot.job;
    if(!job||job.settled) return;
    slot.job=null; slot.replacing=true;
    clearTimeout(job.timer);
    this._rejectJob(job,error,metric);
    const worker=slot.worker;
    slot.worker=null;
    if(worker) worker.terminate().finally(()=>{ if(!this.closed){ this.metrics.restarted++; this._spawn(slot); this._drain() } });
  }

  _rejectJob(job,error,metric){
    if(job.settled) return;
    job.settled=true; clearTimeout(job.timer); this._detach(job);
    if(metric&&Object.hasOwn(this.metrics,metric)) this.metrics[metric]++;
    job.reject(error);
  }

  _detach(job){ if(job.signal&&job.onAbort) job.signal.removeEventListener("abort",job.onAbort) }

  stats(){
    const active=this.slots.filter(slot=>!!slot.job).length;
    const avgMs=this.metrics.completed ? Math.round(this.metrics.totalMs/this.metrics.completed) : 0;
    return {workers:this.size,active,queued:this.queue.length,avgMs,...this.metrics};
  }

  async close(){
    this.closed=true;
    const error=new TerrainPoolError("terrain pool closed","CLOSED");
    for(const job of this.queue.splice(0)) this._rejectJob(job,error,"cancelled");
    const workers=this.slots.map(slot=>slot.worker).filter(Boolean);
    for(const slot of this.slots){
      if(slot.job) this._rejectJob(slot.job,error,"cancelled");
      slot.job=null; slot.worker=null;
    }
    await Promise.all(workers.map(worker=>worker.terminate().catch(()=>{})));
  }
}

module.exports={TerrainPool,TerrainPoolError};

