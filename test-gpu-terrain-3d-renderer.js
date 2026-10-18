"use strict";
/* Focused lifecycle tests: node test-gpu-terrain-3d-renderer.js
 * Real GPU parity: this file exports browserChecks(), which may be evaluated
 * after loading the renderer, shared shaders and CPU reference modules. */
const assert = require("node:assert/strict");
const rendererModule = require("./gpu-terrain-3d-renderer.js");
const shaders = require("./gpu-terrain-shaders.js");
const raster = require("./terrain-raster.js");
const drape = require("./terrain-drape-core.js");

// WebGL state model, with independent CPU raster/drape execution of draw calls.
class GL {
  constructor() {
    const names = ["DRAW_FRAMEBUFFER_BINDING", "READ_FRAMEBUFFER_BINDING", "VIEWPORT", "CURRENT_PROGRAM", "VERTEX_ARRAY_BINDING",
      "ACTIVE_TEXTURE", "COLOR_WRITEMASK", "PIXEL_UNPACK_BUFFER_BINDING", "PIXEL_PACK_BUFFER_BINDING", "UNPACK_ALIGNMENT",
      "UNPACK_FLIP_Y_WEBGL", "UNPACK_PREMULTIPLY_ALPHA_WEBGL", "UNPACK_ROW_LENGTH", "UNPACK_SKIP_PIXELS", "UNPACK_SKIP_ROWS",
      "UNPACK_IMAGE_HEIGHT", "UNPACK_SKIP_IMAGES", "PACK_ALIGNMENT", "PACK_ROW_LENGTH", "PACK_SKIP_PIXELS", "PACK_SKIP_ROWS",
      "TEXTURE_BINDING_2D", "SAMPLER_BINDING", "MAX_TEXTURE_SIZE", "BLEND", "DEPTH_TEST", "STENCIL_TEST", "SCISSOR_TEST",
      "CULL_FACE", "RASTERIZER_DISCARD", "DITHER", "SAMPLE_ALPHA_TO_COVERAGE", "SAMPLE_COVERAGE", "TEXTURE0", "TEXTURE_2D",
      "DRAW_FRAMEBUFFER", "READ_FRAMEBUFFER", "FRAMEBUFFER", "PIXEL_UNPACK_BUFFER", "PIXEL_PACK_BUFFER", "R32F", "RGBA8",
      "TEXTURE_MIN_FILTER", "TEXTURE_MAG_FILTER", "TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "NEAREST", "CLAMP_TO_EDGE", "RED", "FLOAT",
      "COLOR_ATTACHMENT0", "FRAMEBUFFER_COMPLETE", "TRIANGLES", "RGBA", "UNSIGNED_BYTE", "VERTEX_SHADER", "FRAGMENT_SHADER",
      "COMPILE_STATUS", "LINK_STATUS"];
    names.forEach((name, i) => this[name] = i + 100);
    this.p = new Map(names.map(name => [this[name], 0])); this.enables = new Set();
    this.textures = new Map(); this.samplers = new Map(); this.calls = {}; this.deleted = new Set();
    this.p.set(this.ACTIVE_TEXTURE, this.TEXTURE0 + 3); this.p.set(this.VIEWPORT, [7, 8, 99, 101]);
    this.p.set(this.COLOR_WRITEMASK, [false, true, false, true]); this.p.set(this.MAX_TEXTURE_SIZE, 16384);
    for (const name of ["DRAW_FRAMEBUFFER_BINDING", "READ_FRAMEBUFFER_BINDING", "CURRENT_PROGRAM", "VERTEX_ARRAY_BINDING",
      "PIXEL_UNPACK_BUFFER_BINDING", "PIXEL_PACK_BUFFER_BINDING"]) this.p.set(this[name], {external: name});
    for (const name of ["UNPACK_ROW_LENGTH", "UNPACK_SKIP_PIXELS", "PACK_ROW_LENGTH", "PACK_SKIP_ROWS"]) this.p.set(this[name], 9);
    this.textures.set(this.TEXTURE0, {external: "texture0"}); this.samplers.set(this.TEXTURE0, {external: "sampler0"});
    this.enables.add(this.BLEND); this.enables.add(this.SCISSOR_TEST); this.enables.add(this.RASTERIZER_DISCARD);
  }
  count(name) { this.calls[name] = (this.calls[name] || 0) + 1; }
  state() { return {p: [...this.p.entries()], enables: [...this.enables].sort(), textures: [...this.textures.entries()], samplers: [...this.samplers.entries()]}; }
  getParameter(p) { this.count("queries"); return p === this.TEXTURE_BINDING_2D ? this.textures.get(this.p.get(this.ACTIVE_TEXTURE)) || null : p === this.SAMPLER_BINDING ? this.samplers.get(this.p.get(this.ACTIVE_TEXTURE)) || null : this.p.get(p); }
  isContextLost() { return !!this.lost; }
  isEnabled(p) { return this.enables.has(p); }
  enable(p) { this.enables.add(p); } disable(p) { this.enables.delete(p); }
  activeTexture(p) { this.p.set(this.ACTIVE_TEXTURE, p); }
  bindTexture(_, t) { this.textures.set(this.p.get(this.ACTIVE_TEXTURE), t); }
  bindSampler(i, s) { this.samplers.set(this.TEXTURE0 + i, s); }
  bindFramebuffer(which, fbo) {
    if (which !== this.READ_FRAMEBUFFER) this.p.set(this.DRAW_FRAMEBUFFER_BINDING, fbo);
    if (which !== this.DRAW_FRAMEBUFFER) this.p.set(this.READ_FRAMEBUFFER_BINDING, fbo);
  }
  framebufferTexture2D(which, _, __, texture) { this.p.get(which === this.READ_FRAMEBUFFER ? this.READ_FRAMEBUFFER_BINDING : this.DRAW_FRAMEBUFFER_BINDING).target = texture; }
  viewport(...v) { this.p.set(this.VIEWPORT, v); }
  colorMask(...v) { this.p.set(this.COLOR_WRITEMASK, v); }
  useProgram(p) { this.p.set(this.CURRENT_PROGRAM, p); }
  bindVertexArray(v) { this.p.set(this.VERTEX_ARRAY_BINDING, v); }
  bindBuffer(which, b) { this.p.set(which === this.PIXEL_UNPACK_BUFFER ? this.PIXEL_UNPACK_BUFFER_BINDING : this.PIXEL_PACK_BUFFER_BINDING, b); }
  pixelStorei(p, v) { this.p.set(p, v); }
  createShader() { return {}; } shaderSource(s, src) { s.source = src; } compileShader() {}
  getShaderParameter() { return !this.failCompile; } getShaderInfoLog() { return "injected compile failure"; } deleteShader() {}
  createProgram() { return {uniforms: {}}; } attachShader() {} linkProgram() {} getProgramParameter() { return true; }
  createFramebuffer() { return {}; } createVertexArray() { return {}; } createTexture() { return {}; }
  deleteTexture(t) { this.deleted.add(t); } deleteProgram(t) { this.deleted.add(t); }
  deleteFramebuffer(t) { this.deleted.add(t); } deleteVertexArray(t) { this.deleted.add(t); }
  getUniformLocation(p, name) { return {p, name}; }
  uniform1i(l, v) { l.p.uniforms[l.name] = v; } uniform1f(l, v) { l.p.uniforms[l.name] = v; }
  uniform2f(l, ...v) { l.p.uniforms[l.name] = v; } uniform3f(l, ...v) { l.p.uniforms[l.name] = v; }
  texStorage2D(_, levels, format, w, h) { this.count("storage"); Object.assign(this.textures.get(this.p.get(this.ACTIVE_TEXTURE)), {levels, format, w, h}); }
  texParameteri() {}
  texSubImage2D(_, __, ___, ____, w, h, format, type, data) {
    this.count("uploads"); assert.equal(this.p.get(this.PIXEL_UNPACK_BUFFER_BINDING), null);
    assert.equal(format, this.RED); assert.equal(type, this.FLOAT);
    this.textures.get(this.p.get(this.ACTIVE_TEXTURE)).grid = data.slice();
  }
  checkFramebufferStatus() { this.count("completeness"); return this.incomplete ? 0 : this.FRAMEBUFFER_COMPLETE; }
  generateMipmap() { this.count("mipmaps"); }
  drawArrays() {
    this.count("draws"); if (this.failDraw) throw new Error("injected draw failure");
    const u = this.p.get(this.CURRENT_PROGRAM).uniforms, size = u.u_size;
    const grid = this.textures.get(this.TEXTURE0).grid.slice(), out = new Uint8Array(size * size * 4);
    for (let i = 0; i < grid.length; i++) if (!Number.isFinite(grid[i]) || grid[i] <= -20000) grid[i] = NaN;
    const terrain = raster.renderRgba("hs", {grid, size, n: size+2, groundRes: u.u_groundResOverride / shaders.reliefZFactor(u.u_groundResOverride)});
    const spectrum = drape.elevationColours(grid, size*size, {spectrumOn: true, level: u.u_spectrumLevel,
      span: u.u_spectrumSpan, spectrumAlpha: u.u_spectrumAlpha, bandCompiled: {rgba: () => [0,0,0,0]}}, new Uint8Array(size*size*4), size, size+2, size+3);
    for (let i = 0; i < size*size; i++) {
      const o = 4*i, a = spectrum[o+3]/255*u.u_spectrumOpacity, ta = terrain[o+3]/255*u.u_terrainOpacity;
      for (let c = 0; c < 3; c++) out[o+c] = Math.round(spectrum[o+c]*a + terrain[o+c]*ta*(1-a));
      out[o+3] = Math.round((a + ta*(1-a))*255);
    }
    this.p.get(this.DRAW_FRAMEBUFFER_BINDING).target.pixels = out;
  }
  readPixels(x, y, w, h, f, t, pixels) { this.count("readbacks"); pixels.set(this.p.get(this.READ_FRAMEBUFFER_BINDING).target.pixels); }
}

