'use strict';
/* Deep zoom on a phone: a 390x844, 3x screen pinches from z15 down to ~z19.5
   over 1 m LiDAR, against an engine as slow as a real one (raw 1 m renders
   take 1.5 s, four at a time; WA DNR exports 1-2 s). Then it reports, every
   second, how much of the screen shows LiDAR itself rather than the coarse
   overview, and fails if the finest LiDAR has not reached the whole screen.

     node server.js &
     node scripts/ui-deep-zoom.js [http://127.0.0.1:8765/] [slope|hs]

   Needs Playwright (npm i --no-save playwright && npx playwright install
   chromium); it is deliberately not a dependency of the app. */
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { console.error('ui-deep-zoom needs Playwright: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }
const path = require('path');
const { encodePNG } = require(path.join(__dirname, '..', 'usgs.js'));
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const style = process.argv[3] || 'slope';
const reportOnly = process.env.UI_DEEP_ZOOM_REPORT_ONLY === '1';

const terrarium = (() => {
  const b = Buffer.alloc(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const v = Math.round((1000 + 3 * Math.sin(i / 9) + 2 * Math.cos(j / 7) + 32768) * 256), o = (j * 256 + i) * 4;
    b[o] = v >> 16; b[o + 1] = (v >> 8) & 255; b[o + 2] = v & 255; b[o + 3] = 255;
  }
  return encodePNG(b, 256, 256);
})();
const shaded = size => {
  const b = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = 150 + (i % 13) * 4; b[i * 4 + 3] = 255; }
  return encodePNG(b, size, size);
};
const png256 = shaded(256), png512 = shaded(512);
function engine(slots) {
  let active = 0; const waiting = [];
  return async (ms, work, signal) => {
    if (active >= slots) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { await new Promise(resolve => setTimeout(resolve, ms)); return await work(); }
    finally { active--; const next = waiting.shift(); if (next) next(); }
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const raw = engine(4), national = engine(4), wa = engine(6), dep = engine(8);
  const counts = {}; const note = k => { counts[k] = (counts[k] || 0) + 1; };
  const fulfill = (route, body) => route.fulfill({ body, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
  await ctx.route(/\/api\/wadnr\/layers/, r => r.fulfill({ json: { layers: [{ id: 3, name: '101h', extent: { xmin: -2e7, ymin: -2e7, xmax: 2e7, ymax: 2e7 } }] } }));
  await ctx.route(/\/api\/wadnr\/query/, r => r.fulfill({ json: [{ project_name: 'Test 2020', dataset_name: 'DTM Hillshade', dataset_id: 101, bytes: 1 }] }));
  await ctx.route(/\/api\/wadnr\/export/, route => {
    const u = new URL(route.request().url()), size = +(u.searchParams.get('size') || '256').split(',')[0];
    note(`wa ${size}@${u.searchParams.get('dpi') || 96}`);
    return wa(size > 256 ? 2000 : 1000, () => fulfill(route, size > 256 ? png512 : png256));
  });
  await ctx.route(/\/api\/3dep/, route => { note('3dep'); return dep(600, () => fulfill(route, png256)); });
  await ctx.route(/\/api\/usgs\/elev\//, route => {
    const z = route.request().url().match(/elev\/(\d+)\//)[1]; note(`raw z${z}`);
    return raw(1500, () => fulfill(route, terrarium));
  });
  await ctx.route(/\/api\/elev\/national/, route => { note('national'); return national(500, () => fulfill(route, terrarium)); });
  await ctx.route(/elevation-tiles-prod/, route => { note('overview'); return dep(200, () => fulfill(route, terrarium)); });
  await ctx.route(/arcgisonline|nationalmap\.gov\/arcgis\/rest\/services\/(?!3DEP)|gibs|eox\.at|cartocdn/, route => {
    const z = +(route.request().url().match(/\/tile\/(\d+)\//) || [])[1];
    if (z) note(`basemap z${z}`);
    return fulfill(route, png256);
  });
  await ctx.addInitScript(style => {
    let leaflet; Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; },
      set(v) { leaflet = v; try { v.Map.addInitHook(function () { window.__cspTestMap = this; }); } catch (e) {} } });
    try {
      localStorage.setItem('clearskies.terrain.v2', JSON.stringify({ style, source: style === 'hs' ? 'wadnr' : 'usgs1m', opacity: 80 }));
      localStorage.setItem('clearskies.alerts.v1', JSON.stringify({ nws: false, quakes: false, volcanoes: false, fires: false }));
    } catch (e) {}
  }, style);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cspTestMap, null, { timeout: 15000 });
  await page.evaluate(() => { if (!document.body.classList.contains('collapsed')) document.getElementById('sideToggle')?.click(); });
  await page.evaluate(() => window.__cspTestMap.setView([46.85, -121.76], 15, { animate: false }));
  await page.waitForTimeout(6000);

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pinch = async (from, to) => {
    const cx = 165, cy = 330, at = r => [{ x: cx + r, y: cy, id: 1 }, { x: cx - r, y: cy, id: 2 }];
    await touch('touchStart', at(from));
    for (let i = 1; i <= 30; i++) { await touch('touchMove', at(from + (to - from) * i / 30)); await page.waitForTimeout(16); }
    await touch('touchEnd', []); await page.waitForTimeout(400);
  };
  for (let i = 0; i < 3; i++) await pinch(40, 110);
  const zoom = await page.evaluate(() => window.__cspTestMap.getZoom());

  /* LiDAR on screen: each visible tile of the terrain layer's current level
     that shows LiDAR (1 m elevation, or WA DNR pixels), and how finely. */
  const sample = () => page.evaluate(() => {
    const map = window.__cspTestMap; let layer = null;
    map.eachLayer(l => { if (l._tiles && /terrain-style-/.test(l.options.className || '')) layer = l; });
    if (!layer) return null;
    const size = map.getSize(); let total = 0, lidar = 0, finest = 0, cssPerSample = 0;
    for (const key in layer._tiles) {
      const t = layer._tiles[key]; if (t.coords.z !== layer._tileZoom) continue;
      const r = t.el.getBoundingClientRect(); if (r.right < 0 || r.bottom < 0 || r.left > size.x || r.top > size.y) continue;
      total++;
      const isLidar = t.el._cspUrls ? (t.el._cspSourceCounts || {})[4] > 0 : t.el.dataset.cspQuality === '3';
      if (isLidar) lidar++;
      if (isLidar && !t.el._cspRefining) finest++;
      cssPerSample = Math.max(cssPerSample, r.width / (t.el.width || 256));
    }
    return { total, lidar, finest, tileZoom: layer._tileZoom, cssPerSample: +cssPerSample.toFixed(2) };
  });
  const timeline = []; let lidarAt = null, finestAt = null; const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const s = await sample(); const t = Date.now() - t0;
    if (s) {
      timeline.push(`${(t / 1000).toFixed(0)}s ${s.lidar}/${s.total}`);
      if (lidarAt == null && s.total && s.lidar === s.total) lidarAt = t;
      if (finestAt == null && s.total && s.finest === s.total) { finestAt = t; break; }
    }
    await page.waitForTimeout(1000);
  }
  const last = await sample();
  await browser.close();
  const lines = [];
  const ok = (name, cond, info) => lines.push(`${cond ? 'ok  ' : 'FAIL'} ${name}  ${info}`);
  ok(`${style}: pinched to deep zoom`, zoom > 19, `z${zoom.toFixed(2)}, terrain tiles z${last?.tileZoom}, ${last?.cssPerSample} CSS px per sample`);
  ok(`${style}: LiDAR over the whole screen`, lidarAt != null, lidarAt != null ? `${(lidarAt / 1000).toFixed(1)} s after the last pinch` : `not in 30 s (${timeline.slice(-1)[0] || 'no terrain layer'})`);
  ok(`${style}: finest LiDAR everywhere`, finestAt != null, finestAt != null ? `${(finestAt / 1000).toFixed(1)} s` : 'not in 30 s');
  console.log(lines.join('\n'));
  console.log('timeline (LiDAR tiles / visible):', timeline.join(', '));
  console.log('requests:', Object.entries(counts).sort().map(([k, v]) => `${k}: ${v}`).join(', '));
  console.log(errs.length ? 'page errors:\n  ' + errs.join('\n  ') : 'no page errors');
  process.exit(!reportOnly && (lines.some(l => l.startsWith('FAIL')) || errs.length) ? 1 : 0);
})();
