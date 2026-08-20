/* Clear Skies Portal — USGS 3DEP 1 m DEM source
   The WA DNR portal serves rendered PNGs with no Content-Length, no ETag and no
   Accept-Ranges, so there is no resume, no progress and no cheap staleness
   check. USGS publishes the same terrain on S3 as COGs that have all three, and
   hands over the actual elevation raster rather than a picture of it — so
   hillshade, slope and contours are computed here, at any zoom, with no
   upsampling artefacts.

   Coverage is real but partial: 25 Washington projects, ~2,548 tiles, ~474 GiB
   against WA DNR's 53 TiB. Mount Rainier National Park is a genuine gap (see
   findCells), which is why WA DNR stays as the fallback.                      */
"use strict";
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const zlib  = require("zlib");
const cog   = require("./cog.js");

const S3_HOST = "prd-tnm.s3.amazonaws.com";
const S3_BASE = "StagedProducts/Elevation/1m/Projects/";
/* Three live filename conventions: USGS_1M_<zone>_x..y.., USGS_1m_x..y..
   and USGS_one_meter_x..y... Guessing between them yields a false negative, so
   filenames are never constructed — a project's TIFF/ prefix is listed once and
   the cell set cached. Only the first form carries a UTM zone. */
const TIF_RE = /^USGS_(?:1[Mm]_(?:(\d+)_)?|one_meter_)x(\d+)y(\d+)_(.+)\.tif$/;

const INDEX_TTL = 30*24*3600*1000;      // the archive changes on a yearly rhythm
/* Which projects to index. "ALL" is every project in the archive (964 of them
   across 51 states); a comma-separated list of state prefixes keeps the index
   small and the first build quick — CSP_USGS_STATES=WA_,OR_,ID_ */
const SCOPE = (process.env.CSP_USGS_STATES || "ALL").trim();
const INDEX_CONCURRENCY = 12;           // S3 listing is latency-bound, not rate-limited
const CELL_M    = 10000;                // 10 km UTM cells

let CACHE_DIR = null;
function init(dir){ CACHE_DIR = dir; try{ fs.mkdirSync(path.join(dir,"usgs"),{recursive:true}) }catch(e){} }

/* ------------------------------------------------------------------- http */
function s3(pathname, headers){
  return new Promise((res,rej)=>{
    const req=https.request({host:S3_HOST, path:pathname, method:"GET",
      headers:Object.assign({"User-Agent":"ClearSkiesPortal/1.0 (local personal use)"},headers||{})},
      r=>{
        const b=[]; r.on("data",d=>b.push(d));
        r.on("end",()=>res({status:r.statusCode, headers:r.headers, body:Buffer.concat(b)}));
      });
    req.on("error",rej);
    req.setTimeout(30000,()=>{ req.destroy(new Error("s3 timeout")) });
    req.end();
  });
}
const s3head = pathname => new Promise((res,rej)=>{
  const req=https.request({host:S3_HOST,path:pathname,method:"HEAD"},r=>{
    r.resume(); r.on("end",()=>res({status:r.statusCode,headers:r.headers}));
  });
  req.on("error",rej); req.setTimeout(20000,()=>req.destroy(new Error("timeout"))); req.end();
});

/* -------------------------------------------------------- project catalogue
   One listing per project, cached on disk. 25 listings is ~20 s cold and then
   free; the alternative is a HEAD per guessed filename, which is what produced
   a wrong "Mt Baker has no coverage" answer. */
let INDEX = null;

function scopeList(){
  if(/^all$/i.test(SCOPE)) return [""];            // empty prefix lists the lot
  return SCOPE.split(",").map(x=>x.trim()).filter(Boolean)
              .map(x=>x.endsWith("_") ? x : x+"_");
}

/* Run fn over items n at a time. The whole-archive build is ~1000 sequential
   round trips otherwise, which is minutes of doing nothing but waiting. */
async function pool(items, n, fn){
  let i=0;
  await Promise.all(Array.from({length:Math.min(n,items.length)}, async()=>{
    while(i<items.length) await fn(items[i++]);
  }));
}

async function listProjects(prefix){
  const out=[]; let tok="";
  do{
    const url=`/?list-type=2&prefix=${S3_BASE}${prefix}&delimiter=/&max-keys=1000`
            + (tok?`&continuation-token=${encodeURIComponent(tok)}`:"");
    const xml=(await s3(url)).body.toString();
    out.push(...[...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)]
      .map(m=>m[1].split("/").filter(Boolean).pop())
      .filter(p=>p && p!==prefix.replace(/\/$/,"")));
    const t=xml.match(/<NextContinuationToken>([^<]+)</); tok=t?t[1]:"";
  }while(tok);
  return out;
}

