'use strict';
/* Deterministic 3D drape bench: CPU worker path today, GPU path when the
   integrator exposes window.CSPApp?.gpu3d / window.CSPGpu3D (?gpu3d=1).
   Real Chrome/Metal + Playwright WebKit; software renderers void performance.
   Usage: see harness3d-lib usage(). Never port 8765. */
const fs = require('fs');
const path = require('path');
const H = require('./harness3d-lib.js');
const { lib2d } = H;

async function profile(page, browserName, args, shotsDir, label) {
  const out = { profile: label };
  const renderer = await lib2d.gpuRenderer(page);
  out.renderer = renderer;
  out.performanceValid = !renderer.software;
  if (renderer.software) out.performanceNote = 'SOFTWARE RENDERER (' + renderer.renderer + '): timings in this run are NOT performance evidence.';
  out.gpu3d = await H.gpu3dStatus(page, args.gpu3d);
  const entered = await H.enter3d(page, args);
  out.enter = entered;
  out.camera = await H.tileState(page);
  /* Warm-up: one full style cycle before any delta is measured. */
  for (const s of H.STYLES) await H.setStyle(page, s);
  await H.setStyle(page, 'slope');
  out.shots = []; out.styles = {};
  for (const style of H.STYLES) {
    const ready = await H.setStyle(page, style);
    const shotFile = path.join(shotsDir, `${label}-${style}-gpu3d${args.gpu3d}-${browserName}.png`);
    out.styles[style] = { readyOk: ready.ok, ms: ready.ms };
    out.shots.push({ style, ...(await H.shot(page, shotFile)) });
  }
  /* Spectrum + bands at the fixed nonzero pitch/bearing camera. */
  await H.setStyle(page, 'slope');
  await H.setControl(page, 'elevSh', true, true);
  await H.setControl(page, 'elevBelowOn', true, true);
  await H.setControl(page, 'elevAboveOn', true, true);
  out.spectrumReady = await H.waitTerrain(page);
  out.shots.push({ style: 'spectrum+bands', ...(await H.shot(page, path.join(shotsDir, `${label}-spectrum-bands-gpu3d${args.gpu3d}-${browserName}.png`))) });
  /* Control response after warm-up: light (uniform/paint on GPU, worker re-render
     on CPU) and spectrum reference. Elevation-request delta must be visible. */
  const net = page.__counts;
  const getC = () => H.counters(page, net);
  out.controlResponse = { light: [], spectrum: [] };
  for (let i = 0; i < args.repeats; i++) {
    out.controlResponse.light.push(await H.measureControlResponse(page,
      () => H.setControl(page, 'terSunAz', i % 2 ? 315 : 120), getC));
    out.controlResponse.spectrum.push(await H.measureControlResponse(page,
      () => H.setControl(page, 'elevSlide', i % 2 ? 335 : 500), getC));
  }
  const summ = (rows) => ({
    wallP50: lib2d.percentile(rows.map((r) => r.wallMs), 50),
    wallP95: lib2d.percentile(rows.map((r) => r.wallMs), 95),
    paintP50: lib2d.percentile(rows.map((r) => r.paintMs), 50),
    drapeRendersDelta: rows.map((r) => r.delta.drapeRenders),
    workerPostsDelta: rows.map((r) => r.delta.workerPosts),
    elevationRequestsDelta: rows.map((r) => r.delta.elevationRequests)
  });
  out.controlSummary = { light: summ(out.controlResponse.light), spectrum: summ(out.controlResponse.spectrum) };
  out.cameraRoute = await H.rafRoute(page);
  out.finalCounters = await getC();
  out.gpuStatsEnd = await H.gpu3dStats(page);
  /* Contract expectation (reported, not gated here): on the GPU path, analytic
     + spectrum changes should add zero CPU drape worker jobs; uploads/draws in
     stats().renderer are the GPU-side evidence. Parent sets acceptance. */
  out.expectation = args.gpu3d
    ? 'gpu: controlSummary deltas drapeRenders/workerPosts should be 0 for analytic+spectrum; check gpuStatsEnd.renderer.{uploads,draws,inputTextures}'
    : 'cpu: light/analytic changes re-render via drape workers; elevationRequestsDelta should be 0 after warm-up';
  if (args.contextLoss) out.contextLoss = await H.contextLossProbe(page);
  else out.contextLoss = { attempted: false, note: 'opt-in only (--context-loss); run last when enabled' };
  return out;
}

(async () => {
  const args = H.parseArgs(process.argv);
  if (args.help) { console.log(H.usage()); return; }
  const outFile = args.out || path.join(__dirname, 'results', `bench3d-${args.browser}-gpu3d${args.gpu3d}.json`);
  const shotsDir = args.shots || path.join(path.dirname(outFile), 'shots');
  const result = {
    harness: 'gpu3d/bench3d', browser: args.browser, gpu3dRequested: args.gpu3d, url: args.url,
    startedAt: new Date().toISOString(), profiles: {}, pageErrors: [],
    verdict: { gpuBenchmark: args.gpu3d ? 'pending' : 'not-requested (CPU baseline)', parity: 'screenshots emitted for same-camera old/new review; no threshold invented' }
  };
  let server = null, browser = null;
  try {
    server = await H.spawnServer(args);
    browser = await H.launch(args.browser);
    const png = H.fixturePng();
    /* Desktop DPR2 */
    {
      const { context, page } = await H.newPage(browser, 'desktop');
      page.__counts = await H.installFixture(context, args, png);
      page.on('pageerror', (e) => result.pageErrors.push('[desktop] ' + String(e.message || e).slice(0, 300)));
      result.profiles.desktop = await profile(page, args.browser, args, shotsDir, 'desktop');
      await context.close();
    }
    /* Phone emulation 390x844 DPR3 — browser emulation, NOT a physical iPhone. */
    if (args.phone) {
      const { context, page } = await H.newPage(browser, 'phone');
      page.__counts = await H.installFixture(context, args, png);
      page.on('pageerror', (e) => result.pageErrors.push('[phone] ' + String(e.message || e).slice(0, 300)));
      result.profiles.phoneEmulated = await profile(page, args.browser, args, shotsDir, 'phone390x844-dpr3-emulated');
      result.profiles.phoneEmulated.note = 'Emulated in desktop browser (390x844, DPR3, touch). Not physical iPhone evidence.';
      await context.close();
    }
    const gpu = result.profiles.desktop && result.profiles.desktop.gpu3d;
    if (args.gpu3d) {
      result.verdict.gpuBenchmark = gpu && gpu.available && gpu.enabled
        ? 'controller present and enabled — GPU numbers above are for integrator review'
        : 'UNAVAILABLE — no enabled GPU controller in this build (dataset=' + (gpu && gpu.dataset) + '); GPU benchmark did NOT succeed and no GPU speedup is claimed';
    }
  } catch (e) {
    result.error = String(e && e.stack || e);
    console.error(result.error);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await H.stopServer(server);
    result.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
    console.log('wrote', outFile);
    console.log(JSON.stringify(result.verdict));
  }
  if (result.error) process.exitCode = 1;
  if (args.requireGpu && args.gpu3d && result.verdict.gpuBenchmark.startsWith('UNAVAILABLE')) process.exitCode = 3;
})().catch((e) => { console.error(e); process.exitCode = 1; });
