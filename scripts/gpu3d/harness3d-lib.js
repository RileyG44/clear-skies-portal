'use strict';
/* Shared lib for scripts/gpu3d/. Reuses PNG/stats helpers from gpu2d harness.
   Real GPU only: Chrome via --use-angle=metal, WebKit via Playwright.
   SwiftShader/software renderers invalidate performance (reported, not hidden). */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const lib2d = require('../gpu2d/harness-lib.js');

const REPO = path.resolve(__dirname, '..', '..');
const CHROME_PW = '/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright';
const WEBKIT_PW = '/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core';
const CHROME_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const CENTER = { lat: 47.858, lng: -118.33 };
const CAMERA = { center: [CENTER.lng, CENTER.lat], zoom: 14, pitch: 58, bearing: 37 };
/* Fixed route at nonzero pitch/bearing; each leg timed via RAF gaps. */
const ROUTE = [
  { center: [-118.33, 47.858], zoom: 14, pitch: 58, bearing: 37 },
  { center: [-118.345, 47.866], zoom: 15, pitch: 62, bearing: 80 },
  { center: [-118.31, 47.85], zoom: 14.5, pitch: 50, bearing: 160 },
  { center: [-118.33, 47.858], zoom: 14, pitch: 58, bearing: 37 }
];
const STYLES = ['slope', 'aspect', 'tint', 'c10'];

function parseArgs(argv) {
  const out = { browser: 'chrome', gpu3d: 0, url: '', out: '', shots: '', spawnPort: 0, cache: '', contextLoss: false, requireGpu: false, phone: true, repeats: 3 };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i], next = () => a[++i];
    if (k === '--browser') out.browser = next();
    else if (k === '--gpu3d') out.gpu3d = Number(next());
    else if (k === '--url') out.url = next();
    else if (k === '--out') out.out = next();
    else if (k === '--shots') out.shots = next();
    else if (k === '--spawn-port') out.spawnPort = Number(next());
    else if (k === '--cache') out.cache = next();
    else if (k === '--repeats') out.repeats = Math.max(1, Number(next()));
    else if (k === '--context-loss') out.contextLoss = true;
    else if (k === '--require-gpu') out.requireGpu = true;
    else if (k === '--no-phone') out.phone = false;
    else if (k === '--help' || k === '-h') out.help = true;
    else throw new Error('Unknown argument ' + k);
  }
  if (out.help) return out;
  if (out.browser !== 'chrome' && out.browser !== 'webkit') throw new Error('--browser must be chrome|webkit');
  if (out.gpu3d !== 0 && out.gpu3d !== 1) throw new Error('--gpu3d must be 0|1');
  if (out.spawnPort) {
    if (out.spawnPort === 8765) throw new Error('Port 8765 is the live service. Never use it.');
    out.url = `http://127.0.0.1:${out.spawnPort}/`;
    if (!out.cache) out.cache = '/tmp/csp-gpu3d-cache-' + out.spawnPort;
  }
  if (!out.url) throw new Error('--url http://127.0.0.1:<isolated-port>/ (or --spawn-port N) is required');
  const u = new URL(out.url);
  if (Number(u.port) === 8765) throw new Error('Port 8765 is the live service. Never use it.');
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('--url must be a local isolated server');
  u.searchParams.set('gpu3d', String(out.gpu3d));
  out.url = u.toString();
  out.origin = u.origin + '/';
  return out;
}

function usage() {
  return 'node scripts/gpu3d/bench3d.js --url http://127.0.0.1:8823/ --browser chrome|webkit --gpu3d 0|1 [--out FILE] [--shots DIR] [--context-loss] [--require-gpu]\n' +
    '  or: node scripts/gpu3d/bench3d.js --spawn-port 8823 --browser chrome --gpu3d 0  (starts scripts/dev-server.js with a temp cache, kills it after)';
}

