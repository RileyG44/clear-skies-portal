'use strict';
/* Bounded 3D GPU lifecycle check. This is a correctness harness, not a
   performance measurement. It reuses the deterministic national Terrarium
   fixture from harness3d-lib.js and targets an isolated local server only.
   Usage:
     node scripts/gpu3d/lifecycle3d.js --url http://127.0.0.1:8824/ \
       --browser chrome --gpu3d 1 --out /tmp/csp-gpu3d-upgrade/lifecycle-chrome.json
   Never use port 8765. */
const fs = require('fs');
const path = require('path');
const H = require('./harness3d-lib.js');

const WAIT_MS = 30000;
const argTail = process.argv.slice(2);
const explicitGpu3d = argTail.includes('--gpu3d');
const args = H.parseArgs(process.argv);

/* The lifecycle suite is a GPU-path check by default; an explicit --gpu3d 0
   still wins so the same file can be smoke-tested against the CPU path. */
if (!explicitGpu3d) {
  args.gpu3d = 1;
  const u = new URL(args.url);
  u.searchParams.set('gpu3d', '1');
  args.url = u.toString();
}
const outFile = args.out || path.join('/tmp/csp-gpu3d-upgrade', `lifecycle-${args.browser}.json`);
const shotsDir = args.shots || path.join(path.dirname(outFile), `lifecycle-shots-${args.browser}`);
const startedAt = new Date().toISOString();
const result = {
  harness: 'gpu3d/lifecycle3d',
  browser: args.browser,
  gpu3dRequested: args.gpu3d,
  url: args.url,
  startedAt,
  tests: [],
  controllerStats: {},
  pageErrors: [],
  consoleWarnings: [],
  screenshots: [],
  verdict: { pass: false, failures: [], skipped: [] }
};
let currentTest = 'startup';
let browser = null;

function bounded(promise, label, ms = WAIT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function assert(condition, message, details) {
  if (condition) return;
  const error = new Error(message);
  if (details) error.details = details;
  throw error;
}

function errorText(error) {
  return String(error && (error.stack || error.message) || error).slice(0, 2000);
}

function addTest(context, name, fn) {
  currentTest = `${context}:${name}`;
  const row = { context, name, status: 'running', startedAt: new Date().toISOString() };
  result.tests.push(row);
  const t0 = Date.now();
  return Promise.resolve()
    .then(fn)
    .then((details) => {
      row.details = details || null;
      row.status = details && details.skipped ? 'skip' : 'pass';
      if (row.status === 'skip') result.verdict.skipped.push(`${context}: ${name}: ${details.reason}`);
      return row;
    })
    .catch((error) => {
      row.status = 'fail';
      row.error = errorText(error);
      if (error && error.details) row.failureDetails = error.details;
      return row;
    })
    .finally(() => { row.ms = Date.now() - t0; });
}

async function gpuState(page) {
  return page.evaluate(() => {
    const bridge = window.ClearSkiesPortalBridge;
    let controller = null, callError = null, stats = null;
    try { controller = bridge && typeof bridge.gpu3d === 'function' ? bridge.gpu3d() : null; }
    catch (error) { callError = String(error.message || error); }
    try { stats = controller && typeof controller.stats === 'function' ? controller.stats() : null; }
    catch (error) { callError = String(error.message || error); }
    return {
      callError,
      present: !!controller,
      dataset: document.documentElement.dataset.gpu3d || 'unset',
      stats
    };
  });
}

async function controllerStats(page) {
  return page.evaluate(() => {
    const c = window.ClearSkiesPortalBridge?.gpu3d?.();
    try { return c && typeof c.stats === 'function' ? c.stats() : null; }
    catch (error) { return { error: String(error.message || error) }; }
  });
}

async function glInfo(page) {
  return page.evaluate(() => {
    const gl = window.__map3d?.painter?.context?.gl;
    if (!gl) return { available: false, reason: 'no __map3d.painter.context.gl' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      available: true,
      isWebGL2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)
    };
  });
}

