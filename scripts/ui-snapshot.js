'use strict';
/* Interaction and fidelity test for the map capture tool: the camera opens a
   selection over the map, a drag draws a new rectangle, handles resize it, a
   drag inside moves it, the resolution choice sets the output size, and Save
   downloads a PNG. The 1x export is compared pixel by pixel with a screenshot
   of the same rectangle, north-up and with the map rotated, so a placement
   error in the tile maths shows up as a failure rather than as a soft image.
   Provider tiles are replaced with a generated test pattern.

     node server.js &
     node scripts/ui-snapshot.js [http://127.0.0.1:8765/]

   Needs Playwright (npm i --no-save playwright && npx playwright install
   chromium); it is deliberately not a dependency of the app. */
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { console.error('ui-snapshot needs Playwright: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }
const fs = require('fs'), path = require('path');
const { encodePNG } = require(path.join(__dirname, '..', 'usgs.js'));
const base = process.argv[2] || 'http://127.0.0.1:8765/';
const PROVIDERS = /arcgisonline\.com|nationalmap\.gov|gibs\.earthdata|tile\.openstreetmap|s3\.amazonaws|eox\.at|cartocdn/;

/* Each tile is distinguishable from its neighbours (colour from x/y/z, a
   checkerboard, a dark border), and label layers are transparent with one
   dark bar, so an offset or scale error cannot hide in a uniform image. */
const tiles = new Map();
function patternTile(z, x, y, label) {
  const key = `${z}/${x}/${y}/${label}`;
  if (tiles.has(key)) return tiles.get(key);
  const b = Buffer.alloc(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const o = (j * 256 + i) * 4, edge = i < 2 || j < 2, check = ((i >> 5) + (j >> 5)) & 1;
    if (label) { b[o + 3] = i > 100 && i < 156 && j > 120 && j < 136 ? 255 : 0; continue; }
    b[o] = edge ? 20 : (x * 53 + z * 31) & 255; b[o + 1] = edge ? 20 : (y * 97) & 255; b[o + 2] = check ? 200 : 120; b[o + 3] = 255;
  }
  const png = encodePNG(b, 256, 256); tiles.set(key, png); return png;
}
const pngSize = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

(async () => {
  const browser = await chromium.launch();
  const results = []; const ok = (name, cond, info = '') => results.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`);
  const errs = [];
  for (const bearing of [0, 30]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
    await ctx.route(PROVIDERS, route => {
      const url = route.request().url(), m = url.match(/\/(\d+)\/(\d+)\/(\d+)(?:\.png|\.jpg|$|\?)/);
      const label = /Reference|Transportation|Boundaries|Hydro/.test(url);
      route.fulfill({ body: m ? patternTile(+m[1], +m[3], +m[2], label) : patternTile(0, 0, 0, true), contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
    });
    /* The map lives in the page's script scope; catch it as Leaflet builds it
       so the test can rotate it the way leaving 3D does. */
    await ctx.addInitScript(() => {
      let leaflet; Object.defineProperty(window, 'L', { configurable: true, get() { return leaflet; },
        set(v) { leaflet = v; try { v.Map.addInitHook(function () { window.__cspTestMap = this; }); } catch (e) {} } });
      try {
        localStorage.setItem('clearskies.overlays.v1', JSON.stringify({ on: { labels: true }, op: 90 }));
        localStorage.setItem('clearskies.alerts.v1', JSON.stringify({ nws: false, quakes: false, volcanoes: false, fires: false }));
      } catch (e) {}
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { if (!document.body.classList.contains('collapsed')) document.getElementById('sideToggle').click(); });
    if (bearing) await page.evaluate(b => window.__cspTestMap.setBearing(b), bearing);
    await page.waitForTimeout(1500);
    const tag = bearing ? ` (bearing ${bearing})` : '';
    const selRect = () => page.evaluate(() => {
      const b = document.getElementById('snapSelBox'), m = b.style.transform.match(/translate\(([-\d.]+)px, *([-\d.]+)px\)/);
      return { x: +m[1], y: +m[2], w: parseFloat(b.style.width), h: parseFloat(b.style.height) };
    });

    await page.click('#snapshot');
    await page.waitForTimeout(300);
    ok('camera opens the selection' + tag, await page.$eval('#snapSel', e => !e.hidden));
    const def = await selRect();
    ok('a default selection is proposed' + tag, def.w > 200 && def.h > 150, `${def.w}x${def.h}`);

    // draw a new rectangle on the dimmed map, outside the proposed one
    await page.mouse.move(30, 70); await page.mouse.down(); await page.mouse.move(330, 270, { steps: 8 }); await page.mouse.up();
    let r = await selRect();
    ok('dragging on the map draws a new selection' + tag, r.x === 30 && r.y === 70 && r.w === 300 && r.h === 200, JSON.stringify(r));
    const se = await page.$('#snapSelBox [data-h="se"]').then(e => e.boundingBox());
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2); await page.mouse.down();
    await page.mouse.move(se.x + se.width / 2 + 40, se.y + se.height / 2 + 20, { steps: 4 }); await page.mouse.up();
    r = await selRect();
    ok('the corner handle resizes' + tag, r.w === 340 && r.h === 220, JSON.stringify(r));
    await page.mouse.move(130, 170); await page.mouse.down(); await page.mouse.move(510, 320, { steps: 8 }); await page.mouse.up();
    r = await selRect();
    ok('dragging inside moves it' + tag, r.x === 410 && r.y === 220 && r.w === 340, JSON.stringify(r));
    await page.mouse.move(1270, 790);

    // what is on screen under the rectangle, without the selection or any hover readout
    await page.addStyleTag({ content: '#snapSel{visibility:hidden!important}.leaflet-tooltip,.leaflet-popup{display:none!important}' });
    await page.waitForTimeout(100);
    const shot = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
    await page.addStyleTag({ content: '#snapSel{visibility:visible!important}' });

    for (const scale of [1, 4]) {
      await page.click(`#snapSelRes [data-scale="${scale}"]`);
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }).catch(() => null), page.click('#snapSelSave')]);
      const file = download ? await download.path() : null, png = file ? fs.readFileSync(file) : null, size = png ? pngSize(png) : null;
      ok(`${scale}x saves a ${r.w * scale}x${r.h * scale} PNG${tag}`, size && size.w === r.w * scale && size.h === r.h * scale, size ? `${size.w}x${size.h}` : 'no download');
      ok(`${scale}x closes the selection${tag}`, await page.$eval('#snapSel', e => e.hidden));
      if (scale === 1 && png) {
        const diff = await page.evaluate(async ([a, b]) => {
          const load = async src => { const img = new Image(); img.src = src; await img.decode(); const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
          const A = await load(a), B = await load(b); if (A.length !== B.length) return 1;
          let off = 0; for (let i = 0; i < A.length; i += 4)
            if ((Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3 > 40) off++;
          return off / (A.length / 4);
        }, ['data:image/png;base64,' + shot.toString('base64'), 'data:image/png;base64,' + png.toString('base64')]);
        /* Rotated, the browser and the canvas antialias the diagonal tile
           borders differently; that is edge pixels, not placement. */
        ok('1x export matches the screen' + tag, diff < (bearing ? 0.02 : 0.005), `${(diff * 100).toFixed(2)}% of pixels differ`);
      }
      await page.click('#snapshot'); await page.waitForTimeout(250);
    }
    await page.keyboard.press('Escape');
    ok('Escape cancels' + tag, await page.$eval('#snapSel', e => e.hidden));
    await ctx.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  console.log(errs.length ? 'page errors:\n  ' + errs.join('\n  ') : 'no page errors');
  process.exit(results.some(line => line.startsWith('FAIL')) || errs.length ? 1 : 0);
})();