/* Deterministic synthetic Terrarium tile (same formula family as ui-terrain-drape). */
function fixturePng() {
  const { encodePNG } = require(path.join(REPO, 'usgs.js'));
  const b = Buffer.alloc(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const v = Math.round((1200 + 40 * Math.sin(i / 9) + 40 * Math.cos(j / 7) + 32768) * 256), o = (j * 256 + i) * 4;
    b[o] = v >> 16; b[o + 1] = (v >> 8) & 255; b[o + 2] = v & 255; b[o + 3] = 255;
  }
  return encodePNG(b, 256, 256);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function spawnServer(args) {
  if (!args.spawnPort) return null;
  fs.mkdirSync(args.cache, { recursive: true });
  const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'dev-server.js'), '--port', String(args.spawnPort)], {
    cwd: REPO, env: { ...process.env, HOST: '127.0.0.1', PORT: String(args.spawnPort), CSP_CACHE_DIR: args.cache },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true
  });
  let log = '';
  child.stdout.on('data', (d) => { log = (log + d).slice(-4000); });
  child.stderr.on('data', (d) => { log = (log + d).slice(-4000); });
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    if (child.exitCode != null) throw new Error('dev-server exited ' + child.exitCode + '\n' + log);
    if (await portOpen(args.spawnPort)) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {}
  throw new Error('dev-server did not listen on ' + args.spawnPort + '\n' + log);
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { try { child.kill('SIGTERM'); } catch (e2) {} }
  await new Promise((r) => setTimeout(r, 800));
  if (child.exitCode == null) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} }
}

async function launch(browserName) {
  if (browserName === 'webkit') return require(WEBKIT_PW).webkit.launch({ headless: true });
  return require(CHROME_PW).chromium.launch({ channel: 'chrome', headless: true, args: CHROME_ARGS });
}

/* Installs: Worker/render counters (init script), synthetic terrain routes,
   index injection exposing window.__map3d. Returns counters object. */
async function installFixture(context, args, png) {
  const counts = { elevation: 0, national: 0, basemap: 0, total: 0 };
  await context.addInitScript(() => {
    try { localStorage.setItem('clearskies.reduceMotion.v1', '1'); } catch (e) {}
    window.__workers = []; window.__workerPosts = 0;
    const W = window.Worker;
    if (W) {
      window.Worker = function (url, opts) {
        const w = new W(url, opts); window.__workers.push(String(url));
        const pm = w.postMessage.bind(w);
        w.postMessage = (...a) => { window.__workerPosts++; return pm(...a); };
        return w;
      };
      window.Worker.prototype = W.prototype;
    }
  });
  await context.route('**/api/health', async (route) => {
    try {
      const res = await route.fetch(); const json = await res.json();
      json.features = (json.features || []).filter((f) => f !== 'wadnr-elevation');
      await route.fulfill({ response: res, json });
    } catch (e) { await route.continue().catch(() => {}); }
  });
  const pngRoute = (counter) => (route) => { counts[counter]++; route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }); };
  await context.route(/\/api\/elev\/national\//, (r) => { counts.national++; pngRoute('elevation')(r); });
  await context.route(/\/api\/elev\/\d+\//, pngRoute('elevation'));
  await context.route('https://s3.amazonaws.com/elevation-tiles-prod/**', pngRoute('elevation'));
  await context.route(/https:\/\/(?:[^/]*arcgisonline\.com|[^/]*cartocdn\.com|[^/]*tile\.openstreetmap\.org)\//, pngRoute('basemap'));
  await context.route(args.origin + '**', async (route) => {
    const url = new URL(route.request().url());
    counts.total++;
    if (url.pathname !== '/' && url.pathname !== '/index.html') return route.continue();
    const res = await route.fetch();
    let html = await res.text();
    const hook = 'window.CSPMarkup?.attach3d(module,map3d);';
    if (html.includes(hook)) html = html.replace(hook, hook + 'window.__map3d=map3d;');
    const renderHook = 'async function renderDrapeTile(style,z,x,y,signal){';
    if (html.includes(renderHook)) html = html.replace(renderHook, renderHook + 'window.__drapeRenders=(window.__drapeRenders||0)+1;window.__drapeByStyle=window.__drapeByStyle||{};window.__drapeByStyle[style]=(window.__drapeByStyle[style]||0)+1;');
    await route.fulfill({ response: res, body: html });
  });
  return counts;
}

async function newPage(browser, profile) {
  const opts = profile === 'phone'
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/Los_Angeles' }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'America/Los_Angeles' };
  let context;
  try { context = await browser.newContext({ ...opts, serviceWorkers: 'block' }); }
  catch (e) { context = await browser.newContext(opts); }
  const page = await context.newPage();
  return { context, page };
}

/* Await real visible terrain: style loaded + every tileManager's tiles loaded
   (min analysis tiles so an empty style cannot pass), else report timeout state. */
async function waitTerrain(page, { timeout = 35000, minTiles = 8 } = {}) {
  const t0 = Date.now();
  try {
    await page.waitForFunction(() => window.__map3d && window.__map3d.isStyleLoaded(), null, { timeout });
    await page.waitForFunction((min) => {
      const m = window.__map3d; if (!m || !m.isStyleLoaded()) return false;
      const tm = m.style && m.style.tileManagers; if (!tm) return false;
      let total = 0, loaded = 0;
      for (const id in tm) { const t = tm[id]; if (!t || !t.getIds) continue; for (const k of t.getIds()) { total++; if (t.getTileByID(k).state === 'loaded') loaded++; } }
      return total >= min && loaded === total;
    }, minTiles, { timeout });
    return { ok: true, ms: Date.now() - t0, state: await tileState(page) };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200), state: await tileState(page).catch(() => null) };
  }
}