async function listProjectTiles(proj){
  const cells={}; let zone=null, tok="";
  do{
    const url=`/?list-type=2&prefix=${S3_BASE}${proj}/TIFF/&max-keys=1000`
            + (tok?`&continuation-token=${encodeURIComponent(tok)}`:"");
    const xml=(await s3(url)).body.toString();
    const keys=[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m=>m[1]);
    const sizes=[...xml.matchAll(/<Size>(\d+)<\/Size>/g)].map(m=>+m[1]);
    keys.forEach((k,i)=>{
      const f=k.split("/").pop(), m=f.match(TIF_RE);
      if(!m) return;
      if(m[1]) zone=+m[1];
      cells[`x${m[2]}y${m[3]}`]={f, size:sizes[i]||0};
    });
    const t=xml.match(/<NextContinuationToken>([^<]+)</); tok=t?t[1]:"";
  }while(tok);
  return {cells, zone};
}

function indexPath(){ return path.join(CACHE_DIR,"usgs","index.json") }

async function buildIndex(states, force){
  const f=indexPath();
  if(!force){
    try{
      const st=fs.statSync(f);
      if(Date.now()-st.mtimeMs < INDEX_TTL){ INDEX=JSON.parse(fs.readFileSync(f,"utf8")); return INDEX }
    }catch(e){}
  }
  if(INDEX && !force) return INDEX;
  const out={built:Date.now(), scope:(states||scopeList()).join(",")||"ALL", projects:{}};
  const names=[];
  for(const st of (states||scopeList())) names.push(...await listProjects(st));
  const uniq=[...new Set(names)].filter(Boolean);
  let done=0, failed=0;
  await pool(uniq, INDEX_CONCURRENCY, async p=>{
    try{
      const {cells,zone}=await listProjectTiles(p);
      if(Object.keys(cells).length) out.projects[p]={zone, cells};
    }catch(e){ failed++ }                 // one unreachable project must not sink the build
    if(++done % 100 === 0 || done===uniq.length)
      console.log(`  usgs index: ${done}/${uniq.length} projects` + (failed?` (${failed} failed)`:""));
  });
  out.failed=failed;
  INDEX=out;
  try{ fs.writeFileSync(f, JSON.stringify(out)) }catch(e){}
  return out;
}
async function getIndex(){ return INDEX || buildIndex(null) }

/* A project's flight year, for preferring newer data. The name is the only
   place it appears; several carry two (2019_D20 = flown 2019, delivered 2020). */
function projectYear(name){
  const ys=[...name.matchAll(/(?:^|_)((?:19|20)\d{2})(?:_|$)/g)].map(m=>+m[1]);
  if(ys.length) return Math.max(...ys);
  const b=name.match(/_[A-Z](\d{2})$/);            // ..._B21, ..._D22
  return b ? 2000+ +b[1] : 0;
}

/* --------------------------------------------------------------- cell math
   Verified against the tiepoints of both filename conventions: cell x,y has its
   WEST edge at x*10000 and its NORTH edge at y*10000, with a 6 px margin
   (origin comes back as x*10000-6, y*10000+6). Using floor() on the northing
   instead of ceil() puts you one 10 km cell too far south. */
const cellOf = (e,n) => `x${Math.floor(e/CELL_M)}y${Math.ceil(n/CELL_M)}`;

/* UTM zone from a projected EPSG code: WGS84 north is 326xx, NAD83 is 269xx. */
const zoneOfEpsg = e => (e>=32601&&e<=32660) ? e-32600
                      : (e>=26901&&e<=26923) ? e-26900 : null;

/* A cell key is only unique inside its UTM zone, so x59y519 in Washington and
   x59y519 in Maine are different places with the same name. Two thirds of the
   archive names files without a zone, and plenty of projects straddle a zone
   boundary, so the zone is read per cell out of the GeoTIFF that claims it.
   That header is the one renderTile needs anyway, and both it and the answer
   are cached, so it is paid once. A file we cannot parse stays unknown and is
   left in — renderTile's own EPSG check is the backstop for those. */
