/* Share cold COG byte ranges across terrain workers. The coordinator holds
   only ownership and queue state; HTTPS, disk I/O and TIFF decoding stay on
   workers. Replies share immutable bytes rather than cloning them per viewer. */
'use strict';
const KIND='terrain-range',MAX_BYTES=32*1024*1024;
const failure=(message,code)=>Object.assign(new Error(message),{code});

class TerrainRangeBroker{
  constructor({limit=4,perWorkerLimit=4,maxQueue=1024}={}){
    this.limit=Math.max(1,Math.min(96,Math.floor(limit)||4));
    this.perWorkerLimit=Math.max(1,Math.min(12,Math.floor(perWorkerLimit)||4));
    this.maxQueue=Math.max(1,Math.floor(maxQueue)||1024);
    // A waiter belongs to a render worker; a load is borrowed by one worker
    // independently of that worker's render. Losing the borrower reassigns
    // surviving waiters, while losing one viewer never cancels its neighbours.
    this.workers=new Map();this.pending=new Map();this.loads=new Map();this.queue=[];this.nextId=1;this.closed=false;
    this.lastReader=null;this.failureCodes=Object.create(null);this.lastFailure=null;
    this.metrics={requests:0,shared:0,networkReads:0,diskHits:0,bytes:0,failed:0,rejected:0,cancelled:0,dropped:0,workerRetries:0,
      queueMs:0,queueSamples:0,maxQueueMs:0,networkMs:0};
  }
  attach(worker,index,available=()=>true){this.workers.set(worker,{index,available,reads:0,requests:new Map()});this.drain();}
  _post(worker,message){worker.postMessage({kind:KIND,...message});}
  handle(worker,message){
    if(message.kind!==KIND)return false;
    if(!this.workers.has(worker)||this.closed)return true;
    if(message.op==='read')this._read(worker,message);
    else if(message.op==='disconnect')this.detach(worker);
    else if(message.op==='cancel')this._remove(this.workers.get(worker).requests.get(message.id));
    else if(message.op==='started'){
      const entry=this.loads.get(message.id);
      if(entry?.owner===worker){
        entry.started=Date.now();const wait=entry.started-entry.enqueued;
        this.metrics.queueMs+=wait;this.metrics.queueSamples++;this.metrics.maxQueueMs=Math.max(this.metrics.maxQueueMs,wait);
      }
    }else if(message.op==='result')this._result(worker,message);
    return true;
  }
  _read(worker,{id,key,a,b}){
    if(!Number.isSafeInteger(id)||typeof key!=='string'||!key.length||key.length>2048||
       !Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<a||b-a+1>MAX_BYTES){
      this._post(worker,{op:'reply',id,error:'Invalid terrain range',code:'RANGE_INVALID'});return;
    }
    const state=this.workers.get(worker);
    if(state.requests.has(id))return;
    this.metrics.requests++;
    const cacheKey=key+':'+a+'-'+b;let entry=this.pending.get(cacheKey);
    if(entry)this.metrics.shared++;
    else{
      if(this.queue.length>=this.maxQueue){this.metrics.rejected++;this._post(worker,{op:'reply',id,error:'Terrain source queue is full',code:'QUEUE_FULL'});return;}
      entry={cacheKey,key,a,b,waiters:new Set(),enqueued:Date.now(),owner:null,id:0,started:0,cancelRequested:false};
      this.pending.set(cacheKey,entry);this.queue.push(entry);
    }
    const waiter={worker,id,entry};entry.waiters.add(waiter);state.requests.set(id,waiter);this.drain();
  }
  _forget(waiter){waiter.entry.waiters.delete(waiter);this.workers.get(waiter.worker)?.requests.delete(waiter.id);}
  _remove(waiter){
    if(!waiter)return;
    this.metrics.cancelled++;this._forget(waiter);const entry=waiter.entry;
    if(entry.waiters.size)return;
    if(!entry.owner){
      const i=this.queue.indexOf(entry);if(i>=0)this.queue.splice(i,1);
      if(this.pending.get(entry.cacheKey)===entry)this.pending.delete(entry.cacheKey);
      this.metrics.dropped++;
    }else if(!entry.cancelRequested){
      // A queued local S3 read stops. An on-wire read finishes into the cache.
      // Keep the entry until that acknowledgement so a fast revisit either
      // shares its bytes or retries after its cancelled slot has been freed.
      entry.cancelRequested=true;this._post(entry.owner,{op:'stop',id:entry.id});
    }
  }
  drain(){
    if(this.closed)return;
    while(this.queue.length&&this.loads.size<this.limit){
      // Borrow the least-loaded source worker. Always using the first viewer
      // can fill the global budget with reads queued behind that one worker's
      // local S3 gate while every other worker still has free network slots.
      const workers=[...this.workers.keys()],counts=new Map(workers.map(worker=>[worker,0])),readers=new Map(counts);
      const next=(workers.indexOf(this.lastReader)+1)%workers.length;
      const turn=new Map(workers.slice(next).concat(workers.slice(0,next)).map((worker,i)=>[worker,i]));
      for(const load of this.loads.values()){
        counts.set(load.owner,(counts.get(load.owner)||0)+1);
        for(const reader of new Set([...load.waiters].map(waiter=>waiter.worker)))readers.set(reader,(readers.get(reader)||0)+1);
      }
      // A broad raster window must not put every block ahead of a different
      // render's small read. Balance active reads by consumer, rotating ties;
      // FIFO remains the rule within one reader. Borrowing stays independent.
      let entry,owner,reader;
      for(const candidateReader of workers.sort((a,b)=>readers.get(a)-readers.get(b)||turn.get(a)-turn.get(b))){
        // Find this reader's first eligible pending range, rather than scoring
        // every block in a large window each time a source slot opens.
        for(const waiter of this.workers.get(candidateReader).requests.values()){
          const candidate=waiter.entry;if(candidate.owner)continue;
          const viewer=candidate.waiters.values().next().value?.worker;
          const viewers=new Set([...candidate.waiters].map(waiter=>waiter.worker));
          let borrower;
          for(const [worker,state] of this.workers){
            // A CPU worker may read for itself, but cannot borrow more I/O
            // from another render while it is busy.
            if(counts.get(worker)>=this.perWorkerLimit||!viewers.has(worker)&&!state.available())continue;
            if(!borrower||counts.get(worker)<counts.get(borrower)||counts.get(worker)===counts.get(borrower)&&worker===viewer)borrower=worker;
          }
          if(borrower){entry=candidate;owner=borrower;reader=candidateReader;break;}
        }
        if(entry)break;
      }
      if(!entry)return;
      this.lastReader=reader;
      this.queue.splice(this.queue.indexOf(entry),1);
      entry.owner=owner;entry.id=this.nextId++;entry.started=0;entry.cancelRequested=false;
      this.loads.set(entry.id,entry);
      this._post(entry.owner,{op:'load',id:entry.id,key:entry.key,a:entry.a,b:entry.b});
    }
  }
  _result(worker,message){
    const entry=this.loads.get(message.id);if(!entry||entry.owner!==worker)return;
    this.loads.delete(entry.id);
    if(message.error&&message.code==='ABORT_ERR'&&entry.waiters.size){
      entry.owner=null;entry.enqueued=Date.now();this.queue.unshift(entry);this.drain();return;
    }
    if(this.pending.get(entry.cacheKey)===entry)this.pending.delete(entry.cacheKey);
    if(message.error){
      if(message.code!=='ABORT_ERR'){
        this.metrics.failed++;
        const code=String(message.code||'SOURCE_ERROR').slice(0,64);
        const bucket=Object.hasOwn(this.failureCodes,code)||Object.keys(this.failureCodes).length<15?code:'OTHER';
        this.failureCodes[bucket]=(this.failureCodes[bucket]||0)+1;
        const now=Date.now();this.lastFailure={at:now,code,message:String(message.error).slice(0,160),
          phase:entry.started?'read':'before-read',queueMs:(entry.started||now)-entry.enqueued,readMs:entry.started?now-entry.started:0};
      }
    }
    else if(message.cached)this.metrics.diskHits++;
    else{
      this.metrics.networkReads++;this.metrics.bytes+=message.bytes?.byteLength||0;
      this.metrics.networkMs+=entry.started?Date.now()-entry.started:0;
      this.workers.get(worker).reads++;
    }
    for(const waiter of [...entry.waiters]){
      this._forget(waiter);
      this._post(waiter.worker,{op:'reply',id:waiter.id,bytes:message.bytes,cached:message.cached,error:message.error,code:message.code});
    }
    this.drain();
  }
  detach(worker){
    const state=this.workers.get(worker);if(!state)return;
    for(const waiter of [...state.requests.values()])this._remove(waiter);
    this.workers.delete(worker);
    for(const entry of [...this.loads.values()])if(entry.owner===worker){
      this.loads.delete(entry.id);entry.owner=null;
      if(entry.waiters.size){this.metrics.workerRetries++;entry.enqueued=Date.now();this.queue.unshift(entry);}
      else if(this.pending.get(entry.cacheKey)===entry)this.pending.delete(entry.cacheKey);
    }
    this.drain();
  }
  stats(){
    const now=Date.now(),waiting=[...this.queue,...[...this.loads.values()].filter(e=>!e.started)],m=this.metrics;
    return {limit:this.limit,perWorkerLimit:this.perWorkerLimit,active:this.loads.size,onWire:[...this.loads.values()].filter(e=>e.started).length,queued:waiting.length,
      oldestQueuedMs:waiting.reduce((n,e)=>Math.max(n,now-e.enqueued),0),
      avgQueueMs:m.queueSamples?Math.round(m.queueMs/m.queueSamples):0,maxQueueMs:m.maxQueueMs,
      avgReadMs:m.networkReads?Math.round(m.networkMs/m.networkReads):0,
      requests:m.requests,shared:m.shared,networkReads:m.networkReads,diskHits:m.diskHits,bytes:m.bytes,failed:m.failed,rejected:m.rejected,
      failureCodes:{...this.failureCodes},lastFailure:this.lastFailure?{...this.lastFailure}:null,
      cancelled:m.cancelled,dropped:m.dropped,workerRetries:m.workerRetries,
      workers:[...this.workers].map(([worker,s])=>({index:s.index,consumers:s.requests.size,reads:s.reads,
        active:[...this.loads.values()].filter(e=>e.owner===worker&&e.started).length}))};
  }
  close(){this.closed=true;this.pending.clear();this.loads.clear();this.queue.length=0;this.workers.clear();}
}

