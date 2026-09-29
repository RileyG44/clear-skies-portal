/* Offline checks for the terrain engine. No network, no fixtures — everything
   here is either hand-computed or a published control value, so it runs in CI.

   Run: node test-cog.js                                                       */
"use strict";
const cog  = require("./cog.js");
const usgs = require("./usgs.js");

let pass=0, fail=0;
function ok(name, cond, detail){
  if(cond){ pass++; console.log("  ok   " + name); }
  else    { fail++; console.log("  FAIL " + name + (detail?"  -> "+detail:"")); }
}
const near=(a,b,tol)=>Math.abs(a-b)<=tol;

console.log("TIFF LZW");
{
  /* Hand-assembled TIFF-LZW stream: CLEAR(256), 'A'(65), 'B'(66), EOI(257),
     packed MSB-first at 9 bits and zero-padded to a byte boundary.
       100000000 001000001 001000010 100000001 0000
     = 0x80 0x10 0x48 0x50 0x10
     If the packing order or the early-width-change were wrong, this is the
     smallest case that would show it. */
  const out = cog.lzwDecode(Buffer.from([0x80,0x10,0x48,0x50,0x10]), 2);
  ok("decodes a hand-packed stream to 'AB'", out.toString("latin1")==="AB",
     JSON.stringify(out.toString("latin1")));

  // A stream that is only CLEAR + EOI must yield nothing rather than throw.
  const empty = cog.lzwDecode(Buffer.from([0x80,0x08,0x00]), 0);
  ok("empty stream is handled", empty.length===0);

  /* Round-trip through a reference TIFF-LZW encoder (MSB-first, early change,
     CLEAR when the table fills), on data shaped like DEM planes: long runs
     (which exercise the KwKwK case), repeated phrases, and noise, and long
     enough to force several table resets. */
  const encode = data => {
    const bytes=[]; let buf=0, cnt=0, width=9;
    const put = code => { buf=(buf<<width)|code; cnt+=width;
      while(cnt>=8){ bytes.push((buf>>>(cnt-8))&0xff); cnt-=8; } buf&=(1<<cnt)-1; };
    let dict=new Map(), next=258;
    put(256);
    let w=String.fromCharCode(data[0]);
    for(let i=1;i<data.length;i++){
      const c=String.fromCharCode(data[i]), wc=w+c;
      if(wc.length===1 || dict.has(wc)){ w=wc; continue; }
      put(w.length===1 ? w.charCodeAt(0) : dict.get(w));
      dict.set(wc,next++);
      if(next >= (1<<width) && width<12) width++;   // the decoder's early change, seen from this side
      if(next>=4094){ put(256); dict=new Map(); next=258; width=9; }
      w=c;
    }
    put(w.length===1 ? w.charCodeAt(0) : dict.get(w));
    put(257);
    if(cnt>0) bytes.push((buf<<(8-cnt))&0xff);
    return Buffer.from(bytes);
  };
  let seed=7; const rnd=()=>(seed=(Math.imul(seed,1103515245)+12345)&0x7fffffff)/0x80000000;
  const data=Buffer.alloc(200000);
  for(let i=0;i<data.length;){
    const kind=rnd();
    if(kind<0.3){ const v=(rnd()*256)|0, l=1+((rnd()*400)|0); for(let j=0;j<l&&i<data.length;j++) data[i++]=v; }
    else if(kind<0.6){ const at=Math.max(0,i-1-((rnd()*300)|0)), l=(rnd()*60)|0; for(let j=0;j<l&&i<data.length;j++) data[i++]=data[at+j]; }
    else data[i++]=(rnd()*256)|0;
  }
  const back = cog.lzwDecode(encode(data), data.length);
  ok("round-trips 200 KB of run/phrase/noise data", back.equals(data));
  const single = Buffer.alloc(5000, 0x41);
  ok("round-trips a single long run (KwKwK every step)", cog.lzwDecode(encode(single), single.length).equals(single));
  // A corrupt stream (a code past the table) stops rather than hanging.
  const junk = Buffer.from(encode(data).subarray(0,4000)); for(let i=200;i<4000;i+=37) junk[i]^=0xff;
  const t0 = Date.now(); cog.lzwDecode(junk, data.length);
  ok("a corrupt stream returns promptly", Date.now()-t0 < 1000);
}

console.log("floating-point predictor 3");
{
  /* Build a row the way an encoder would: take two floats, split them into
     byte planes, then horizontally difference. Undoing must return the
     originals. */
  const vals=[1234.5, 1240.25];
  const bps=4, spp=1, w=vals.length;
  const src=Buffer.alloc(w*bps);
  vals.forEach((v,i)=>src.writeFloatLE(v, i*bps));
  // de-interleave into planes (high byte plane first), as predictor 3 stores it
  const planed=Buffer.alloc(w*bps);
  for(let n=0;n<w;n++) for(let b=0;b<bps;b++) planed[(bps-b-1)*w + n] = src[n*bps+b];
  // horizontal byte differencing
  const diffed=Buffer.from(planed);
  for(let i=diffed.length-1;i>=spp;i--) diffed[i]=(diffed[i]-diffed[i-spp])&0xff;

  const undone=cog.undoPredictor3(Buffer.from(diffed), w, 1, spp, bps);
  const got=[undone.readFloatLE(0), undone.readFloatLE(4)];
  ok("round-trips float32 values", near(got[0],vals[0],1e-3)&&near(got[1],vals[1],1e-3),
     JSON.stringify(got));
}

