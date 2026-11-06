#!/usr/bin/env node
/* Frozen L1 goldens for the native core (docs/native/ARCHITECTURE.md §6).

   Writes small TIFFs covering the shapes the engine meets in the wild (USGS
   tiled LZW with the floating-point predictor, stripped 1 m products,
   BigTIFF, a directory at the end of the file, big-endian files, integer
   DEMs) plus a manifest of what each must decode to. The expected samples
   are the generator's own ground truth, not cog.js output; each case also
   records whether today's cog.js reproduces it, so the Rust port is held to
   the truth and the JS gaps are written down rather than copied.

   Run once to freeze: node native/fixtures/generate.js
   The committed files are the contract. Re-running rewrites them; review
   the diff (zlib output may differ across Node versions, which is fine as
   long as the decoded hashes do not change).                              */
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib"), crypto = require("crypto");
const cog = require("../../cog.js");

const OUT = path.join(__dirname, "tiff");

/* ------------------------------------------------------------ sample data */
function dem(w, h, kind, seed){
  let s = seed;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x80000000;
  const out = new Float64Array(w * h);
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
    const v = 1000 + 50 * Math.sin(x / 7) + 30 * Math.cos(y / 5) + rnd() * 0.25;
    out[y * w + x] = kind === "f32" ? Math.fround(v)
      : kind === "i16" ? Math.round(v - 1100)            // crosses zero: signed wraps matter
      : kind === "u16" ? Math.round(v * 10)
      : kind === "u8"  ? Math.round(v) & 255
      : v;
  }
  return out;
}
const SAMPLE = {f32:{bps:32,sf:3}, i16:{bps:16,sf:2}, u16:{bps:16,sf:1}, u8:{bps:8,sf:1}};

