'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),Module=require('node:module');
const {sourceCode,tiff,root}=require('../../test-fixtures/usgs-source.js');
function loadPool(ref){
  const filename=path.join(root,'terrain-pool.js'),mod=new Module(filename,module);
  mod.filename=filename;mod.paths=Module._nodeModulePaths(root);mod._compile(sourceCode('terrain-pool.js',ref),filename);return mod.exports.TerrainPool;
}
async function workload({ref,workers=6,readers=workers,keysPerReader=1,providerSlots=2,latency=50,rangeLimit,shared=true,crashFirstReader=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'csp-cross-worker-')),bytes=tiff(),queue=[],requests=[];
  let active=0,maxActive=0,pool;const timers=new Set();
  function drain(){
    while(queue.length&&active<providerSlots){
      const {req,res}=queue.shift();active++;maxActive=Math.max(active,maxActive);
      const timer=setTimeout(()=>{
        timers.delete(timer);active--;
        const [,a,b]=req.headers.range.match(/bytes=(\d+)-(\d+)/),body=bytes.subarray(+a,+b+1);
        res.writeHead(206,{'Content-Type':'application/octet-stream','Content-Length':body.length});res.end(body);drain();
      },latency);timers.add(timer);
    }
  }
  const server=http.createServer((req,res)=>{requests.push({path:req.url,range:req.headers.range});queue.push({req,res});drain();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const TerrainPool=loadPool(ref);
    pool=new TerrainPool({cacheDir:dir,size:workers,jobsPerWorker:1,shareable:['read','batch'],workerFile:path.join(root,'test-fixtures/usgs-range-worker.js'),rangeLimit});
    await Promise.all(Array.from({length:workers},()=>pool.run('echo',{port:server.address().port})));
    let crashed=false;
    if(crashFirstReader)for(const slot of pool.slots)slot.worker.on('message',()=>{
      if(crashed)return;
      const entry=[...pool.ranges.loads.values()].find(e=>e.waiters.size===workers);
      if(entry){crashed=true;entry.owner.terminate();}
    });
    const start=performance.now();
    const read=i=>pool.run(keysPerReader>1?'batch':'read',{port:server.address().port,key:shared?'same.tif':`file-${i}.tif`,
      keys:Array.from({length:keysPerReader},(_,j)=>`file-${i}-${j}.tif`),size:bytes.length})
      .catch(error=>({error:error.message,code:error.code}));
    const out=(await Promise.all(Array.from({length:readers},(_,i)=>read(i)))).flat();
    const elapsedMs=Math.round(performance.now()-start),coldRequests=requests.length;
    const revisitStart=performance.now(),revisit=(await Promise.all(Array.from({length:readers},(_,i)=>read(i)))).flat();
    const downloadedBytes=requests.reduce((n,r)=>{const [,a,b]=r.range.match(/bytes=(\d+)-(\d+)/);return n+bytes.subarray(+a,+b+1).length;},0);
    const errors=out.filter(v=>v.error),valid=out.filter(v=>!v.error).concat(revisit).every(v=>v.valid&&v.value===123.5&&v.pixels===512*512);
    return {workers,readers,keysPerReader,providerSlots,latencyMs:latency,coldRequests,downloadedBytes,revisitRequests:requests.length-coldRequests,elapsedMs,revisitMs:Math.round(performance.now()-revisitStart),maxActive,
      uniqueWorkers:new Set(out.filter(v=>!v.error).map(v=>v.threadId)).size,valid:valid&&errors.length===(crashFirstReader?1:0),
      failedJobs:errors.length,restarts:pool.stats().restarted,sourceRanges:pool.stats().sourceRanges};
  }finally{
    await pool?.close();for(const timer of timers)clearTimeout(timer);
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
}
module.exports={workload};
