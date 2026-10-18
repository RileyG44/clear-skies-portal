'use strict';
/* Spec §9.8. Context loss uses WEBGL_lose_context. Flag equivalence is a
   screenshot diff, not a stretched canvas blit. */
const h = require('./harness-lib');

async function cycleRenderer(page, name) {
  return page.evaluate(async (name) => {
    const renderers = window.__cspGpu2d.renderers();
    const renderer = renderers[name];
    if (!renderer || !renderer.gl) return { name, found: false };
    const ext = renderer.gl.getExtension('WEBGL_lose_context');
    if (!ext) return { name, found: true, extension: false };
    const before = renderer.ready;
    const t0 = performance.now();
    ext.loseContext();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const lostReady = renderer.ready;
    ext.restoreContext();
    let restored = false, ms = null;
    for (let i = 0; i < 40; i++) {
      if (renderer.ready) { restored = true; ms = performance.now() - t0; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { name, found: true, readyBefore: before, lostReady, restored, ms: ms == null ? null : Math.round(ms) };
  }, name);
}

async function cycleGpuCanvas(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector('canvas.csp-gpu-terrain');
    if (!canvas) return { name: 'gpu-terrain', found: false };
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { name: 'gpu-terrain', found: true, context: false };
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return { name: 'gpu-terrain', found: true, extension: false };
    const t0 = performance.now();
    ext.loseContext();
    await new Promise((resolve) => setTimeout(resolve, 80));
    ext.restoreContext();
    let restored = false, ms = null;
    for (let i = 0; i < 40; i++) {
      const stats = window.__cspGpu2d.engineStats();
      const ready = stats && stats.ready !== false && !stats.error;
      if (ready) { restored = true; ms = performance.now() - t0; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { name: 'gpu-terrain', found: true, restored, ms: ms == null ? null : Math.round(ms), stats: window.__cspGpu2d.engineStats() };
  });
}

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('robustness', args, async (session) => {
    const page = session.page;
    const requested = await h.pathInfo(page);
    const settled = await h.prepareScene(page, { style: 'hs', spectrum: true, zoom: 16, bearing: 0, opacity: 100 });
    const before = await h.coverageShot(page);
    const terrain = await cycleRenderer(page, 'terrain');
    const elevation = await cycleRenderer(page, 'elevation');
    const gpu = await cycleGpuCanvas(page);
    await h.waitSettled(page, { timeout: 8000, quietMs: 200 });
    const after = await h.coverageShot(page);
    const otherFlag = session.gpu2d === 0 ? 1 : 0;
    const shotA = before.img;
    const otherPath = await h.gotoFlag(session, otherFlag);
    await h.prepareScene(page, { style: 'hs', spectrum: true, zoom: 16, bearing: 0, opacity: 100 });
    const shotB = await h.coverageShot(page);
    const diff = h.diffRgba(shotA, shotB.img);
    const forcedOff = args.gpu2d === 0;
    const stayedOff = requested.path !== 'on' && requested.dataset !== 'on';
    const cycles = [terrain, elevation, gpu].filter((row) => row.found);
    const slow = cycles.filter((row) => row.ms != null && row.ms >= 1000);
    const unrestored = cycles.filter((row) => row.found && row.restored === false);
    const on = requested.path === 'on' || otherPath.path === 'on';
    const samePath = requested.path === otherPath.path;
    return {
      settled,
      requested,
      otherFlag,
      otherPath,
      cycles: { terrain, elevation, gpu },
      recoverCoverage: h.round(after.stats.coverage, 4),
      recoverDiff: (() => {
        const back = h.diffRgba(before.img, after.img);
        return back.error ? back : { pctWithin3: h.round(back.pctWithin3, 3), max: back.max };
      })(),
      flagDiff: diff.error ? diff : {
        pctWithin3: h.round(diff.pctWithin3, 3),
        max: diff.max,
        samePathNoiseFloor: samePath
      },
      samePathNoiseFloor: samePath,
      note: samePath
        ? 'Both URL flags ran the same actual path. The pixel diff is a same-path noise floor, not a flag-on versus flag-off parity result.'
        : 'The two URL flags selected different dataset.gpu2d paths.',
      gate: {
        applies: on || forcedOff,
        pass: (on || forcedOff) ? (unrestored.length === 0 && slow.length === 0 && (forcedOff ? stayedOff : true)) : null,
        stayedOff: forcedOff ? stayedOff : null,
        unrestored: unrestored.map((row) => row.name),
        slow: slow.map((row) => ({ name: row.name, ms: row.ms })),
        rule: 'Context loss recovers in under 1 s when the renderer exists. ?gpu2d=0 must not report dataset on. Pixel agreement is recorded; when both paths are off it is noise, and the identical-behaviour gate is the noise floor rather than a failure.'
      },
      headline: {
        terrainMs: terrain.ms == null ? null : terrain.ms,
        elevationMs: elevation.ms == null ? null : elevation.ms,
        gpuMs: gpu.ms == null ? null : gpu.ms,
        dataset: requested.dataset,
        otherDataset: otherPath.dataset,
        pctWithin3: diff.pctWithin3 == null ? null : h.round(diff.pctWithin3, 3),
        samePath
      }
    };
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
