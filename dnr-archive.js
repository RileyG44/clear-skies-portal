/* iCloud archive for prepared WA DNR rasters. When the local DNR store reaches
   its budget, the least recently used rasters move here instead of being lost;
   viewing that area again copies them back without another DNR download.

   Layout under the archive root (synced by iCloud Drive):
     index.json                 spatial index of every archived raster
     files/<key>/record.json    the raster's full metadata (rebuilds the index)
     files/<key>/<key>.tif      native raster
     files/<key>/<key>/...      numeric overviews
   record.json is the source of truth, so a lost or conflicted index.json is
   rebuilt from the folders. */
"use strict";
const fs=require("node:fs"),fsp=fs.promises,path=require("node:path"),os=require("node:os");
const {execFile}=require("node:child_process");
const {pipeline}=require("node:stream/promises");
const ICLOUD=path.join(os.homedir(),"Library","Mobile Documents","com~apple~CloudDocs");
const intersects=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];

/* CSP_DNR_ARCHIVE_DIR wins ("off" disables); otherwise iCloud Drive on macOS
   when it is signed in, else no archive. */
function defaultArchiveRoot(env=process.env){
  const value=env.CSP_DNR_ARCHIVE_DIR;
  if(value)return /^(off|0|false|none)$/i.test(value)?null:path.resolve(value);
  if(process.platform==="darwin"&&fs.existsSync(ICLOUD))return path.join(ICLOUD,"Clear Skies Portal","WA DNR lidar");
  return null;
}
function atomic(file,value){
  const tmp=file+"."+process.pid+".tmp";
  try{fs.writeFileSync(tmp,JSON.stringify(value,null,1));fs.renameSync(tmp,file);}
  finally{try{fs.unlinkSync(tmp);}catch{}}
}
// Moves stay instant on one volume; another volume falls back to copy + delete.
async function move(from,to){
  try{await fsp.rename(from,to);}
  catch(error){
    if(error.code!=="EXDEV")throw error;
    await fsp.cp(from,to,{recursive:true,errorOnExist:true,force:false});
    await fsp.rm(from,{recursive:true,force:true});
  }
}
/* iCloud may have offloaded a file to the cloud. Reading a dataless file
   downloads it on current macOS; older releases leave a ".name.icloud"
   placeholder, which brctl downloads and we wait for. */
function brctl(target){
  if(process.platform!=="darwin")return Promise.resolve();
  return new Promise(resolve=>execFile("brctl",["download",target],{timeout:30000},()=>resolve()));
}
async function materialize(file,timeoutMs){
  if(fs.existsSync(file))return;
  const placeholder=path.join(path.dirname(file),"."+path.basename(file)+".icloud");
  if(!fs.existsSync(placeholder))throw new Error(`iCloud archive file is missing: ${path.basename(file)}`);
  await brctl(file);
  for(const end=Date.now()+timeoutMs;!fs.existsSync(file);){
    if(Date.now()>end)throw new Error("iCloud did not download the archived DNR raster in time");
    await new Promise(r=>setTimeout(r,500));
  }
}
async function copyTree(from,to,timeoutMs){
  let bytes=0;
  const stat=await fsp.stat(from).catch(()=>null);
  if(stat?.isDirectory()){
    await fsp.mkdir(to,{recursive:true});
    // Placeholders list as ".name.icloud"; copy the real name they stand for.
    const names=new Set((await fsp.readdir(from)).map(n=>/^\..+\.icloud$/.test(n)?n.slice(1,-7):n));
    for(const name of names)bytes+=await copyTree(path.join(from,name),path.join(to,name),timeoutMs);
    return bytes;
  }
  await materialize(from,timeoutMs);
  await pipeline(fs.createReadStream(from),fs.createWriteStream(to,{flags:"wx"}));
  return (await fsp.stat(to)).size;
}

