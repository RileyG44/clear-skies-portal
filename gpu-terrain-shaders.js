/*
 * Clear Skies GPU 2D terrain: GLSL for the shade + composite pass.
 * Contract: docs/GPU_2D_TERRAIN_SPEC.md section 4.1. Skeleton - Workstream S.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.CSPGpuTerrainShaders = factory();
}(typeof globalThis !== "undefined" ? globalThis :
  (typeof self !== "undefined" ? self : this), function () {
  "use strict";

  var STYLE_IDS = Object.freeze({hs: 0, hsmulti: 1, slope: 2, aspect: 3, northness: 4, tint: 5, c2: 6, c5: 7, c10: 8, c25: 9});

  /* Full-screen triangle; v_screenUv is (0,0) at the top-left of the canvas. */
  var fullscreenVertexSource = "#version 300 es\n" +
    "out vec2 v_screenUv;\n" +
    "void main(){\n" +
    "  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));\n" +
    "  v_screenUv=vec2(p.x,1.0-p.y);\n" +
    "  gl_Position=vec4(p*2.0-1.0,0.0,1.0);\n" +
    "}\n";

  /* Every uniform shadeFragmentSource declares. */
  var SHADE_UNIFORMS = Object.freeze([]);

  /*
   * prelude: GLSL from the engine defining
   *   float csp_height(ivec2 p); int csp_rank(ivec2 p); bool csp_valid(ivec2 p); ivec2 csp_size();
   */
  function shadeFragmentSource(prelude) {
    throw new Error("CSPGpuTerrainShaders.shadeFragmentSource is not implemented yet");
  }

  /* state and view: spec section 4.1. Returns {uniformName: number|number[]}. */
  function uniformValues(state, view) {
    throw new Error("CSPGpuTerrainShaders.uniformValues is not implemented yet");
  }

  return Object.freeze({
    VERSION: "0",
    STYLE_IDS: STYLE_IDS,
    fullscreenVertexSource: fullscreenVertexSource,
    SHADE_UNIFORMS: SHADE_UNIFORMS,
    shadeFragmentSource: shadeFragmentSource,
    uniformValues: uniformValues
  });
}));
