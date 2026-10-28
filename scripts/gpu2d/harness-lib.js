'use strict';
/* Workstream V harness for the GPU 2D terrain stack.
   Real-GPU Chrome+Metal and WebKit only. Each bench script is
   `node scripts/gpu2d/<script>.js --browser chrome|webkit --gpu2d 0|1`.
   The live service on port 8765 is never used. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const RESULTS = path.join(__dirname, 'results');
const HOOK = fs.readFileSync(path.join(__dirname, 'page-hook.js'), 'utf8');
const CHROME_PW = '/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright';
const WEBKIT_PW = '/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core';
const CHROME_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const VIEWPORT = { width: 1440, height: 900 };
const DPR = 2;
const CENTER = { name: 'plateau', lat: 47.858, lng: -118.33 };
const VIEWS = [
  { name: 'plateau', lat: 47.858, lng: -118.33 },
  { name: 'nw', lat: 47.875, lng: -118.37 },
  { name: 'ne', lat: 47.875, lng: -118.29 },
  { name: 'sw', lat: 47.841, lng: -118.37 },
  { name: 'se', lat: 47.841, lng: -118.29 },
  { name: 'coulee', lat: 47.866, lng: -118.345 }
];
const ZOOMS = [12, 14, 16, 17, 19, 22];
const STYLES = ['hs', 'hsmulti', 'tint', 'slope', 'aspect', 'northness', 'c2', 'c5', 'c10', 'c25'];
const CONTOUR_STYLES = new Set(['c2', 'c5', 'c10', 'c25']);
const BEARINGS = [0, 37, 90, 180];
const PAN_MOVES = [
  { lat: 47.863408, lng: -118.398895, zoom: 14.5248 },
  { lat: 47.864835, lng: -118.373463, zoom: 15.6509 },
  { lat: 47.879353, lng: -118.405933, zoom: 17.7025 },
  { lat: 47.854295, lng: -118.322644, zoom: 14.6857 },
  { lat: 47.852787, lng: -118.345118, zoom: 17.9818 },
  { lat: 47.844058, lng: -118.408677, zoom: 15.9805 },
  { lat: 47.872322, lng: -118.370702, zoom: 17.0353 },
  { lat: 47.85766, lng: -118.313993, zoom: 16.4588 },
  { lat: 47.854477, lng: -118.343753, zoom: 17.3409 },
  { lat: 47.856305, lng: -118.40532, zoom: 15.8211 },
  { lat: 47.868396, lng: -118.321688, zoom: 16.2099 },
  { lat: 47.857517, lng: -118.366387, zoom: 16.4859 },
  { lat: 47.859076, lng: -118.305098, zoom: 16.1731 },
  { lat: 47.866448, lng: -118.384635, zoom: 16.2627 },
  { lat: 47.865731, lng: -118.418086, zoom: 14.0673 },
  { lat: 47.875327, lng: -118.41174, zoom: 16.0367 }
];
const WARM_VERSION = 2;
const ownedServers = new Set();

const CONTROLS = {
  style: ['#terStyle', false],
  source: ['#terSrc', false],
  opacity: ['#terOp', false],
  contrast: ['#terContrast', false],
  saturation: ['#terSaturation', false],
  brightness: ['#terBrightness', false],
  sunAz: ['#terSunAz', false],
  sunAlt: ['#terSunAlt', false],
  ambient: ['#terAmbient', false],
  exaggeration: ['#terExaggeration', false],
  spectrum: ['#elevSh', true],
  elev: ['#elevSlide', false],
  span: ['#elevSpan', false],
  spectrumOpacity: ['#elevAlpha', false],
  below: ['#elevBelowOn', true],
  above: ['#elevAboveOn', true],
  belowVal: ['#elevBelowVal', false],
  aboveVal: ['#elevAboveVal', false],
  feather: ['#elevBandFeather', false],
  bandOpacity: ['#elevBandAlpha', false],
  outline: ['#elevBandOutline', true],
  readout: ['#snapshotReadout', true]
};

const TERRAIN_ONLY_CSS = `
html.csp-gpu2d-terrain-only #map img.leaflet-tile { opacity: 0 !important; }
html.csp-gpu2d-terrain-only #map .leaflet-control-container,
html.csp-gpu2d-terrain-only #map .leaflet-marker-pane,
html.csp-gpu2d-terrain-only #map .leaflet-shadow-pane,
html.csp-gpu2d-terrain-only #map .leaflet-tooltip-pane,
html.csp-gpu2d-terrain-only #map .leaflet-popup-pane { visibility: hidden !important; }
html.csp-gpu2d-terrain-only #map .leaflet-overlay-pane svg,
html.csp-gpu2d-terrain-only #map .leaflet-overlay-pane img { visibility: hidden !important; }
`;

function parseArgs(argv) {
  const out = {
    browser: 'chrome', gpu2d: 0, repeats: 3, port: 0, cache: '', out: '',
    run: '', shots: '', keepShots: false, help: false, warm: true
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (a === '--browser') out.browser = next();
    else if (a === '--gpu2d') out.gpu2d = Number(next());
    else if (a === '--repeats') out.repeats = Math.max(1, Number(next()));
    else if (a === '--port') out.port = Number(next());
    else if (a === '--cache') out.cache = next();
    else if (a === '--out') out.out = next();
    else if (a === '--run') out.run = next();
    else if (a === '--shots') out.shots = next();
    else if (a === '--keep-shots') out.keepShots = true;
    else if (a === '--no-warm') out.warm = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Unknown argument ' + a);
  }
  if (out.browser !== 'chrome' && out.browser !== 'webkit') throw new Error('--browser must be chrome or webkit');
  if (out.gpu2d !== 0 && out.gpu2d !== 1) throw new Error('--gpu2d must be 0 or 1');
  /* 8815 is workstream V. 8816 is the integrator's server during recovery and
     is refused unless GPU2D_ALLOW_8816=1. 8765 is the live service. */
  if (!out.port) out.port = 8815;
  if (out.port === 8765) throw new Error('Port 8765 is the live service. The harness never uses it.');
  if (out.port === 8816 && process.env.GPU2D_ALLOW_8816 !== '1') {
    throw new Error('Port 8816 is the integrator server. Use 8815, or set GPU2D_ALLOW_8816=1 to attach on purpose.');
  }
  if (!out.cache) out.cache = '/tmp/csp-v-cache-' + out.port;
  return out;
}