class DnrArchive {
  constructor(root,{downloadTimeoutMs=10*60*1000}={}){
    this.root=root||null;this.downloadTimeoutMs=downloadTimeoutMs;this.entries=new Map();this.error=null;
    if(!this.root)return;
    try{
      fs.mkdirSync(path.join(this.root,"files"),{recursive:true});
      let index=null;
      try{index=JSON.parse(fs.readFileSync(path.join(this.root,"index.json"),"utf8"));}catch{}
      if(index?.version===1&&Array.isArray(index.files))for(const e of index.files)this.entries.set(e.key,e);
      this.reconcile();
    }catch(error){this.error=String(error.message||error);this.root=null;}
  }
  get available(){return !!this.root;}
  /* Folders are authoritative: add any the index lost (another Mac, an iCloud
     conflict copy of index.json) and drop entries whose folder is gone. */
  reconcile(){
    const dir=path.join(this.root,"files");let changed=false;
    const names=new Set(fs.readdirSync(dir).filter(n=>!n.startsWith(".")));
    for(const key of [...this.entries.keys()])if(!names.has(key)){this.entries.delete(key);changed=true;}
    for(const key of names){
      if(this.entries.has(key))continue;
      try{
        const record=JSON.parse(fs.readFileSync(path.join(dir,key,"record.json"),"utf8"));
        if(record.key===key){this.entries.set(key,record);changed=true;}
      }catch{}
    }
    if(changed||!fs.existsSync(path.join(this.root,"index.json")))this.save();
  }
  save(){
    const files=[...this.entries.values()].sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
    atomic(path.join(this.root,"index.json"),{version:1,updated:new Date().toISOString(),files});
  }
  has(key){return this.entries.has(key);}
  find(datasetId,bbox){
    return [...this.entries.values()].filter(e=>e.datasetId===datasetId&&intersects(e.bounds,bbox));
  }
  list(){
    return [...this.entries.values()].map(e=>({key:e.key,project:e.project,datasetId:e.datasetId,year:e.year,
      bounds:e.bounds,bytes:e.bytes,archivedAt:e.archivedAt,lastUsed:e.lastUsed||null}))
      .sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
  }
  status(){
    let bytes=0;for(const e of this.entries.values())bytes+=e.bytes||0;
    return {available:this.available,root:this.root,files:this.entries.size,bytes,error:this.error};
  }
  /* Move one prepared raster out of localDir. A raster already archived (it
     was restored earlier) only needs its local copy removed. */
  async store(localDir,record,{lastUsed=null}={}){
    if(!this.root)throw new Error("No iCloud archive is configured");
    const local=[path.join(localDir,record.file),path.join(localDir,record.overviewDir)];
    if(this.entries.has(record.key)){
      for(const p of local)await fsp.rm(p,{recursive:true,force:true});
      return this.entries.get(record.key);
    }
    const files=path.join(this.root,"files"),final=path.join(files,record.key);
    const stage=path.join(files,`.${record.key}.partial-${process.pid}-${Date.now().toString(36)}`);
    await fsp.mkdir(stage);
    try{
      await move(local[0],path.join(stage,record.file));
      await move(local[1],path.join(stage,record.overviewDir));
      const entry={...record,archivedAt:Date.now(),lastUsed};
      await fsp.writeFile(path.join(stage,"record.json"),JSON.stringify(entry,null,1));
      await fsp.rename(stage,final);
      this.entries.set(record.key,entry);this.save();
      return entry;
    }catch(error){
      // Put anything already moved back so the local store stays usable.
      for(const [i,p] of local.entries()){
        const staged=path.join(stage,i?record.overviewDir:record.file);
        if(!fs.existsSync(p)&&fs.existsSync(staged))await move(staged,p).catch(()=>{});
      }
      await fsp.rm(stage,{recursive:true,force:true}).catch(()=>{});
      throw error;
    }
  }
  /* Copy an archived raster back into localDir. The iCloud copy stays, so the
     next eviction of this raster is a plain local delete. */
  async restore(entry,localDir){
    const source=path.join(this.root,"files",entry.key);
    await brctl(source);
    const stage=await fsp.mkdtemp(path.join(localDir,"restore-"));
    try{
      let bytes=await copyTree(path.join(source,entry.file),path.join(stage,entry.file),this.downloadTimeoutMs);
      bytes+=await copyTree(path.join(source,entry.overviewDir),path.join(stage,entry.overviewDir),this.downloadTimeoutMs);
      if(entry.bytes&&bytes!==entry.bytes)throw new Error("iCloud copy of the DNR raster is incomplete");
      for(const p of [entry.file,entry.overviewDir]){
        await fsp.rm(path.join(localDir,p),{recursive:true,force:true});
        await fsp.rename(path.join(stage,p),path.join(localDir,p));
      }
    }finally{await fsp.rm(stage,{recursive:true,force:true});}
    const {archivedAt,lastUsed,...record}=entry;
    return record;
  }
}
module.exports={DnrArchive,defaultArchiveRoot};
