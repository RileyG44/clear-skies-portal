"use strict";
/* Spot-check gallery: for each site, the centred 3.2 km view rendered as
   hillshade with positive labels in red and ignore pixels in yellow,
   written to output/glacial-calibration/overlays/<site>.png.
   Run after fetch: node scripts/glacial-calibration/overlays.js */
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const OUT = path.join(__dirname, "..", "..", "output", "glacial-calibration");

function crc32(buf) {
  let table = crc32.t;
  if (!table) { table = crc32.t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (const b of buf) c = table[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePNG(file, rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const dir = path.join(OUT, "overlays");
  fs.mkdirSync(dir, { recursive: true });
  let made = 0;
  for (const site of manifest.sites) {
    const f = path.join(OUT, "views", `${site.id}__3.2km__o0.json.gz`);
    if (!fs.existsSync(f)) continue;
    const v = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
    const grid = new Float32Array(Buffer.from(v.gridB64, "base64").buffer);
    const pos = Buffer.from(v.posB64, "base64"), ign = Buffer.from(v.ignB64, "base64");
    const { w, h } = v;
    const rgb = Buffer.alloc(w * h * 3);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const dzdx = (grid[i + 1] - grid[i - 1]) / (2 * v.cellMetres);
      const dzdy = (grid[i + w] - grid[i - w]) / (2 * v.cellMetres);
      let shade = 0.5 - (dzdx * 0.7 + dzdy * 0.7);
      shade = Math.max(0, Math.min(1, shade));
      let r = shade * 235, g = shade * 235, bl = shade * 235;
      if (!Number.isFinite(grid[i])) { r = 40; g = 40; bl = 90; }
      if (ign[i]) { r = 0.45 * r + 0.55 * 230; g = 0.45 * g + 0.55 * 200; bl *= 0.4; }
      if (pos[i]) { r = 0.35 * r + 0.65 * 255; g *= 0.3; bl *= 0.3; }
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = bl;
    }
    writePNG(path.join(dir, `${site.id}.png`), rgb, w, h);
    made++;
  }
  console.log(`overlays=${made}`);
}
if (require.main === module) main();
