/* Clear Skies GPU 2D terrain engine. Float render targets are required: devices
 * without EXT_color_buffer_float deliberately use the existing CPU renderer.
 * No readback occurs in render(); only export, asynchronous provenance, and the
 * explicit diagnostic/start-up tests read pixels. See GPU_2D_TERRAIN_SPEC §4.3.
 *
 * Additions to that contract:
 * - options.sources() may supply current SourceSpecs for an already-loaded store;
 *   otherwise store.options.sources() or subsequent tile events discover sources.
 *   Replace SourceSpec objects on configuration changes. Call invalidate() after
 *   store.clear() or in-place source mutations; setState changes uniforms only.
 * - render.coverage estimates resident display-tile geometry. For valid-pixel
 *   coverage, readProvenance returns {ranks,samples,width,height,coverage}, sampled
 *   at up to256×256 pixels. Histogram counts refer to these samples.
 * - ready/stats().ready expose loss/recovery; onError optionally diagnoses create
 *   failures. debugReadHeight/debugLimits are synchronous test hooks, never used
 *   by the draw path. Exports retain horizontal extent if aspect ratio changes.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.CSPGpuTerrainEngine = factory();
}(typeof globalThis !== "undefined" ? globalThis :
  (typeof self !== "undefined" ? self : this), function () {
  "use strict";

  var DEFAULT_BYTES = 192 * 1024 * 1024, UPLOAD_MS = 4, DEG = Math.PI / 180;
  function mod(a, n) { return ((a % n) + n) % n; }
  var IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  /* Bottom-up field pixels -> the frozen map field's bottom-up pixels.
     Export crops/density change sampling, never the terrain-effect footprint. */
  function snapshotAuxTransform(reference, view, width, height) {
    var refPx = 256 * Math.pow(2, reference.zoom) * reference.dpr;
    var scale = refPx / (256 * Math.pow(2, view.zoom) * view.dpr);
    var angle = ((reference.bearing || 0) - (view.bearing || 0)) * DEG;
    var a = scale * Math.cos(angle), b = -scale * Math.sin(angle), c = -b, d = a;
    var bearing = (reference.bearing || 0) * DEG, cs = Math.cos(bearing), sn = Math.sin(bearing);
    var dx = (view.centerMerc[0] - reference.centerMerc[0]) * refPx;
    var dy = (view.centerMerc[1] - reference.centerMerc[1]) * refPx;
    var x = reference.cssSize[0] * reference.dpr / 2 + cs * dx - sn * dy;
    var y = reference.cssSize[1] * reference.dpr / 2 - sn * dx - cs * dy;
    return [a, b, 0, c, d, 0, x - a * width / 2 - c * height / 2, y - b * width / 2 - d * height / 2, 1];
  }
  function tileLevel(view) {
    return Math.min(22, Math.max(0, Math.round(view.zoom) +
      (view.dz === undefined ? (view.dpr >= 1.5 ? 1 : 0) : view.dz)));
  }
  /* The "Smoother panning" drag frame (CR-008): the same camera on the CSS
     pixel grid. The explicit dz keeps the live tile level, so the wanted
     tiles, requests and plan are the live view's; only display sampling
     changes. Metres per pixel follow the DPR, so shading stays physical. */
  function gestureView(view) {
    return {centerMerc: view.centerMerc, zoom: view.zoom, bearing: view.bearing || 0, cssSize: view.cssSize, dpr: 1,
      dz: tileLevel(view) - Math.round(view.zoom)};
  }
  function coverageBounds(view, margin, out) {
    var z = tileLevel(view), n = Math.pow(2, z), scale = n / (256 * Math.pow(2, view.zoom));
    var a = (view.bearing || 0) * DEG, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    var hx = (c * view.cssSize[0] + s * view.cssSize[1]) * scale / 2;
    var hy = (s * view.cssSize[0] + c * view.cssSize[1]) * scale / 2;
    var cx = view.centerMerc[0] * n, cy = view.centerMerc[1] * n;
    out = out || {}; out.z = z; out.n = n; out.x0 = Math.floor(cx - hx) - margin; out.x1 = Math.ceil(cx + hx) - 1 + margin;
    out.y0 = Math.max(0, Math.floor(cy - hy) - margin); out.y1 = Math.min(n - 1, Math.ceil(cy + hy) - 1 + margin); return out;
  }
  function coverageTiles(view, margin) {
    var b = coverageBounds(view, margin === undefined ? 1 : margin), out = [];
    // One canonical request per world tile, including views crossing ±180°.
    var end = Math.min(b.x1, b.x0 + b.n - 1);
    for (var y = b.y0; y <= b.y1; y++) for (var x = b.x0; x <= end; x++) out.push({z: b.z, x: mod(x, b.n), y: y});
    return out;
  }
  function cropFor(record, tile) {
    if (record.z > tile.z) return null;
    var scale = Math.pow(2, tile.z - record.z), n = Math.pow(2, tile.z), x = mod(tile.x, n);
    if (Math.floor(x / scale) !== mod(record.x, Math.pow(2, record.z)) || Math.floor(tile.y / scale) !== record.y) return null;
    return {x: mod(x, scale) / scale, y: mod(tile.y, scale) / scale, width: 1 / scale, height: 1 / scale};
  }
  /* keep(entry, key) -> 0..2 ranks eviction: the oldest entry of the lowest
     rank goes first (default: plain least-recently-used). */
  function TextureLRU(maxBytes, onEvict, keep) {
    this.maxBytes = Math.max(0, maxBytes); this.bytes = 0; this.entries = new Map(); this.onEvict = onEvict || function () {}; this.keep = keep || null;
  }
  Object.defineProperty(TextureLRU.prototype, "size", {get: function () { return this.entries.size; }});
  TextureLRU.prototype.peek = function (key) { return this.entries.get(key); };
  TextureLRU.prototype.get = function (key) { var e = this.entries.get(key); if (e) { this.entries.delete(key); this.entries.set(key, e); } return e; };
  TextureLRU.prototype.delete = function (key) {
    var e = this.entries.get(key); if (!e) return false;
    this.entries.delete(key); this.bytes -= e.bytes; this.onEvict(e, key); return true;
  };
  TextureLRU.prototype.victim = function () {
    if (!this.keep) return this.entries.keys().next().value;
    var best, bestRank = Infinity, it = this.entries.entries(), step;
    while (!(step = it.next()).done) {
      var rank = this.keep(step.value[1], step.value[0]);
      if (rank < bestRank) { best = step.value[0]; bestRank = rank; if (!rank) break; }
    }
    return best;
  };
  TextureLRU.prototype.set = function (key, entry) {
    if (!(entry.bytes >= 0) || entry.bytes > this.maxBytes) return false;
    this.delete(key);
    while (this.bytes + entry.bytes > this.maxBytes && this.entries.size) this.delete(this.victim());
    this.entries.set(key, entry); this.bytes += entry.bytes; return true;
  };
  TextureLRU.prototype.clear = function () { while (this.entries.size) this.delete(this.entries.keys().next().value); };
  function drainUploads(queue, upload, now, budgetMs) {
    var start = now(), count = 0, budget = budgetMs === undefined ? UPLOAD_MS : budgetMs;
    while (queue.size && (!count || now() - start < budget)) {
      var it = queue.entries().next().value; queue.delete(it[0]); upload(it[1]); count++;
    }
    return count;
  }

  var HEIGHT_VERTEX = '#version 300 es\nprecision highp float;\n' +
    'uniform vec2 u_origin,u_axisX,u_axisY,u_target;\n' +
    'void main(){vec2 p=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));' +
    'vec2 screen=u_origin+p.x*u_axisX+p.y*u_axisY;' +
    'gl_Position=vec4(screen/u_target*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);}\n';
  var HEIGHT_FRAGMENT = '#version 300 es\nprecision highp float; precision highp int;\n' +
    'uniform highp sampler2D u_native; uniform float u_rank; uniform bool u_smooth,u_fast; uniform vec2 u_target,u_sampleOrigin,u_sampleX,u_sampleY; layout(location=0) out vec2 result;\n' +
    'bool valid(float v){return !isnan(v)&&!isinf(v)&&v>-1e20;}\n' +
    'float at(ivec2 p){return texelFetch(u_native,clamp(p,ivec2(0),textureSize(u_native,0)-1),0).r;}\n' +
    'vec4 weights(float t){float t2=t*t,t3=t2*t;return vec4(-t3+2.*t2-t,3.*t3-5.*t2+2.,-3.*t3+4.*t2+t,t3-t2)*.5;}\n' +
    'float rowAt(ivec2 b,int y,vec4 w){return dot(vec4(at(b+ivec2(-1,y)),at(b+ivec2(0,y)),at(b+ivec2(1,y)),at(b+ivec2(2,y))),w);}\n' +
    'void main(){vec2 screen=vec2(gl_FragCoord.x,u_target.y-gl_FragCoord.y);vec2 p=clamp(u_sampleOrigin+screen.x*u_sampleX+screen.y*u_sampleY,vec2(0),vec2(textureSize(u_native,0)-1));' +
    'ivec2 b=ivec2(floor(p));vec2 f=p-vec2(b);float sum=0.,weight=0.;' +
    'if(u_fast){if(!u_smooth){vec4 v=vec4(at(b),at(b+ivec2(1,0)),at(b+ivec2(0,1)),at(b+ivec2(1,1)));result=vec2(dot(v,vec4((1.-f.x)*(1.-f.y),f.x*(1.-f.y),(1.-f.x)*f.y,f.x*f.y)),u_rank);return;}' +
    'vec4 wx=weights(f.x),wy=weights(f.y);float value=dot(vec4(rowAt(b,-1,wx),rowAt(b,0,wx),rowAt(b,1,wx),rowAt(b,2,wx)),wy);result=vec2(value,u_rank);return;}' +
    'if(u_smooth){vec4 wx=weights(f.x),wy=weights(f.y);float cubic=0.;bool allValid=true;' +
    'for(int y=0;y<4;y++)for(int x=0;x<4;x++){float v=at(b+ivec2(x-1,y-1));if(!valid(v))allValid=false;else cubic+=v*wx[x]*wy[y];}' +
    'if(allValid){result=vec2(cubic,u_rank);return;}}' +
    'for(int y=0;y<2;y++)for(int x=0;x<2;x++){float v=at(b+ivec2(x,y));float w=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);if(valid(v)&&w>0.){sum+=v*w;weight+=w;}}' +
    'if(weight<=0.)discard;result=vec2(sum/weight,u_rank);}\n';
  // Shade-module coordinates are top-down; framebuffer texels are bottom-up.
  var PRELUDE = '\n#define CSP_HAS_AUX 1\nuniform highp sampler2D u_cspField,u_cspBlur,u_cspBase; uniform float u_cspBlurScale,u_cspBaseScale; uniform mat3 u_cspAuxTransform;\n' +
    'ivec2 csp_size(){return textureSize(u_cspField,0);}\n' +
    'vec2 csp_sample(ivec2 p){ivec2 s=csp_size();p=clamp(p,ivec2(0),s-1);return texelFetch(u_cspField,ivec2(p.x,s.y-1-p.y),0).rg;}\n' +
    'float csp_height(ivec2 p){return csp_sample(p).r;}\n' +
    'int csp_rank(ivec2 p){return int(csp_sample(p).g+.5);}\n' +
    'bool csp_valid(ivec2 p){vec2 v=csp_sample(p);return v.g>0.&&!isnan(v.r)&&!isinf(v.r)&&v.r>-1e20;}\n' +
    // Filtered fields are stored at 1/scale resolution, bottom-up like the
    // field; read them bilinearly at the field pixel centre.
    'bool csp_auxAt(highp sampler2D t,float f,ivec2 p,out float v){v=0.;if(f<=0.)return false;ivec2 s=csp_size();' +
    'vec2 q=(u_cspAuxTransform*vec3(vec2(float(p.x),float(s.y-1-p.y))+.5,1.)).xy/f-.5;ivec2 b=ivec2(floor(q));vec2 fr=q-vec2(b);ivec2 ts=textureSize(t,0);float sum=0.,w=0.;' +
    'for(int y=0;y<2;y++)for(int x=0;x<2;x++){vec2 a=texelFetch(t,clamp(b+ivec2(x,y),ivec2(0),ts-1),0).rg;float k=(x==0?1.-fr.x:fr.x)*(y==0?1.-fr.y:fr.y);' +
    'if(a.g>0.&&k>0.){sum+=a.r*k;w+=k;}}if(w<=0.)return false;v=sum/w;return true;}\n' +
    'bool csp_blur(ivec2 p,out float v){return csp_auxAt(u_cspBlur,u_cspBlurScale,p,v);}\n' +
    'bool csp_base(ivec2 p,out float v){return csp_auxAt(u_cspBase,u_cspBaseScale,p,v);}\n';
  /* Separable filters for the layer stack's derived fields. Modes: 0 and 1
   * downsample by u_factor (mean, minimum); 2 and 3 filter along u_dir
   * (Gaussian, minimum). Output is (value, valid). */
  var FILTER = '#version 300 es\nprecision highp float; precision highp int;\n' +
    'uniform highp sampler2D u_src; uniform int u_mode,u_factor,u_radius; uniform ivec2 u_dir; uniform float u_weights[33]; layout(location=0) out vec2 result;\n' +
    'bool ok(vec2 v){return v.g>0.&&!isnan(v.r)&&!isinf(v.r)&&v.r>-1e20;}\n' +
    'void main(){ivec2 o=ivec2(gl_FragCoord.xy),s=textureSize(u_src,0);float acc=(u_mode==1||u_mode==3)?3.0e38:0.,w=0.;\n' +
    'if(u_mode<2){for(int y=0;y<u_factor;y++)for(int x=0;x<u_factor;x++){ivec2 q=o*u_factor+ivec2(x,y);if(q.x>=s.x||q.y>=s.y)continue;' +
    'vec2 v=texelFetch(u_src,q,0).rg;if(!ok(v))continue;if(u_mode==1)acc=min(acc,v.r);else acc+=v.r;w+=1.;}if(w<=0.){result=vec2(0.);return;}result=vec2(u_mode==1?acc:acc/w,1.);return;}\n' +
    'for(int k=-u_radius;k<=u_radius;k++){ivec2 q=o+u_dir*k;if(q.x<0||q.y<0||q.x>=s.x||q.y>=s.y)continue;vec2 v=texelFetch(u_src,q,0).rg;if(!ok(v))continue;' +
    'if(u_mode==3){acc=min(acc,v.r);w=1.;}else{float g=u_weights[abs(k)];acc+=v.r*g;w+=g;}}\n' +
    'if(w<=0.){result=vec2(0.);return;}result=vec2(u_mode==3?acc:acc/w,1.);}\n';
  /* Block minimum along u_dir: output texel o covers source texels o*factor ..
   * o*factor+factor-1 on that axis. A horizontal then a vertical pass equals
   * the 2D block minimum of FILTER mode 1 exactly (same skipped edges and
   * no-data), with factor reads per texel instead of factor squared. */
  var BLOCK_MIN = '#version 300 es\nprecision highp float; precision highp int;\n' +
    'uniform highp sampler2D u_src; uniform int u_factor; uniform ivec2 u_dir; layout(location=0) out vec2 result;\n' +
    'bool ok(vec2 v){return v.g>0.&&!isnan(v.r)&&!isinf(v.r)&&v.r>-1e20;}\n' +
    'void main(){ivec2 o=ivec2(gl_FragCoord.xy),s=textureSize(u_src,0),q0=o+o*u_dir*(u_factor-1);float acc=3.0e38;bool any=false;\n' +
    'for(int k=0;k<u_factor;k++){ivec2 q=q0+u_dir*k;if(q.x>=s.x||q.y>=s.y)break;vec2 v=texelFetch(u_src,q,0).rg;if(!ok(v))continue;acc=min(acc,v.r);any=true;}\n' +
    'result=any?vec2(acc,1.):vec2(0.);}\n';
  /* Samples the visible height (and relative-elevation base) on a coarse
   * grid for range fitting: (height, valid, base, baseValid). */
  var STATS = '#version 300 es\nprecision highp float; precision highp int;\n' + PRELUDE +
    'in vec2 v_screenUv; out vec4 o; void main(){ivec2 s=csp_size();ivec2 p=clamp(ivec2(floor(v_screenUv*vec2(s))),ivec2(0),s-1);' +
    'float b;bool hb=csp_base(p,b);o=vec4(csp_height(p),csp_valid(p)?1.:0.,b,hb?1.:0.);}\n';
  /* Plan for one derived field: a downsample factor that keeps the dense
   * filter radius at most 32 texels, and at most 64x64 source texels per
   * downsampled texel. Radii below one field pixel produce nothing. */
  function auxPlan(radiusPx, width, height) {
    if (!(radiusPx >= 1)) return null;
    var factor = Math.min(64, Math.max(1, Math.ceil(radiusPx / 32)));
    return {factor: factor, radius: Math.max(1, Math.min(32, Math.round(radiusPx / factor))),
      width: Math.max(1, Math.ceil(width / factor)), height: Math.max(1, Math.ceil(height / factor))};
  }
  /* Derived-field radii in field pixels for a state and view: the detail
   * blur and the relative-elevation base. Only layers that need them ask. */
  function auxRadii(state, view, shaders) {
    var stack = state && state.terrain && state.terrain.stack, out = {blur: 0, base: 0};
    if (!stack || !Array.isArray(stack.layers) || !stack.layers.length || !shaders.metersPerPixel) return out;
    var mpp = shaders.metersPerPixel(view);
    if (!(mpp > 0)) return out;
    if (Number(stack.detail) && Number(stack.detailRadius) > 0) out.blur = Number(stack.detailRadius) / mpp;
    if (Number(stack.remRadius) > 0 && stack.layers.some(function (layer) { return layer && layer.style === 'rem'; }))
      out.base = Number(stack.remRadius) / mpp;
    return out;
  }
  var FULLSCREEN = '#version 300 es\nout vec2 v_screenUv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));v_screenUv=vec2(p.x,1.-p.y);gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var PROVENANCE = '#version 300 es\nprecision highp float; precision highp int;\nuniform highp sampler2D u_cspField;in vec2 v_screenUv;out vec4 colour;' +
    'void main(){ivec2 s=textureSize(u_cspField,0);ivec2 p=clamp(ivec2(vec2(v_screenUv.x,1.-v_screenUv.y)*vec2(s)),ivec2(0),s-1);float r=texelFetch(u_cspField,p,0).g;colour=vec4(r/255.,0.,0.,1.);}\n';

  function create(options) {
    options = options || {};
    var canvas = options.canvas, store = options.store, shaders = options.shaders, gl;
    var root = typeof globalThis !== 'undefined' ? globalThis : {};
    var core = options.elevationCore || root.ElevationTileCore;
    var raster = root.CSPTerrainRaster, drape = root.CSPTerrainDrape, bands = root.ElevationBands;
    if (!core && typeof require === 'function') core = require('./elevation-tile-core.js');
    var now = function () { return root.performance ? root.performance.now() : Date.now(); };
    var requestFrame = typeof options.onNeedsFrame === 'function' ? options.onNeedsFrame : function () {};
    var destroyed = false, ready = false, lost = false, error = null, dirty = true, heightDirty = true;
    var boundsScratch = {}, activeSources = null, sourceRefs = [], sourcesDirty = true, planBounds = {}, requestBounds = {}, shadeField, provenanceField;
    var generation = 0, frames = 0, drawCalls = 0, lastFrameMs = 0, uploads = 0, evictions = 0;
    var queue = new Map(), known = new Map(), sources = new Map(), sourceList = [], plan = [], planDirty = true;
    var wanted = [], coverageKey = '', viewScalars = new Float64Array(8), lastResult = {coverage: 0, missing: 0};
    viewScalars.fill(NaN);
    var state = {}, field = null, heightProgram, shadeProgram, provenanceProgram, statsProgram, stats = {}, vao, shadeSetters, blockMin = {};
    var gesture = null, gesturePeakBytes = 0, gestureUnsupported = false;
    var liveAux = {}, auxKey = '', filters = {}, shadeAux = {}, filterRadius = -1, filterWeights = new Float32Array(33);
    var h = {}, maxSize = 0, forcedMaxSize = 0, pendingReads = new Set(), frameRequested = false, phaseMs = {}, gpuTiming = false, gpuTotals = {height: 0, aux: 0, shade: 0, frames: 0}, gpuPixel = new Float32Array(4), gpuByte = new Uint8Array(4);
    /* Diagnostic GPU timing: a one-pixel read waits for the pass that drew
       that target (gl.finish does not in every browser). Totals accumulate
       so a coarse clock averages out over many frames. */
    function gpuSync(t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.framebuffer : null);
      if (t) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, gpuPixel); else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, gpuByte);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    function gpuPhase(name, t, mark) { gpuSync(t); var at = now(); phaseMs[name] = at - mark; gpuTotals[name] += at - mark; return at; }
    var snapshots = new Set(), deferredInvalidate = false;
    var resources = {textures: new Set(), framebuffers: new Set(), programs: new Set(), buffers: new Set(), syncs: new Set(), vaos: new Set()};
    var planStamp = 0;
    var lru = new TextureLRU(options.maxTextureBytes === undefined ? DEFAULT_BYTES : options.maxTextureBytes, function (entry) {
      if (entry.texture && !lost) deleteTexture(entry.texture);
      if (!lost) known.delete(entry.key); evictions++; planDirty = heightDirty = dirty = true;
    }, function (entry, key) {
      // Evict what is neither drawn now nor wanted by the store (old views,
      // finer stand-ins already replaced) before the backdrop or the frame.
      return entry.planned === planStamp ? 2 : store.wants && store.wants(key) ? 1 : 0;
    });
    function needsFrame() { if (!destroyed && !frameRequested) { frameRequested = true; requestFrame(); } }
    function texture() { var t = gl.createTexture(); if (!t) throw new Error('Texture allocation failed'); resources.textures.add(t); return t; }
    function deleteTexture(t) { gl.deleteTexture(t); resources.textures.delete(t); }
    function framebuffer() { var f = gl.createFramebuffer(); if (!f) throw new Error('Framebuffer allocation failed'); resources.framebuffers.add(f); return f; }
    function deleteFramebuffer(f) { gl.deleteFramebuffer(f); resources.framebuffers.delete(f); }
    function program(vertex, fragment) {
      var p = gl.createProgram(), parts = [];
      if (!p) throw new Error('Program allocation failed');
      try {
        [vertex, fragment].forEach(function (src, i) {
          var s = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER); parts.push(s);
          gl.shaderSource(s, src); gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
          gl.attachShader(p, s);
        });
        gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        resources.programs.add(p); return p;
      } catch (e) { gl.deleteProgram(p); throw e; }
      finally { parts.forEach(function (s) { gl.deleteShader(s); }); }
    }
    function params() {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    function target(w, ht, float) {
      var t = texture(), f = framebuffer();
      gl.bindTexture(gl.TEXTURE_2D, t); params();
      gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RG32F : gl.RGBA8, w, ht, 0, float ? gl.RG : gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { deleteTexture(t); deleteFramebuffer(f); throw new Error('Incomplete terrain framebuffer'); }
      return {texture: t, framebuffer: f, width: w, height: ht};
    }
    function freeTarget(t) { if (t) { deleteTexture(t.texture); deleteFramebuffer(t.framebuffer); } }
    function cleanResources() {
      if (gl && !lost) {
        resources.syncs.forEach(function (s) { gl.deleteSync(s); }); resources.buffers.forEach(function (b) { gl.deleteBuffer(b); });
        resources.framebuffers.forEach(function (f) { gl.deleteFramebuffer(f); }); resources.textures.forEach(function (t) { gl.deleteTexture(t); });
        resources.programs.forEach(function (p) { gl.deleteProgram(p); }); resources.vaos.forEach(function (v) { gl.deleteVertexArray(v); });
      }
      Object.keys(resources).forEach(function (k) { resources[k].clear(); }); field = null; gesture = null; liveAux = {}; auxKey = '';
    }
    function setters(p) {
      var types = new Map(), out = [];
      for (var i = 0, count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < count; i++) {
        var u = gl.getActiveUniform(p, i); types.set(u.name.replace(/\[0\]$/, ''), {type: u.type, size: u.size});
      }
      shaders.SHADE_UNIFORMS.forEach(function (name) {
        var loc = gl.getUniformLocation(p, name), info = types.get(name.replace(/\[0\]$/, ''));
        out.push({name: name, location: loc, type: info && info.type, size: info && info.size});
      });
      return out;
    }
    function shadeUniforms(values) {
      for (var i = 0; i < shadeSetters.length; i++) {
        var u = shadeSetters[i], v = values[u.name], l = u.location;
        if (v === undefined) throw new Error('Missing terrain uniform ' + u.name);
        if (l === null) continue;
        switch (u.type) {
          case gl.BOOL: case gl.INT: case gl.SAMPLER_2D: case gl.SAMPLER_2D_ARRAY: if (u.size > 1 || typeof v !== 'number') gl.uniform1iv(l, v); else gl.uniform1i(l, v); break;
          case gl.INT_VEC2: case gl.BOOL_VEC2: gl.uniform2iv(l, v); break;
          case gl.INT_VEC3: case gl.BOOL_VEC3: gl.uniform3iv(l, v); break;
          case gl.INT_VEC4: case gl.BOOL_VEC4: gl.uniform4iv(l, v); break;
          case gl.FLOAT_VEC2: gl.uniform2fv(l, v); break;
          case gl.FLOAT_VEC3: gl.uniform3fv(l, v); break;
          case gl.FLOAT_VEC4: gl.uniform4fv(l, v); break;
          case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, v); break;
          case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, v); break;
          default: if (typeof v === 'number') gl.uniform1f(l, v); else gl.uniform1fv(l, v);
        }
      }
    }
    function init() {
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required (CPU fallback)');
      var dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), dims[0], dims[1]);
      heightProgram = program(HEIGHT_VERTEX, HEIGHT_FRAGMENT);
      shadeProgram = program(shaders.fullscreenVertexSource, shaders.shadeFragmentSource(PRELUDE));
      provenanceProgram = program(FULLSCREEN, PROVENANCE);
      // Separate uniform filter modes at compile time. The minimum/Gaussian
      // kernels then avoid the nested downsample loop's register requirements
      // on mobile GPUs. The operations and accumulation order are identical.
      [0, 2, 3, 4].forEach(function (mode) {
        var source = mode ? FILTER.replace('uniform int u_mode,u_factor,u_radius;', 'const int u_mode=' + (mode === 4 ? 3 : mode) + '; uniform int u_factor,u_radius;')
          : FILTER.replace('if(u_mode<2)', 'if(true)');
        if (mode === 4) source = source.replace('for(int k=-u_radius;k<=u_radius;k++)', 'for(int k=-1;k<=1;k++)')
          .replace('q=o+u_dir*k;', 'q=o+u_dir*k*u_radius;')
          // Clamping intermediate centres preserves the clipped window at
          // edges; skipping a centre could lose its valid interior samples.
          .replace('if(q.x<0||q.y<0||q.x>=s.x||q.y>=s.y)continue;', 'q=clamp(q,ivec2(0),s-1);');
        var filter = filters[mode] = {program: program(FULLSCREEN, source)};
        ['src', 'mode', 'factor', 'radius', 'dir', 'weights[0]'].forEach(function (n) { filter[n] = gl.getUniformLocation(filter.program, 'u_' + n); });
      });
      statsProgram = program(FULLSCREEN, STATS);
      blockMin.program = program(FULLSCREEN, BLOCK_MIN);
      ['src', 'factor', 'dir'].forEach(function (n) { blockMin[n] = gl.getUniformLocation(blockMin.program, 'u_' + n); });
      ['cspField', 'cspBlur', 'cspBase', 'cspBlurScale', 'cspBaseScale', 'cspAuxTransform'].forEach(function (n) { stats[n] = gl.getUniformLocation(statsProgram, 'u_' + n); });
      filterRadius = -1;
      vao = gl.createVertexArray(); resources.vaos.add(vao); gl.bindVertexArray(vao);
      ['origin', 'axisX', 'axisY', 'target', 'sampleOrigin', 'sampleX', 'sampleY', 'native', 'rank', 'smooth', 'fast'].forEach(function (n) { h[n] = gl.getUniformLocation(heightProgram, 'u_' + n); });
      shadeSetters = setters(shadeProgram);
      ['cspBlur', 'cspBase', 'cspBlurScale', 'cspBaseScale', 'cspAuxTransform'].forEach(function (n) { shadeAux[n] = gl.getUniformLocation(shadeProgram, 'u_' + n); });
      shadeField = gl.getUniformLocation(shadeProgram, 'u_cspField'); provenanceField = gl.getUniformLocation(provenanceProgram, 'u_cspField');
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DITHER);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      selfTest();
      ready = true; error = null; heightDirty = dirty = planDirty = true;
    }
    function makeNative(record) {
      var t = texture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); params();
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, record.width, record.height, 0, gl.RED, gl.FLOAT, record.grid);
      return t;
    }
    function nativeEntry(record) {
      var allValid = true, hasData = false, count = record.validCount;
      // ElevationTileStore records count their finite samples (> -20000) and
      // hold NaN everywhere else, so the count settles both flags exactly.
      if (Number.isInteger(count) && count >= 0 && count <= record.grid.length) { hasData = count > 0; allValid = count === record.grid.length; }
      else for (var i = 0; i < record.grid.length; i++) {
        if (Number.isFinite(record.grid[i]) && record.grid[i] > -1e20) hasData = true; else allValid = false;
      }
      var metadata = {key: record.key, sourceId: record.sourceId, rank: record.rank, label: record.label, url: record.url, cacheKey: record.cacheKey,
        z: record.z, x: record.x, y: record.y, width: record.width, height: record.height};
      // GPU residency must not pin CPU grids outside the store's own byte LRU.
      return {allValid: allValid, hasData: hasData, key: record.key, texture: makeNative(record), bytes: record.width * record.height * 4, record: metadata, revision: record.revision};
    }
    function upload(record) {
      if (!record || !record.grid || !record.width || !record.height) return;
      var bytes = record.width * record.height * 4, existing = lru.peek(record.key);
      if (existing && existing.revision === record.revision) return;
      if (bytes > lru.maxBytes) { known.delete(record.key); return; }
      var e = nativeEntry(record), t = e.texture;
      if (!lru.set(record.key, e)) deleteTexture(t);
      else { known.set(record.key, {sourceId: record.sourceId, z: record.z, x: record.x, y: record.y}); uploads++; heightDirty = dirty = planDirty = true; }
    }
    function onTile(record) {
      if (destroyed || !record || !record.key) return;
      known.set(record.key, {sourceId: record.sourceId, z: record.z, x: record.x, y: record.y});
      sources.set(record.sourceId, sources.get(record.sourceId) || {id: record.sourceId, rank: record.rank}); sourcesDirty = true;
      queue.set(record.key, record); heightDirty = dirty = planDirty = true; needsFrame();
    }
    function refreshSources() {
      var fn = options.sources || (store.options && store.options.sources), list = typeof fn === 'function' ? fn() : null;
      var changed = false;
      if (list) {
        changed = list.length !== sourceRefs.length;
        for (var i = 0; !changed && i < list.length; i++) if (list[i] !== sourceRefs[i]) changed = true;
        if (changed || !activeSources) {
          activeSources = new Set(); sourceRefs = list.slice();
          for (i = 0; i < list.length; i++) { activeSources.add(list[i].id); sources.set(list[i].id, list[i]); }
        }
      }
      if (changed || sourcesDirty) {
        sourceList.length = 0; sources.forEach(function (spec, id) { if (!activeSources || activeSources.has(id)) sourceList.push(spec); });
        sourcesDirty = false;
      }
      if (changed) {
        // Keep compatible resident sources (especially the overview) during a
        // configuration refresh. Only obsolete URLs/ranks/masks are removed.
        if (store.accepts) {
          lru.entries.forEach(function (entry, key) {
            entry.obsolete = !store.accepts(entry.record);
            if (entry.obsolete) { if (snapshots.size) deferredInvalidate = true; else lru.delete(key); }
          });
          queue.forEach(function (record, key) { if (!store.accepts(record)) { queue.delete(key); known.delete(key); } });
        }
        coverageKey = ''; heightDirty = dirty = planDirty = true;
      }
      return changed;
    }
    function want(view) {
      var b = coverageBounds(view, 1, boundsScratch);
      if (!coverageKey || b.z !== requestBounds.z || b.x0 !== requestBounds.x0 || b.x1 !== requestBounds.x1 || b.y0 !== requestBounds.y0 || b.y1 !== requestBounds.y1) {
        coverageKey = true; requestBounds.z = b.z; requestBounds.x0 = b.x0; requestBounds.x1 = b.x1; requestBounds.y0 = b.y0; requestBounds.y1 = b.y1; wanted = coverageTiles(view); generation++; planDirty = heightDirty = true;
        // The visible extent (no margin) sizes the store's coarse backdrop.
        refreshSources(); store.want(wanted, {generation: generation, bounds: coverageBounds(view, 0, {})});
      }
      return wanted;
    }
    function seed() {
      // Walk successively coarser CPU records as well: a finest tile's NaN
      // holes must not hide a valid same-source ancestor after engine creation.
      var visited = new Set();
      for (var s = 0; s < sourceList.length; s++) for (var i = 0; i < wanted.length; i++) {
        var spec = sourceList[s], tile = wanted[i];
        if (spec.allowed && !spec.allowed(tile)) continue;
        var r = store.finestFor(spec.id, tile);
        while (r) {
          if (visited.has(r.key)) break;
          visited.add(r.key);
          if (!lru.peek(r.key) && !queue.has(r.key)) onTile(r);
          if (r.z <= 0) break;
          r = store.finestFor(spec.id, {z: r.z - 1, x: Math.floor(r.x / 2), y: Math.floor(r.y / 2)});
        }
      }
    }
    function buildPlan(view, extra) {
      plan.length = 0; planStamp++;
      // Include fallback ancestors even when a finer tile has no-data holes.
      // Draw overlapping resident native records coarse→fine at each rank.
      // Finer records (left from a closer view) stand in only until their own
      // source covers the tile from its level or above; drawn afterwards they
      // would alias, keep old detail on screen and multiply draws.
      var b = coverageBounds(view, 0, boundsScratch), n = b.n, residents = [];
      planBounds.z = b.z; planBounds.x0 = b.x0; planBounds.x1 = b.x1; planBounds.y0 = b.y0; planBounds.y1 = b.y1;
      lru.entries.forEach(function (e) { if (e.hasData && !e.obsolete && (!activeSources || activeSources.has(e.record.sourceId))) residents.push(e); });
      // Export-only detail records (see exportTiles); a key already resident is drawn once.
      if (extra) for (var xi = 0; xi < extra.length; xi++) {
        var resident = lru.peek(extra[xi].key);
        if (extra[xi].hasData && (!resident || resident.obsolete)) residents.push(extra[xi]);
      }
      residents.sort(function (a, b) { return a.record.rank - b.record.rank || a.record.z - b.record.z || a.key.localeCompare(b.key); });
      var total = 0, covered = 0;
      for (var y = b.y0; y <= b.y1; y++) for (var wx = b.x0; wx <= b.x1; wx++) {
        var x = mod(wx, n), tile = {z: b.z, x: x, y: y}, has = false, tileStart = plan.length, complete = null;
        for (var j = 0; j < residents.length; j++) {
          var e = residents[j], r = e.record, spec = sources.get(r.sourceId);
          if (spec && spec.allowed && !spec.allowed(tile)) continue;
          // Sorted by z within a rank, a source's own coverage precedes its finer records.
          if (r.z > b.z && complete && complete[r.sourceId]) continue;
          var factor = Math.pow(2, b.z - r.z), rx0 = mod(r.x, Math.pow(2, r.z)) * factor, ry0 = r.y * factor;
          var x0 = Math.max(x, rx0), y0 = Math.max(y, ry0), x1 = Math.min(x + 1, rx0 + factor), y1 = Math.min(y + 1, ry0 + factor);
          if (x1 <= x0 || y1 <= y0) continue;
          // A complete higher-priority record hides every earlier draw in
          // this display tile. Retain fallback draws when any native sample
          // is missing, so finer no-data still reveals the lower rank.
          if (e.allValid && x0 === x && y0 === y && x1 === x + 1 && y1 === y + 1) { plan.length = tileStart; (complete || (complete = {}))[r.sourceId] = true; }
          var crop = {x: (x0 - rx0) / factor, y: (y0 - ry0) / factor, width: (x1 - x0) / factor, height: (y1 - y0) / factor, nativeWidth: r.width, nativeHeight: r.height};
          plan.push({entry: e, x: wx + x0 - x, y: y0, width: x1 - x0, height: y1 - y0, crop: crop, z: b.z}); has = true;
          lru.get(e.key);
        }
        total++; if (has) covered++;
      }
      plan.sort(function (a, b) { return a.entry.record.rank - b.entry.record.rank || a.entry.record.z - b.entry.record.z || a.entry.key.localeCompare(b.entry.key) || a.y - b.y || a.x - b.x; });
      var merged = [];
      for (var k = 0; k < plan.length; k++) {
        var p = plan[k], prev = merged[merged.length - 1];
        if (prev && prev.entry === p.entry && prev.y === p.y && prev.height === p.height && prev.x + prev.width === p.x && Math.abs(prev.crop.x + prev.crop.width - p.crop.x) < 1e-12) {
          prev.width += p.width; prev.crop.width += p.crop.width;
        } else merged.push(p);
      }
      plan.length = 0;
      for (k = 0; k < merged.length; k++) {
        p = merged[k]; prev = plan[plan.length - 1];
        if (prev && prev.entry === p.entry && prev.x === p.x && prev.width === p.width && prev.y + prev.height === p.y && Math.abs(prev.crop.y + prev.crop.height - p.crop.y) < 1e-12) {
          prev.height += p.height; prev.crop.height += p.crop.height;
        } else plan.push(p);
      }
      for (k = 0; k < plan.length; k++) plan[k].entry.planned = planStamp;
      // This synchronous result measures resident geometric coverage, not NaN
      // pixel coverage. readProvenance() supplies the latter asynchronously.
      lastResult = {coverage: total ? covered / total : 0, missing: total - covered}; planDirty = false;
    }
    function beginHeight(t) {
      gl.bindVertexArray(vao); gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer); gl.viewport(0, 0, t.width, t.height);
      gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(heightProgram);
      gl.uniform2f(h.target, t.width, t.height); gl.uniform1i(h.native, 0); gl.activeTexture(gl.TEXTURE0);
    }
    function heightQuad(t, tex, rank, originX, originY, ax, ay, bx, by, crop, smooth, fast) {
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform2f(h.origin, originX, originY);
      gl.uniform2f(h.axisX, ax, ay); gl.uniform2f(h.axisY, bx, by);
      // Derive native coordinates from fragment centres rather than interpolated
      // UVs: Metal rasterizer subpixel snapping otherwise changes downsampling.
      var nw = crop.nativeWidth, nh = crop.nativeHeight;
      var xden = ax * ax + ay * ay, yden = bx * bx + by * by;
      var xx = ax * crop.width * nw / xden, xy = ay * crop.width * nw / xden;
      var yx = bx * crop.height * nh / yden, yy = by * crop.height * nh / yden;
      gl.uniform2f(h.sampleOrigin, crop.x * nw - .5 - originX * xx - originY * xy, crop.y * nh - .5 - originX * yx - originY * yy);
      gl.uniform2f(h.sampleX, xx, yx); gl.uniform2f(h.sampleY, xy, yy); gl.uniform1f(h.rank, rank); gl.uniform1i(h.smooth, smooth ? 1 : 0); gl.uniform1i(h.fast, fast ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); drawCalls++;
    }
    function drawHeight(t, view) {
      beginHeight(t);
      var a = (view.bearing || 0) * DEG, c = Math.cos(a), s = Math.sin(a);
      var px = 256 * Math.pow(2, view.zoom) * view.dpr, n = Math.pow(2, tileLevel(view));
      var cx = view.centerMerc[0] * n, cy = view.centerMerc[1] * n, tilePx = px / n;
      for (var i = 0; i < plan.length; i++) {
        var p = plan[i], r = p.entry.record, dx = (p.x - cx) * tilePx, dy = (p.y - cy) * tilePx;
        var w = p.width * tilePx, ht = p.height * tilePx;
        heightQuad(t, p.entry.texture, r.rank, t.width / 2 + c * dx - s * dy, t.height / 2 + s * dx + c * dy,
          c * w, s * w, -s * ht, c * ht, p.crop, r.width * p.crop.width < w || r.height * p.crop.height < ht, p.entry.allValid);
      }
    }
    function drawShade(t, output, view, values, aux, transform) {
      aux = aux || {};
      gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.framebuffer : null); gl.viewport(0, 0, t.width, t.height);
      gl.useProgram(shadeProgram);
      // Unused aux samplers still point at a valid float texture.
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, aux.blur ? aux.blur.target.texture : t.texture);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, aux.base ? aux.base.target.texture : t.texture);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.uniform1i(shadeField, 0); gl.uniform1i(shadeAux.cspBlur, 1); gl.uniform1i(shadeAux.cspBase, 2);
      gl.uniform1f(shadeAux.cspBlurScale, aux.blur ? aux.blur.factor : 0); gl.uniform1f(shadeAux.cspBaseScale, aux.base ? aux.base.factor : 0);
      gl.uniformMatrix3fv(shadeAux.cspAuxTransform, false, transform || IDENTITY);
      shadeUniforms(values || shaders.uniformValues(state, view));
      gl.drawArrays(gl.TRIANGLES, 0, 3); drawCalls++;
    }
    function filterPass(src, dst, mode, factor, radius, dx, dy) {
      var f = filters[mode >= 2 ? mode : 0];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer); gl.viewport(0, 0, dst.width, dst.height);
      gl.bindVertexArray(vao); gl.useProgram(f.program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.texture);
      gl.uniform1i(f.src, 0); gl.uniform1i(f.mode, mode); gl.uniform1i(f.factor, factor || 1); gl.uniform1i(f.radius, radius || 0);
      gl.uniform2i(f.dir, dx || 0, dy || 0);
      if (mode === 2 && filterRadius !== radius) {
        // The kernel is uniform across every pixel and both axes. Compute it
        // once, retaining the same Gaussian and nodata normalization.
        var sigma = Math.max(.5, (radius || 1) / 2);
        for (var k = 0; k < filterWeights.length; k++) filterWeights[k] = Math.exp(-k * k / (2 * sigma * sigma));
        gl.uniform1fv(f['weights[0]'], filterWeights); filterRadius = radius;
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3); drawCalls++;
    }
    function blockMinPass(src, dst, factor, dx, dy) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer); gl.viewport(0, 0, dst.width, dst.height);
      gl.bindVertexArray(vao); gl.useProgram(blockMin.program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.texture);
      gl.uniform1i(blockMin.src, 0); gl.uniform1i(blockMin.factor, factor); gl.uniform2i(blockMin.dir, dx, dy);
      gl.drawArrays(gl.TRIANGLES, 0, 3); drawCalls++;
    }
    /* One derived field into cache[slot]: downsample (mean or minimum), an
     * optional separable minimum, then a separable Gaussian. Targets are
     * reused while their size holds. */
    function derive(src, radiusPx, minimum, cache, slot) {
      var plan = auxPlan(radiusPx, src.width, src.height), entry = cache[slot];
      if (!plan) { if (entry) { freeTarget(entry.a); freeTarget(entry.b); freeTarget(entry.rows); cache[slot] = null; } return null; }
      if (!entry || entry.a.width !== plan.width || entry.a.height !== plan.height) {
        if (entry) { freeTarget(entry.a); freeTarget(entry.b); freeTarget(entry.rows); }
        entry = cache[slot] = {a: target(plan.width, plan.height, true), b: target(plan.width, plan.height, true)};
      }
      // A factor of one is an identity copy. Start the first filter directly
      // from the height field; it already applies the same validity rule.
      var input = src;
      if (plan.factor > 1 && minimum) {
        // Row minima, then their column minima: the 2D block minimum exactly.
        if (!entry.rows || entry.rows.width !== plan.width || entry.rows.height !== src.height) {
          freeTarget(entry.rows); entry.rows = target(plan.width, src.height, true);
        }
        blockMinPass(src, entry.rows, plan.factor, 1, 0); blockMinPass(entry.rows, entry.a, plan.factor, 0, 1); input = entry.a;
      } else if (plan.factor > 1) { filterPass(src, entry.a, 0, plan.factor); input = entry.a; }
      if (minimum) {
        if (plan.radius < 8) {
          filterPass(input, entry.b, 3, 1, plan.radius, 1, 0); filterPass(entry.b, entry.a, 3, 1, plan.radius, 0, 1); input = entry.a;
        } else {
          // Exact minimum over [-r,r], composed from three-tap windows. If
          // the preceding window covers [-e,e], offsets -s/0/s cover every
          // integer in [-e-s,e+s] when s <= 2e+1. No sample is omitted or
          // approximated. Repeating an edge minimum has no effect on min;
          // invalid samples remain excluded at every stage.
          for (var axis = 0; axis < 2; axis++) for (var extent = 0; extent < plan.radius;) {
            var step = Math.min(2 * extent + 1, plan.radius - extent), next = input === entry.a ? entry.b : entry.a;
            filterPass(input, next, 4, 1, step, axis === 0 ? 1 : 0, axis === 1 ? 1 : 0);
            input = next; extent += step;
          }
        }
      }
      var temporary = input === entry.b ? entry.a : entry.b, output = temporary === entry.a ? entry.b : entry.a;
      filterPass(input, temporary, 2, 1, plan.radius, 1, 0); filterPass(temporary, output, 2, 1, plan.radius, 0, 1);
      entry.target = output; entry.factor = plan.factor; return entry;
    }
    function deriveAll(t, view, st, cache) {
      var radii = auxRadii(st, view, shaders);
      return {blur: derive(t, radii.blur, false, cache, 'blur'), base: derive(t, radii.base, true, cache, 'base')};
    }
    function freeAux(cache) { ['blur', 'base'].forEach(function (k) { var e = cache[k]; if (e) { freeTarget(e.a); freeTarget(e.b); freeTarget(e.rows); } cache[k] = null; }); }
    function readFloat(t) {
      // RG32F is a renderable format but portable WebGL float readback uses RGBA.
      var rgba = new Float32Array(t.width * t.height * 4), out = new Float32Array(t.width * t.height * 2);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer); gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.FLOAT, rgba);
      for (var y = 0; y < t.height; y++) for (var x = 0; x < t.width; x++) {
        var src = ((t.height - 1 - y) * t.width + x) * 4, dst = (y * t.width + x) * 2;
        out[dst] = rgba[src]; out[dst + 1] = rgba[src + 1];
      }
      return {width: t.width, height: t.height, data: out};
    }
    function selfTest() {
      if (!core || !core.resampleElevation) throw new Error('ElevationTileCore is required for the GPU self-test');
      var grid = new Float32Array(16); for (var i = 0; i < 16; i++) grid[i] = 10 + i * .125;
      grid[5] = NaN;
      var native = makeNative({width: 4, height: 4, grid: grid}), t = target(8, 8, true), colour = null;
      try {
        beginHeight(t); heightQuad(t, native, 3, 0, 0, 8, 0, 0, 8, {x: 0, y: 0, width: 1, height: 1, nativeWidth: 4, nativeHeight: 4}, true);
        var got = readFloat(t).data, expected = core.resampleElevation(grid, 4, 4, null, 8, 8, {smooth: true});
        for (i = 0; i < expected.length; i++) {
          if (Number.isFinite(expected[i]) ? Math.abs(got[i * 2] - expected[i]) > .002 || got[i * 2 + 1] !== 3 : got[i * 2 + 1] !== 0)
            throw new Error('Terrain pass-1 self-test mismatch at ' + i);
        }
        grid[5] = 10.625;
        gl.bindTexture(gl.TEXTURE_2D, native); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 4, gl.RED, gl.FLOAT, grid);
        beginHeight(t); heightQuad(t, native, 3, 0, 0, 8, 0, 0, 8, {x: 0, y: 0, width: 1, height: 1, nativeWidth: 4, nativeHeight: 4}, true, true);
        got = readFloat(t).data; expected = core.resampleElevation(grid, 4, 4, null, 8, 8, {smooth: true});
        for (i = 0; i < expected.length; i++) if (Math.abs(got[i * 2] - expected[i]) > .002 || got[i * 2 + 1] !== 3)
          throw new Error('Terrain complete-tile self-test mismatch at ' + i);
        if (shaders.VERSION !== 'test' && shaders.VERSION !== '0') {
          if (!raster || !drape || !bands) throw new Error('CPU shading references are required for the GPU self-test');
          // Flat fixture isolates upload/orientation/composite/uniform plumbing.
          grid.fill(12); gl.bindTexture(gl.TEXTURE_2D, native); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 4, gl.RED, gl.FLOAT, grid);
          beginHeight(t); heightQuad(t, native, 3, 0, 0, 8, 0, 0, 8, {x: 0, y: 0, width: 1, height: 1, nativeWidth: 4, nativeHeight: 4}, true);
          colour = target(8, 8, false);
          var view = {centerMerc: [.5, .5], zoom: 16, bearing: 0, cssSize: [8, 8], dpr: 1, dz: 0};
          var spectrum = {spectrumOn: false, level: 0, span: 100, spectrumAlpha: .65, belowOn: false, aboveOn: false,
            below: 0, above: 100, belowLevel: 0, aboveLevel: 100, bandAlpha: .5, bandFeather: 0, outline: false, outlineWidth: 0,
            bandState: {bands: [], outline: {enabled: false}}};
          var testState = {terrain: {style: 'hs', opacity: 1, look: {contrast: 100, saturation: 100, brightness: 100}, lighting: {azimuth: 315, altitude: 45, ambient: .12}}, spectrum: spectrum, spectrumOpacity: 1};
          var heights = new Float32Array(64); heights.fill(12);
          checkShade(testState, raster.renderRgba('hs', {grid: heights, width: 8, height: 8, groundRes: 1, lighting: testState.terrain.lighting}));
          testState.terrain.style = 'off'; spectrum.spectrumOn = true; spectrum.bandCompiled = bands.compileBands(spectrum.bandState);
          checkShade(testState, drape.elevationColours(heights, 64, spectrum, new Uint8ClampedArray(256), 8));
        }
        if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error in terrain self-test');
      } finally { freeTarget(colour); freeTarget(t); deleteTexture(native); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
      function checkShade(testState, expectedBytes) {
        drawShade(t, colour, view, shaders.uniformValues(testState, view));
        var bytes = new Uint8Array(256); gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        for (var p = 0; p < 64; p++) for (var k = 0; k < 4; k++) {
          var expectedByte = k === 3 ? expectedBytes[p * 4 + 3] : expectedBytes[p * 4 + k] * expectedBytes[p * 4 + 3] / 255;
          if (Math.abs(bytes[p * 4 + k] - expectedByte) > 3) throw new Error('Terrain shade self-test mismatch');
        }
      }
    }
    function sameView(v) {
      return viewScalars[0] === v.centerMerc[0] && viewScalars[1] === v.centerMerc[1] && viewScalars[2] === v.zoom &&
        viewScalars[3] === (v.bearing || 0) && viewScalars[4] === v.cssSize[0] && viewScalars[5] === v.cssSize[1] && viewScalars[6] === v.dpr && viewScalars[7] === tileLevel(v);
    }
    function rememberView(v) {
      viewScalars[0] = v.centerMerc[0]; viewScalars[1] = v.centerMerc[1]; viewScalars[2] = v.zoom; viewScalars[3] = v.bearing || 0;
      viewScalars[4] = v.cssSize[0]; viewScalars[5] = v.cssSize[1]; viewScalars[6] = v.dpr; viewScalars[7] = tileLevel(v);
    }
    function render(view, options) {
      frameRequested = false;
      if (!ready || destroyed) return lastResult;
      var start = now(), mark = start, t; drawCalls = 0;
      var coarse = !!(options && options.coarse) && view.dpr >= 1.5 && !gestureUnsupported;
      // JS time per phase (GPU work runs asynchronously); diagnostics only.
      phaseMs.want = phaseMs.seed = phaseMs.upload = phaseMs.plan = phaseMs.draw = phaseMs.height = phaseMs.aux = phaseMs.shade = 0;
      try {
        refreshSources();
        var changed = !sameView(view);
        if (changed) {
          rememberView(view); heightDirty = dirty = true;
          var visible = coverageBounds(view, 0, boundsScratch);
          if (visible.z !== planBounds.z || visible.x0 !== planBounds.x0 || visible.x1 !== planBounds.x1 || visible.y0 !== planBounds.y0 || visible.y1 !== planBounds.y1) planDirty = true;
        }
        want(view);
        t = now(); phaseMs.want = t - mark; mark = t;
        if (planDirty) { refreshSources(); seed(); }
        t = now(); phaseMs.seed = t - mark; mark = t;
        // A capture owns one immutable set of resident sources. Refinement is
        // queued until it releases them, so later blocks cannot change surveys.
        if (!snapshots.size) drainUploads(queue, upload, now, UPLOAD_MS);
        if (queue.size && !snapshots.size) needsFrame();
        t = now(); phaseMs.upload = t - mark; mark = t;
        var w = Math.max(1, Math.round(view.cssSize[0] * view.dpr)), ht = Math.max(1, Math.round(view.cssSize[1] * view.dpr));
        if (w > maxSize || ht > maxSize) throw new Error('Interactive viewport exceeds WebGL target limits');
        if (coarse && renderGesture(view, w, ht)) { phaseMs.draw = now() - mark; lastFrameMs = now() - start; return lastResult; }
        if (gesture) releaseGesture();
        if (!field || field.width !== w || field.height !== ht) {
          freeTarget(field); field = target(w, ht, true); heightDirty = dirty = true;
          canvas.width = w; canvas.height = ht;
        }
        if (planDirty) buildPlan(view);
        t = now(); phaseMs.plan = t - mark; mark = t;
        var radii = auxRadii(state, view, shaders), key = [Math.round(radii.blur * 4), Math.round(radii.base), field.width, field.height].join(',');
        if (gpuTiming) { gpuSync(field); mark = now(); }
        if (heightDirty) { drawHeight(field, view); heightDirty = false; dirty = true; auxKey = ''; if (gpuTiming) mark = gpuPhase('height', field, mark); }
        if (key !== auxKey) { liveAux = deriveAll(field, view, state, liveAux); auxKey = key; dirty = true; if (gpuTiming) mark = gpuPhase('aux', liveAux.base || liveAux.blur ? (liveAux.base || liveAux.blur).target : field, mark); }
        if (dirty) { drawShade(field, null, view, null, liveAux); dirty = false; frames++; if (gpuTiming) { mark = gpuPhase('shade', null, mark); gpuTotals.frames++; } }
        phaseMs.draw = now() - mark;
      } catch (e) { error = String(e && e.message || e); ready = false; }
      lastFrameMs = now() - start; return lastResult;
    }
    /* A drag frame on the CSS grid, stretched to the unchanged canvas. Its
       targets are separate, so the device-resolution field and canvas keep
       their size; the next full frame redraws that field and frees these. */
    function renderGesture(view, w, ht) {
      var gv = gestureView(view), cw = Math.max(1, Math.round(view.cssSize[0])), ch = Math.max(1, Math.round(view.cssSize[1]));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== ht) canvas.height = ht;
      var fresh = !gesture || gesture.field.width !== cw || gesture.field.height !== ch;
      if (fresh) { releaseGesture(); gesture = {field: target(cw, ch, true), colour: target(cw, ch, false), aux: {}}; }
      if (planDirty) buildPlan(view);
      drawHeight(gesture.field, gv);
      gesture.aux = deriveAll(gesture.field, gv, state, gesture.aux);
      drawShade(gesture.field, gesture.colour, gv, null, gesture.aux);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gesture.colour.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, cw, ch, 0, 0, w, ht, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // One synchronous check per allocation. A context that cannot stretch
      // this way keeps every frame at full resolution instead.
      if (fresh && gl.getError() !== gl.NO_ERROR) { gestureUnsupported = true; releaseGesture(); heightDirty = dirty = true; return false; }
      gesturePeakBytes = Math.max(gesturePeakBytes, gestureBytes());
      // The canvas no longer shows the device-resolution field.
      heightDirty = dirty = true; frames++; return true;
    }
    function gestureBytes() {
      if (!gesture) return 0;
      var n = gesture.field.width * gesture.field.height * 12;
      ['blur', 'base'].forEach(function (k) {
        var e = gesture.aux[k]; if (!e) return;
        [e.a, e.b, e.rows].forEach(function (t) { if (t) n += t.width * t.height * 8; });
      });
      return n;
    }
    function releaseGesture() {
      if (!gesture) return;
      freeTarget(gesture.field); freeTarget(gesture.colour); freeAux(gesture.aux); gesture = null;
    }
    function cancelReads(reason) { pendingReads.forEach(function (job) { job.cancel(reason); }); pendingReads.clear(); }
    function onLost(event) {
      event.preventDefault(); lost = true; ready = false; frameRequested = false; cancelReads('Terrain context lost');
      snapshots.forEach(function (snapshot) { snapshot.invalid = true; });
      cleanResources(); lru.clear(); queue.clear(); plan.length = 0; lastResult = {coverage: 0, missing: wanted.length};
    }
    function onRestored() {
      if (destroyed) return;
      lost = false;
      try {
        init(); known.forEach(function (_, key) { var record = store.get(key); if (record) queue.set(key, record); });
        coverageKey = ''; viewScalars.fill(NaN); needsFrame();
      } catch (e) { error = String(e && e.message || e); ready = false; cleanResources(); }
    }
    function copyState(value) {
      if (!value || typeof value !== 'object') return value;
      if (ArrayBuffer.isView(value)) return value.slice();
      var out = Array.isArray(value) ? [] : {};
      Object.keys(value).forEach(function (key) { out[key] = copyState(value[key]); }); return out;
    }
    // Keep main's separate native-detail budget; capture freezes the live LRU.
    var exportTextureBytes = options.exportTextureBytes === undefined ? 128 * 1024 * 1024 : Math.max(0, options.exportTextureBytes);
    var exportChunk = Math.max(256, options.exportChunk || 2048), exportCache = null;
    function releaseExport() {
      if (exportCache) { var previous = exportCache; exportCache = null; previous.snapshot.release(); }
    }
    function maxNativeLevel() {
      refreshSources();
      var max = 0;
      for (var i = 0; i < sourceRefs.length; i++) {
        var n = sourceRefs[i].nativeZoom, z = typeof n === 'function' ? n(22) : (n === undefined ? 22 : +n);
        if (z > max) max = z;
      }
      return sourceRefs.length ? Math.min(22, Math.floor(max)) : 22;
    }
    function exportLevel(view, dpr) {
      var live = tileLevel(view), ideal = Math.ceil(view.zoom + Math.log2(Math.max(1e-6, dpr)) - .25);
      return Math.max(live, Math.min(ideal, maxNativeLevel()));
    }
    /* {z, live, tiles}: the export's elevation level, the live view's, and
     * how many display tiles an export finer than the view will request. */
    function exportDetail(view, width) {
      var dpr = width / view.cssSize[0], z = exportLevel(view, dpr), live = tileLevel(view);
      if (z <= live) return {z: z, live: live, tiles: 0};
      var b = coverageBounds(Object.assign({}, view, {dpr: dpr, dz: z - Math.round(view.zoom)}), 0, {});
      return {z: z, live: live, tiles: Math.max(0, Math.min(b.x1 - b.x0 + 1, b.n)) * Math.max(0, b.y1 - b.y0 + 1)};
    }
    /* Native records for one export piece at its detail level, uploaded into
     * the export's own texture cache rather than the live LRU, so a large
     * export neither evicts the view's tiles nor is limited to them. */
    async function exportTiles(sub, cache, options) {
      // Pieces share edge tiles; progress counts each display tile once per export.
      var onTile = options.onTile && function (d) { var k = d.z + '/' + d.x + '/' + d.y; if (!cache.seen.has(k)) { cache.seen.add(k); options.onTile(d); } };
      var got = await store.loadDetail(coverageTiles(sub, 0), {signal: options.signal, onTile: onTile, reuse: function (key) {
        var e = cache.tiles.get(key) || lru.peek(key); return e && !e.obsolete ? {hasData: e.hasData, allValid: e.allValid} : null;
      }});
      if (cache.released || cache.invalid || !ready || destroyed || lost) throw new Error('Terrain context unavailable during export');
      if (options.signal && options.signal.aborted) throw new Error('Export cancelled');
      var entries = [];
      for (var i = 0; i < got.length; i++) {
        var g = got[i], e = cache.tiles.get(g.key);
        if (e) { cache.tiles.delete(g.key); cache.tiles.set(g.key, e); }
        else if (g.reused) continue; // Live residents are already in every plan.
        else if (g.grid && g.width && g.height) { e = nativeEntry(g); cache.tiles.set(g.key, e); cache.bytes += e.bytes; }
        if (e) entries.push(e);
      }
      return entries;
    }
    function trimExportTiles(cache) {
      while (cache.bytes > exportTextureBytes && cache.tiles.size) {
        var key = cache.tiles.keys().next().value, e = cache.tiles.get(key);
        cache.tiles.delete(key); cache.bytes -= e.bytes; if (!lost) deleteTexture(e.texture);
      }
    }
    function createSnapshot(view) {
      if (!ready || destroyed) throw new Error('Terrain engine is not ready');
      render(view);
      if (!ready || destroyed) throw new Error('Terrain engine is not ready');
      var aux = {}, snapshot, savedPlan = plan, savedResult = lastResult;
      try {
        // Copy only the small derived fields. Native elevations stay resident
        // under the existing LRU; uploads resume when the capture is released.
        ['blur', 'base'].forEach(function (name) {
          var entry = liveAux[name]; if (!entry) return;
          var source = entry.target, t = target(source.width, source.height, true);
          aux[name] = {a: t, target: t, factor: entry.factor};
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.framebuffer);
          gl.blitFramebuffer(0, 0, source.width, source.height, 0, 0, t.width, t.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        });
        // Include the neighbouring sample required by Sobel/outline at a crop
        // edge, using the same already-resident sources as the map.
        plan = []; buildPlan(Object.assign({}, view, {cssSize: [view.cssSize[0] + 2 / view.dpr, view.cssSize[1] + 2 / view.dpr]}));
        snapshot = {view: copyState(view), state: copyState(state), aux: aux,
          plan: plan.slice(), tiles: new Map(), bytes: 0, seen: new Set(), released: false, release: function () {
            if (snapshot.released) return;
            snapshot.released = true; snapshots.delete(snapshot);
            // Context loss already invalidated/freed these objects. A later
            // release must not delete old-generation handles after restore.
            if (!lost && !snapshot.invalid) { freeAux(aux); snapshot.tiles.forEach(function (entry) { deleteTexture(entry.texture); }); }
            else { aux.blur = null; aux.base = null; }
            snapshot.tiles.clear(); snapshot.bytes = 0;
            if (!snapshots.size && deferredInvalidate) { deferredInvalidate = false; invalidate(); }
            dirty = heightDirty = planDirty = true; needsFrame();
          }};
        snapshots.add(snapshot); return snapshot;
      } catch (e) { freeAux(aux); throw e; }
      finally { plan = savedPlan; lastResult = savedResult; planDirty = true; gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    }
    async function renderToCanvas(view, width, height, region, options) {
      // The existing capture probes may pass a frozen snapshot directly.
      if (region && region.release && region.view) { options = Object.assign({}, options, {snapshot: region}); region = null; }
      options = options || {};
      if (!ready || destroyed) throw new Error('Terrain engine is not ready');
      width = Math.round(width); height = Math.round(height);
      if (!(width > 0 && height > 0)) throw new RangeError('Export dimensions must be positive');
      var whole = !region;
      region = whole ? {x: 0, y: 0, width: width, height: height}
        : {x: Math.round(region.x || 0), y: Math.round(region.y || 0), width: Math.round(region.width), height: Math.round(region.height)};
      if (!(region.width > 0 && region.height > 0 && region.x >= 0 && region.y >= 0 && region.x + region.width <= width && region.y + region.height <= height))
        throw new RangeError('Export region must lie inside the export');
      var doc = canvas.ownerDocument || root.document, result = doc.createElement('canvas'); result.width = region.width; result.height = region.height;
      var ctx = result.getContext('2d'); if (!ctx) throw new Error('2D export context unavailable');
      // Export keeps horizontal map extent; callers normally preserve the view aspect ratio.
      var dpr = width / view.cssSize[0], limit = Math.min(maxSize, forcedMaxSize || maxSize), stride = limit - 2;
      if (stride < 1) throw new Error('WebGL export target limit too small');
      var snapshot = options.snapshot, ownsSnapshot = !snapshot && whole;
      if (!snapshot && !whole) {
        var key = [JSON.stringify(view), width, height].join('|');
        if (!exportCache || exportCache.key !== key) { releaseExport(); exportCache = {key: key, snapshot: createSnapshot(view)}; }
        snapshot = exportCache.snapshot;
      }
      snapshot = snapshot || createSnapshot(view);
      if (snapshot.released || snapshot.invalid) throw new Error('Terrain capture is unavailable');
      var exportState = snapshot.state;
      var level = exportLevel(view, dpr), detail = options.detail !== false && level > tileLevel(view) && typeof store.loadDetail === 'function';
      if (detail) stride = Math.max(1, Math.min(stride, exportChunk - 2));
      var right = region.x + region.width, bottom = region.y + region.height;
      var a = (view.bearing || 0) * DEG, c = Math.cos(a), s = Math.sin(a), worldPx = 256 * Math.pow(2, view.zoom) * dpr;
      try {
        for (var top = region.y; top < bottom; top += stride) for (var left = region.x; left < right; left += stride) {
          if (!ready || destroyed || snapshot.invalid) throw new Error('Terrain context unavailable during export');
          var iw = Math.min(stride, right - left), ih = Math.min(stride, bottom - top);
          // One-pixel halos make Sobel/outline reads identical at tile seams.
          var lx = left - 1, ty = top - 1, rx = left + iw + 1, by = top + ih + 1;
          var w = rx - lx, ht = by - ty, dx = (lx + rx) / 2 - width / 2, dy = (ty + by) / 2 - height / 2;
          var sub = {centerMerc: [view.centerMerc[0] + (c * dx + s * dy) / worldPx, view.centerMerc[1] + (-s * dx + c * dy) / worldPx],
            zoom: view.zoom, bearing: view.bearing || 0, cssSize: [w / dpr, ht / dpr], dpr: dpr, dz: detail ? level - Math.round(view.zoom) : view.dz};
          // Fetch detail separately while the live sources/effect fields stay frozen.
          var extra = detail ? await exportTiles(sub, snapshot, options) : null;
          var savedPlan = plan, savedResult = lastResult, t = null, colour = null;
          plan = snapshot.plan;
          if (detail) { plan = []; buildPlan(sub, extra); }
          try {
            t = target(w, ht, true); colour = target(w, ht, false); drawHeight(t, sub);
            drawShade(t, colour, sub, shaders.uniformValues(exportState, sub), snapshot.aux,
              snapshotAuxTransform(snapshot.view, sub, w, ht));
            var pixels = new Uint8Array(w * ht * 4); gl.readPixels(0, 0, w, ht, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            var image = ctx.createImageData(iw, ih);
            for (var y = 0; y < ih; y++) for (var x = 0; x < iw; x++) {
              var src = ((ht - 1 - (top - ty + y)) * w + left - lx + x) * 4, dst = (y * iw + x) * 4, alpha = pixels[src + 3];
              image.data[dst] = alpha ? Math.min(255, Math.round(pixels[src] * 255 / alpha)) : 0;
              image.data[dst + 1] = alpha ? Math.min(255, Math.round(pixels[src + 1] * 255 / alpha)) : 0;
              image.data[dst + 2] = alpha ? Math.min(255, Math.round(pixels[src + 2] * 255 / alpha)) : 0; image.data[dst + 3] = alpha;
            }
            ctx.putImageData(image, left - region.x, top - region.y);
          } finally { freeTarget(colour); freeTarget(t); plan = savedPlan; lastResult = savedResult; planDirty = true; if (detail) trimExportTiles(snapshot); }
          // Yield between chunks so large exports do not monopolize the UI thread.
          await new Promise(function (resolve) { setTimeout(resolve, 0); });
        }
      } finally { if (ownsSnapshot) snapshot.release(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); dirty = heightDirty = planDirty = true; needsFrame(); }
      return result;
    }
    /* Synchronous coarse readback for "fit range to view": at most 128x128
     * samples of the current field. Returns finite heights and, where the
     * relative-elevation base exists, height above it. */
    function sampleValues() {
      if (!ready || !field || destroyed) return null;
      var w = Math.min(128, field.width), ht = Math.min(128, field.height), t = texture(), fb = framebuffer();
      try {
        gl.bindTexture(gl.TEXTURE_2D, t); params();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, ht, 0, gl.RGBA, gl.FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        gl.viewport(0, 0, w, ht); gl.bindVertexArray(vao); gl.useProgram(statsProgram);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, liveAux.blur ? liveAux.blur.target.texture : field.texture);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, liveAux.base ? liveAux.base.target.texture : field.texture);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, field.texture);
        gl.uniform1i(stats.cspField, 0); gl.uniform1i(stats.cspBlur, 1); gl.uniform1i(stats.cspBase, 2);
        gl.uniform1f(stats.cspBlurScale, liveAux.blur ? liveAux.blur.factor : 0); gl.uniform1f(stats.cspBaseScale, liveAux.base ? liveAux.base.factor : 0);
        gl.uniformMatrix3fv(stats.cspAuxTransform, false, IDENTITY);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        var raw = new Float32Array(w * ht * 4), heights = [], relative = [];
        gl.readPixels(0, 0, w, ht, gl.RGBA, gl.FLOAT, raw);
        for (var i = 0; i < raw.length; i += 4) {
          if (!(raw[i + 1] > 0) || !Number.isFinite(raw[i])) continue;
          heights.push(raw[i]);
          if (raw[i + 3] > 0 && Number.isFinite(raw[i + 2])) relative.push(Math.max(0, raw[i] - raw[i + 2]));
        }
        return {heights: Float32Array.from(heights), relative: Float32Array.from(relative), samples: w * ht};
      } finally { deleteTexture(t); deleteFramebuffer(fb); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    }
    function readProvenance(view) {
      if (!ready || !field || destroyed) return Promise.resolve({ranks: {}});
      if (view && !sameView(view)) render(view);
      if (!ready) return Promise.resolve({ranks: {}});
      return new Promise(function (resolve, reject) {
        var t = null, buffer = null, sync = null, timer = null, finished = false;
        var job = {cancel: function (reason) { finish(new Error(reason)); }}; pendingReads.add(job);
        function finish(err, value) {
          if (finished) return; finished = true; if (timer !== null) clearTimeout(timer); pendingReads.delete(job);
          if (!lost) { if (sync) gl.deleteSync(sync); if (buffer) gl.deleteBuffer(buffer); freeTarget(t); }
          resources.syncs.delete(sync); resources.buffers.delete(buffer);
          if (err) reject(err); else resolve(value);
        }
        try {
          var w = Math.min(256, field.width), ht = Math.min(256, field.height); t = target(w, ht, false);
          gl.viewport(0, 0, w, ht); gl.bindVertexArray(vao); gl.useProgram(provenanceProgram);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, field.texture); gl.uniform1i(provenanceField, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          buffer = gl.createBuffer(); resources.buffers.add(buffer); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
          gl.bufferData(gl.PIXEL_PACK_BUFFER, w * ht * 4, gl.STREAM_READ); gl.readPixels(0, 0, w, ht, gl.RGBA, gl.UNSIGNED_BYTE, 0);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); resources.syncs.add(sync); gl.flush();
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          var started = now();
          function poll() {
            if (finished) return;
            if (!ready || destroyed || lost) { finish(new Error('Terrain readback cancelled')); return; }
            var status = gl.clientWaitSync(sync, 0, 0);
            if (status === gl.WAIT_FAILED) { finish(new Error('Terrain fence wait failed')); return; }
            if (status === gl.TIMEOUT_EXPIRED) {
              if (now() - started > 5000) finish(new Error('Terrain fence timeout'));
              else timer = setTimeout(poll, 4);
              return;
            }
            var bytes = new Uint8Array(w * ht * 4), ranks = {};
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            for (var i = 0; i < bytes.length; i += 4) { var r = bytes[i]; if (r) ranks[r] = (ranks[r] || 0) + 1; }
            var valid = 0; Object.keys(ranks).forEach(function (rank) { valid += ranks[rank]; });
            finish(null, {ranks: ranks, samples: w * ht, width: w, height: ht, coverage: valid / (w * ht)});
          }
          timer = setTimeout(poll, 0);
        } catch (e) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); finish(e); }
      });
    }
    function destroy() {
      if (destroyed) return; destroyed = true; ready = false; cancelReads('Terrain engine destroyed');
      Array.from(snapshots).forEach(function (snapshot) { snapshot.release(); }); exportCache = null;
      if (store && store.off) store.off('tile', onTile);
      if (canvas && canvas.removeEventListener) { canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored); }
      lru.clear(); cleanResources(); queue.clear(); known.clear(); sources.clear(); plan.length = 0; wanted.length = 0;
    }
    try {
      if (!canvas || !store || !shaders || !canvas.getContext) return null;
      gl = canvas.getContext('webgl2', {alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false});
      if (!gl) return null;
      init(); refreshSources(); store.on('tile', onTile);
      canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);
    } catch (e) { error = String(e && e.message || e); destroy(); if (options.onError) { try { options.onError(e); } catch (_) {} } return null; }
    function invalidate() {
      if (snapshots.size) { deferredInvalidate = true; return; }
      lru.entries.forEach(function (entry, key) { if (entry.obsolete || !store.get(key)) lru.delete(key); });
      coverageKey = ''; heightDirty = dirty = planDirty = true; needsFrame();
    }
    return {
      get ready() { return ready; },
      setState: function (next) { state = next || {}; dirty = true; if (refreshSources()) heightDirty = planDirty = true; needsFrame(); },
      invalidate: invalidate, render: render, createSnapshot: createSnapshot,
      releaseGestureTargets: function () { if (!lost) releaseGesture(); },
      releaseExport: releaseExport, exportDetail: exportDetail, neededTiles: function (view) { if (refreshSources()) heightDirty = dirty = planDirty = true; return want(view); }, renderToCanvas: renderToCanvas, readProvenance: readProvenance, sampleValues: sampleValues,
      stats: function () { return {textures: lru.size, textureBytes: lru.bytes, frames: frames, drawCalls: drawCalls, lastFrameMs: lastFrameMs,
        ready: ready, queuedUploads: queue.size,
        exportTextures: Array.from(snapshots).reduce(function (n, capture) { return n + capture.tiles.size; }, 0),
        exportTextureBytes: Array.from(snapshots).reduce(function (n, capture) { return n + capture.bytes; }, 0), uploads: uploads, evictions: evictions, generation: generation, error: error,
        heightFieldBytes: field ? field.width * field.height * 8 : 0, gestureBytes: gestureBytes(), gesturePeakBytes: gesturePeakBytes, trackedTiles: known.size, phaseMs: Object.assign({}, phaseMs), planEntries: plan.length,
        coverageKind: 'resident tile overlap estimate; readProvenance returns sampled pixel coverage', fallback: 'CPU when float targets or self-test unavailable'}; },
      // Diagnostics are deliberately synchronous and are never called by render().
      debugReadHeight: function () { if (!field || !ready) throw new Error('No height field'); return readFloat(field); },
      debugLimits: function (limits) { forcedMaxSize = limits.maxTargetSize || 0; },
      // Diagnostic: wait for the GPU after each pass so phaseMs.height/aux/shade
      // hold pass times. Serializes the pipeline; never used by the app.
      debugGpuTiming: function (on) { gpuTiming = !!on; if (on) gpuTotals = {height: 0, aux: 0, shade: 0, frames: 0}; return Object.assign({}, gpuTotals); }, destroy: destroy
    };
  }
  return Object.freeze({VERSION: '1', create: create, _test: Object.freeze({tileLevel: tileLevel, coverageTiles: coverageTiles,
    cropFor: cropFor, TextureLRU: TextureLRU, drainUploads: drainUploads, auxPlan: auxPlan, auxRadii: auxRadii, snapshotAuxTransform: snapshotAuxTransform, gestureView: gestureView})});
}));