const ZONES = new Map();                  // "project/cell" -> zone | null, on demand
let ZONES_LOADED = false;
function zonesPath(){ return path.join(CACHE_DIR,"usgs","zones.json") }
function loadZones(){
  if(ZONES_LOADED) return; ZONES_LOADED=true;
  try{ const o=JSON.parse(fs.readFileSync(zonesPath(),"utf8"));
       for(const k in o) ZONES.set(k, o[k]); }catch(e){}
}
function saveZones(){
  try{ fs.writeFileSync(zonesPath(), JSON.stringify(Object.fromEntries(ZONES))) }catch(e){}
}

async function resolveCellZone(proj, file){
  try{
    const t=await openCog(`${S3_BASE}${proj}/TIFF/${file}`);
    return zoneOfEpsg(t.geo && t.geo.epsg);
  }catch(e){ return null }
}
function cellBounds(cell){
  const m=cell.match(/x(\d+)y(\d+)/);
  const x=+m[1], y=+m[2];
  return {w:x*CELL_M, e:(x+1)*CELL_M, n:y*CELL_M, s:(y-1)*CELL_M};
}

/* Projects holding this cell in this zone, newest first. The point lookup and
   the renderer both go through here, so they cannot disagree about coverage. */
async function cellCandidates(idx, cell, zone){
  loadZones();
  const out=[]; let dirty=false;
  for(const p in idx.projects){
    const pr=idx.projects[p];
    if(pr.zone && pr.zone!==zone) continue;          // known zone must match
    const c=pr.cells[cell];
    if(!c) continue;
    let z=pr.zone;
    if(z==null){
      const k=`${p}/${cell}`;
      if(ZONES.has(k)) z=ZONES.get(k);
      else { z=await resolveCellZone(p,c.f); ZONES.set(k,z); dirty=true; }
      if(z!=null && z!==zone) continue;              // same cell name, different zone
    }
    out.push({project:p, cell, zone:z||zone, file:c.f, size:c.size, year:projectYear(p)});
  }
  if(dirty) saveZones();
  out.sort((a,b)=>b.year-a.year || b.size-a.size);
  return out;
}

/* Which projects hold the cell containing this point, newest first. */
async function findCells(lon, lat){
  const idx=await getIndex();
  const zone=cog.utmZone(lon);
  const u=cog.lonLatToUTM(lon,lat,zone);
  const cell=cellOf(u.e,u.n);
  const hits=await cellCandidates(idx, cell, zone);
  return {zone, easting:u.e, northing:u.n, cell, hits};
}

const tileKey = h => `${S3_BASE}${h.project}/TIFF/${h.file}`;
const tileUrl = h => "/"+tileKey(h);

/* ------------------------------------------------- byte ranges, cached
   The whole point of this source: ranges work, so only the tiles actually
   needed are fetched, and a partial download resumes. */
function rangePath(key, a, b){
  const h=require("crypto").createHash("sha1").update(key+":"+a+"-"+b).digest("hex");
  return path.join(CACHE_DIR,"usgs",h);
}
async function fetchRange(key, a, b){
  const f=rangePath(key,a,b);
  try{ const buf=fs.readFileSync(f); if(buf.length===b-a+1) return {buf, cached:true} }catch(e){}
  const r=await s3("/"+key,{Range:`bytes=${a}-${b}`});
  if(r.status!==206 && r.status!==200) throw new Error("range "+r.status);
  try{ fs.writeFileSync(f, r.body) }catch(e){}
  return {buf:r.body, cached:false};
}

/* -------------------------------------------------------------- COG access */
const HDR_BYTES = 262144;                 // IFD chain + tile tables live up front
const headers = new Map();                // key -> parsed tiff
const decoded = new Map();                // key|lvl|idx -> Float32Array (LRU)
const DECODE_MAX = 48;

async function openCog(key){
  if(headers.has(key)) return headers.get(key);
  const {buf}=await fetchRange(key, 0, HDR_BYTES-1);
  const t=cog.parseTiff(buf);
  headers.set(key,t);
  return t;
}
function lru(k,v){
  decoded.set(k,v);
  if(decoded.size>DECODE_MAX) decoded.delete(decoded.keys().next().value);
}
async function cogTile(key, t, lvl, tx, ty){
  const ck=`${key}|${lvl}|${tx},${ty}`;
  if(decoded.has(ck)){ const v=decoded.get(ck); decoded.delete(ck); decoded.set(ck,v); return v }
  const L=t.levels[lvl];
  const across=Math.ceil(L.w/L.tw);
  const idx=ty*across+tx;
  if(idx<0 || idx>=L.offsets.length) return null;
  const off=L.offsets[idx], cnt=L.counts[idx];
  if(!cnt) return null;
  const {buf}=await fetchRange(key, off, off+cnt-1);
  const px=cog.decodeTile(buf,L);
  lru(ck,px);
  return px;
}