function usage(name) {
  return `node scripts/gpu2d/${name}.js --browser chrome|webkit --gpu2d 0|1 [--repeats 3] [--port 8815] [--cache DIR] [--out FILE]`;
}

function summarize(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!xs.length) return { n: 0, median: null, min: null, max: null, spread: null };
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return { n: xs.length, median, min: xs[0], max: xs[xs.length - 1], spread: xs[xs.length - 1] - xs[0], values: xs };
}

function percentile(values, p) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const i = Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1));
  return xs[i];
}

function round(n, d) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(sig)) throw new Error('not a png');
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idats = [];
  while (offset + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(offset); offset += 4;
    const type = buffer.toString('ascii', offset, offset + 4); offset += 4;
    if (offset + len + 4 > buffer.length) throw new Error('truncated png');
    const data = buffer.subarray(offset, offset + len); offset += len + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
  }
  if (interlace) throw new Error('interlaced png is not supported');
  if (bitDepth !== 8) throw new Error('png bit depth ' + bitDepth);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || colorType === 3) throw new Error('png color type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('png rows truncated');
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    raw.copy(row, 0, src, src + stride); src += stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = prev[i];
      const ul = i >= channels ? prev[i - channels] : 0;
      let v = row[i];
      if (filter === 0) {}
      else if (filter === 1) v = (v + left) & 255;
      else if (filter === 2) v = (v + up) & 255;
      else if (filter === 3) v = (v + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) v = (v + paeth(left, up, ul)) & 255;
      else throw new Error('png filter ' + filter);
      row[i] = v;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * channels;
      if (channels === 4) { out[o] = row[s]; out[o + 1] = row[s + 1]; out[o + 2] = row[s + 2]; out[o + 3] = row[s + 3]; }
      else if (channels === 3) { out[o] = row[s]; out[o + 1] = row[s + 1]; out[o + 2] = row[s + 2]; out[o + 3] = 255; }
      else if (channels === 2) { out[o] = out[o + 1] = out[o + 2] = row[s]; out[o + 3] = row[s + 1]; }
      else { out[o] = out[o + 1] = out[o + 2] = row[s]; out[o + 3] = 255; }
    }
    row.copy(prev);
  }
  return { width, height, data: out };
}

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function diffRgba(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    return { error: 'size', a: [a.width, a.height], b: [b.width, b.height] };
  }
  const n = a.width * a.height;
  const max = [0, 0, 0, 0];
  let over = 0, maxAll = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
      if (d > max[c]) max[c] = d;
      if (d > m) m = d;
    }
    sum += m;
    if (m > maxAll) maxAll = m;
    if (m > 3) over++;
  }
  return {
    width: a.width, height: a.height, pixels: n,
    maxChannel: max, max: maxAll, mean: n ? sum / n : 0,
    over3: over, pctOver3: n ? 100 * over / n : 0, pctWithin3: n ? 100 * (n - over) / n : 100
  };
}

function nearBackground(data, i, bg, tol) {
  return Math.max(
    Math.abs(data[i] - bg[0]),
    Math.abs(data[i + 1] - bg[1]),
    Math.abs(data[i + 2] - bg[2])
  ) <= tol;
}

function lineMask(img, bg, tol) {
  const n = img.width * img.height;
  const mask = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!nearBackground(img.data, i * 4, bg, tol == null ? 28 : tol)) { mask[i] = 1; count++; }
  }
  return { mask, count, width: img.width, height: img.height };
}

function dilate1(mask, w, h) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const row = yy * w;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[row + xx] = 1;
        }
      }
    }
  }
  return out;
}

function maskIou(a, b) {
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x || y) union++;
    if (x && y) inter++;
  }
  if (!union) return 1;
  return inter / union;
}

/* Contour agreement: IoU of the two line masks after a 1px 8-connected dilation.
   Both empty (no lines drawn) is agreement. */
function contourIou(imgA, imgB, bg) {
  const ma = lineMask(imgA, bg), mb = lineMask(imgB, bg);
  const da = dilate1(ma.mask, ma.width, ma.height);
  const db = dilate1(mb.mask, mb.width, mb.height);
  return {
    strict: maskIou(ma.mask, mb.mask),
    tolerant: maskIou(da, db),
    linesA: ma.count,
    linesB: mb.count
  };
}

function imageStats(img, bg) {
  const n = img.width * img.height;
  let covered = 0, white = 0, sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4, r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
    const l = (r + g + b) / 3;
    sum += l; sum2 += l * l;
    if (!nearBackground(img.data, o, bg, 18)) covered++;
    if (r > 245 && g > 245 && b > 245) white++;
  }
  const mean = n ? sum / n : 0;
  const sd = Math.sqrt(Math.max(0, (n ? sum2 / n : 0) - mean * mean));
  const coverage = n ? covered / n : 0;
  const whiteFrac = n ? white / n : 0;
  return { coverage, white: whiteFrac, mean, sd, blank: coverage < 0.05 || whiteFrac > 0.85, pixels: n };
}

