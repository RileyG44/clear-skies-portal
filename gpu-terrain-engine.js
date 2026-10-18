/*
 * Clear Skies GPU 2D terrain: WebGL2 engine. Resident elevation textures,
 * pass 1 height field, pass 2 shade + composite, export and provenance.
 * Contract: docs/GPU_2D_TERRAIN_SPEC.md section 4.3. Skeleton - Workstream E.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.CSPGpuTerrainEngine = factory();
}(typeof globalThis !== "undefined" ? globalThis :
  (typeof self !== "undefined" ? self : this), function () {
  "use strict";

  /*
   * options: {canvas, store, shaders, maxTextureBytes, onNeedsFrame}
   * Returns an engine, or null when WebGL2 / EXT_color_buffer_float / the
   * start-up self-test is unavailable (the app then uses the old path).
   *
   * engine.setState(state); engine.render(view) -> {coverage, missing};
   * engine.neededTiles(view) -> [{z,x,y}]; engine.renderToCanvas(view, w, h) -> Promise<canvas>;
   * engine.readProvenance(view) -> Promise<{ranks}>; engine.stats(); engine.destroy()
   */
  function create(options) {
    return null;
  }

  return Object.freeze({
    VERSION: "0",
    create: create
  });
}));
