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
     and exclude an inner square of floor(radius / 3) for TPI. Hummocks are
     elevation peaks with a physical separation floor, not watershed objects.
     Kettles use the view's drainage-connected priority-flood fill depths.
     Nearest-cell centroid inclusion approximates the union of cell squares.
     Raised fraction includes missing-TPI cells in its denominator; remaining
     statistics use their own finite samples and return zero when unavailable.
     Relief uses linear-interpolated percentiles. Texture is the geometric mean of two
     fixed, heuristic density ramps d/(d+knee), never view-normalized values. */
  var METADATA = Object.freeze({
    algorithm: "glacial-zone-features-v1",
    approximations: Object.freeze({
      neighbourhoods: "Fixed physical radius (default 30 m), rounded up to cells, floored to one cell and capped to the view; shared square-box LRM and annular TPI exclude inner radius floor(outer / 3). Shrinking windows and no-data handling follow segment features.",
      hummocks: "Whole-view elevation maxima in a square window of radius max(2 cells, ceil(10 m / cell spacing)), with TPI >0.5 m. Process highest first and suppress within Euclidean distance <=15 m of a kept peak. Equal-height ties prefer the lowest raster index, including flat tops. This counts resolved peaks, not watershed hummocks: sub-window/sub-15 m peaks may merge; edge/no-data windows shrink to finite samples. No blob-area filter.",
      kettles: "Reuse context.depressionBlobs: 8-connected components of priority-flood fill depth >0.5 m, with area <5000 m2. View edges and no-data are drainage outlets. Connected submerged basins remain one depression; this is a raster drainage approximation, not proof of glacial origin.",
      membership: "Test each kept peak's raster index or depression centroidIndex against exact closed-zone membership. Depression centroids round equal-weight cell centres to the nearest cell. Whole-view peak suppression precedes zone inclusion, so a higher peak outside a zone can suppress one inside. No bbox inclusion, overlap clipping, or segment-style dilation.",
      statistics: "Deduplicate zonePixels (closed footprint, not original candidate pixels). Raised fraction uses all zone cells, so missing TPI supplies no raised evidence. Other statistics use finite samples of their own raster; absent stage scores or samples return zero. Relief is linearly interpolated p95-p05.",
      texture: "Geometric mean sqrt(h/(h+kneeH) * k/(k+kneeK)), with default knees 100 hummocks/km2 and 20 kettles/km2. Either absent texture makes the score zero. These physically fixed heuristic knees are configurable and use no per-view normalization."
    })
  });

  /* Cache peaks by the shared layer object: one whole-view peak search for all
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

  /* A separable monotone-deque maximum filter keeps even fine-resolution
     physical windows O(n). Carry raster indices to break flat-top ties. */
  function localMaxima(grid, w, h, radius) {
    var source = null, deque = new Int32Array(Math.max(w, h));
    for (var pass = 0; pass < 2; pass++) {
      var output = new Int32Array(w * h); output.fill(-1);
      var lines = pass ? w : h, length = pass ? h : w, stride = pass ? w : 1;
      for (var line = 0; line < lines; line++) {
        var base = pass ? line : line * w, head = 0, tail = 0, end = 0;
        for (var position = 0; position < length; position++) {
          while (head < tail && deque[head] < position - radius) head++;
          var limit = Math.min(length - 1, position + radius);
          while (end <= limit) {
            var address = base + end * stride, index = source ? source[address] : address;
            if (index >= 0 && Number.isFinite(Number(grid[index]))) {
              while (head < tail) {
                var previousAddress = base + deque[tail - 1] * stride;
                var previous = source ? source[previousAddress] : previousAddress;
                if (Number(grid[previous]) > Number(grid[index]) ||
                    (Number(grid[previous]) === Number(grid[index]) && previous < index)) break;
                tail--;
              }
              deque[tail++] = end;
            }
            end++;
          }
          if (head < tail) {
            var bestAddress = base + deque[head] * stride;
            output[base + position * stride] = source ? source[bestAddress] : bestAddress;
          }
        }
      }
      source = output;
    }
    return source;
  }

  function hummockPeaks(grid, w, h, layers, cell) {
    if (hummocksByLayer.has(layers)) return hummocksByLayer.get(layers);
    var radius = Math.min(Math.max(w, h), Math.max(2, Math.ceil(10 / cell)));
    var maxima = localMaxima(grid, w, h, radius), candidates = [], peaks = [];
    for (var index = 0; index < w * h; index++) {
      if (maxima[index] === index && layers.tpi[index] > 0.5) candidates.push(index);
    }
    candidates.sort(function (a, b) { return Number(grid[b]) - Number(grid[a]) || a - b; });
    var separation = 15 / cell, bins = new Map();
    candidates.forEach(function (index) {
      var x = index % w, y = Math.floor(index / w);
      var binX = Math.floor(x / separation), binY = Math.floor(y / separation);
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nearby = bins.get((binX + dx) + "," + (binY + dy)) || [];
        for (var j = 0; j < nearby.length; j++) {
          var px = nearby[j] % w, py = Math.floor(nearby[j] / w);
          if ((x - px) * (x - px) + (y - py) * (y - py) <= separation * separation) return;
        }
      }
      peaks.push({ centroidIndex: index });
      var key = binX + "," + binY;
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(index);
    });
    hummocksByLayer.set(layers, peaks);
    return peaks;
  }

  function countInside(blobs, pixels, w, h) {
    var count = 0;
    for (var i = 0; i < blobs.length; i++) {
      if (blobs[i].centroidIndex !== undefined) {
        if (pixels.has(blobs[i].centroidIndex)) count++;
        continue;
      }
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
         filled depression detector; no synthetic segment feature is retained.
         Empty pixels/path and zero length skip profiles, kettles and aprons.
         The resulting cache entry is shared with subsequent ridge/zone calls. */
      F.segmentFeatures(grid, w, h, { pixels: [], skeleton: [], bbox: [0, 0, w - 1, h - 1],
        centroid: [0, 0], meanWidthM: radiusM, lengthM: 0 }, { context: context, cellMetres: cell });
    }
    var layers = context.layersByRadius[radius];
    if (!layers || !layers.tpi || layers.tpi.length !== w * h ||
        !layers.lrm || layers.lrm.length !== w * h || !Array.isArray(context.depressionBlobs))
      throw new TypeError("context needs TPI/LRM layers and depressionBlobs");
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
    var hummockCount = pixels.size ? countInside(hummockPeaks(grid, w, h, layers, cell), pixels, w, h) : 0;
    var kettleCount = pixels.size ? countInside(context.depressionBlobs, pixels, w, h) : 0;
    var hummockDensity = area > 0 ? hummockCount * 1000000 / area : 0;
    var kettleDensity = area > 0 ? kettleCount * 1000000 / area : 0;
    /* ridgeSupport is supplied/attached by the analysis; it is deliberately
       absent from this module's feature result. */
    return {
      hummockCount: hummockCount,
      kettleCount: kettleCount,
      hummockDensityPerKm2: hummockDensity,
      kettleDensityPerKm2: kettleDensity,
      raisedFraction: pixels.size ? raised / pixels.size : 0,
      meanStageScore: scoreCount ? scoreSum / scoreCount : 0,
      roughness: roughnessCount ? roughnessSum / roughnessCount : 0,
      reliefM: quantile(elevations, 0.95) - quantile(elevations, 0.05),
      textureScore: Math.sqrt(hummockDensity / (hummockDensity + hummockKnee) *
        kettleDensity / (kettleDensity + kettleKnee))
    };
  }

  return Object.freeze({ VERSION: 1, DEFAULT_OPTIONS: DEFAULT_OPTIONS, METADATA: METADATA,
    zoneFeatures: zoneFeatures });
}));
