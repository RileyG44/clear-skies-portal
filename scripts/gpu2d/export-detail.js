#!/usr/bin/env node
'use strict';
/* An export finer than the view must draw from finer elevation, not enlarge
   the view's own tiles. The page probe's synthetic survey has relief that
   exists only at its finest level; an 8x export from a z14 view must fetch
   that level, show the relief, match itself across the streamed path's
   blocks and a tight texture budget, and leave the live view's tiles alone.
   Usage: node scripts/gpu2d/export-detail.js  (any Chromium with WebGL2;
   runs on SwiftShader. PW_CHANNEL=msedge uses an installed Edge.) */
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(path.join(require('node:child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
const SCRIPTS = ['elevation-tile-core.js', 'terrain-core.js', 'terrain-raster.js', 'elevation-bands.js', 'terrain-drape-core.js',
  'gpu-terrain-shaders.js', 'gpu-terrain-store.js', 'gpu-terrain-engine.js', 'gpu-terrain-layer.js', 'scripts/gpu2d/export-detail-page.js'];
(async () => {
  const browser = await playwright.chromium.launch({channel: process.env.PW_CHANNEL || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  const failures = [];
  try {
    const page = await browser.newPage(); page.on('pageerror', e => failures.push(e.message));
    await page.setContent('<html><body></body></html>');
    for (const file of SCRIPTS) await page.addScriptTag({content: fs.readFileSync(path.join(root, file), 'utf8')});
    const results = {};
    const run = async (name, opts, check) => {
      const result = results[name] = await page.evaluate(o => runDetailProbe(o), opts);
      const problem = result.errors.length ? result.errors.join('; ') : check(result);
      console.log(`${problem ? 'FAIL' : 'pass'} ${name} ${JSON.stringify(result)}${problem ? ' ' + problem : ''}`);
      if (problem) failures.push(`${name}: ${problem}`);
    };
    const common = r => !r.liveStoreUnchanged ? 'export changed the live store' : !r.liveTexturesUnchanged ? 'export changed the live textures'
      : r.exportTexturesAfter ? `${r.exportTexturesAfter} export textures left after release` : r.coverage < .999 ? `coverage ${r.coverage}` : null;
    // A z14.3 view at 1x is drawn from z15, as imagery exports round past a quarter level.
    await run('1x of a z14.3 view uses z15', {mode: 'whole', scale: 1}, r => common(r) || (r.detailInfo.z !== 15 ? `level ${r.detailInfo.z}` : null)
      || (r.exportRequests[15] !== r.detailInfo.tiles ? `requests ${JSON.stringify(r.exportRequests)} for ${r.detailInfo.tiles} tiles` : null));
    await run('8x resident only (previous behaviour)', {mode: 'whole', scale: 8, detail: false}, r => common(r) || (Object.keys(r.exportRequests).length ? 'fetched with detail:false' : null));
    const before = () => results['8x resident only (previous behaviour)'].fine;
    await run('8x fetches z17', {mode: 'whole', scale: 8, keep: true}, r => common(r) || (r.detailInfo.z !== 17 ? `level ${r.detailInfo.z}` : null)
      || (!r.exportRequests[17] ? 'no z17 requests' : null) || (r.tilesSeen !== r.detailInfo.tiles ? `progress ${r.tilesSeen}/${r.detailInfo.tiles}` : null)
      || (r.fine < 2 * before() ? `fine relief ${r.fine} vs ${before()} resident-only: detail not visible` : null));
    await run('8x streamed blocks match whole', {mode: 'blocks', scale: 8, compare: true}, r => common(r) || (r.diff && r.diff.max > 2 ? `differs by ${r.diff.max}` : null) || (r.tilesSeen > r.detailInfo.tiles ? `progress overcounts ${r.tilesSeen}/${r.detailInfo.tiles}` : null));
    await run('8x small pieces, tight budget match whole', {mode: 'whole', scale: 8, chunk: 600, textureBytes: 2 << 20, compare: true},
      r => common(r) || (r.diff && r.diff.max > 2 ? `differs by ${r.diff.max}` : null));
    await run('8x rotated still fetches z17', {mode: 'whole', scale: 8, bearing: 37}, r => common(r) || (!r.exportRequests[17] ? 'no z17 requests' : null));
  } finally { await browser.close(); }
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
