'use strict';
/* Spec §9.4. Pixel and contour compares use Playwright screenshots.
   gpu2d=0 writes the reference PNG. gpu2d=1 diffs it and deletes both
   unless --keep-shots. Same actual path is a noise floor, not a failure. */
const fs = require('fs');
const path = require('path');
const h = require('./harness-lib');

function modes() {
  const list = h.STYLES.map((style) => ({
    name: style,
    contour: h.CONTOUR_STYLES.has(style),
    controls: { style, opacity: 100, spectrum: false, below: false, above: false, outline: false }
  }));
  list.push({
    name: 'spectrum',
    contour: false,
    controls: { style: 'off', opacity: 100, spectrum: true, below: false, above: false, outline: false, elev: 335 }
  });
  list.push({
    name: 'bands',
    contour: false,
    controls: { style: 'off', opacity: 100, spectrum: false, below: true, above: true, outline: true, belowVal: 1000, aboveVal: 1500 }
  });
  return list;
}

function slimDiff(diff) {
  if (!diff) return null;
  if (diff.error) return diff;
  return {
    pctWithin3: h.round(diff.pctWithin3, 3),
    max: diff.max,
    mean: h.round(diff.mean, 3),
    over3: diff.over3
  };
}

function caseFile(args, repeat, mode, zoom, view) {
  return h.refFile(args, 'parity', `r${repeat}-${mode}-z${zoom}-${view}.png`);
}

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('parity-visual', args, async (session, repeat) => {
    const page = session.page;
    const info = await h.pathInfo(page);
    const settled = await h.prepareScene(page, { style: 'hs', spectrum: false, zoom: 12, bearing: 0, opacity: 100 });
    const list = modes();
    const cases = [];
    const total = list.length * h.ZOOMS.length * h.VIEWS.length;
    let n = 0;
    for (const mode of list) {
      await h.setControls(page, mode.controls);
      await h.setView(page, { ...h.CENTER, zoom: h.ZOOMS[0], bearing: 0 });
      await h.waitSettled(page, { timeout: 15000, quietMs: 250 });
      for (const zoom of h.ZOOMS) {
        for (const view of h.VIEWS) {
          n++;
          await h.setView(page, { lat: view.lat, lng: view.lng, zoom, bearing: 0 });
          const ready = await h.waitSettled(page, { timeout: 12000, quietMs: 250 });
          const shot = await h.coverageShot(page);
          const file = caseFile(args, repeat, mode.name, zoom, view.name);
          let diff = null, iou = null, noise = null, comparedTo = null;
          if (args.gpu2d === 1) {
            const ref = caseFile({ ...args, gpu2d: 0 }, repeat, mode.name, zoom, view.name);
            if (fs.existsSync(ref)) {
              comparedTo = 'gpu0';
              const other = h.decodePng(fs.readFileSync(ref));
              diff = h.diffRgba(other, shot.img);
              if (mode.contour) iou = h.contourIou(other, shot.img, shot.bg);
            }
          } else {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, shot.png);
            if (repeat > 0) {
              const prior = caseFile(args, 0, mode.name, zoom, view.name);
              if (fs.existsSync(prior)) {
                noise = slimDiff(h.diffRgba(h.decodePng(fs.readFileSync(prior)), shot.img));
              }
            }
          }
          const row = {
            mode: mode.name,
            contour: mode.contour,
            zoom,
            view: view.name,
            settled: ready.ok,
            coverage: h.round(shot.stats.coverage, 4),
            blank: shot.stats.blank,
            comparedTo,
            diff: slimDiff(diff),
            iou: iou ? { tolerant: h.round(iou.tolerant, 4), strict: h.round(iou.strict, 4), linesA: iou.linesA, linesB: iou.linesB } : null,
            repeatNoise: noise
          };
          cases.push(row);
          if (n % 18 === 0 || !ready.ok || row.blank) {
            console.log('parity', `${n}/${total}`, mode.name, 'z' + zoom, view.name, ready.ok ? 'ok' : 'UNSETTLED', row.diff ? row.diff.pctWithin3 : '');
          }
        }
      }
    }
    const samePath = info.path !== 'on';
    const compared = cases.filter((row) => row.diff && !row.diff.error && row.settled);
    const pixelFails = compared.filter((row) => !row.contour && row.diff.pctWithin3 < 99);
    const contourFails = compared.filter((row) => row.contour && (!row.iou || row.iou.tolerant < 0.97));
    const noiseValues = cases.map((row) => row.repeatNoise && row.repeatNoise.pctWithin3).filter((value) => typeof value === 'number');
    return {
      settled,
      matrix: '10 styles with spectrum and bands off, plus spectrum-only (style off), plus bands-only (below, above, outline, style off). Not the cartesian product. North-up. Opacity 100.',
      intentional: 'On a real flag-on path, removed tile seams are an intentional difference and can move pixels along the old seam. This run records dataset.gpu2d rather than assuming the flag.',
      method: 'Playwright screenshot of #map with basemap images and chrome hidden. Overlay canvases stay. No drawImage of the WebGL canvas and no getBoundingClientRect stretch.',
      samePathNoiseFloor: samePath,
      cases,
      gate: {
        applies: info.path === 'on' && !samePath,
        pass: info.path === 'on' && !samePath && compared.length > 0 ? (pixelFails.length === 0 && contourFails.length === 0) : null,
        compared: compared.length,
        pixelFails: pixelFails.length,
        contourFails: contourFails.length,
        missingReference: cases.filter((row) => args.gpu2d === 1 && !row.comparedTo).length,
        rule: 'When the two flags are different paths and this one is on: >= 99% of pixels within 3/255, and contour styles >= 97% line IoU after a 1 px dilation. Same-path runs report the noise floor and do not fail this gate.'
      },
      headline: {
        cases: cases.length,
        unsettled: cases.filter((row) => !row.settled).length,
        blanks: cases.filter((row) => row.blank).length,
        compared: compared.length,
        pixelFails: pixelFails.length,
        contourFails: contourFails.length,
        minWithin3: (() => {
          const values = compared.filter((row) => !row.contour && row.diff).map((row) => row.diff.pctWithin3);
          return values.length ? Math.min(...values) : null;
        })(),
        minIou: (() => {
          const values = compared.filter((row) => row.contour && row.iou).map((row) => row.iou.tolerant);
          return values.length ? Math.min(...values) : null;
        })(),
        repeatNoiseMedian: noiseValues.length ? h.summarize(noiseValues).median : null,
        samePath
      }
    };
  });
  if (args.gpu2d === 1 && !args.keepShots && !args.help) {
    const gpu1 = path.dirname(h.refFile(args, 'parity', 'done'));
    const gpu0 = path.dirname(h.refFile({ ...args, gpu2d: 0 }, 'parity', 'done'));
    fs.rmSync(gpu1, { recursive: true, force: true });
    fs.rmSync(gpu0, { recursive: true, force: true });
    console.log('removed parity screenshots', gpu0);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
