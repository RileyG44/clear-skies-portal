/* Object-level DEM observations; morphology alone does not establish origin. */
(function (root, factory) {
  "use strict";
  var api = typeof module === "object" && module.exports
    ? factory(require("./glacial-research-core.js"))
    : factory(root && root.CSPGlacialResearch);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CSPGlacialSegmentFeatures = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function (G) {
  "use strict";

  /* Keep metadata on the module so each feature result has exactly the fields
     specified in the design. Integration may copy this into its own metadata.
     Elevations and square, isotropic cell spacing are assumed to be metres. */
  var METADATA = Object.freeze({
    algorithm: "glacial-segment-features-v1",
    units: "metres, square metres, degrees, and dimensionless fractions",
    sideConvention: "+1 is (-tangentY,tangentX), the right side in east/south raster coordinates; -1 is the opposite; ties or no evidence use 0",
    approximations: Object.freeze({
      profiles: "Equal weight per ordered skeleton vertex; tangent spans up to two neighbours each way. Bilinear samples at +/- mean width, floored to one cell, define shoulders. Missing profiles are skipped.",
      asymmetry: "Median |positive crest-to-shoulder grades difference| / grades sum; steep side follows the median signed grade difference, rather than compass uphill/downhill labels.",
      halfWidth: "First half-prominence crossings of the linearly shoulder-detrended profile, sampled at at most half-cell spacing and interpolated; profiles without both crossings are skipped.",
      neighbourhoods: "LRM and annular TPI use a square box radius ceil(mean width / cell spacing), floored to one cell and capped at the view size; TPI excludes an inner radius floor(outer / 3).",
      kettles: "8-connected negative-TPI blobs; depth is lowest finite exterior neighbour minus minimum blob elevation, a conservative local spill-rim proxy, not watershed filling. Blobs touching the view edge or no-data are rejected. Whole-blob area must be <5000 m2, depth >0.5 m.",
      dilation: "The polygon is the union of segment raster cells; centroid inclusion uses that footprint or Euclidean distance to pixel centres <= one mean width. Pixel-centre dilation has a subcell boundary approximation.",
      apron: "Each apron is a nearest-skeleton side ribbon outside the segment, extending one length beyond a half-mean-width edge, clipped to the view and endpoint normals. Only pixels no higher than the nearest crest are downslope samples; slopes <3 degrees count as flat. Return the flatter side's fraction.",
      valley: "PCA major axis of the view's lowest-quartile elevation band approximates drainage. Score is local skeleton transversality times band anisotropy times centroid elevation affinity; subtract positive prominence to approximate underlying floor. No flow routing is performed.",
      statistics: "Finite segment pixels only; linear-interpolated p95-p05 relief and mean absolute LRM. Unavailable measurements return zero, and therefore cannot supply positive morphological evidence."
    })
  });

  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function quantile(sorted, fraction) {
    if (!sorted.length) return 0;
    var position = (sorted.length - 1) * fraction, lower = Math.floor(position);
    var upper = Math.ceil(position), weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
  function median(values) {
    values.sort(function (a, b) { return a - b; });
    return quantile(values, 0.5);
  }

  /* A balanced spatial index avoids scanning the whole skeleton for each
     apron cell. Nearest vertex, rather than nearest polyline point, is a
     subcell approximation for the producer's ordered 8-connected path. */
  function tree(points, depth) {
    if (!points.length) return null;
    var axis = depth % 2 ? "y" : "x";
    points.sort(function (a, b) { return a[axis] - b[axis]; });
    var middle = Math.floor(points.length / 2);
    return { point: points[middle], axis: axis,
      left: tree(points.slice(0, middle), depth + 1),
      right: tree(points.slice(middle + 1), depth + 1) };
  }
  function nearest(node, x, y) {
    var best = { point: null, squared: Infinity };
    function visit(current) {
      if (!current) return;
      var point = current.point, dx = x - point.x, dy = y - point.y;
      var squared = dx * dx + dy * dy;
      if (squared < best.squared) { best.point = point; best.squared = squared; }
      var difference = current.axis === "x" ? dx : dy;
      visit(difference < 0 ? current.left : current.right);
      if (difference * difference <= best.squared)
        visit(difference < 0 ? current.right : current.left);
    }
    visit(node);
    return best;
  }

  /* Bilinear interpolation requires every nonzero-weight corner to be finite;
     do not invent shoulders by extending elevations across edges/no-data. */
  function sample(grid, w, h, x, y) {
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return NaN;
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    var fx = x - x0, fy = y - y0, result = 0;
    var indices = [y0 * w + x0, y0 * w + x1, y1 * w + x0, y1 * w + x1];
    var weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    for (var i = 0; i < 4; i++) {
      if (!weights[i]) continue;
      var value = Number(grid[indices[i]]);
      if (!Number.isFinite(value)) return NaN;
      result += weights[i] * value;
    }
    return result;
  }

  function pathPoints(grid, w, h, skeleton) {
    var points = [];
    for (var i = 0; i < skeleton.length; i++) {
      var x = Number(skeleton[i][0]), y = Number(skeleton[i][1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= w || y >= h)
        throw new RangeError("skeleton coordinates must lie within the grid");
      if (!points.length || x !== points[points.length - 1].x || y !== points[points.length - 1].y)
        points.push({ x: x, y: y, crest: sample(grid, w, h, x, y) });
    }
    for (var j = 0; j < points.length; j++) {
      var before = points[Math.max(0, j - 2)], after = points[Math.min(points.length - 1, j + 2)];
      var dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy);
      /* A singleton/locally doubled-back path cannot define a normal. */
      points[j].tx = length ? dx / length : 0;
      points[j].ty = length ? dy / length : 0;
      points[j].nx = -points[j].ty; points[j].ny = points[j].tx;
      points[j].order = j;
    }
    return points;
  }

  function halfCrossing(grid, w, h, point, side, widthCells, shoulders, prominence) {
    var steps = Math.max(1, Math.ceil(widthCells * 2));
    var previousDistance = 0, previousHeight = prominence, target = prominence / 2;
    for (var step = 1; step <= steps; step++) {
      var distance = widthCells * step / steps, signed = side * distance;
      var z = sample(grid, w, h, point.x + point.nx * signed, point.y + point.ny * signed);
      if (!Number.isFinite(z)) return NaN;
      /* A linear baseline joining the two shoulders removes a gentle valley
         tilt before measuring width, so both crossings share one datum. */
      var fraction = (signed / widthCells + 1) / 2;
      var height = z - (shoulders.minus * (1 - fraction) + shoulders.plus * fraction);
      if (height <= target) {
        var interval = previousHeight - height;
        return previousDistance + (distance - previousDistance) *
          (interval > 0 ? clamp((previousHeight - target) / interval, 0, 1) : 0);
      }
      previousHeight = height; previousDistance = distance;
    }
    return NaN;
  }

  function profiles(grid, w, h, points, widthM, cell) {
    var prominences = [], asymmetries = [], differences = [], widths = [];
    var widthCells = widthM / cell;
    points.forEach(function (point) {
      if (!Number.isFinite(point.crest) || !Math.hypot(point.tx, point.ty)) return;
      var plus = sample(grid, w, h, point.x + point.nx * widthCells, point.y + point.ny * widthCells);
      var minus = sample(grid, w, h, point.x - point.nx * widthCells, point.y - point.ny * widthCells);
      if (!Number.isFinite(plus) || !Number.isFinite(minus)) return;
      var prominence = point.crest - (plus + minus) / 2;
      prominences.push(prominence);
      if (!(prominence > 0)) return;
      /* Shoulder grades, rather than maximum cell slopes, are less sensitive
         to noise. Clip non-descending flanks to zero for 0..1 asymmetry. */
      var plusGrade = Math.max(0, (point.crest - plus) / widthM);
      var minusGrade = Math.max(0, (point.crest - minus) / widthM);
      var sum = plusGrade + minusGrade, difference = plusGrade - minusGrade;
      asymmetries.push(sum ? Math.abs(difference) / sum : 0);
      differences.push(sum ? difference / sum : 0);
      var shoulders = { plus: plus, minus: minus };
      var left = halfCrossing(grid, w, h, point, -1, widthCells, shoulders, prominence);
      var right = halfCrossing(grid, w, h, point, 1, widthCells, shoulders, prominence);
      if (Number.isFinite(left) && Number.isFinite(right)) widths.push((left + right) * cell);
    });
    var signedDifference = median(differences);
    return { prominenceM: median(prominences), profileAsymmetry: median(asymmetries),
      steepSide: Math.abs(signedDifference) <= 1e-9 ? 0 : (signedDifference > 0 ? 1 : -1),
      widthAtHalfM: median(widths) };
  }

  function kettles(grid, w, h, tpi, mask, pixels, widthCells, cell) {
    /* Blob membership requires TPI below -0.5 m, not merely < 0: on flat
       ground TPI is float noise (±1e-6 m), so a zero threshold merges every
       pit into one view-sized blob that the area limit then rejects, and no
       kettle is ever counted. The 0.5 m membership floor is the spec's
       depth criterion applied before the spill-rim check below. */
    var DEPTH = 0.5;
    var visited = new Uint8Array(w * h), queue = new Uint32Array(w * h);
    var count = 0, footprintTree = null;
    for (var start = 0; start < grid.length; start++) {
      if (visited[start] || !(tpi[start] < -DEPTH) || !Number.isFinite(Number(grid[start]))) continue;
      var head = 0, tail = 1, sumX = 0, sumY = 0;
      var minimum = Infinity, boundary = Infinity, closed = true;
      queue[0] = start; visited[start] = 1;
      while (head < tail) {
        var index = queue[head++], x = index % w, y = Math.floor(index / w);
        sumX += x; sumY += y; minimum = Math.min(minimum, Number(grid[index]));
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) closed = false;
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
          if ((!ox && !oy) || x + ox < 0 || y + oy < 0 || x + ox >= w || y + oy >= h) continue;
          var next = (y + oy) * w + x + ox, z = Number(grid[next]);
          if (!Number.isFinite(z) || !Number.isFinite(tpi[next])) { closed = false; continue; }
          if (tpi[next] < -DEPTH) {
            if (!visited[next]) { visited[next] = 1; queue[tail++] = next; }
          } else boundary = Math.min(boundary, z);
        }
      }
      /* Lowest exterior neighbour is a conservative surrogate spill elevation:
         open troughs and negative TPI beside a ridge do not become kettles. */
      if (!closed || tail * cell * cell >= 5000 || !Number.isFinite(boundary) || boundary - minimum <= 0.5) continue;
      var cx = sumX / tail, cy = sumY / tail;
      if (mask[Math.round(cy) * w + Math.round(cx)]) { count++; continue; }
      if (!footprintTree) footprintTree = tree(pixels.map(function (index) {
        return { x: index % w, y: Math.floor(index / w) };
      }), 0);
      if (nearest(footprintTree, cx, cy).squared <= widthCells * widthCells) count++;
    }
    return count;
  }

  function aprons(grid, w, h, mask, slope, points, pathTree, bbox, widthM, lengthM, cell) {
    if (!points.length || !(lengthM > 0)) return { fraction: 0, side: 0 };
    var radius = (lengthM + widthM / 2) / cell, totals = [0, 0], flats = [0, 0];
    var x0 = Math.max(0, Math.floor(bbox[0] - radius)), x1 = Math.min(w - 1, Math.ceil(bbox[2] + radius));
    var y0 = Math.max(0, Math.floor(bbox[1] - radius)), y1 = Math.min(h - 1, Math.ceil(bbox[3] + radius));
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var index = y * w + x;
      if (mask[index] || !Number.isFinite(Number(grid[index])) || !Number.isFinite(slope[index])) continue;
      var closest = nearest(pathTree, x, y), point = closest.point;
      if (closest.squared > radius * radius || !Number.isFinite(point.crest)) continue;
      var dx = x - point.x, dy = y - point.y;
      var along = dx * point.tx + dy * point.ty, across = dx * point.nx + dy * point.ny;
      /* Clip end caps; the apron is beside the segment rather than beyond its
         endpoints. On bends the nearest path vertex assigns a local side. */
      if ((point.order === 0 && along < 0) || (point.order === points.length - 1 && along > 0)) continue;
      if (Math.abs(across) <= 1e-9 || Number(grid[index]) > point.crest) continue;
      var side = across > 0 ? 1 : 0;
      totals[side]++; if (slope[index] < 3) flats[side]++;
    }
    var minus = totals[0] ? flats[0] / totals[0] : 0;
    var plus = totals[1] ? flats[1] / totals[1] : 0;
    return { fraction: Math.max(minus, plus),
      side: Math.abs(plus - minus) <= 1e-9 ? 0 : (plus > minus ? 1 : -1) };
  }

  function valleyScore(grid, w, h, centroid, pathTree, prominence) {
    if (!pathTree) return 0;
    var elevations = [];
    for (var i = 0; i < grid.length; i++) if (Number.isFinite(Number(grid[i]))) elevations.push(Number(grid[i]));
    elevations.sort(function (a, b) { return a - b; });
    if (!elevations.length) return 0;
    var low = quantile(elevations, 0.25), range = quantile(elevations, 0.95) - quantile(elevations, 0.05);
    if (!(range > 1e-9)) return 0;
    var count = 0, meanX = 0, meanY = 0, xx = 0, yy = 0, xy = 0;
    /* Online covariance avoids cancellation when the low band is narrow. */
    for (var j = 0; j < grid.length; j++) {
      if (!Number.isFinite(Number(grid[j])) || Number(grid[j]) > low) continue;
      var x = j % w, y = Math.floor(j / w); count++;
      var dx = x - meanX, dy = y - meanY;
      meanX += dx / count; meanY += dy / count;
      xx += dx * (x - meanX); yy += dy * (y - meanY); xy += dx * (y - meanY);
    }
    if (count < 3 || !(xx + yy > 0)) return 0;
    var angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    var anisotropy = clamp(Math.hypot(xx - yy, 2 * xy) / (xx + yy), 0, 1);
    var tangent = nearest(pathTree, centroid[0], centroid[1]).point;
    var transverse = Math.abs(tangent.tx * Math.sin(angle) - tangent.ty * Math.cos(angle));
    var elevation = sample(grid, w, h, centroid[0], centroid[1]);
    if (!Number.isFinite(elevation)) return 0;
    /* Removing ridge prominence approximates the valley floor beneath a crest.
       PCA anisotropy suppresses undefined drainage axes in broad flat bands;
       a planar hillside can still resemble a corridor, so this is a proxy. */
    var affinity = clamp(1 - Math.max(0, elevation - Math.max(0, prominence) - low) / range, 0, 1);
    return clamp(transverse * anisotropy * affinity, 0, 1);
  }

  function segmentFeatures(grid, w, h, segment, opts) {
    if (!G || typeof G.localReliefModel !== "function" || typeof G.terrainPositionIndex !== "function" ||
        typeof G.slopeAspectComponents !== "function") throw new Error("CSPGlacialResearch is not loaded");
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || !grid || grid.length !== w * h)
      throw new RangeError("grid length must equal positive integer width times height");
    opts = opts || {};
    var cell = opts.cellMetres === undefined ? 1 : Number(opts.cellMetres);
    if (!Number.isFinite(cell) || cell <= 0) throw new RangeError("cellMetres must be positive and finite");
    if (!segment || !segment.pixels || !Array.isArray(segment.skeleton) ||
        !segment.bbox || segment.bbox.length !== 4 || !segment.centroid || segment.centroid.length !== 2)
      throw new TypeError("segment needs pixels, an ordered skeleton, bbox, and centroid");
    var width = Number(segment.meanWidthM), length = Number(segment.lengthM);
    if (!Number.isFinite(width) || width < 0 || !Number.isFinite(length) || length < 0)
      throw new RangeError("segment meanWidthM and lengthM must be finite and non-negative");
    for (var b = 0; b < 4; b++) if (!Number.isFinite(segment.bbox[b])) throw new RangeError("bbox must be finite");
    for (var c = 0; c < 2; c++) if (!Number.isFinite(segment.centroid[c])) throw new RangeError("centroid must be finite");
    var mask = new Uint8Array(w * h), pixels = [], elevations = [];
    for (var p = 0; p < segment.pixels.length; p++) {
      var index = segment.pixels[p];
      if (!Number.isInteger(index) || index < 0 || index >= w * h) throw new RangeError("segment pixel index is outside the grid");
      if (!mask[index]) { mask[index] = 1; pixels.push(index); }
    }
    var points = pathPoints(grid, w, h, segment.skeleton), pathTree = tree(points.slice(), 0);
    /* Subcell/zero-width segments still need separated shoulder samples. The
       one-cell floor affects profile and neighborhood scales, not dilation. */
    var effectiveWidth = Math.max(cell, width);
    var radius = Math.min(Math.max(w, h), Math.max(1, Math.ceil(effectiveWidth / cell)));
    var spatial = { cellSize: cell, horizontalUnit: "m", verticalUnit: "m", rowAxis: "south", edgePolicy: "shrink" };
    var lrm = G.localReliefModel(grid, w, h, Object.assign({}, spatial, { radiusCells: radius })).data;
    var tpi = G.terrainPositionIndex(grid, w, h, Object.assign({}, spatial,
      { radiusCells: radius, innerRadiusCells: Math.floor(radius / 3) })).data;
    var slope = G.slopeAspectComponents(grid, w, h, spatial).slopeDegrees;
    var slopeSum = 0, slopeCount = 0, roughnessSum = 0, roughnessCount = 0;
    pixels.forEach(function (pixel) {
      if (!Number.isFinite(Number(grid[pixel]))) return;
      elevations.push(Number(grid[pixel]));
      if (Number.isFinite(slope[pixel])) { slopeSum += slope[pixel]; slopeCount++; }
      if (Number.isFinite(lrm[pixel])) { roughnessSum += Math.abs(lrm[pixel]); roughnessCount++; }
    });
    elevations.sort(function (a, b) { return a - b; });
    var profile = profiles(grid, w, h, points, effectiveWidth, cell);
    var kettleCount = pixels.length ? kettles(grid, w, h, tpi, mask, pixels, width / cell, cell) : 0;
    var apron = aprons(grid, w, h, mask, slope, points, pathTree, segment.bbox, width, length, cell);
    return {
      prominenceM: profile.prominenceM,
      profileAsymmetry: profile.profileAsymmetry,
      steepSide: profile.steepSide,
      widthAtHalfM: profile.widthAtHalfM,
      kettleCount: kettleCount,
      kettleDensityPerKm: length > 0 ? kettleCount * 1000 / length : 0,
      apronFlatFraction: apron.fraction,
      apronSide: apron.side,
      valleyCrossingScore: valleyScore(grid, w, h, segment.centroid, pathTree, profile.prominenceM),
      meanSlopeDeg: slopeCount ? slopeSum / slopeCount : 0,
      reliefM: quantile(elevations, 0.95) - quantile(elevations, 0.05),
      roughness: roughnessCount ? roughnessSum / roughnessCount : 0
    };
  }

  return Object.freeze({ VERSION: 1, METADATA: METADATA, segmentFeatures: segmentFeatures });
}));