/* ------------------------------------------------------------ PNG encoder */
let CRCT=null;
function crcTable(){
  if(CRCT) return CRCT;
  CRCT=new Int32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xedb88320^(c>>>1) : c>>>1; CRCT[n]=c }
  return CRCT;
}
function crc32(buf){
  const t=crcTable(); let c=0xffffffff;
  for(let i=0;i<buf.length;i++) c=t[(c^buf[i])&0xff]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function chunk(type, data){
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
  const td=Buffer.concat([Buffer.from(type,"ascii"), data]);
  const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(td),0);
  return Buffer.concat([len,td,crc]);
}
/* RGBA8 -> PNG */
function encodePNG(rgba, w, h){
  const raw=Buffer.alloc((w*4+1)*h);
  for(let y=0;y<h;y++){
    raw[y*(w*4+1)]=0;                                   // filter: none
    rgba.copy(raw, y*(w*4+1)+1, y*w*4, (y+1)*w*4);
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR",ihdr),
    chunk("IDAT",zlib.deflateSync(raw,{level:6})),
    chunk("IEND",Buffer.alloc(0))
  ]);
}

/* -------------------------------------------------------------- rendering */
/* Sentinel for 'no elevation here'. Math.fround matters: the grid is a
   Float32Array, so a plain -1e30 double does not survive the round-trip and
   every `=== NODATA` comparison silently fails. */
const NODATA = Math.fround(-1e30);

/* Sample a (w+2)x(h+2) elevation grid covering one slippy tile, with a one
   pixel skirt so the hillshade kernel has neighbours at the tile edge — this
   is what stops seams appearing between adjacent tiles. */
