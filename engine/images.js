/* Tiles the engine sends when it has no data, and checks on what upstreams
   return. */
"use strict";
const zlib = require("zlib");

const TRANSPARENT = Buffer.from(
 "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=","base64");
/* A 256x256 tile encoding a constant 0 m in Terrarium, for the DEM route only.
   Terrarium reads elevation = (R*256 + G + B/256) - 32768, so 0 m is RGB(128,0,0).
   The 1x1 TRANSPARENT tile below is correct for a 2D overlay but catastrophic as
   terrain geometry: its RGB(0,0,0) decodes to -32768 m, which punches a 32 km
   pit into the mesh wherever elevation data runs out (most obviously at the
   coast, where it was also cached `immutable` for a week). */
const SEA_LEVEL_DEM = (() => {
  const W=256, row=W*4+1, raw=Buffer.alloc(row*W);
  for(let y=0;y<W;y++){
    const o=y*row; raw[o]=0;                       // filter: none
    for(let x=0;x<W;x++){ const p=o+1+x*4; raw[p]=128; raw[p+1]=0; raw[p+2]=0; raw[p+3]=255 }
  }
  const crcT=new Int32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; crcT[n]=c }
  const crc=b=>{ let c=0xffffffff; for(let i=0;i<b.length;i++) c=crcT[(c^b[i])&0xff]^(c>>>8); return (c^0xffffffff)>>>0 };
  const chunk=(type,data)=>{
    const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
    const td=Buffer.concat([Buffer.from(type,"ascii"),data]);
    const c=Buffer.alloc(4); c.writeUInt32BE(crc(td),0);
    return Buffer.concat([len,td,c]);
  };
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(W,4);
  ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR",ihdr), chunk("IDAT",zlib.deflateSync(raw,{level:9})), chunk("IEND",Buffer.alloc(0))]);
})();

const isPng = body => Buffer.isBuffer(body)&&body.length>8&&body[0]===0x89&&body[1]===0x50&&
  body[2]===0x4e&&body[3]===0x47&&body[4]===0x0d&&body[5]===0x0a&&body[6]===0x1a&&body[7]===0x0a;
const isTiff = body => Buffer.isBuffer(body)&&body.length>8&&
  ((body[0]===0x49&&body[1]===0x49&&body[2]===0x2a&&body[3]===0x00) ||
   (body[0]===0x4d&&body[1]===0x4d&&body[2]===0x00&&body[3]===0x2a));
const isJpeg = body => Buffer.isBuffer(body)&&body.length>3&&
  body[0]===0xff&&body[1]===0xd8&&body[2]===0xff;
const isWebp = body => Buffer.isBuffer(body)&&body.length>=12&&
  body.toString("ascii",0,4)==="RIFF"&&body.toString("ascii",8,12)==="WEBP";

module.exports={TRANSPARENT,SEA_LEVEL_DEM,isPng,isTiff,isJpeg,isWebp};
