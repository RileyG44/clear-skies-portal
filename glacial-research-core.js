/*
 * Clear Skies Portal — dependency-free geomorphology research primitives.
 *
 * These functions derive observations from an elevation raster. Candidate
 * scores are deliberately screening aids: they are not classifications of
 * landform origin, age, process, or chronology. All rasters are row-major and
 * north-up rows are assumed to increase southward unless rowAxis is "north".
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CSPGlacialResearch = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = 1;
  var hasOwn = function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  };
  var clamp = function (value, low, high) {
    return Math.max(low, Math.min(high, value));
  };

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  var OBSERVATIONAL_SCREENING_NOTICES = deepFreeze({
    glacialLobeMargin: {
      id: "glacial-lobe-margin-observational-screen-v1",
      observationalOnly: true,
      diagnostic: false,
      scoreIsProbability: false,
      interpretation: "High scores mark coincident topographic breaks, local relief, curvature, and ridge-or-trough position that may be useful when tracing possible margins.",
      cannotDetermine: ["glacial origin", "ice limit", "age", "advance or retreat phase", "subsurface continuity"],
      commonConfounders: ["river terraces", "fault scarps", "landslides", "shorelines", "roads", "quarries", "DEM seams", "modern earthworks"],
      corroboration: ["surficial geology", "stratigraphy", "sedimentology", "chronology", "imagery", "field observations"],
      warning: "A high score is a prompt for inspection, never evidence by itself that a glacier occupied the site."
    },
    floodChannel: {
      id: "flood-channel-observational-screen-v1",
      observationalOnly: true,
      diagnostic: false,
      scoreIsProbability: false,
      interpretation: "High scores mark multi-scale negative relief and concave cross-sectional terrain that may help find channel-like corridors.",
      cannotDetermine: ["megaflood origin", "flow direction", "discharge", "age", "event count", "sediment transport process"],
      commonConfounders: ["modern rivers", "glacial troughs", "irrigation canals", "road cuts", "landslides", "karst", "DEM seams", "data voids"],
      corroboration: ["regional gradient", "mapped deposits", "bar and scour morphology", "stratigraphy", "chronology", "imagery", "field observations"],
      warning: "A high score describes shape only; it does not establish a flood, much less a megaflood."
    }
  });

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function positiveNumber(value, name) {
    value = Number(value);
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + " must be a finite number greater than zero");
    return value;
  }

  function nonNegativeNumber(value, name) {
    value = Number(value);
    if (!Number.isFinite(value) || value < 0) throw new RangeError(name + " must be a finite non-negative number");
    return value;
  }

  function optionNumber(options, key, fallback) {
    if (!options || !hasOwn(options, key)) return fallback;
    var value = Number(options[key]);
    if (!Number.isFinite(value)) throw new TypeError(key + " must be a finite number");
    return value;
  }

  function validateRaster(grid, width, height) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new RangeError("width and height must be positive integers");
    }
    if (!grid || typeof grid.length !== "number" || grid.length < width * height) {
      throw new RangeError("grid must contain at least width times height samples");
    }
  }

  function canonicalUnit(unit) {
    var raw = String(unit || "m").trim().toLowerCase();
    if (["m", "meter", "meters", "metre", "metres"].indexOf(raw) >= 0) return "m";
    if (["ft", "foot", "feet"].indexOf(raw) >= 0) return "ft";
    if (["km", "kilometer", "kilometers", "kilometre", "kilometres"].indexOf(raw) >= 0) return "km";
    return raw;
  }

  function unitMetres(unit) {
    if (unit === "m") return 1;
    if (unit === "ft") return 0.3048;
    if (unit === "km") return 1000;
    return null;
  }

  function normalizeSpatialMetadata(options) {
    options = options || {};
    var cellSize = hasOwn(options, "cellSize") ? positiveNumber(options.cellSize, "cellSize") : 1;
    var cellSizeX = hasOwn(options, "cellSizeX") ? positiveNumber(options.cellSizeX, "cellSizeX") :
      (hasOwn(options, "resolutionX") ? positiveNumber(options.resolutionX, "resolutionX") : cellSize);
    var cellSizeY = hasOwn(options, "cellSizeY") ? positiveNumber(options.cellSizeY, "cellSizeY") :
      (hasOwn(options, "resolutionY") ? positiveNumber(options.resolutionY, "resolutionY") : cellSize);
    var horizontalUnit = canonicalUnit(options.horizontalUnit || options.xyUnit || "m");
    var verticalUnit = canonicalUnit(options.verticalUnit || options.zUnit || horizontalUnit);
    var zFactor, zFactorSource;
    if (hasOwn(options, "zFactor")) {
      zFactor = positiveNumber(options.zFactor, "zFactor");
      zFactorSource = "explicit";
    } else if (horizontalUnit === verticalUnit) {
      zFactor = 1;
      zFactorSource = "same-unit";
    } else {
      var horizontalMetres = unitMetres(horizontalUnit), verticalMetres = unitMetres(verticalUnit);
      if (horizontalMetres === null || verticalMetres === null) {
        throw new RangeError("zFactor is required when horizontal and vertical units differ and cannot be converted");
      }
      zFactor = verticalMetres / horizontalMetres;
      zFactorSource = "unit-conversion";
    }
    var rowAxis = options.rowAxis || "south";
    if (rowAxis !== "south" && rowAxis !== "north") throw new RangeError('rowAxis must be "south" or "north"');
    return deepFreeze({
      resolution: { x: cellSizeX, y: cellSizeY, unit: horizontalUnit },
      horizontalUnit: horizontalUnit,
      verticalUnit: verticalUnit,
      zFactor: zFactor,
      zFactorSource: zFactorSource,
      rowAxis: rowAxis
    });
  }

  function metadata(kind, spatial, outputUnit, details) {
    var result = {
      kind: kind,
      resolution: { x: spatial.resolution.x, y: spatial.resolution.y, unit: spatial.horizontalUnit },
      horizontalUnit: spatial.horizontalUnit,
      verticalUnit: spatial.verticalUnit,
      outputUnit: outputUnit,
      zFactor: spatial.zFactor,
      zFactorSource: spatial.zFactorSource,
      rowAxis: spatial.rowAxis,
      noDataRepresentation: "NaN"
    };
    Object.keys(details || {}).forEach(function (key) { result[key] = details[key]; });
    return deepFreeze(result);
  }

  function isNoData(value, options) {
    if (!finiteNumber(value)) return true;
    options = options || {};
    var marker = options.noData;
    if (typeof marker === "function" && marker(value)) return true;
    if (Array.isArray(marker) && marker.some(function (entry) { return Object.is(entry, value); })) return true;
    if (marker !== undefined && !Array.isArray(marker) && typeof marker !== "function" && Object.is(marker, value)) return true;
    if (finiteNumber(options.validMin) && value < options.validMin) return true;
    if (finiteNumber(options.validMax) && value > options.validMax) return true;
    return false;
  }

  function sample(grid, index, options) {
    var value = Number(grid[index]);
    return isNoData(value, options) ? NaN : value;
  }

  function radiusPair(value, name, allowZero) {
    var x, y;
    if (typeof value === "number") x = y = value;
    else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      if (value.length < 2) throw new RangeError(name + " must include x and y radii");
      x = value[0]; y = value[1];
    } else if (value && typeof value === "object") {
      x = hasOwn(value, "x") ? value.x : value.width;
      y = hasOwn(value, "y") ? value.y : value.height;
    } else throw new TypeError(name + " must be a number, [x,y], or {x,y}");
    x = Number(x); y = Number(y);
    var minimum = allowZero ? 0 : 1;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < minimum || y < minimum) {
      throw new RangeError(name + " radii must be integers greater than or equal to " + minimum);
    }
    return { x: x, y: y };
  }

  function distancePair(value, name) {
    var x, y;
    if (typeof value === "number") x = y = value;
    else if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      if (value.length < 2) throw new RangeError(name + " must include x and y distances");
      x = value[0]; y = value[1];
    } else if (value && typeof value === "object") {
      x = hasOwn(value, "x") ? value.x : value.width;
      y = hasOwn(value, "y") ? value.y : value.height;
    } else throw new TypeError(name + " must be a number, [x,y], or {x,y}");
    return { x: positiveNumber(x, name + ".x"), y: positiveNumber(y, name + ".y") };
  }

  function resolveRadius(options, spatial, fallback, cellKey, distanceKey, allowZero) {
    options = options || {};
    cellKey = cellKey || "radiusCells";
    distanceKey = distanceKey || "radius";
    if (hasOwn(options, cellKey)) return radiusPair(options[cellKey], cellKey, !!allowZero);
    if (hasOwn(options, distanceKey)) {
      var distance = distancePair(options[distanceKey], distanceKey);
      return {
        x: Math.max(allowZero ? 0 : 1, Math.ceil(distance.x / spatial.resolution.x)),
        y: Math.max(allowZero ? 0 : 1, Math.ceil(distance.y / spatial.resolution.y))
      };
    }
    return radiusPair(fallback, cellKey, !!allowZero);
  }

  function radiusMetadata(radius, spatial) {
    return {
      cells: { x: radius.x, y: radius.y },
      distance: {
        x: radius.x * spatial.resolution.x,
        y: radius.y * spatial.resolution.y,
        unit: spatial.horizontalUnit
      }
    };
  }

  /* Two summed-area tables make every rectangular neighbourhood query O(1),
     including windows containing NaN/no-data samples. */
  function buildIntegral(grid, width, height, options) {
    var stride = width + 1;
    var sums = new Float64Array((width + 1) * (height + 1));
    var counts = new Uint32Array((width + 1) * (height + 1));
    for (var y = 0; y < height; y++) {
      var rowSum = 0, rowCount = 0;
      for (var x = 0; x < width; x++) {
        var value = sample(grid, y * width + x, options);
        if (Number.isFinite(value)) { rowSum += value; rowCount++; }
        var target = (y + 1) * stride + x + 1;
        sums[target] = sums[y * stride + x + 1] + rowSum;
        counts[target] = counts[y * stride + x + 1] + rowCount;
      }
    }
    return { sums: sums, counts: counts, stride: stride };
  }

  function rectangleStats(integral, x0, y0, x1, y1) {
    var stride = integral.stride;
    var a = y0 * stride + x0, b = y0 * stride + x1;
    var c = y1 * stride + x0, d = y1 * stride + x1;
    return {
      sum: integral.sums[d] - integral.sums[b] - integral.sums[c] + integral.sums[a],
      count: integral.counts[d] - integral.counts[b] - integral.counts[c] + integral.counts[a],
      area: (x1 - x0) * (y1 - y0)
    };
  }

  function windowBounds(x, y, radius, width, height) {
    return {
      x0: Math.max(0, x - radius.x), y0: Math.max(0, y - radius.y),
      x1: Math.min(width, x + radius.x + 1), y1: Math.min(height, y + radius.y + 1),
      complete: x - radius.x >= 0 && y - radius.y >= 0 && x + radius.x < width && y + radius.y < height
    };
  }

  function neighbourhoodPolicy(options) {
    options = options || {};
    var edgePolicy = options.edgePolicy || "shrink";
    if (edgePolicy !== "shrink" && edgePolicy !== "nodata") throw new RangeError('edgePolicy must be "shrink" or "nodata"');
    var minValidFraction = optionNumber(options, "minValidFraction", 0.5);
    if (minValidFraction < 0 || minValidFraction > 1) throw new RangeError("minValidFraction must be between zero and one");
    var minSamples = hasOwn(options, "minSamples") ? Math.ceil(nonNegativeNumber(options.minSamples, "minSamples")) : 1;
    return { edgePolicy: edgePolicy, minValidFraction: minValidFraction, minSamples: minSamples };
  }

  function calculateLocalRelief(grid, width, height, options, spatial, integral, radius) {
    var policy = neighbourhoodPolicy(options), length = width * height;
    var residual = new Float32Array(length), baseline = new Float32Array(length);
    residual.fill(NaN); baseline.fill(NaN);
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
      var index = y * width + x, center = sample(grid, index, options);
      if (!Number.isFinite(center)) continue;
      var bounds = windowBounds(x, y, radius, width, height);
      if (policy.edgePolicy === "nodata" && !bounds.complete) continue;
      var stats = rectangleStats(integral, bounds.x0, bounds.y0, bounds.x1, bounds.y1);
      if (stats.count < policy.minSamples || stats.count / stats.area < policy.minValidFraction) continue;
      var mean = stats.sum / stats.count;
      baseline[index] = mean;
      residual[index] = center - mean;
    }
    return { data: residual, baseline: baseline };
  }

  function localReliefModel(grid, width, height, options) {
    options = options || {};
    validateRaster(grid, width, height);
    var spatial = normalizeSpatialMetadata(options);
    var radius = resolveRadius(options, spatial, 3);
    var result = calculateLocalRelief(grid, width, height, options, spatial,
      buildIntegral(grid, width, height, options), radius);
    return {
      data: result.data,
      baseline: result.baseline,
      width: width,
      height: height,
      metadata: metadata("local-relief-model", spatial, spatial.verticalUnit, {
        algorithm: "elevation minus no-data-aware rectangular box mean",
        radius: radiusMetadata(radius, spatial),
        edgePolicy: (options.edgePolicy || "shrink"),
        minValidFraction: optionNumber(options, "minValidFraction", 0.5),
        signConvention: "positive is above the local mean; negative is below it"
      })
    };
  }

  function terrainPositionIndex(grid, width, height, options) {
    options = options || {};
    validateRaster(grid, width, height);
    var spatial = normalizeSpatialMetadata(options);
    var outer = resolveRadius(options, spatial, 3);
    var inner = resolveRadius(options, spatial, 0, "innerRadiusCells", "innerRadius", true);
    if (inner.x > outer.x || inner.y > outer.y || (inner.x === outer.x && inner.y === outer.y)) {
      throw new RangeError("innerRadiusCells must leave a non-empty box annulus inside radiusCells");
    }
    var policy = neighbourhoodPolicy(options), integral = buildIntegral(grid, width, height, options);
    var output = new Float32Array(width * height); output.fill(NaN);
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
      var index = y * width + x, center = sample(grid, index, options);
      if (!Number.isFinite(center)) continue;
      var outerBounds = windowBounds(x, y, outer, width, height);
      var innerBounds = windowBounds(x, y, inner, width, height);
      if (policy.edgePolicy === "nodata" && (!outerBounds.complete || !innerBounds.complete)) continue;
      var outside = rectangleStats(integral, outerBounds.x0, outerBounds.y0, outerBounds.x1, outerBounds.y1);
      var inside = rectangleStats(integral, innerBounds.x0, innerBounds.y0, innerBounds.x1, innerBounds.y1);
      var count = outside.count - inside.count;
      var area = outside.area - inside.area;
      if (count < policy.minSamples || area <= 0 || count / area < policy.minValidFraction) continue;
      output[index] = center - (outside.sum - inside.sum) / count;
    }
    return {
      data: output, width: width, height: height,
      metadata: metadata("terrain-position-index", spatial, spatial.verticalUnit, {
        algorithm: "center elevation minus mean of a no-data-aware rectangular box annulus",
        outerRadius: radiusMetadata(outer, spatial),
        excludedInnerRadius: radiusMetadata(inner, spatial),
        edgePolicy: options.edgePolicy || "shrink",
        minValidFraction: optionNumber(options, "minValidFraction", 0.5),
        signConvention: "positive is locally high; negative is locally low"
      })
    };
  }

  function terrainRuggednessIndex(grid, width, height, options) {
    options = options || {};
    validateRaster(grid, width, height);
    var spatial = normalizeSpatialMetadata(options);
    var radius = resolveRadius(options, spatial, 1);
    var method = options.method || "riley";
    if (["riley", "root-mean-square", "mean-absolute"].indexOf(method) < 0) {
      throw new RangeError('method must be "riley", "root-mean-square", or "mean-absolute"');
    }
    var fullNeighbours = (2 * radius.x + 1) * (2 * radius.y + 1) - 1;
    var minNeighbours = hasOwn(options, "minNeighbors") ?
      Math.ceil(nonNegativeNumber(options.minNeighbors, "minNeighbors")) : fullNeighbours;
    if (minNeighbours > fullNeighbours) throw new RangeError("minNeighbors exceeds the neighbourhood size");
    var output = new Float32Array(width * height); output.fill(NaN);
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
      var index = y * width + x, center = sample(grid, index, options);
      if (!Number.isFinite(center)) continue;
      var sumSquares = 0, sumAbsolute = 0, count = 0;
      for (var oy = -radius.y; oy <= radius.y; oy++) for (var ox = -radius.x; ox <= radius.x; ox++) {
        if (ox === 0 && oy === 0) continue;
        var sx = x + ox, sy = y + oy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        var neighbour = sample(grid, sy * width + sx, options);
        if (!Number.isFinite(neighbour)) continue;
        var difference = center - neighbour;
        sumSquares += difference * difference;
        sumAbsolute += Math.abs(difference);
        count++;
      }
      if (count < minNeighbours || count === 0) continue;
      output[index] = method === "riley" ? Math.sqrt(sumSquares) :
        (method === "root-mean-square" ? Math.sqrt(sumSquares / count) : sumAbsolute / count);
    }
    return {
      data: output, width: width, height: height,
      metadata: metadata("terrain-ruggedness-index", spatial, spatial.verticalUnit, {
        method: method,
        radius: radiusMetadata(radius, spatial),
        minimumValidNeighbours: minNeighbours,
        comparabilityWarning: method === "riley" ?
          "Riley TRI grows with neighbour count; keep radius and valid-neighbour policy fixed when comparing rasters." :
          "Keep radius and sampling resolution fixed when comparing rasters."
      })
    };
  }

  function quantileSorted(sorted, probability) {
    if (!sorted.length) return NaN;
    probability = clamp(probability, 0, 1);
    var position = probability * (sorted.length - 1);
    var lower = Math.floor(position), upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    var fraction = position - lower;
    return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
  }

  function finiteValues(data) {
    var values = [];
    for (var i = 0; i < data.length; i++) if (Number.isFinite(data[i])) values.push(Number(data[i]));
    return values;
  }

  function robustLocationScale(data) {
    var values = finiteValues(data).sort(function (a, b) { return a - b; });
    if (!values.length) return { center: NaN, scale: NaN, method: "none", count: 0 };
    var median = quantileSorted(values, 0.5);
    var deviations = values.map(function (value) { return Math.abs(value - median); }).sort(function (a, b) { return a - b; });
    var madScale = 1.4826 * quantileSorted(deviations, 0.5);
    if (madScale > Number.EPSILON) return { center: median, scale: madScale, method: "median/MAD", count: values.length };
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    var mean = sum / values.length, sumSquares = 0;
    for (var j = 0; j < values.length; j++) sumSquares += Math.pow(values[j] - mean, 2);
    var standardDeviation = Math.sqrt(sumSquares / values.length);
    return { center: mean, scale: standardDeviation, method: standardDeviation > Number.EPSILON ? "mean/standard-deviation-fallback" : "constant", count: values.length };
  }

  function scaleDefinition(scale, spatial) {
    if (typeof scale === "number" || Array.isArray(scale) || ArrayBuffer.isView(scale)) {
      return radiusPair(scale, "scales[]", false);
    }
    if (!scale || typeof scale !== "object") throw new TypeError("each scale must define radiusCells or radius");
    return resolveRadius(scale, spatial, 1);
  }

  function multiScaleResidualAnalysis(grid, width, height, options) {
    options = options || {};
    validateRaster(grid, width, height);
    var spatial = normalizeSpatialMetadata(options);
    var definitions = options.scales || [2, 4, 8];
    if (!Array.isArray(definitions) || !definitions.length) throw new RangeError("scales must be a non-empty array");
    var radii = definitions.map(function (scale) { return scaleDefinition(scale, spatial); });
    var integral = buildIntegral(grid, width, height, options), length = width * height;
    var residuals = radii.map(function (radius) {
      var calculated = calculateLocalRelief(grid, width, height, options, spatial, integral, radius);
      var normalization = robustLocationScale(calculated.data);
      return {
        data: calculated.data,
        radius: deepFreeze(radiusMetadata(radius, spatial)),
        normalization: deepFreeze(normalization)
      };
    });
    var anomaly = new Float32Array(length), magnitude = new Float32Array(length);
    var dominantScaleIndex = new Int16Array(length), dominantRadius = new Float32Array(length);
    anomaly.fill(NaN); magnitude.fill(NaN); dominantScaleIndex.fill(-1); dominantRadius.fill(NaN);
    for (var index = 0; index < length; index++) {
      var best = NaN, bestMagnitude = -1, bestIndex = -1;
      for (var scaleIndex = 0; scaleIndex < residuals.length; scaleIndex++) {
        var residual = residuals[scaleIndex].data[index], normalization = residuals[scaleIndex].normalization;
        if (!Number.isFinite(residual)) continue;
        var standardized = normalization.scale > Number.EPSILON ?
          (residual - normalization.center) / normalization.scale : 0;
        if (Math.abs(standardized) > bestMagnitude) {
          best = standardized; bestMagnitude = Math.abs(standardized); bestIndex = scaleIndex;
        }
      }
      if (bestIndex < 0) continue;
      anomaly[index] = best; magnitude[index] = bestMagnitude; dominantScaleIndex[index] = bestIndex;
      var radius = radii[bestIndex];
      dominantRadius[index] = Math.sqrt(radius.x * spatial.resolution.x * radius.y * spatial.resolution.y);
    }
    return {
      residuals: residuals,
      anomaly: anomaly,
      magnitude: magnitude,
      dominantScaleIndex: dominantScaleIndex,
      dominantRadius: dominantRadius,
      width: width, height: height,
      metadata: metadata("multi-scale-local-relief-anomaly", spatial, "standard deviations", {
        residualOutputUnit: spatial.verticalUnit,
        dominantRadiusOutputUnit: spatial.horizontalUnit,
        normalization: "per-scale robust median/MAD, with standard-deviation fallback for zero MAD",
        composite: "signed standardized residual with the greatest absolute magnitude at each pixel",
        caution: "Scores are relative to this raster and scale set; they are not probabilities and should not be compared across differently sampled rasters without calibration."
      })
    };
  }

  function neighbourSample(grid, width, height, x, y, options) {
    if (x < 0 || y < 0 || x >= width || y >= height) return NaN;
    return sample(grid, y * width + x, options);
  }

  function firstDerivative(negative, center, positive, spacing) {
    if (Number.isFinite(negative) && Number.isFinite(positive)) return (positive - negative) / (2 * spacing);
    if (Number.isFinite(positive)) return (positive - center) / spacing;
    if (Number.isFinite(negative)) return (center - negative) / spacing;
    return NaN;
  }

  function slopeAspectComponents(grid, width, height, options) {
    options = options || {};
    validateRaster(grid, width, height);
    var spatial = normalizeSpatialMetadata(options), length = width * height;
    var slopeRadians = new Float32Array(length), slopeDegrees = new Float32Array(length), aspectDegrees = new Float32Array(length);
    var northness = new Float32Array(length), eastness = new Float32Array(length);
    var slopeWeightedNorthness = new Float32Array(length), slopeWeightedEastness = new Float32Array(length);
    slopeRadians.fill(NaN); slopeDegrees.fill(NaN); aspectDegrees.fill(NaN);
    northness.fill(NaN); eastness.fill(NaN); slopeWeightedNorthness.fill(NaN); slopeWeightedEastness.fill(NaN);
    var flatThreshold = optionNumber(options, "flatThreshold", 1e-12);
    if (flatThreshold < 0) throw new RangeError("flatThreshold must be non-negative");
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
      var index = y * width + x, center = sample(grid, index, options);
      if (!Number.isFinite(center)) continue;
      var p = firstDerivative(neighbourSample(grid, width, height, x - 1, y, options), center,
        neighbourSample(grid, width, height, x + 1, y, options), spatial.resolution.x);
      var qRows = firstDerivative(neighbourSample(grid, width, height, x, y - 1, options), center,
        neighbourSample(grid, width, height, x, y + 1, options), spatial.resolution.y);
      if (!Number.isFinite(p) || !Number.isFinite(qRows)) continue;
      p *= spatial.zFactor; qRows *= spatial.zFactor;
      var grade = Math.hypot(p, qRows), slope = Math.atan(grade);
      slopeRadians[index] = slope; slopeDegrees[index] = slope * 180 / Math.PI;
      if (grade <= flatThreshold) {
        slopeWeightedNorthness[index] = 0; slopeWeightedEastness[index] = 0;
        continue;
      }
      var northDerivative = spatial.rowAxis === "south" ? -qRows : qRows;
      var aspect = ((Math.atan2(-p, -northDerivative) * 180 / Math.PI) % 360 + 360) % 360;
      var radians = aspect * Math.PI / 180;
      aspectDegrees[index] = aspect;
      northness[index] = Math.cos(radians); eastness[index] = Math.sin(radians);
      slopeWeightedNorthness[index] = Math.sin(slope) * northness[index];
      slopeWeightedEastness[index] = Math.sin(slope) * eastness[index];
    }
    return {
      slopeRadians: slopeRadians,
      slopeDegrees: slopeDegrees,
      aspectDegrees: aspectDegrees,
      northness: northness,
      eastness: eastness,
      slopeWeightedNorthness: slopeWeightedNorthness,
      slopeWeightedEastness: slopeWeightedEastness,
      width: width, height: height,
      metadata: metadata("finite-difference-slope-aspect-components", spatial, "mixed; see outputs", {
        derivative: "central difference with one-sided finite fallback at edges or beside no-data",
        slopeUnit: "degrees and radians",
        aspectConvention: "downslope compass bearing clockwise from north",
        northnessConvention: "cos(aspect); +1 north-facing and -1 south-facing",
        eastnessConvention: "sin(aspect); +1 east-facing and -1 west-facing",
        flatConvention: "aspect, northness, and eastness are NaN on flats; slope-weighted components are zero"
      })
    };
  }

  function finiteDifferenceCurvature(grid, width, height, options) {
    options = options || {};
    validateRaster(grid, width, height);
    var spatial = normalizeSpatialMetadata(options), length = width * height;
    var profile = new Float32Array(length), plan = new Float32Array(length), laplacian = new Float32Array(length);
    var eastWest = new Float32Array(length), northSouth = new Float32Array(length), cross = new Float32Array(length);
    [profile, plan, laplacian, eastWest, northSouth, cross].forEach(function (array) { array.fill(NaN); });
    var flatThreshold = optionNumber(options, "flatThreshold", 1e-12);
    if (flatThreshold < 0) throw new RangeError("flatThreshold must be non-negative");
    var dx = spatial.resolution.x, dy = spatial.resolution.y;
    for (var y = 1; y < height - 1; y++) for (var x = 1; x < width - 1; x++) {
      var index = y * width + x;
      var c = sample(grid, index, options), w = sample(grid, index - 1, options), e = sample(grid, index + 1, options);
      var n = sample(grid, index - width, options), s = sample(grid, index + width, options);
      var nw = sample(grid, index - width - 1, options), ne = sample(grid, index - width + 1, options);
      var sw = sample(grid, index + width - 1, options), se = sample(grid, index + width + 1, options);
      if (![c, w, e, n, s, nw, ne, sw, se].every(Number.isFinite)) continue;
      var p = (e - w) / (2 * dx) * spatial.zFactor;
      var q = (s - n) / (2 * dy) * spatial.zFactor;
      var r = (e - 2 * c + w) / (dx * dx) * spatial.zFactor;
      var t = (s - 2 * c + n) / (dy * dy) * spatial.zFactor;
      var mixed = (se - sw - ne + nw) / (4 * dx * dy) * spatial.zFactor;
      eastWest[index] = r; northSouth[index] = t; cross[index] = mixed; laplacian[index] = r + t;
      var gradientSquared = p * p + q * q;
      if (gradientSquared <= flatThreshold * flatThreshold) continue;
      /* Directional second derivatives of z: along the horizontal gradient
         (profile direction) and perpendicular to it (plan/contour direction).
         These are intentionally not labelled as one of several competing
         normalized curvature conventions. */
      profile[index] = (r * p * p + 2 * mixed * p * q + t * q * q) / gradientSquared;
      plan[index] = (r * q * q - 2 * mixed * p * q + t * p * p) / gradientSquared;
    }
    return {
      profileSecondDerivative: profile,
      planSecondDerivative: plan,
      laplacian: laplacian,
      eastWestSecondDerivative: eastWest,
      northSouthSecondDerivative: northSouth,
      crossDerivative: cross,
      width: width, height: height,
      metadata: metadata("finite-difference-directional-curvature", spatial,
        "inverse " + spatial.horizontalUnit, {
          algorithm: "three-by-three central finite differences",
          profileDefinition: "directional second derivative along the horizontal elevation gradient",
          planDefinition: "directional second derivative perpendicular to the horizontal elevation gradient",
          laplacianDefinition: "east-west plus north-south second derivatives",
          signConvention: "positive is locally concave-up and negative is locally convex-up",
          flatConvention: "directional profile and plan outputs are NaN where gradient direction is undefined; Laplacian remains defined",
          caution: "Curvature magnitude depends strongly on DEM resolution, smoothing, vertical datum, and noise."
        })
    };
  }

  function hypsometricStatistics(grid, options) {
    options = options || {};
    if (!grid || typeof grid.length !== "number") throw new TypeError("grid must be an array-like elevation raster");
    var spatial = normalizeSpatialMetadata(options), values = [];
    var sum = 0, compensation = 0;
    for (var i = 0; i < grid.length; i++) {
      var value = sample(grid, i, options);
      if (!Number.isFinite(value)) continue;
      values.push(value);
      var adjusted = value - compensation, next = sum + adjusted;
      compensation = (next - sum) - adjusted; sum = next;
    }
    values.sort(function (a, b) { return a - b; });
    var count = values.length, noDataCount = grid.length - count;
    if (!count) return {
      count: 0, noDataCount: noDataCount, noDataFraction: grid.length ? noDataCount / grid.length : 0,
      min: NaN, max: NaN, relief: NaN, mean: NaN, median: NaN, standardDeviation: NaN,
      quantiles: {}, hypsometricIntegral: null, curve: [],
      metadata: metadata("hypsometric-statistics", spatial, spatial.verticalUnit, {
        areaAssumption: "each valid raster cell has equal area"
      })
    };
    var mean = sum / count, sumSquares = 0;
    for (var j = 0; j < count; j++) sumSquares += Math.pow(values[j] - mean, 2);
    var min = values[0], max = values[count - 1], relief = max - min;
    var curvePoints = hasOwn(options, "curvePoints") ? Math.floor(positiveNumber(options.curvePoints, "curvePoints")) : 21;
    if (curvePoints < 2) throw new RangeError("curvePoints must be at least two");
    var curve = [];
    for (var point = 0; point < curvePoints; point++) {
      var relativeArea = point / (curvePoints - 1);
      var elevation = quantileSorted(values, 1 - relativeArea);
      curve.push({
        relativeArea: relativeArea,
        relativeElevation: relief > 0 ? (elevation - min) / relief : 0,
        elevation: elevation
      });
    }
    return {
      count: count,
      noDataCount: noDataCount,
      noDataFraction: grid.length ? noDataCount / grid.length : 0,
      min: min, max: max, relief: relief, mean: mean,
      median: quantileSorted(values, 0.5),
      standardDeviation: Math.sqrt(sumSquares / count),
      quantiles: {
        p05: quantileSorted(values, 0.05), p25: quantileSorted(values, 0.25),
        p50: quantileSorted(values, 0.5), p75: quantileSorted(values, 0.75), p95: quantileSorted(values, 0.95)
      },
      hypsometricIntegral: relief > 0 ? (mean - min) / relief : null,
      curve: curve,
      metadata: metadata("hypsometric-statistics", spatial, spatial.verticalUnit, {
        areaAssumption: "each valid raster cell has equal area",
        curveConvention: "relative area above elevation, from the maximum at area zero to the minimum at area one",
        caution: "Use an equal-area grid or explicit area weighting before interpreting basin-scale area fractions. This function does not delineate a watershed."
      })
    };
  }

  function normalizedFeature(data, transform, probability) {
    var transformed = new Float32Array(data.length); transformed.fill(NaN);
    var finite = [];
    for (var i = 0; i < data.length; i++) if (Number.isFinite(data[i])) {
      var value = Math.max(0, transform(data[i]));
      transformed[i] = value; finite.push(value);
    }
    finite.sort(function (a, b) { return a - b; });
    var scale = finite.length ? quantileSorted(finite, probability || 0.9) : NaN;
    if (!(scale > Number.EPSILON) && finite.length) scale = finite[finite.length - 1];
    for (var j = 0; j < transformed.length; j++) if (Number.isFinite(transformed[j])) {
      transformed[j] = scale > Number.EPSILON ? clamp(transformed[j] / scale, 0, 1) : 0;
    }
    return { data: transformed, scale: scale };
  }

  function combineFeatures(sourceGrid, features, weights, threshold, options) {
    var score = new Float32Array(sourceGrid.length), mask = new Uint8Array(sourceGrid.length);
    score.fill(NaN);
    var minFeatureCount = hasOwn(options, "minFeatureCount") ?
      Math.ceil(positiveNumber(options.minFeatureCount, "minFeatureCount")) : Math.min(2, features.length);
    for (var index = 0; index < sourceGrid.length; index++) {
      if (isNoData(Number(sourceGrid[index]), options)) continue;
      var weighted = 0, weightSum = 0, count = 0;
      for (var feature = 0; feature < features.length; feature++) {
        var value = features[feature][index];
        if (!Number.isFinite(value)) continue;
        weighted += weights[feature] * value; weightSum += weights[feature]; count++;
      }
      if (count < minFeatureCount || weightSum <= 0) continue;
      score[index] = weighted / weightSum;
      mask[index] = score[index] >= threshold ? 1 : 0;
    }
    return { score: score, mask: mask };
  }

  function scoreGlacialLobeMarginCandidates(grid, width, height, options) {
    options = options || {};
    validateRaster(grid, width, height);
    var spatial = normalizeSpatialMetadata(options);
    var radius = hasOwn(options, "radiusCells") || hasOwn(options, "radius") ?
      resolveRadius(options, spatial, 5) : radiusPair(hasOwn(options, "marginRadiusCells") ? options.marginRadiusCells : 5, "marginRadiusCells", false);
    var layerOptions = Object.assign({}, options, { radiusCells: radius });
    var relief = localReliefModel(grid, width, height, layerOptions);
    var tpi = terrainPositionIndex(grid, width, height, layerOptions);
    var slope = slopeAspectComponents(grid, width, height, options);
    var curvature = finiteDifferenceCurvature(grid, width, height, options);
    var reliefStrength = normalizedFeature(relief.data, Math.abs, 0.9);
    var positionStrength = normalizedFeature(tpi.data, function (value) {
      return Math.max(value, 0) + 0.35 * Math.max(-value, 0);
    }, 0.9);
    var slopeStrength = normalizedFeature(slope.slopeRadians, function (value) { return Math.sin(value); }, 0.9);
    var breakStrength = normalizedFeature(curvature.laplacian, Math.abs, 0.9);
    var threshold = optionNumber(options, "threshold", 0.58);
    if (threshold < 0 || threshold > 1) throw new RangeError("threshold must be between zero and one");
    var combined = combineFeatures(grid,
      [breakStrength.data, positionStrength.data, reliefStrength.data, slopeStrength.data],
      [0.30, 0.25, 0.25, 0.20], threshold, options);
    return {
      score: combined.score, mask: combined.mask, width: width, height: height,
      evidence: {
        localRelief: relief.data, terrainPosition: tpi.data, slopeRadians: slope.slopeRadians,
        laplacian: curvature.laplacian,
        normalized: {
          topographicBreak: breakStrength.data, ridgeOrTroughPosition: positionStrength.data,
          localRelief: reliefStrength.data, slope: slopeStrength.data
        }
      },
      metadata: metadata("glacial-lobe-margin-candidate-score", spatial, "unitless 0 to 1", {
        threshold: threshold,
        neighbourhoodRadius: radiusMetadata(radius, spatial),
        weights: { topographicBreak: 0.30, ridgeOrTroughPosition: 0.25, localRelief: 0.25, slope: 0.20 },
        normalization: "each feature is scaled to a within-raster robust upper quantile; scores are not comparable across rasters without calibration",
        screeningNotice: OBSERVATIONAL_SCREENING_NOTICES.glacialLobeMargin
      })
    };
  }

  function scoreFloodChannelCandidates(grid, width, height, options) {
    options = options || {};
    validateRaster(grid, width, height);
    var spatial = normalizeSpatialMetadata(options);
    var radius = hasOwn(options, "radiusCells") || hasOwn(options, "radius") ?
      resolveRadius(options, spatial, 5) : radiusPair(hasOwn(options, "channelRadiusCells") ? options.channelRadiusCells : 5, "channelRadiusCells", false);
    var layerOptions = Object.assign({}, options, { radiusCells: radius });
    var relief = localReliefModel(grid, width, height, layerOptions);
    var tpi = terrainPositionIndex(grid, width, height, layerOptions);
    var curvature = finiteDifferenceCurvature(grid, width, height, options);
    var negativeRelief = normalizedFeature(relief.data, function (value) { return -value; }, 0.9);
    var negativePosition = normalizedFeature(tpi.data, function (value) { return -value; }, 0.9);
    var crossSectionConcavity = new Float32Array(width * height); crossSectionConcavity.fill(NaN);
    for (var i = 0; i < crossSectionConcavity.length; i++) {
      var plan = curvature.planSecondDerivative[i], laplacian = curvature.laplacian[i];
      if (Number.isFinite(plan)) crossSectionConcavity[i] = Math.max(0, plan);
      else if (Number.isFinite(laplacian)) crossSectionConcavity[i] = Math.max(0, laplacian);
    }
    var concavity = normalizedFeature(crossSectionConcavity, function (value) { return value; }, 0.9);
    var threshold = optionNumber(options, "threshold", 0.58);
    if (threshold < 0 || threshold > 1) throw new RangeError("threshold must be between zero and one");
    var combined = combineFeatures(grid,
      [negativeRelief.data, negativePosition.data, concavity.data],
      [0.40, 0.35, 0.25], threshold, options);
    return {
      score: combined.score, mask: combined.mask, width: width, height: height,
      evidence: {
        localRelief: relief.data, terrainPosition: tpi.data,
        planSecondDerivative: curvature.planSecondDerivative, laplacian: curvature.laplacian,
        normalized: {
          negativeLocalRelief: negativeRelief.data,
          negativeTerrainPosition: negativePosition.data,
          crossSectionConcavity: concavity.data
        }
      },
      metadata: metadata("flood-channel-candidate-score", spatial, "unitless 0 to 1", {
        threshold: threshold,
        neighbourhoodRadius: radiusMetadata(radius, spatial),
        weights: { negativeLocalRelief: 0.40, negativeTerrainPosition: 0.35, crossSectionConcavity: 0.25 },
        normalization: "each feature is scaled to a within-raster robust upper quantile; scores are not comparable across rasters without calibration",
        screeningNotice: OBSERVATIONAL_SCREENING_NOTICES.floodChannel
      })
    };
  }

  return Object.freeze({
    VERSION: VERSION,
    OBSERVATIONAL_SCREENING_NOTICES: OBSERVATIONAL_SCREENING_NOTICES,
    normalizeSpatialMetadata: normalizeSpatialMetadata,
    localReliefModel: localReliefModel,
    terrainPositionIndex: terrainPositionIndex,
    terrainRuggednessIndex: terrainRuggednessIndex,
    multiScaleResidualAnalysis: multiScaleResidualAnalysis,
    slopeAspectComponents: slopeAspectComponents,
    finiteDifferenceCurvature: finiteDifferenceCurvature,
    hypsometricStatistics: hypsometricStatistics,
    scoreGlacialLobeMarginCandidates: scoreGlacialLobeMarginCandidates,
    scoreFloodChannelCandidates: scoreFloodChannelCandidates
  });
}));
