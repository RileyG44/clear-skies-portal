/*
 * Clear Skies elevation-band model and renderer.
 *
 * The module deliberately contains no DOM, network, or map-library code.  Store
 * thresholds in metres, use `fromMeters` only for display, and call
 * `compileBands` once after a UI edit.  The compiled sampler can then be used in
 * a tight ImageData/WebGL preparation loop without parsing colours or units for
 * every elevation value.
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.ElevationBands = factory();
}(typeof globalThis !== "undefined" ? globalThis :
  (typeof self !== "undefined" ? self : this), function () {
  "use strict";

  var VERSION = 1;
  var UNIT_TO_METRES = Object.freeze({ m: 1, ft: 0.3048, yd: 0.9144 });
  var OPERATORS = Object.freeze(["below", "above", "between"]);
  var NAMED_COLOURS = Object.freeze({
    transparent: "#00000000", black: "#000000", silver: "#c0c0c0",
    gray: "#808080", grey: "#808080", white: "#ffffff",
    maroon: "#800000", red: "#ff0000", purple: "#800080",
    fuchsia: "#ff00ff", magenta: "#ff00ff", green: "#008000",
    lime: "#00ff00", olive: "#808000", yellow: "#ffff00",
    navy: "#000080", blue: "#0000ff", teal: "#008080",
    aqua: "#00ffff", cyan: "#00ffff", orange: "#ffa500",
    pink: "#ffc0cb", brown: "#a52a2a", rebeccapurple: "#663399"
  });

  var DEFAULT_RAW = Object.freeze({
    version: VERSION,
    unit: "ft",
    bands: Object.freeze([
      Object.freeze({
        id: "below", label: "Below elevation", enabled: false,
        operator: "below", maxM: 0, unit: "ft", color: "#367ed6",
        opacity: 0.52, inclusive: true, featherM: 0, order: 0
      }),
      Object.freeze({
        id: "above", label: "Above elevation", enabled: false,
        operator: "above", minM: 2000, unit: "ft", color: "#ed684f",
        opacity: 0.52, inclusive: true, featherM: 0, order: 1
      })
    ])
  });

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function finite(value, fallback) {
    if (value === "" || value === null || value === undefined) return fallback;
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normaliseUnit(unit, fallback) {
    var text = String(unit == null ? "" : unit).trim().toLowerCase();
    if (text === "m" || text === "meter" || text === "meters" ||
        text === "metre" || text === "metres") return "m";
    if (text === "ft" || text === "foot" || text === "feet" || text === "'") return "ft";
    if (text === "yd" || text === "yard" || text === "yards") return "yd";
    return fallback === undefined ? "m" : normaliseUnit(fallback);
  }

  function toMeters(value, unit) {
    var number = Number(value);
    return Number.isFinite(number) ? number * UNIT_TO_METRES[normaliseUnit(unit)] : NaN;
  }

  function fromMeters(value, unit) {
    var number = Number(value);
    return Number.isFinite(number) ? number / UNIT_TO_METRES[normaliseUnit(unit)] : NaN;
  }

  function convert(value, fromUnit, toUnit) {
    return fromMeters(toMeters(value, fromUnit), toUnit);
  }

  function byte(value) {
    return Math.round(clamp(Number(value) || 0, 0, 255));
  }

  function alphaByte(value) {
    if (value === undefined) return 255;
    var number = Number(value);
    if (!Number.isFinite(number)) return 255;
    return byte(number <= 1 ? number * 255 : number);
  }

  function parseHex(text) {
    var hex = text.replace(/^#/, "");
    if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map(function (part) { return part + part; }).join("");
    }
    if (hex.length === 6) hex += "ff";
    return [
      parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16)
    ];
  }

  function parseRgbChannel(token) {
    token = String(token).trim();
    var value = parseFloat(token);
    if (!Number.isFinite(value)) return NaN;
    return token.endsWith("%") ? clamp(value, 0, 100) * 255 / 100 : clamp(value, 0, 255);
  }

  function parseAlpha(token) {
    token = String(token == null ? "1" : token).trim();
    var value = parseFloat(token);
    if (!Number.isFinite(value)) return NaN;
    return token.endsWith("%") ? clamp(value, 0, 100) / 100 : clamp(value, 0, 1);
  }

  function functionalParts(body) {
    var slash = body.split("/");
    if (slash.length > 2) return null;
    var main = slash[0].trim();
    var alpha = slash.length === 2 ? slash[1].trim() : null;
    var parts = main.indexOf(",") >= 0 ? main.split(/\s*,\s*/) : main.split(/\s+/);
    if (alpha === null && parts.length === 4) alpha = parts.pop();
    return { parts: parts, alpha: alpha };
  }

  function hueDegrees(token) {
    token = String(token).trim().toLowerCase();
    var value = parseFloat(token);
    if (!Number.isFinite(value)) return NaN;
    if (token.endsWith("turn")) value *= 360;
    else if (token.endsWith("rad")) value *= 180 / Math.PI;
    else if (token.endsWith("grad")) value *= 0.9;
    return ((value % 360) + 360) % 360;
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function parseFunctionalColour(text) {
    var match = /^([a-z]+)\((.*)\)$/i.exec(text);
    if (!match) return null;
    var name = match[1].toLowerCase();
    var fields = functionalParts(match[2]);
    if (!fields || fields.parts.length !== 3) return null;
    var alpha = parseAlpha(fields.alpha);
    if (!Number.isFinite(alpha)) return null;
    if (name === "rgb" || name === "rgba") {
      var rgb = fields.parts.map(parseRgbChannel);
      if (rgb.some(function (part) { return !Number.isFinite(part); })) return null;
      return [byte(rgb[0]), byte(rgb[1]), byte(rgb[2]), byte(alpha * 255)];
    }
    if (name === "hsl" || name === "hsla") {
      var h = hueDegrees(fields.parts[0]);
      var sText = String(fields.parts[1]).trim();
      var lText = String(fields.parts[2]).trim();
      var s = parseFloat(sText), l = parseFloat(lText);
      if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
      s = clamp(sText.endsWith("%") ? s / 100 : s, 0, 1);
      l = clamp(lText.endsWith("%") ? l / 100 : l, 0, 1);
      var r, g, b;
      if (s === 0) r = g = b = l;
      else {
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        r = hueToRgb(p, q, h / 360 + 1 / 3);
        g = hueToRgb(p, q, h / 360);
        b = hueToRgb(p, q, h / 360 - 1 / 3);
      }
      return [byte(r * 255), byte(g * 255), byte(b * 255), byte(alpha * 255)];
    }
    return null;
  }

  /* Returns [r,g,b,a] bytes, or null for an invalid colour. */
  function parseColor(value) {
    if (Array.isArray(value) && value.length >= 3) {
      return [byte(value[0]), byte(value[1]), byte(value[2]), alphaByte(value[3])];
    }
    if (value && typeof value === "object") {
      var r = own(value, "r") ? value.r : value.red;
      var g = own(value, "g") ? value.g : value.green;
      var b = own(value, "b") ? value.b : value.blue;
      var a = own(value, "a") ? value.a : value.alpha;
      if ([r, g, b].every(function (part) { return Number.isFinite(Number(part)); })) {
        return [byte(r), byte(g), byte(b), alphaByte(a)];
      }
      return null;
    }
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 0xffffff) {
      var integer = Math.floor(value);
      return [(integer >>> 16) & 255, (integer >>> 8) & 255, integer & 255, 255];
    }
    if (typeof value !== "string") return null;
    var text = value.trim().toLowerCase();
    if (own(NAMED_COLOURS, text)) text = NAMED_COLOURS[text];
    if (/^#?[0-9a-f]+$/i.test(text)) return parseHex(text);
    return parseFunctionalColour(text);
  }

  function rgbaToHex(rgba) {
    var parsed = parseColor(rgba);
    if (!parsed) return null;
    var result = "#" + parsed.slice(0, 3).map(function (part) {
      return part.toString(16).padStart(2, "0");
    }).join("");
    return parsed[3] === 255 ? result : result + parsed[3].toString(16).padStart(2, "0");
  }

  function booleanValue(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "string") {
      var text = value.trim().toLowerCase();
      if (text === "false" || text === "0" || text === "off" || text === "no") return false;
      if (text === "true" || text === "1" || text === "on" || text === "yes") return true;
    }
    return Boolean(value);
  }

  function opacityValue(value, fallback) {
    var number = finite(value, fallback);
    if (number > 1 && number <= 100) number /= 100;
    return clamp(number, 0, 1);
  }

  function inclusiveValue(raw) {
    var result = { min: true, max: true };
    var value = raw.inclusive;
    if (typeof value === "boolean") result.min = result.max = value;
    else if (typeof value === "string") {
      var text = value.trim().toLowerCase();
      if (text === "none" || text === "neither" || text === "()") result.min = result.max = false;
      else if (text === "min" || text === "lower" || text === "[)") { result.min = true; result.max = false; }
      else if (text === "max" || text === "upper" || text === "(]") { result.min = false; result.max = true; }
      else if (text === "both" || text === "[]") result.min = result.max = true;
    } else if (value && typeof value === "object") {
      result.min = booleanValue(own(value, "min") ? value.min : value.lower, true);
      result.max = booleanValue(own(value, "max") ? value.max : value.upper, true);
    }
    if (own(raw, "inclusiveMin")) result.min = booleanValue(raw.inclusiveMin, result.min);
    if (own(raw, "inclusiveMax")) result.max = booleanValue(raw.inclusiveMax, result.max);
    if (own(raw, "includeLower")) result.min = booleanValue(raw.includeLower, result.min);
    if (own(raw, "includeUpper")) result.max = booleanValue(raw.includeUpper, result.max);
    return result;
  }

  function firstFinite(object, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (own(object, keys[i])) {
        var value = finite(object[keys[i]], NaN);
        if (Number.isFinite(value)) return value;
      }
    }
    return NaN;
  }

  function metresField(raw, metreKeys, displayKeys, unit, fallback) {
    var metres = firstFinite(raw, metreKeys);
    if (Number.isFinite(metres)) return metres;
    var display = firstFinite(raw, displayKeys);
    return Number.isFinite(display) ? toMeters(display, unit) : fallback;
  }

  function sanitiseOutline(raw, unit) {
    var source = raw.outline;
    var object = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    var present = source === true || typeof source === "string" || (source && typeof source === "object");
    var enabled = booleanValue(
      own(object, "enabled") ? object.enabled :
        (own(raw, "outlineEnabled") ? raw.outlineEnabled : present), false);
    var colourInput = typeof source === "string" ? source :
      (own(object, "color") ? object.color : raw.outlineColor);
    var rgba = parseColor(colourInput) || [255, 255, 255, 255];
    var outlineUnit = normaliseUnit(object.unit || raw.outlineUnit || unit, unit);
    var widthM = metresField(object,
      ["widthM", "widthMeters"], ["width", "feather"], outlineUnit, NaN);
    if (!Number.isFinite(widthM)) {
      widthM = metresField(raw,
        ["outlineWidthM", "outlineWidthMeters"], ["outlineWidth"], outlineUnit, 0);
    }
    return {
      enabled: enabled,
      color: rgbaToHex(rgba),
      rgba: rgba,
      opacity: opacityValue(own(object, "opacity") ? object.opacity : raw.outlineOpacity, 1),
      widthM: Math.max(0, widthM),
      unit: outlineUnit
    };
  }

  function sanitiseBand(input, index, stateUnit) {
    var raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    var operator = String(raw.operator || raw.op || "below").toLowerCase();
    if (OPERATORS.indexOf(operator) < 0) operator = "below";
    var unit = normaliseUnit(raw.unit || stateUnit, stateUnit || "m");
    var inclusive = inclusiveValue(raw);
    var rangeM = Array.isArray(raw.rangeM) ? raw.rangeM : null;
    var range = Array.isArray(raw.range) ? raw.range : null;
    var thresholdM = metresField(raw, ["thresholdM", "thresholdMeters"], ["threshold"], unit, 0);
    var minM = metresField(raw, ["minM", "minMeters", "lowerM"], ["min", "lower"], unit,
      rangeM ? finite(rangeM[0], 0) : (range ? toMeters(range[0], unit) : (operator === "between" ? 0 : thresholdM)));
    var maxM = metresField(raw, ["maxM", "maxMeters", "upperM"], ["max", "upper"], unit,
      rangeM ? finite(rangeM[1], 100) : (range ? toMeters(range[1], unit) : (operator === "between" ? 100 : thresholdM)));
    if (operator === "between" && minM > maxM) {
      var swap = minM; minM = maxM; maxM = swap;
      var includeSwap = inclusive.min; inclusive.min = inclusive.max; inclusive.max = includeSwap;
    }
    if (operator === "below") minM = null;
    if (operator === "above") maxM = null;
    var defaultColour = operator === "below" ? "#367ed6" :
      (operator === "above" ? "#ed684f" : "#f5c451");
    var rgba = parseColor(raw.color || raw.colour) || parseColor(defaultColour);
    var featherM = metresField(raw, ["featherM", "featherMeters"],
      ["feather", "featherWidth"], unit, 0);
    var id = String(raw.id == null ? "band-" + (index + 1) : raw.id).trim();
    if (!id) id = "band-" + (index + 1);
    var result = {
      id: id.slice(0, 96),
      label: String(raw.label == null ?
        (operator === "below" ? "Below elevation" : operator === "above" ? "Above elevation" : "Elevation range") : raw.label).trim().slice(0, 160),
      enabled: booleanValue(raw.enabled, true),
      operator: operator,
      inclusive: inclusive,
      inclusiveMin: inclusive.min,
      inclusiveMax: inclusive.max,
      minM: minM,
      maxM: maxM,
      thresholdM: operator === "below" ? maxM : (operator === "above" ? minM : null),
      unit: unit,
      color: rgbaToHex(rgba),
      rgba: rgba,
      opacity: opacityValue(raw.opacity, 0.5),
      featherM: Math.max(0, featherM),
      outline: sanitiseOutline(raw, unit),
      order: finite(raw.order, index)
    };
    return result;
  }

  function rawBands(input) {
    if (Array.isArray(input)) return input;
    if (!input || typeof input !== "object") return null;
    if (Array.isArray(input.bands)) return input.bands;
    var legacy = [];
    if (input.below && typeof input.below === "object") {
      legacy.push(Object.assign({ id: "below", operator: "below" }, input.below));
    }
    if (input.above && typeof input.above === "object") {
      legacy.push(Object.assign({ id: "above", operator: "above" }, input.above));
    }
    return legacy.length ? legacy : null;
  }

  function sanitiseState(input, options) {
    options = options || {};
    var supplied = input;
    var sourceBands = rawBands(supplied);
    if (sourceBands === null) {
      if (options.defaults === false) sourceBands = [];
      else { supplied = DEFAULT_RAW; sourceBands = DEFAULT_RAW.bands; }
    }
    var stateUnit = normaliseUnit(supplied && supplied.unit, options.defaultUnit || "ft");
    var desiredOrder = supplied && Array.isArray(supplied.order) ? supplied.order.map(String) : null;
    var seen = Object.create(null);
    var bands = [];
    for (var i = 0; i < sourceBands.length; i++) {
      if (!sourceBands[i] || typeof sourceBands[i] !== "object" || Array.isArray(sourceBands[i])) continue;
      var band = sanitiseBand(sourceBands[i], i, stateUnit);
      var baseId = band.id, suffix = 2;
      while (seen[band.id]) band.id = baseId + "-" + suffix++;
      seen[band.id] = true;
      band._sourceIndex = i;
      bands.push(band);
    }
    var rank = Object.create(null);
    if (desiredOrder) desiredOrder.forEach(function (id, order) {
      if (!own(rank, id)) rank[id] = order;
    });
    bands.sort(function (a, b) {
      if (desiredOrder) {
        var ar = own(rank, a.id) ? rank[a.id] : desiredOrder.length + a._sourceIndex;
        var br = own(rank, b.id) ? rank[b.id] : desiredOrder.length + b._sourceIndex;
        if (ar !== br) return ar - br;
      } else if (a.order !== b.order) return a.order - b.order;
      return a._sourceIndex - b._sourceIndex;
    });
    bands.forEach(function (band, order) { band.order = order; delete band._sourceIndex; });
    return {
      version: VERSION,
      unit: stateUnit,
      bands: bands,
      order: bands.map(function (band) { return band.id; })
    };
  }

  /*
   * Merge a saved/user state over a default/schema state by band id.  User
   * order wins; newly introduced default bands are appended.  This makes
   * persisted state forward-compatible without discarding custom bands.
   */
  function reconcileState(saved, defaults) {
    var base = sanitiseState(defaults === undefined ? DEFAULT_RAW : defaults);
    if (saved === null || saved === undefined) return base;
    var user = sanitiseState(saved, { defaults: false, defaultUnit: base.unit });
    var baseById = Object.create(null);
    base.bands.forEach(function (band) { baseById[band.id] = band; });
    var merged = user.bands.map(function (band) {
      if (!baseById[band.id]) return band;
      var combined = Object.assign({}, baseById[band.id], band);
      combined.inclusive = Object.assign({}, baseById[band.id].inclusive, band.inclusive);
      combined.outline = Object.assign({}, baseById[band.id].outline, band.outline);
      delete baseById[band.id];
      return combined;
    });
    base.bands.forEach(function (band) { if (baseById[band.id]) merged.push(band); });
    merged.forEach(function (band, order) { band.order = order; });
    return sanitiseState({ unit: user.unit, bands: merged });
  }

  function smoothstep(value) {
    value = clamp(value, 0, 1);
    return value * value * (3 - 2 * value);
  }

  function lowerCoverage(value, edge, inclusive, feather) {
    if (feather <= 0) return value > edge || (inclusive && value === edge) ? 1 : 0;
    var start = edge - feather / 2;
    if (value <= start) return 0;
    if (value >= edge + feather / 2) return 1;
    return smoothstep((value - start) / feather);
  }

  function upperCoverage(value, edge, inclusive, feather) {
    if (feather <= 0) return value < edge || (inclusive && value === edge) ? 1 : 0;
    var start = edge - feather / 2;
    if (value <= start) return 1;
    if (value >= edge + feather / 2) return 0;
    return 1 - smoothstep((value - start) / feather);
  }

  function coverageForBand(valueM, band) {
    var value = Number(valueM);
    if (!Number.isFinite(value) || !band || band.enabled === false) return 0;
    var feather = Math.max(0, finite(band.featherM, 0));
    var inclusive = band.inclusive || { min: band.inclusiveMin !== false, max: band.inclusiveMax !== false };
    if (band.operator === "above") return lowerCoverage(value, band.minM, inclusive.min !== false, feather);
    if (band.operator === "between") {
      return lowerCoverage(value, band.minM, inclusive.min !== false, feather) *
        upperCoverage(value, band.maxM, inclusive.max !== false, feather);
    }
    return upperCoverage(value, band.maxM, inclusive.max !== false, feather);
  }

  function outlineCoverage(valueM, band) {
    var outline = band && band.outline;
    if (!outline || !outline.enabled || band.enabled === false) return 0;
    var value = Number(valueM), width = Math.max(0, finite(outline.widthM, 0));
    if (!Number.isFinite(value)) return 0;
    var distance = Infinity;
    if (band.operator === "below") distance = Math.abs(value - band.maxM);
    else if (band.operator === "above") distance = Math.abs(value - band.minM);
    else distance = Math.min(Math.abs(value - band.minM), Math.abs(value - band.maxM));
    if (width === 0) return distance === 0 ? 1 : 0;
    var half = width / 2;
    return distance >= half ? 0 : 1 - smoothstep(distance / half);
  }

  function sourceOver(destination, rgba, opacity, coverage) {
    var alpha = rgba[3] / 255 * opacity * coverage;
    if (!(alpha > 0)) return;
    var inverse = 1 - alpha;
    destination[0] = rgba[0] / 255 * alpha + destination[0] * inverse;
    destination[1] = rgba[1] / 255 * alpha + destination[1] * inverse;
    destination[2] = rgba[2] / 255 * alpha + destination[2] * inverse;
    destination[3] = alpha + destination[3] * inverse;
  }

  function compileBands(input) {
    if (input && input.__elevationBandsCompiled === VERSION) return input;
    var state = sanitiseState(input, { defaults: false });
    var bands = state.bands.filter(function (band) { return band.enabled; }).map(function (band) {
      return {
        id: band.id, operator: band.operator, minM: band.minM, maxM: band.maxM,
        inclusive: { min: band.inclusive.min, max: band.inclusive.max },
        enabled: true, featherM: band.featherM, rgba: band.rgba.slice(),
        opacity: band.opacity,
        outline: {
          enabled: band.outline.enabled, widthM: band.outline.widthM,
          rgba: band.outline.rgba.slice(), opacity: band.outline.opacity
        }
      };
    });
    var compiled = {
      __elevationBandsCompiled: VERSION,
      state: state,
      bands: bands
    };
    compiled.sample = function (valueM, options) { return sampleElevation(valueM, compiled, options); };
    compiled.rgba = function (valueM, options) { return rgbaForElevation(valueM, compiled, options); };
    return compiled;
  }

  function encodeRgba(values, normalised) {
    if (normalised) return values.map(function (value) { return clamp(value, 0, 1); });
    return values.map(function (value) { return byte(value * 255); });
  }

  /* Returns both byte RGBA representations. Array order is bottom-to-top. */
  function sampleElevation(valueM, input, options) {
    options = options || {};
    var compiled = compileBands(input);
    var premultiplied = [0, 0, 0, 0];
    if (Number.isFinite(Number(valueM))) {
      for (var i = 0; i < compiled.bands.length; i++) {
        var band = compiled.bands[i];
        sourceOver(premultiplied, band.rgba, band.opacity, coverageForBand(valueM, band));
        sourceOver(premultiplied, band.outline.rgba, band.outline.opacity, outlineCoverage(valueM, band));
      }
    }
    var alpha = premultiplied[3];
    var straight = alpha > 0 ? [
      premultiplied[0] / alpha, premultiplied[1] / alpha,
      premultiplied[2] / alpha, alpha
    ] : [0, 0, 0, 0];
    return {
      straight: encodeRgba(straight, options.normalized === true),
      premultiplied: encodeRgba(premultiplied, options.normalized === true)
    };
  }

  function rgbaForElevation(valueM, input, options) {
    var settings = typeof options === "string" ? { format: options } : (options || {});
    var sampled = sampleElevation(valueM, input, settings);
    return settings.premultiplied === true || settings.format === "premultiplied" ?
      sampled.premultiplied : sampled.straight;
  }

  function createDefaultState() {
    return sanitiseState(DEFAULT_RAW);
  }

  return Object.freeze({
    VERSION: VERSION,
    UNITS: UNIT_TO_METRES,
    OPERATORS: OPERATORS,
    normalizeUnit: normaliseUnit,
    normaliseUnit: normaliseUnit,
    toMeters: toMeters,
    toMetres: toMeters,
    fromMeters: fromMeters,
    fromMetres: fromMeters,
    convert: convert,
    convertValue: convert,
    parseColor: parseColor,
    parseColour: parseColor,
    rgbaToHex: rgbaToHex,
    sanitizeBand: sanitiseBand,
    sanitiseBand: sanitiseBand,
    sanitizeState: sanitiseState,
    sanitiseState: sanitiseState,
    sanitize: sanitiseState,
    sanitise: sanitiseState,
    reconcile: reconcileState,
    reconcileState: reconcileState,
    reconcileBands: reconcileState,
    createDefaultState: createDefaultState,
    coverageForBand: coverageForBand,
    outlineCoverage: outlineCoverage,
    compileBands: compileBands,
    sample: sampleElevation,
    sampleElevation: sampleElevation,
    rgbaForValue: rgbaForElevation,
    rgbaForElevation: rgbaForElevation,
    renderRGBA: rgbaForElevation,
    colorForElevation: rgbaForElevation,
    colourForElevation: rgbaForElevation
  });
}));
