"use strict";
/* Data-engineer fetch (plan docs/GLACIAL_CALIBRATION.md, preregistration frozen
   2026-10-13). For each manifest site: cache label polygons, download 3DEP
   exportImage Float32 views (640 px, viewSizesKm, centred + E/N third-offset),
   rasterize labels (positive / ignore per preregistration precedence), and
   write gzipped view files under output/glacial-calibration/views/.
   Resumable: existing valid view files and label caches are skipped.
   File-geodatabase label sites (OR/NY) are filled by extract_file_labels.py;
   this script reports them and skips their views until the cache exists.
   Run: node scripts/glacial-calibration/fetch.js [--site id] [--labels-only] */
const fs = require("fs"), path = require("path"), zlib = require("zlib"), crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "output", "glacial-calibration");
const VIEWS_DIR = path.join(OUT, "views"), LAB_DIR = path.join(OUT, "labels-cache");
const EDGE = 640;
const OFFSETS = [[0, 0], [1 / 3, 0], [0, 1 / 3]]; // centred, east, north (preregistration)
const sleep = ms => new Promise(r => setTimeout(r, ms));

function bboxAround(lon, lat, km) {
  const dLat = (km / 2) / 111.32, dLon = (km / 2) / (111.32 * Math.cos(lat * Math.PI / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/* ---------- label polygon cache ---------- */
// Feature = array of polygons; polygon = array of rings; ring = [[lon,lat],...]
function esriFeaturesToPolys(features) {
  const out = [];
  for (const f of features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.rings) out.push([g.rings.map(r => r.map(p => [p[0], p[1]]))]);
    else if (g.paths) continue; // line labels handled via buffer in curator; none expected here
  }
  return out.map(p => p[0]);
}

async function esriQuery(url, query, bbox) {
  const q = new URLSearchParams({
    where: query.where || "1=1", outFields: "*", returnGeometry: "true", outSR: "4326",
    geometry: bbox.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", f: "json",
  });
  const r = await fetch(`${url}?${q}`);
  const d = await r.json();
  if (d.error) throw new Error(`label query: ${JSON.stringify(d.error).slice(0, 200)}`);
  if (d.exceededTransferLimit) throw new Error("label query exceededTransferLimit");
  return d.features || [];
}

async function buildLabelCache(site) {
  const dest = path.join(LAB_DIR, `${site.id}.json`);
  if (fs.existsSync(dest)) return JSON.parse(fs.readFileSync(dest, "utf8"));
  const lab = site.label || {};
  if (site.class !== "positive") {
    // Confuser/control: the manifest label block describes confuser-feature
    // polygons for provenance only; every non-nodata pixel is negative
    // (preregistration). Never rasterize them as the positive class.
    const cache = { site: site.id, uncertaintyMetres: lab.uncertaintyMetres || 0,
      positive: [], ignore: [], coverage: null, note: "confuser/control: all pixels negative" };
    fs.mkdirSync(LAB_DIR, { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(cache));
    return cache;
  }
  if (!lab.url || lab.format === "fgdb-zip") return null; // python extractor fills these
  const bbox = site.bbox;
  const cache = { site: site.id, uncertaintyMetres: lab.uncertaintyMetres || 0,
    positive: [], ignore: [], coverage: null };
  if (lab.query) cache.positive = esriFeaturesToPolys(await esriQuery(lab.url, lab.query, bbox));
  for (const iq of lab.ignoreQueries || []) {
    await sleep(300);
    cache.ignore.push(...esriFeaturesToPolys(await esriQuery(iq.url, iq, bbox)));
  }
  if (lab.mapCoverageQuery) {
    await sleep(300);
    cache.coverage = esriFeaturesToPolys(await esriQuery(lab.mapCoverageQuery.url, lab.mapCoverageQuery, bbox));
  }
  fs.mkdirSync(LAB_DIR, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(cache));
  return cache;
}

/* ---------- rasterization ---------- */
// Scanline even-odd fill of all polygons into mask (row 0 = north edge of bbox).
function fillPolys(mask, w, h, bbox, polys) {
  const [x0, y0, x1, y1] = bbox;
  const dx = (x1 - x0) / w, dy = (y1 - y0) / h;
  for (const poly of polys) for (const ring of poly) {
    if (!ring || ring.length < 3) continue;
    let rMin = Infinity, rMax = -Infinity;
    for (const p of ring) { rMin = Math.min(rMin, p[1]); rMax = Math.max(rMax, p[1]); }
    const rowTop = Math.max(0, Math.floor((y1 - rMax) / dy)), rowBot = Math.min(h - 1, Math.ceil((y1 - rMin) / dy));
    for (let row = rowTop; row <= rowBot; row++) {
      const lat = y1 - (row + 0.5) * dy, xs = [];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat)) xs.push(xj + (lat - yj) / (yi - yj) * (xi - xj));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.floor((xs[k] - x0) / dx)), c1 = Math.min(w - 1, Math.ceil((xs[k + 1] - x0) / dx));
        for (let c = c0; c <= c1; c++) mask[row * w + c] ^= 1; // even-odd across rings of one polygon set
      }
    }
  }
  return mask;
}