/* ------------------------------------------------------- TIFF-LZW encoder */
function lzwEncode(data){
  const bytes = []; let buf = 0, cnt = 0, width = 9;
  const put = code => { buf = (buf << width) | code; cnt += width;
    while(cnt >= 8){ bytes.push((buf >>> (cnt - 8)) & 0xff); cnt -= 8 } buf &= (1 << cnt) - 1 };
  let dict = new Map(), next = 258;
  put(256);
  if(!data.length){ put(257); if(cnt > 0) bytes.push((buf << (8 - cnt)) & 0xff); return Buffer.from(bytes) }
  let w = String.fromCharCode(data[0]);
  for(let i = 1; i < data.length; i++){
    const c = String.fromCharCode(data[i]), wc = w + c;
    if(dict.has(wc)){ w = wc; continue }
    put(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
    dict.set(wc, next++);
    if(next >= (1 << width) && width < 12) width++;
    if(next >= 4094){ put(256); dict = new Map(); next = 258; width = 9 }
    w = c;
  }
  put(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
  put(257);
  if(cnt > 0) bytes.push((buf << (8 - cnt)) & 0xff);
  return Buffer.from(bytes);
}

/* ------------------------------------------------- encode one tile/strip */
function encodeBlock(values, bw, bh, lv, le){
  const {bps, pred, comp} = lv, B = bps / 8, raw = Buffer.alloc(bw * bh * B);
  const write = (v, o) => {
    if(lv.sf === 3) le ? raw.writeFloatLE(v, o) : raw.writeFloatBE(v, o);
    else if(B === 1) raw[o] = v & 255;
    else if(B === 2) lv.sf === 2 ? (le ? raw.writeInt16LE(v, o) : raw.writeInt16BE(v, o))
                                 : (le ? raw.writeUInt16LE(v, o) : raw.writeUInt16BE(v, o));
  };
  if(pred === 3){
    /* Floating-point predictor: each float's bytes split into planes, most
       significant plane first, regardless of file byte order; then the row
       bytes are horizontally differenced. */
    const row = Buffer.alloc(bw * B);
    for(let y = 0; y < bh; y++){
      for(let x = 0; x < bw; x++){
        const f = Buffer.alloc(4); f.writeFloatBE(values[y * bw + x], 0);
        for(let b = 0; b < B; b++) row[b * bw + x] = f[b];
      }
      for(let i = row.length - 1; i >= 1; i--) row[i] = (row[i] - row[i - 1]) & 0xff;
      row.copy(raw, y * bw * B);
    }
  }else{
    for(let y = 0; y < bh; y++){
      const r = Array.from(values.subarray(y * bw, (y + 1) * bw));
      if(pred === 2){
        const mod = 2 ** bps;
        for(let x = bw - 1; x >= 1; x--){
          let d = (r[x] - r[x - 1]) % mod; if(d < 0) d += mod;
          r[x] = lv.sf === 2 && d >= mod / 2 ? d - mod : d;   // back into the signed range
        }
      }
      for(let x = 0; x < bw; x++) write(r[x], (y * bw + x) * B);
    }
  }
  if(comp === 1) return raw;
  if(comp === 5) return lzwEncode(raw);
  if(comp === 8 || comp === 32946) return zlib.deflateSync(raw);
  throw new Error("comp " + comp);
}

/* What a block decodes to: its samples as float32, outside the image zero
   (TIFF pads edge tiles; a short last strip is padded to full height). */
function expectedBlock(img, w, h, bx, by, bw, bh, kind){
  const out = new Float32Array(bw * bh);
  for(let y = 0; y < bh; y++) for(let x = 0; x < bw; x++){
    const X = bx + x, Y = by + y;
    out[y * bw + x] = X < w && Y < h ? img[Y * w + X] : 0;
  }
  return out;
}
function blockValues(img, w, h, bx, by, bw, bh){
  const out = new Float64Array(bw * bh);
  for(let y = 0; y < bh; y++) for(let x = 0; x < bw; x++){
    const X = bx + x, Y = by + y;
    out[y * bw + x] = X < w && Y < h ? img[Y * w + X] : 0;
  }
  return out;
}

/* -------------------------------------------------------------- TIFF file */
const T = {SHORT:3, LONG:4, ASCII:2, DOUBLE:12, LONG8:16};
const TYPE_BYTES = {2:1, 3:2, 4:4, 12:8, 16:8};

function buildTiff(spec){
  const {le, big} = spec;
  const levels = spec.levels.map((lv, i) => {
    const w = lv.w, h = lv.h, {bps, sf} = SAMPLE[lv.kind];
    const L = {...lv, bps, sf};
    const img = dem(w, h, lv.kind, 17 + i * 101 + (spec.seed || 0));
    const blocks = [], expect = [];
    if(lv.strip){
      const rows = lv.strip;
      for(let by = 0; by < h; by += rows){
        const bh = Math.min(rows, h - by);
        blocks.push(encodeBlock(blockValues(img, w, h, 0, by, w, bh), w, bh, L, le));
        expect.push(expectedBlock(img, w, h, 0, by, w, rows, lv.kind));
      }
    }else{
      for(let by = 0; by < h; by += lv.th) for(let bx = 0; bx < w; bx += lv.tw){
        blocks.push(encodeBlock(blockValues(img, w, h, bx, by, lv.tw, lv.th), lv.tw, lv.th, L, le));
        expect.push(expectedBlock(img, w, h, bx, by, lv.tw, lv.th, lv.kind));
      }
    }
    return {L, blocks, expect};
  });

  /* Each IFD's entries; offsets/counts are filled once data is placed. */
  const ifds = levels.map(({L, blocks}, i) => {
    const e = [];
    const add = (tag, type, values) => e.push({tag, type, values});
    if(i > 0) add(254, T.LONG, [1]);
    add(256, T.LONG, [L.w]); add(257, T.LONG, [L.h]);
    add(258, T.SHORT, [L.bps]); add(259, T.SHORT, [L.comp]); add(262, T.SHORT, [1]);
    add(277, T.SHORT, [1]); add(284, T.SHORT, [1]);
    if(L.pred !== 1) add(317, T.SHORT, [L.pred]);
    add(339, T.SHORT, [L.sf]);
    const off = big ? T.LONG8 : T.LONG;
    if(L.strip){
      add(273, off, blocks.map(() => 0)); add(278, T.LONG, [L.strip]); add(279, off, blocks.map(b => b.length));
    }else{
      add(322, T.SHORT, [L.tw]); add(323, T.SHORT, [L.th]);
      add(324, off, blocks.map(() => 0)); add(325, off, blocks.map(b => b.length));
    }
    if(i === 0 && spec.geo){
      const g = spec.geo;
      add(33550, T.DOUBLE, g.scale); add(33922, T.DOUBLE, g.tie);
      add(34735, T.SHORT, [1, 1, 0, 2, 1024, 0, 1, 1, 3072, 0, 1, g.epsg]);
      add(34737, T.ASCII, [...g.desc + "|\0"]);
      if(g.nodata !== undefined) add(42113, T.ASCII, [...String(g.nodata) + "\0"]);
    }
    e.sort((a, b) => a.tag - b.tag);
    const inline = big ? 8 : 4;
    const entryBytes = (big ? 8 : 2) + e.length * (big ? 20 : 12) + (big ? 8 : 4);
    let ool = 0;
    for(const x of e){ const n = TYPE_BYTES[x.type] * x.values.length; if(n > inline){ x.ool = ool; ool += n + (n & 1) } }
    return {e, entryBytes, oolBytes: ool, size: entryBytes + ool};
  });

  const header = big ? 16 : 8;
  let pos = header;
  const place = () => { const ifdPos = []; for(const d of ifds){ ifdPos.push(pos); pos += d.size } return ifdPos };
  const placeData = () => levels.map(({blocks}) => blocks.map(b => { const at = pos; pos += b.length; return at }));
  let ifdPos, dataPos;
  if(spec.ifdAtEnd){ dataPos = placeData(); ifdPos = place() } else { ifdPos = place(); dataPos = placeData() }

  const file = Buffer.alloc(pos);
  const u16 = (v, o) => le ? file.writeUInt16LE(v, o) : file.writeUInt16BE(v, o);
  const u32 = (v, o) => le ? file.writeUInt32LE(v, o) : file.writeUInt32BE(v, o);
  const u64 = (v, o) => le ? file.writeBigUInt64LE(BigInt(v), o) : file.writeBigUInt64BE(BigInt(v), o);
  const f64 = (v, o) => le ? file.writeDoubleLE(v, o) : file.writeDoubleBE(v, o);
  file.write(le ? "II" : "MM", 0, "ascii");
  if(big){ u16(43, 2); u16(8, 4); u16(0, 6); u64(ifdPos[0], 8) } else { u16(42, 2); u32(ifdPos[0], 4) }

  ifds.forEach((d, i) => {
    for(const x of d.e){
      if(x.tag === 324 || x.tag === 273) x.values = dataPos[i];
    }
    const base = ifdPos[i];
    big ? u64(d.e.length, base) : u16(d.e.length, base);
    let p = base + (big ? 8 : 2);
    for(const x of d.e){
      u16(x.tag, p); u16(x.type, p + 2);
      big ? u64(x.values.length, p + 4) : u32(x.values.length, p + 4);
      const vo = p + (big ? 12 : 8);
      const at = x.ool === undefined ? vo : base + d.entryBytes + x.ool;
      if(x.ool !== undefined) big ? u64(at, vo) : u32(at, vo);
      const sz = TYPE_BYTES[x.type];
      x.values.forEach((v, j) => {
        const o = at + j * sz;
        if(x.type === T.ASCII) file.write(v, o, "latin1");
        else if(x.type === T.SHORT) u16(v, o);
        else if(x.type === T.LONG) u32(v, o);
        else if(x.type === T.LONG8) u64(v, o);
        else if(x.type === T.DOUBLE) f64(v, o);
      });
      p += big ? 20 : 12;
    }
    const next = i + 1 < ifds.length ? ifdPos[i + 1] : 0;
    big ? u64(next, p) : u32(next, p);
  });
  levels.forEach(({blocks}, i) => blocks.forEach((b, j) => b.copy(file, dataPos[i][j])));
  return {file, levels, ifdPos, dataPos};
}

/* ----------------------------------------------------------------- cases */
const GEO = {scale: [1, 1, 0], tie: [0, 0, 0, 594000, 5190000, 0], epsg: 26910, desc: "NAD83 / UTM zone 10N", nodata: -9999};
const CASES = [
  {name: "usgs-tiled-lzw-fp", note: "USGS 1 m COG shape: LE, tiled, LZW, predictor 3, float32, overviews, GeoKeys, GDAL_NODATA",
   le: true, big: false, geo: GEO, levels: [
     {w: 64, h: 48, tw: 16, th: 16, comp: 5, pred: 3, kind: "f32"},
     {w: 32, h: 24, tw: 16, th: 16, comp: 5, pred: 3, kind: "f32"},
     {w: 16, h: 12, tw: 16, th: 16, comp: 5, pred: 3, kind: "f32"}]},
  {name: "stripped-deflate-fp", note: "stripped 1 m product (WA_ColumbiaValley shape), short last strip",
   le: true, big: false, geo: GEO, levels: [{w: 40, h: 30, strip: 7, comp: 8, pred: 3, kind: "f32"}]},
  {name: "bigtiff-adobe-deflate-fp", note: "BigTIFF, Adobe deflate (32946), LONG8 offsets",
   le: true, big: true, geo: GEO, levels: [
     {w: 48, h: 40, tw: 16, th: 16, comp: 32946, pred: 3, kind: "f32"},
     {w: 24, h: 20, tw: 16, th: 16, comp: 32946, pred: 3, kind: "f32"}]},
  {name: "late-ifd-lzw", note: "directory after the pixel data (ordinary TIFF), no predictor",
   le: true, big: false, geo: GEO, ifdAtEnd: true, levels: [{w: 50, h: 34, tw: 16, th: 16, comp: 5, pred: 1, kind: "f32"}]},
  {name: "be-tiled-lzw-fp", note: "big-endian file, predictor 3 (planes are byte-order independent)",
   le: false, big: false, geo: GEO, levels: [{w: 32, h: 32, tw: 16, th: 16, comp: 5, pred: 3, kind: "f32"}]},
  {name: "be-stripped-raw", note: "big-endian file, uncompressed float32: samples are big-endian",
   le: false, big: false, geo: GEO, levels: [{w: 24, h: 10, strip: 4, comp: 1, pred: 1, kind: "f32"}]},
  {name: "int16-pred2-deflate", note: "signed 16-bit DEM with horizontal differencing on sample values",
   le: true, big: false, geo: GEO, levels: [{w: 32, h: 20, tw: 16, th: 16, comp: 8, pred: 2, kind: "i16"}]},
  {name: "uint16-raw", note: "unsigned 16-bit, uncompressed",
   le: true, big: false, levels: [{w: 20, h: 18, tw: 16, th: 16, comp: 1, pred: 1, kind: "u16"}]},
  {name: "uint8-pred2-lzw", note: "8-bit with byte differencing",
   le: true, big: false, levels: [{w: 20, h: 12, tw: 16, th: 16, comp: 5, pred: 2, kind: "u8"}]},
];

const sha = buf => crypto.createHash("sha256").update(buf).digest("hex");
const f32Bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function jsParity(file, built){
  /* Does today's cog.js decode every block to the ground truth? */
  try{
    const t = cog.parseTiff(file);
    for(let i = 0; i < built.levels.length; i++){
      const L = t.levels[i];
      for(let j = 0; j < built.levels[i].blocks.length; j++){
        const raw = file.subarray(L.offsets[j], L.offsets[j] + L.counts[j]);
        const got = cog.decodeTile(raw, L), want = built.levels[i].expect[j];
        if(got.length !== want.length) return false;
        if(sha(f32Bytes(Float32Array.from(got))) !== sha(f32Bytes(want))) return false;
      }
    }
    return true;
  }catch(e){ return false }
}

function main(){
  fs.mkdirSync(OUT, {recursive: true});
  const manifest = {about: "Frozen L1 TIFF goldens. Decoded samples are float32 little-endian, row-major, one block at a time, padded as TIFF pads.", cases: []};
  for(const c of CASES){
    const built = buildTiff(c), file = built.file;
    fs.writeFileSync(path.join(OUT, c.name + ".tif"), file);
    manifest.cases.push({
      name: c.name, note: c.note, file: `tiff/${c.name}.tif`, bytes: file.length, sha256: sha(file),
      le: c.le, big: c.big, ifd0: built.ifdPos[0],
      geo: c.geo ? {scale: c.geo.scale, tie: c.geo.tie, epsg: c.geo.epsg, desc: c.geo.desc + "|", nodata: c.geo.nodata} : null,
      levels: built.levels.map(({L, blocks, expect}, i) => ({
        w: L.w, h: L.h, tw: L.strip ? L.w : L.tw, th: L.strip ? L.strip : L.th, stripped: !!L.strip,
        comp: L.comp, pred: L.pred, bps: L.bps, spp: 1, sf: L.sf,
        offsets: built.dataPos[i], counts: blocks.map(b => b.length),
        blocks: expect.map(e => sha(f32Bytes(e))),
        sample: Array.from(expect[0].subarray(0, 4)),
      })),
      jsParity: jsParity(file, built),
    });
  }

  /* Geodesy goldens: the formulas the engine uses today (cog.js). */
  const points = [[-121.7603, 46.8523], [-122.3321, 47.6062], [-117.4260, 47.6588], [-120.0001, 46.0], [-119.9999, 49.0],
                  [-123.9, 45.5], [-80.0, 25.0], [-3.7, 40.4], [151.2, -33.9], [-121.5, 0.001]];
  manifest.utm = points.map(([lon, lat]) => {
    const zone = cog.utmZone(lon), f = cog.lonLatToUTM(lon, lat, zone), back = cog.utmToLonLat(f.e, f.n, zone);
    return {lon, lat, zone, e: f.e, n: f.n, backLon: back.lon, backLat: back.lat};
  });
  manifest.merc = points.map(([lon, lat]) => { const m = cog.lonLatToMerc(lon, lat), b = cog.mercToLonLat(m.x, m.y); return {lon, lat, x: m.x, y: m.y, backLon: b.lon, backLat: b.lat} });
  manifest.tiles = [[0, 0, 0], [13, 1326, 2909], [18, 42446, 93106], [20, 167000, 365000]].map(([z, x, y]) => ({z, x, y, ...cog.tileBoundsMerc(z, x, y)}));

  fs.writeFileSync(path.join(__dirname, "goldens.json"), JSON.stringify(manifest, null, 1) + "\n");
  for(const c of manifest.cases) console.log(`${c.name.padEnd(26)} ${String(c.bytes).padStart(6)} B  cog.js parity: ${c.jsParity}`);
}
if(require.main === module) main();
module.exports = {buildTiff, CASES};