function focusedChecks() {
  const gl = new GL(), initial = gl.state(), bytes = 6*6*4;
  const renderer = rendererModule.create({gl, maxBytes: bytes*2});
  assert.ok(renderer, "startup independently agrees with CPU raster/drape reference");
  assert.deepEqual(gl.state(), initial, "startup restores all modeled GL state");
  assert.equal(gl.calls.readbacks, 1, "only startup reads pixels");
  const grid = new Float32Array(36).fill(421.12345), targetTexture = {}, job = {key: "a", revision: 1, grid, size: 4, targetTexture, groundRes: 12, state: {terrain: {style: "slope"}}};
  assert.deepEqual(renderer.renderBatch([job]), {drawn: 1, uploaded: 1, evicted: 0});
  const storage = gl.calls.storage, queries = gl.calls.queries;
  job.state.terrain.style = "aspect";
  assert.deepEqual(renderer.renderBatch([job]), {drawn: 1, uploaded: 0, evicted: 0}, "style changes keep resident floats");
  assert.equal(gl.calls.storage, storage);
  const uniformBefore = renderer.stats().uniformUpdates;
  renderer.renderBatch([job, {...job, targetTexture: {}}]);
  assert.equal(renderer.stats().uniformUpdates, uniformBefore, "identical uniform values stay on GPU");
  assert.equal(gl.calls.queries - queries, 46, "exactly one 23-query snapshot per whole batch");
  job.revision = 2; renderer.renderBatch([job]);
  assert.equal(gl.calls.storage, storage, "revision updates reuse immutable allocation");
  assert.deepEqual(renderer.renderBatch([{...job, grid: grid.slice()}]), {drawn: 1, uploaded: 1, evicted: 0}, "identity change uploads even at same revision");
  renderer.renderBatch([{...job, key: "b", targetTexture: {}}]);
  renderer.renderBatch([{...job, key: "a"}]); // touch a; b is oldest
  assert.deepEqual(renderer.renderBatch([{...job, key: "c", targetTexture: {}}]), {drawn: 1, uploaded: 1, evicted: 1});
  assert.equal(renderer.remove("b"), false, "LRU evicts b");
  assert.equal(renderer.stats().inputBytes, bytes*2);
  const before = gl.state(), checkCount = gl.calls.completeness;
  gl.failDraw = true;
  assert.throws(() => renderer.renderBatch([job]), /injected draw failure/);
  assert.deepEqual(gl.state(), before, "throwing draw restores caller state");
  assert(!gl.deleted.has(targetTexture), "external target survives failure"); gl.failDraw = false;
  assert.equal(gl.calls.completeness, checkCount, "known target does not query completeness each draw");
  gl.incomplete = true;
  assert.throws(() => renderer.renderBatch([{...job, targetTexture: {}}]), /incomplete/);
  assert.deepEqual(gl.state(), before, "incomplete FBO restores state"); gl.incomplete = false;
  const reads = gl.calls.readbacks; renderer.renderBatch([job]); assert.equal(gl.calls.readbacks, reads, "production has no readbacks");
  gl.lost = true; assert.deepEqual(renderer.renderBatch([job]), {drawn: 0, uploaded: 0, evicted: 0}); gl.lost = false;
  assert.throws(() => renderer.renderBatch([{...job, grid: new Float32Array(35)}]), /Invalid/);
  renderer.clear(); renderer.clear(); assert.equal(renderer.stats().inputBytes, 0);
  renderer.destroy(); renderer.destroy(); assert(!gl.deleted.has(targetTexture));
  assert.deepEqual(renderer.renderBatch([job]), {drawn: 0, uploaded: 0, evicted: 0});
  const bad = new GL(), badState = bad.state(); bad.failCompile = true;
  assert.equal(rendererModule.create({gl: bad}), null); assert.deepEqual(bad.state(), badState);
  const mismatch = new GL(); mismatch.readPixels = (x,y,w,h,f,t,p) => p.fill(255);
  assert.equal(rendererModule.create({gl: mismatch}), null, "startup CPU mismatch rejects renderer");
  assert.equal(rendererModule.create({gl: {}}), null);
  console.log("gpu terrain 3D focused checks passed");
}