async function sampleGrid(z,x,y,size){
  const b=cog.tileBoundsMerc(z,x,y);
  const n=size+2;
  const grid=new Float32Array(n*n).fill(NODATA);
  const step=b.span/size;

  const mid=cog.mercToLonLat((b.minx+b.maxx)/2,(b.miny+b.maxy)/2);
  const zone=cog.utmZone(mid.lon);
  const groundRes=step*Math.cos(mid.lat*Math.PI/180);       // merc metres -> ground metres

  /* Walk the perimeter rather than just the corners: merc->UTM is not affine,
     and a rotated footprint would otherwise clip at the edges. */
  let minE=Infinity,maxE=-Infinity,minN=Infinity,maxN=-Infinity;
  const cells=new Set();
  for(let i=0;i<=16;i++){
    const f=i/16;
    for(const [mx,my] of [[b.minx+f*b.span,b.miny],[b.minx+f*b.span,b.maxy],
                          [b.minx,b.miny+f*b.span],[b.maxx,b.miny+f*b.span]]){
      const ll=cog.mercToLonLat(mx,my);
      const u=cog.lonLatToUTM(ll.lon,ll.lat,zone);
      minE=Math.min(minE,u.e); maxE=Math.max(maxE,u.e);
      minN=Math.min(minN,u.n); maxN=Math.max(maxN,u.n);
      cells.add(cellOf(u.e,u.n));
    }
  }
  const pad=groundRes*3;
  minE-=pad; maxE+=pad; minN-=pad; maxN+=pad;
  for(const c of [[minE,minN],[maxE,minN],[minE,maxN],[maxE,maxN]]) cells.add(cellOf(c[0],c[1]));

  const idx=await getIndex();
  const srcs=[];
  for(const cell of cells){
    const cands=await cellCandidates(idx, cell, zone);
    if(cands.length) srcs.push(cands);              // fallbacks kept, best first
  }
  if(!srcs.length) return null;

  /* Choose the finest overview that is still no COARSER than what is being
     asked for. Picking a coarser level upsamples, and the floor() quantisation
     that follows shows up as a cross-hatch once the hillshade takes gradients
     of it. Downsampling is safe; upsampling is not. */
  const opened=[];
  const PER_CELL = 3;
  for(const group of srcs){
    /* Newest first, but the winner may be in the wrong projection, not be a
       tiled COG at all, or simply be nodata here — a 10 km cell is a bounding
       box, not a promise of data. Keep a couple of fallbacks so the sampler
       below can fall through to them. */
    let got=0;
    for(const s of group){
      const key=tileKey(s);
      let t; try{ t=await openCog(key) }catch(e){ continue }
      if(t.geo.epsg && t.geo.epsg!==26900+zone && t.geo.epsg!==32600+zone) continue;
      const base=t.geo.scale[0]||1;
      let lvl=0;
      for(let i=0;i<t.levels.length;i++){
        if(base*Math.pow(2,i) <= groundRes) lvl=i; else break;
      }
      opened.push({s,key,t,lvl,res:base*Math.pow(2,lvl),
                   ox:t.geo.tie[3], oy:t.geo.tie[4], nodata:t.geo.nodata, tiles:new Map()});
      if(++got>=PER_CELL) break;
    }
  }
  if(!opened.length) return null;

  /* Prefetch every COG tile the window touches, in parallel, then sample
     synchronously. Per-pixel awaits would serialise ~66k round trips. */
  for(const o of opened){
    const L=o.t.levels[o.lvl];
    const px0=Math.floor((minE-o.ox)/o.res), px1=Math.ceil((maxE-o.ox)/o.res);
    const py0=Math.floor((o.oy-maxN)/o.res), py1=Math.ceil((o.oy-minN)/o.res);
    const tx0=Math.max(0,Math.floor(px0/L.tw)), tx1=Math.min(Math.ceil(L.w/L.tw)-1,Math.floor(px1/L.tw));
    const ty0=Math.max(0,Math.floor(py0/L.th)), ty1=Math.min(Math.ceil(L.h/L.th)-1,Math.floor(py1/L.th));
    const jobs=[];
    for(let ty=ty0; ty<=ty1; ty++) for(let tx=tx0; tx<=tx1; tx++)
      jobs.push(cogTile(o.key,o.t,o.lvl,tx,ty)
        .then(a=>{ if(a) o.tiles.set(tx+","+ty,a) }).catch(()=>{}));
    await Promise.all(jobs);
  }

  /* Bilinear, so a half-pixel offset does not read as a terrace. */
  const at=(o,px,py)=>{
    const L=o.t.levels[o.lvl];
    if(px<0||py<0||px>=L.w||py>=L.h) return NaN;
    const a=o.tiles.get(Math.floor(px/L.tw)+","+Math.floor(py/L.th));
    if(!a) return NaN;
    const v=a[(py%L.th)*L.tw + (px%L.tw)];
    if(v===undefined || v<-1e5 || (o.nodata!=null && v===o.nodata)) return NaN;
    return v;
  };
  const bilinear=(o,e,nn)=>{
    const fx=(e-o.ox)/o.res - 0.5, fy=(o.oy-nn)/o.res - 0.5;
    const x0=Math.floor(fx), y0=Math.floor(fy);
    const dx=fx-x0, dy=fy-y0;
    const v00=at(o,x0,y0), v10=at(o,x0+1,y0), v01=at(o,x0,y0+1), v11=at(o,x0+1,y0+1);
    if(Number.isNaN(v00)||Number.isNaN(v10)||Number.isNaN(v01)||Number.isNaN(v11)){
      const f=[v00,v10,v01,v11].find(v=>!Number.isNaN(v));   // edge of coverage
      return f===undefined ? NaN : f;
    }
    return v00*(1-dx)*(1-dy) + v10*dx*(1-dy) + v01*(1-dx)*dy + v11*dx*dy;
  };

  let filled=0;
  for(let gy=0; gy<n; gy++){
    const my=b.maxy - (gy-1+0.5)*step;
    for(let gx=0; gx<n; gx++){
      const mx=b.minx + (gx-1+0.5)*step;
      const ll=cog.mercToLonLat(mx,my);
      const u=cog.lonLatToUTM(ll.lon,ll.lat,zone);
      for(const o of opened){
        const v=bilinear(o,u.e,u.n);
        if(Number.isNaN(v)) continue;
        grid[gy*n+gx]=v; filled++;
        break;
      }
    }
  }
  if(!filled) return null;
  return {grid, n, size, groundRes, coverage:filled/(n*n),
          sources:opened.filter(o=>o.tiles.size).map(o=>({project:o.s.project, cell:o.s.cell,
                    key:o.key, level:o.lvl, res:+o.res.toFixed(2), cogTiles:o.tiles.size}))};
}

/* Horn's 3x3 gradient — the same estimator ArcGIS and GDAL use, so the result
   is comparable to the 3DEP and WA DNR renders it sits beside. */
