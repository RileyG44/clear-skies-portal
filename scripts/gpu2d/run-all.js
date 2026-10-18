'use strict';
/* Runs every §9 script for Chrome and WebKit, flag 0 and flag 1, on one
   server. Does not use port 8765 or 8816. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const h = require('./harness-lib');

const SCRIPTS = [
  'bench-pan', 'bench-gesture', 'bench-settings', 'rotation', 'sweep-deepzoom',
  'memory', 'robustness', 'feature-parity', 'parity-visual'
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1];
}

function cell(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return String(h.round(value, 3));
  return String(value).replace(/\|/g, '/');
}

function buildSummary(run, codes) {
  const rows = [];
  for (const code of codes) {
    const file = path.join(h.RESULTS, run, `${code.script}-${code.browser}-gpu${code.flag}.json`);
    let json = null;
    try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { json = null; }
    const headlines = json && json.repeats ? json.repeats.map((repeat) => repeat.headline || {}) : [];
    const keys = new Set();
    headlines.forEach((headline) => Object.keys(headline).forEach((key) => {
      if (typeof headline[key] === 'number') keys.add(key);
    }));
    const stats = {};
    for (const key of keys) stats[key] = h.summarize(headlines.map((headline) => headline[key]));
    const pathInfo = json && json.path;
    rows.push({
      script: code.script,
      browser: code.browser,
      gpu2d: Number(code.flag),
      exitCode: code.code,
      skipped: !!code.skipped,
      error: json && json.error,
      renderer: json && json.renderer,
      path: pathInfo,
      repeats: headlines.length,
      stats
    });
  }
  const lines = [];
  lines.push(`# GPU 2D harness run ${run}`);
  lines.push('');
  lines.push('Flag-off on this branch is the legacy renderer. `dataset.gpu2d` is the path that actually ran.');
  lines.push('');
  lines.push('| Script | Browser | Flag | Path | Dataset | Exit | Headline medians |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const row of rows) {
    const bits = Object.entries(row.stats).map(([key, stat]) => `${key} ${stat.median}`).join(', ');
    lines.push(`| ${row.script} | ${row.browser} | ${row.gpu2d} | ${cell(row.path && row.path.path)} | ${cell(row.path && row.path.dataset)} | ${row.exitCode} | ${cell(bits)} |`);
  }
  lines.push('');
  const markdown = lines.join('\n') + '\n';
  return { run, finishedAt: new Date().toISOString(), rows, markdown };
}

async function main() {
  const port = Number(argValue('--port', '8815'));
  const repeats = String(argValue('--repeats', '3'));
  const resume = process.argv.includes('--resume');
  if (port === 8765 || port === 8816) throw new Error('run-all will not use port ' + port);
  const cache = argValue('--cache', '/tmp/csp-v-cache-' + port);
  const run = argValue('--run', new Date().toISOString().replace(/[:.]/g, '-'));
  const shots = '/tmp/csp-gpu2d-shots/' + run;
  const server = await h.ensureServer({ port, cacheDir: cache, reuse: false });
  const codes = [];
  let warm = true;
  try {
    for (const browser of ['chrome', 'webkit']) {
      for (const flag of ['0', '1']) {
        for (const script of SCRIPTS) {
          const out = path.join(h.RESULTS, run, `${script}-${browser}-gpu${flag}.json`);
          if (resume && fs.existsSync(out)) {
            try {
              const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
              if (!prev.error && prev.repeats && prev.repeats.length >= Number(repeats)) {
                console.log('skip', script, browser, 'gpu' + flag);
                codes.push({ script, browser, flag, code: 0, skipped: true });
                warm = false;
                continue;
              }
            } catch (error) {}
          }
          const args = [
            path.join(__dirname, script + '.js'),
            '--browser', browser, '--gpu2d', flag, '--repeats', repeats,
            '--port', String(port), '--cache', cache, '--run', run, '--shots', shots,
            '--out', out
          ];
          if (!warm) args.push('--no-warm');
          console.log('\n>>', script, browser, 'gpu' + flag);
          const code = await new Promise((resolve) => {
            const child = spawn(process.execPath, args, {
              stdio: 'inherit',
              env: { ...process.env, GPU2D_REUSE_SERVER: '1' }
            });
            child.on('exit', (status) => resolve(status == null ? 1 : status));
          });
          warm = false;
          codes.push({ script, browser, flag, code });
          console.log('<<', script, browser, 'gpu' + flag, 'exit', code);
        }
      }
    }
  } finally {
    if (server.owned) await server.stop();
    const summary = buildSummary(run, codes);
    const jsonFile = path.join(h.RESULTS, run + '.json');
    h.writeResult(jsonFile, summary);
    fs.writeFileSync(path.join(h.RESULTS, run + '.md'), summary.markdown);
    console.log('summary', jsonFile);
  }
  if (codes.some((row) => row.code !== 0)) process.exitCode = 1;
}

process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

main().catch((error) => { console.error(error); process.exit(1); });