function sampleGrid(img, cols, rows) {
  const grid = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor(x * img.width / cols), x1 = Math.floor((x + 1) * img.width / cols);
      const y0 = Math.floor(y * img.height / rows), y1 = Math.floor((y + 1) * img.height / rows);
      let r = 0, g = 0, b = 0, n = 0;
      const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
      const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
      for (let yy = y0; yy < y1; yy += stepY) {
        for (let xx = x0; xx < x1; xx += stepX) {
          const o = (yy * img.width + xx) * 4;
          r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
        }
      }
      grid.push(n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0]);
    }
  }
  return { cols, rows, rgb: grid };
}

function gridDiff(a, b) {
  const n = Math.min(a.rgb.length, b.rgb.length);
  let max = 0, sum = 0, over = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.rgb[i][c] - b.rgb[i][c]));
    sum += m; if (m > max) max = m; if (m > 3) over++;
  }
  return { cells: n, max, mean: n ? sum / n : 0, pctWithin3: n ? 100 * (n - over) / n : 100 };
}

function pixelAt(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
}

function channelDelta(a, b) {
  if (!a || !b) return null;
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function writeResult(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function defaultOut(name, args) {
  const dir = args.run ? path.join(RESULTS, args.run) : RESULTS;
  return path.join(dir, `${name}-${args.browser}-gpu${args.gpu2d}.json`);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function portOpen(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode > 0 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode != null) return resolve();
    const pid = child.pid;
    const done = () => resolve();
    const timer = setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch (error) { try { child.kill('SIGKILL'); } catch (e) {} }
      done();
    }, 2500);
    child.once('exit', () => { clearTimeout(timer); done(); });
    try { process.kill(-pid, 'SIGTERM'); }
    catch (error) { try { child.kill('SIGTERM'); } catch (e) {} }
  });
}

async function startServer({ port, cacheDir }) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CSP_CACHE_DIR: cacheDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
  ownedServers.add(child);
  let log = '';
  const take = (buf) => { log += buf.toString(); if (log.length > 80000) log = log.slice(-40000); };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const started = Date.now();
  while (Date.now() - started < 45000) {
    if (child.exitCode != null) throw new Error('server exited ' + child.exitCode + '\n' + log.slice(-2000));
    if (await portOpen(port)) {
      return {
        port, cacheDir, owned: true, child,
        async stop() { ownedServers.delete(child); await stopChild(child); }
      };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await stopChild(child);
  throw new Error('server did not listen on ' + port + '\n' + log.slice(-2000));
}

async function ensureServer({ port, cacheDir, reuse }) {
  if (port === 8765) throw new Error('Port 8765 is the live service.');
  if (port === 8816 && process.env.GPU2D_ALLOW_8816 !== '1') {
    throw new Error('Refusing port 8816 (integrator server).');
  }
  const open = await portOpen(port);
  const attach = reuse || process.env.GPU2D_REUSE_SERVER === '1';
  if (open) {
    if (!attach) throw new Error('Port ' + port + ' is already in use. Refusing to measure whatever is listening. Set GPU2D_REUSE_SERVER=1 to attach on purpose.');
    return { port, cacheDir, owned: false, async stop() {} };
  }
  if (attach) throw new Error('expected a server already listening on ' + port);
  return startServer({ port, cacheDir });
}

function playwrightFor(browser) {
  if (browser === 'webkit') return require(WEBKIT_PW);
  return require(CHROME_PW);
}

async function launchBrowser(browserName, { memory } = {}) {
  const pw = playwrightFor(browserName);
  if (browserName === 'webkit') return pw.webkit.launch({ headless: true });
  const args = CHROME_ARGS.slice();
  if (memory) args.push('--enable-precise-memory-info', '--js-flags=--expose-gc');
  return pw.chromium.launch({ channel: 'chrome', headless: true, args });
}

async function installRoute(context, port) {
  const origin = 'http://127.0.0.1:' + port + '/';
  await context.route(origin + '**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/app.js') return route.continue();
    const res = await route.fetch();
    let body = await res.text();
    const marker = 'window.ClearSkiesPortalBridge={';
    if (!body.includes(marker)) {
      await route.fulfill({ response: res, body });
      throw new Error('app.js is missing the ClearSkiesPortalBridge assignment');
    }
    body = body.replace(marker, HOOK + '\n' + marker);
    body = body.replace(
      'const SNAPSHOT_DISK=typeof window.showSaveFilePicker==="function"&&!SNAPSHOT_IOS;',
      'const SNAPSHOT_DISK=false;'
    );
    await route.fulfill({ response: res, body });
  });
}

function trackNetwork(page) {
  const inflight = new Set();
  const counts = { total: 0, elevation: 0 };
  const urls = [];
  const isElev = (url) => /\/api\/(elev|usgs|wadnr|terrain|dep)\b|elevation\.nationalmap\.gov|lidarportal\.dnr\.wa\.gov/i.test(url);
  page.on('request', (req) => {
    counts.total++;urls.push(req.url());
    if (isElev(req.url())) counts.elevation++;
    inflight.add(req);
  });
  const done = (req) => inflight.delete(req);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return {
    counts,
    inflight: () => inflight.size,
    snapshot: () => ({ total: counts.total, elevation: counts.elevation, inflight: inflight.size, urls: urls.slice() })
  };
}