function connectRangeClient(port,readLocal){
  let nextId=1,closed=false;const pending=new Map(),loads=new Map();
  const post=message=>port.postMessage({kind:KIND,...message});
  const onMessage=async message=>{
    if(message.kind!==KIND||closed)return;
    if(message.op==='reply'){
      const entry=pending.get(message.id);if(!entry)return;
      pending.delete(message.id);entry.cleanup();
      if(message.error)entry.reject(failure(message.error,message.code));
      else entry.resolve({buf:Buffer.from(message.bytes),cached:!!message.cached});
    }else if(message.op==='stop')loads.get(message.id)?.abort();
    else if(message.op==='load'){
      const controller=new AbortController();loads.set(message.id,controller);
      try{
        const result=await readLocal(message.key,message.a,message.b,controller.signal,()=>post({op:'started',id:message.id}));
        const bytes=new SharedArrayBuffer(result.buf.length);Buffer.from(bytes).set(result.buf);
        post({op:'result',id:message.id,bytes,cached:!!result.cached});
      }catch(error){post({op:'result',id:message.id,error:String(error.message||error),code:controller.signal.aborted?'ABORT_ERR':error.code});}
      finally{loads.delete(message.id);}
    }
  };
  const close=()=>{
    if(closed)return;closed=true;post({op:'disconnect'});port.off('message',onMessage);port.off('close',close);
    for(const [id,entry] of pending){post({op:'cancel',id});entry.cleanup();entry.reject(failure('Terrain range channel closed','RANGE_CLOSED'));}
    pending.clear();for(const c of loads.values())c.abort();loads.clear();
  };
  port.on('message',onMessage);port.on('close',close);
  const read=(key,a,b,signal)=>{
    if(closed)return Promise.reject(failure('Terrain range channel closed','RANGE_CLOSED'));
    if(signal?.aborted)return Promise.reject(signal.reason);
    const id=nextId++;
    return new Promise((resolve,reject)=>{
      const abort=()=>{
        if(!pending.delete(id))return;
        signal.removeEventListener('abort',abort);post({op:'cancel',id});reject(signal.reason);
      };
      pending.set(id,{resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)});
      signal?.addEventListener('abort',abort,{once:true});
      try{post({op:'read',id,key,a,b});}
      catch(error){pending.delete(id);signal?.removeEventListener('abort',abort);reject(error);}
    });
  };
  return {read,close};
}
module.exports={TerrainRangeBroker,connectRangeClient};
