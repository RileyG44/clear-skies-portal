'use strict';
/* Spec §9.5. Geographic colours come from one lat/lng read through
   latLngToContainerPoint on a screenshot. A bilinear rotate of the north-up
   screenshot is recorded separately and is not a 3/255 gate. */
const h = require('./harness-lib');

function screenAngle(sample) {
  const dx = sample.x - sample.cssW / 2;
  const dy = sample.y - sample.cssH / 2;
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

function wrap180(deg) {
  let v = deg;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

function compareSamples(north, turned) {
  const byName = new Map(north.map((sample) => [sample.name, sample]));
  const rows = [];
  for (const sample of turned) {
    const base = byName.get(sample.name);
    if (!base || !sample.inside || !base.inside) {
      rows.push({ name: sample.name, inside: false });
      continue;
    }
    rows.push({
      name: sample.name,
      inside: true,
      delta: h.channelDelta(base.patch, sample.patch),
      north: base.patch,
      turned: sample.patch
    });
  }
  const deltas = rows.filter((row) => row.inside && row.delta != null).map((row) => row.delta);
  return { points: rows, summary: h.summarize(deltas) };
}

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('rotation', args, async (session) => {
    const page = session.page;
    const info = await h.pathInfo(page);
    const settled = await h.prepareScene(page, { style: 'hs', spectrum: false, zoom: 16, bearing: 0, opacity: 100 });
    const points = h.viewPoints(h.CENTER.lat, h.CENTER.lng);
    const styles = [];
    for (const style of ['hs', 'aspect']) {
      await h.setControls(page, { style, opacity: 100, spectrum: false, below: false, above: false, outline: false });
      await h.setView(page, { ...h.CENTER, zoom: 16, bearing: 0 });
      const northSettled = await h.waitSettled(page, { timeout: 15000, quietMs: 300 });
      const northPng = await h.terrainScreenshot(page);
      const northImg = h.decodePng(northPng);
      const northSamples = await h.geographicSamples(page, northImg, points);
      const east0 = northSamples.find((sample) => sample.name === 'e');
      const bearings = [];
      for (const bearing of h.BEARINGS) {
        if (bearing !== 0) {
          await h.setView(page, { ...h.CENTER, zoom: 16, bearing });
          await h.waitSettled(page, { timeout: 15000, quietMs: 300 });
        }
        const png = bearing === 0 ? northPng : await h.terrainScreenshot(page);
        const img = bearing === 0 ? northImg : h.decodePng(png);
        const samples = bearing === 0 ? northSamples : await h.geographicSamples(page, img, points);
        const east = samples.find((sample) => sample.name === 'e');
        const measured = east0 && east ? wrap180(screenAngle(east) - screenAngle(east0)) : null;
        const geographic = compareSamples(northSamples, samples);
        const bitmap = bearing === 0 ? null : h.rotateDiff(northImg, img, measured || bearing, 4);
        const row = {
          bearing,
          measuredContentRotation: measured == null ? null : h.round(measured, 2),
          geographicMedian: geographic.summary.median,
          geographicMax: geographic.summary.max,
          geographicInside: geographic.points.filter((point) => point.inside).length,
          points: geographic.points.map((point) => ({ name: point.name, inside: point.inside, delta: point.delta })),
          bitmap: bitmap && !bitmap.error ? {
            samples: bitmap.samples,
            max: bitmap.max,
            mean: bitmap.mean == null ? null : h.round(bitmap.mean, 2),
            pctWithin8: bitmap.pctWithin8 == null ? null : h.round(bitmap.pctWithin8, 2),
            pctWithin16: bitmap.pctWithin16 == null ? null : h.round(bitmap.pctWithin16, 2),
            pctWithin24: bitmap.pctWithin24 == null ? null : h.round(bitmap.pctWithin24, 2),
            note: bitmap.note
          } : bitmap
        };
        bearings.push(row);
        console.log('rotation', style, bearing, 'geoMedian', row.geographicMedian, 'screen', row.measuredContentRotation);
      }
      styles.push({ style, northSettled: northSettled.ok, bearings });
    }
    const turned = styles.flatMap((style) => style.bearings.filter((row) => row.bearing !== 0));
    const medians = turned.map((row) => row.geographicMedian).filter((value) => typeof value === 'number');
    const worst = medians.length ? Math.max(...medians) : null;
    return {
      settled,
      zoom: 16,
      method: 'Primary: same lat/lng through map.latLngToContainerPoint, times devicePixelRatio, 3x3 median on a Playwright screenshot of #map. Secondary: bilinear rotation of the north-up screenshot by the measured screen motion of the east sample. getBoundingClientRect is not used. snapshotDomMatrix is what the app export uses; this harness compares presented pixels instead of reimplementing that walk.',
      notA3over255Gate: true,
      styles,
      gate: {
        applies: false,
        pass: null,
        heuristicMedianAtMost: 18,
        worstGeographicMedian: worst,
        heuristicHolds: worst == null ? null : worst <= 18,
        rule: 'Spec §9.5 has no 3/255 number. The 3/255 parity gate is not applied to rotated frames. heuristicHolds is a resampling allowance (median channel delta <= 18), reported so a later flag-on run can see it move. It is not a claim that CSS rotation was ignored.'
      },
      headline: {
        worstGeographicMedian: worst,
        bearings: h.BEARINGS.join(',')
      }
    };
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
