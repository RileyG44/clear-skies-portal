/*
 * Clear Skies GPU 2D terrain: Leaflet layer owning the engine's canvas.
 * The only GPU-terrain object index.html talks to.
 * Contract: docs/GPU_2D_TERRAIN_SPEC.md section 4.4. Skeleton - Workstream L.
 * Loaded after Leaflet; defines L.CSPGpuTerrainLayer and L.cspGpuTerrainLayer
 * only when L is present, so it is inert in Node.
 */
(function (root) {
  "use strict";
  var L = root && root.L;
  if (!L || !L.Layer) return;

  L.CSPGpuTerrainLayer = L.Layer.extend({
    options: {zIndex: 440, pane: "tilePane"},
    /* options: {store, state, zIndex} */
    initialize: function (options) { L.setOptions(this, options); },
    onAdd: function (map) { throw new Error("L.CSPGpuTerrainLayer is not implemented yet"); },
    onRemove: function (map) {},
    setState: function (state) {},
    getEngine: function () { return null; },
    getStore: function () { return this.options.store || null; },
    sampleAt: function (latlng) { return null; },
    gridForView: function () { return null; },
    settled: function () { return {complete: 0, total: 0, ratio: 0, refining: false}; },
    provenance: function () { return null; },
    snapshotEntry: function (spec) { return null; }
  });
  L.cspGpuTerrainLayer = function (options) { return new L.CSPGpuTerrainLayer(options); };
}(typeof globalThis !== "undefined" ? globalThis :
  (typeof self !== "undefined" ? self : this)));
