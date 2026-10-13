/* WA DNR discovery and bounded background acquisition. Metadata errors remain
   errors; catalogue bounding boxes are candidates, never pixel provenance. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),https=require("node:https");
const zlib=require("node:zlib");
const {Worker}=require("node:worker_threads");
const HOST="lidarportal.dnr.wa.gov",TTL=7*86400000;
const intersects=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
const contains=(a,b)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
function tileBounds(z,x,y){
  const n=2**z,lat=y=>Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;
  return [x/n*360-180,lat(y+1),(x+1)/n*360-180,lat(y)];
}
function polygon(b){const [w,s,e,n]=b;return {type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]};}
function atomic(file,value){
  const tmp=file+"."+process.pid+".tmp";
  try{fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);}
  finally{try{fs.unlinkSync(tmp);}catch{}}
}
function jsonRequest(pathname,body){
  return new Promise((resolve,reject)=>{
    const req=https.request({host:HOST,path:pathname,method:body?"POST":"GET",
      headers:{"User-Agent":"ClearSkiesPortal/1.0",...(body?{"Content-Type":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(body)}:{})}},res=>{
      const chunks=[];let bytes=0;
      const encoding=res.headers["content-encoding"];
      const stream=encoding==="gzip"?res.pipe(zlib.createGunzip()):encoding==="br"?res.pipe(zlib.createBrotliDecompress()):res;
      stream.on("data",c=>{bytes+=c.length;if(bytes>8*1024*1024)stream.destroy(new Error("DNR metadata response is too large"));else chunks.push(c);});
      res.on("error",reject);
      stream.on("error",reject);
      stream.on("end",()=>{
        if(res.statusCode!==200)return reject(new Error(`DNR metadata HTTP ${res.statusCode}`));
        try{resolve(JSON.parse(Buffer.concat(chunks)));}catch{reject(new Error("DNR returned invalid metadata"));}
      });
    });
    req.setTimeout(30000,()=>req.destroy(new Error("DNR metadata request timed out")));req.on("error",reject);req.end(body);
  });
}
class DnrStore {
  constructor(cacheDir,{request=jsonRequest,workerFactory=options=>new Worker(path.join(__dirname,"wadnr-ingest-worker.js"),options)}={}){
    this.cacheDir=cacheDir;this.dir=path.join(cacheDir,"wadnr");fs.mkdirSync(this.dir,{recursive:true});
    this.request=request;this.workerFactory=workerFactory;this.catalogue=null;this.cataloguePending=null;this.retryAt=0;
    this.queue=new Map();this.active=null;this.worker=null;this.errors=new Map();this.closed=false;
    this.warm={running:false,total:0,done:0,bytes:0,error:null};
    this.maxBytes=Math.max(1,Math.min(16,Number(process.env.CSP_DNR_CACHE_GB)||4))*1073741824;
    this.maxArchiveBytes=Math.min(this.maxBytes,Math.max(.1,Math.min(4,Number(process.env.CSP_DNR_ARCHIVE_GB)||2))*1073741824);
    this.minFreeBytes=Math.max(0,Number(process.env.CSP_CACHE_MIN_FREE_GB)||8)*1073741824;
    try{this.index=JSON.parse(fs.readFileSync(path.join(this.dir,"index.json"),"utf8"));}
    catch{this.index={version:1,revision:0,files:[],regions:[]};}
    // Only completed, atomically installed rasters enter the persisted index.
    this.index.files=this.index.files.filter(f=>fs.existsSync(path.join(this.dir,f.file))&&
      (f.levels||[]).every(l=>fs.existsSync(path.join(this.dir,f.overviewDir,l.path))));
  }
  async catalog(){
    if(this.catalogue&&Date.now()-this.catalogue.at<TTL)return this.catalogue;
    if(this.cataloguePending)return this.cataloguePending;
    const file=path.join(this.dir,"catalog.json");
    let previous=null;
    try{previous=JSON.parse(fs.readFileSync(file,"utf8"));if(Date.now()-previous.at<TTL){this.catalogue=previous;return previous;}}catch{}
    if(Date.now()<this.retryAt){
      if(previous)return {...previous,stale:true};
      throw new Error("DNR catalogue lookup is temporarily unavailable");
    }
    this.cataloguePending=(async()=>{
      try{
        const [projects,layers]=await Promise.all([this.request("/project"),this.request("/arcgis/rest/services/lidar/wadnr_hillshade/MapServer/layers?f=json")]);
        if(!Array.isArray(projects)||!Array.isArray(layers.layers)||layers.error)throw new Error("Invalid DNR catalogue");
        const ids=new Map(layers.layers.filter(l=>l.type==="Raster Layer").map(l=>[l.name,l.id]));
        const rows=projects.map(p=>{
          const dtm=p.datasets?.find(d=>d.name==="DTM"),shade=p.datasets?.find(d=>d.name==="DTM Hillshade"),dsm=p.datasets?.find(d=>d.name==="DSM Hillshade");
          const extent=dtm||shade||dsm;if(!extent)return null;
          const bounds=[extent.XMin,extent.YMin,extent.XMax,extent.YMax];
          if(!bounds.every(Number.isFinite))return null;
          return {name:p.name,year:+(/(\d{4})\s*$/.exec(p.name)||[])[1]||0,bounds,
            dtm:ids.get(shade?.layers)??null,dsm:ids.get(dsm?.layers)??null,dtmDataset:dtm?.ID??null};
        }).filter(Boolean).sort((a,b)=>b.year-a.year||a.name.localeCompare(b.name));
        const next={at:Date.now(),projects:rows};atomic(file,next);this.catalogue=next;this.retryAt=0;return next;
      }catch(error){this.retryAt=Date.now()+30000;if(previous)return {...previous,stale:true};throw error;}
      finally{this.cataloguePending=null;}
    })();
    return this.cataloguePending;
  }
  async coverage(bbox){
    const catalogue=await this.catalog();
    return {state:catalogue.stale?"stale":"ready",basis:"catalogue candidates",checked:catalogue.at,
      projects:catalogue.projects.filter(p=>intersects(p.bounds,bbox)),
      elevation:this.status()};
  }
  status(){
    return {revision:this.index.revision,files:this.index.files.length,
      bytes:this.index.files.reduce((sum,f)=>sum+(f.bytes||0),0),maxBytes:this.maxBytes,
      active:this.active?{project:this.active.project,state:this.active.state,bytes:this.active.bytes||0,fraction:this.active.fraction||0}:null,
      queued:this.queue.size};
  }
  startWarm(bbox){
    if(this.warm.running)throw new Error("A DNR view download is already running");
    const z=16,n=2**z;
    const tx=lon=>Math.floor((lon+180)/360*n);
    const ty=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
    const west=tx(bbox[0]),east=tx(bbox[2]),north=ty(bbox[3]),south=ty(bbox[1]);
    const total=(east-west+1)*(south-north+1);
    if(total>4096)throw new Error("A WA DNR fetch is limited to 4096 acquisition cells; split a larger area into multiple fetches");
    const state=this.warm={id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,running:true,total,done:0,bytes:0,error:null,stop:false};
    const before=this.status().bytes;
    (async()=>{
      for(let y=north;y<=south;y++)for(let x=west;x<=east;x++){
        while(!this.closed&&!state.stop){
          const result=await this.ensureTile(z,x,y);
          if(result.state==="error")throw new Error(result.error||"DNR download failed");
          if(result.state!=="pending"){state.done++;break;}
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
        state.bytes=Math.max(0,this.status().bytes-before);
        if(this.closed||state.stop)return;
      }
    })().catch(error=>{state.error=String(error.message||error);})
      .finally(()=>{state.running=false;});
    return {...state};
  }
  stopWarm(expectedId){
    if(expectedId!=null&&expectedId!==this.warm.id)return {...this.warm,cancelled:false};
    this.warm.stop=true;return {...this.warm,cancelled:true};
  }
  async ensureTile(z,x,y){
    const bbox=tileBounds(z,x,y),catalogue=await this.catalog();
    const projects=catalogue.projects.filter(p=>p.dtmDataset!=null&&intersects(p.bounds,bbox));
    if(!projects.length)return {state:"empty",revision:this.index.revision};
    // Nearby cached native rasters can serve any zoom. Acquire only at useful
    // map scales, and one z16 area at a time rather than one ZIP per retina tile.
    if(z<13)return {state:"overview",revision:this.index.revision};
    const az=Math.min(z,16),scale=2**(z-az),ax=Math.floor(x/scale),ay=Math.floor(y/scale),area=tileBounds(az,ax,ay);
    const selected=projects.slice(0,2);
    let pending=false,reason=null;
    for(const project of selected){
      if(this.index.regions.some(r=>r.datasetId===project.dtmDataset&&contains(r.bbox,bbox)))continue;
      // A whole downloaded TIFF often covers many acquisition cells.
      if(this.index.files.some(f=>f.datasetId===project.dtmDataset&&contains(f.bounds,bbox)))continue;
      const id=`${project.dtmDataset}:${az}/${ax}/${ay}`,error=this.errors.get(id);
      if(error&&Date.now()-error.at<120000){reason=error.message;continue;}
      if(this.active?.id===id){this.active.touched=Date.now();pending=true;continue;}
      const old=this.queue.get(id);
      if(old){old.touched=Date.now();pending=true;continue;}
      if(this.queue.size>=4){
        // Keep a bounded set of the areas most recently requested by the map.
        const oldest=[...this.queue.values()].sort((a,b)=>a.touched-b.touched)[0];
        this.queue.delete(oldest.id);
      }
      this.queue.set(id,{id,bbox:area,datasetId:project.dtmDataset,project:project.name,year:project.year,touched:Date.now(),state:"queued"});
      pending=true;
    }
    this.drain();
    return {state:pending?"pending":reason?"error":"ready",error:reason,revision:this.index.revision};
  }
  drain(){
    if(this.closed||this.active||!this.queue.size)return;
    const job=[...this.queue.values()].sort((a,b)=>b.touched-a.touched)[0];this.queue.delete(job.id);
    const bytes=this.status().bytes,remaining=this.maxBytes-bytes;
    const stat=fs.statfsSync(this.cacheDir),free=Number(stat.bavail)*Number(stat.bsize);
    if(remaining<64*1024*1024||free<this.minFreeBytes+64*1024*1024){
      this.errors.set(job.id,{at:Date.now(),message:"DNR acquisition paused at its storage budget"});
      this.queue.clear();return;
    }
    this.active=job;job.state="checking";
    (async()=>{
      const body="geojson="+encodeURIComponent(JSON.stringify(polygon(job.bbox)));
      const rows=await this.request("/query",body);
      if(this.closed)return;
      if(!Array.isArray(rows))throw new Error("Invalid DNR download coverage response");
      const dataset=rows.find(r=>r.dataset_id===job.datasetId&&r.dataset_name==="DTM");
      if(!dataset){this.index.regions.push({datasetId:job.datasetId,bbox:job.bbox});this.save();return;}
      // Temporary ZIP plus extracted raster both occupy disk during ingestion.
      const limit=Math.min(this.maxArchiveBytes,remaining,(free-this.minFreeBytes-64*1024*1024)/2.1);
      if(dataset.bytes>limit||dataset.files>32)throw new Error("DNR area exceeds the download budget; zoom in to a smaller area");
      job.state="downloading";
      const result=await this.acquire({...job,cacheDir:this.cacheDir,maxBytes:limit,minFreeBytes:this.minFreeBytes,
        known:this.index.files.filter(f=>f.datasetId===job.datasetId)});
      const files=new Map(this.index.files.map(f=>[f.key,f]));
      for(const f of result.files)files.set(f.key,{...f,year:job.year});
      this.index.files=[...files.values()];this.index.regions.push({datasetId:job.datasetId,bbox:job.bbox});
      this.index.revision++;this.save();
    })().catch(error=>{
      this.errors.set(job.id,{at:Date.now(),message:String(error.message||error)});
      while(this.errors.size>64)this.errors.delete(this.errors.keys().next().value);
    })
      .finally(()=>{this.active=null;this.worker=null;this.drain();});
  }
  acquire(args){
    return new Promise((resolve,reject)=>{
      const worker=this.workerFactory({resourceLimits:{maxOldGenerationSizeMb:256}});this.worker=worker;
      const timer=setTimeout(()=>finish(new Error("DNR acquisition exceeded its background time budget")),60*60*1000);
      let done=false;
      const finish=(error,result)=>{
        if(done)return;done=true;clearTimeout(timer);
        Promise.resolve(worker.terminate()).then(async()=>{
          const temp=this.active?.tempDir;
          if(temp&&path.dirname(temp)===this.dir&&path.basename(temp).startsWith("download-"))
            await fs.promises.rm(temp,{recursive:true,force:true});
          error?reject(error):resolve(result);
        }).catch(reject);
      };
      worker.on("message",message=>{
        if(message.progress){Object.assign(this.active||{},message.progress);return;}
        finish(message.error?new Error(message.error):null,message.result);
      });
      worker.on("error",finish);worker.on("exit",code=>{if(!done)finish(new Error(`DNR acquisition worker stopped (${code})`));});
      worker.postMessage(args);
    });
  }
  save(){atomic(path.join(this.dir,"index.json"),this.index);}
  async close(){
    this.closed=true;this.queue.clear();this.warm.stop=true;
    const temp=this.active?.tempDir;
    await this.worker?.terminate();
    if(temp&&path.dirname(temp)===this.dir&&path.basename(temp).startsWith("download-"))
      await fs.promises.rm(temp,{recursive:true,force:true});
  }
}
module.exports={DnrStore,tileBounds,polygon,intersects,contains};