async function openSession(args, { memory } = {}) {
  const reuse = process.env.GPU2D_REUSE_SERVER === '1';
  const server = await ensureServer({ port: args.port, cacheDir: args.cache, reuse });
  const browser = await launchBrowser(args.browser, { memory });
  const contextOptions = {
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    acceptDownloads: true,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    colorScheme: 'light',
    reducedMotion: 'reduce'
  };
  let context;
  try {
    context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  } catch (error) {
    if (!/serviceWorker/i.test(String(error && error.message || error))) throw error;
    context = await browser.newContext(contextOptions);
  }
  await context.addInitScript(() => {
    try {
      localStorage.setItem('clearskies.reduceMotion.v1', '1');
      localStorage.setItem('clearskies.alerts.v1', JSON.stringify({ nws: false, quakes: false, volcanoes: false, fires: false }));
      localStorage.removeItem('clearskies.terrain.v2');
      localStorage.removeItem('clearskies.terrainAppearance.v2');
      localStorage.removeItem('clearskies.gpu2d');
      localStorage.removeItem('clearskies.research.v1');
      localStorage.removeItem('clearskies.snapshot-scale.v1');
      localStorage.removeItem('clearskies.snapshot.readout.v1');
    } catch (error) {}
    try {
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, writable: true, value: undefined });
    } catch (error) {}
    window.__glCreated = 0;
    window.__glLost = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      const ctx = orig.call(this, type, attrs);
      if (ctx && /webgl/i.test(String(type)) && !this.__cspGlHook) {
        this.__cspGlHook = 1;
        window.__glCreated++;
        this.addEventListener('webglcontextlost', () => { window.__glLost++; });
      }
      return ctx;
    };
  });
  await installRoute(context, args.port);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 400)));
  page.on('crash', () => errors.push('PAGE CRASH'));
  const net = trackNetwork(page);
  page.__net = net;
  let cdp = null;
  if (args.browser === 'chrome') {
    cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  }
  return {
    args, browser, context, page, server, net, errors, cdp,
    browserName: args.browser, port: args.port, gpu2d: args.gpu2d,
    async close() {
      await browser.close().catch(() => {});
      if (server.owned) await server.stop();
    }
  };
}

async function openApp(session) {
  const url = `http://127.0.0.1:${session.port}/?gpu2d=${session.gpu2d}`;
  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await session.page.waitForFunction(() => window.ClearSkiesPortalBridge && window.ClearSkiesPortalBridge.map && window.__cspGpu2d, { timeout: 30000 });
  await session.page.addStyleTag({ content: TERRAIN_ONLY_CSS });
  await session.page.waitForTimeout(400);
  return pathInfo(session.page);
}

async function reloadApp(session) {
  await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await session.page.waitForFunction(() => window.ClearSkiesPortalBridge && window.ClearSkiesPortalBridge.map && window.__cspGpu2d, { timeout: 30000 });
  await session.page.addStyleTag({ content: TERRAIN_ONLY_CSS });
  await session.page.waitForTimeout(300);
  return pathInfo(session.page);
}

async function gotoFlag(session, flag) {
  const url = `http://127.0.0.1:${session.port}/?gpu2d=${flag}`;
  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await session.page.waitForFunction(() => window.ClearSkiesPortalBridge && window.ClearSkiesPortalBridge.map && window.__cspGpu2d, { timeout: 30000 });
  await session.page.addStyleTag({ content: TERRAIN_ONLY_CSS });
  await session.page.waitForTimeout(300);
  return pathInfo(session.page);
}

async function pathInfo(page) {
  return page.evaluate(() => window.__cspGpu2d.path());
}

async function gpuRenderer(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { renderer: 'none', vendor: 'none' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const vendor = String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const software = /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
    return { renderer, vendor, software };
  });
}

async function setControls(page, entries) {
  const list = Array.isArray(entries) ? entries : Object.entries(entries);
  await page.evaluate(({ list, controls }) => {
    for (const [key, value] of list) {
      const spec = controls[key];
      if (!spec) throw new Error('unknown control ' + key);
      const el = document.querySelector(spec[0]);
      if (!el) throw new Error('missing control ' + spec[0]);
      if (spec[1] || el.type === 'checkbox') el.checked = !!value;
      else el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { list, controls: CONTROLS });
}

async function setView(page, { lat, lng, zoom, bearing } = {}) {
  await page.evaluate(({ lat, lng, zoom, bearing }) => {
    const map = window.ClearSkiesPortalBridge.map;
    if (lat != null && zoom != null) map.setView([lat, lng], zoom, { animate: false });
    if (bearing != null && map.setBearing) map.setBearing(bearing);
  }, { lat, lng, zoom, bearing });
}

async function collapseSidebar(page) {
  await page.evaluate(() => {
    if (!document.body.classList.contains('collapsed')) document.querySelector('#sideToggle')?.click();
  });
}

async function expandSidebar(page) {
  await page.evaluate(() => {
    if (document.body.classList.contains('collapsed')) document.querySelector('#sideToggle')?.click();
  });
}

async function openPane(page, name) {
  await page.evaluate((name) => window.ClearSkiesPortalBridge.openPane(name), name);
}

async function waitSettled(page, { timeout = 20000, quietMs = 400 } = {}) {
  const start = Date.now();
  let stableSince = 0;
  let last = null;
  while (Date.now() - start < timeout) {
    last = await page.evaluate(() => window.__cspGpu2d.settlement());
    const inflight = page.__net.inflight();
    if (last && !last.pending && inflight === 0) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= quietMs) {
        return { ok: true, ms: Date.now() - start, state: last };
      }
    } else stableSince = 0;
    await page.waitForTimeout(120);
  }
  return { ok: false, ms: Date.now() - start, state: last, inflight: page.__net.inflight() };
}

async function mapBackground(page) {
  const bg = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('map')).backgroundColor || '';
    const m = s.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : [219, 230, 235];
  });
  return bg.length >= 3 ? bg : [219, 230, 235];
}

