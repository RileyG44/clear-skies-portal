/* Shared, bounded elevation requests. No DOM or provider knowledge lives here. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.CSPTilePipeline=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const aborted=()=>Object.assign(new Error('Tile request cancelled'),{name:'AbortError'});
  class RequestPool {
    /* idleGroups start only while nothing from any other group is queued or
       running: work that improves what is already on screen must not hold a
       slot that a tile still showing nothing is waiting for. */
    constructor({concurrency=6,maxBytes=48*1024*1024,ttl=5*60*1000,groupLimits={},idleGroups=[],backgroundConcurrency=2}={}){
      this.groupLimits=groupLimits;this.groupActive=new Map();this.idleGroups=new Set(idleGroups);
      this.concurrency=concurrency;this.maxBytes=maxBytes;this.ttl=ttl;
      this.cache=new Map();this.jobs=new Map();this.queue=[];this.active=0;this.bytes=0;
      this.backgroundConcurrency=backgroundConcurrency;this.backgroundActive=0;this.foregroundActive=0;this._drainScheduled=false;
    }
    request(key,loader,{signal,priority=0,group="default",background=false}={}){
      if(signal?.aborted) return Promise.reject(aborted());
      const hit=this.cache.get(key);
      if(hit&&Date.now()-hit.at<this.ttl){
        this.cache.delete(key);this.cache.set(key,hit);return Promise.resolve(hit.value);
      }
      if(hit){this.cache.delete(key);this.bytes-=hit.bytes;}
      let job=this.jobs.get(key);
      if(!job){
        job={key,loader,priority,group,background,controller:new AbortController(),waiters:new Set(),started:false};
        this.jobs.set(key,job);this.queue.push(job);
      }
      const promise=new Promise((resolve,reject)=>{
        const waiter={resolve,reject,signal,priority,group,background,onAbort:null};
        waiter.onAbort=()=>{
          job.waiters.delete(waiter);signal?.removeEventListener('abort',waiter.onAbort);reject(aborted());
          if(!job.waiters.size){
            job.controller.abort();
            if(this.jobs.get(key)===job)this.jobs.delete(key);
            this.queue=this.queue.filter(value=>value!==job);
            this._scheduleDrain();
          }else{this._demand(job);this._scheduleDrain();}
        };
        job.waiters.add(waiter);signal?.addEventListener('abort',waiter.onAbort,{once:true});
      });
      this._demand(job);
      this._scheduleDrain();return promise;
    }
    /* A tile still queued can move: after a pan it may be the view's centre. */
    prioritize(key,priority,options={}){
      const job=this.jobs.get(key);if(!job)return;
      for(const waiter of job.waiters){
        if(options.signal!==undefined&&waiter.signal!==options.signal)continue;
        waiter.priority=priority;
        if(options.background!==undefined)waiter.background=options.background;
        if(options.group!==undefined)waiter.group=options.group;
      }
      this._demand(job);this._scheduleDrain();
    }
    /* Each consumer keeps its own intent. A background pan cannot demote a
       different layer's visible tile, and a departed foreground owner must
       not leave background work holding foreground capacity indefinitely. */
    _demand(job){
      let best=null,bestIdle=true;
      for(const waiter of job.waiters){
        const idle=waiter.background||this.idleGroups.has(waiter.group);
        if(!best||bestIdle&&!idle||bestIdle===idle&&waiter.priority>best.priority){best=waiter;bestIdle=idle;}
      }
      if(!best)return;
      if(best.group!==job.group){
        if(job.started){
          this.groupActive.set(job.group,this.groupActive.get(job.group)-1);
          this.groupActive.set(best.group,(this.groupActive.get(best.group)||0)+1);
        }
        job.group=best.group;
      }
      job.priority=best.priority;job.background=best.background;
      if(job.started){
        if(bestIdle!==job.idle){
          this.backgroundActive+=bestIdle?1:-1;this.foregroundActive+=bestIdle?-1:1;job.idle=bestIdle;
        }
      }
    }
    /* Collect a frame's demand before choosing slots. Starting inside request()
       let the first low-priority caller beat every visible tile queued after it. */
    _scheduleDrain(){
      if(this._drainScheduled)return;this._drainScheduled=true;
      queueMicrotask(()=>{this._drainScheduled=false;this._drain();});
    }
    _drain(){
      this.queue.sort((a,b)=>b.priority-a.priority);
      const idle=job=>job.background||this.idleGroups.has(job.group);
      while(this.active<this.concurrency&&this.queue.length){
        const busy=this.foregroundActive>0||this.queue.some(job=>job.waiters.size&&!idle(job));
        const index=this.queue.findIndex(job=>(this.groupActive.get(job.group)||0)<(this.groupLimits[job.group]??this.concurrency)&&
          !(idle(job)&&(busy||this.backgroundActive>=this.backgroundConcurrency)));
        if(index<0)break;
        const [job]=this.queue.splice(index,1);if(!job.waiters.size)continue;
        this.groupActive.set(job.group,(this.groupActive.get(job.group)||0)+1);
        job.started=true;job.idle=idle(job);this.active++;
        if(job.idle)this.backgroundActive++;else this.foregroundActive++;
        Promise.resolve().then(()=>{if(job.controller.signal.aborted)throw aborted();return job.loader(job.controller.signal);}).then(value=>{
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
          this.active--;if(job.idle)this.backgroundActive--;else this.foregroundActive--;
          this.groupActive.set(job.group,this.groupActive.get(job.group)-1);if(this.jobs.get(job.key)===job)this.jobs.delete(job.key);this._scheduleDrain();
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
    /* sharper: the same source at a finer zoom, so it may also replace pixels
       of its own rank - never a better source's. */
    accept(values,rank,sharper=false){
      if(!values||values.length!==this.grid.length||!(rank>0&&rank<256))return false;
      let changed=false;
      for(let i=0;i<values.length;i++){
        const value=values[i];
        if(Number.isFinite(value)&&value>-20000&&(rank>this.ranks[i]||sharper&&rank===this.ranks[i])){
          if(rank!==this.ranks[i]){
            if(!this.ranks[i])this.valid++;else this.counts[this.ranks[i]]--;
            this.counts[rank]++;this.ranks[i]=rank;
          }
          this.grid[i]=value;changed=true;
        }
      }
      return changed;
    }
  }
  return {RequestPool,ProgressiveGrid};
});
