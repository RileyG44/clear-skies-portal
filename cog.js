/* Clear Skies Portal — Cloud-Optimised GeoTIFF reader
   Reads USGS 3DEP 1 m DEM COGs from S3 by byte range and renders terrain from
   the actual elevation values, instead of scraping a rendered PNG of them.

   Pure JS on purpose: the app installs nothing, and pulling in a GeoTIFF
   library would end that. What is actually needed is narrow — these files are
   uniformly LZW with the floating-point predictor, 512x512 tiles, one float32
   band. Node's zlib has no LZW, so that is here; the rest is arithmetic.     */
"use strict";
const zlib = require("zlib");

/* ---------------------------------------------------------------- TIFF LZW
   The TIFF flavour, which differs from GIF: codes pack MSB-first and the code
   width grows one step early (at 511, not 512). Getting that off-by-one wrong
   decodes the first few hundred bytes correctly and then turns to noise.     */
const CLEAR = 256, EOI = 257;

function lzwDecode(src, expected){
  const out = Buffer.alloc(expected);
  let outPos = 0;

  // Dictionary as flat arrays: a prefix code plus one appended byte, walked
  // backwards into a scratch stack. No string concatenation, no allocation.
  const pfx = new Int32Array(4096), suf = new Uint8Array(4096);
  for(let i=0;i<256;i++){ pfx[i]=-1; suf[i]=i; }

  let next = 258, width = 9, old = -1;
  let bitBuf = 0, bitCnt = 0, p = 0;
  const stack = Buffer.alloc(4096);

  const emit = code => {
    let n = 0, c = code;
    while(c >= 0 && n < 4096){ stack[n++] = suf[c]; c = pfx[c]; }
    while(n > 0 && outPos < expected) out[outPos++] = stack[--n];
  };
  const firstOf = code => { let c = code; while(pfx[c] >= 0) c = pfx[c]; return suf[c]; };

  for(;;){
    while(bitCnt < width){
      if(p >= src.length){ bitCnt = -1; break; }
      bitBuf = ((bitBuf << 8) | src[p++]) >>> 0; bitCnt += 8;
    }
    if(bitCnt < 0) break;
    const code = (bitBuf >>> (bitCnt - width)) & ((1 << width) - 1);
    bitCnt -= width;

    if(code === EOI) break;
    if(code === CLEAR){ next = 258; width = 9; old = -1; continue; }

    if(old < 0){ emit(code); old = code; continue; }

    if(code < next){
      emit(code);
      if(next < 4096){ pfx[next]=old; suf[next]=firstOf(code); next++; }
    }else{
      // Not yet in the table: the classic KwKwK case.
      if(next < 4096){ pfx[next]=old; suf[next]=firstOf(old); next++; }
      emit(next-1);
    }
    old = code;
    // Early change: widen one code sooner than a naive reading suggests.
    if(next + 1 >= (1 << width) && width < 12) width++;
  }
  return outPos === expected ? out : out.subarray(0, outPos);
}

/* ------------------------------------------------- floating-point predictor
   Predictor 3 does two things and both must be undone, in order: bytes are
   horizontally differenced, then the byte planes of each float are stored
   apart (every high byte, then every second byte, ...). libtiff calls this
   fpAcc. Undo the differencing first, then de-interleave the planes.         */
function undoPredictor3(buf, width, rows, spp, bps){
  const rowBytes = width * spp * bps;
  const wc = width * spp;
  const tmp = Buffer.alloc(rowBytes);
  for(let r=0; r<rows; r++){
    const o = r * rowBytes;
    if(o + rowBytes > buf.length) break;
    for(let i=spp; i<rowBytes; i++) buf[o+i] = (buf[o+i] + buf[o+i-spp]) & 0xff;
    buf.copy(tmp, 0, o, o+rowBytes);
    for(let n=0; n<wc; n++)
      for(let b=0; b<bps; b++)
        buf[o + bps*n + b] = tmp[(bps - b - 1)*wc + n];   // little-endian target
  }
  return buf;
}

function undoPredictor2(buf, width, rows, spp, bps){      // plain horizontal differencing
  const rowBytes = width * spp * bps;
  if(bps !== 1) return buf;
  for(let r=0; r<rows; r++){
    const o = r*rowBytes;
    for(let i=spp; i<rowBytes; i++) buf[o+i] = (buf[o+i] + buf[o+i-spp]) & 0xff;
  }
  return buf;
}

/* --------------------------------------------------------------- TIFF parse */
const TSIZE={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,16:8,17:8,18:8};

