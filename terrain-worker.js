"use strict";

/* CPU-heavy terrain work lives here, away from the HTTP event loop. Each
   worker owns its TIFF decoder and a small decoded-block LRU; the range cache
   on disk is shared safely through atomic renames in usgs.js. */
const {parentPort, workerData} = require("worker_threads");
const cog = require("./cog.js");
const usgs = require("./usgs.js");
const researchAnalysis = require("./research-analysis.js");
const fs=require("node:fs"),path=require("node:path");
let dnrRuntime=null,dnrIndex=null,dnrIndexStamp=null;
function loadDnrIndex(){
  const file=path.join(workerData.cacheDir,"wadnr","index.json");
  let stamp;try{stamp=fs.statSync(file).mtimeMs;}catch{return [];}
  if(stamp!==dnrIndexStamp){dnrIndex=JSON.parse(fs.readFileSync(file,"utf8"));dnrIndexStamp=stamp;}
  return dnrIndex.files||[];
}
async function dnrFabricGrid(minE,minN,res,n,zone,strict){
  const files=loadDnrIndex(),grid=new Float64Array(n*n).fill(NaN),sources=new Set();
  if(files.length){
    dnrRuntime ||= require("./vendor/dnr-runtime.cjs");
    const center=cog.utmToLonLat(minE+n*res/2,minN+n*res/2,zone);
    const z=Math.max(0,Math.min(18,Math.floor(Math.log2(156543.03392*Math.cos(center.lat*Math.PI/180)/res))));
    const scale=2**z,groups=new Map();
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const p=cog.utmToLonLat(minE+i*res,minN+j*res,zone);
      const px=(p.lon+180)/360*scale,py=(1-Math.asinh(Math.tan(p.lat*Math.PI/180))/Math.PI)/2*scale;
      const x=Math.floor(px),y=Math.floor(py),key=x+"/"+y;
      if(!groups.has(key))groups.set(key,{x,y,points:[]});
      groups.get(key).points.push({at:j*n+i,x:Math.min(255,Math.floor((px-x)*256)),y:Math.min(255,Math.floor((py-y)*256))});
    }
    if(groups.size>16)throw new Error("DNR fabric view exceeds its sampling budget");
    for(const group of groups.values()){
      const out=await dnrRuntime.sample({cacheDir:workerData.cacheDir,files,z,x:group.x,y:group.y,size:256});
      if(!out)continue;
      let used=false;
      for(const p of group.points){const v=out.grid[p.y*256+p.x];if(Number.isFinite(v)){grid[p.at]=v;used=true;}}
      if(used)for(const source of out.sources)sources.add("WA DNR: "+source.project+" (DTM "+source.datasetId+")");
    }
  }
  if(!strict&&grid.some(v=>!Number.isFinite(v))){
    const fallback=await usgs.sampleUTMGrid(minE,minN,res,n,zone);
    if(fallback){
      let used=false;
      for(let i=0;i<grid.length;i++)if(!Number.isFinite(grid[i])&&Number.isFinite(fallback.grid[i])){grid[i]=fallback.grid[i];used=true;}
      if(used)for(const source of fallback.sources)sources.add("USGS: "+source);
    }
  }
  return sources.size?{grid,sources:[...sources],res}:null;
}

usgs.init(workerData.cacheDir);
if(workerData.cacheWriteGate)usgs.setCacheWriteGate(workerData.cacheWriteGate);
/* Batch range-write accounting rather than one IPC per COG block. The timer
   flushes small jobs too, including aborted jobs whose ranges remain cached. */
let cacheWritten=0,cacheWriteTimer=null;
const flushCacheWrites=()=>{clearTimeout(cacheWriteTimer);cacheWriteTimer=null;
  if(cacheWritten){parentPort.postMessage({cacheBytesWritten:cacheWritten});cacheWritten=0}};
