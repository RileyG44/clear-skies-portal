'use strict';
const vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const {sourceCode,tick,root}=require('./usgs-source.js');
const terrainRequire=createRequire(path.join(root,'engine/terrain.js'));
class Clock{
  constructor(){this.now=10000;this.id=0;this.events=new Map();}
  set(fn,ms){const id=++this.id;this.events.set(id,{at:this.now+ms,fn});return id;}
  clear(id){this.events.delete(id);}
  async advance(ms){
    const end=this.now+ms;
    for(let i=0;i<10000;i++){
      await tick();const next=[...this.events].filter(([,e])=>e.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!next){this.now=end;await tick();return;}
      const [id,event]=next;this.events.delete(id);this.now=event.at;event.fn();
    }
    throw Error('warm fixture did not drain');
  }
}
function fixture({ref,slots=1,warmMs=400,foregroundMs=10}={}){
  const clock=new Clock(),cache=new Map(),jobs=[],queue=[];let active=0,maxActive=0;
  const result={png:Buffer.from('fixture'),meta:{coverage:1,groundRes:1,sources:[]}};
  function drain(){
    queue.sort((a,b)=>b.options.priority-a.options.priority);
    while(active<slots&&queue.length){
      const job=queue.shift();job.started=clock.now;active++;maxActive=Math.max(active,maxActive);
      job.timer=clock.set(()=>{active--;job.done=true;job.resolve(result);drain();},job.options.priority<0?warmMs:foregroundMs);
    }
  }
  const pool={stats:()=>({active,queued:queue.length}),run:(action,args,options)=>new Promise((resolve,reject)=>{
    const job={action,args,options,resolve,reject,started:null,done:false,cancelled:false};jobs.push(job);queue.push(job);
    options.signal.addEventListener('abort',()=>{
      if(job.done)return;job.done=true;job.cancelled=true;clock.clear(job.timer);
      const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);else active--;
      reject(Object.assign(Error('cancelled'),{code:'ABORT_ERR'}));drain();
    },{once:true});drain();
  })};
  const cacheApi={TTL_TILE:Infinity,key:x=>x,cacheGet:key=>cache.get(key),
    cachePut:(key,status,type,body,sourceMeta)=>cache.set(key,{status,type,body,sourceMeta})};
  const context={module:{exports:{}},Buffer,AbortController,process,console,
    Date:class extends Date{static now(){return clock.now;}},setTimeout:(fn,ms)=>clock.set(fn,ms),clearTimeout:id=>clock.clear(id),
    require:name=>name==='./tile-cache.js'?cacheApi:terrainRequire(name)};
  vm.runInNewContext(sourceCode('engine/terrain.js',ref),context,{filename:'engine/terrain.js'});
  const terrain=context.module.exports;terrain.init(pool,null);
  async function hit(style='hs',z=16,x=100,y=100){
    const key=`${terrain.TERRAIN_RENDER_VERSION}:${style}:${z}/${x}/${y}`;
    cacheApi.cachePut(key,200,'image/png',result.png,{scope:terrainRequire('../usgs.js').coverageScope()});
    const p=`/api/usgs/tile/${style}/${z}/${x}/${y}.png`;
    const res={req:{headers:{},method:'GET'},writeHead(status,headers){this.status=status;this.headers=headers;return this;},end(body){this.body=body;}};
    await terrain.routes['/api/usgs/tile/']({},res,{p,u:new URL('http://fixture'+p),signal:new AbortController().signal});return res;
  }
  return {terrain,pool,jobs,clock,cache,hit,result,get maxActive(){return maxActive;},
    close:()=>terrain.init({run:()=>Promise.reject(Error('fixture closed')),stats:()=>({active:1,queued:0})},null)};
}
module.exports={fixture};