function chamfer(mask, w, h) {
  const INF = 1e9, d = new Float64Array(w * h).fill(INF);
  for (let i = 0; i < w * h; i++) if (mask[i]) d[i] = 0;
  const pass = (rev) => {
    for (let yi = 0; yi < h; yi++) for (let xi = 0; xi < w; xi++) {
      const x = rev ? w - 1 - xi : xi, y = rev ? h - 1 - yi : yi, i = y * w + x;
      if (!d[i]) continue;
      const dirs = rev ? [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]] : [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]];
      for (const [ox, oy, c] of dirs) {
        const nx = x + ox, ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) d[i] = Math.min(d[i], d[ny * w + nx] + c);
      }
    }
  };
  pass(false); pass(true);
  return d;
}

function rasterizeLabels(cache, bbox, w, h, cellMetres, grid) {
  const pos = fillPolys(new Uint8Array(w * h), w, h, bbox, cache.positive || []);
  const ignPolys = fillPolys(new Uint8Array(w * h), w, h, bbox, cache.ignore || []);
  let unmapped = null;
  if (cache.coverage) {
    const cov = fillPolys(new Uint8Array(w * h), w, h, bbox, cache.coverage);
    unmapped = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) unmapped[i] = cov[i] ? 0 : 1;
  }
  // boundary pixels of positive mask, then distance band
  const boundary = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (pos[i] && (!pos[i - 1] || !pos[i + 1] || !pos[i - w] || !pos[i + w])) boundary[i] = 1;
  }
  const dist = chamfer(boundary, w, h);
  const uncCells = (cache.uncertaintyMetres || 0) / cellMetres;
  const posOut = new Uint8Array(w * h), ignOut = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!Number.isFinite(grid[i])) { ignOut[i] = 1; continue; }       // no-data > all
    if (dist[i] <= uncCells) { ignOut[i] = 1; continue; }             // boundary band
    if (pos[i]) { posOut[i] = 1; continue; }                          // positive
    if (ignPolys[i] || (unmapped && unmapped[i])) ignOut[i] = 1;      // ignore / unmapped
  }
  return { posOut, ignOut };
}