async function sourceState(page) {
  return page.evaluate(() => {
    const m = window.__map3d;
    if (!m) return null;
    const source = m.getSource('analysis');
    const manager = m.style?.tileManagers?.analysis;
    const visible = manager && typeof manager.getVisibleCoordinates === 'function'
      ? manager.getVisibleCoordinates(false).length : null;
    return {
      sourcePresent: !!source,
      hasSetTiles: !!(source && typeof source.setTiles === 'function'),
      tileIds: manager ? manager.getIds().length : null,
      visibleCoordinates: visible,
      tileStates: manager ? manager.getIds().map((key) => manager.getTileByID(key)?.state) : [],
      sourceDataEvents: window.__lifecycleSourceData || 0,
      tileKey: window.__lifecycleTileKey || null,
      sameTextureHandle: window.__lifecycleTexture
        ? !!(manager && manager.getTileByID(window.__lifecycleTileKey)?.texture?.texture === window.__lifecycleTexture)
        : null
    };
  });
}

async function tileVisibility(page, id) {
  return page.evaluate((layerId) => {
    const m = window.__map3d;
    if (!m || !m.getLayer(layerId)) return { present: false, visibility: null };
    return { present: true, visibility: m.getLayoutProperty(layerId, 'visibility') || 'visible' };
  }, id);
}

async function capture(page, filename) {
  const file = path.join(shotsDir, filename);
  const shot = await bounded(H.shot(page, file), `shot ${filename}`);
  result.screenshots.push(shot.file);
  return shot;
}

function stageDetails(gpu, extra) {
  return {
    gpu: gpu ? { present: gpu.present, dataset: gpu.dataset, callError: gpu.callError, stats: gpu.stats } : null,
    ...extra
  };
}

