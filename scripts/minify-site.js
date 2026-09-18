"use strict";

/* Minify the assembled Pages artifact.

   The repository stays readable on purpose: `scripts/check-static.js` asserts
   specific strings and `function name(` shapes in the sources, and the tests
   run against the sources too. So nothing here may touch the repo - it runs on
   the `_site` directory CI has already assembled, and only shrinks what is
   actually shipped (see the "Assemble the static site" step in ci.yml).

   Identifiers are deliberately NOT renamed. The application is a set of classic
   scripts sharing globals, so renaming top-level names per file would break
   cross-file references - the bytes saved are not worth that risk.

     node scripts/minify-site.js [_site]
*/

const fs = require("fs");
const path = require("path");

let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  console.error("minify-site: esbuild is not installed. Run `npm ci` first.");
  process.exit(1);
}

const dir = path.resolve(process.argv[2] || "_site");
if (!fs.existsSync(dir)) {
  console.error(`minify-site: ${dir} does not exist - assemble the site first.`);
  process.exit(1);
}

const JS_OPTS = { minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, legalComments: "none" };

function shrink(rel, { loader, opts = {} }) {
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) return 0;
  const before = fs.readFileSync(file, "utf8");
  let after;
  try {
    after = esbuild.transformSync(before, Object.assign({ loader }, opts)).code;
  } catch (err) {
    // Never ship a half-minified or broken asset: leave the file exactly as it
    // was and fail the build so the problem is visible instead of silent.
    throw new Error(`${rel}: ${err.message}`);
  }
  if (after.length >= before.length) return 0;
  fs.writeFileSync(file, after);
  return before.length - after.length;
}

function shrinkHtml(rel) {
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) return 0;
  const before = fs.readFileSync(file, "utf8");
  const after = before
    .replace(/(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (m, open, code, close) => open + esbuild.transformSync(code, Object.assign({ loader: "js" }, JS_OPTS)).code + close)
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (m, open, css, close) => open + esbuild.transformSync(css, { loader: "css", minify: true }).code + close);
  if (after.length >= before.length) return 0;
  fs.writeFileSync(file, after);
  return before.length - after.length;
}

const steps = () => [
  ["index.html", () => shrinkHtml("index.html")],
  ["ui-theme.css", () => shrink("ui-theme.css", { loader: "css", opts: { minify: true } })],
  ["ui-system.css", () => shrink("ui-system.css", { loader: "css", opts: { minify: true } })],
  ["vendor/maplibre-gl.css", () => shrink("vendor/maplibre-gl.css", { loader: "css", opts: { minify: true } })],
  ...["ui-system.js", "mosaic-core.js", "terrain-core.js", "terrain-raster.js", "elevation-bands.js",
    "elevation-tile-core.js", "public-terrain.js", "public-terrain-worker.js", "tile-pipeline.js",
    "wa-archaeology.js", "glacial-research-core.js", "research-analysis.js", "research-worker.js",
    "point-cloud-core.js", "point-cloud-viewer.js", "version.js"]
    .map((f) => [f, () => shrink(f, { loader: "js", opts: JS_OPTS })]),
  // Catalogs are fetched and parsed on load; they are the least dense bytes here.
  ...["maxar-catalog.json", "point-cloud-catalog.json"].map((f) => [f, () => {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) return 0;
    const before = fs.readFileSync(file, "utf8");
    const after = JSON.stringify(JSON.parse(before));
    if (after.length >= before.length) return 0;
    fs.writeFileSync(file, after);
    return before.length - after.length;
  }]),
];

let total = 0;
const rows = [];
for (const [name, run] of steps()) {
  const saved = run();
  if (saved > 0) rows.push([name, saved]);
  total += saved;
}

rows.sort((a, b) => b[1] - a[1]);
for (const [name, saved] of rows) console.log(`  ${String(saved).padStart(8)} B  ${name}`);
console.log(`minify-site: saved ${total.toLocaleString()} bytes across ${rows.length} files in ${dir}`);
