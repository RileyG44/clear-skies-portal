"use strict";
/* The streaming encoder must produce a PNG any decoder reads back to the exact
   pixels it was given, however the rows arrive. Decoded here independently:
   chunk walk with CRC check, zlib inflate, and the PNG filter reversal. */
const assert=require("assert/strict");
const zlib=require("zlib");
const P=require("./png-stream.js");

function decode(buf){
  const sig=[137,80,78,71,13,10,26,10];
  sig.forEach((b,i)=>assert.equal(buf[i],b,"PNG signature"));
  let at=8,width=0,height=0,idat=[],sawEnd=false,types=[];
  while(at<buf.length){
    const len=buf.readUInt32BE(at),type=buf.toString("latin1",at+4,at+8),data=buf.subarray(at+8,at+8+len);
    const crc=buf.readUInt32BE(at+8+len);
    assert.equal(P.crc32([Buffer.from(type,"latin1"),data]),crc,`CRC of ${type}`);
    types.push(type);
    if(type==="IHDR"){ width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)],[8,2,0,0,0],"8-bit RGB, no interlace") }
    if(type==="IDAT") idat.push(data);
    if(type==="IEND") sawEnd=true;
    at+=12+len;
  }
  assert(sawEnd&&types[0]==="IHDR"&&types.at(-1)==="IEND","chunk order");
  const raw=zlib.inflateSync(Buffer.concat(idat)),stride=width*3,px=Buffer.alloc(width*height*3);
  assert.equal(raw.length,height*(stride+1),"one filter byte per row");
  for(let y=0;y<height;y++){
    const f=raw[y*(stride+1)],row=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1));
    for(let j=0;j<stride;j++){
      const a=j>=3?px[y*stride+j-3]:0,b=y?px[(y-1)*stride+j]:0,c=y&&j>=3?px[(y-1)*stride+j-3]:0;
      let pred=0;
      if(f===4){ const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);pred=pa<=pb&&pa<=pc?a:pb<=pc?b:c }
      else assert.equal(f,0,"only Paeth or none");
      px[y*stride+j]=(row[j]+pred)&0xff;
    }
  }
  return {width,height,px};
}

async function encode(width,height,pixel,band){
  const parts=[];
  const png=P.create({width,height,write:bytes=>{parts.push(Buffer.from(bytes))}});
  for(let y0=0;y0<height;y0+=band){
    const rows=Math.min(band,height-y0),rgba=new Uint8ClampedArray(width*rows*4);
    for(let r=0;r<rows;r++) for(let x=0;x<width;x++){
      const [R,G,B]=pixel(x,y0+r),i=(r*width+x)*4;rgba[i]=R;rgba[i+1]=G;rgba[i+2]=B;rgba[i+3]=255;
    }
    await png.writeRows(rgba,rows);
  }
  await png.finish();
  return Buffer.concat(parts);
}

(async()=>{
  assert.equal(P.supported(),true,"CompressionStream available");
  // Known CRC of "IEND" with no data.
  assert.equal(P.crc32([Buffer.from("IEND")]),0xae426082);

  const noisy=(x,y)=>[(x*37+y*11)&255,(x*x+y*7)&255,((x^y)*13)&255];
  for(const [w,h,band] of [[1,1,1],[3,5,2],[17,9,4],[640,480,37]]){
    const {width,height,px}=decode(await encode(w,h,noisy,band));
    assert.equal(width,w);assert.equal(height,h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const [R,G,B]=noisy(x,y),i=(y*w+x)*3;
      if(px[i]!==R||px[i+1]!==G||px[i+2]!==B) assert.fail(`pixel ${x},${y} of ${w}x${h}`);
    }
  }

  // Wider than any canvas may be (16,384 px), streamed in bands.
  const wide=await encode(20000,40,(x,y)=>[x&255,y&255,(x>>8)&255],13);
  const big=decode(wide);
  assert.equal(big.width,20000);
  assert.equal(big.px[(39*20000+19999)*3],19999&255,"last pixel survives");
  assert(wide.length>12&&wide.toString("latin1",wide.length-8,wide.length-4)==="IEND");

  // Async sinks (a file on disk) are awaited in order.
  const order=[];let n=0;
  const png=P.create({width:2,height:2,write:async bytes=>{ const k=n++;await new Promise(r=>setTimeout(r,k%2?0:3));order.push(k) }});
  await png.writeRows(new Uint8ClampedArray(16).fill(200),2);await png.finish();
  assert.deepEqual(order,[...order].sort((a,b)=>a-b),"writes land in order");

  await assert.rejects(async()=>{ const p=P.create({width:2,height:3,write:()=>{}});await p.writeRows(new Uint8ClampedArray(16),2);await p.finish() },/incomplete/);
  console.log("png stream checks passed (round-trip, bands, >16384 px wide, ordered async sink, incomplete guard)");
})().catch(error=>{ console.error(error);process.exit(1) });
