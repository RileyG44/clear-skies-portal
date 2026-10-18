'use strict';
/* Spec §9.6. Blank frames come from a terrain-only screenshot, not a canvas blit. */
const h = require('./harness-lib');

async function main() {
  const args = h.parseArgs(process.argv);
  await h.runBench('sweep-deepzoom', args, async (session) => {
    const page = session.page;
    const info = await h.pathInfo(page);
    const settled0 = await h.prepareScene(page, { style: 'hs', spectrum: true, zoom: 12, bearing: 0, opacity: 100 });
    const steps = [];
    let previous = 1;
    for (let step = 0; step <= 64; step++) {
      const z = 12 + step * 0.25;
      await h.setView(page, { ...h.CENTER, zoom: z, bearing: 0 });
      const settled = await h.waitSettled(page, { timeout: 8000, quietMs: 200 });
      const shot = await h.coverageShot(page);
      const coverage = shot.stats.coverage;
      const drop = previous - coverage > 0.4;
      const row = {
        zoom: z,
        settled: settled.ok,
        coverage: h.round(coverage, 4),
        white: h.round(shot.stats.white, 4),
        blank: shot.stats.blank,
        drop
      };
      steps.push(row);
      previous = coverage;
      if (row.blank || !row.settled || steps.length % 10 === 0) {
        console.log('sweep', z, row.settled ? 'settled' : 'UNSETTLED', 'cov', row.coverage, row.blank ? 'BLANK' : '');
      }
    }
    const blanks = steps.filter((step) => step.blank);
    const drops = steps.filter((step) => step.drop);
    const on = info.path === 'on';
    return {
      settled: settled0,
      method: 'Playwright screenshot of #map with basemap tiles hidden. Blank means coverage < 0.05 against the map background, or white fraction > 0.85. engine.render() overlap is not used.',
      from: 12, to: 28, step: 0.25, count: steps.length,
      steps,
      gate: {
        applies: on,
        pass: on ? blanks.length === 0 : null,
        blanks: blanks.map((step) => step.zoom),
        drops: drops.map((step) => step.zoom),
        rule: 'When the path is on: no blank frame from zoom 12 to 28 in steps of 0.25.'
      },
      headline: {
        steps: steps.length,
        blanks: blanks.length,
        drops: drops.length,
        minCoverage: steps.reduce((m, step) => Math.min(m, step.coverage), 1),
        unsettled: steps.filter((step) => !step.settled).length
      }
    };
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