usgs.onCacheWrite(bytes=>{cacheWritten+=bytes;
  if(cacheWritten>=8*1048576)flushCacheWrites();
  else if(!cacheWriteTimer){cacheWriteTimer=setTimeout(flushCacheWrites,1000);cacheWriteTimer.unref()}
});

function terrariumFromTiff(value){
  const body=Buffer.from(value);
  const t=cog.parseTiff(body), L=t.levels&&t.levels[0];
  if(!L||!L.w||!L.h||!L.tw||!L.th||!L.offsets.length) return null;
  const out=Buffer.alloc(L.w*L.h*4);
  const cols=Math.ceil(L.w/L.tw);
  let covered=0;
  for(let i=0;i<L.offsets.length;i++){
    const off=Number(L.offsets[i]), count=Number(L.counts[i]);
    if(!Number.isSafeInteger(off)||!Number.isSafeInteger(count)||off<0||count<=0||off+count>body.length) continue;
    let tile; try{ tile=cog.decodeTile(body.subarray(off,off+count),L) }catch(e){ continue }
    const tx=i%cols, ty=Math.floor(i/cols), x0=tx*L.tw, y0=ty*L.th;
    const xmax=Math.min(L.w,x0+L.tw), ymax=Math.min(L.h,y0+L.th);
    for(let y=y0;y<ymax;y++) for(let x=x0;x<xmax;x++){
      const v=tile[(y-y0)*L.tw+(x-x0)];
      if(!Number.isFinite(v)||v<-2000||v>10000) continue;
      const packed=Math.max(0,Math.min(65535.996,v+32768));
      const whole=Math.floor(packed), o=(y*L.w+x)*4;
      out[o]=whole>>8; out[o+1]=whole&255; out[o+2]=Math.floor((packed-whole)*256); out[o+3]=255;
      covered++;
    }
  }
  return covered ? {png:usgs.encodePNG(out,L.w,L.h),coverage:+(covered/(L.w*L.h)).toFixed(3)} : null;
}

async function execute(action,args){
  if(action==="dnr-elevation"){
    const files=loadDnrIndex();if(!files.length)return null;
    dnrRuntime ||= require("./vendor/dnr-runtime.cjs");
    const out=await dnrRuntime.sample({cacheDir:workerData.cacheDir,files,...args});
    if(!out)return null;
    const rgba=Buffer.alloc(out.grid.length*4);
    for(let i=0;i<out.grid.length;i++){
      const v=out.grid[i];if(!Number.isFinite(v))continue;
      const packed=Math.max(0,Math.min(65535.996,v+32768)),whole=Math.floor(packed),o=i*4;
      rgba[o]=whole>>8;rgba[o+1]=whole&255;rgba[o+2]=Math.floor((packed-whole)*256);rgba[o+3]=255;
    }
    return {png:usgs.encodePNG(rgba,args.size||256,args.size||256),coverage:out.coverage,groundRes:out.groundRes,sources:out.sources};
  }
  if(action==="raw-elevation") return usgs.elevTile(args.z,args.x,args.y,args.size||256);
  if(action==="raw-terrain") return usgs.renderTile(args.style,args.z,args.x,args.y,args.size||256);
  if(action==="fabric") return usgs.fabric(args.bbox,args.options||{});
  if(action==="dnr-fabric")return usgs.fabric(args.bbox,{...args.options,
    sample:(e,n,res,size,zone)=>dnrFabricGrid(e,n,res,size,zone,args.options?.strict)});
  if(action==="terrarium-tiff") return terrariumFromTiff(args.body);
  if(action==="research-analysis") return researchAnalysis.encodeResult(researchAnalysis.run(args));
  throw new Error(`unknown terrain action: ${action}`);
}

parentPort.on("message",async message=>{
  const {id,action,args}=message;
  try{
    const result=await execute(action,args||{});
    parentPort.postMessage({id,ok:true,result},result instanceof ArrayBuffer?[result]:[]);
  }catch(error){
    parentPort.postMessage({id,ok:false,error:String(error&&error.message||error)});
  }
});
