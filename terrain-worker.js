"use strict";

/* CPU-heavy terrain work lives here, away from the HTTP event loop. Each
   worker owns its TIFF decoder and a small decoded-block LRU; the range cache
   on disk is shared safely through atomic renames in usgs.js. */
const {parentPort, workerData} = require("worker_threads");
const cog = require("./cog.js");
const usgs = require("./usgs.js");

usgs.init(workerData.cacheDir);

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
  if(action==="raw-elevation") return usgs.elevTile(args.z,args.x,args.y,args.size||256);
  if(action==="raw-terrain") return usgs.renderTile(args.style,args.z,args.x,args.y,args.size||256);
  if(action==="fabric") return usgs.fabric(args.bbox,args.options||{});
  if(action==="terrarium-tiff") return terrariumFromTiff(args.body);
  throw new Error(`unknown terrain action: ${action}`);
}

parentPort.on("message",async message=>{
  const {id,action,args}=message;
  try{
    const result=await execute(action,args||{});
    parentPort.postMessage({id,ok:true,result});
  }catch(error){
    parentPort.postMessage({id,ok:false,error:String(error&&error.message||error)});
  }
});