/* Correctness capture. Playwright screenshots the presented #map frame, so a
   WebGL canvas with preserveDrawingBuffer:false is not read from JS.
   clip is CSS pixels relative to #map. Timed profile paths do not call this. */
async function terrainScreenshot(page, { clip } = {}) {
  await page.evaluate(() => document.documentElement.classList.add('csp-gpu2d-terrain-only'));
  try {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const opts = { type: 'png', animations: 'disabled' };
    if (clip) opts.clip = clip;
    return await page.locator('#map').screenshot(opts);
  } finally {
    await page.evaluate(() => document.documentElement.classList.remove('csp-gpu2d-terrain-only'));
  }
}

/* Screenshot coverage. engine.stats().coverage is a tile-overlap estimate and is not used here. */
async function coverageShot(page, options) {
  const bg = await mapBackground(page);
  const png = await terrainScreenshot(page, options);
  const img = decodePng(png);
  return { png, img, bg, stats: imageStats(img, bg), method: 'playwright-screenshot' };
}

function profileSamples(profile) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  let total = 0;
  profile.samples.forEach((id, i) => {
    const node = byId.get(id);
    const frame = node && node.callFrame;
    const key = frame
      ? (frame.functionName || '(anon)') + ' ' + ((frame.url || '').split('/').pop() || '') + ':' + frame.lineNumber
      : '(unknown)';
    const dt = (profile.timeDeltas[i] || 0) / 1000;
    self.set(key, (self.get(key) || 0) + dt);
    total += dt;
  });
  const idle = [...self.entries()].filter(([key]) => key.startsWith('(idle)')).reduce((s, [, v]) => s + v, 0);
  const program = [...self.entries()].filter(([key]) => key.startsWith('(program)')).reduce((s, [, v]) => s + v, 0);
  const gc = [...self.entries()].filter(([key]) => key.startsWith('(garbage')).reduce((s, [, v]) => s + v, 0);
  const top = [...self.entries()]
    .filter(([key]) => !/^\(idle\)|^\(program\)|^\(garbage/.test(key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, ms]) => ({ name, ms: Math.round(ms) }));
  return { total, idle, program, gc, busy: total - idle, top };
}

async function beginLongTasks(page) {
  await page.evaluate(() => {
    window.__long = 0; window.__lc = 0; window.__longMax = 0; window.__longOver100 = 0;
    try { window.__ltObserver && window.__ltObserver.disconnect(); } catch (error) {}
    try {
      window.__ltObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__long += entry.duration;
          window.__lc++;
          if (entry.duration > window.__longMax) window.__longMax = entry.duration;
          if (entry.duration > 100) window.__longOver100++;
        }
      });
      window.__ltObserver.observe({ type: 'longtask' });
      window.__longTaskSupported = true;
    } catch (error) {
      window.__longTaskSupported = false;
    }
  });
}

async function readLongTasks(page) {
  return page.evaluate(() => ({
    supported: !!window.__longTaskSupported,
    count: window.__lc || 0,
    ms: window.__long || 0,
    max: window.__longMax || 0,
    over100: window.__longOver100 || 0
  }));
}

async function profilePhase(session, fn) {
  const page = session.page;
  await beginLongTasks(page);
  const wallStart = Date.now();
  if (session.cdp) await session.cdp.send('Profiler.start');
  else await startRaf(page);
  await fn();
  const wallMs = Date.now() - wallStart;
  let samples = null;
  if (session.cdp) {
    const { profile } = await session.cdp.send('Profiler.stop');
    samples = profileSamples(profile);
  }
  const raf = session.cdp ? null : await stopRaf(page);
  const longs = await readLongTasks(page);
  let longSource = longs.supported ? 'longtask' : 'none';
  if (!longs.supported && raf) {
    const stalls = raf.gaps.filter((gap) => gap > 50);
    longs.count = stalls.length;
    longs.ms = stalls.reduce((s, g) => s + g, 0);
    longs.max = stalls.reduce((m, g) => Math.max(m, g), 0);
    longs.over100 = stalls.filter((g) => g > 100).length;
    longSource = 'raf-gap>50ms';
  }
  return {
    wallMs,
    busyMs: samples ? Math.round(samples.busy) : null,
    programMs: samples ? Math.round(samples.program) : null,
    gcMs: samples ? Math.round(samples.gc) : null,
    idleMs: samples ? Math.round(samples.idle) : null,
    sampleMs: samples ? Math.round(samples.total) : null,
    top: samples ? samples.top : [],
    longTasks: longs.count,
    longTaskMs: Math.round(longs.ms),
    longTaskMaxMs: Math.round(longs.max),
    longTasksOver100: longs.over100,
    longTaskSource: longSource,
    rafP95: raf ? percentile(raf.gaps, 95) : null,
    mainThreadMethod: samples ? 'cdp-profiler' : 'webkit-raf-and-longtask'
  };
}

async function startRaf(page) {
  await page.evaluate(() => {
    window.__rafGaps = [];
    let last = 0;
    const loop = (t) => {
      if (last) window.__rafGaps.push(t - last);
      last = t;
      window.__rafHandle = requestAnimationFrame(loop);
    };
    window.__rafHandle = requestAnimationFrame((t) => { last = t; window.__rafHandle = requestAnimationFrame(loop); });
  });
}

async function stopRaf(page) {
  return page.evaluate(() => {
    if (window.__rafHandle) cancelAnimationFrame(window.__rafHandle);
    const gaps = window.__rafGaps || [];
    window.__rafGaps = [];
    return { gaps, n: gaps.length };
  });
}