function gradient(g,n,i,j,res){
  const at=(r,c)=>{
    const v=g[Math.min(n-1,Math.max(0,r))*n + Math.min(n-1,Math.max(0,c))];
    return v===NODATA ? NaN : v;
  };
  const a=at(i-1,j-1), b=at(i-1,j), c=at(i-1,j+1);
  const d=at(i,j-1),   f=at(i,j+1);
  const gg=at(i+1,j-1),h=at(i+1,j), k=at(i+1,j+1);
  if([a,b,c,d,f,gg,h,k].some(Number.isNaN)) return null;
  return { dzdx:((c+2*f+k)-(a+2*d+gg))/(8*res),
           dzdy:((gg+2*h+k)-(a+2*b+c))/(8*res) };
}

const D2R=Math.PI/180;
function shade(dzdx,dzdy,azDeg,altDeg,zf){
  const slope=Math.atan(zf*Math.hypot(dzdx,dzdy));
  const aspect=Math.atan2(dzdy,-dzdx);
  const az=(90-azDeg)*D2R, alt=altDeg*D2R;
  const v=Math.sin(alt)*Math.cos(slope) + Math.cos(alt)*Math.sin(slope)*Math.cos(az-aspect);
  return Math.max(0,Math.min(1,v));
}

const TINT=[[0,[ 60,102, 70]],[300,[ 96,132, 78]],[800,[150,158, 96]],
            [1400,[186,158,110]],[2000,[176,140,120]],[2600,[200,200,204]],
            [3400,[238,242,248]],[4500,[255,255,255]]];
function tintOf(v){
  if(v<=TINT[0][0]) return TINT[0][1];
  for(let i=1;i<TINT.length;i++){
    if(v<=TINT[i][0]){
      const [v0,c0]=TINT[i-1], [v1,c1]=TINT[i];
      const f=(v-v0)/(v1-v0);
      return [0,1,2].map(k=>Math.round(c0[k]+(c1[k]-c0[k])*f));
    }
  }
  return TINT[TINT.length-1][1];
}

const CONTOUR_FT = { c2:2, c5:5, c10:10, c25:25 };
const MIN_CONTOUR_PX = 3;     // closer than this and adjacent lines merge

function render(style, S){
  const {grid,n,size,groundRes}=S;
  const out=Buffer.alloc(size*size*4);
  const zf=1;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const i=y+1, j=x+1;
    const v=grid[i*n+j];
    const o=(y*size+x)*4;
    if(v===NODATA){ out[o+3]=0; continue }
    let r=0,g=0,b=0,a=255;

    if(style in CONTOUR_FT){
      const gr=gradient(grid,n,i,j,groundRes);
      if(!gr){ out[o+3]=0; continue }
      const ft=v*3.28084;
      let iv=CONTOUR_FT[style];
      const perPx=Math.hypot(gr.dzdx,gr.dzdy)*groundRes*3.28084;  // feet crossed per pixel
      /* Thin adaptively. A 10 ft interval over 700 m of alpine relief is ~230
         lines in one tile, which reads as mud rather than as contours. Promote
         to the index interval where they would collide, and drop out entirely
         where even those would — better to draw nothing than to draw a smear. */
      if(perPx>0){
        const spacing=iv/perPx;                       // pixels between neighbours
        if(spacing<MIN_CONTOUR_PX){
          if(spacing*5>=MIN_CONTOUR_PX) iv*=5;
          else { out[o+3]=0; continue }
        }
      }
      const k=ft/iv;
      const d=Math.abs(k-Math.round(k))*iv;
      const w=Math.max(0.35, Math.min(iv*0.5, perPx*0.7));
      if(d>=w){ out[o+3]=0; continue }
      const isIndex=Math.round(k)%5===0;
      out[o]=isIndex?120:150; out[o+1]=isIndex?70:110; out[o+2]=isIndex?40:80;
      out[o+3]=isIndex?255:200;
      continue;
    }

    const gr=gradient(grid,n,i,j,groundRes);
    if(!gr){ out[o+3]=0; continue }

    if(style==="slope"){
      const deg=Math.atan(Math.hypot(gr.dzdx,gr.dzdy))/D2R;
      const t=Math.max(0,Math.min(1,deg/60));
      r=Math.round(40+215*t); g=Math.round(180-150*t); b=Math.round(90-60*t);
    }else if(style==="aspect"){
      let asp=Math.atan2(gr.dzdy,-gr.dzdx)/D2R; if(asp<0) asp+=360;
      const h=asp/360, s=0.55, l=0.55;
      const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
      const hk=[h+1/3,h,h-1/3].map(t=>{ t=(t+1)%1;
        return t<1/6?p+(q-p)*6*t : t<0.5?q : t<2/3?p+(q-p)*(2/3-t)*6 : p; });
      [r,g,b]=hk.map(c=>Math.round(c*255));
    }else if(style==="hsmulti"){
      // four luminaires, weighted as in the standard multi-directional recipe
      const w=[0.25,0.25,0.25,0.25], az=[315,45,135,225];
      let s=0; for(let q=0;q<4;q++) s+=w[q]*shade(gr.dzdx,gr.dzdy,az[q],45,zf);
      const g8=Math.round(Math.max(0,Math.min(1,s*1.15))*255); r=g=b=g8;
    }else if(style==="tint"){
      const s=shade(gr.dzdx,gr.dzdy,315,45,zf);
      const c=tintOf(v); const m=0.45+0.55*s;
      r=Math.round(c[0]*m); g=Math.round(c[1]*m); b=Math.round(c[2]*m);
    }else{                                            // hs
      const g8=Math.round(shade(gr.dzdx,gr.dzdy,315,45,zf)*255); r=g=b=g8;
    }
    out[o]=r; out[o+1]=g; out[o+2]=b; out[o+3]=a;
  }
  return encodePNG(out,size,size);
}

