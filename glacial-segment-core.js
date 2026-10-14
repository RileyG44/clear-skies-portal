/*
 * Clear Skies Portal — dependency-free segment geometry for the glacial
 * moraine object screen (v2). See docs/GLACIAL_MORAINE_V2_DESIGN.md.
 *
 * Turns a binary candidate mask into 8-connected segments with skeleton,
 * length, width, elongation, orientation, and arc-shape measures. Pure
 * geometry: no elevation input, and nothing here says anything about origin.
 * Rasters are row-major; x is the column index, y the row index.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CSPGlacialSegments = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = 1;
  var SQRT2 = Math.SQRT2;
  var DEG = Math.PI / 180;

  // Defaults for extractSegments. The arc band values are judgement calls,
  // not calibrated: recessional/terminal moraine arcs observed in a single
  // view range from cirque-scale (~50 m radius) to lobe-scale (tens of km),
  // and a net bend above ~330 degrees is a closed ring, not a margin arc.
  var DEFAULT_OPTIONS = Object.freeze({
    minAreaM2: 5000,
    arcMinRadiusM: 50,
    arcMaxRadiusM: 20000,
    arcBendRiseStartRad: 10 * DEG,
    arcBendRiseEndRad: 45 * DEG,
    arcBendFallStartRad: 200 * DEG,
    arcBendFallEndRad: 330 * DEG
  });

  var hasOwn = function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  };
  var clamp = function (value, low, high) {
    return Math.max(low, Math.min(high, value));
  };

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

  // Zhang–Suen thinning in place. `buf` must carry a zero border one pixel
  // wide so neighbour reads need no bounds checks; `active` lists the
  // foreground indices and is compacted as pixels are removed.
  function thinInPlace(buf, bw, active) {
    var n = active.length, removed = new Int32Array(n), changed = true;
    while (changed) {
      changed = false;
      for (var step = 0; step < 2; step++) {
        var count = 0;
        for (var k = 0; k < n; k++) {
          var i = active[k];
          if (!buf[i]) continue;
          var p2 = buf[i - bw], p3 = buf[i - bw + 1], p4 = buf[i + 1], p5 = buf[i + bw + 1];
          var p6 = buf[i + bw], p7 = buf[i + bw - 1], p8 = buf[i - 1], p9 = buf[i - bw - 1];
          var b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          var a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) +
            (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (a !== 1) continue;
          if (step === 0) {
            if (p2 && p4 && p6) continue;
            if (p4 && p6 && p8) continue;
          } else {
            if (p2 && p4 && p8) continue;
            if (p2 && p6 && p8) continue;
          }
          removed[count++] = i;
        }
        for (var d = 0; d < count; d++) buf[removed[d]] = 0;
        if (count) changed = true;
      }
      var m = 0;
      for (var j = 0; j < n; j++) if (buf[active[j]]) active[m++] = active[j];
      n = m;
    }
  }

  function skeletonize(mask, width, height) {
    validateMask(mask, width, height);
    var bw = width + 2, bh = height + 2;
    var buf = new Uint8Array(bw * bh), list = [], x, y;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        if (mask[y * width + x]) {
          var p = (y + 1) * bw + x + 1;
          buf[p] = 1;
          list.push(p);
        }
      }
    }
    thinInPlace(buf, bw, Int32Array.from(list));
    var out = new Uint8Array(width * height);
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) out[y * width + x] = buf[(y + 1) * bw + x + 1];
    }
    return out;
  }

  // Minimal binary min-heap keyed on distance, for Dijkstra on the skeleton.
  function MinHeap() { this.keys = []; this.values = []; }
  MinHeap.prototype.push = function (key, value) {
    var keys = this.keys, values = this.values, i = keys.length;
    keys.push(key); values.push(value);
    while (i > 0) {
      var parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent]; values[i] = values[parent];
      i = parent;
    }
    keys[i] = key; values[i] = value;
  };
  MinHeap.prototype.pop = function () {
    var keys = this.keys, values = this.values, top = values[0];
    var lastKey = keys.pop(), lastValue = values.pop(), size = keys.length;
    if (size) {
      var i = 0;
      for (;;) {
        var left = 2 * i + 1, right = left + 1, smallest = i, smallestKey = lastKey;
        if (left < size && keys[left] < smallestKey) { smallest = left; smallestKey = keys[left]; }
        if (right < size && keys[right] < smallestKey) smallest = right;
        if (smallest === i) break;
        keys[i] = keys[smallest]; values[i] = values[smallest];
        i = smallest;
      }
      keys[i] = lastKey; values[i] = lastValue;
    }
    return top;
  };
  MinHeap.prototype.size = function () { return this.keys.length; };

  var NEIGHBOUR_DX = [1, 1, 0, -1, -1, -1, 0, 1];
  var NEIGHBOUR_DY = [0, 1, 1, 1, 0, -1, -1, -1];

  // Skeleton graph over the thinned crop: node ids are compact, adjacency is
  // 8-connected with step costs 1 (orthogonal) and sqrt(2) (diagonal).
  function buildSkeletonGraph(buf, bw, bh) {
    var nodeOf = new Map(), cx = [], cy = [];
    for (var i = 0; i < buf.length; i++) {
      if (!buf[i]) continue;
      nodeOf.set(i, cx.length);
      cx.push(i % bw);
      cy.push((i / bw) | 0);
    }
    var n = cx.length, adjacency = new Array(n);
    for (var node = 0; node < n; node++) {
      var links = [];
      for (var d = 0; d < 8; d++) {
        var nx = cx[node] + NEIGHBOUR_DX[d], ny = cy[node] + NEIGHBOUR_DY[d];
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        var other = nodeOf.get(ny * bw + nx);
        if (other !== undefined) links.push(other, (d & 1) ? SQRT2 : 1);
      }
      adjacency[node] = links;
    }
    return { count: n, x: cx, y: cy, adjacency: adjacency };
  }

  function dijkstra(graph, source) {
    var dist = new Float64Array(graph.count).fill(Infinity);
    var prev = new Int32Array(graph.count).fill(-1);
    var heap = new MinHeap();
    dist[source] = 0;
    heap.push(0, source);
    while (heap.size()) {
      var key = heap.keys[0], node = heap.pop();
      if (key > dist[node]) continue;
      var links = graph.adjacency[node];
      for (var k = 0; k < links.length; k += 2) {
        var other = links[k], next = key + links[k + 1];
        if (next < dist[other]) {
          dist[other] = next;
          prev[other] = node;
          heap.push(next, other);
        }
      }
    }
    return { dist: dist, prev: prev };
  }

  function farthest(dist) {
    var best = -1, bestDist = -1;
    for (var i = 0; i < dist.length; i++) {
      if (dist[i] !== Infinity && dist[i] > bestDist) { bestDist = dist[i]; best = i; }
    }
    return best;
  }

  // Ordered longest path through the skeleton. Uses the double-sweep
  // (farthest-from-farthest) geodesic diameter, restricted to the skeleton
  // piece with the most pixels: exact for tree skeletons, an approximation
  // when thinning leaves small loops. Returns crop-local node ids.
  function longestSkeletonPath(graph) {
    if (!graph.count) return { nodes: [], closed: false };
    // Pick the largest skeleton piece (thinning can occasionally split one).
    var piece = new Int32Array(graph.count).fill(-1), bestPiece = -1, bestSize = 0, stack = [];
    for (var seed = 0, label = 0; seed < graph.count; seed++) {
      if (piece[seed] >= 0) continue;
      var size = 0;
      piece[seed] = label;
      stack.push(seed);
      while (stack.length) {
        var node = stack.pop(), links = graph.adjacency[node];
        size++;
        for (var k = 0; k < links.length; k += 2) {
          if (piece[links[k]] < 0) { piece[links[k]] = label; stack.push(links[k]); }
        }
      }
      if (size > bestSize) { bestSize = size; bestPiece = label; }
      label++;
    }
    var start = -1;
    for (var i = 0; i < graph.count; i++) {
      if (piece[i] !== bestPiece) continue;
      if (start < 0) start = i;
      if (graph.adjacency[i].length === 2) { start = i; break; }
    }
    var a = farthest(dijkstra(graph, start).dist);
    var sweep = dijkstra(graph, a), b = farthest(sweep.dist);
    var path = [];
    for (var at = b; at >= 0; at = sweep.prev[at]) path.push(at);
    path.reverse();
    return { nodes: path, closed: endsJoinedOffPath(graph, path) };
  }

  // A ring skeleton's longest geodesic path is only half the loop, which
  // would read as a perfect C-arc. Flag it: the path ends are still joined
  // after removing the path interior. Small thinning loops beside the path
  // cannot join the two ends, so they do not trigger this.
  function endsJoinedOffPath(graph, path) {
    if (path.length < 3) return false;
    var blocked = new Uint8Array(graph.count), target = path[path.length - 1], stack = [path[0]];
    for (var i = 1; i < path.length - 1; i++) blocked[path[i]] = 1;
    blocked[path[0]] = 1;
    while (stack.length) {
      var links = graph.adjacency[stack.pop()];
      for (var k = 0; k < links.length; k += 2) {
        var other = links[k];
        if (other === target) return true;
        if (!blocked[other]) { blocked[other] = 1; stack.push(other); }
      }
    }
    return false;
  }

  function polylineLength(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return total;
  }

  // Resample a pixel polyline at a fixed arc-length spacing so pixel
  // staircase jitter does not dominate turning angles.
  function resample(points, spacing) {
    var out = [points[0].slice()], carried = 0;
    for (var i = 1; i < points.length; i++) {
      var x0 = points[i - 1][0], y0 = points[i - 1][1];
      var dx = points[i][0] - x0, dy = points[i][1] - y0, segment = Math.hypot(dx, dy);
      var along = spacing - carried;
      while (along <= segment) {
        out.push([x0 + dx * along / segment, y0 + dy * along / segment]);
        along += spacing;
      }
      carried = segment - (along - spacing);
    }
    var last = points[points.length - 1], tail = out[out.length - 1];
    // Keep the true end point when the remainder is at least half a step.
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) >= spacing / 2) out.push(last.slice());
    return out;
  }

  function wrapAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  function ramp(value, start, end) {
    if (end <= start) return value >= end ? 1 : 0;
    return clamp((value - start) / (end - start), 0, 1);
  }

  // arcScore = turnConsistency * bendFactor * radiusFactor, each 0..1.
  //   turnConsistency = |sum(turn)| / sum(|turn|) over resampled chords:
  //     1 when the skeleton always turns the same way, ~0 for zigzags.
  //   bendFactor: net heading change ramps up 10->45 deg, holds to 200 deg,
  //     ramps down to 0 at 330 deg (near-closed rings are not margin arcs;
  //     fully closed skeleton loops are zeroed separately, see closedLoop).
  //   radiusFactor: effective radius = skeleton length / net bend; 1 inside
  //     [arcMinRadiusM, arcMaxRadiusM], falling linearly in log2 to 0 one
  //     doubling outside the band.
  // meanBendRad is the absolute mean signed turn per resampled chord step
  // (spacing reported as arcStepM); netBendRad is the signed total, positive
  // when turning from +x toward +y (clockwise on a north-up display).
  function arcMeasures(path, skeletonLengthPx, meanWidthPx, cellMetres, settings) {
    var empty = { arcScore: 0, meanBendRad: 0, netBendRad: 0, turnConsistency: 0,
      bendRadiusM: Infinity, arcStepM: 0 };
    if (path.length < 3 || skeletonLengthPx < 4) return empty;
    var spacing = Math.max(2, Math.min(meanWidthPx, skeletonLengthPx / 4));
    var points = resample(path, spacing);
    if (points.length < 3) return empty;
    var net = 0, absolute = 0, turns = 0, previous = null;
    for (var i = 1; i < points.length; i++) {
      var heading = Math.atan2(points[i][1] - points[i - 1][1], points[i][0] - points[i - 1][0]);
      if (previous !== null) {
        var turn = wrapAngle(heading - previous);
        net += turn;
        absolute += Math.abs(turn);
        turns++;
      }
      previous = heading;
    }
    var netAbs = Math.abs(net);
    var consistency = absolute > 0 ? netAbs / absolute : 0;
    var bendFactor = Math.min(
      ramp(netAbs, settings.arcBendRiseStartRad, settings.arcBendRiseEndRad),
      1 - ramp(netAbs, settings.arcBendFallStartRad, settings.arcBendFallEndRad));
    var radiusM = netAbs > 1e-9 ? skeletonLengthPx * cellMetres / netAbs : Infinity;
    var radiusFactor = 0;
    if (Number.isFinite(radiusM)) {
      if (radiusM < settings.arcMinRadiusM) radiusFactor = 1 - Math.log2(settings.arcMinRadiusM / radiusM);
      else if (radiusM > settings.arcMaxRadiusM) radiusFactor = 1 - Math.log2(radiusM / settings.arcMaxRadiusM);
      else radiusFactor = 1;
      radiusFactor = clamp(radiusFactor, 0, 1);
    }
    return {
      arcScore: clamp(consistency * bendFactor * radiusFactor, 0, 1),
      meanBendRad: turns ? netAbs / turns : 0,
      netBendRad: net,
      turnConsistency: consistency,
      bendRadiusM: radiusM,
      arcStepM: spacing * cellMetres
    };
  }

  // Principal-axis orientation of the segment's pixels, axial in [0, pi),
  // measured from +x (columns) toward +y (rows).
  function principalOrientation(pixels, width, meanX, meanY) {
    var sxx = 0, syy = 0, sxy = 0;
    for (var k = 0; k < pixels.length; k++) {
      var dx = pixels[k] % width - meanX, dy = Math.floor(pixels[k] / width) - meanY;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    var angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    if (angle < 0) angle += Math.PI;
    return angle >= Math.PI ? 0 : angle;
  }

  function describeSegment(pixels, width, bbox, cellMetres, settings) {
    var x0 = bbox[0], y0 = bbox[1], x1 = bbox[2], y1 = bbox[3];
    var count = pixels.length, sumX = 0, sumY = 0, k;
    for (k = 0; k < count; k++) {
      sumX += pixels[k] % width;
      sumY += Math.floor(pixels[k] / width);
    }
    var meanX = sumX / count, meanY = sumY / count;

    // Thin a padded crop that holds only this segment's pixels, so other
    // segments sharing the bounding box cannot affect its skeleton.
    var bw = x1 - x0 + 3, bh = y1 - y0 + 3, buf = new Uint8Array(bw * bh);
    var active = new Int32Array(count);
    for (k = 0; k < count; k++) {
      var p = (Math.floor(pixels[k] / width) - y0 + 1) * bw + (pixels[k] % width) - x0 + 1;
      buf[p] = 1;
      active[k] = p;
    }
    thinInPlace(buf, bw, active);
    var graph = buildSkeletonGraph(buf, bw, bh);
    var longest = longestSkeletonPath(graph);
    var path = longest.nodes.map(function (node) {
      return [graph.x[node] - 1 + x0, graph.y[node] - 1 + y0];
    });
    if (!path.length) {
      // Zhang–Suen can erase some 2-pixel-thick shapes entirely; fall back
      // to the segment pixel nearest the centroid as a one-point skeleton.
      var best = 0, bestDist = Infinity;
      for (k = 0; k < count; k++) {
        var d = Math.hypot(pixels[k] % width - meanX, Math.floor(pixels[k] / width) - meanY);
        if (d < bestDist) { bestDist = d; best = pixels[k]; }
      }
      path = [[best % width, Math.floor(best / width)]];
    }
    // Deterministic direction: start at the end with the smaller x, then y.
    var first = path[0], last = path[path.length - 1];
    if (last[0] < first[0] || (last[0] === first[0] && last[1] < first[1])) path.reverse();

    // Thinning erodes each skeleton end by about half the ridge width, so the
    // raw skeleton under-reads length by ~one width. Solve L = S + A / L
    // (length = skeleton + mean width, width = area / length) for L:
    // L = (S + sqrt(S^2 + 4A)) / 2. A round blob (S ~ 0) gets L = sqrt(A),
    // i.e. elongation ~1, and an ideal W x Lbar bar gets back Lbar.
    var skeletonPx = polylineLength(path);
    var lengthPx = (skeletonPx + Math.sqrt(skeletonPx * skeletonPx + 4 * count)) / 2;
    var meanWidthPx = count / lengthPx;
    var arc = arcMeasures(path, skeletonPx, meanWidthPx, cellMetres, settings);
    // Closed rings (doughnut/kettle-rim shapes) are not margin arcs.
    if (longest.closed) arc.arcScore = 0;
    return {
      pixels: pixels,
      pixelCount: count,
      areaM2: count * cellMetres * cellMetres,
      bbox: [x0, y0, x1, y1],
      centroid: [meanX, meanY],
      skeleton: path,
      skeletonLengthM: skeletonPx * cellMetres,
      lengthM: lengthPx * cellMetres,
      meanWidthM: meanWidthPx * cellMetres,
      elongation: lengthPx / meanWidthPx,
      orientationRad: principalOrientation(pixels, width, meanX, meanY),
      arcScore: arc.arcScore,
      meanBendRad: arc.meanBendRad,
      netBendRad: arc.netBendRad,
      turnConsistency: arc.turnConsistency,
      bendRadiusM: arc.bendRadiusM,
      arcStepM: arc.arcStepM,
      closedLoop: longest.closed
    };
  }

  // Segments are 8-connected components of truthy mask cells with area at
  // least minAreaM2, sorted by area descending (ties: first pixel in raster
  // order). ids are 1-based in that order, so 0 can mean "no segment" in a
  // label raster. Skeleton points and centroids are in pixel (x, y) units;
  // metric fields use cellMetres (square cells assumed).
  function extractSegments(mask, width, height, options) {
    validateMask(mask, width, height);
    options = options || {};
    var cellMetres = Number(options.cellMetres);
    if (!Number.isFinite(cellMetres) || cellMetres <= 0) {
      throw new RangeError("cellMetres must be a finite number greater than zero");
    }
    var settings = {};
    Object.keys(DEFAULT_OPTIONS).forEach(function (key) {
      settings[key] = optionNumber(options, key, DEFAULT_OPTIONS[key]);
    });
    if (settings.minAreaM2 < 0) throw new RangeError("minAreaM2 must be non-negative");
    if (settings.arcMinRadiusM <= 0 || settings.arcMaxRadiusM < settings.arcMinRadiusM) {
      throw new RangeError("arc radius band must satisfy 0 < arcMinRadiusM <= arcMaxRadiusM");
    }
    var minPixels = settings.minAreaM2 / (cellMetres * cellMetres);

    var total = width * height, visited = new Uint8Array(total), queue = new Int32Array(total);
    var found = [];
    for (var seed = 0; seed < total; seed++) {
      if (visited[seed] || !mask[seed]) continue;
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
            if (visited[next] || !mask[next]) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      if (tail < minPixels) continue;
      var pixels = Uint32Array.from(queue.subarray(0, tail)).sort();
      found.push(describeSegment(pixels, width, [x0, y0, x1, y1], cellMetres, settings));
    }
    found.sort(function (a, b) {
      return (b.pixelCount - a.pixelCount) || (a.pixels[0] - b.pixels[0]);
    });
    return found.map(function (segment, rank) {
      var out = { id: rank + 1 };
      Object.keys(segment).forEach(function (key) { out[key] = segment[key]; });
      return out;
    });
  }

  return Object.freeze({
    VERSION: VERSION,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    skeletonize: skeletonize,
    extractSegments: extractSegments
  });
}));
