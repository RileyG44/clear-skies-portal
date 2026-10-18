/*
 * Clear Skies GPU 2D terrain: shared store of decoded native elevation tiles.
 * One store feeds both the terrain style and the elevation spectrum.
 * Contract: docs/GPU_2D_TERRAIN_SPEC.md section 4.2. Skeleton - Workstream D.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.CSPGpuTerrainStore = factory();
}(typeof globalThis !== "undefined" ? globalThis :
  (typeof self !== "undefined" ? self : this), function () {
  "use strict";

  function notYet(name) { throw new Error("ElevationTileStore." + name + " is not implemented yet"); }

  function tileKey(sourceId, z, x, y) { return sourceId + "/" + z + "/" + x + "/" + y; }

  /*
   * options: {sources: () => SourceSpec[], request(url, {signal, priority, group, kind}),
   *           mask(grid, width, height, nativeCoords, source), maxBytes}
   */
  function ElevationTileStore(options) {
    this.options = options || {};
    this._listeners = {tile: []};
  }
  ElevationTileStore.prototype.on = function (event, fn) { (this._listeners[event] || (this._listeners[event] = [])).push(fn); return this; };
  ElevationTileStore.prototype.off = function (event, fn) {
    var list = this._listeners[event] || [];
    var index = list.indexOf(fn); if (index >= 0) list.splice(index, 1);
    return this;
  };
  ElevationTileStore.prototype.want = function (displayTiles, options) { notYet("want"); };
  ElevationTileStore.prototype.get = function (key) { notYet("get"); };
  ElevationTileStore.prototype.finestFor = function (sourceId, displayCoords) { notYet("finestFor"); };
  ElevationTileStore.prototype.sampleAt = function (lng, lat) { notYet("sampleAt"); };
  ElevationTileStore.prototype.gridForView = function (request) { notYet("gridForView"); };
  ElevationTileStore.prototype.settled = function (displayTiles) { notYet("settled"); };
  ElevationTileStore.prototype.provenance = function (displayTiles) { notYet("provenance"); };
  ElevationTileStore.prototype.clear = function () { notYet("clear"); };
  ElevationTileStore.prototype.destroy = function () { notYet("destroy"); };

  return Object.freeze({
    VERSION: "0",
    tileKey: tileKey,
    ElevationTileStore: ElevationTileStore
  });
}));