async function renderTile(style,z,x,y,size){
  const S=await sampleGrid(z,x,y,size||256);
  if(!S) return null;
  return {png:render(style,S), meta:{coverage:+S.coverage.toFixed(3), groundRes:+S.groundRes.toFixed(2),
                                     sources:S.sources}};
}

/* --------------------------------------------------- freshness, done right
   These objects carry ETag and Last-Modified, so staleness is a HEAD away and
   the catalogue-diff used for WA DNR is unnecessary here. */
async function checkFresh(entries){
  const out=[];
  for(const e of entries){
    try{
      const h=await s3head("/"+e.key);
      out.push({key:e.key, ok:h.status===200,
                etag:(h.headers.etag||"").replace(/"/g,""),
                changed: !!e.etag && (h.headers.etag||"").replace(/"/g,"")!==e.etag,
                size:+(h.headers["content-length"]||0),
                lastModified:h.headers["last-modified"]||null});
    }catch(err){ out.push({key:e.key, ok:false, error:String(err.message||err)}) }
  }
  return out;
}

/* ------------------------------------------------------ area download
   Rendered tiles and the byte ranges behind them both land in the cache, so a
   download that is stopped and restarted skips whatever already arrived —
   resume falls out of the range cache rather than needing its own bookkeeping.
   The manifest records each source COG's ETag, which is what makes the
   catalogue-diff staleness check unnecessary for this source. */
const warm = {running:false, stop:false, total:0, done:0, ok:0, skipped:0, bytes:0, label:"", error:""};
const warmState = () => ({running:warm.running, total:warm.total, done:warm.done, ok:warm.ok,
                          skipped:warm.skipped, bytes:warm.bytes, label:warm.label, error:warm.error});
function stopWarm(){ warm.stop=true; return warmState() }

function areasDir(){ const d=path.join(CACHE_DIR,"usgs","areas");
  try{ fs.mkdirSync(d,{recursive:true}) }catch(e){} return d }
function areaList(){
  try{
    return fs.readdirSync(areasDir()).filter(f=>f.endsWith(".json")).map(f=>{
      try{ return JSON.parse(fs.readFileSync(path.join(areasDir(),f),"utf8")) }catch(e){ return null }
    }).filter(Boolean).sort((a,b)=>(b.created||0)-(a.created||0));
  }catch(e){ return [] }
}
function areaSave(a){
  try{ fs.writeFileSync(path.join(areasDir(), a.id+".json"), JSON.stringify(a,null,1)) }catch(e){}
}

function tileRange(bbox,z){                        // bbox = [w,s,e,n] degrees
  const [w,s,e,n]=bbox, N=Math.pow(2,z);
  const xt=lon=>Math.floor((lon+180)/360*N);
  const yt=lat=>Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*N);
  return {x0:Math.max(0,xt(w)), x1:Math.min(N-1,xt(e)), y0:Math.max(0,yt(n)), y1:Math.min(N-1,yt(s))};
}
function planTiles(bbox,z0,z1){
  const out=[];
  for(let z=z0; z<=z1; z++){
    const r=tileRange(bbox,z);
    for(let x=r.x0;x<=r.x1;x++) for(let y=r.y0;y<=r.y1;y++) out.push({z,x,y});
  }
  return out;
}

/* Which COGs underlie an area. Derived from the bbox rather than from whatever
   the run happened to fetch — otherwise a fully-resumed download (every tile a
   cache hit) would record no sources and quietly wipe the ETag baseline. */
async function sourcesForArea(bbox){
  const [w,s,e,n]=bbox;
  const idx=await getIndex();
  const keys=new Map();
  const STEPS=6;
  for(let i=0;i<=STEPS;i++) for(let j=0;j<=STEPS;j++){
    const lon=w+(e-w)*i/STEPS, lat=s+(n-s)*j/STEPS;
    const zone=cog.utmZone(lon);
    const uu=cog.lonLatToUTM(lon,lat,zone);
    const cell=cellOf(uu.e,uu.n);
    const cands=[];
    for(const p in idx.projects){
      const pr=idx.projects[p];
      if(pr.zone && pr.zone!==zone) continue;
      const c=pr.cells[cell];
      if(c) cands.push({project:p, cell, file:c.f, size:c.size, year:projectYear(p)});
    }
    cands.sort((q,r)=>r.year-q.year || r.size-q.size);
    if(cands[0]) keys.set(tileKey(cands[0]), cands[0]);
  }
  return [...keys.keys()];
}

async function startWarm(job, tileCache){
  const bbox=job.bbox, z0=Math.max(1,job.z0|0), z1=Math.min(20,job.z1|0);
  const style=String(job.style||"hs");
  const tiles=planTiles(bbox,z0,z1);
  Object.assign(warm,{running:true, stop:false, total:tiles.length, done:0, ok:0,
                      skipped:0, bytes:0, label:`z${z0}-${z1} ${style}`, error:""});
  const usedKeys=new Set();
  const worker=async()=>{
    while(tiles.length && !warm.stop){
      const t=tiles.pop(); if(!t) break;
      try{
        const pre = tileCache && tileCache.get(style,t.z,t.x,t.y);
        if(pre){ warm.skipped++; warm.bytes+=pre.length; }
        else{
          const r=await renderTile(style,t.z,t.x,t.y,256);
          if(r){
            warm.ok++; warm.bytes+=r.png.length;
            r.meta.sources.forEach(sc=>usedKeys.add(sc.key));
            if(tileCache) tileCache.put(style,t.z,t.x,t.y,r.png);
          }
        }
      }catch(e){ warm.error=String(e.message||e) }
      warm.done++;
    }
  };
  await Promise.all(Array.from({length:4}, worker));
  warm.running=false;
  if(!warm.stop && (warm.ok||warm.skipped)){
    const sources=[];
    let keys;
    try{ keys=await sourcesForArea(bbox) }catch(e){ keys=[...usedKeys] }
    for(const k of new Set([...keys, ...usedKeys])){
      try{
        const h=await s3head("/"+k);
        sources.push({key:k, etag:(h.headers.etag||"").replace(/"/g,""),
                      size:+(h.headers["content-length"]||0),
                      lastModified:h.headers["last-modified"]||null});
      }catch(e){ sources.push({key:k}) }
    }
    areaSave({
      id: require("crypto").createHash("sha1")
            .update(JSON.stringify([bbox,z0,z1,style])).digest("hex").slice(0,12),
      source:"usgs1m", label: job.label || `z${z0}-${z1}`,
      bbox, z0, z1, style, tiles:warm.total, ok:warm.ok, skipped:warm.skipped,
      bytes:warm.bytes, created:Date.now(), checked:Date.now(),
      sources, stale:false, changed:[]
    });
  }
  warm.stop=false;
}

/* Re-HEAD each recorded COG and compare. A changed ETag means the tile was
   re-issued; unlike the WA DNR path this needs no catalogue diff. */
async function areaCheck(a){
  const now=await checkFresh(a.sources||[]);
  const changed=now.filter(r=>r.changed);
  const out={...a, checked:Date.now(), changed, stale:changed.length>0,
             checkFailed: now.some(r=>!r.ok)};
  areaSave(out);
  return out;
}

module.exports.warmState=warmState;
module.exports.startWarm=startWarm;
module.exports.stopWarm=stopWarm;
module.exports.areaList=areaList;
module.exports.areaCheck=areaCheck;
module.exports.planTiles=planTiles;
module.exports.sourcesForArea=sourcesForArea;

module.exports = Object.assign(module.exports, { init, buildIndex, getIndex, findCells, cellOf, cellBounds, projectYear, scopeList,
                   openCog, cogTile, fetchRange, renderTile, sampleGrid, encodePNG,
                   checkFresh, tileKey, tileUrl, s3head, S3_BASE });
