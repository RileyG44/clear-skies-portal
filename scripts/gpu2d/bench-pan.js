'use strict';
/* Spec §9.1. Profiler and long tasks only. No screenshot and no WebGL readback. */
const h = require('./harness-lib');
const SPEC_PAN_BUSY_MS = 13200;

async function sunSweep(page) {
  for (let azimuth = 0; azimuth < 360; azimuth += 12) {
    await h.setControls(page, { sunAz: azimuth });
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1500);
}

async function spectrumSweep(page) {
  for (let value = 0; value <= 1200; value += 40) {
    await h.setControls(page, { elev: value });
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1500);
}

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('bench-pan', args, async (session) => {
    const page = session.page;
    const info = await h.pathInfo(page);
    const settled = await h.prepareScene(page, { style: 'hs', spectrum: true, zoom: 15, bearing: 0, opacity: 100 });
    const pan = await h.profilePhase(session, async () => {
      for (const move of h.PAN_MOVES) {
        await h.setView(page, { lat: move.lat, lng: move.lng, zoom: move.zoom, bearing: 0 });
        await page.waitForTimeout(800);
      }
    });
    const sun = await h.profilePhase(session, () => sunSweep(page));
    const spectrum = await h.profilePhase(session, () => spectrumSweep(page));
    const on = info.path === 'on';
    const busyPass = pan.busyMs == null ? null : pan.busyMs <= SPEC_PAN_BUSY_MS * 0.2;
    const longPass = pan.longTasks <= 2 && pan.longTaskMaxMs <= 100;
    return {
      settled,
      moves: h.PAN_MOVES.length,
      moveNote: 'Sixteen setView calls, 800 ms apart, from mulberry32 seed 0x6702D1 in the same lat/lng/zoom box as probes/prof.js. The probe used Math.random; these moves are fixed.',
      specBaselineBusyMs: SPEC_PAN_BUSY_MS,
      readback: 'none',
      pan, sun, spectrum,
      gate: {
        applies: on,
        pass: on ? (busyPass !== false && longPass) : null,
        busyPass, longPass,
        rule: 'When the path is on: pan/zoom main-thread busy <= 20% of the spec §1 13.2 s, at most 2 long tasks, none over 100 ms. WebKit has no CDP busy time; busyPass stays null there and the numeric busy clause is not treated as a failure.'
      },
      headline: {
        panBusyMs: pan.busyMs,
        panWallMs: pan.wallMs,
        panLongTasks: pan.longTasks,
        panLongMaxMs: pan.longTaskMaxMs,
        panLongMs: pan.longTaskMs,
        sunBusyMs: sun.busyMs,
        sunLongTasks: sun.longTasks,
        spectrumBusyMs: spectrum.busyMs,
        spectrumLongTasks: spectrum.longTasks,
        method: pan.mainThreadMethod,
        longTaskSource: pan.longTaskSource
      }
    };
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