function parseTiff(b){
  const le = b.toString("ascii",0,2)==="II";
  const u16=o=>le?b.readUInt16LE(o):b.readUInt16BE(o);
  const u32=o=>le?b.readUInt32LE(o):b.readUInt32BE(o);
  const u64=o=>Number(le?b.readBigUInt64LE(o):b.readBigUInt64BE(o));
  const f64=o=>le?b.readDoubleLE(o):b.readDoubleBE(o);
  const ver=u16(2), big=ver===43;
  if(ver!==42 && ver!==43) throw new Error("not a TIFF (version "+ver+")");

  const readEntries=(ifd)=>{
    const n = big?u64(ifd):u16(ifd);
    const es = ifd+(big?8:2), esz = big?20:12;
    const tags={};
    for(let i=0;i<n;i++){
      const e=es+i*esz, tag=u16(e), typ=u16(e+2);
      const cnt = big?u64(e+4):u32(e+4);
      const bytes=(TSIZE[typ]||1)*cnt;
      const voff = big? e+12 : e+8;
      const off = bytes <= (big?8:4) ? voff : (big?u64(voff):u32(voff));
      tags[tag]={typ,cnt,off};
    }
    return {tags, nextIfd: big?u64(es+n*esz):u32(es+n*esz)};
  };
  const vals=(t)=>{
    if(!t) return [];
    const a=[];
    for(let j=0;j<t.cnt;j++){
      const o=t.off;
      if(t.typ===3) a.push(u16(o+j*2));
      else if(t.typ===4) a.push(u32(o+j*4));
      else if(t.typ===16) a.push(u64(o+j*8));
      else if(t.typ===12) a.push(f64(o+j*8));
      else if(t.typ===11) a.push(le?b.readFloatLE(o+j*4):b.readFloatBE(o+j*4));
      else if(t.typ===2) a.push(String.fromCharCode(b[o+j]));
      else a.push(b[o+j]);
    }
    return a;
  };
  const one=(t,d)=>{ if(!t) return d; const v=vals(t); return v.length?v[0]:d; };

  const levels=[]; let ifd = big?u64(8):u32(4), guard=0, geo=null;
  while(ifd && guard++<16){
    if(ifd+2 > b.length) break;
    const {tags,nextIfd}=readEntries(ifd);
    const lv={
      w:one(tags[256]), h:one(tags[257]),
      tw:one(tags[322]), th:one(tags[323]),
      comp:one(tags[259],1), pred:one(tags[317],1),
      bps:one(tags[258],32), spp:one(tags[277],1), sf:one(tags[339],1),
      offsets: vals(tags[324]), counts: vals(tags[325])
    };
    if(!lv.tw) break;                                 // stripped, not tiled — not a COG
    levels.push(lv);
    if(!geo){
      const gk=vals(tags[34735]);
      let epsg=null;
      for(let i=4;i+3<gk.length;i+=4) if(gk[i]===3072) epsg=gk[i+3];
      let nod=null;
      if(tags[42113]){
        const s=vals(tags[42113]).join("").replace(/\0/g,"").trim();
        if(s) nod=parseFloat(s);
      }
      geo={ scale:vals(tags[33550]), tie:vals(tags[33922]), epsg,
            desc:vals(tags[34737]).join("").replace(/\0/g,""), nodata:nod };
    }
    ifd=nextIfd;
  }
  if(!levels.length) throw new Error("no tiled IFD found");
  return {le, big, levels, geo};
}

/* ------------------------------------------------------- decode a raw tile */
function decodeTile(raw, lv){
  const px = lv.tw * lv.th, bytes = px * lv.spp * (lv.bps/8);
  let d;
  if(lv.comp===1) d = Buffer.from(raw);
  else if(lv.comp===5) d = lzwDecode(raw, bytes);
  else if(lv.comp===8 || lv.comp===32946) d = zlib.inflateSync(raw);
  else throw new Error("unsupported compression "+lv.comp);
  if(d.length < bytes){ const pad=Buffer.alloc(bytes); d.copy(pad); d=pad; }

  if(lv.pred===3) undoPredictor3(d, lv.tw, lv.th, lv.spp, lv.bps/8);
  else if(lv.pred===2) undoPredictor2(d, lv.tw, lv.th, lv.spp, lv.bps/8);

  const out=new Float32Array(px);
  if(lv.bps===32 && lv.sf===3){ for(let i=0;i<px;i++) out[i]=d.readFloatLE(i*4); return out; }
  if(lv.bps===32)            { for(let i=0;i<px;i++) out[i]= lv.sf===2?d.readInt32LE(i*4):d.readUInt32LE(i*4); return out; }
  if(lv.bps===16)            { for(let i=0;i<px;i++) out[i]= lv.sf===2?d.readInt16LE(i*2):d.readUInt16LE(i*2); return out; }
  throw new Error("unsupported sample format bps="+lv.bps+" sf="+lv.sf);
}

