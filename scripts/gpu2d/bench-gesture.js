'use strict';
/* Spec §9.2. rAF timing and coverage are separate passes. Coverage is a
   Playwright screenshot. The timed pass does not read pixels. */
const h = require('./harness-lib');

async function pointer(page) {
  const box = await h.mapBox(page);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function wheel(page, delta, steps, pause) {
  const at = await pointer(page);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, delta);
    if (pause) await page.waitForTimeout(pause);
  }
}

async function drag(page) {
  const at = await pointer(page);
  const shifts = [[180, 40], [-220, 30], [40, 140], [-30, -160]];
  for (const [dx, dy] of shifts) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(at.x + dx * i / 8, at.y + dy * i / 8);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
}

async function centerCoverage(page) {
  const box = await page.locator('#map').boundingBox();
  const clip = {
    x: Math.round(box.width * 0.22),
    y: Math.round(box.height * 0.22),
    width: Math.round(box.width * 0.56),
    height: Math.round(box.height * 0.56)
  };
  const shot = await h.coverageShot(page, { clip });
  const resident = await page.evaluate(() => window.__cspGpu2d.ancestorResident());
  return {
    coverage: h.round(shot.stats.coverage, 4),
    white: h.round(shot.stats.white, 4),
    blank: shot.stats.blank,
    resident,
    method: shot.method
  };
}

async function coveragePass(page) {
  await h.setView(page, { ...h.CENTER, zoom: 15, bearing: 0 });
  await h.waitSettled(page, { timeout: 15000, quietMs: 250 });
  const samples = [];
  const take = async (label) => {
    const sample = await centerCoverage(page);
    samples.push({ label, ...sample });
  };
  const at = await pointer(page);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 16; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(50);
    if (i % 4 === 3) await take('zoom-in-' + i);
  }
  for (let i = 0; i < 16; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(50);
    if (i % 4 === 3) await take('zoom-out-' + i);
  }
  const shifts = [[160, 20], [-180, 10]];
  for (let s = 0; s < shifts.length; s++) {
    const [dx, dy] = shifts[s];
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(at.x + dx * i / 6, at.y + dy * i / 6);
      await page.waitForTimeout(20);
    }
    await take('drag-' + s);
    await page.mouse.up();
  }
  return samples;
}

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('bench-gesture', args, async (session) => {
    const page = session.page;
    const info = await h.pathInfo(page);
    const settled = await h.prepareScene(page, { style: 'hs', spectrum: true, zoom: 15, bearing: 0, opacity: 100 });
    const zoomBefore = await page.evaluate(() => window.ClearSkiesPortalBridge.map.getZoom());
    const raf = await h.rafStats(page, async () => {
      await wheel(page, -90, 28, 24);
      await wheel(page, 90, 28, 24);
      await drag(page);
    });
    const zoomAfter = await page.evaluate(() => window.ClearSkiesPortalBridge.map.getZoom());
    await h.setView(page, { ...h.CENTER, zoom: 15, bearing: 0 });
    await h.waitSettled(page, { timeout: 15000, quietMs: 250 });
    const samples = await coveragePass(page);
    const residentSamples = samples.filter((sample) => sample.resident);
    const low = residentSamples.filter((sample) => sample.coverage < 0.98);
    const minCoverage = samples.reduce((m, sample) => Math.min(m, sample.coverage), 1);
    const on = info.path === 'on';
    const limit = session.browserName === 'webkit' ? 20 : 16.7;
    const rafPass = raf.p95 != null && raf.p95 <= limit;
    const coverPass = low.length === 0 && residentSamples.length > 0;
    return {
      settled,
      readbackOnTimedPath: false,
      coverageMethod: 'playwright-screenshot of a center clip, separate pass from the rAF timer. Not every composited frame. Not drawImage of the WebGL canvas.',
      zoomBefore, zoomAfter,
      raf,
      samples,
      minCoverage,
      residentSamples: residentSamples.length,
      below98: low.length,
      gate: {
        applies: on,
        pass: on ? (rafPass && coverPass) : null,
        rafPass: on ? rafPass : null,
        coveragePass: on ? coverPass : null,
        rafLimitMs: limit,
        rule: 'When the path is on: p95 rAF <= 16.7 ms Chrome or <= 20 ms WebKit, and no sampled frame below 98% coverage once an ancestor is resident.'
      },
      headline: {
        rafP95: raf.p95 == null ? null : h.round(raf.p95, 2),
        rafMax: h.round(raf.max, 2),
        minCoverage,
        below98: low.length,
        samples: samples.length
      }
    };
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