async function tileState(page) {
  return page.evaluate(() => {
    const out = { managers: {}, pitch: null, bearing: null, zoom: null, center: null };
    const m = window.__map3d; if (!m) return out;
    try {
      const tm = m.style.tileManagers;
      for (const id in tm) { const t = tm[id]; out.managers[id] = t.getIds().map((k) => t.getTileByID(k).state).reduce((a, s) => (a[s] = (a[s] || 0) + 1, a), {}); }
      out.pitch = m.getPitch(); out.bearing = m.getBearing(); out.zoom = m.getZoom();
      const c = m.getCenter(); out.center = [c.lng, c.lat];
    } catch (e) { out.error = String(e.message || e); }
    return out;
  });
}

async function enter3d(page, args) {
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    const s = document.getElementById('terStyle');
    if (s) { s.value = 'slope'; s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.evaluate(() => document.getElementById('terMode3d').click());
  await page.waitForFunction(() => !!window.__map3d, null, { timeout: 30000 });
  const ready = await waitTerrain(page);
  await page.evaluate((cam) => window.__map3d.jumpTo(cam), CAMERA);
  const settled = await waitTerrain(page);
  return { ready, settled };
}

async function setStyle(page, style) {
  const before = await page.evaluate(() => window.__drapeRenders || 0);
  await page.evaluate((v) => {
    const s = document.getElementById('terStyle');
    s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
  }, style);
  /* App debounces style rebuilds (~150 ms); without this, all-tiles-loaded can
     still describe the previous style and the screenshot is stale. On the CPU
     path require a new drape render; on GPU (dataset on) renders stay flat. */
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const probe = await page.evaluate((b) => ({
      gpu: document.documentElement.dataset.gpu3d === 'on',
      renders: window.__drapeRenders || 0, b
    }), before);
    if (probe.gpu || probe.renders > before) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(200);
  return waitTerrain(page);
}

async function setControl(page, id, value, isCheckbox) {
  await page.evaluate(({ id, value, isCheckbox }) => {
    const el = document.getElementById(id); if (!el) throw new Error('missing #' + id);
    if (isCheckbox) el.checked = !!value; else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value, isCheckbox: !!isCheckbox });
}

/* Time from control dispatch to 2 presented frames + CPU/GPU deltas. */
async function measureControlResponse(page, apply, getCounters) {
  const before = await getCounters();
  const t0 = Date.now();
  await apply();
  const paintMs = await page.evaluate(() => new Promise((resolve) => {
    const start = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
  }));
  const ready = await waitTerrain(page, { timeout: 20000 });
  const after = await getCounters();
  return { wallMs: Date.now() - t0, paintMs: Math.round(paintMs), ready, delta: deltaCounters(before, after) };
}

function deltaCounters(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (typeof (b || {})[k] === 'number') out[k] = (b[k] || 0) - ((a || {})[k] || 0);
  }
  return out;
}

async function counters(page, netCounts) {
  const inPage = await page.evaluate(() => ({
    drapeRenders: window.__drapeRenders || 0,
    drapeByStyle: window.__drapeByStyle || {},
    workerPosts: window.__workerPosts || 0,
    workers: (window.__workers || []).slice()
  })).catch(() => ({ drapeRenders: null, workerPosts: null, workers: [] }));
  return { ...inPage, elevationRequests: netCounts.elevation + netCounts.national, basemapRequests: netCounts.basemap, totalRequests: netCounts.total };
}

