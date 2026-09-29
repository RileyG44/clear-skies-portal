'use strict';
/* How fast terrain fills a phone screen, and how sharp it ends up. A 390x844,
   3x screen opens on (1) the WA DNR LiDAR hillshade at z16 and (2) a slope map
   drawn from raw 1 m elevation at z14. The engine is simulated with its real
   shape: a few renders at a time, and bigger images taking longer.
   - the screen is covered quickly (the first pass asks for what the on-screen
     zoom always did, not four times as much);
   - WA DNR is never asked for 512 px at 96 dpi - one level past its tile cache,
     which comes back stamped "Map data not yet available";
   - after that, every tile sharpens to the full-density source.

     node server.js &
     node scripts/ui-tile-load.js [http://127.0.0.1:8765/]

   Needs Playwright (npm i --no-save playwright && npx playwright install
   chromium); it is deliberately not a dependency of the app. */
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { console.error('ui-tile-load needs Playwright: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }
const path = require('path');
const { encodePNG } = require(path.join(__dirname, '..', 'usgs.js'));
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const quick = process.env.UI_TILE_LOAD_REPORT_ONLY === '1';

const terrarium = (() => {
  const b = Buffer.alloc(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const v = Math.round((1000 + 2 * i + j + 32768) * 256), o = (j * 256 + i) * 4;
    b[o] = v >> 16; b[o + 1] = (v >> 8) & 255; b[o + 2] = v & 255; b[o + 3] = 255;
  }
  return encodePNG(b, 256, 256);
})();
const shaded = size => {
  const b = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { b[i * 4] = b[i * 4 + 1] = b[i * 4 + 2] = 170 + (i % 7); b[i * 4 + 3] = 255; }
  return encodePNG(b, size, size);
};
const png256 = shaded(256), png512 = shaded(512);

/* A bounded pool: `slots` renders at once, each taking `ms` (scaled by pixels). */
function engine(slots) {
  let active = 0; const waiting = [];
  const run = async (ms, work) => {
    if (active >= slots) await new Promise(resolve => waiting.push(resolve));
    active++;
    try { await new Promise(resolve => setTimeout(resolve, ms)); return await work(); }
    finally { active--; const next = waiting.shift(); if (next) next(); }
  };
  return run;
}

async function scenario(browser, name, { view, terrain, source }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const log = []; const raw = engine(4), wa = engine(6), dep = engine(8);
  const fulfill = (route, body) => route.fulfill({ body, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
  await ctx.route(/\/api\/wadnr\/layers/, r => r.fulfill({ json: { layers: [{ id: 3, name: '101h', extent: { xmin: -2e7, ymin: -2e7, xmax: 2e7, ymax: 2e7 } }] } }));
  await ctx.route(/\/api\/wadnr\/query/, r => r.fulfill({ json: [{ project_name: 'Test 2020', dataset_name: 'DTM Hillshade', dataset_id: 101, bytes: 1 }] }));
  await ctx.route(/\/api\/wadnr\/export/, route => {
    const u = new URL(route.request().url()), size = +u.searchParams.get('size').split(',')[0];
    log.push({ kind: 'wa', size, dpi: u.searchParams.get('dpi') || '96', t: Date.now() });
    return wa(size > 256 ? 700 : 350, () => fulfill(route, size > 256 ? png512 : png256));
  });
  await ctx.route(/\/api\/3dep/, route => {
    const size = +new URL(route.request().url()).searchParams.get('size') || 256;
    log.push({ kind: '3dep', size, t: Date.now() });
    return dep(size > 256 ? 300 : 150, () => fulfill(route, size > 256 ? png512 : png256));
  });
  await ctx.route(/\/api\/usgs\/elev\//, route => {
    const z = +route.request().url().match(/elev\/(\d+)\//)[1];
    log.push({ kind: 'raw', z, t: Date.now() });
    return raw(450, () => fulfill(route, terrarium));
  });
  await ctx.route(/\/api\/elev\/|elevation-tiles-prod/, route => {
    log.push({ kind: 'elev', t: Date.now() });
    return dep(120, () => fulfill(route, terrarium));
  });
  await ctx.route(/\/api\/usgs\/cover|\/api\/usgs\/coverage/, r => r.fulfill({ json: { type: 'FeatureCollection', features: [] } }).catch(() => {}));
  await ctx.route(/arcgisonline|nationalmap\.gov\/arcgis\/rest\/services\/(?!3DEP)|gibs|eox\.at|cartocdn/, r => fulfill(r, png256));
  await ctx.addInitScript(([terrain, source]) => {
    let leaflet; Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; },
      set(v) { leaflet = v; try { v.Map.addInitHook(function () { window.__cspTestMap = this; }); } catch (e) {} } });
    try {
      localStorage.setItem('clearskies.terrain.v2', JSON.stringify({ style: terrain, source, opacity: 80 }));
      localStorage.setItem('clearskies.alerts.v1', JSON.stringify({ nws: false, quakes: false, volcanoes: false, fires: false }));
    } catch (e) {}
  }, [terrain, source]);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(base + '#' , { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cspTestMap, null, { timeout: 15000 });
  await page.evaluate(() => { if (!document.body.classList.contains('collapsed')) document.getElementById('sideToggle')?.click(); });
  await page.waitForTimeout(1500);
  const t0 = Date.now(); log.length = 0;
  await page.evaluate(([lat, lng, z]) => window.__cspTestMap.setView([lat, lng], z, { animate: false }), view);
  /* Coverage of the screen by terrain tiles that have real pixels. */
  const cover = () => page.evaluate(() => {
    const map = window.__cspTestMap; let layer = null;
    map.eachLayer(l => { if (l._tiles && /terrain-style-/.test(l.options.className || '')) layer = l; });
    if (!layer) { const seen = []; map.eachLayer(l => { if (l._tiles) seen.push(`${l.options.zIndex}:${l._tileZoom}:${Object.keys(l._tiles).length}`); });
      return { ready: 0, total: 0, sharp: 0, kind: 'none', seen: seen.join(' '), style: document.getElementById('terStyle')?.value, src: document.getElementById('terSrc')?.value }; }
    const size = map.getSize(); let ready = 0, total = 0, sharp = 0, lidar = 0;
    for (const key in layer._tiles) {
      const t = layer._tiles[key]; if (t.coords.z !== layer._tileZoom) continue;
      const r = t.el.getBoundingClientRect(); if (r.right < 0 || r.bottom < 0 || r.left > size.x || r.top > size.y) continue;
      total++; if (t.el._cspHasContent) ready++;
      // LiDAR itself on screen: WA DNR pixels, or 1 m elevation.
      if (t.el._cspUrls ? (t.el._cspSourceCounts || {})[4] > 0 : t.el.dataset.cspQuality === '3') lidar++;
      if (t.el._cspUrls ? /size=512/.test(t.el._cspUrls.detail || '') || /size=512/.test(t.el._cspUrls.base || '') : !t.el._cspRefining) sharp++;
    }
    return { ready, total, sharp, lidar, kind: 'terrain', tileZoom: layer._tileZoom, zoom: map.getZoom() };
  });
  let covered = null, lidarAt = null, sharpAt = null, last = null;
  while (Date.now() - t0 < 45000) {
    last = await cover();
    if (covered == null && last.total && last.ready === last.total) covered = Date.now() - t0;
    if (lidarAt == null && last.total && last.lidar === last.total) lidarAt = Date.now() - t0;
    if (lidarAt != null && last.total && last.sharp === last.total) { sharpAt = Date.now() - t0; break; }
    await page.waitForTimeout(100);
  }
  await ctx.close();
  return { name, covered, lidarAt, sharpAt, last, log, errs };
}

(async () => {
  const browser = await chromium.launch();
  const results = []; const ok = (name, cond, info = '') => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`);
  const wa = await scenario(browser, 'WA DNR hillshade', { view: [46.85, -121.76, 16], terrain: 'hs', source: 'wadnr' });
  const count = (log, test) => log.filter(test).length;
  const firstWa = wa.log.filter(e => e.kind === 'wa');
  ok('WA DNR: screen covered', wa.covered != null, `in ${wa.covered} ms (${wa.last.ready}/${wa.last.total} tiles)`);
  ok('WA DNR: never asks for 512 px at 96 dpi (past its tile cache)', !firstWa.some(e => e.size === 512 && e.dpi === '96'),
     `${count(firstWa, e => e.size === 256)} x 256 px, ${count(firstWa, e => e.size === 512 && e.dpi === '192')} x 512 px @192, ${count(firstWa, e => e.size === 512 && e.dpi === '96')} x 512 px @96`);
  ok('WA DNR: LiDAR over the whole screen', wa.lidarAt != null, `in ${wa.lidarAt} ms`);
  ok('WA DNR: every tile sharpens to 512 px', wa.sharpAt != null, `by ${wa.sharpAt} ms`);
  const slope = await scenario(browser, 'raw 1 m slope', { view: [46.85, -121.76, 14], terrain: 'slope', source: 'usgs1m' });
  const rawLog = slope.log.filter(e => e.kind === 'raw'), zs = [...new Set(rawLog.map(e => e.z))].sort();
  ok('1 m slope: screen covered', slope.covered != null, `in ${slope.covered} ms (${slope.last.ready}/${slope.last.total} tiles)${slope.covered == null ? ' ' + JSON.stringify(slope.last) : ''}`);
  ok('1 m slope: 1 m LiDAR over the whole screen', slope.lidarAt != null, `in ${slope.lidarAt} ms`);
  ok('1 m slope: sharpened to the next zoom', slope.sharpAt != null, `by ${slope.sharpAt} ms; raw renders ${zs.map(z => `z${z}: ${count(rawLog, e => e.z === z)}`).join(', ')}`);
  await browser.close();
  console.log(results.join('\n'));
  const errs = [...wa.errs, ...slope.errs];
  console.log(errs.length ? 'page errors:\n  ' + errs.join('\n  ') : 'no page errors');
  process.exit(!quick && (results.some(line => line.startsWith('FAIL')) || errs.length) ? 1 : 0);
})();
