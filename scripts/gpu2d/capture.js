#!/usr/bin/env node
'use strict';
// Existing GPU_2D_TERRAIN_SPEC §9 real-browser workflow, with no live requests.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..'), fixture = require('./capture-fixture.js');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const section = (start, end) => {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  if (from < 0 || to < 0) throw Error(`Missing production compositor: ${start}`);
  return html.slice(from, to);
};
const input = {
  composeSource: section('async function composeSnapshot(', '\n/* The large-export path.'),
  streamSource: section('async function composeSnapshotStream(', '\n/* Where a streamed export goes.'),
  large: !process.argv.includes('--small'), saveArtifact: true
};
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const outputDir = option('output');
if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
if (option('device-probe')) {
  // Debug-only injection; the same fixture runs against bundled production JS.
  fs.writeFileSync(option('device-probe'), `return await (${fixture.toString()})(${JSON.stringify({ ...input, saveArtifact: false })});\n`);
  console.log('Wrote device probe ' + option('device-probe'));
  process.exit(0);
}
const launchers = {
  chrome: () => require('/Users/riley/.npm/_npx/31e32ef8478fbf80/node_modules/playwright').chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }),
  webkit: () => require('/Users/riley/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core').webkit.launch()
};
(async () => {
  const browsers = {}, choice = option('browser') || 'both';
  for (const name of choice === 'both' ? ['chrome', 'webkit'] : [choice]) {
    if (!launchers[name]) throw Error('Use --browser=chrome|webkit|both');
    const browser = await launchers[name]();
    try {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<!doctype html><title>Aurora capture regression</title>');
      for (const file of ['version.js', 'terrain-core.js', 'terrain-raster.js', 'elevation-bands.js', 'elevation-tile-core.js',
        'terrain-drape-core.js', 'gpu-terrain-engine.js', 'gpu-terrain-shaders.js', 'gpu-terrain-layer.js', 'lidar-render.js', 'png-stream.js'])
        await page.addScriptTag({ path: path.join(root, file) });
      browsers[name] = await page.evaluate(fixture, input);
      if (errors.length) { browsers[name].passed = false; browsers[name].pageErrors = errors; }
      if (outputDir && await page.evaluate(() => Boolean(window.__captureArtifact))) {
        const base64 = await page.evaluate(() => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(window.__captureArtifact); }));
        fs.writeFileSync(path.join(outputDir, `aurora-32x-${name}.png`), Buffer.from(base64, 'base64'));
      }
    } catch (error) { browsers[name] = { passed: false, error: error.stack || String(error) }; }
    finally { await browser.close(); }
  }
  const result = { harness: 'gpu2d-capture', timestamp: new Date().toISOString(), passed: Object.values(browsers).every(result => result.passed), browsers };
  if (outputDir) fs.writeFileSync(path.join(outputDir, 'capture.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
