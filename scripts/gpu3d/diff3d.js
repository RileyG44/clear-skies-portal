'use strict';
/* Raw pixel parity between two same-camera screenshots (old vs new path).
   Reports measured differences only; pass/fail thresholds are the reviewer's,
   set explicitly with --max-mean / --max-pct-over3 after visual inspection. */
const fs = require('fs');
const { lib2d } = require('./harness3d-lib.js');
const a = process.argv.slice(2);
const files = a.filter((x) => !x.startsWith('--'));
const opt = (name) => { const i = a.indexOf(name); return i >= 0 ? Number(a[i + 1]) : null; };
if (files.length !== 2) { console.error('node scripts/gpu3d/diff3d.js OLD.png NEW.png [--max-mean N] [--max-pct-over3 N]'); process.exit(2); }
const imgA = lib2d.decodePng(fs.readFileSync(files[0]));
const imgB = lib2d.decodePng(fs.readFileSync(files[1]));
const diff = lib2d.diffRgba(imgA, imgB);
const grid = lib2d.gridDiff(lib2d.sampleGrid(imgA, 16, 10), lib2d.sampleGrid(imgB, 16, 10));
const out = { old: files[0], new: files[1], shaOld: lib2d.sha256(fs.readFileSync(files[0])), shaNew: lib2d.sha256(fs.readFileSync(files[1])), diff, grid };
console.log(JSON.stringify(out, null, 2));
const maxMean = opt('--max-mean'), maxPct = opt('--max-pct-over3');
if ((maxMean != null && diff.mean > maxMean) || (maxPct != null && diff.pctOver3 > maxPct)) process.exitCode = 1;
