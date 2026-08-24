/*
 * Clear Skies elevation tile decoding and resampling primitives.
 *
 * Terrarium is a base-256 packed elevation encoding.  Interpolating its RGB
 * bytes corrupts elevations whenever a byte carries (for example -1 m to
 * 0 m).  This module therefore always decodes a complete source tile to
 * Float32 elevations before applying a crop or overzoom resample.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.ElevationTileCore = factory();
}(typeof globalThis !== "undefined" ? globalThis :
  (typeof self !== "undefined" ? self : this), function () {
  "use strict";

  var VERSION = 1;

  function positiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(name + " must be a positive integer");
    }
    return value;
  }

  function rasterLength(data, width, height, channels, name) {
    positiveInteger(width, "width");
    positiveInteger(height, "height");
    if (!data || typeof data.length !== "number" || data.length < width * height * channels) {
      throw new RangeError(name + " must contain at least width * height * " + channels + " values");
    }
  }

  function decodeTerrariumValue(red, green, blue) {
    return Number(red) * 256 + Number(green) + Number(blue) / 256 - 32768;
  }

  /* Alpha zero is no-data. Any non-zero alpha is a valid Terrarium sample. */
  function decodeTerrarium(rgba, width, height) {
    rasterLength(rgba, width, height, 4, "rgba");
    var count = width * height;
    var elevations = new Float32Array(count);
    for (var i = 0, offset = 0; i < count; i++, offset += 4) {
      elevations[i] = Number(rgba[offset + 3]) === 0 ? NaN :
        decodeTerrariumValue(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    }
    return elevations;
  }

  function firstDefined(object, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      if (object[keys[i]] !== undefined) return object[keys[i]];
    }
    return fallback;
  }

  /* Crop coordinates are source pixel-edge coordinates: {x,y,width,height}.
     Arrays [x,y,width,height], {sx,sy,sw,sh}, {left,top,right,bottom}, and
     {x0,y0,x1,y1} are accepted for integration convenience. */
  function normalizeCrop(crop, sourceWidth, sourceHeight) {
    if (crop === null || crop === undefined) {
      return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
    }
    var x, y, width, height;
    if (Array.isArray(crop) || ArrayBuffer.isView(crop)) {
      if (crop.length < 4) throw new RangeError("crop array must be [x, y, width, height]");
      x = crop[0]; y = crop[1]; width = crop[2]; height = crop[3];
    } else if (typeof crop === "object") {
      x = firstDefined(crop, ["x", "sx", "left", "x0"], 0);
      y = firstDefined(crop, ["y", "sy", "top", "y0"], 0);
      width = firstDefined(crop, ["width", "w", "sw"], undefined);
      height = firstDefined(crop, ["height", "h", "sh"], undefined);
      if (width === undefined) {
        var right = firstDefined(crop, ["right", "x1"], undefined);
        if (right !== undefined) width = Number(right) - Number(x);
      }
      if (height === undefined) {
        var bottom = firstDefined(crop, ["bottom", "y1"], undefined);
        if (bottom !== undefined) height = Number(bottom) - Number(y);
      }
    } else {
      throw new TypeError("crop must be an object, an array, or null");
    }
    x = Number(x); y = Number(y); width = Number(width); height = Number(height);
    if (![x, y, width, height].every(Number.isFinite)) {
      throw new TypeError("crop coordinates must be finite numbers");
    }
    if (width <= 0 || height <= 0) {
      throw new RangeError("crop width and height must be greater than zero");
    }
    return { x: x, y: y, width: width, height: height };
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function makeAxisSamples(outputSize, cropStart, cropSize, sourceSize) {
    var lower = new Int32Array(outputSize);
    var upper = new Int32Array(outputSize);
    var lowerWeight = new Float64Array(outputSize);
    var upperWeight = new Float64Array(outputSize);
    var sourceMax = sourceSize - 1;
    for (var target = 0; target < outputSize; target++) {
      /* Align pixel centres while treating crop coordinates as pixel edges. */
      var coordinate = cropStart + (target + 0.5) * cropSize / outputSize - 0.5;
      coordinate = clamp(coordinate, 0, sourceMax);
      var first = Math.floor(coordinate);
      var second = Math.min(first + 1, sourceMax);
      var fraction = coordinate - first;
      lower[target] = first;
      upper[target] = second;
      lowerWeight[target] = 1 - fraction;
      upperWeight[target] = fraction;
    }
    return { lower: lower, upper: upper, lowerWeight: lowerWeight, upperWeight: upperWeight };
  }

  /*
   * Bilinear float resampling with no-data-aware weight renormalization.
   * `source` is never mutated. NaN and infinities are no-data. If all samples
   * carrying non-zero weight are no-data, the destination sample remains NaN.
   */
  function resampleElevation(source, sourceWidth, sourceHeight, crop, destinationWidth, destinationHeight) {
    rasterLength(source, sourceWidth, sourceHeight, 1, "source");
    var area = normalizeCrop(crop, sourceWidth, sourceHeight);
    if (destinationWidth === undefined) destinationWidth = Math.max(1, Math.round(area.width));
    if (destinationHeight === undefined) destinationHeight = Math.max(1, Math.round(area.height));
    positiveInteger(destinationWidth, "destinationWidth");
    positiveInteger(destinationHeight, "destinationHeight");

    var xs = makeAxisSamples(destinationWidth, area.x, area.width, sourceWidth);
    var ys = makeAxisSamples(destinationHeight, area.y, area.height, sourceHeight);
    var output = new Float32Array(destinationWidth * destinationHeight);
    for (var targetY = 0; targetY < destinationHeight; targetY++) {
      var y0 = ys.lower[targetY], y1 = ys.upper[targetY];
      var wy0 = ys.lowerWeight[targetY], wy1 = ys.upperWeight[targetY];
      var row0 = y0 * sourceWidth, row1 = y1 * sourceWidth;
      for (var targetX = 0; targetX < destinationWidth; targetX++) {
        var x0 = xs.lower[targetX], x1 = xs.upper[targetX];
        var wx0 = xs.lowerWeight[targetX], wx1 = xs.upperWeight[targetX];
        var weightedValue = 0, validWeight = 0, value, weight;
        weight = wx0 * wy0; value = source[row0 + x0];
        if (weight > 0 && Number.isFinite(value)) { weightedValue += value * weight; validWeight += weight; }
        weight = wx1 * wy0; value = source[row0 + x1];
        if (weight > 0 && Number.isFinite(value)) { weightedValue += value * weight; validWeight += weight; }
        weight = wx0 * wy1; value = source[row1 + x0];
        if (weight > 0 && Number.isFinite(value)) { weightedValue += value * weight; validWeight += weight; }
        weight = wx1 * wy1; value = source[row1 + x1];
        if (weight > 0 && Number.isFinite(value)) { weightedValue += value * weight; validWeight += weight; }
        output[targetY * destinationWidth + targetX] = validWeight > 0 ? weightedValue / validWeight : NaN;
      }
    }
    return output;
  }

  function decodeTerrariumCrop(rgba, width, height, crop, destinationWidth, destinationHeight) {
    /* Keep this deliberately two-stage. Replacing it with byte-image cropping
       or browser image smoothing reintroduces base-256 carry artefacts. */
    var elevations = decodeTerrarium(rgba, width, height);
    return resampleElevation(elevations, width, height, crop, destinationWidth, destinationHeight);
  }

  return Object.freeze({
    VERSION: VERSION,
    decodeTerrariumValue: decodeTerrariumValue,
    decodeTerrarium: decodeTerrarium,
    normalizeCrop: normalizeCrop,
    normaliseCrop: normalizeCrop,
    resampleElevation: resampleElevation,
    decodeTerrariumCrop: decodeTerrariumCrop
  });
}));