async function rafStats(page, fn) {
  await startRaf(page);
  await fn();
  const { gaps } = await stopRaf(page);
  return {
    n: gaps.length,
    p50: percentile(gaps, 50),
    p95: percentile(gaps, 95),
    max: gaps.reduce((m, g) => Math.max(m, g), 0),
    over16: gaps.filter((g) => g > 16.7).length,
    over50: gaps.filter((g) => g > 50).length
  };
}

async function heapSample(session) {
  const page = session.page;
  const dom = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    glCreated: window.__glCreated || 0,
    glLost: window.__glLost || 0,
    memory: performance.memory ? {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize
    } : null
  }));
  let cdpHeap = null;
  if (session.cdp) {
    try { await page.evaluate(() => { if (typeof window.gc === 'function') window.gc(); }); } catch (error) {}
    try {
      await session.cdp.send('Performance.enable');
      const metrics = await session.cdp.send('Performance.getMetrics');
      const get = (name) => metrics.metrics.find((row) => row.name === name)?.value ?? null;
      cdpHeap = { jsHeapUsed: get('JSHeapUsedSize'), jsHeapTotal: get('JSHeapTotalSize'), nodes: get('Nodes') };
    } catch (error) {
      cdpHeap = { error: String(error.message || error) };
    }
  }
  const engine = await page.evaluate(() => window.__cspGpu2d.engineStats());
  return { ...dom, cdp: cdpHeap, engine };
}

function warmMarker(cacheDir) {
  return path.join(cacheDir, '.gpu2d-warmed.json');
}

function readWarmMarker(cacheDir) {
  try { return JSON.parse(fs.readFileSync(warmMarker(cacheDir), 'utf8')); }
  catch (error) { return null; }
}

async function warmCache(session) {
  const marker = readWarmMarker(session.args.cache);
  if (marker && marker.version === WARM_VERSION) {
    console.log('cache already warm', session.args.cache);
    return { skipped: true, marker };
  }
  console.log('warming cache', session.args.cache);
  await openApp(session);
  await collapseSidebar(session.page);
  await setView(session.page, { ...CENTER, zoom: 15, bearing: 0 });
  await setControls(session.page, [['source', '3dep'], ['style', 'hs'], ['spectrum', true], ['opacity', 100]]);
  const jobs = [];
  for (const zoom of [12, 14, 15, 16, 17, 19, 22]) {
    for (const view of VIEWS) jobs.push({ ...view, zoom });
  }
  for (let zoom = 18; zoom <= 28; zoom++) jobs.push({ ...CENTER, zoom });
  let i = 0, unsettled = 0;
  for (const job of jobs) {
    i++;
    await setView(session.page, { ...job, bearing: 0 });
    const settled = await waitSettled(session.page, { timeout: 25000, quietMs: 250 });
    if (!settled.ok) {
      unsettled++;
      if (unsettled >= 3) throw new Error('Cache warm-up failed to settle three views; refusing to benchmark a cold/incomplete route. Last state: ' + JSON.stringify(settled));
    }
    if (i % 5 === 0 || !settled.ok) {
      const why = settled.ok ? settled.ms + 'ms' : 'UNSETTLED inflight=' + settled.inflight + ' ' + JSON.stringify(settled.state);
      console.log('warm', i + '/' + jobs.length, 'z' + job.zoom, job.name || '', why);
    }
  }
  const record = { version: WARM_VERSION, jobs: jobs.length, unsettled, at: new Date().toISOString() };
  if (unsettled === 0) {
    fs.writeFileSync(warmMarker(session.args.cache), JSON.stringify(record));
    console.log('warm done', jobs.length);
  } else {
    console.log('warm incomplete, marker not written,', unsettled, 'unsettled');
  }
  return record;
}

async function runBench(name, args, measure, { memory } = {}) {
  if (args.help) { console.log(usage(name)); return null; }
  const session = await openSession(args, { memory });
  const runs = [];
  let info = null, renderer = null, error = null;
  try {
    const warmed = args.warm ? await warmCache(session) : null;
    let live = !!(warmed && !warmed.skipped);
    for (let i = 0; i < args.repeats; i++) {
      console.log(`\n== ${name} ${args.browser} gpu2d=${args.gpu2d} ${i + 1}/${args.repeats}`);
      info = live ? await reloadApp(session) : await openApp(session);
      live = true;
      if (!renderer) renderer = await gpuRenderer(session.page);
      if (renderer && renderer.software) throw new Error('software WebGL renderer: ' + renderer.renderer);
      const run = await measure(session, i);
      run.repeat = i + 1;
      run.path = info;
      runs.push(run);
      console.log(JSON.stringify(run.headline || run.summary || { ok: true }));
    }
  } catch (err) {
    error = String(err && err.stack || err);
    console.error(error);
  } finally {
    await session.close();
  }
  const result = {
    name,
    browser: args.browser,
    gpu2dRequested: args.gpu2d,
    path: info,
    renderer,
    repeats: runs,
    pageErrors: session.errors.slice(0, 12),
    error,
    finishedAt: new Date().toISOString()
  };
  const file = args.out || defaultOut(name, args);
  writeResult(file, result);
  console.log('wrote', file);
  if (error || runs.some(run => run.gate && run.gate.applies && run.gate.pass === false)) process.exitCode = 1;
  return result;
}

async function prepareScene(page, { style = 'hs', spectrum = true, zoom = 15, bearing = 0, opacity = 100, bands = false, source = '3dep' } = {}) {
  await collapseSidebar(page);
  await setView(page, { ...CENTER, zoom, bearing });
  await setControls(page, {
    source, style, spectrum, opacity,
    below: !!bands, above: !!bands, outline: !!bands
  });
  return waitSettled(page);
}

/* Frames until paintSignal changes. The signal is a 2D-canvas sample or an
   engine frame counter. It never reads the WebGL drawing buffer. frames 0
   means the signal moved in the same task as the input event. */