async function desktopLifecycle(page, counts) {
  let entered;
  await addTest('desktop', '1. enter 3D and validate enabled controller', async () => {
    entered = await bounded(H.enter3d(page, args), 'H.enter3d');
    assert(entered && entered.ready && entered.ready.ok, 'H.enter3d initial waitTerrain failed', entered);
    assert(entered.settled && entered.settled.ok, 'H.enter3d settled waitTerrain failed', entered);
    const gpu = await gpuState(page);
    assert(gpu.present, 'bridge.gpu3d() is missing');
    assert(!gpu.callError, `bridge.gpu3d() threw: ${gpu.callError}`);
    assert(gpu.stats && gpu.stats.enabled === true, 'GPU controller is not enabled');
    assert(!gpu.stats.error, `GPU controller error: ${gpu.stats.error}`);
    assert(gpu.stats.renderer && gpu.stats.renderer.draws > 0, 'renderer.draws is not positive');
    const gl = await glInfo(page);
    assert(gl.available, 'could not read MapLibre canvas WebGL context');
    return { enter: entered, gl, gpu: gpu.stats };
  });

  await addTest('desktop', '2. three clean presented frames do not shade', async () => {
    const before = await gpuState(page);
    assert(before.stats?.enabled, 'controller disabled before clean-frame check');
    for (let i = 0; i < 3; i++) await bounded(H.presented(page), `clean frame ${i + 1}`);
    const after = await gpuState(page);
    assert(after.stats?.enabled, 'controller disabled after clean-frame check');
    const dDraws = after.stats.renderer.draws - before.stats.renderer.draws;
    const dUploads = after.stats.renderer.uploads - before.stats.renderer.uploads;
    assert(dDraws === 0, `clean frames added ${dDraws} renderer draws`);
    assert(dUploads === 0, `clean frames added ${dUploads} renderer uploads`);
    const maxBytes = after.stats.renderer.maxBytes;
    assert(Number.isFinite(maxBytes) && maxBytes > 0, 'renderer.maxBytes is missing');
    assert(after.stats.cache.bytes <= maxBytes, `cache.bytes ${after.stats.cache.bytes} > maxBytes ${maxBytes}`);
    assert(after.stats.renderer.inputBytes <= maxBytes, `renderer.inputBytes ${after.stats.renderer.inputBytes} > maxBytes ${maxBytes}`);
    return { before: before.stats, after: after.stats, delta: { draws: dDraws, uploads: dUploads }, maxBytes };
  });

  let tintBeforeLightStats = null;
  await addTest('desktop', '3. tint lighting changes draws, not uploads/CPU workers', async () => {
    const tintReady = await bounded(H.setStyle(page, 'tint'), 'H.setStyle(tint)');
    assert(tintReady && tintReady.ok, 'tint style did not become ready', tintReady);
    const beforeShot = await capture(page, 'tint-light-before.png');
    const before = await gpuState(page);
    const beforeCpu = await H.counters(page, counts);
    tintBeforeLightStats = before.stats;
    const azimuth = await page.$eval('#terSunAz', (el) => Number(el.value));
    const nextAzimuth = azimuth === 120 ? 315 : 120;
    const paintBefore = await H.paintState(page);
    await H.setControl(page, 'terSunAz', nextAzimuth);
    await bounded(H.waitChangedPaint(page, paintBefore), 'waitChangedPaint(lighting)');
    const ready = await bounded(H.waitTerrain(page), 'waitTerrain(lighting)');
    assert(ready.ok, 'terrain not ready after lighting change', ready);
    await bounded(H.presented(page), 'presented(lighting)');
    const after = await gpuState(page);
    const afterCpu = await H.counters(page, counts);
    const afterShot = await capture(page, 'tint-light-after.png');
    assert(after.stats?.enabled, 'controller disabled after lighting change');
    assert(!after.stats.error, `controller error after lighting: ${after.stats.error}`);
    const dDraws = after.stats.renderer.draws - before.stats.renderer.draws;
    const dUploads = after.stats.renderer.uploads - before.stats.renderer.uploads;
    assert(dDraws > 0, 'lighting change did not increase renderer.draws');
    assert(dUploads === 0, `lighting change added ${dUploads} renderer uploads`);
    assert(afterCpu.drapeRenders === beforeCpu.drapeRenders, 'lighting change called renderDrapeTile');
    assert(afterCpu.workerPosts === beforeCpu.workerPosts, 'lighting change posted drape worker jobs');
    assert(afterCpu.shadeDone === beforeCpu.shadeDone, 'lighting change completed CPU shade jobs');
    assert(beforeShot.sha256 !== afterShot.sha256, 'lighting screenshot hash did not change');
    return {
      azimuth: { from: azimuth, to: nextAzimuth },
      ready,
      delta: { draws: dDraws, uploads: dUploads, drapeRenders: afterCpu.drapeRenders - beforeCpu.drapeRenders, workerPosts: afterCpu.workerPosts - beforeCpu.workerPosts, shadeDone: afterCpu.shadeDone - beforeCpu.shadeDone },
      shots: { before: beforeShot, after: afterShot },
      gpu: after.stats
    };
  });

  await addTest('desktop', '4. analysis source placeholder overwrite reloads same cached records', async () => {
    const before = await gpuState(page);
    const beforeSource = await sourceState(page);
    assert(beforeSource?.sourcePresent && beforeSource.hasSetTiles, 'analysis source/setTiles unavailable', beforeSource);
    const beforeCounters = await H.counters(page, counts);
    const sourceEventCounter = await page.evaluate(() => {
      window.__lifecycleSourceData = 0;
      const m = window.__map3d;
      window.__lifecycleAnalysisSource = m.getSource('analysis');
      const manager = m.style?.tileManagers?.analysis;
      const key = manager?.getIds?.().find((id) => manager.getTileByID(id)?.state === 'loaded');
      const tile = key ? manager.getTileByID(key) : null;
      window.__lifecycleTileKey = key || null;
      window.__lifecycleTexture = tile?.texture?.texture || null;
      m.on('sourcedata', (event) => {
        if (event.sourceId === 'analysis') window.__lifecycleSourceData++;
      });
      return { sourceSame: true, tileKey: key || null, textureCaptured: !!tile?.texture?.texture };
    });
    await page.evaluate(() => {
      const s = window.__map3d.getSource('analysis');
      s.setTiles(['cspgpu3d://analysis/{z}/{x}/{y}.png?lifecycleReload=1']);
    });
    await page.waitForFunction((draws) => {
      const c = window.ClearSkiesPortalBridge?.gpu3d?.();
      const stats = c?.stats?.();
      return !!stats?.enabled && stats.renderer.draws > draws;
    }, before.stats.renderer.draws, { timeout: WAIT_MS });
    const ready = await bounded(H.waitTerrain(page), 'waitTerrain(source reload)');
    assert(ready.ok, 'terrain not ready after analysis source reload', ready);
    await bounded(H.presented(page), 'presented(source reload)');
    const after = await gpuState(page);
    const afterSource = await sourceState(page);
    const afterCounters = await H.counters(page, counts);
    const shot = await capture(page, 'source-reload.png');
    assert(after.stats?.enabled, 'controller disabled after source reload');
    assert(!after.stats.error, `controller error after source reload: ${after.stats.error}`);
    const cacheEntriesDelta = (after.stats.cache.entries || 0) - (before.stats.cache.entries || 0);
    const uploadsDelta = after.stats.renderer.uploads - before.stats.renderer.uploads;
    if (cacheEntriesDelta <= 0) {
      assert(uploadsDelta === 0, `source reload uploaded ${uploadsDelta} inputs for already-cached records`);
    }
    assert(afterSource.sourceDataEvents > 0, 'no sourcedata event observed for analysis reload');
    assert(afterCounters.drapeRenders === beforeCounters.drapeRenders, 'source reload used CPU drape rendering');
    assert(!shot.blank, 'source reload screenshot is blank');
    return {
      sourceSameObject: sourceEventCounter.sourceSame,
      sourceEvents: afterSource.sourceDataEvents,
      tileKey: sourceEventCounter.tileKey,
      textureCaptured: sourceEventCounter.textureCaptured,
      sameTextureHandle: afterSource.sameTextureHandle,
      cacheEntriesDelta,
      uploadsDelta,
      alreadyCachedRecords: cacheEntriesDelta <= 0,
      note: cacheEntriesDelta > 0 ? 'New viewport/cache entries arrived; uploads delta is reported, not overclaimed.' : 'No new cache entries; uploads stayed unchanged for cached records.',
      ready,
      shot,
      gpu: after.stats
    };
  });

  await addTest('desktop', '5. structural style rebuild + elevation visibility', async () => {
    const beforeTheme = await gpuState(page);
    const themeBefore = await page.evaluate(() => document.documentElement.dataset.uiTheme || 'unset');
    const themeClicked = await page.evaluate(() => {
      const button = document.getElementById('mapTheme');
      if (!button) return false;
      button.click();
      return true;
    });
    assert(themeClicked, 'existing #mapTheme control unavailable');
    await page.waitForFunction((draws) => {
      const m = window.__map3d;
      const c = window.ClearSkiesPortalBridge?.gpu3d?.();
      const stats = c?.stats?.();
      return !!m && m.isStyleLoaded() && !!m.getLayer('terrain-analysis') &&
        !!stats?.enabled && stats.renderer.draws > draws;
    }, beforeTheme.stats.renderer.draws, { timeout: WAIT_MS });
    const themeReady = await bounded(H.waitTerrain(page), 'waitTerrain(theme toggle)');
    assert(themeReady.ok, 'terrain not ready after theme rebuild', themeReady);
    await bounded(H.presented(page), 'presented(theme toggle)');
    const afterTheme = await gpuState(page);
    const themeAfter = await page.evaluate(() => document.documentElement.dataset.uiTheme || 'unset');
    const analysisVisibility = await tileVisibility(page, 'terrain-analysis');
    assert(themeAfter !== themeBefore, `map theme did not change (${themeBefore})`);
    assert(afterTheme.stats?.enabled, 'controller disabled after theme rebuild');
    assert(!afterTheme.stats.error, `controller error after theme rebuild: ${afterTheme.stats.error}`);
    assert(afterTheme.dataset === 'on', `dataset.gpu3d=${afterTheme.dataset} after theme rebuild`);
    assert(analysisVisibility.present && analysisVisibility.visibility === 'visible', 'terrain-analysis layer not visible after theme rebuild', analysisVisibility);

    const beforeElevOn = await gpuState(page);
    await H.setControl(page, 'elevSh', true, true);
    await page.waitForFunction(() => {
      const m = window.__map3d;
      return !!m && !!m.getLayer('elev-spectrum') && m.getLayoutProperty('elev-spectrum', 'visibility') === 'visible';
    }, null, { timeout: WAIT_MS });
    const elevOnReady = await bounded(H.waitTerrain(page), 'waitTerrain(elevation on)');
    assert(elevOnReady.ok, 'terrain not ready after elevation on', elevOnReady);
    await bounded(H.presented(page), 'presented(elevation on)');
    const onStats = await gpuState(page);
    const onVisibility = await tileVisibility(page, 'elev-spectrum');
    assert(onStats.stats?.enabled, 'controller disabled after elevation on');
    assert(onVisibility.visibility === 'visible', 'elev-spectrum not visible after elevation on', onVisibility);

    await H.setControl(page, 'elevSh', false, true);
    await page.waitForFunction(() => {
      const m = window.__map3d;
      return !!m && !!m.getLayer('elev-spectrum') && m.getLayoutProperty('elev-spectrum', 'visibility') === 'none';
    }, null, { timeout: WAIT_MS });
    const elevOffReady = await bounded(H.waitTerrain(page), 'waitTerrain(elevation off)');
    assert(elevOffReady.ok, 'terrain not ready after elevation off', elevOffReady);
    await bounded(H.presented(page), 'presented(elevation off)');
    const offStats = await gpuState(page);
    const offVisibility = await tileVisibility(page, 'elev-spectrum');
    assert(offStats.stats?.enabled, 'controller disabled after elevation off');
    assert(offVisibility.visibility === 'none', 'elev-spectrum still visible after elevation off', offVisibility);
    return {
      theme: { before: beforeTheme.stats, after: afterTheme.stats, ready: themeReady, analysisVisibility, themeBefore, themeAfter },
      elevationOn: { before: beforeElevOn.stats, after: onStats.stats, ready: elevOnReady, visibility: onVisibility },
      elevationOff: { after: offStats.stats, ready: elevOffReady, visibility: offVisibility }
    };
  });

  await addTest('desktop', '6. exit cleanup and reentry recreate map/controller', async () => {
    const saved = await page.evaluate(() => {
      window.__lifecycleOldMap = window.__map3d;
      window.__lifecycleOldGpu = window.ClearSkiesPortalBridge.gpu3d();
      let stats = null;
      try { stats = window.__lifecycleOldGpu.stats(); } catch (error) { stats = { error: String(error.message || error) }; }
      return { oldMapPresent: !!window.__lifecycleOldMap, oldStats: stats };
    });
    await page.evaluate(() => document.getElementById('terMode2d').click());
    await page.waitForFunction(() => {
      const c = window.ClearSkiesPortalBridge?.gpu3d?.();
      return !document.body.classList.contains('terrain-3d') && !c;
    }, null, { timeout: WAIT_MS });
    const exitState = await page.evaluate(() => {
      let oldStats = null;
      try { oldStats = window.__lifecycleOldGpu?.stats?.() || null; } catch (error) { oldStats = { error: String(error.message || error) }; }
      return {
        terrain3dClass: document.body.classList.contains('terrain-3d'),
        bridgeController: window.ClearSkiesPortalBridge?.gpu3d?.() || null,
        oldStats
      };
    });
    assert(exitState.terrain3dClass === false, 'body retained terrain-3d after exit');
    assert(exitState.bridgeController === null, 'bridge.gpu3d() not null after exit');
    assert(exitState.oldStats && exitState.oldStats.enabled === false, 'old controller was not disabled by exit', exitState.oldStats);

    await page.evaluate(() => document.getElementById('terMode3d').click());
    await page.waitForFunction(() => {
      const m = window.__map3d;
      const c = window.ClearSkiesPortalBridge?.gpu3d?.();
      return !!m && m !== window.__lifecycleOldMap && !!c;
    }, null, { timeout: WAIT_MS });
    const ready = await bounded(H.waitTerrain(page), 'waitTerrain(reentry)');
    assert(ready.ok, 'terrain not ready after reentry', ready);
    await bounded(H.presented(page), 'presented(reentry)');
    const reentry = await page.evaluate(() => {
      const m = window.__map3d;
      const c = window.ClearSkiesPortalBridge.gpu3d();
      let stats = null;
      try { stats = c.stats(); } catch (error) { stats = { error: String(error.message || error) }; }
      return {
        newMap: !!m,
        mapRecreated: m !== window.__lifecycleOldMap,
        controllerRecreated: c !== window.__lifecycleOldGpu,
        enabled: stats && stats.enabled,
        error: stats && stats.error,
        stats
      };
    });
    assert(reentry.mapRecreated, 'window.__map3d was not replaced on reentry');
    assert(reentry.controllerRecreated, 'gpu3d controller was not recreated');
    assert(reentry.enabled === true, 'new controller is not enabled');
    assert(!reentry.error, `new controller error: ${reentry.error}`);
    assert(reentry.stats.installed === true, 'new GPU custom layer was not installed');
    assert(reentry.stats.renderer && reentry.stats.renderer.draws > 0, 'new renderer has no draws');
    const shot = await capture(page, 'reentry.png');
    assert(!shot.blank, 'reentry screenshot is blank');
    return {
      old: saved.oldStats,
      exit: exitState.oldStats,
      new: reentry.stats,
      mapRecreated: reentry.mapRecreated,
      controllerRecreated: reentry.controllerRecreated,
      rendererCountersRestarted: !!(saved.oldStats?.renderer && reentry.stats?.renderer &&
        reentry.stats.renderer.draws < saved.oldStats.renderer.draws),
      shot,
      ready
    };
  });

  await addTest('desktop', '7. context loss/restore last in this context', async () => {
    const probe = await bounded(H.contextLossProbe(page), 'H.contextLossProbe');
    if (!probe.attempted) {
      return { skipped: true, reason: probe.why || 'WEBGL_lose_context unavailable', probe };
    }
    assert(probe.supported === true, 'context-loss probe was not supported');
    assert(probe.restoredReady && probe.restoredReady.ok, 'MapLibre did not recover after context restore', probe);
    const ready = await bounded(H.waitTerrain(page), 'waitTerrain(context restore)');
    assert(ready.ok, 'terrain not ready after context restore', ready);
    await bounded(H.presented(page), 'presented(context restore)');
    const gpu = await gpuState(page);
    assert(gpu.stats?.enabled === true, 'controller disabled after context restore');
    assert(!gpu.stats.error, `controller error after context restore: ${gpu.stats.error}`);
    assert(gpu.stats.installed === true, 'GPU custom layer was not reinstalled after context restore');
    assert(gpu.stats.renderer && gpu.stats.renderer.draws > 0, 'renderer has no draws after context restore');
    const customLayerPresent = await page.evaluate(() => !!window.__map3d?.getLayer('csp-gpu3d-shade'));
    assert(customLayerPresent, 'custom GPU layer is absent after context restore');
    const shot = await capture(page, 'context-restored.png');
    assert(!shot.blank, 'context-restored screenshot is blank');
    return { probe, ready, gpu: gpu.stats, customLayerPresent, shot };
  });
}

