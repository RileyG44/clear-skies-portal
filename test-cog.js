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
  // zlib must be able to read back the IDAT payload we wrote
  const zlib=require("zlib");
  let idat=null, off=8;
  while(off<png.length){
    const len=png.readUInt32BE(off), type=png.toString("ascii",off+4,off+8);
    if(type==="IDAT"){ idat=png.subarray(off+8,off+8+len); break }
    off+=12+len;
  }
  ok("IDAT inflates to the expected raw size",
     !!idat && zlib.inflateSync(idat).length===(w*4+1)*h);
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
