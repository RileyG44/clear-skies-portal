/* A small leaf-worker pool. Copy cached grids only when a slot opens, then
   transfer the copies: detaching the cache itself would refetch on every light
   change. Abandoned queued jobs never copy, and late bitmaps are closed. */
(function(root,factory){
  const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.CSPTerrainDrapePool=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const aborted=()=>Object.assign(new Error("Drape tile cancelled"),{name:"AbortError"});
  class Pool{
    constructor({workerFactory,fallback,size=1}={}){
      this.workerFactory=workerFactory;this.fallback=fallback;this.size=Math.max(1,Math.min(4,size));
      this.slots=[];this.queue=[];this.jobs=new Set();this.serial=0;this.disabled=!workerFactory;
    }
    run(packet,signal){
      if(signal?.aborted)return Promise.reject(aborted());
      return new Promise((resolve,reject)=>{
        const job={id:++this.serial,packet,signal,resolve,reject,done:false};
        job.abort=()=>{this._finish(job,aborted());this.queue=this.queue.filter(value=>value!==job)};
        signal?.addEventListener("abort",job.abort,{once:true});this.jobs.add(job);this.queue.push(job);this._drain();
      });
    }
    _finish(job,error,data){
      if(job.done){data?.close?.();return}
      job.done=true;job.signal?.removeEventListener("abort",job.abort);this.jobs.delete(job);
      if(error)job.reject(error);else job.resolve(data);
    }
    _fallback(job){
      if(job.done)return;
      Promise.resolve().then(()=>{if(job.done)throw aborted();return this.fallback(job.packet,job.signal)})
        .then(data=>this._finish(job,null,data),error=>this._finish(job,error));
    }
    _fail(){
      this.disabled=true;
      for(const slot of this.slots){slot.worker.terminate();if(slot.job)this._fallback(slot.job)}
      this.slots=[];this._drain();
    }
    _drain(){
      if(this.disabled){for(const job of this.queue.splice(0))this._fallback(job);return}
      try{
        while(this.queue.length){
          let slot=this.slots.find(value=>!value.job);
          if(!slot){
            if(this.slots.length>=this.size)return;
            slot={worker:this.workerFactory(),job:null};this.slots.push(slot);
            slot.worker.onerror=()=>this._fail();slot.worker.onmessageerror=()=>this._fail();
            slot.worker.onmessage=({data})=>{
              const job=slot.job;
              if(!job||data.id!==job.id){data.bitmap?.close?.();return}
              slot.job=null;
              if(data.error)this._fallback(job);else this._finish(job,null,data.bitmap||data.tile||data.grid);
              this._drain();
            };
          }
          const job=this.queue.shift();if(job.done)continue;slot.job=job;
          const packet={...job.packet,id:job.id},transfer=[];
          if(packet.tiles){packet.tiles=packet.tiles.map(grid=>{if(!grid)return null;const copy=new Float32Array(grid);transfer.push(copy.buffer);return copy})}
          slot.worker.postMessage(packet,transfer);
        }
      }catch{this._fail()}
    }
    clear(){
      for(const slot of this.slots)slot.worker.terminate();this.slots=[];this.queue=[];
      for(const job of this.jobs)this._finish(job,aborted());this.disabled=!this.workerFactory;
    }
  }
  return {Pool};
});
