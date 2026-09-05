/* Shared, bounded elevation requests. No DOM or provider knowledge lives here. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.CSPTilePipeline=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const aborted=()=>Object.assign(new Error('Tile request cancelled'),{name:'AbortError'});
  class RequestPool {
    constructor({concurrency=6,maxBytes=48*1024*1024,ttl=5*60*1000,groupLimits={}}={}){
      this.groupLimits=groupLimits;this.groupActive=new Map();
      this.concurrency=concurrency;this.maxBytes=maxBytes;this.ttl=ttl;
      this.cache=new Map();this.jobs=new Map();this.queue=[];this.active=0;this.bytes=0;
    }
    request(key,loader,{signal,priority=0,group="default"}={}){
      if(signal?.aborted) return Promise.reject(aborted());
      const hit=this.cache.get(key);
      if(hit&&Date.now()-hit.at<this.ttl){
        this.cache.delete(key);this.cache.set(key,hit);return Promise.resolve(hit.value);
      }
      if(hit){this.cache.delete(key);this.bytes-=hit.bytes;}
      let job=this.jobs.get(key);
      if(!job){
        job={key,loader,priority,group,controller:new AbortController(),waiters:new Set(),started:false};
        this.jobs.set(key,job);this.queue.push(job);
      }else job.priority=Math.max(job.priority,priority);
      const promise=new Promise((resolve,reject)=>{
        const waiter={resolve,reject,signal,onAbort:null};
        waiter.onAbort=()=>{
          job.waiters.delete(waiter);signal?.removeEventListener('abort',waiter.onAbort);reject(aborted());
          if(!job.waiters.size){
            job.controller.abort();
            if(this.jobs.get(key)===job)this.jobs.delete(key);
            this.queue=this.queue.filter(value=>value!==job);
          }
        };
        job.waiters.add(waiter);signal?.addEventListener('abort',waiter.onAbort,{once:true});
      });
      this._drain();return promise;
    }
    _drain(){
      this.queue.sort((a,b)=>b.priority-a.priority);
      while(this.active<this.concurrency&&this.queue.length){
        const index=this.queue.findIndex(job=>(this.groupActive.get(job.group)||0)<(this.groupLimits[job.group]??this.concurrency));
        if(index<0)break;
        const [job]=this.queue.splice(index,1);if(!job.waiters.size)continue;
        this.groupActive.set(job.group,(this.groupActive.get(job.group)||0)+1);
        job.started=true;this.active++;
        Promise.resolve().then(()=>job.loader(job.controller.signal)).then(value=>{
          if(!job.controller.signal.aborted&&value){
            const bytes=value.grid?.byteLength??value.byteLength??0;
            if(bytes>0&&bytes<=this.maxBytes){
              const old=this.cache.get(job.key);if(old)this.bytes-=old.bytes;
              this.cache.delete(job.key);this.cache.set(job.key,{value,bytes,at:Date.now()});this.bytes+=bytes;
              while(this.bytes>this.maxBytes){const key=this.cache.keys().next().value;this.bytes-=this.cache.get(key).bytes;this.cache.delete(key);}
            }
          }
          this._settle(job,null,value);
        },error=>this._settle(job,error)).finally(()=>{
          this.active--;this.groupActive.set(job.group,this.groupActive.get(job.group)-1);if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);this._drain();
        });
      }
    }
    _settle(job,error,value){
      if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);
      for(const waiter of job.waiters){
        waiter.signal?.removeEventListener('abort',waiter.onAbort);
        if(error)waiter.reject(error);else waiter.resolve(value);
      }
      job.waiters.clear();
    }
  }
  /* Resolution can only improve at each pixel, regardless of response order.
     Missing detail never overwrites valid overview pixels. */
  class ProgressiveGrid {
    constructor(length){this.grid=new Float32Array(length);this.grid.fill(NaN);this.ranks=new Uint8Array(length);this.counts=new Uint32Array(256);this.valid=0;}
    accept(values,rank){
      if(!values||values.length!==this.grid.length||!(rank>0&&rank<256))return false;
      let changed=false;
      for(let i=0;i<values.length;i++){
        const value=values[i];
        if(Number.isFinite(value)&&value>-20000&&rank>this.ranks[i]){
          if(!this.ranks[i])this.valid++;else this.counts[this.ranks[i]]--;
          this.counts[rank]++;this.ranks[i]=rank;this.grid[i]=value;changed=true;
        }
      }
      return changed;
    }
  }
  return {RequestPool,ProgressiveGrid};
});