module.exports = { lzwDecode, undoPredictor3, undoPredictor2, parseTiff, decodeTile };

/* ------------------------------------------------------------------- geodesy
   UTM <-> geographic on the GRS80/WGS84 ellipsoid. NAD83 and WGS84 differ by
   about a metre in Washington, which is below the 1 m pixel and not worth a
   datum shift here. Transverse Mercator, Krueger series to the usual order.  */
const A=6378137, F=1/298.257223563, K0=0.9996, E0=500000;
const ECC2 = F*(2-F);
const EP2  = ECC2/(1-ECC2);
const D2R=Math.PI/180, R2D=180/Math.PI;

function lonLatToUTM(lon, lat, zone){
  const lam0=((zone-1)*6-180+3)*D2R;
  const phi=lat*D2R, lam=lon*D2R;
  const N=A/Math.sqrt(1-ECC2*Math.sin(phi)**2);
  const T=Math.tan(phi)**2, C=EP2*Math.cos(phi)**2;
  const Aa=Math.cos(phi)*(lam-lam0);
  const M=A*((1-ECC2/4-3*ECC2**2/64-5*ECC2**3/256)*phi
           -(3*ECC2/8+3*ECC2**2/32+45*ECC2**3/1024)*Math.sin(2*phi)
           +(15*ECC2**2/256+45*ECC2**3/1024)*Math.sin(4*phi)
           -(35*ECC2**3/3072)*Math.sin(6*phi));
  const e = E0 + K0*N*(Aa + (1-T+C)*Aa**3/6 + (5-18*T+T*T+72*C-58*EP2)*Aa**5/120);
  const n = K0*(M + N*Math.tan(phi)*(Aa*Aa/2 + (5-T+9*C+4*C*C)*Aa**4/24
                 + (61-58*T+T*T+600*C-330*EP2)*Aa**6/720));
  return {e, n};
}

function utmToLonLat(e, n, zone){
  const lam0=((zone-1)*6-180+3)*D2R;
  const x=e-E0, y=n;
  const M=y/K0;
  const mu=M/(A*(1-ECC2/4-3*ECC2**2/64-5*ECC2**3/256));
  const e1=(1-Math.sqrt(1-ECC2))/(1+Math.sqrt(1-ECC2));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)
              +(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)
              +(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const N1=A/Math.sqrt(1-ECC2*Math.sin(phi1)**2);
  const T1=Math.tan(phi1)**2, C1=EP2*Math.cos(phi1)**2;
  const R1=A*(1-ECC2)/Math.pow(1-ECC2*Math.sin(phi1)**2,1.5);
  const D=x/(N1*K0);
  const phi=phi1-(N1*Math.tan(phi1)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*EP2)*D**4/24
            +(61+90*T1+298*C1+45*T1*T1-252*EP2-3*C1*C1)*D**6/720);
  const lam=lam0+(D-(1+2*T1+C1)*D**3/6
            +(5-2*C1+28*T1-3*C1*C1+8*EP2+24*T1*T1)*D**5/120)/Math.cos(phi1);
  return {lon:lam*R2D, lat:phi*R2D};
}

/* Washington straddles two zones: west is 10, east is 11. The boundary is the
   -120 meridian, and the filename carries the zone only in the newer scheme. */
const utmZone = lon => Math.floor((lon+180)/6)+1;

/* ------------------------------------------------------------ Web Mercator */
const MERC_R = 6378137, MERC_MAX = 20037508.342789244;
const lonLatToMerc = (lon,lat)=>({
  x: lon*D2R*MERC_R,
  y: Math.log(Math.tan(Math.PI/4 + lat*D2R/2))*MERC_R
});
const mercToLonLat = (x,y)=>({
  lon: x/MERC_R*R2D,
  lat: (2*Math.atan(Math.exp(y/MERC_R))-Math.PI/2)*R2D
});
/* pixel edges of an XYZ tile, in Web Mercator metres */
function tileBoundsMerc(z,x,y){
  const n=Math.pow(2,z), s=2*MERC_MAX/n;
  return {minx:-MERC_MAX+x*s, maxx:-MERC_MAX+(x+1)*s,
          maxy: MERC_MAX-y*s, miny: MERC_MAX-(y+1)*s, span:s};
}

module.exports.lonLatToUTM=lonLatToUTM;
module.exports.utmToLonLat=utmToLonLat;
module.exports.utmZone=utmZone;
module.exports.lonLatToMerc=lonLatToMerc;
module.exports.mercToLonLat=mercToLonLat;
module.exports.tileBoundsMerc=tileBoundsMerc;