console.log("geodesy");
{
  const lat=46.8523, lon=-121.7603;                  // Rainier summit
  const z=cog.utmZone(lon);
  ok("Rainier is UTM zone 10", z===10, "got "+z);
  const u=cog.lonLatToUTM(lon,lat,z);
  ok("easting is plausible",  near(u.e,594508,2), u.e.toFixed(1));
  ok("northing is plausible", near(u.n,5189497,2), u.n.toFixed(1));
  const back=cog.utmToLonLat(u.e,u.n,z);
  ok("round-trips to under a millimetre",
     near(back.lat,lat,1e-8)&&near(back.lon,lon,1e-8));
  ok("eastern Washington is zone 11", cog.utmZone(-118.5)===11);
}

console.log("cell addressing");
{
  /* y is the NORTH edge, so ceil() — floor() names the cell one 10 km step
     south, which is how the earlier coverage table went wrong. */
  ok("Rainier summit -> x59y519", usgs.cellOf(594508,5189497)==="x59y519",
     usgs.cellOf(594508,5189497));
  const b=usgs.cellBounds("x59y519");
  ok("cell bounds put the north edge at y*10000", b.n===5190000 && b.s===5180000,
     JSON.stringify(b));
  ok("cell bounds put the west edge at x*10000", b.w===590000 && b.e===600000);
  // a point exactly on a boundary must not land in the cell above it
  ok("north edge is inclusive downward", usgs.cellOf(594508,5190000)==="x59y519",
     usgs.cellOf(594508,5190000));
}

console.log("project year");
{
  ok("plain year", usgs.projectYear("WA_MtBaker_2015")===2015);
  ok("delivery suffix", usgs.projectYear("WA_NorthEast_B22")===2022);
  ok("prefers the later of two", usgs.projectYear("WA_DNR_3DEP_Processing_2019_D20")===2019);
}

console.log("PNG encoder");
{
  const w=4,h=3;
  const rgba=Buffer.alloc(w*h*4);
  for(let i=0;i<w*h;i++){ rgba[i*4]=i*10; rgba[i*4+1]=255-i*10; rgba[i*4+2]=128; rgba[i*4+3]=255 }
  const png=usgs.encodePNG(rgba,w,h);
  ok("emits the PNG signature",
     png.slice(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])));
  ok("IHDR carries the dimensions", png.readUInt32BE(16)===w && png.readUInt32BE(20)===h);
  ok("ends with IEND", png.slice(-8,-4).toString("ascii")==="IEND");
  /* Decode it back — every colour type and filter the encoder may pick — and
     require the exact RGBA it was given, for grey, grey+alpha, RGB and RGBA
     images (hillshade, hillshade with no-data, elevation, tint with no-data). */
  const zlib=require("zlib");
  const decode = buf => {
    let off=8, idat=[], W, H, type;
    while(off<buf.length){
      const len=buf.readUInt32BE(off), t=buf.toString("ascii",off+4,off+8), d=buf.subarray(off+8,off+8+len);
      if(t==="IHDR"){ W=d.readUInt32BE(0); H=d.readUInt32BE(4); type=d[9]; }
      if(t==="IDAT") idat.push(d);
      off+=12+len;
    }
    const bpp={0:1,2:3,4:2,6:4}[type], stride=W*bpp, raw=zlib.inflateSync(Buffer.concat(idat)), px=Buffer.alloc(stride*H);
    for(let y=0;y<H;y++){
      const f=raw[y*(stride+1)];
      for(let i=0;i<stride;i++){
        const a=i>=bpp?px[y*stride+i-bpp]:0, b=y?px[(y-1)*stride+i]:0, c=(i>=bpp&&y)?px[(y-1)*stride+i-bpp]:0;
        const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
        const pred=[0,a,b,(a+b)>>1, pa<=pb&&pa<=pc?a:pb<=pc?b:c][f];
        px[y*stride+i]=(raw[y*(stride+1)+1+i]+pred)&255;
      }
    }
    const out=Buffer.alloc(W*H*4);
    for(let i=0;i<W*H;i++){
      const q=i*bpp;
      if(type===0) out.set([px[q],px[q],px[q],255],i*4);
      if(type===4) out.set([px[q],px[q],px[q],px[q+1]],i*4);
      if(type===2) out.set([px[q],px[q+1],px[q+2],255],i*4);
      if(type===6) out.set(px.subarray(q,q+4),i*4);
    }
    return {type, rgba:out};
  };
  const W2=37, H2=23;
  const make = (grey, opaque) => { const b=Buffer.alloc(W2*H2*4);
    for(let i=0;i<W2*H2;i++){ const x=i%W2, y=(i/W2)|0, g=(x*7+y*13+((x*y)%5))&255;
      b[i*4]=g; b[i*4+1]=grey?g:(x*3)&255; b[i*4+2]=grey?g:(y*11)&255; b[i*4+3]=opaque||(x+y)%9?255:0; }
    return b; };
  for(const [name,grey,opaque,type] of [["grey",true,true,0],["grey+alpha",true,false,4],["RGB",false,true,2],["RGBA",false,false,6]]){
    const src=make(grey,opaque), got=decode(usgs.encodePNG(src,W2,H2));
    ok(`${name} image uses colour type ${type} and decodes exactly`, got.type===type && got.rgba.equals(src), "type "+got.type);
  }
}

console.log("NODATA sentinel");
{
  /* The bug that silently blanked every rendered pixel: a float64 -1e30 does
     not survive a Float32Array round-trip, so `=== NODATA` never matched. */
  const a=new Float32Array(1); a[0]=-1e30;
  ok("plain -1e30 does NOT survive float32 (the trap)", a[0]!==-1e30);
  const b=new Float32Array(1); b[0]=Math.fround(-1e30);
  ok("Math.fround(-1e30) does survive", b[0]===Math.fround(-1e30));
}

console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