async function measureControl(page, key, value) {
  const net0 = page.__net.snapshot();
  const result = await page.evaluate(async ({ key, value, controls }) => {
    const spec = controls[key];
    if (!spec) throw new Error('unknown control ' + key);
    const el = document.querySelector(spec[0]);
    if (!el) throw new Error('missing control ' + spec[0]);
    const before = JSON.stringify(window.__cspGpu2d.paintSignal());
    if (spec[1] || el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const immediate = JSON.stringify(window.__cspGpu2d.paintSignal());
    if (immediate !== before) {
      return { frames: 0, changed: true, ms: 0, before: JSON.parse(before), after: JSON.parse(immediate) };
    }
    const t0 = performance.now();
    let frames = 0, after = immediate;
    await new Promise((resolve) => {
      const step = () => {
        frames++;
        after = JSON.stringify(window.__cspGpu2d.paintSignal());
        if (after !== before || frames >= 6) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return { frames, changed: after !== before, ms: performance.now() - t0, before: JSON.parse(before), after: JSON.parse(after) };
  }, { key, value, controls: CONTROLS });
  const net1 = page.__net.snapshot();
  return {
    key, value, ...result,
    network: { total: net1.total - net0.total, elevation: net1.elevation - net0.elevation, urls: net1.urls.slice(net0.total) }
  };
}

function viewPoints(lat, lng) {
  return [
    { name: 'c', lat, lng },
    { name: 'n', lat: lat + 0.0011, lng },
    { name: 's', lat: lat - 0.0011, lng },
    { name: 'e', lat, lng: lng + 0.0016 },
    { name: 'w', lat, lng: lng - 0.0016 },
    { name: 'ne', lat: lat + 0.0008, lng: lng + 0.0011 },
    { name: 'sw', lat: lat - 0.0008, lng: lng - 0.0011 }
  ];
}

function sampleBilinear(data, w, h, x, y) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return null;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const at = (xx, yy) => {
    const o = (yy * w + xx) * 4;
    return [data[o], data[o + 1], data[o + 2], data[o + 3]];
  };
  const a = at(x0, y0), b = at(x1, y0), c = at(x0, y1), d = at(x1, y1);
  const mix = (i) => Math.round(a[i] * (1 - tx) * (1 - ty) + b[i] * tx * (1 - ty) + c[i] * (1 - tx) * ty + d[i] * tx * ty);
  return [mix(0), mix(1), mix(2), mix(3)];
}

/* Clockwise rotation in a y-down bitmap. Used only as a labeled secondary
   check against a screenshot. It is not a geographic proof. */
function rotateRgba(img, degrees) {
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const w = img.width, h = img.height;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const out = Buffer.alloc(w * h * 4, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const sx = cx + dx * cos + dy * sin;
      const sy = cy - dx * sin + dy * cos;
      const p = sampleBilinear(img.data, w, h, sx, sy);
      if (!p) continue;
      const o = (y * w + x) * 4;
      out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = p[3];
    }
  }
  return { width: w, height: h, data: out };
}

/* Subsampled diff of a clockwise y-down rotation of `north` against `other`.
   Pixels that fall outside the source are ignored. Not a 3/255 gate. */
function rotateDiff(north, other, degrees, step) {
  const stride = step || 2;
  const rad = degrees * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const w = north.width, h = north.height;
  if (other.width !== w || other.height !== h) return { error: 'size' };
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  let n = 0, within8 = 0, within16 = 0, within24 = 0, max = 0, sum = 0;
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const dx = x - cx, dy = y - cy;
      const sx = cx + dx * cos + dy * sin;
      const sy = cy - dx * sin + dy * cos;
      const p = sampleBilinear(north.data, w, h, sx, sy);
      if (!p) continue;
      const q = pixelAt(other, x, y);
      if (!q) continue;
      let m = 0;
      for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(p[c] - q[c]));
      n++; sum += m;
      if (m > max) max = m;
      if (m <= 8) within8++;
      if (m <= 16) within16++;
      if (m <= 24) within24++;
    }
  }
  return {
    method: 'bilinear-rotate-screenshot',
    step: stride, samples: n, max, mean: n ? sum / n : null,
    pctWithin8: n ? 100 * within8 / n : null,
    pctWithin16: n ? 100 * within16 / n : null,
    pctWithin24: n ? 100 * within24 / n : null,
    note: 'Secondary screenshot comparison. A rotated bitmap is not the geographic test and is not gated at 3/255.'
  };
}

function patchMedian(img, x, y, radius) {
  const rs = [], gs = [], bs = [], as = [];
  const r = radius == null ? 1 : radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const p = pixelAt(img, x + dx, y + dy);
      if (!p) continue;
      rs.push(p[0]); gs.push(p[1]); bs.push(p[2]); as.push(p[3]);
    }
  }
  if (!rs.length) return null;
  const med = (arr) => { arr.sort((a, b) => a - b); return arr[Math.floor(arr.length / 2)]; };
  return [med(rs), med(gs), med(bs), med(as)];
}

/* lat/lng samples through Leaflet's container point, times devicePixelRatio,
   read from a screenshot of #map. This follows the map's own transform,
   including bearing. It does not stretch getBoundingClientRect. */
