'use strict';
/* Production upstream sharing and lane admission. Only HTTPS is controlled. */
const vm=require('node:vm'),zlib=require('node:zlib'),{EventEmitter}=require('node:events');
const {sourceCode}=require('./usgs-source');
const {TerrainPoolError}=require('../terrain-pool');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({ref,limit=1}={}){
  const requests=[];
  const https={Agent:class{},request:(options,callback)=>{
    const request=new EventEmitter();request.options=options;request.callback=callback;request.active=false;
    request.setTimeout=()=>request;request.write=()=>true;
    request.destroy=error=>{request.active=false;queueMicrotask(()=>request.emit('error',error));};
    request.end=()=>{request.active=true;requests.push(request);};return request;
  }};
  const context={module:{exports:{}},Buffer,AbortController,console,process:{env:{CSP_USGS_INFLIGHT:String(limit)}},
    require:name=>name==='https'?https:name==='zlib'?zlib:name==='../terrain-pool.js'?{TerrainPoolError}:
      name==='./tile-cache.js'?{cacheGet:()=>null,cachePut:()=>{}}:(()=>{throw Error('unexpected upstream dependency '+name);})()};
  vm.runInNewContext(sourceCode('engine/upstream.js',ref),context,{filename:'engine/upstream.js'});
  const api=context.module.exports;
  const read=(id,signal)=>api.limitedUpstream(id,{host:api.DEP_HOST,path:'/'+id,method:'GET'},null,signal);
  const complete=(request,status=200)=>{
    if(!request?.active)throw Error('no active upstream fixture request');request.active=false;
    const response=new EventEmitter();response.statusCode=status;response.headers={'content-type':'application/octet-stream'};
    request.callback(response);response.emit('data',Buffer.alloc(64,37));response.emit('end');
  };
  const drain=async()=>{for(let i=0;i<1000;i++){
    await tick();const request=requests.find(r=>r.active);if(!request)return;complete(request);
  }throw Error('upstream fixture did not drain');};
  return {api,read,requests,complete,drain,tick};
}
module.exports={fixture};
