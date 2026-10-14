/* Belt-scale DEM observations; terrain texture alone does not establish origin. */
(function (root, factory) {
  "use strict";
  var api = typeof module === "object" && module.exports
    ? factory(require("./glacial-segment-features.js"))
    : factory(root && root.CSPGlacialSegmentFeatures);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CSPGlacialZoneFeatures = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (F) {
  "use strict";

  /* Physical defaults are screening choices, not fitted probabilities. A 30 m
     neighbourhood resolves the design's 10-40 m hummocks without deriving the
     scale from zone size or per-view percentiles. Square cells and elevations
     in metres follow the segment module's assumptions. */
  var DEFAULT_OPTIONS = Object.freeze({
    radiusM: 30,
    hummockDensityKneePerKm2: 100,
    kettleDensityKneePerKm2: 20
  });
  /* Approximation contract: neighbourhoods are square, shrink at view edges,
     and exclude an inner square of floor(radius / 3) for TPI. Hummocks keep
     connected peaks together and may be truncated at edges/no-data. Kettles
     inherit the conservative local exterior spill-rim proxy, not watershed
     filling. Blob centroids weight cell centres equally; nearest-cell zone
     inclusion approximates the union of cell squares without overlap/dilation.
     Raised fraction includes missing-TPI cells in its denominator; remaining
     statistics use their own finite samples and return zero when unavailable.
     Relief uses linear-interpolated percentiles. Texture equally averages two
     fixed, heuristic density ramps d/(d+knee), never view-normalized values. */
  var METADATA = Object.freeze({
    algorithm: "glacial-zone-features-v1",
    approximations: Object.freeze({
      neighbourhoods: "Fixed physical radius (default 30 m), rounded up to cells, floored to one cell and capped to the view; shared square-box LRM and annular TPI exclude inner radius floor(outer / 3). Shrinking windows and no-data handling follow segment features.",
      hummocks: "Seed TPI > 0.5 m, grow 8-connected through finite TPI > 0, and count whole-view blobs of 100-20000 m2 inclusive. Connected peaks remain one blob; edge/no-data truncation is not reconstructed or rejected. Area and centroid use equal-weight cell centres.",
      kettles: "Reuse the segment context's whole-view kettle blobs: TPI < -0.5 m seeds grown to zero, area <5000 m2 and local spill-rim depth >0.5 m; view-edge/no-data blobs are rejected. This is a conservative exterior-rim proxy, not watershed filling.",
      membership: "Round each whole-blob centroid to the nearest raster cell and test exact closed-zone membership; this approximates inclusion by the union of cell squares. No bbox inclusion, overlap clipping, or segment-style dilation.",
      statistics: "Deduplicate zonePixels (closed footprint, not original candidate pixels). Raised fraction uses all zone cells, so missing TPI supplies no raised evidence. Other statistics use finite samples of their own raster; absent stage scores or samples return zero. Relief is linearly interpolated p95-p05.",
      texture: "Average d/(d+knee) for hummock and kettle densities, with default knees 100 and 20 blobs/km2 respectively. These physically fixed heuristic knees are configurable and use no per-view normalization."
    })
  });

  /* Cache labels by the shared layer object: one whole-view flood fill for all
     zones using that scale. Recreate context after any DEM/layer mutation. */
  var hummocksByLayer = new WeakMap();

  function positiveOption(opts, key) {
    var value = opts[key] === undefined ? DEFAULT_OPTIONS[key] : Number(opts[key]);
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError(key + " must be positive and finite");
    return value;
  }

  function quantile(sorted, fraction) {
    if (!sorted.length) return 0;
    var position = (sorted.length - 1) * fraction, lower = Math.floor(position);
    var weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[Math.ceil(position)] * weight;
  }

  function hummockBlobs(grid, w, h, layers, cell) {
    if (hummocksByLayer.has(layers)) return hummocksByLayer.get(layers);
    var tpi = layers.tpi, visited = new Uint8Array(w * h);
    var queue = new Uint32Array(w * h), blobs = [], cellArea = cell * cell;
    for (var seed = 0; seed < w * h; seed++) {
      /* Tiny positive residuals cannot initiate a component. Growth retains
         the shallow rim, matching the fixed kettle seed/grow convention. */
      if (visited[seed] || !Number.isFinite(tpi[seed]) || !(tpi[seed] > 0.5) ||
          !Number.isFinite(Number(grid[seed]))) continue;
      var head = 0, tail = 1, sumX = 0, sumY = 0;
      queue[0] = seed; visited[seed] = 1;
      while (head < tail) {
        var index = queue[head++], x = index % w, y = Math.floor(index / w);
        sumX += x; sumY += y;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var nx = x + dx, ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var next = ny * w + nx;
          if (visited[next] || !Number.isFinite(tpi[next]) || !(tpi[next] > 0) ||
              !Number.isFinite(Number(grid[next]))) continue;
          visited[next] = 1; queue[tail++] = next;
        }
      }
      var area = tail * cellArea;
      if (area >= 100 && area <= 20000)
        blobs.push({ x: sumX / tail, y: sumY / tail });
    }
    hummocksByLayer.set(layers, blobs);
    return blobs;
  }

  function countInside(blobs, pixels, w, h) {
    var count = 0;
    for (var i = 0; i < blobs.length; i++) {
      var x = Math.round(blobs[i].x), y = Math.round(blobs[i].y);
      if (x >= 0 && x < w && y >= 0 && y < h && pixels.has(y * w + x)) count++;
    }
    return count;
  }

  function zoneFeatures(grid, w, h, zone, opts) {
    opts = opts || {};
    if (!F || typeof F.createViewContext !== "function" || typeof F.segmentFeatures !== "function")
      throw new Error("CSPGlacialSegmentFeatures is not loaded");
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
        !grid || grid.length !== w * h)
      throw new RangeError("grid length must equal positive integer width times height");
    var context = opts.context;
    var cell = Number(opts.cellMetres === undefined ? (context ? context.cellMetres : 1) : opts.cellMetres);
    if (!Number.isFinite(cell) || cell <= 0) throw new RangeError("cellMetres must be positive and finite");
    if (context && (context.grid !== grid || context.w !== w || context.h !== h ||
        context.cellMetres !== cell || !context.layersByRadius))
      throw new RangeError("context must match grid, dimensions, and cellMetres");
    if (!zone || (!Array.isArray(zone.zonePixels) &&
        !(ArrayBuffer.isView(zone.zonePixels) && typeof zone.zonePixels.length === "number")))
      throw new TypeError("zone.zonePixels must be an array or typed array of raster indices");
    var pixels = new Set();
    for (var p = 0; p < zone.zonePixels.length; p++) {
      var pixel = zone.zonePixels[p];
      if (!Number.isInteger(pixel) || pixel < 0 || pixel >= w * h)
        throw new RangeError("zone pixel index is outside the grid");
      pixels.add(pixel);
    }
    /* The producer supplies areaM2 from the closed footprint. For hand-made
       zones without it, derive area from distinct closed cells, never pixels
       of the original candidate mask or its pixelCount. */
    var area = zone.areaM2 === undefined ? pixels.size * cell * cell : Number(zone.areaM2);
    if (!Number.isFinite(area) || area < 0 || (pixels.size && area === 0))
      throw new RangeError("zone areaM2 must be finite and positive for a nonempty zone");
    var radiusM = positiveOption(opts, "radiusM");
    var hummockKnee = positiveOption(opts, "hummockDensityKneePerKm2");
    var kettleKnee = positiveOption(opts, "kettleDensityKneePerKm2");
    /* opts.stageScore is the stage-1 score raster. stage1Score is an alias
       for callers naming the stage explicitly. Missing/nonfinite scores give
       zero evidence; scores are averaged as supplied, without normalization. */
    var stageScore = opts.stageScore === undefined ? opts.stage1Score : opts.stageScore;
    if (stageScore != null && stageScore.length !== w * h)
      throw new RangeError("stageScore length must match the grid");
    if (!context) context = F.createViewContext(grid, w, h, { cellMetres: cell, meanWidthM: radiusM });
    var radius = Math.min(Math.max(w, h), Math.max(1, Math.ceil(Math.max(cell, radiusM) / cell)));
    if (!context.layersByRadius[radius]) {
      /* The context has no public layer getter. An empty segment primes the
         exact radius through its public API, reusing slope/valley and its
         original kettle detector; no synthetic segment feature is retained.
         Empty pixels/path and zero length skip profiles, kettles and aprons.
         The resulting cache entry is shared with subsequent ridge/zone calls. */
      F.segmentFeatures(grid, w, h, { pixels: [], skeleton: [], bbox: [0, 0, w - 1, h - 1],
        centroid: [0, 0], meanWidthM: radiusM, lengthM: 0 }, { context: context, cellMetres: cell });
    }
    var layers = context.layersByRadius[radius];
    if (!layers || !layers.tpi || layers.tpi.length !== w * h ||
        !layers.lrm || layers.lrm.length !== w * h || !Array.isArray(layers.kettleBlobs))
      throw new TypeError("context layers need TPI, LRM, and kettle blobs");
    var elevations = [], raised = 0, roughnessSum = 0, roughnessCount = 0;
    var scoreSum = 0, scoreCount = 0;
    pixels.forEach(function (index) {
      var z = Number(grid[index]);
      if (Number.isFinite(z)) elevations.push(z);
      if (Number.isFinite(layers.tpi[index]) && layers.tpi[index] > 0) raised++;
      if (Number.isFinite(layers.lrm[index])) {
        roughnessSum += Math.abs(layers.lrm[index]); roughnessCount++;
      }
      if (stageScore != null && Number.isFinite(stageScore[index])) {
        scoreSum += stageScore[index]; scoreCount++;
      }
    });
    elevations.sort(function (a, b) { return a - b; });
    var hummockCount = pixels.size ? countInside(hummockBlobs(grid, w, h, layers, cell), pixels, w, h) : 0;
    var kettleCount = pixels.size ? countInside(layers.kettleBlobs, pixels, w, h) : 0;
    var hummockDensity = area > 0 ? hummockCount * 1000000 / area : 0;
    var kettleDensity = area > 0 ? kettleCount * 1000000 / area : 0;
    /* ridgeSupport is supplied/attached by the analysis; it is deliberately
       absent from this module's seven-field feature result. */
    return {
      hummockDensityPerKm2: hummockDensity,
      kettleDensityPerKm2: kettleDensity,
      raisedFraction: pixels.size ? raised / pixels.size : 0,
      meanStageScore: scoreCount ? scoreSum / scoreCount : 0,
      roughness: roughnessCount ? roughnessSum / roughnessCount : 0,
      reliefM: quantile(elevations, 0.95) - quantile(elevations, 0.05),
      textureScore: (hummockDensity / (hummockDensity + hummockKnee) +
        kettleDensity / (kettleDensity + kettleKnee)) / 2
    };
  }

  return Object.freeze({ VERSION: 1, DEFAULT_OPTIONS: DEFAULT_OPTIONS, METADATA: METADATA,
    zoneFeatures: zoneFeatures });
}));
