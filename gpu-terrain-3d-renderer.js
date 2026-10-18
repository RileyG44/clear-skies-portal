/* Resident 3D drape shading in MapLibre's WebGL2 context. The caller owns
 * output RGBA8 textures and dirty scheduling. Only startup reads GPU pixels.
 * No canvas, bitmap, float render target, or animation loop is involved. */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./gpu-terrain-shaders.js"));
  else root.CSPGpuTerrain3DRenderer = factory(root.CSPGpuTerrainShaders);
}(typeof globalThis !== "undefined" ? globalThis : this, function (defaultShaders) {
  "use strict";
  const MiB = 1024 * 1024;
  // North is GL row zero, matching MapLibre image uploads with no Y flip.
  const vertex = "#version 300 es\nout vec2 v_screenUv;\nvoid main(){\n" +
    "vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));\n" +
    "v_screenUv=vec2(p.x,p.y);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}";
  const prelude = [
    "precision highp int;",
    "uniform highp sampler2D u_height;",
    "uniform int u_size;",
    "ivec2 csp_size(){return ivec2(u_size);}",
    "float csp_height(ivec2 p){return texelFetch(u_height,p+ivec2(1),0).r;}",
    "bool csp_valid(ivec2 p){",
    " if(any(lessThan(p,ivec2(-1)))||any(greaterThan(p,ivec2(u_size))))return false;",
    " float h=csp_height(p);return !isnan(h)&&!isinf(h)&&h > -20000.0;}",
    "int csp_rank(ivec2 p){return csp_valid(p)?1:0;}"
  ].join("\n");

  function snapshot(gl) {
    const s = {};
    for (const name of ["DRAW_FRAMEBUFFER_BINDING", "READ_FRAMEBUFFER_BINDING", "VIEWPORT",
      "CURRENT_PROGRAM", "VERTEX_ARRAY_BINDING", "ACTIVE_TEXTURE", "COLOR_WRITEMASK",
      "PIXEL_UNPACK_BUFFER_BINDING", "PIXEL_PACK_BUFFER_BINDING",
      "UNPACK_ALIGNMENT", "UNPACK_FLIP_Y_WEBGL", "UNPACK_PREMULTIPLY_ALPHA_WEBGL",
      "UNPACK_ROW_LENGTH", "UNPACK_SKIP_PIXELS", "UNPACK_SKIP_ROWS", "UNPACK_IMAGE_HEIGHT", "UNPACK_SKIP_IMAGES",
      "PACK_ALIGNMENT", "PACK_ROW_LENGTH", "PACK_SKIP_PIXELS", "PACK_SKIP_ROWS"])
      s[name] = gl.getParameter(gl[name]);
    s.enables = ["BLEND", "DEPTH_TEST", "STENCIL_TEST", "SCISSOR_TEST", "CULL_FACE",
      "RASTERIZER_DISCARD", "DITHER", "SAMPLE_ALPHA_TO_COVERAGE", "SAMPLE_COVERAGE"]
      .map(name => [gl[name], gl.isEnabled(gl[name])]);
    gl.activeTexture(gl.TEXTURE0);
    s.texture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    s.sampler = gl.getParameter(gl.SAMPLER_BINDING);
    gl.activeTexture(s.ACTIVE_TEXTURE);
    return s;
  }
  function restore(gl, s) {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.DRAW_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.READ_FRAMEBUFFER_BINDING);
    gl.viewport(...s.VIEWPORT);
    gl.useProgram(s.CURRENT_PROGRAM);
    gl.bindVertexArray(s.VERTEX_ARRAY_BINDING);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.texture);
    gl.bindSampler(0, s.sampler);
    gl.activeTexture(s.ACTIVE_TEXTURE);
    gl.colorMask(...s.COLOR_WRITEMASK);
    s.enables.forEach(([cap, on]) => on ? gl.enable(cap) : gl.disable(cap));
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, s.PIXEL_UNPACK_BUFFER_BINDING);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.PIXEL_PACK_BUFFER_BINDING);
    for (const name of ["UNPACK_ALIGNMENT", "UNPACK_FLIP_Y_WEBGL", "UNPACK_PREMULTIPLY_ALPHA_WEBGL",
      "UNPACK_ROW_LENGTH", "UNPACK_SKIP_PIXELS", "UNPACK_SKIP_ROWS", "UNPACK_IMAGE_HEIGHT", "UNPACK_SKIP_IMAGES",
      "PACK_ALIGNMENT", "PACK_ROW_LENGTH", "PACK_SKIP_PIXELS", "PACK_SKIP_ROWS"])
      gl.pixelStorei(gl[name], s[name]);
    // Blend functions/equations, scissor rectangle and depth/stencil settings
    // are never modified; only the associated enables need restoring.
  }
  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("3D terrain shader allocation failed");
    try {
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) || "3D terrain shader compilation failed");
      return shader;
    } catch (error) { gl.deleteShader(shader); throw error; }
  }

  function create(options) {
    const gl = options && options.gl, shaders = options && options.shaders || defaultShaders;
    const maxBytes = options && options.maxBytes !== undefined ? options.maxBytes : 64 * MiB;
    if (!gl || !shaders || !Number.isFinite(maxBytes) || maxBytes < 4 ||
      typeof gl.texStorage2D !== "function" || typeof gl.bindVertexArray !== "function" || gl.isContextLost()) return null;
    const cache = new Map(), owned = new Set(), targets = new WeakMap(), uniforms = new Map();
    const counters = { inputTextures: 0, inputBytes: 0, uploads: 0, draws: 0, evictions: 0, batches: 0,
      cacheHits: 0, uniformUpdates: 0 };
    let program = null, fbo = null, vao = null, dead = false, selfTestError = null;
    let maxSize, sizeLocation, heightLocation, locations;
    function remove(key) {
      const entry = cache.get(key);
      if (!entry) return false;
      cache.delete(key); owned.delete(entry.texture); gl.deleteTexture(entry.texture);
      counters.inputBytes -= entry.bytes; counters.inputTextures = cache.size;
      return true;
    }
    function clear() { for (const key of cache.keys()) remove(key); }
    function destroy() {
      if (dead) return;
      dead = true; clear();
      if (fbo) gl.deleteFramebuffer(fbo);
      if (vao) gl.deleteVertexArray(vao);
      if (program) gl.deleteProgram(program);
      fbo = vao = program = null; uniforms.clear();
    }
    function uniform(name, value, integer) {
      const old = uniforms.get(name);
      if (Array.isArray(value) ? Array.isArray(old) && value.every((v, i) => Object.is(v, old[i])) : Object.is(old, value)) return;
      const location = name === "u_size" ? sizeLocation : name === "u_height" ? heightLocation : locations[name];
      if (location !== null && location !== undefined) {
        if (Array.isArray(value)) {
          if (value.length === 2) gl.uniform2f(location, ...value);
          else gl.uniform3f(location, ...value);
        } else if (integer) gl.uniform1i(location, value);
        else gl.uniform1f(location, value);
        counters.uniformUpdates++;
      }
      uniforms.set(name, Array.isArray(value) ? value.slice() : value);
    }
    function input(job) {
      let entry = cache.get(job.key);
      if (entry && entry.size !== job.size) { remove(job.key); entry = null; }
      if (entry && Object.is(entry.revision, job.revision) && entry.grid === job.grid) {
        cache.delete(job.key); cache.set(job.key, entry); counters.cacheHits++;
        return entry;
      }
      if (!entry) {
        const bytes = job.grid.byteLength;
        while (counters.inputBytes + bytes > maxBytes) {
          remove(cache.keys().next().value); counters.evictions++;
        }
        const texture = gl.createTexture();
        if (!texture) throw new Error("3D terrain height allocation failed");
        try {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, job.size + 2, job.size + 2);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } catch (error) { gl.deleteTexture(texture); throw error; }
        entry = {texture, size: job.size, bytes, grid: null, revision: null};
        cache.set(job.key, entry); owned.add(texture);
        counters.inputBytes += bytes; counters.inputTextures = cache.size;
      }
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, job.size + 2, job.size + 2, gl.RED, gl.FLOAT, job.grid);
      entry.grid = job.grid; entry.revision = job.revision;
      cache.delete(job.key); cache.set(job.key, entry); counters.uploads++;
      return entry;
    }
    function renderBatch(jobs) {
      const result = {drawn: 0, uploaded: 0, evicted: 0};
      if (dead || gl.isContextLost()) return result;
      if (!Array.isArray(jobs)) throw new TypeError("3D terrain jobs must be an array");
      if (!jobs.length) return result;
      // Validate before making any GL changes. Repeated keys can legitimately
      // address different outputs, so preserve their order rather than drop jobs.
      for (const job of jobs) {
        if (!job || typeof job.key !== "string" || !Number.isInteger(job.size) || job.size < 1 || job.size + 2 > maxSize ||
          !(job.grid instanceof Float32Array) || job.grid.length !== (job.size + 2) ** 2 ||
          !Number.isFinite(job.groundRes) || job.groundRes <= 0 || !job.targetTexture || owned.has(job.targetTexture))
          throw new TypeError("Invalid 3D terrain job or input/output feedback");
        if (job.grid.byteLength > maxBytes) throw new RangeError("3D terrain input exceeds GPU byte budget");
      }
      const saved = snapshot(gl), beforeUploads = counters.uploads, beforeEvictions = counters.evictions;
      counters.batches++;
      try {
        gl.activeTexture(gl.TEXTURE0); gl.bindSampler(0, null);
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        for (const name of ["UNPACK_FLIP_Y_WEBGL", "UNPACK_PREMULTIPLY_ALPHA_WEBGL", "UNPACK_ROW_LENGTH",
          "UNPACK_SKIP_PIXELS", "UNPACK_SKIP_ROWS", "UNPACK_IMAGE_HEIGHT", "UNPACK_SKIP_IMAGES"])
          gl.pixelStorei(gl[name], 0);
        saved.enables.forEach(([cap]) => gl.disable(cap));
        gl.colorMask(true, true, true, true); gl.useProgram(program); gl.bindVertexArray(vao);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
        uniform("u_height", 0, true);
        for (const job of jobs) {
          const entry = input(job);
          gl.bindTexture(gl.TEXTURE_2D, entry.texture);
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, job.targetTexture, 0);
          const checked = targets.get(job.targetTexture);
          if (!checked || checked.size !== job.size || !Object.is(checked.revision, job.targetRevision)) {
            if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
              throw new Error("3D terrain output framebuffer incomplete");
            targets.set(job.targetTexture, {size: job.size, revision: job.targetRevision});
          }
          gl.viewport(0, 0, job.size, job.size);
          uniform("u_size", job.size, true);
          const values = shaders.uniformValues(Object.assign({}, job.state, {groundResOverride: job.groundRes}),
            {bearing: 0, zoom: 0, centerMerc: [0.5, 0.5], cssSize: [job.size, job.size], dpr: 1});
          for (const name of shaders.SHADE_UNIFORMS) uniform(name, values[name], name === "u_style");
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          counters.draws++; result.drawn++;
          // Detach before mip generation, and never leave an external target
          // attached to our FBO or sampled by the next draw.
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
          gl.bindTexture(gl.TEXTURE_2D, job.targetTexture); gl.generateMipmap(gl.TEXTURE_2D);
        }
        result.uploaded = counters.uploads - beforeUploads;
        result.evicted = counters.evictions - beforeEvictions;
        return result;
      } finally {
        try {
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        } finally { restore(gl, saved); }
      }
    }
    // Tiny CPU reference: the Horn/direct hillshade and spectrum source-over
    // equations from terrain-raster.js / terrain-drape-core.js. Deliberately
    // independent of GLSL, with an asymmetric curved surface and skirt edges.
    function selfTest() {
      const size = 4, n = size + 2, grid = new Float32Array(n * n), groundRes = 7;
      for (let y = -1; y <= size; y++) for (let x = -1; x <= size; x++)
        grid[(y + 1) * n + x + 1] = 420 + 2 * x * x + 5 * y * y + 3 * x * y + x;
      grid[2 * n + 2] = -20000; grid[3 * n + 3] = NaN; grid[4 * n + 1] = Infinity;
      const target = gl.createTexture();
      if (!target) throw new Error("3D terrain self-test allocation failed");
      try {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target);
        gl.texStorage2D(gl.TEXTURE_2D, 3, gl.RGBA8, size, size);
        const state = {terrain: {style: "hs", opacity: 0.73},
          spectrum: {spectrumOn: true, level: 440, span: 90, spectrumAlpha: 0.45}, spectrumOpacity: 0.8};
        renderBatch([{key: "__startup__", revision: 1, grid, size, targetTexture: target, state, groundRes}]);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
        for (const name of ["PACK_ROW_LENGTH", "PACK_SKIP_PIXELS", "PACK_SKIP_ROWS"]) gl.pixelStorei(gl[name], 0);
        const pixels = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let error = 0;
        const valid = h => Number.isFinite(h) && h > -20000;
        const h = (x, y) => grid[(y + 1) * n + x + 1];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const value = h(x, y), expected = [0, 0, 0, 0];
          if (valid(value)) {
            const d = (value - 440) / 90, t = Math.min(1, Math.abs(d)), smooth = t * t * (3 - 2 * t);
            const alpha = 0.45 * (0.15 + 0.85 * t) * 0.8, targetRGB = d >= 0 ? [70, 160, 255] : [248, 92, 108];
            let shade = 0;
            if ([-1, 0, 1].every(dy => [-1, 0, 1].every(dx => valid(h(x + dx, y + dy))))) {
              const res = groundRes / (1 + 0.024 * Math.pow(groundRes, 0.664));
              const dx = (h(x+1,y-1)+2*h(x+1,y)+h(x+1,y+1)-h(x-1,y-1)-2*h(x-1,y)-h(x-1,y+1))/(8*res);
              const dy = (h(x-1,y+1)+2*h(x,y+1)+h(x+1,y+1)-h(x-1,y-1)-2*h(x,y-1)-h(x+1,y-1))/(8*res);
              const az = 315 * Math.PI / 180, alt = Math.PI / 4;
              const direct = Math.max(0, Math.min(1, (-dx*Math.cos(alt)*Math.sin(az)+dy*Math.cos(alt)*Math.cos(az)+Math.sin(alt))/Math.hypot(dx,dy,1)));
              shade = 0.12 + 0.88 * direct;
              expected[3] = 0.73;
            }
            for (let c = 0; c < 3; c++) expected[c] = (([255,255,250][c] + (targetRGB[c]-[255,255,250][c])*smooth)/255)*alpha + shade*expected[3]*(1-alpha);
            expected[3] = alpha + expected[3] * (1 - alpha);
          }
          for (let c = 0; c < 4; c++) error = Math.max(error, Math.abs(pixels[(y*size+x)*4+c] - Math.round(expected[c]*255)));
        }
        if (error > 2) throw new Error("3D terrain startup CPU parity failed: " + error);
        return error;
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.deleteTexture(target); clear();
      }
    }
    let saved;
    try {
      saved = snapshot(gl); maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      let vs, fs;
      try {
        vs = compile(gl, gl.VERTEX_SHADER, vertex);
        fs = compile(gl, gl.FRAGMENT_SHADER, shaders.shadeFragmentSource(prelude));
        program = gl.createProgram();
        if (!program) throw new Error("3D terrain program allocation failed");
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      } finally { if (vs) gl.deleteShader(vs); if (fs) gl.deleteShader(fs); }
      fbo = gl.createFramebuffer(); vao = gl.createVertexArray();
      if (!fbo || !vao) throw new Error("3D terrain pipeline allocation failed");
      locations = {};
      for (const name of shaders.SHADE_UNIFORMS) locations[name] = gl.getUniformLocation(program, name);
      sizeLocation = gl.getUniformLocation(program, "u_size"); heightLocation = gl.getUniformLocation(program, "u_height");
      selfTestError = selfTest();
      for (const key of Object.keys(counters)) counters[key] = 0;
      uniforms.clear();
    } catch (_) { destroy(); return null; }
    finally { if (saved) restore(gl, saved); }
    return Object.freeze({renderBatch, remove, clear, destroy,
      stats: () => Object.assign({}, counters, {maxBytes, selfTestMaxError: selfTestError})});
  }
  return Object.freeze({create});
}));