/* ---------- DEM ---------- */
async function fetchDemGrid(bbox, edge) {
  const q = new URLSearchParams({
    bbox: bbox.join(","), bboxSR: "4326", imageSR: "4326", size: `${edge},${edge}`,
    format: "tiff", pixelType: "F32", interpolation: "RSP_BilinearInterpolation", f: "image",
  });
  const url = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?${q}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`exportImage HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const { fromArrayBuffer } = require("geotiff");
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const img = await tiff.getImage();
  const [raster] = await img.readRasters();
  const grid = new Float32Array(raster);
  let nodata = 0;
  for (let i = 0; i < grid.length; i++) if (!Number.isFinite(grid[i]) || grid[i] <= -9999) { grid[i] = NaN; nodata++; }
  return { grid, nodataFraction: nodata / grid.length };
}

/* ---------- main ---------- */
async function repairLabels(sites) {
  // Re-rasterize labels of existing views from their stored grids (no DEM refetch).
  let repaired = 0;
  for (const site of sites) {
    const cacheFile = path.join(LAB_DIR, `${site.id}.json`);
    if (!fs.existsSync(cacheFile)) continue;
    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    for (const km of site.viewSizesKm || [1.3, 3.2, 7.7]) for (let o = 0; o < OFFSETS.length; o++) {
      const dest = path.join(VIEWS_DIR, `${site.id}__${km}km__o${o}.json.gz`);
      if (!fs.existsSync(dest)) continue;
      const v = JSON.parse(zlib.gunzipSync(fs.readFileSync(dest)).toString());
      const grid = new Float32Array(Buffer.from(v.gridB64, "base64").buffer);
      const { posOut, ignOut } = rasterizeLabels(cache, v.bbox, v.w, v.h, v.cellMetres, grid);
      v.posB64 = Buffer.from(posOut).toString("base64");
      v.ignB64 = Buffer.from(ignOut).toString("base64");
      v.uncertaintyM = cache.uncertaintyMetres || 0;
      v.sha256 = crypto.createHash("sha256").update(v.gridB64 + v.posB64).digest("hex");
      fs.writeFileSync(dest, zlib.gzipSync(JSON.stringify(v)));
      repaired++;
    }
  }
  console.log(`repaired=${repaired}`);
}

async function main() {
  const only = process.argv.includes("--site") ? process.argv[process.argv.indexOf("--site") + 1] : null;
  const labelsOnly = process.argv.includes("--labels-only");
  if (process.argv.includes("--repair-labels")) {
    const manifest0 = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
    return repairLabels(manifest0.sites.filter(s => !only || s.id === only));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const sites = manifest.sites.filter(s => !only || s.id === only);
  const dropped = [], needPython = [];
  let done = 0, skipped = 0;
  const failures = [];
  for (const site of sites) {
    let cache = null;
    try { cache = await buildLabelCache(site); } catch (e) { failures.push(`${site.id} labels: ${e.message}`); }
    if (!cache) { needPython.push(site.id); if (!labelsOnly) console.log(`${site.id}: label cache pending python extractor`); continue; }
    if (labelsOnly) continue;
    for (const km of site.viewSizesKm || [1.3, 3.2, 7.7]) {
      for (let o = 0; o < OFFSETS.length; o++) {
        const name = `${site.id}__${km}km__o${o}.json.gz`;
        const dest = path.join(VIEWS_DIR, name);
        if (fs.existsSync(dest)) { skipped++; continue; }
        const [clon, clat] = site.center;
        const lon = clon + OFFSETS[o][0] * (km / (111.32 * Math.cos(clat * Math.PI / 180)));
        const lat = clat + OFFSETS[o][1] * (km / 111.32);
        const bbox = bboxAround(lon, lat, km);
        try {
          const { grid, nodataFraction } = await fetchDemGrid(bbox, EDGE);
          const cellMetres = km * 1000 / EDGE;
          const { posOut, ignOut } = rasterizeLabels(cache, bbox, EDGE, EDGE, cellMetres, grid);
          const payload = { site: site.id, region: site.region, split: site.split, class: site.class,
            type: site.type, viewKm: km, offset: o, w: EDGE, h: EDGE, cellMetres,
            uncertaintyM: cache.uncertaintyMetres || 0,
            bbox, nodataFraction: +nodataFraction.toFixed(5),
            gridB64: Buffer.from(grid.buffer).toString("base64"),
            posB64: Buffer.from(posOut).toString("base64"), ignB64: Buffer.from(ignOut).toString("base64") };
          payload.sha256 = crypto.createHash("sha256").update(payload.gridB64 + payload.posB64).digest("hex");
          fs.mkdirSync(VIEWS_DIR, { recursive: true });
          fs.writeFileSync(dest, zlib.gzipSync(JSON.stringify(payload)));
          if (nodataFraction > 0.01) dropped.push(`${site.id}/${km}/o${o} nodata=${nodataFraction.toFixed(3)}`);
          done++;
          console.log(`${site.id} ${km}km o${o}: nodata=${nodataFraction.toFixed(4)} pos=${posOut.reduce((a, b) => a + b, 0)}`);
        } catch (e) { failures.push(`${site.id}/${km}/o${o}: ${e.message}`); console.error(`FAIL ${site.id} ${km} o${o}: ${e.message}`); }
        await sleep(400);
      }
    }
  }
  const dropFile = path.join(OUT, "dropped-views.json");
  const prev = fs.existsSync(dropFile) ? JSON.parse(fs.readFileSync(dropFile, "utf8")) : [];
  fs.writeFileSync(dropFile, JSON.stringify([...new Set([...prev, ...dropped])], null, 1));
  console.log(`done=${done} skipped=${skipped} failures=${failures.length} needPython=${needPython.join(",") || "none"} droppedViews=${dropped.length}`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
}
if (require.main === module) main();
module.exports = { rasterizeLabels, fillPolys, chamfer, bboxAround };
