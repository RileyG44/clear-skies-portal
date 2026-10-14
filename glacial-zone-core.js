/*
 * Clear Skies Portal — dependency-free zone geometry for the glacial
 * moraine belt/zone object screen (v3). See docs/GLACIAL_BELT_V3_DESIGN.md.
 *
 * Turns the stage-1 candidate mask into belt zones: a morphological closing
 * (Euclidean disk, via exact squared distance transforms) merges nearby
 * hummocks, interior holes are filled, and the 8-connected components of the
 * result above a minimum area become zones with area, elongation,
 * orientation, solidity, and perimeter. Pure geometry: no elevation input,
 * and nothing here says anything about origin.
 * Rasters are row-major; x is the column index, y the row index.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CSPGlacialZones = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = 3;
  var INF = 1e20;

  // Defaults for extractZones. 60 m closes the gaps between hummocks of a
  // belt (typical spacing tens of metres) without bridging separate belts;
  // 20,000 m² keeps zones at belt scale rather than single-hummock scale.
  // Both are judgement calls, not calibrated.
  var DEFAULT_OPTIONS = Object.freeze({
    closeRadiusM: 60,
    minAreaM2: 20000
  });

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function validateMask(mask, width, height) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new RangeError("width and height must be positive integers");
    }
    if (!mask || typeof mask.length !== "number" || mask.length < width * height) {
      throw new RangeError("mask must contain at least width times height samples");
    }
  }

  function optionNumber(options, key, fallback) {
    if (!options || !hasOwn(options, key) || options[key] === undefined) return fallback;
    var value = Number(options[key]);
    if (!Number.isFinite(value)) throw new TypeError(key + " must be a finite number");
    return value;
  }

  // Felzenszwalb–Huttenlocher 1-D squared distance transform of f (length n)
  // into d, using v/z as scratch.
  function edt1d(f, n, d, v, z) {
    var k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (var q = 1; q < n; q++) {
      var s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (var p = 0; p < n; p++) {
      while (z[k + 1] < p) k++;
      var dp = p - v[k];
      d[p] = dp * dp + f[v[k]];
    }
  }

  // Exact squared Euclidean distance (in cells) from every cell to the
  // nearest cell where `target(i)` is true; INF-ish where there is none.
  // Separable: one 1-D pass per column, then one per row, O(width * height).
  function squaredDistanceTo(target, width, height) {
    var size = width * height, g = new Float64Array(size), x, y, i;
    for (i = 0; i < size; i++) g[i] = target(i) ? 0 : INF;
    var n = Math.max(width, height), f = new Float64Array(n), d = new Float64Array(n);
    var v = new Int32Array(n), z = new Float64Array(n + 1);
    for (x = 0; x < width; x++) {
      for (y = 0; y < height; y++) f[y] = g[y * width + x];
      edt1d(f, height, d, v, z);
      for (y = 0; y < height; y++) g[y * width + x] = d[y];
    }
    for (y = 0; y < height; y++) {
      var row = y * width;
      for (x = 0; x < width; x++) f[x] = g[row + x];
      edt1d(f, width, d, v, z);
      for (x = 0; x < width; x++) g[row + x] = d[x];
    }
    return g;
  }

  // Morphological closing with a Euclidean disk of radius `radiusCells`:
  // dilate (distance to the mask <= r) then erode (distance to the dilated
  // background > r). Runs on a copy padded with ceil(r) + 1 background cells
  // per side, so the result is the closing of the mask on an unbounded empty
  // plane, cropped: it contains the input mask and neither grows toward nor
  // erodes in from the grid edge. Returns a new Uint8Array of 0/1.
  function closeMask(mask, width, height, radiusCells) {
    validateMask(mask, width, height);
    var size = width * height, out = new Uint8Array(size), i, x, y;
    for (i = 0; i < size; i++) out[i] = mask[i] ? 1 : 0;
    if (!(radiusCells >= 1)) return out;
    var r2 = radiusCells * radiusCells, pad = Math.ceil(radiusCells) + 1;
    var pw = width + 2 * pad, ph = height + 2 * pad, padded = new Uint8Array(pw * ph);
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) padded[(y + pad) * pw + x + pad] = out[y * width + x];
    }
    var toMask = squaredDistanceTo(function (j) { return padded[j] === 1; }, pw, ph);
    var dilated = new Uint8Array(pw * ph);
    for (i = 0; i < dilated.length; i++) dilated[i] = toMask[i] <= r2 ? 1 : 0;
    var toGap = squaredDistanceTo(function (j) { return dilated[j] === 0; }, pw, ph);
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        if (toGap[(y + pad) * pw + x + pad] > r2) out[y * width + x] = 1;
      }
    }
    return out;
  }

  // Fills interior holes in place: background cells not 4-connected to the
  // grid edge through background (the complement of 8-connected foreground)
  // become foreground. Returns the same array.
  function fillHoles(buf, width, height) {
    var size = width * height, outside = new Uint8Array(size), queue = new Int32Array(size);
    var tail = 0, head = 0, x, y, i;
    function seed(j) {
      if (!buf[j] && !outside[j]) { outside[j] = 1; queue[tail++] = j; }
    }
    for (x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
    for (y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
    while (head < tail) {
      i = queue[head++];
      x = i % width;
      if (x > 0) seed(i - 1);
      if (x < width - 1) seed(i + 1);
      if (i >= width) seed(i - width);
      if (i < size - width) seed(i + width);
    }
    for (i = 0; i < size; i++) if (!buf[i] && !outside[i]) buf[i] = 1;
    return buf;
  }

  // Shape measures of one zone's closed-mask pixels.
  //
  // elongation: sqrt(major / minor) of the second-moment eigenvalues, each
  //   with 1/12 added (the variance of a unit cell), so the moments are those
  //   of the union of pixel squares and a one-cell-wide line stays finite.
  //   1 for a disk or square; about length/width for a rectangle.
  // orientationRad: major-axis direction, axial in [0, pi), measured from +x
  //   (columns) toward +y (rows) — the same convention as ridge segments.
  // solidity: zone area / approximate convex-hull area. The hull is not
  //   built; its area is bounded above by the tighter of the axis-aligned
  //   bounding box and the PCA-oriented bounding rectangle (both contain the
  //   hull; each pixel counted as its full unit square). The result is
  //   therefore a lower bound on true solidity: 1 for an axis-aligned or
  //   PCA-aligned rectangle, about pi/4 (0.785) for a filled ellipse, lower
  //   for lobed, curved, or ragged zones. Compare zones against each other,
  //   not against true-hull solidity values from the literature.
  function describeZone(zonePixels, width, height, bbox, cellMetres, closed, original) {
    var count = zonePixels.length, sumX = 0, sumY = 0, k, p, x, y;
    for (k = 0; k < count; k++) {
      p = zonePixels[k];
      sumX += p % width;
      sumY += (p - p % width) / width;
    }
    var meanX = sumX / count, meanY = sumY / count;
    var sxx = 0, syy = 0, sxy = 0, perimeterEdges = 0, inside = [];
    for (k = 0; k < count; k++) {
      p = zonePixels[k];
      x = p % width;
      y = (p - x) / width;
      var dx = x - meanX, dy = y - meanY;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
      // Boundary edges: sides facing a non-zone cell or the grid edge. Holes
      // are already filled, so every such edge is on the outer boundary.
      if (x === 0 || !closed[p - 1]) perimeterEdges++;
      if (x === width - 1 || !closed[p + 1]) perimeterEdges++;
      if (y === 0 || !closed[p - width]) perimeterEdges++;
      if (y === height - 1 || !closed[p + width]) perimeterEdges++;
      if (original[p]) inside.push(p);
    }
    sxx = sxx / count + 1 / 12;
    syy = syy / count + 1 / 12;
    sxy /= count;
    var half = (sxx + syy) / 2, spread = Math.sqrt(((sxx - syy) / 2) * ((sxx - syy) / 2) + sxy * sxy);
    var major = half + spread, minor = Math.max(half - spread, 1e-12);
    var angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI) angle = 0;

    var c = Math.cos(angle), s = Math.sin(angle);
    var uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (k = 0; k < count; k++) {
      p = zonePixels[k];
      x = p % width;
      y = (p - x) / width;
      var u = x * c + y * s, w = -x * s + y * c;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (w < vMin) vMin = w;
      if (w > vMax) vMax = w;
    }
    // A unit cell projects to |cos| + |sin| along either rotated axis.
    var cellExtent = Math.abs(c) + Math.abs(s);
    var orientedArea = (uMax - uMin + cellExtent) * (vMax - vMin + cellExtent);
    var boxArea = (bbox[2] - bbox[0] + 1) * (bbox[3] - bbox[1] + 1);
    var hullArea = Math.min(orientedArea, boxArea);

    var cellArea = cellMetres * cellMetres;
    return {
      objectType: "belt",
      pixels: Uint32Array.from(inside),
      zonePixels: zonePixels,
      pixelCount: inside.length,
      zonePixelCount: count,
      areaM2: count * cellArea,
      bbox: bbox,
      centroid: [meanX, meanY],
      elongation: Math.sqrt(major / minor),
      orientationRad: angle,
      solidity: Math.min(1, count / hullArea),
      perimeterM: perimeterEdges * cellMetres
    };
  }

  // Zones are 8-connected components of the closed, hole-filled candidate
  // mask with closed-mask area at least minAreaM2, sorted by area descending
  // (ties: first zone pixel in raster order). ids are 1-based in that order.
  // `pixels` / `pixelCount` are the ORIGINAL mask cells inside the zone (so
  // touch and membership tests stay honest); `zonePixels` / `zonePixelCount`
  // / `areaM2` are the closed zone. Pixel arrays are sorted Uint32Array
  // raster indices; centroids and bboxes are in pixel (x, y) units of the
  // closed zone; metric fields use cellMetres (square cells assumed).
  function extractZones(mask, width, height, options) {
    validateMask(mask, width, height);
    options = options || {};
    var cellMetres = Number(options.cellMetres);
    if (!Number.isFinite(cellMetres) || cellMetres <= 0) {
      throw new RangeError("cellMetres must be a finite number greater than zero");
    }
    var closeRadiusM = optionNumber(options, "closeRadiusM", DEFAULT_OPTIONS.closeRadiusM);
    var minAreaM2 = optionNumber(options, "minAreaM2", DEFAULT_OPTIONS.minAreaM2);
    if (closeRadiusM < 0) throw new RangeError("closeRadiusM must be non-negative");
    if (minAreaM2 < 0) throw new RangeError("minAreaM2 must be non-negative");
    var minPixels = minAreaM2 / (cellMetres * cellMetres);

    var closed = fillHoles(closeMask(mask, width, height, closeRadiusM / cellMetres), width, height);
    var total = width * height, visited = new Uint8Array(total), queue = new Int32Array(total);
    var found = [];
    for (var seed = 0; seed < total; seed++) {
      if (visited[seed] || !closed[seed]) continue;
      var head = 0, tail = 0;
      var x0 = width, y0 = height, x1 = -1, y1 = -1;
      visited[seed] = 1;
      queue[tail++] = seed;
      while (head < tail) {
        var index = queue[head++], x = index % width, y = (index - x) / width;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (var dy = -1; dy <= 1; dy++) {
          var ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx;
            if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
            var next = ny * width + nx;
            if (visited[next] || !closed[next]) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      if (tail < minPixels) continue;
      var zonePixels = Uint32Array.from(queue.subarray(0, tail)).sort();
      found.push(describeZone(zonePixels, width, height, [x0, y0, x1, y1], cellMetres, closed, mask));
    }
    found.sort(function (a, b) {
      return (b.zonePixelCount - a.zonePixelCount) || (a.zonePixels[0] - b.zonePixels[0]);
    });
    return found.map(function (zone, rank) {
      var out = { id: rank + 1 };
      Object.keys(zone).forEach(function (key) { out[key] = zone[key]; });
      return out;
    });
  }

  return Object.freeze({
    VERSION: VERSION,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    closeMask: closeMask,
    fillHoles: fillHoles,
    extractZones: extractZones
  });
}));
