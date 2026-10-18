/* Cached Float32 elevation skirts for the 3D renderer. Loading and skirt
   copying stay on the CPU; shading belongs to the GPU module. */
(function(root,factory){
  if(typeof module==="object"&&module.exports)module.exports=factory(require("./terrain-drape-core.js"));
  else root.CSPGpuTerrain3DCache=factory(root.CSPTerrainDrape);
})(typeof globalThis!=="undefined"?globalThis:this,function(drape){
  "use strict";
  const SIZE=256;
  const CELLS=SIZE*SIZE;
  const DEFAULT_MAX_BYTES=64*1024*1024;

  function abortError(){
    if(typeof DOMException==="function"){
      try{ return new DOMException("aborted","AbortError"); }catch(_){/* fall through */}
    }
    const error=new Error("aborted");
    error.name="AbortError";
    return error;
  }

  function normalize(z,x,y){
    if(!Number.isInteger(z)||z<0||z>22)throw new RangeError("z must be an integer between 0 and 22");
    const n=2**z;
    if(!Number.isInteger(x))throw new RangeError("x must be an integer");
    if(!Number.isInteger(y)||y<0||y>=n)throw new RangeError("y must be an integer between 0 and "+(n-1));
    return {z,n,x:((x%n)+n)%n,y};
  }

  function create(options){
    const opts=options||{};
    const loadGrid=opts.loadGrid;
    if(typeof loadGrid!=="function")throw new TypeError("loadGrid must be a function");
    const maxBytes=opts.maxBytes===undefined?DEFAULT_MAX_BYTES:opts.maxBytes;
    if(typeof maxBytes!=="number"||!Number.isFinite(maxBytes)||maxBytes<0){
      throw new RangeError("maxBytes must be a non-negative finite number");
    }
    const onEvict=typeof opts.onEvict==="function"?opts.onEvict:null;

    const completed=new Map();
    const pending=new Map();
    let bytes=0;
    let hits=0;
    let misses=0;
    let evictions=0;
    let generation=0;
    let revision=0;
    let destroyed=false;

    function notifyEvict(record){
      evictions++;
      if(onEvict){
        try{ onEvict(record); }catch(_){/* eviction cleanup must always finish */}
      }
    }

    function evictOldest(){
      const key=completed.keys().next().value;
      if(key===undefined)return;
      const record=completed.get(key);
      completed.delete(key);
      bytes-=record.grid.byteLength;
      notifyEvict(record);
    }

    function detach(waiter){
      if(waiter.signal)waiter.signal.removeEventListener("abort",waiter.onAbort);
    }

    function rejectWaiters(waiters,error){
      for(const waiter of waiters){
        detach(waiter);
        waiter.reject(error);
      }
    }

    function createJob(coord,key){
      return {
        key,z:coord.z,x:coord.x,y:coord.y,
        controller:new AbortController(),
        waiters:new Set(),
        started:false,
        settled:false,
        generation,
        promise:null
      };
    }

    function runJob(job){
      const signal=job.controller.signal;
      if(signal.aborted)return Promise.reject(abortError());
      const n=2**job.z;
      const load=(kind,z,x,y)=>Promise.resolve().then(()=>{
        if(signal.aborted)throw abortError();
        return loadGrid(z,x,y,signal);
      }).then(value=>{
        if(signal.aborted)throw abortError();
        if(value===null||value===undefined){
          if(kind==="centre")throw new Error("elevation tile unavailable");
          return null;
        }
        if(!(value instanceof Float32Array)||value.length!==CELLS){
          if(kind==="centre")throw new Error("elevation tile unavailable");
          return null;
        }
        return value;
      },error=>{
        if(signal.aborted)throw abortError();
        if(kind==="centre")throw error;
        return null;
      });
      return Promise.all([
        load("centre",job.z,job.x,job.y),
        load("west",job.z,((job.x-1)%n+n)%n,job.y),
        load("east",job.z,((job.x+1)%n+n)%n,job.y),
        job.y>0?load("north",job.z,job.x,job.y-1):null,
        job.y<n-1?load("south",job.z,job.x,job.y+1):null
      ]).then(tiles=>{
        if(signal.aborted)throw abortError();
        return drape.skirt(tiles,SIZE);
      });
    }

    function settleJob(job,error,grid){
      if(job.settled)return;
      job.settled=true;
      const live=pending.get(job.key)===job;
      if(live)pending.delete(job.key);
      const waiters=job.waiters;
      job.waiters=new Set();
      if(error){
        if(!job.controller.signal.aborted)job.controller.abort();
        rejectWaiters(waiters,error);
        return;
      }
      if(job.controller.signal.aborted||job.generation!==generation||destroyed){
        rejectWaiters(waiters,abortError());
        return;
      }
      const record=Object.freeze({
        key:job.key,z:job.z,x:job.x,y:job.y,size:SIZE,grid,
        revision:++revision
      });
      if(live&&grid.byteLength<=maxBytes){
        completed.set(job.key,record);
        bytes+=grid.byteLength;
        while(bytes>maxBytes)evictOldest();
      }
      for(const waiter of waiters){
        detach(waiter);
        waiter.resolve(record);
      }
    }

    function startJob(job){
      if(job.started||job.settled||job.controller.signal.aborted)return;
      if(destroyed||pending.get(job.key)!==job)return;
      job.started=true;
      job.promise=Promise.resolve().then(()=>runJob(job)).then(
        grid=>settleJob(job,null,grid),
        error=>settleJob(job,error)
      );
      job.promise.catch(()=>{/* settle handled it; never let this go unhandled */});
    }

    function prepare(z,x,y,requestOptions){
      if(destroyed)return Promise.reject(new Error("cache destroyed"));
      let coord;
      try{ coord=normalize(z,x,y); }catch(error){ return Promise.reject(error); }
      const signal=requestOptions&&requestOptions.signal;
      if(signal&&signal.aborted)return Promise.reject(abortError());
      const key=coord.z+"/"+coord.x+"/"+coord.y;

      const cached=completed.get(key);
      if(cached){
        completed.delete(key);
        completed.set(key,cached);
        hits++;
        return Promise.resolve(cached);
      }

      let job=pending.get(key);
      if(job){
        hits++;
      }else{
        job=createJob(coord,key);
        pending.set(key,job);
        misses++;
      }

      return new Promise((resolve,reject)=>{
        const waiter={resolve,reject,signal,onAbort:null};
        waiter.onAbort=()=>{
          if(job.settled||!job.waiters.has(waiter))return;
          job.waiters.delete(waiter);
          if(signal)signal.removeEventListener("abort",waiter.onAbort);
          reject(abortError());
          if(!job.waiters.size){
            job.settled=true;
            if(pending.get(job.key)===job)pending.delete(job.key);
            if(!job.controller.signal.aborted)job.controller.abort();
          }
        };
        job.waiters.add(waiter);
        if(signal)signal.addEventListener("abort",waiter.onAbort,{once:true});
        if(!job.started)queueMicrotask(()=>startJob(job));
      });
    }

    function peek(z,x,y){
      if(destroyed)return undefined;
      const coord=normalize(z,x,y);
      const key=coord.z+"/"+coord.x+"/"+coord.y;
      const record=completed.get(key);
      if(!record)return undefined;
      completed.delete(key);
      completed.set(key,record);
      return record;
    }

    function clear(){
      generation++;
      const jobs=Array.from(pending.values());
      pending.clear();
      for(const job of jobs){
        job.settled=true;
        if(!job.controller.signal.aborted)job.controller.abort();
        const waiters=job.waiters;
        job.waiters=new Set();
        rejectWaiters(waiters,abortError());
      }
      const records=Array.from(completed.values());
      completed.clear();
      bytes=0;
      for(const record of records)notifyEvict(record);
    }

    function destroy(){
      if(destroyed)return;
      destroyed=true;
      clear();
    }

    function stats(){
      return {
        entries:completed.size,
        bytes,
        pending:pending.size,
        hits,
        misses,
        evictions,
        generation,
        destroyed
      };
    }

    return {prepare,peek,clear,destroy,stats};
  }

  return {create};
});
