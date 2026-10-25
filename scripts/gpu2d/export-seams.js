#!/usr/bin/env node
'use strict';
/* A tiled terrain export must be one picture. The relative-elevation base and
   the detail blur are filtered across the whole export, so the blocks the
   streamed PNG path asks for (and the engine's own GPU-sized chunks) meet
   without seams, and the export matches the live canvas it enlarges.
   Usage: node scripts/gpu2d/export-seams.js  (any Chromium with WebGL2; runs
   on SwiftShader, so it needs no GPU) */
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require(path.join(require('node:child_process').execSync('npm root -g').toString().trim(), 'playwright')); }
const SCRIPTS = ['elevation-tile-core.js', 'terrain-core.js', 'terrain-raster.js', 'elevation-bands.js', 'terrain-drape-core.js',
  'gpu-terrain-shaders.js', 'gpu-terrain-engine.js', 'gpu-terrain-layer.js', 'scripts/gpu2d/export-seams-page.js'];
(async () => {
  const browser = await playwright.chromium.launch({channel:process.env.PW_CHANNEL||undefined,args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  const failures = [];
  try {
    const page = await browser.newPage(); page.on('pageerror', e => failures.push(e.message));
    await page.setContent('<html><body></body></html>');
    for (const file of SCRIPTS) await page.addScriptTag({content: fs.readFileSync(path.join(root, file), 'utf8')});
    const run = async (name, opts, check) => {
      const result = await page.evaluate(o => runProbe(o), opts);
      const problem = check(result); console.log(`${problem ? 'FAIL' : 'pass'} ${name} ${JSON.stringify(result)}${problem ? ' ' + problem : ''}`);
      if (problem) failures.push(`${name}: ${problem}`);
    };
    // Each run is compared with the one before it.
    await run('live 3x', {mode: 'live', scale: 3, liveDpr: 3}, () => null);
    await run('export 3x matches live', {mode: 'whole', scale: 3, liveDpr: 3}, r => r.diff.max > 8 ? `differs from live by ${r.diff.max}` : null);
    await run('export 8x in stream blocks', {mode: 'blocks-new', scale: 8}, r => r.maxSeam > 1 ? `seam jump ${r.maxSeam}` : null);
    await run('export 8x whole', {mode: 'whole', scale: 8}, r => r.diff.max > 2 ? `blocks differ from whole by ${r.diff.max}` : null);
    await run('export 8x in small GPU chunks', {mode: 'whole', scale: 8, limit: 700}, r => r.diff.max > 2 ? `chunks differ from whole by ${r.diff.max}` : null);
  } finally { await browser.close(); }
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