async function rafRoute(page) {
  await page.evaluate(() => {
    window.__gaps = []; let last = 0;
    const loop = (t) => { if (last) window.__gaps.push(t - last); last = t; window.__rafH = requestAnimationFrame(loop); };
    window.__rafH = requestAnimationFrame(loop);
  });
  const legs = [];
  for (const leg of ROUTE) {
    const t0 = Date.now();
    await page.evaluate((cam) => window.__map3d.jumpTo(cam), leg);
    const ready = await waitTerrain(page, { timeout: 20000 });
    legs.push({ to: leg, ms: Date.now() - t0, readyOk: ready.ok });
    await page.waitForTimeout(250);
  }
  const gaps = await page.evaluate(() => { cancelAnimationFrame(window.__rafH); return window.__gaps || []; });
  return { legs, frames: { n: gaps.length, p50: lib2d.percentile(gaps, 50), p95: lib2d.percentile(gaps, 95), max: gaps.reduce((m, g) => Math.max(m, g), 0), over50: gaps.filter((g) => g > 50).length } };
}

async function shot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const png = await page.locator('#map3d').screenshot({ type: 'png', animations: 'disabled' });
  fs.writeFileSync(file, png);
  const img = lib2d.decodePng(png);
  /* Visible raster coverage vs MapLibre light background (#dbe6eb). */
  const stats = lib2d.imageStats(img, [219, 230, 235]);
  return { file, sha256: lib2d.sha256(png), width: img.width, height: img.height, coverage: Math.round(stats.coverage * 1000) / 1000, blank: stats.blank, mean: Math.round(stats.mean * 10) / 10 };
}

async function gpu3dStatus(page, requested) {
  return page.evaluate((requested) => {
    /* Integrator contract: window.CSPApp.gpu3d() -> controller with stats();
       document.documentElement.dataset.gpu3d = 'on'|'off'. ?gpu3d=0|1 selects. */
    let c = null, callError = null;
    try { c = typeof window.CSPApp?.gpu3d === 'function' ? window.CSPApp.gpu3d() : (window.CSPGpu3D || window.__gpu3d || null); }
    catch (e) { callError = String(e.message || e); }
    let stats = null;
    try { stats = c && typeof c.stats === 'function' ? c.stats() : null; } catch (e) { callError = String(e.message || e); }
    const dataset = document.documentElement.dataset.gpu3d || 'unset';
    const enabled = stats && typeof stats.enabled === 'boolean' ? stats.enabled : (dataset === 'on');
    return {
      requested: !!requested, available: !!c, callError, dataset, enabled, stats,
      keys: c ? Object.keys(c).slice(0, 30) : [],
      note: c ? 'controller via CSPApp.gpu3d(); stats() recorded verbatim'
        : 'GPU3D UNAVAILABLE: no window.CSPApp.gpu3d() controller in this build. GPU benchmark NOT run; do not treat CPU numbers as GPU results.'
    };
  }, requested);
}

async function gpu3dStats(page) {
  return page.evaluate(() => {
    try {
      const c = typeof window.CSPApp?.gpu3d === 'function' ? window.CSPApp.gpu3d() : null;
      return c && typeof c.stats === 'function' ? c.stats() : null;
    } catch (e) { return { error: String(e.message || e) }; }
  });
}

async function contextLossProbe(page) {
  /* Last-step, opt-in only: uses the MapLibre canvas's own WebGL2 context. */
  const supported = await page.evaluate(() => {
    const c = document.querySelector('#map3d canvas');
    if (!c) return { supported: false, why: 'no #map3d canvas' };
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    return { supported: !!ext, why: ext ? 'WEBGL_lose_context present' : 'extension absent' };
  });
  if (!supported.supported) return { attempted: false, ...supported };
  await page.evaluate(() => {
    const c = document.querySelector('#map3d canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    window.__loseExt = gl.getExtension('WEBGL_lose_context'); window.__loseExt.loseContext();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__loseExt && window.__loseExt.restoreContext());
  const ready = await waitTerrain(page, { timeout: 25000 });
  return { attempted: true, supported: true, restoredReady: ready };
}

module.exports = {
  REPO, CENTER, CAMERA, ROUTE, STYLES, parseArgs, usage, fixturePng, spawnServer, stopServer,
  launch, installFixture, newPage, waitTerrain, tileState, enter3d, setStyle, setControl,
  measureControlResponse, deltaCounters, counters, rafRoute, shot, gpu3dStatus, gpu3dStats, contextLossProbe,
  lib2d
};