async function fallbackLifecycle(page, counts) {
  await addTest('fallback-context', '8. automatic worker fallback when GPU renderer create fails', async () => {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: WAIT_MS });
    await page.evaluate(() => {
      window.ClearSkiesPortalBridge?.map?.setView([47.858, -118.33], 14, { animate: false });
      const source = document.getElementById('terSrc');
      source.value = '3dep'; source.dispatchEvent(new Event('change', { bubbles: true }));
      const style = document.getElementById('terStyle');
      style.value = 'slope'; style.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(() => { window.CSPGpuTerrain3DRenderer = { create: () => null }; });
    await page.evaluate(() => document.getElementById('terMode3d').click());
    await page.waitForFunction(() => !!window.__map3d, null, { timeout: WAIT_MS });
    const ready = await bounded(H.waitTerrain(page), 'waitTerrain(fallback)');
    assert(ready.ok, 'fallback terrain not ready', ready);
    await bounded(H.presented(page), 'presented(fallback)');
    const state = await page.evaluate(() => {
      const c = window.ClearSkiesPortalBridge?.gpu3d?.();
      let stats = null;
      try { stats = c?.stats?.() || null; } catch (error) { stats = { error: String(error.message || error) }; }
      return {
        dataset: document.documentElement.dataset.gpu3d || 'unset',
        controllerPresent: !!c,
        controllerEnabled: !!(stats && stats.enabled),
        stats,
        drapeRenders: window.__drapeRenders || 0,
        workerPosts: window.__workerPosts || 0,
        mapVisible: !!window.__map3d && window.__map3d.getCanvas().offsetWidth > 0
      };
    });
    const shot = await capture(page, 'fallback.png');
    assert(state.dataset === 'off', `fallback dataset.gpu3d=${state.dataset}, expected off`);
    assert(state.controllerPresent, 'fallback controller is missing');
    assert(state.controllerEnabled === false, 'fallback controller unexpectedly enabled');
    assert(state.drapeRenders > 0, 'fallback produced no CPU drape renders');
    assert(state.mapVisible, 'fallback map canvas is not visible');
    assert(!shot.blank, 'fallback screenshot is blank (placeholders never replaced)');
    return {
      ready,
      ...state,
      shot,
      note: 'GPU renderer creation was forced to return null. This verifies the worker fallback raster; it does not claim full terrain coverage.'
    };
  });
}

