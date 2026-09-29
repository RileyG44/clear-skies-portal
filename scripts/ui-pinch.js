'use strict';
/* Phone gesture test: a touch pinch (in, out, and twisting) on a 390x844, 3x
   screen, with terrain and label overlays on. It checks what went wrong on
   iOS:
   - label overlays stay on the base map through every frame of a pinch, also
     while the map rotates (compared through each tile's full transform chain);
   - the terrain layer is not rebuilt by pinching and panning;
   - canvases are released: iOS Safari caps total canvas memory, and past the
     cap new tiles draw black.
   Provider and elevation tiles are replaced with generated ones.

     node server.js &
     node scripts/ui-pinch.js [http://127.0.0.1:8765/]

   Needs Playwright (npm i --no-save playwright && npx playwright install
   chromium); it is deliberately not a dependency of the app. */
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { console.error('ui-pinch needs Playwright: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }
const path = require('path');
const { encodePNG } = require(path.join(__dirname, '..', 'usgs.js'));
const base = process.argv[2] || 'http://127.0.0.1:8765/';

/* A gently sloping Terrarium tile (so hillshade has something to shade) and a
   plain image tile for everything else. */
const terrarium = (() => {
  const b = Buffer.alloc(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const v = Math.round((1000 + 2 * i + j + 32768) * 256), o = (j * 256 + i) * 4;
    b[o] = v >> 16; b[o + 1] = (v >> 8) & 255; b[o + 2] = v & 255; b[o + 3] = 255;
  }
  return encodePNG(b, 256, 256);
})();
const image = (() => {
  const b = Buffer.alloc(256 * 256 * 4);
  for (let i = 0; i < 256 * 256; i++) { b[i * 4] = 120; b[i * 4 + 1] = 140; b[i * 4 + 2] = 150; b[i * 4 + 3] = 255; }
  return encodePNG(b, 256, 256);
})();

(async () => {
  const browser = await chromium.launch();
  const results = []; const ok = (name, cond, info = '') => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const later = ms => new Promise(r => setTimeout(r, ms * (0.6 + Math.random() * 0.8)));
  await ctx.route(/elevation-tiles-prod|\/api\/elev\/|\/api\/usgs\/elev\//, async r => {
    await later(120); r.fulfill({ body: terrarium, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
  });
  await ctx.route(/arcgisonline|nationalmap\.gov|gibs|openstreetmap|eox\.at|cartocdn|\/api\/3dep|\/api\/wadnr\/export/, async r => {
    await later(90); r.fulfill({ body: image, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
  });
  await ctx.addInitScript(() => {
    let leaflet; Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; },
      set(v) { leaflet = v; try { v.Map.addInitHook(function () { window.__cspTestMap = this;
        this.on('layeradd', e => { if (e.layer._tiles && e.layer.options.zIndex === 440) window.__terrainBuilds = (window.__terrainBuilds || 0) + 1; }); }); } catch (e) {} } });
    const all = window.__canvases = []; const create = Document.prototype.createElement;
    Document.prototype.createElement = function (name, ...rest) { const el = create.call(this, name, ...rest); if (String(name).toLowerCase() === 'canvas') all.push(el); return el; };
    try {
      localStorage.setItem('clearskies.terrain.v2', JSON.stringify({ style: 'hs', opacity: 70 }));
      localStorage.setItem('clearskies.overlays.v1', JSON.stringify({ on: { labels: true }, op: 90 }));
      localStorage.setItem('clearskies.alerts.v1', JSON.stringify({ nws: false, quakes: false, volcanoes: false, fires: false }));
    } catch (e) {}
  });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { if (!document.body.classList.contains('collapsed')) document.getElementById('sideToggle').click(); });
  await page.evaluate(() => window.__cspTestMap.setView([46.85, -121.76], 12, { animate: false }));
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__buildsBefore = window.__terrainBuilds || 0; });

  /* Every frame: the worst distance between a label tile's corners and the
     base tile with the same coordinates, through all ancestor transforms. */
  await page.evaluate(() => {
    window.__worst = []; window.__sampling = true;
    const chain = el => { let m = new DOMMatrix(), n = el;
      while (n && n.id !== 'map') { const cs = getComputedStyle(n); let local = new DOMMatrix().translate(n.offsetLeft || 0, n.offsetTop || 0);
        if (cs.transform && cs.transform !== 'none') { const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat); local = local.translate(ox, oy).multiply(new DOMMatrix(cs.transform)).translate(-ox, -oy); }
        m = local.multiply(m); n = n.parentElement; } return m; };
    const tick = () => {
      let baseLayer = null, labels = null;
      window.__cspTestMap.eachLayer(l => { if (!l._tiles) return; if (l.options.pane === 'overlayPane') labels = labels || l; else if (l.options.zIndex !== 440) baseLayer = baseLayer || l; });
      if (baseLayer && labels) { let worst = 0;
        for (const key in labels._tiles) { const a = labels._tiles[key], b = baseLayer._tiles[key];
          if (!a || !b || !a.el.isConnected || !b.el.isConnected) continue;
          const ma = chain(a.el), mb = chain(b.el);
          for (const [x, y] of [[0, 0], [256, 256]]) { const pa = ma.transformPoint(new DOMPoint(x, y)), pb = mb.transformPoint(new DOMPoint(x, y)); worst = Math.max(worst, Math.hypot(pa.x - pb.x, pa.y - pb.y)); } }
        window.__worst.push(worst); }
      if (window.__sampling) requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pinch = async (from, to, twist = 0) => {
    const cx = 165, cy = 230, at = (r, a) => [{ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 1 }, { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 2 }];
    await touch('touchStart', at(from, 0));
    for (let i = 1; i <= 36; i++) { await touch('touchMove', at(from + (to - from) * i / 36, twist * i / 36)); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(900);
  };
  const pan = async (dx, dy) => {
    await touch('touchStart', [{ x: 165, y: 260, id: 1 }]);
    for (let i = 1; i <= 16; i++) { await touch('touchMove', [{ x: 165 + dx * i / 16, y: 260 + dy * i / 16, id: 1 }]); await page.waitForTimeout(16); }
    await touch('touchEnd', []); await page.waitForTimeout(600);
  };
  const zoom0 = await page.evaluate(() => window.__cspTestMap.getZoom());
  await pinch(30, 110); await pan(-120, 90); await pinch(110, 30); await pan(140, -60);
  await pinch(30, 100, 1.1);
  const zoom1 = await page.evaluate(() => window.__cspTestMap.getZoom());
  const bearing = await page.evaluate(() => window.__cspTestMap.getBearing());
  const worst = await page.evaluate(() => { window.__sampling = false; return window.__worst; });
  worst.sort((a, b) => a - b);
  ok('pinches zoom the map', Math.abs(zoom1 - zoom0) > 0.5, `${zoom0.toFixed(2)} -> ${zoom1.toFixed(2)}`);
  ok('a twisting pinch rotates it', Math.abs(bearing) > 5, `bearing ${bearing.toFixed(1)}`);
  ok('labels stay on the base map in every pinch frame', worst.length > 50 && worst[worst.length - 1] <= 2,
     `${worst.length} frames, worst ${worst[worst.length - 1]?.toFixed(2)} px`);
  const builds = await page.evaluate(() => (window.__terrainBuilds || 0) - window.__buildsBefore);
  ok('pinching and panning never rebuild the terrain layer', builds === 0, `${builds} rebuilds`);
  const canvases = await page.evaluate(() => { let live = 0, px = 0; for (const c of window.__canvases) if (c.width * c.height > 0) { live++; px += c.width * c.height; } return { created: window.__canvases.length, live, mb: px * 4 / 1048576 }; });
  ok('canvases are released as tiles leave', canvases.mb < 40, `${canvases.live} of ${canvases.created} canvases hold ${canvases.mb.toFixed(1)} MB`);
  await browser.close();
  console.log(results.join('\n'));
  console.log(errs.length ? 'page errors:\n  ' + errs.join('\n  ') : 'no page errors');
  process.exit(results.some(line => line.startsWith('FAIL')) || errs.length ? 1 : 0);
})();
