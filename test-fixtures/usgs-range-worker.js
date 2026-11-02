'use strict';
/* The real USGS reader and real worker threads, with HTTPS redirected to an
   explicitly supplied local fixture provider. Never contacts a live service. */
const https=require('node:https'),http=require('node:http');
const {parentPort,workerData,threadId}=require('node:worker_threads');
let providerPort=0;
https.request=(options,callback)=>{
  if(!providerPort)throw Error('fixture provider missing');
  return http.request({host:'127.0.0.1',port:providerPort,path:options.path,method:options.method,headers:options.headers},callback);
};
const usgs=require('../usgs.js');usgs.init(workerData.cacheDir);
if(workerData.cacheWriteGate)usgs.setCacheWriteGate(workerData.cacheWriteGate);
if(workerData.sharedRanges)usgs.setRangeTransport(require('../terrain-ranges.js').connectRangeClient(parentPort,usgs.readRangeLocal).read);
const controllers=new Map();
parentPort.on('message',async message=>{
  if(message.kind==='terrain-range')return;
  const {id,action,args}=message;
  if(message.cancel){controllers.get(id)?.abort();return;}
  const controller=new AbortController();controllers.set(id,controller);
  try{
    providerPort=args.port||providerPort;
    if(action==='echo'){parentPort.postMessage({id,ok:true,result:threadId});return;}
    const read=async key=>{
      const header=await usgs.openCog(key,args.size,controller.signal);
      const block=await usgs.cogTile(key,header,0,0,0,controller.signal);
      return {threadId,value:block[0],pixels:block.length,valid:block.every(v=>v===123.5)};
    };
    const result=action==='batch'?await Promise.all(args.keys.map(read)):await read(args.key);
    parentPort.postMessage({id,ok:true,result});
  }catch(error){parentPort.postMessage({id,ok:false,error:String(error.message||error)});}
  finally{controllers.delete(id);}
});