(async () => {
  let primaryContext = null, fallbackContext = null;
  try {
    browser = await bounded(H.launch(args.browser), 'browser launch');
    const png = H.fixturePng();

    const desktop = await H.newPage(browser, 'desktop');
    primaryContext = desktop.context;
    const page = desktop.page;
    page.on('pageerror', (error) => result.pageErrors.push({ context: 'desktop', test: currentTest, message: String(error.message || error).slice(0, 1000), stack: String(error.stack || '').slice(0, 2000) }));
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'warning' && /3D GPU|fallback|gpu3d/i.test(text)) result.consoleWarnings.push({ context: 'desktop', test: currentTest, text: text.slice(0, 1000) });
    });
    const counts = await H.installFixture(primaryContext, args, png);
    await desktopLifecycle(page, counts);
    result.controllerStats.desktopFinal = await controllerStats(page);
    await primaryContext.close().catch(() => {});
    primaryContext = null;

    const fallback = await H.newPage(browser, 'desktop');
    fallbackContext = fallback.context;
    const fallbackPage = fallback.page;
    fallbackPage.on('pageerror', (error) => result.pageErrors.push({ context: 'fallback', test: currentTest, message: String(error.message || error).slice(0, 1000), stack: String(error.stack || '').slice(0, 2000) }));
    fallbackPage.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'warning' && /3D GPU|fallback|gpu3d/i.test(text)) result.consoleWarnings.push({ context: 'fallback', test: currentTest, text: text.slice(0, 1000) });
    });
    const fallbackCounts = await H.installFixture(fallbackContext, args, png);
    await fallbackLifecycle(fallbackPage, fallbackCounts);
    result.controllerStats.fallbackFinal = await controllerStats(fallbackPage);
    await fallbackContext.close().catch(() => {});
    fallbackContext = null;
  } catch (error) {
    result.error = errorText(error);
    result.verdict.failures.push(`harness: ${error.message || error}`);
  } finally {
    if (primaryContext) await primaryContext.close().catch(() => {});
    if (fallbackContext) await fallbackContext.close().catch(() => {});
    if (browser) await bounded(browser.close(), 'browser.close').catch((error) => {
      result.verdict.failures.push(`browser.close: ${error.message || error}`);
    });
    result.finishedAt = new Date().toISOString();
    const failedTests = result.tests.filter((row) => row.status === 'fail');
    if (failedTests.length) for (const row of failedTests) {
      if (!result.verdict.failures.includes(`${row.context}: ${row.name}: ${row.error}`)) result.verdict.failures.push(`${row.context}: ${row.name}: ${row.error}`);
    }
    if (result.pageErrors.length) for (const error of result.pageErrors) result.verdict.failures.push(`pageerror (${error.context}/${error.test}): ${error.message}`);
    result.verdict.pass = result.verdict.failures.length === 0 && result.tests.some((row) => row.status === 'pass');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
    console.log('wrote', outFile);
    console.log(JSON.stringify({ pass: result.verdict.pass, tests: result.tests.map((row) => `${row.context}/${row.name}: ${row.status}`), failures: result.verdict.failures, screenshots: result.screenshots }, null, 2));
  }
  if (!result.verdict.pass) process.exitCode = 1;
})().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
