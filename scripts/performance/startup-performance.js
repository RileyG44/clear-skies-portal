/* Startup timing and real-map dissolve captures, with optional CPU emulation.
   node scripts/performance/startup-performance.js <assembled-site> <output>
   Static assets come from the assembled site; external map data remains live.
   CPU throttling is a diagnostic, not a claim about physical phone hardware. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(process.argv[2] || '_site');
const output = path.resolve(process.argv[3] || 'artifacts/startup-performance');
const origin = 'https://rileyg44.github.io/clear-skies-portal/';
const tileDelay = Number(process.argv[5]) || 0;
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  try {
    for (const [theme, cpu] of [['light', 1], ['dark', 1], ['light', 4], ['dark', 4]]) {
      const name = `${theme}-${cpu}x`;
      if (process.argv[4] && process.argv[4] !== name) continue;
      const context = await browser.newContext({ viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      const pending = new Set();
      page.on('request', request => pending.add(request));
      page.on('requestfinished', request => pending.delete(request));
      page.on('requestfailed', request => pending.delete(request));
      page.on('pageerror', e => errors.push(e.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await page.route(`${origin}**`, async route => {
        const relative = new URL(route.request().url()).pathname.replace('/clear-skies-portal/', '');
        const file = path.join(root, relative);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) await route.fulfill({ path: file });
        else await route.continue();
      });
      if (tileDelay) await page.route('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/**', async route => {
        try {
          const started = Date.now(), response = await route.fetch();
          await new Promise(resolve => setTimeout(resolve, Math.max(0, tileDelay - (Date.now() - started))));
          await route.fulfill({ response });
        } catch { await route.abort().catch(() => {}); }
      });
      await page.addInitScript(theme => {
        localStorage.setItem('clearskies.mapTheme.v1', theme);
        // Separate still captures from the uninterrupted timing run. Pause
        // only the plate's compositor animation, at an exact point in its
        // real transition over the fully loaded map.
        if (sessionStorage.getItem('startupCapture')) document.addEventListener('csp:splash', () => {
          const a = document.getElementById('cspSplash').getAnimations()[0];
          a.pause(); a.currentTime = 250;
        }, { capture: true, once: true });
        const m = window.startupMeasurement = { events: [], intervals: [], longTasks: [] };
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) m.longTasks.push({ at: e.startTime, duration: e.duration });
        }).observe({ type: 'longtask', buffered: true });
        let last = 0, previous = '';
        const frame = now => {
          const r = document.documentElement, c = document.getElementById('cspSplashTree');
          const state = [r?.classList.contains('csp-splash') ? 'covered' : 'open',
            c?.classList.contains('on') ? 'tree' : 'blank',
            r?.classList.contains('csp-splash-out') ? 'fading' : '',
            r?.classList.contains('csp-map-staging') ? 'map-staging' : ''].join(' ').trim();
          if (state !== previous) { m.events.push({ at: now, state }); previous = state; }
          if (c?.classList.contains('on') && last) m.intervals.push(now - last);
          last = now;
          if (!window.CSPBoot?.splash?.done || document.getElementById('cspSplash')) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }, theme);
      await page.goto(`${origin}map.html?startup-performance=${name}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#cspSplashTree.on', { timeout: 20000 });
      await page.waitForSelector('#cspSplash', { state: 'detached', timeout: 35000 });
      const report = await page.evaluate(() => ({ build: CSP_BUILD, ...startupMeasurement,
        classes: document.documentElement.className, theme: document.documentElement.dataset.uiTheme,
        failed: CSPBoot.failed }));
      const sorted = report.intervals.slice().sort((a, b) => a - b);
      const percentile = n => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * n))];
      report.framePacing = { samples: sorted.length, medianMs: percentile(.5), p95Ms: percentile(.95),
        framesOver50ms: sorted.filter(n => n > 50).length };
      delete report.intervals;
      Object.assign(report, { cpu, errors });
      if (report.failed) {
        report.pending = [...pending].map(request => {
          const u = new URL(request.url()); return u.origin + u.pathname;
        });
        try {
          await page.waitForFunction(() => !CSPBoot.failed && !document.documentElement.classList.contains('csp-map-staging'), null, { timeout: 20000 });
          report.settledAfterRecoveryMs = await page.evaluate(() => performance.now());
        } catch { report.settledAfterRecoveryMs = null; }
      }
      fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(report, null, 2));
      assert.equal(report.failed, false);
      assert.equal(report.theme, theme);
      assert(!/csp-map-staging|csp-terrain-pending/.test(report.classes));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, `${name}-map.png`) });
      console.log(name, JSON.stringify(report));
      if (cpu === 1) {
        await page.evaluate(() => sessionStorage.setItem('startupCapture', '1'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('cspSplash')?.getAnimations()[0]?.playState === 'paused');
        const captures = [];
        for (const target of [250, 500]) {
          const state = await page.evaluate(target => {
            const el = document.getElementById('cspSplash');
            el.getAnimations()[0].currentTime = target;
            return { fadeMs: target, opacity: +getComputedStyle(el).opacity,
              staged: document.documentElement.classList.contains('csp-map-staging'),
              inert: document.getElementById('app').inert };
          }, target);
          await page.screenshot({ path: path.join(output, `${name}-fade-${target}.png`) });
          assert.equal(state.staged, false, 'the real map is ready underneath the dissolve');
          assert.equal(state.inert, true, 'controls remain unavailable under the cover');
          captures.push(state);
        }
        fs.writeFileSync(path.join(output, `${name}-captures.json`), JSON.stringify(captures, null, 2));
      }
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