// Self-contained real-browser diagnostics. Actual GPU output is compared to
// CPU terrain-raster/drape references (premultiplied) without screenshots.
function browserChecks() {
  const check = (v, msg) => { if (!v) throw new Error(msg); };
  const gl = document.createElement("canvas").getContext("webgl2", {antialias: false});
  check(gl, "WebGL2 unavailable");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const hardware = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const renderer = CSPGpuTerrain3DRenderer.create({gl, maxBytes: 192*1024*1024});
  check(renderer, "startup GPU CPU parity failed");
  const size = 32, n = size+2, grid = new Float32Array(n*n), target = gl.createTexture();
  for (let y=-1; y<=size; y++) for (let x=-1; x<=size; x++) grid[(y+1)*n+x+1] = 110 + 0.11*x + 0.37*y + 0.05*x*x + 0.02*x*y;
  grid[8*n+11] = NaN; grid[9*n+12] = -20000; grid[10*n+13] = Infinity;
  const sanitized = grid.slice(); for (let i=0;i<sanitized.length;i++) if (!Number.isFinite(sanitized[i]) || sanitized[i]<=-20000) sanitized[i]=NaN;
  gl.bindTexture(gl.TEXTURE_2D, target); gl.texStorage2D(gl.TEXTURE_2D, 6, gl.RGBA8, size, size);
  const fbo = gl.createFramebuffer(), results = [], groundRes = 9;
  const read = () => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    const pixels = new Uint8Array(size*size*4); gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels); return pixels; };
  for (const style of Object.keys(CSPGpuTerrainShaders.STYLE_IDS)) {
    renderer.renderBatch([{key:"tile",revision:1,grid,size,targetTexture:target,groundRes,state:{terrain:{style}}}]);
    const pixels = read(), shaded = ["hs","hsmulti","tint"].includes(style);
    const expected = CSPTerrainRaster.renderRgba(style, {grid:sanitized,size,n,groundRes: shaded ? groundRes/CSPGpuTerrainShaders.reliefZFactor(groundRes):groundRes});
    let maxError=0, mismatches=0;
    for (let i=0;i<pixels.length;i++) {
      const ref = i%4===3 ? expected[i] : Math.round(expected[i]*expected[(i>>2)*4+3]/255);
      const error = Math.abs(pixels[i]-ref); maxError=Math.max(maxError,error); if(error>2)mismatches++;
    }
    check(mismatches===0, style+" parity mismatch "+JSON.stringify({maxError,mismatches})); results.push({style,maxError});
  }
  const spectrum = {spectrumOn:true,level:126,span:80,spectrumAlpha:0.61,bandCompiled:{rgba:()=>[0,0,0,0]}};
  renderer.renderBatch([{key:"tile",revision:1,grid,size,targetTexture:target,groundRes,state:{terrain:{style:"off"},spectrum}}]);
  const pixels=read(), expected=CSPTerrainDrape.elevationColours(sanitized,size*size,spectrum,new Uint8Array(size*size*4),size,n,n+1);
  let spectrumError=0;
  for(let i=0;i<pixels.length;i++) spectrumError=Math.max(spectrumError, Math.abs(pixels[i]-(i%4===3?expected[i]:Math.round(expected[i]*expected[(i>>2)*4+3]/255))));
  check(spectrumError<=2,"spectrum parity mismatch "+spectrumError);
  const stats=renderer.stats(); check(stats.uploads===1,"style changes must reuse resident height");
  // Real-driver error path with hostile caller state and an external handle.
  gl.enable(gl.SCISSOR_TEST); gl.scissor(1,2,3,4); gl.colorMask(false,true,false,true);
  gl.viewport(3,5,7,9); gl.activeTexture(gl.TEXTURE3);
  const savedState = () => [gl.getParameter(gl.ACTIVE_TEXTURE), ...gl.getParameter(gl.VIEWPORT),
    ...gl.getParameter(gl.COLOR_WRITEMASK), gl.isEnabled(gl.SCISSOR_TEST), gl.getParameter(gl.CURRENT_PROGRAM),
    gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), gl.getParameter(gl.VERTEX_ARRAY_BINDING)];
  const beforeFailure=savedState(), draw=gl.drawArrays;
  let failed=false;
  try { gl.drawArrays=()=>{throw new Error("diagnostic injected failure");};
    renderer.renderBatch([{key:"tile",revision:1,grid,size,targetTexture:target,groundRes,state:{terrain:{style:"hs"}}}]);
  } catch(e) { failed=/diagnostic injected failure/.test(e.message); }
  finally { gl.drawArrays=draw; }
  check(failed && beforeFailure.every((v,i)=>v===savedState()[i]),"real driver failure must restore caller state");
  check(gl.isTexture(target),"external target survives render failure");
  const start=performance.now(); for(let i=0;i<100;i++) renderer.renderBatch([{key:"tile",revision:1,grid,size,targetTexture:target,groundRes,state:{terrain:{style:i%2?"slope":"hs"}}}]);
  const submissionMs=performance.now()-start;
  // Production tile size and a representative 42-tile batch. These timings
  // measure CPU command submission only; deferred GPU work is not timed.
  const largeSize=256, largeGrid=new Float32Array(258*258);
  for(let y=0;y<258;y++)for(let x=0;x<258;x++)largeGrid[y*258+x]=440+x*0.17+y*0.31;
  const largeTargets=[], jobs=[];
  gl.activeTexture(gl.TEXTURE0);
  for(let i=0;i<42;i++){
    const t=gl.createTexture();largeTargets.push(t);gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texStorage2D(gl.TEXTURE_2D,9,gl.RGBA8,largeSize,largeSize);
    jobs.push({key:"large"+i,revision:1,grid:largeGrid,size:largeSize,targetTexture:t,groundRes:2.4,state:{terrain:{style:"hs"}}});
  }
  let begin=performance.now();const cold=renderer.renderBatch(jobs), coldSubmissionMs=performance.now()-begin;
  for(const job of jobs)job.state={terrain:{style:"hsmulti",lighting:{azimuth:120}}};
  begin=performance.now();const relight=renderer.renderBatch(jobs), relightSubmissionMs=performance.now()-begin;
  check(cold.uploaded===42&&relight.uploaded===0,"42 real tiles relight without reupload");
  const largeStats=renderer.stats();
  for(const t of largeTargets)gl.deleteTexture(t);
  check(gl.getError()===gl.NO_ERROR,"WebGL error after parity and reuse");
  renderer.destroy(); check(gl.isTexture(target),"external texture must survive destroy"); gl.deleteTexture(target); gl.deleteFramebuffer(fbo);
  return {hardware,startupMaxError:stats.selfTestMaxError,results,spectrumError,stats,submission100Ms:submissionMs,largeBatch:{size:256,tiles:42,cold,relight,coldSubmissionMs,relightSubmissionMs,stats:largeStats},benchmark:"CPU submission time only; no GPU completion timing or speedup claim"};
}
module.exports = {browserChecks};
if (require.main === module) focusedChecks();