async function geographicSamples(page, pngOrImg, points) {
  const img = pngOrImg.data && pngOrImg.width ? pngOrImg : decodePng(pngOrImg);
  const located = await page.evaluate((points) => {
    const map = window.ClearSkiesPortalBridge.map;
    const dpr = window.devicePixelRatio || 1;
    const size = map.getSize();
    return points.map((p) => {
      const pt = map.latLngToContainerPoint([p.lat, p.lng]);
      return {
        name: p.name, lat: p.lat, lng: p.lng,
        x: pt.x, y: pt.y,
        dx: Math.round(pt.x * dpr), dy: Math.round(pt.y * dpr),
        dpr, cssW: size.x, cssH: size.y,
        bearing: typeof map.getBearing === 'function' ? map.getBearing() : 0
      };
    });
  }, points);
  return located.map((loc) => {
    const rgba = pixelAt(img, loc.dx, loc.dy);
    const patch = patchMedian(img, loc.dx, loc.dy, 1);
    const inside = loc.dx >= 2 && loc.dy >= 2 && loc.dx < img.width - 2 && loc.dy < img.height - 2;
    return { ...loc, rgba, patch, inside };
  });
}

function refFile(args, group, name) {
  const root = args.shots || '/tmp/csp-gpu2d-shots';
  return path.join(root, group, args.browser, 'gpu' + args.gpu2d, name);
}

async function mapBox(page) {
  return page.locator('#map').boundingBox();
}

function selfTest() {
  const { encodePNG } = require(path.join(REPO, 'usgs.js'));
  const w = 5, h = 4;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    rgba[o] = x * 40; rgba[o + 1] = y * 50; rgba[o + 2] = 20; rgba[o + 3] = x === 0 ? 0 : 255;
  }
  const decoded = decodePng(encodePNG(rgba, w, h));
  let mismatch = 0;
  for (let i = 0; i < rgba.length; i++) if (decoded.data[i] !== rgba[i]) mismatch++;
  const grey = Buffer.alloc(w * h * 4, 0);
  for (let i = 0; i < w * h; i++) { grey[i * 4] = grey[i * 4 + 1] = grey[i * 4 + 2] = 30 + i; grey[i * 4 + 3] = 255; }
  const greyDec = decodePng(encodePNG(grey, w, h));
  let greyMiss = 0;
  for (let i = 0; i < grey.length; i++) if (greyDec.data[i] !== grey[i]) greyMiss++;
  const same = diffRgba(decoded, decoded);
  const changed = decodePng(encodePNG(rgba, w, h));
  changed.data[4] = (changed.data[4] + 10) & 255;
  const one = diffRgba(decoded, changed);
  const bg = [0, 0, 0];
  const lines = Buffer.alloc(8 * 8 * 4);
  for (let y = 0; y < 8; y++) { const o = (y * 8 + 3) * 4; lines[o] = lines[o + 1] = lines[o + 2] = 255; lines[o + 3] = 255; }
  const shifted = Buffer.alloc(8 * 8 * 4);
  for (let y = 0; y < 8; y++) { const o = (y * 8 + 4) * 4; shifted[o] = shifted[o + 1] = shifted[o + 2] = 255; shifted[o + 3] = 255; }
  const img = (data) => ({ width: 8, height: 8, data });
  const iou = contourIou(img(lines), img(shifted), bg);
  const stats = summarize([3, 1, 2]);
  const paethRow = (() => {
    /* 1x2 RGBA, filter 4, known bytes. */
    const width = 2, height = 1, channels = 4, stride = 8;
    const raw = Buffer.alloc(1 + stride);
    raw[0] = 4;
    const orig = [10, 20, 30, 40, 50, 60, 70, 80];
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? orig[i - channels] : 0;
      raw[i + 1] = (orig[i] - paeth(left, 0, 0)) & 255;
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
      const td = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0, 0);
      return Buffer.concat([len, td, crc]);
    };
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ]);
    const back = decodePng(png);
    let miss = 0;
    for (let i = 0; i < orig.length; i++) if (back.data[i] !== orig[i]) miss++;
    return miss;
  })();
  const dot = { width: 5, height: 5, data: Buffer.alloc(5 * 5 * 4, 0) };
  dot.data[(0 * 5 + 2) * 4] = 255; dot.data[(0 * 5 + 2) * 4 + 3] = 255;
  const turned = rotateRgba(dot, 90);
  const landed = pixelAt(turned, 4, 2);
  const rotateOk = !!(landed && landed[0] === 255 && landed[3] === 255);
  const ok = mismatch === 0 && greyMiss === 0 && same.pctWithin3 === 100 && one.over3 === 1 && iou.tolerant > iou.strict && stats.median === 2 && paethRow === 0 && rotateOk;
  return { ok, mismatch, greyMiss, sameWithin: same.pctWithin3, oneOver: one.over3, iou, median: stats.median, paethRow, rotateOk, landed };
}

process.on('exit', () => {
  for (const child of ownedServers) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {}
  }
});
process.on('SIGINT', () => { process.exit(130); });
process.on('SIGTERM', () => { process.exit(143); });

module.exports = {
  REPO, RESULTS, VIEWPORT, DPR, CENTER, VIEWS, ZOOMS, STYLES, CONTOUR_STYLES, BEARINGS, PAN_MOVES,
  CHROME_ARGS, parseArgs, usage, summarize, percentile, round,
  decodePng, pngSize, diffRgba, contourIou, imageStats, sampleGrid, gridDiff, pixelAt, channelDelta,
  writeResult, defaultOut, sha256,
  openSession, openApp, reloadApp, gotoFlag, pathInfo, gpuRenderer, setControls, setView,
  collapseSidebar, expandSidebar, openPane, waitSettled, mapBackground, terrainScreenshot, coverageShot,
  profilePhase, rafStats, startRaf, stopRaf, heapSample, warmCache, runBench, selfTest,
  prepareScene, measureControl, viewPoints, rotateRgba, rotateDiff, geographicSamples, refFile, mapBox,
  ensureServer, patchMedian
};

if (require.main === module && process.argv.includes('--self-test')) {
  const result = selfTest();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
