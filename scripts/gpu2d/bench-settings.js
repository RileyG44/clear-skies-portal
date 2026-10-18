'use strict';
/* Spec §9.3. Frame count uses paintSignal (2D sample or engine frame counter).
   It does not read the WebGL drawing buffer and does not take a screenshot. */
const h = require('./harness-lib');

const CANON = {
  style: 'hs', opacity: 100, contrast: 100, saturation: 100, brightness: 100,
  sunAz: 315, sunAlt: 45, ambient: 12, exaggeration: 125,
  spectrum: false, elev: 335, span: 300, spectrumOpacity: 48,
  below: false, above: false, outline: false,
  belowVal: 1000, aboveVal: 1500, feather: 40, bandOpacity: 52
};

const CASES = [
  { key: 'sunAz', value: 40, expect: 'visible' },
  { key: 'sunAlt', value: 20, expect: 'visible' },
  { key: 'ambient', value: 40, expect: 'visible' },
  { key: 'exaggeration', value: 180, expect: 'visible' },
  { key: 'contrast', value: 150, expect: 'visible' },
  { key: 'saturation', value: 40, expect: 'visible' },
  { key: 'brightness', value: 80, expect: 'visible' },
  { key: 'opacity', value: 45, expect: 'visible' },
  { key: 'style', value: 'aspect', expect: 'visible' },
  { key: 'sunAz', value: 200, expect: 'inert', setup: { style: 'aspect' }, note: 'Sun does not shade aspect.' },
  { key: 'style', value: 'slope', expect: 'visible' },
  { key: 'spectrum', value: true, expect: 'visible' },
  { key: 'elev', value: 900, expect: 'visible', setup: { spectrum: true } },
  { key: 'spectrumOpacity', value: 80, expect: 'visible', setup: { spectrum: true } },
  { key: 'below', value: true, expect: 'visible' },
  { key: 'above', value: true, expect: 'visible', setup: { below: true } },
  { key: 'outline', value: true, expect: 'visible', setup: { below: true, above: true } },
  { key: 'feather', value: 90, expect: 'visible', setup: { below: true, above: true, outline: true } },
  { key: 'bandOpacity', value: 80, expect: 'visible', setup: { below: true, above: true, outline: true } },
  { key: 'belowVal', value: 800, expect: 'visible', setup: { below: true, above: true } },
  { key: 'aboveVal', value: 1800, expect: 'visible', setup: { below: true, above: true } }
];

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('bench-settings', args, async (session) => {
    const page = session.page;
    const info = await h.pathInfo(page);
    const settled = await h.prepareScene(page, { style: 'hs', spectrum: false, zoom: 15, bearing: 0, opacity: 100 });
    const cases = [];
    for (const spec of CASES) {
      await h.setControls(page, { ...CANON, ...(spec.setup || {}) });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const measured = await h.measureControl(page, spec.key, spec.value);
      const late = !!(measured.changed && measured.frames > 1);
      const row = {
        key: spec.key,
        value: spec.value,
        expect: spec.expect,
        note: spec.note || '',
        frames: measured.frames,
        changed: measured.changed,
        ms: h.round(measured.ms, 1),
        signal: measured.after && measured.after.kind,
        network: measured.network,
        late
      };
      cases.push(row);
      console.log('setting', spec.key, 'frames', measured.frames, 'changed', measured.changed, 'net', measured.network.total);
    }
    const on = info.path === 'on';
    const lateCount = cases.filter((row) => row.late).length;
    const networkCount = cases.filter((row) => row.network.total > 0).length;
    const unchangedVisible = cases.filter((row) => row.expect === 'visible' && !row.changed).map((row) => row.key);
    return {
      settled,
      readback: 'none. paintSignal is a synchronous 2D-canvas sample plus opacity/filter, or engine.stats() generation/lastFrameMs on the GPU path.',
      cases,
      unchangedVisible,
      gate: {
        applies: on,
        pass: on ? (lateCount === 0 && networkCount === 0) : null,
        lateCount, networkCount,
        rule: 'When the path is on: each control paints in the event task or the next frame, and the change makes zero network requests. A control that does not move the signal is not a late paint. Sun-on-aspect is expected to be inert.'
      },
      headline: {
        cases: cases.length,
        lateCount,
        networkCount,
        maxFrames: cases.reduce((m, row) => Math.max(m, row.frames), 0),
        unchangedVisible: unchangedVisible.length
      }
    };
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
