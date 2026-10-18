#!/usr/bin/env node
'use strict';
/**
 * Independent real-GPU edge cases, extending engine-parity.js without editing it.
 * Usage: node scripts/gpu2d/engine-review-checks.js [--browser=chrome|webkit|both] [--frames=300]
 * The original isolated suite supplies its fixtures and browser launchers; seven
 * additional checks cover lifecycle, native fallback, wrapping, and exports.
 */
const fs = require('node:fs');
const path = require('node:path');

async function additionalChecks({ check, assert, engines, source, record, FakeStore, shaders, view, smooth, makeEngine, settle, compareHeight }) {
  await check('review-preexisting-cpu-ancestor-fills-finer-holes', () => {
    const tiles = [record('raw', 3, 3, 3, 2, 32, 32, smooth),
      record('raw', 3, 4, 7, 5, 32, 32, (x, y) => x > 10 && x < 21 && y > 10 && y < 21 ? NaN : smooth(x, y) + 200)];
    const specs = [source('raw', 3, 4)], canvas = document.createElement('canvas'); document.body.append(canvas);
    const store = new FakeStore(specs, tiles);
    // Unlike makeEngine(), deliberately do not emit records after creation.
    const engine = CSPGpuTerrainEngine.create({ canvas, store, shaders, sources: () => specs, onNeedsFrame: () => {} });
    assert(engine, 'engine creation failed');
    const item = { canvas, store, engine, gl: canvas.getContext('webgl2') }; engines.push(item);
    return compareHeight(item, tiles, view({ cssSize: [256, 256] }));
  });

  await check('review-source-removal-and-stationary-config-rebuild', () => {
    const tiles = [record('base', 1, 4, 7, 5, 32, 32, smooth), record('dnr', 5, 4, 7, 5, 32, 32, (x, y) => smooth(x, y) + 200)];
    const specs = [source('base', 1, 4), source('dnr', 5, 4)], item = makeEngine(specs, tiles);
    const frame = view({ cssSize: [128, 128] }); settle(item, frame);
    specs.pop(); item.engine.setState({});
    const parity = compareHeight(item, [tiles[0]], frame), wantedBefore = item.store.wantCalls;
    specs[0] = { ...specs[0], allowed: () => false }; item.engine.setState({}); settle(item, frame);
    const data = item.engine.debugReadHeight().data;
    let valid = 0; for (let i = 1; i < data.length; i += 2) if (data[i]) valid++;
    assert(valid === 0, `same-view source rebuild left ${valid} visible pixels`);
    assert(item.store.wantCalls > wantedBefore, 'same-view source rebuild did not update store demand');
    return { parity, stationaryRebuild: { valid, wantedBefore, wantedAfter: item.store.wantCalls } };
  });

  await check('review-nodata-coverage-and-partial-coverage-diagnostic', async () => {
    const tile = record('base', 1, 4, 7, 5, 32, 32, () => NaN);
    const result = settle(makeEngine([source('base', 1, 4)], [tile]), view({ cssSize: [128, 128] }));
    assert(result.coverage === 0, `all-NaN tile reported coverage ${result.coverage}`);
    const partial = record('base', 1, 4, 7, 5, 32, 32, (x, y) => x === 0 && y === 0 ? 1000 : NaN);
    const item = makeEngine([source('base', 1, 4)], [partial]);
    const frame = view({ cssSize: [256, 256] });
    const geometry = settle(item, frame), data = item.engine.debugReadHeight().data;
    let valid = 0; for (let i = 1; i < data.length; i += 2) if (data[i]) valid++;
    const provenance = await item.engine.readProvenance(frame);
    assert(provenance.samples === 256 * 256 && Math.abs(provenance.coverage - valid / provenance.samples) < 1e-12,
      `provenance coverage ${provenance.coverage} differs from ${valid}/${provenance.samples}`);
    // render.coverage estimates display-tile geometry. Diagnostic readback gives
    // actual rank coverage for this fixture; these intentionally differ.
    return { allNoData: result, partialCoverageDiagnostic: { geometryEstimate: geometry.coverage, validPixels: valid,
      pixels: 256 * 256, pixelCoverage: valid / (256 * 256), provenanceCoverage: provenance.coverage,
      note: 'geometry estimate is not valid-pixel coverage' } };
  });

  await check('review-export-settings-snapshot', async () => {
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const tiles = [record('base', 1, 3, 3, 2, 32, 32, () => 1000)], specs = [source('base', 1, 3)], store = new FakeStore(specs, tiles);
    const gainShaders = { ...shaders, SHADE_UNIFORMS: ['u_gain'], uniformValues: state => ({ u_gain: state.gain ?? 0.75 }),
      shadeFragmentSource: prelude => `#version 300 es
precision highp float;precision highp int;uniform float u_gain;in vec2 v_screenUv;out vec4 outColor;${prelude}
void main(){ivec2 p=min(ivec2(v_screenUv*vec2(csp_size())),csp_size()-1);outColor=csp_valid(p)?vec4(u_gain,0.,0.,1.):vec4(0.);}` };
    const engine = CSPGpuTerrainEngine.create({ canvas, store, shaders: gainShaders, sources: () => specs, onNeedsFrame: () => {} });
    assert(engine, 'engine creation failed');
    const item = { canvas, store, engine, gl: canvas.getContext('webgl2') }; engines.push(item);
    const frame = view({ cssSize: [185, 131] }); engine.setState({ gain: 0.75 }); settle(item, frame);
    engine.debugLimits({ maxTargetSize: 64 });
    const pending = engine.renderToCanvas(frame, 185, 131); engine.setState({ gain: 0.25 });
    const exported = await pending, pixels = exported.getContext('2d').getImageData(0, 0, 185, 131).data;
    const first = pixels[(10 * 185 + 10) * 4], second = pixels[(10 * 185 + 100) * 4];
    assert(first === 191 && second === first, `export mixed settings: red ${first} then ${second}`);
    return { firstChunkRed: first, laterChunkRed: second };
  });

  await check('review-provenance-interleaves-render-export-and-destroy', async () => {
    const tiles = [record('base', 1, 3, 3, 2, 32, 32, () => 1000)], item = makeEngine([source('base', 1, 3)], tiles);
    const frame = view({ cssSize: [256, 256] }); settle(item, frame); item.engine.debugLimits({ maxTargetSize: 64 });
    const first = item.engine.readProvenance(frame), exported = item.engine.renderToCanvas(frame, 256, 256);
    const moved = view({ ...frame, centerMerc: [7.49 / 16, 5.5 / 16] }); item.engine.render(moved);
    const third = item.engine.readProvenance(moved), results = await Promise.all([first, exported, third]);
    assert(results[0].ranks[1] === 65536 && results[2].ranks[1] === 65536, 'interleaved provenance returned wrong rank counts');
    assert(item.gl.getError() === item.gl.NO_ERROR, 'WebGL error during interleaved readback');
    const cancelled = item.engine.readProvenance(moved).then(() => ({ rejected: false }), error => ({ rejected: true, message: error.message }));
    item.engine.destroy(); const cancellation = await cancelled;
    assert(cancellation.rejected && /destroyed/.test(cancellation.message), 'destroy did not cancel pending provenance');
    return { first: results[0], third: results[2], cancellation };
  });

  await check('review-world-ancestor-antimeridian-wrap', () => {
    const tile = record('base', 1, 0, 0, 0, 64, 64, x => 500 + x * 10), item = makeEngine([source('base', 1, 0)], [tile]);
    settle(item, view({ zoom: 2, centerMerc: [1, 0.5], cssSize: [256, 128] }));
    const actual = item.engine.debugReadHeight(), left = actual.data[(64 * 256 + 64) * 2], right = actual.data[(64 * 256 + 192) * 2];
    assert(Math.abs(left - 1095.3125) <= 1 / 256 && Math.abs(right - 535.3125) <= 1 / 256,
      `world-wrap samples were ${left}, ${right}`);
    return { left, right };
  });

  await check('review-scalar-int-array-uniforms', () => {
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const tiles = [record('base', 1, 3, 3, 2, 32, 32, () => 1000)], specs = [source('base', 1, 3)], store = new FakeStore(specs, tiles);
    const arrayShaders = { ...shaders, SHADE_UNIFORMS: ['u_modes'], uniformValues: () => ({ u_modes: [1, 1] }),
      shadeFragmentSource: prelude => `#version 300 es
precision highp float;precision highp int;uniform int u_modes[2];in vec2 v_screenUv;out vec4 outColor;${prelude}
void main(){ivec2 p=min(ivec2(v_screenUv*vec2(csp_size())),csp_size()-1);outColor=csp_valid(p)?vec4(float(u_modes[0]*u_modes[1]),0.,0.,1.):vec4(0.);}` };
    const engine = CSPGpuTerrainEngine.create({ canvas, store, shaders: arrayShaders, sources: () => specs, onNeedsFrame: () => {} });
    assert(engine, 'engine creation failed');
    const item = { canvas, store, engine, gl: canvas.getContext('webgl2') }; engines.push(item);
    settle(item, view({ cssSize: [128, 128] })); const pixel = new Uint8Array(4);
    item.gl.bindFramebuffer(item.gl.FRAMEBUFFER, null); item.gl.readPixels(20, 20, 1, 1, item.gl.RGBA, item.gl.UNSIGNED_BYTE, pixel);
    assert(pixel[0] === 255, `integer-array shader expected red255, got ${pixel[0]}`);
    return { pixel: Array.from(pixel) };
  });
}

const harnessPath = path.join(__dirname, 'engine-parity.js');
const marker = '  return { status: failures.length ? \'fail\' : \'pass\', metadata, checks, failures };';
let source = fs.readFileSync(harnessPath, 'utf8').replace(/^#![^\n]*\n/, '');
if (source.split(marker).length !== 2) throw new Error('engine-parity.js extension point changed; review this runner');
source = source.replace(marker, `  await (${additionalChecks.toString()})({check,assert,engines,source,record,FakeStore,shaders,view,smooth,makeEngine,settle,compareHeight});\n${marker}`);
source = source.replace("harness: 'gpu2d-engine-parity'", "harness: 'gpu2d-engine-review-checks'");
// Execute the trusted local harness in the same CommonJS environment. The
// injected function becomes part of browserSuite before Playwright serializes it.
new Function('require', '__dirname', source)(require, __dirname);
