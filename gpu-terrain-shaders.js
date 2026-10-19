/*
 * Clear Skies GPU 2D terrain: GLSL for the shade + composite pass.
 * Contract: docs/GPU_2D_TERRAIN_SPEC.md section 4.1. Workstream S.
 *
 * The fragment shader is a faithful port of the two current per-tile GPU
 * renderers in index.html (TerrainGpuRenderer, ~10 styles, and
 * ElevationGpuRenderer, spectrum + below/above bands + feather + outline),
 * adapted to read a screen-space height field through the engine prelude
 * (csp_height/csp_rank/csp_valid/csp_size) instead of a per-tile texture.
 * Gradient math, ramps and contour rules match CSPTerrainRaster.renderRgba;
 * spectrum/band math matches CSPTerrainDrape.elevationColours. The one
 * behavioural change versus the old per-tile shaders is intentional: the
 * Sobel gradient is taken in screen space and rotated into east/north by
 * the map bearing, and the ground resolution is derived per fragment from
 * its Web-Mercator latitude, so shading stays geographically correct when
 * the map rotates (spec section 3 step 3).
 */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.CSPGpuTerrainShaders = factory();
}(typeof globalThis !== "undefined" ? globalThis :
  (typeof self !== "undefined" ? self : this), function () {
  "use strict";

  var STYLE_IDS = Object.freeze({hs: 0, hsmulti: 1, slope: 2, aspect: 3, northness: 4, tint: 5, c2: 6, c5: 7, c10: 8, c25: 9,
    rem: 10, contour: 11});

  /* The layer stack. When u_stackOn is set the terrain is composited from up
   * to MAX_LAYERS layers, each a style read through its own colour ramp and
   * blended onto the layers beneath it. With the stack off the legacy
   * per-style code below runs unchanged, so default rendering keeps exact
   * parity with CSPTerrainRaster and the start-up self-tests. */
  var MAX_LAYERS = 4, MAX_STOPS = 10, STOP_VECS = Math.ceil(MAX_STOPS / 4);
  var BLEND_IDS = Object.freeze({normal: 0, multiply: 1, screen: 2, overlay: 3, "soft-light": 4, "hard-light": 5,
    darken: 6, lighten: 7, color: 8, luminosity: 9});

  /* Extension point for analysis layers. A registered style becomes a layer
   * that any stack entry can use. spec.glsl is the body of
   *   vec2 f(inout CspCtx c)
   * returning (value, coverage): value is mapped through the layer's ramp
   * range, coverage (0..1) scales its alpha; return coverage 0 to leave a
   * pixel unpainted. CspCtx carries p (ivec2 field pixel), height (m), base
   * (m, the relative-elevation base surface), dx/dy (dz per metre east and
   * south), res (m per field pixel), slope (degrees) and aspect (degrees,
   * -1 when flat). cspH(ivec2) reads neighbouring heights. Register before
   * any engine compiles its program. */
  var customStyles = [], CUSTOM_BASE = 32;
  function registerStyle(spec) {
    var name = String(spec && spec.name || "");
    if (!/^[a-z][a-z0-9_-]*$/i.test(name)) throw new TypeError("style name must be an identifier");
    if (Object.prototype.hasOwnProperty.call(STYLE_IDS, name)) throw new RangeError("built-in style: " + name);
    if (typeof spec.glsl !== "string" || !spec.glsl.trim()) throw new TypeError("style glsl body is required");
    var existing = customStyles.filter(function (s) { return s.name === name; })[0];
    if (existing) { existing.glsl = spec.glsl; return existing.id; }
    var id = CUSTOM_BASE + customStyles.length;
    customStyles.push({name: name, id: id, glsl: spec.glsl});
    return id;
  }
  function styleId(name) {
    if (name === "off") return -1;
    if (Object.prototype.hasOwnProperty.call(STYLE_IDS, name)) return STYLE_IDS[name];
    for (var i = 0; i < customStyles.length; i++) if (customStyles[i].name === name) return customStyles[i].id;
    return null;
  }

  /* Full-screen triangle; v_screenUv is (0,0) at the top-left of the canvas. */
  var fullscreenVertexSource = "#version 300 es\n" +
    "out vec2 v_screenUv;\n" +
    "void main(){\n" +
    "  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));\n" +
    "  v_screenUv=vec2(p.x,1.0-p.y);\n" +
    "  gl_Position=vec4(p*2.0-1.0,0.0,1.0);\n" +
    "}\n";

  /* Every uniform shadeFragmentSource declares. u_style is an int uniform
   * (set with uniform1i); all others are float or vec2/vec3 (uniform1f /
   * uniform2f / uniform3f, or the fv forms). u_bearingRad is the map
   * bearing in radians, clockwise. u_groundResOverride is test-only:
   * values <= 0 mean "compute ground resolution from the view". */
  var SHADE_UNIFORMS = Object.freeze([
    "u_style", "u_terrainOpacity",
    "u_sunAzimuth", "u_sunAltitude", "u_ambient",
    "u_lookSaturation", "u_lookContrast", "u_lookBrightness",
    "u_spectrumOn", "u_spectrumLevel", "u_spectrumSpan", "u_spectrumAlpha",
    "u_belowOn", "u_belowLevel", "u_belowColor",
    "u_aboveOn", "u_aboveLevel", "u_aboveColor",
    "u_bandAlpha", "u_bandFeather",
    "u_outlineOn", "u_outlineWidth",
    "u_spectrumOpacity",
    "u_centerMerc", "u_zoom", "u_bearingRad", "u_cssSize", "u_dpr",
    "u_groundResOverride",
    "u_stackOn", "u_layerCount", "u_layerA", "u_layerB", "u_layerC", "u_layerPos", "u_layerColors",
    "u_detail", "u_reliefExag", "u_remFlatBase"
  ]);
  /* Array uniforms and their component count; every other uniform is a
   * scalar or the fixed vectors above. Renderers that set uniforms by hand
   * (the 3D drape) use this to choose uniform4fv. */
  var UNIFORM_ARRAYS = Object.freeze({u_layerA: 4, u_layerB: 4, u_layerC: 4, u_layerPos: 4, u_layerColors: 4});

  var EARTH_RADIUS = 6378137;
  var WORLD_METRES = 2 * Math.PI * EARTH_RADIUS; /* 40075016.68557849 */

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }
  function finiteOr(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  /* Esri scaled z-factor used by reliefResolution() in index.html. Lighting
   * only: slope, aspect and contours keep true scale. */
  function reliefZFactor(cellMetres) {
    return 1 + 0.024 * Math.pow(Math.max(0, cellMetres), 0.664);
  }

  /* Latitude (radians) of a Web-Mercator y in 0..1 (y grows south). */
  function latitudeFromMercatorY(mercY) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * mercY)));
  }

  /* Ground distance of one physical pixel at the given Mercator y. */
  function metersPerPixel(view, mercY) {
    var v = view || {};
    var zoom = finiteOr(v.zoom, 0);
    var dpr = Math.max(1e-6, finiteOr(v.dpr, 1));
    var y = mercY === undefined
      ? (Array.isArray(v.centerMerc) ? finiteOr(v.centerMerc[1], 0.5) : 0.5)
      : finiteOr(mercY, 0.5);
    var lat = latitudeFromMercatorY(y);
    return WORLD_METRES * Math.cos(lat) / (256 * Math.pow(2, zoom) * dpr);
  }

  /*
   * Mercator position (0..1, x east, y south) of a screen point.
   * screenUv is (0,0) at the canvas top-left, in the same units as
   * v_screenUv. The screen offset from the centre is rotated by the
   * bearing (degrees clockwise) into Mercator axes: with bearing B, the
   * map's east direction appears on screen at angle B from screen-right,
   * so offsetMerc = R(-B) applied to the CSS-pixel offset, divided by
   * the world size in CSS pixels (256 * 2^zoom).
   */
  function screenToMercator(view, screenUv) {
    var v = view || {};
    var center = Array.isArray(v.centerMerc) ? v.centerMerc : [0.5, 0.5];
    var css = Array.isArray(v.cssSize) ? v.cssSize : [0, 0];
    var zoom = finiteOr(v.zoom, 0);
    var bearing = finiteOr(v.bearing, 0) * Math.PI / 180;
    var sx = (finiteOr(screenUv && screenUv[0], 0.5) - 0.5) * finiteOr(css[0], 0);
    var sy = (finiteOr(screenUv && screenUv[1], 0.5) - 0.5) * finiteOr(css[1], 0);
    var cosB = Math.cos(bearing), sinB = Math.sin(bearing);
    var worldCss = 256 * Math.pow(2, zoom);
    return [
      finiteOr(center[0], 0.5) + (sx * cosB + sy * sinB) / worldCss,
      finiteOr(center[1], 0.5) + (-sx * sinB + sy * cosB) / worldCss
    ];
  }

  /*
   * Rotate a screen-space gradient into geographic components. dx is
   * dz per screen-right step, dy is dz per screen-down step (both already
   * divided by ground distance). Returns [dzdEast, dzdSouth], the exact
   * (dzdx, dzdy) convention CSPTerrainRaster uses north-up: at bearing 0
   * the result is [dx, dy]; at bearing 90 (north pointing screen-right) a
   * screen-right rise becomes a northward rise, i.e. dzdSouth = -dx.
   */
  function rotateGradient(dx, dy, bearingDeg) {
    var bearing = finiteOr(bearingDeg, 0) * Math.PI / 180;
    var cosB = Math.cos(bearing), sinB = Math.sin(bearing);
    var east = dx * cosB + dy * sinB;
    var north = dx * sinB - dy * cosB;
    return [east, -north];
  }

  /*
   * JS reference for the CSS appearance filter, Filter Effects Level 1:
   * saturate(s), then contrast(c), then brightness(b), applied to a
   * straight (unpremultiplied) sRGB colour in 0..1, clamping after each
   * function. Empirically verified against real browsers: see the long
   * comment above applyAppearance() in the fragment shader below.
   */
  function cssFilterReference(rgb, look) {
    var r = finiteOr(rgb && rgb[0], 0), g = finiteOr(rgb && rgb[1], 0), b = finiteOr(rgb && rgb[2], 0);
    var s = finiteOr(look && look.saturation, 1);
    var c = finiteOr(look && look.contrast, 1);
    var br = finiteOr(look && look.brightness, 1);
    var r1 = clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b, 0, 1);
    var g1 = clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b, 0, 1);
    var b1 = clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b, 0, 1);
    var r2 = clamp(r1 * c + (1 - c) * 0.5, 0, 1);
    var g2 = clamp(g1 * c + (1 - c) * 0.5, 0, 1);
    var b2 = clamp(b1 * c + (1 - c) * 0.5, 0, 1);
    return [clamp(r2 * br, 0, 1), clamp(g2 * br, 0, 1), clamp(b2 * br, 0, 1)];
  }

  function colour3(value, fallback) {
    if (Array.isArray(value) && value.length >= 3 &&
        Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1])) && Number.isFinite(Number(value[2])))
      return [clamp(Number(value[0]), 0, 1), clamp(Number(value[1]), 0, 1), clamp(Number(value[2]), 0, 1)];
    return fallback.slice();
  }

  /* state and view: spec section 4.1. Returns {uniformName: number|number[]}
   * with exactly one entry per SHADE_UNIFORMS name. Pure JS, no WebGL.
   * Mapping notes: look percents become factors (percent/100, as
   * applyTerrainAppearanceTo writes them into the CSS filter); lighting is
   * clamped exactly as CSPTerrainRaster.renderRgba clamps it; spectrum
   * fields come straight from the elevationRenderSettings() shape (its
   * bandCompiled member is a CPU-side sampler and is not a uniform). The
   * one extra read is the test-only state.groundResOverride. */
  function uniformValues(state, view) {
    var s = state || {};
    var terrain = s.terrain || {};
    var look = terrain.look || {};
    var lighting = terrain.lighting || {};
    var spectrum = s.spectrum || {};
    var below = spectrum.below || {};
    var above = spectrum.above || {};
    var v = view || {};
    var center = Array.isArray(v.centerMerc) ? v.centerMerc : [0.5, 0.5];
    var css = Array.isArray(v.cssSize) ? v.cssSize : [0, 0];
    var styleName = terrain.style === undefined ? "hs" : String(terrain.style);
    var styleId = styleName === "off" ? -1
      : (Object.prototype.hasOwnProperty.call(STYLE_IDS, styleName) ? STYLE_IDS[styleName] : 0);
    var bearingDeg = finiteOr(v.bearing, 0);
    var stack = stackUniforms(terrain.stack);
    return {
      u_style: styleId,
      u_terrainOpacity: clamp(finiteOr(terrain.opacity, 1), 0, 1),
      u_sunAzimuth: clamp(finiteOr(lighting.azimuth, 315), 0, 359),
      u_sunAltitude: clamp(finiteOr(lighting.altitude, 45), 5, 90),
      u_ambient: clamp(finiteOr(lighting.ambient, 0.12), 0, 0.6),
      u_lookSaturation: clamp(finiteOr(look.saturation, 100), 0, 1000) / 100,
      u_lookContrast: clamp(finiteOr(look.contrast, 100), 0, 1000) / 100,
      u_lookBrightness: clamp(finiteOr(look.brightness, 100), 0, 1000) / 100,
      u_spectrumOn: spectrum.spectrumOn ? 1 : 0,
      u_spectrumLevel: finiteOr(spectrum.level, 0),
      u_spectrumSpan: finiteOr(spectrum.span, 1),
      u_spectrumAlpha: clamp(finiteOr(spectrum.spectrumAlpha, 0), 0, 1),
      u_belowOn: below.enabled ? 1 : 0,
      u_belowLevel: finiteOr(below.level, 0),
      u_belowColor: colour3(below.color, [1, 0, 0]),
      u_aboveOn: above.enabled ? 1 : 0,
      u_aboveLevel: finiteOr(above.level, 0),
      u_aboveColor: colour3(above.color, [0, 0, 1]),
      u_bandAlpha: clamp(finiteOr(spectrum.bandAlpha, 0.52), 0, 1),
      u_bandFeather: Math.max(0, finiteOr(spectrum.bandFeather, 0)),
      u_outlineOn: spectrum.outline ? 1 : 0,
      u_outlineWidth: Math.max(0, finiteOr(spectrum.outlineWidth, 8 * 0.3048)),
      u_spectrumOpacity: clamp(finiteOr(s.spectrumOpacity, 1), 0, 1),
      u_centerMerc: [finiteOr(center[0], 0.5), finiteOr(center[1], 0.5)],
      u_zoom: finiteOr(v.zoom, 0),
      u_bearingRad: bearingDeg * Math.PI / 180,
      u_cssSize: [Math.max(0, finiteOr(css[0], 0)), Math.max(0, finiteOr(css[1], 0))],
      u_dpr: Math.max(1e-6, finiteOr(v.dpr, 1)),
      u_groundResOverride: finiteOr(s.groundResOverride, 0),
      u_stackOn: stack.on, u_layerCount: stack.count,
      u_layerA: stack.a, u_layerB: stack.b, u_layerC: stack.c, u_layerPos: stack.pos, u_layerColors: stack.colors,
      u_detail: stack.detail, u_reliefExag: stack.reliefExag, u_remFlatBase: stack.remFlatBase
    };
  }

  /* stack: {layers: [{style, opacity, blend, stops: [[position 0..1, r, g, b, a] in 0..1],
   *   min, max, gamma, steps, param}], detail, reliefExag, remFlatBase}.
   * An absent stack uses legacy rendering; an empty stack is transparent. */
  function stackUniforms(stack) {
    var layers = stack && Array.isArray(stack.layers) ? stack.layers : [];
    var a = new Array(MAX_LAYERS * 4).fill(0), b = new Array(MAX_LAYERS * 4).fill(0), c = new Array(MAX_LAYERS * 4).fill(0);
    var pos = new Array(MAX_LAYERS * STOP_VECS * 4).fill(1), colors = new Array(MAX_LAYERS * MAX_STOPS * 4).fill(0);
    var count = 0;
    for (var i = 0; i < layers.length && count < MAX_LAYERS; i++) {
      var layer = layers[i] || {}, id = styleId(String(layer.style));
      if (id === null || id < 0) continue;
      var stops = (Array.isArray(layer.stops) ? layer.stops : []).filter(function (stop) {
        return Array.isArray(stop) && stop.length >= 4 && stop.every(function (n) { return Number.isFinite(Number(n)); });
      }).slice(0, MAX_STOPS).map(function (stop) {
        return [clamp(+stop[0], 0, 1), clamp(+stop[1], 0, 1), clamp(+stop[2], 0, 1), clamp(+stop[3], 0, 1),
          stop.length > 4 ? clamp(+stop[4], 0, 1) : 1];
      }).sort(function (x, y) { return x[0] - y[0]; });
      if (!stops.length) stops = [[0, 0, 0, 0, 1], [1, 1, 1, 1, 1]];
      var min = finiteOr(layer.min, 0), max = finiteOr(layer.max, 1);
      if (max === min) max = min + 1e-6;
      var blend = Object.prototype.hasOwnProperty.call(BLEND_IDS, layer.blend) ? BLEND_IDS[layer.blend] : 0;
      a.splice(count * 4, 4, id, clamp(finiteOr(layer.opacity, 1), 0, 1), blend, stops.length);
      b.splice(count * 4, 4, min, max, clamp(finiteOr(layer.gamma, 1), 0.1, 10), Math.max(0, Math.round(finiteOr(layer.steps, 0))));
      c.splice(count * 4, 4, finiteOr(layer.param, 0), 0, 0, 0);
      for (var k = 0; k < stops.length; k++) {
        pos[count * STOP_VECS * 4 + k] = stops[k][0];
        colors.splice((count * MAX_STOPS + k) * 4, 4, stops[k][1], stops[k][2], stops[k][3], stops[k][4]);
      }
      count++;
    }
    var on = stack && Array.isArray(stack.layers) ? 1 : 0;
    return {on: on, count: count, a: a, b: b, c: c, pos: pos, colors: colors,
      detail: on ? clamp(finiteOr(stack.detail, 0), -1, 4) : 0,
      reliefExag: on ? clamp(finiteOr(stack.reliefExag, 1), 0.1, 20) : 1,
      remFlatBase: finiteOr(stack && stack.remFlatBase, 0)};
  }

  /*
   * prelude: GLSL from the engine defining
   *   float csp_height(ivec2 p); int csp_rank(ivec2 p); bool csp_valid(ivec2 p); ivec2 csp_size();
   * ivec2 pixel coordinates passed to the prelude follow v_screenUv:
   * (0,0) is the top-left physical pixel of the height field.
   */
  function shadeFragmentSource(prelude) {
    return [
      "#version 300 es",
      "precision highp float;",
      String(prelude || ""),
      "uniform int u_style;",
      "uniform float u_terrainOpacity;",
      "uniform float u_sunAzimuth;",
      "uniform float u_sunAltitude;",
      "uniform float u_ambient;",
      "uniform float u_lookSaturation;",
      "uniform float u_lookContrast;",
      "uniform float u_lookBrightness;",
      "uniform float u_spectrumOn;",
      "uniform float u_spectrumLevel;",
      "uniform float u_spectrumSpan;",
      "uniform float u_spectrumAlpha;",
      "uniform float u_belowOn;",
      "uniform float u_belowLevel;",
      "uniform vec3 u_belowColor;",
      "uniform float u_aboveOn;",
      "uniform float u_aboveLevel;",
      "uniform vec3 u_aboveColor;",
      "uniform float u_bandAlpha;",
      "uniform float u_bandFeather;",
      "uniform float u_outlineOn;",
      "uniform float u_outlineWidth;",
      "uniform float u_spectrumOpacity;",
      "uniform vec2 u_centerMerc;",
      "uniform float u_zoom;",
      "uniform float u_bearingRad;",
      "uniform vec2 u_cssSize;",
      "uniform float u_dpr;",
      "uniform float u_groundResOverride;",
      "uniform float u_stackOn;",
      "uniform float u_layerCount;",
      "uniform vec4 u_layerA[" + MAX_LAYERS + "];",
      "uniform vec4 u_layerB[" + MAX_LAYERS + "];",
      "uniform vec4 u_layerC[" + MAX_LAYERS + "];",
      "uniform vec4 u_layerPos[" + (MAX_LAYERS * STOP_VECS) + "];",
      "uniform vec4 u_layerColors[" + (MAX_LAYERS * MAX_STOPS) + "];",
      "uniform float u_detail;",
      "uniform float u_reliefExag;",
      "uniform float u_remFlatBase;",
      "in vec2 v_screenUv;",
      "out vec4 fragColor;",
      "const float CSP_PI = 3.141592653589793;",
      /* Ported verbatim in behaviour from TerrainGpuRenderer (index.html). */
      "vec3 cspRamp(float value, vec3 c0, float v1, vec3 c1, float v2, vec3 c2, float v3, vec3 c3, float v4, vec3 c4, float v5, vec3 c5, float v6, vec3 c6){",
      "  if(value <= v1) return mix(c0, c1, clamp(value / max(v1, 0.0001), 0.0, 1.0));",
      "  if(value <= v2) return mix(c1, c2, (value - v1) / (v2 - v1));",
      "  if(value <= v3) return mix(c2, c3, (value - v2) / (v3 - v2));",
      "  if(value <= v4) return mix(c3, c4, (value - v3) / (v4 - v3));",
      "  if(value <= v5) return mix(c4, c5, (value - v4) / (v5 - v4));",
      "  if(value <= v6) return mix(c5, c6, (value - v5) / (v6 - v5));",
      "  return c6;",
      "}",
      "float cspAspectOf(float dx, float dy){ return mod(degrees(atan(-dx, dy)) + 360.0, 360.0); }",
      "float cspDirectShade(float dx, float dy, float azimuth){",
      "  float east = dx, north = -dy, altitude = radians(u_sunAltitude), az = radians(azimuth);",
      "  return clamp((-east * cos(altitude) * sin(az) - north * cos(altitude) * cos(az) + sin(altitude)) / sqrt(east * east + north * north + 1.0), 0.0, 1.0);",
      "}",
      "vec3 cspSlopeColour(float degreesValue){",
      "  return cspRamp(degreesValue, vec3(242.0, 244.0, 238.0) / 255.0, 5.0, vec3(177.0, 210.0, 139.0) / 255.0,",
      "    15.0, vec3(246.0, 218.0, 111.0) / 255.0, 30.0, vec3(240.0, 150.0, 73.0) / 255.0,",
      "    45.0, vec3(213.0, 70.0, 80.0) / 255.0, 60.0, vec3(118.0, 44.0, 105.0) / 255.0,",
      "    90.0, vec3(50.0, 25.0, 72.0) / 255.0);",
      "}",
      "vec3 cspAspectColour(float degreesValue){",
      "  float sector = floor(degreesValue / 45.0), t = fract(degreesValue / 45.0);",
      "  vec3 a, b;",
      "  if(sector < 1.0){ a = vec3(77.0, 120.0, 200.0); b = vec3(59.0, 165.0, 176.0); }",
      "  else if(sector < 2.0){ a = vec3(59.0, 165.0, 176.0); b = vec3(87.0, 167.0, 101.0); }",
      "  else if(sector < 3.0){ a = vec3(87.0, 167.0, 101.0); b = vec3(201.0, 173.0, 79.0); }",
      "  else if(sector < 4.0){ a = vec3(201.0, 173.0, 79.0); b = vec3(217.0, 107.0, 82.0); }",
      "  else if(sector < 5.0){ a = vec3(217.0, 107.0, 82.0); b = vec3(196.0, 91.0, 130.0); }",
      "  else if(sector < 6.0){ a = vec3(196.0, 91.0, 130.0); b = vec3(141.0, 101.0, 187.0); }",
      "  else if(sector < 7.0){ a = vec3(141.0, 101.0, 187.0); b = vec3(94.0, 119.0, 197.0); }",
      "  else { a = vec3(94.0, 119.0, 197.0); b = vec3(77.0, 120.0, 200.0); }",
      "  return mix(a, b, t) / 255.0;",
      "}",
      /* The "relief" ramp from terrain-core.js, interpolated in sRGB like it. */
      "vec3 cspTintColour(float value){",
      "  vec3 c0 = vec3(22.0, 46.0, 72.0) / 255.0, c1 = vec3(40.0, 70.0, 95.0) / 255.0, c2 = vec3(70.0, 110.0, 70.0) / 255.0, c3 = vec3(128.0, 140.0, 92.0) / 255.0;",
      "  vec3 c4 = vec3(160.0, 140.0, 108.0) / 255.0, c5 = vec3(190.0, 180.0, 170.0) / 255.0, c6 = vec3(245.0, 246.0, 250.0) / 255.0, c7 = vec3(255.0) / 255.0;",
      "  if(value <= -500.0) return c0;",
      "  if(value <= 0.0) return mix(c0, c1, (value + 500.0) / 500.0);",
      "  if(value <= 300.0) return mix(c1, c2, value / 300.0);",
      "  if(value <= 900.0) return mix(c2, c3, (value - 300.0) / 600.0);",
      "  if(value <= 1600.0) return mix(c3, c4, (value - 900.0) / 700.0);",
      "  if(value <= 2400.0) return mix(c4, c5, (value - 1600.0) / 800.0);",
      "  if(value <= 3200.0) return mix(c5, c6, (value - 2400.0) / 800.0);",
      "  if(value <= 6000.0) return mix(c6, c7, (value - 3200.0) / 2800.0);",
      "  return c7;",
      "}",
      /* CSS appearance filter, Filter Effects Level 1, in the order
       * applyTerrainAppearanceTo writes it: saturate, contrast, brightness.
       *
       * Empirical finding (verified 2026-10-17, this Mac, real GPUs:
       * Chrome 154 + Metal and WebKit/Safari via Playwright): browsers
       * apply these filter functions to the STRAIGHT (unpremultiplied)
       * sRGB colour, not to premultiplied colour, and clamp to [0,1]
       * after each function. Probe: 30px boxes of known rgba() colours
       * with filter styles, screenshotted over a white page and sampled.
       * Decisive case rgba(200,100,50,0.5) with contrast(1.8): observed
       * (255,166,127); the straight-colour prediction is (255,167,128)
       * (max error 1, rounding) while the premultiplied prediction is
       * (206,128,128) (error 49). Saturate and brightness are linear and
       * cannot distinguish the two spaces; contrast has an intercept
       * term, which is what makes the test decisive. All 7 probe cases
       * in both browsers matched the straight prediction within 1/255.
       * Consequence for this shader: un-premultiply the terrain colour,
       * filter it, then re-premultiply and apply terrain opacity. */
      "vec3 cspApplyAppearance(vec3 straight){",
      "  float s = u_lookSaturation;",
      "  vec3 c = vec3(",
      "    (0.213 + 0.787 * s) * straight.r + (0.715 - 0.715 * s) * straight.g + (0.072 - 0.072 * s) * straight.b,",
      "    (0.213 - 0.213 * s) * straight.r + (0.715 + 0.285 * s) * straight.g + (0.072 - 0.072 * s) * straight.b,",
      "    (0.213 - 0.213 * s) * straight.r + (0.715 - 0.715 * s) * straight.g + (0.072 + 0.928 * s) * straight.b);",
      "  c = clamp(c, 0.0, 1.0);",
      "  c = clamp(c * u_lookContrast + (1.0 - u_lookContrast) * 0.5, 0.0, 1.0);",
      "  c = clamp(c * u_lookBrightness, 0.0, 1.0);",
      "  return c;",
      "}",
      /* Spectrum + bands + outline, ported from ElevationGpuRenderer and
       * matching CSPTerrainDrape.elevationColours. Returns premultiplied. */
      "vec4 cspSpectrumColour(float value){",
      "  vec4 result = vec4(0.0);",
      "  if(u_spectrumOn > 0.5){",
      "    float d = (value - u_spectrumLevel) / max(1.0, u_spectrumSpan);",
      "    float t = clamp(abs(d), 0.0, 1.0);",
      "    float blend = t * t * (3.0 - 2.0 * t);",
      "    vec3 white = vec3(255.0, 255.0, 250.0) / 255.0;",
      "    vec3 target = (d >= 0.0 ? vec3(70.0, 160.0, 255.0) : vec3(248.0, 92.0, 108.0)) / 255.0;",
      "    vec3 rgb = mix(white, target, blend);",
      "    float a = clamp(u_spectrumAlpha * (0.15 + 0.85 * t), 0.0, 1.0);",
      "    result = vec4(rgb * a + result.rgb * (1.0 - a), a + result.a * (1.0 - a));",
      "  }",
      "  float belowCoverage = u_bandFeather > 0.0",
      "    ? 1.0 - smoothstep(u_belowLevel - u_bandFeather * 0.5, u_belowLevel + u_bandFeather * 0.5, value)",
      "    : step(value, u_belowLevel);",
      "  float aboveCoverage = u_bandFeather > 0.0",
      "    ? smoothstep(u_aboveLevel - u_bandFeather * 0.5, u_aboveLevel + u_bandFeather * 0.5, value)",
      "    : step(u_aboveLevel, value);",
      "  if(u_belowOn > 0.5){",
      "    float a = clamp(u_bandAlpha * belowCoverage, 0.0, 1.0);",
      "    result = vec4(u_belowColor * a + result.rgb * (1.0 - a), a + result.a * (1.0 - a));",
      "  }",
      "  if(u_aboveOn > 0.5){",
      "    float a = clamp(u_bandAlpha * aboveCoverage, 0.0, 1.0);",
      "    result = vec4(u_aboveColor * a + result.rgb * (1.0 - a), a + result.a * (1.0 - a));",
      "  }",
      "  if(u_outlineOn > 0.5){",
      "    float line = 0.0;",
      "    if(u_belowOn > 0.5) line = max(line, 1.0 - smoothstep(0.0, max(0.001, u_outlineWidth * 0.5), abs(value - u_belowLevel)));",
      "    if(u_aboveOn > 0.5) line = max(line, 1.0 - smoothstep(0.0, max(0.001, u_outlineWidth * 0.5), abs(value - u_aboveLevel)));",
      "    float a = clamp(0.88 * line, 0.0, 1.0);",
      "    result = vec4(vec3(1.0) * a + result.rgb * (1.0 - a), a + result.a * (1.0 - a));",
      "  }",
      "  return result;",
      "}",
      stackSource(),
      "void main(){",
      "  ivec2 size = csp_size();",
      "  ivec2 p = clamp(ivec2(floor(v_screenUv * vec2(size))), ivec2(0), size - ivec2(1));",
      "  if(!csp_valid(p)){ fragColor = vec4(0.0); return; }",
      "  float value = csp_height(p);",
      /* Fragment Mercator position and ground resolution. The offset from
       * the view centre rotates by the bearing exactly as screenToMercator
       * does in JS; latitude comes from the Mercator y of this fragment. */
      "  vec2 cssOffset = (v_screenUv - 0.5) * u_cssSize;",
      "  float cosB = cos(u_bearingRad), sinB = sin(u_bearingRad);",
      "  float worldCss = 256.0 * exp2(u_zoom);",
      "  vec2 merc = u_centerMerc + vec2(cssOffset.x * cosB + cssOffset.y * sinB, -cssOffset.x * sinB + cssOffset.y * cosB) / worldCss;",
      "  float lat = atan(sinh(CSP_PI * (1.0 - 2.0 * merc.y)));",
      "  float mpp = 40075016.68557849 * cos(lat) / (256.0 * exp2(u_zoom) * u_dpr);",
      "  float groundRes = u_groundResOverride > 0.0 ? u_groundResOverride : mpp;",
      /* Spectrum layer: centre sample only, scaled by spectrum opacity. */
      "  vec4 spectrum = cspSpectrumColour(value) * u_spectrumOpacity;",
      /* Terrain layer. */
      "  vec4 terrain = vec4(0.0);",
      "  if(u_stackOn > 0.5){",
      "    terrain = cspStack(p, value, groundRes, cosB, sinB);",
      "  } else if(u_style >= 0){",
      "    ivec2 px = ivec2(1, 0), py = ivec2(0, 1);",
      "    bool allValid = csp_valid(p - px - py) && csp_valid(p - py) && csp_valid(p + px - py)",
      "      && csp_valid(p - px) && csp_valid(p + px)",
      "      && csp_valid(p - px + py) && csp_valid(p + py) && csp_valid(p + px + py);",
      "    if(allValid){",
      "      float a = csp_height(p - px - py), b = csp_height(p - py), c = csp_height(p + px - py);",
      "      float d = csp_height(p - px), f = csp_height(p + px);",
      "      float g = csp_height(p - px + py), q = csp_height(p + py), k = csp_height(p + px + py);",
      /* Shaded styles use the relief-scaled resolution (reliefResolution);
       * every other style uses the true ground resolution. */
      "      bool shaded = u_style == 0 || u_style == 1 || u_style == 5;",
      "      float zFactor = 1.0 + 0.024 * pow(max(groundRes, 0.0), 0.664);",
      "      float res = shaded ? groundRes / zFactor : groundRes;",
      "      float dxS = ((c + 2.0 * f + k) - (a + 2.0 * d + g)) / (8.0 * res);",
      "      float dyS = ((g + 2.0 * q + k) - (a + 2.0 * b + c)) / (8.0 * res);",
      /* Screen axes into east/north by the bearing, then back to the
       * raster convention (dzdx east, dzdy south) the ports below use. */
      "      float dx = dxS * cosB + dyS * sinB;",
      "      float north = dxS * sinB - dyS * cosB;",
      "      float dy = -north;",
      "      vec4 colour = vec4(0.0);",
      "      bool painted = true;",
      "      if(u_style == 2){",
      "        colour = vec4(cspSlopeColour(degrees(atan(length(vec2(dx, dy))))), 1.0);",
      "      } else if(u_style == 3){",
      "        if(length(vec2(dx, dy)) <= tan(radians(0.5))) painted = false;",
      "        else colour = vec4(cspAspectColour(cspAspectOf(dx, dy)), 1.0);",
      "      } else if(u_style == 4){",
      "        if(length(vec2(dx, dy)) <= tan(radians(0.5))) painted = false;",
      "        else {",
      "          float northness = cos(radians(cspAspectOf(dx, dy))), amount = abs(northness);",
      "          vec3 neutral = vec3(247.0, 243.0, 224.0) / 255.0;",
      "          vec3 target = (northness >= 0.0 ? vec3(55.0, 137.0, 92.0) : vec3(214.0, 82.0, 78.0)) / 255.0;",
      "          colour = vec4(mix(neutral, target, amount), 1.0);",
      "        }",
      "      } else if(u_style >= 6){",
      "        float interval = u_style == 6 ? 2.0 : u_style == 7 ? 5.0 : u_style == 8 ? 10.0 : 25.0;",
      "        float perPixel = length(vec2(dx, dy)) * res * 3.28084;",
      "        if(perPixel > 0.0){",
      "          float spacing = interval / perPixel;",
      "          if(spacing < 3.0){ if(spacing * 5.0 >= 3.0) interval *= 5.0; else painted = false; }",
      "        }",
      "        if(painted){",
      "          float multiple = value * 3.28084 / interval;",
      "          float distanceToLine = abs(multiple - round(multiple)) * interval;",
      "          float lineWidth = max(0.35, min(interval * 0.5, perPixel * 0.7));",
      "          if(distanceToLine >= lineWidth) painted = false;",
      "          else {",
      "            bool indexLine = abs(mod(round(multiple), 5.0)) < 0.5;",
      "            colour = indexLine ? vec4(vec3(120.0, 70.0, 40.0) / 255.0, 1.0) : vec4(vec3(150.0, 110.0, 80.0) / 255.0, 200.0 / 255.0);",
      "          }",
      "        }",
      "      } else if(u_style == 5){",
      "        float shade = u_ambient + (1.0 - u_ambient) * cspDirectShade(dx, dy, u_sunAzimuth);",
      "        colour = vec4(min(cspTintColour(value) * (0.33 + 0.82 * shade), vec3(1.0)), 1.0);",
      "      } else if(u_style == 1){",
      "        float aspect = cspAspectOf(dx, dy);",
      "        float sum = 0.0, total = 0.0;",
      "        for(int index = 0; index < 4; index++){",
      "          float az = u_sunAzimuth - 90.0 + 45.0 * float(index);",
      /* s*s, never a power call on s: GLSL power is undefined for a
       * negative base and Apple GPUs return NaN (see TerrainGpuRenderer). */
      "          float s = sin(radians(aspect - mod(az, 360.0)));",
      "          float weight = length(vec2(dx, dy)) < 1.0e-12 ? 1.0 : s * s;",
      "          sum += weight * cspDirectShade(dx, dy, az);",
      "          total += weight;",
      "        }",
      "        float direct = sum / max(total, 0.00001);",
      "        float shade = u_ambient + (1.0 - u_ambient) * direct;",
      "        colour = vec4(vec3(shade), 1.0);",
      "      } else {",
      "        float direct = cspDirectShade(dx, dy, u_sunAzimuth);",
      "        float shade = u_ambient + (1.0 - u_ambient) * direct;",
      "        colour = vec4(vec3(shade), 1.0);",
      "      }",
      "      if(painted){",
      /* Appearance filter on the straight colour, then premultiply and
       * apply terrain opacity (filter findings documented above). */
      "        vec3 straight = colour.a > 0.0 ? cspApplyAppearance(colour.rgb) : vec3(0.0);",
      "        terrain = vec4(straight * colour.a, colour.a) * u_terrainOpacity;",
      "      }",
      "    }",
      "  }",
      /* Spectrum source-over terrain, premultiplied. */
      "  fragColor = spectrum + terrain * (1.0 - spectrum.a);",
      "}"
    ].join("\n");
  }

  /* GLSL for the layer stack: optional aux-field fallbacks, the context
   * struct, ramps, blend modes, per-style values and the compositor. */
  function stackSource() {
    var custom = customStyles.map(function (style) {
      return "vec2 cspCustom" + style.id + "(inout CspCtx c){\n" + style.glsl + "\n}";
    });
    var dispatch = customStyles.map(function (style) {
      return "  if(style == " + style.id + ") return cspCustom" + style.id + "(c);";
    });
    return [
      /* An engine that provides filtered fields defines CSP_HAS_AUX and the
       * two readers; any other prelude gets "unavailable". */
      "#ifndef CSP_HAS_AUX",
      "bool csp_blur(ivec2 p, out float v){ v = 0.0; return false; }",
      "bool csp_base(ivec2 p, out float v){ v = 0.0; return false; }",
      "#endif",
      "#define CSP_MAX_LAYERS " + MAX_LAYERS,
      "#define CSP_MAX_STOPS " + MAX_STOPS,
      "#define CSP_STOP_VECS " + STOP_VECS,
      "struct CspCtx { ivec2 p; float height; float base; float dx; float dy; float sdx; float sdy; float res; float slope; float aspect; };",
      /* Unsharp mask on the height field: detail > 0 sharpens, -1 is the
       * full blur. Without a blurred field this is the raw height. */
      "float cspH(ivec2 q){",
      "  float h = csp_height(q), b;",
      "  if(u_detail != 0.0 && csp_blur(q, b)) h += u_detail * (h - b);",
      "  return h;",
      "}",
      "float cspStopPos(int layer, int k){ vec4 v = u_layerPos[layer * CSP_STOP_VECS + k / 4]; int m = k - (k / 4) * 4;",
      "  return m == 0 ? v.x : m == 1 ? v.y : m == 2 ? v.z : v.w; }",
      "vec4 cspRampAt(int layer, float t){",
      "  int count = int(u_layerA[layer].w + 0.5);",
      "  int base = layer * CSP_MAX_STOPS;",
      "  if(count <= 1 || t <= cspStopPos(layer, 0)) return u_layerColors[base];",
      "  for(int k = 1; k < CSP_MAX_STOPS; k++){",
      "    if(k >= count) break;",
      "    float p1 = cspStopPos(layer, k);",
      "    if(t <= p1){",
      "      float p0 = cspStopPos(layer, k - 1);",
      "      return mix(u_layerColors[base + k - 1], u_layerColors[base + k], clamp((t - p0) / max(p1 - p0, 1.0e-6), 0.0, 1.0));",
      "    }",
      "  }",
      "  return u_layerColors[base + count - 1];",
      "}",
      "vec4 cspPalette(int layer, float value){",
      "  vec4 r = u_layerB[layer];",
      "  float t = clamp((value - r.x) / (r.y - r.x), 0.0, 1.0);",
      "  t = pow(max(t, 0.0), r.z);",
      "  if(r.w >= 2.0) t = min(floor(t * r.w), r.w - 1.0) / (r.w - 1.0);",
      "  return cspRampAt(layer, t);",
      "}",
      /* W3C Compositing Level 1 blend modes on straight colour. */
      "float cspLum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }",
      "vec3 cspClipColour(vec3 c){",
      "  float l = cspLum(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);",
      "  if(n < 0.0) c = l + (c - l) * l / max(l - n, 1.0e-6);",
      "  if(x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1.0e-6);",
      "  return c;",
      "}",
      "vec3 cspSetLum(vec3 c, float l){ return cspClipColour(c + (l - cspLum(c))); }",
      "vec3 cspHardLight(vec3 b, vec3 s){",
      "  return mix(b * 2.0 * s, 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)), step(0.5, s));",
      "}",
      "vec3 cspSoftLight(vec3 b, vec3 s){",
      "  vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));",
      "  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));",
      "}",
      "vec3 cspBlendMode(int mode, vec3 b, vec3 s){",
      "  if(mode == 1) return b * s;",
      "  if(mode == 2) return b + s - b * s;",
      "  if(mode == 3) return cspHardLight(s, b);",
      "  if(mode == 4) return cspSoftLight(b, s);",
      "  if(mode == 5) return cspHardLight(b, s);",
      "  if(mode == 6) return min(b, s);",
      "  if(mode == 7) return max(b, s);",
      "  if(mode == 8) return cspSetLum(s, cspLum(b));",
      "  if(mode == 9) return cspSetLum(b, cspLum(s));",
      "  return s;",
      "}",
      /* Source over a premultiplied backdrop with a separable blend. */
      "vec4 cspComposite(vec4 backdrop, vec3 s, float as, int mode){",
      "  float ab = backdrop.a;",
      "  vec3 b = ab > 0.0 ? backdrop.rgb / ab : vec3(0.0);",
      "  vec3 mixed = (1.0 - ab) * s + ab * clamp(cspBlendMode(mode, b, s), 0.0, 1.0);",
      "  return vec4(as * mixed + (1.0 - as) * backdrop.rgb, as + ab * (1.0 - as));",
      "}",
      "float cspShadeAt(float dx, float dy, float azimuth){",
      "  return u_ambient + (1.0 - u_ambient) * cspDirectShade(dx, dy, azimuth);",
      "}",
      "float cspMultiShade(float dx, float dy){",
      "  float aspect = cspAspectOf(dx, dy), sum = 0.0, total = 0.0;",
      "  for(int index = 0; index < 4; index++){",
      "    float az = u_sunAzimuth - 90.0 + 45.0 * float(index);",
      "    float s = sin(radians(aspect - mod(az, 360.0)));",
      "    float weight = length(vec2(dx, dy)) < 1.0e-12 ? 1.0 : s * s;",
      "    sum += weight * cspDirectShade(dx, dy, az);",
      "    total += weight;",
      "  }",
      "  return u_ambient + (1.0 - u_ambient) * sum / max(total, 0.00001);",
      "}",
      custom.join("\n"),
      "vec2 cspCustomStyle(int style, inout CspCtx c){",
      dispatch.join("\n"),
      "  return vec2(0.0);",
      "}",
      /* (value, coverage) for one layer. param: contour interval in feet for
       * contour styles; for tint/rem, the strength of built-in relief shading. */
      "vec2 cspLayerValue(int style, float param, inout CspCtx c){",
      "  if(style == 0) return vec2(cspShadeAt(c.sdx, c.sdy, u_sunAzimuth), 1.0);",
      "  if(style == 1) return vec2(cspMultiShade(c.sdx, c.sdy), 1.0);",
      "  if(style == 2) return vec2(c.slope, 1.0);",
      "  if(style == 3) return c.aspect < 0.0 ? vec2(0.0) : vec2(c.aspect, 1.0);",
      "  if(style == 4) return c.aspect < 0.0 ? vec2(0.0) : vec2(cos(radians(c.aspect)), 1.0);",
      "  if(style == 5) return vec2(c.height, 1.0);",
      "  if(style == 10) return vec2(max(0.0, c.height - c.base), 1.0);",
      "  if((style >= 6 && style <= 9) || style == 11){",
      "    float interval = style == 6 ? 2.0 : style == 7 ? 5.0 : style == 8 ? 10.0 : style == 9 ? 25.0 : max(0.5, param);",
      "    float perPixel = length(vec2(c.dx, c.dy)) * c.res * 3.28084;",
      "    if(perPixel > 0.0){",
      "      float spacing = interval / perPixel;",
      "      if(spacing < 3.0){ if(spacing * 5.0 >= 3.0) interval *= 5.0; else return vec2(0.0); }",
      "    }",
      "    float multiple = c.height * 3.28084 / interval;",
      "    float distanceToLine = abs(multiple - round(multiple)) * interval;",
      "    float lineWidth = max(0.35, min(interval * 0.5, perPixel * 0.7));",
      "    if(distanceToLine >= lineWidth) return vec2(0.0);",
      "    bool indexLine = abs(mod(round(multiple), 5.0)) < 0.5;",
      "    return vec2(indexLine ? 1.0 : 0.0, 1.0);",
      "  }",
      "  if(style >= " + CUSTOM_BASE + ") return cspCustomStyle(style, c);",
      "  return vec2(0.0);",
      "}",
      "vec4 cspStack(ivec2 p, float value, float groundRes, float cosB, float sinB){",
      "  ivec2 px = ivec2(1, 0), py = ivec2(0, 1);",
      "  if(!(csp_valid(p - px - py) && csp_valid(p - py) && csp_valid(p + px - py) && csp_valid(p - px) && csp_valid(p + px)",
      "    && csp_valid(p - px + py) && csp_valid(p + py) && csp_valid(p + px + py))) return vec4(0.0);",
      "  float a = cspH(p - px - py), b = cspH(p - py), cc = cspH(p + px - py);",
      "  float d = cspH(p - px), f = cspH(p + px);",
      "  float g = cspH(p - px + py), q = cspH(p + py), k = cspH(p + px + py);",
      "  float dxS = ((cc + 2.0 * f + k) - (a + 2.0 * d + g)) / (8.0 * groundRes);",
      "  float dyS = ((g + 2.0 * q + k) - (a + 2.0 * b + cc)) / (8.0 * groundRes);",
      "  CspCtx c;",
      "  c.p = p; c.height = value; c.res = groundRes;",
      "  c.dx = dxS * cosB + dyS * sinB;",
      "  c.dy = -(dxS * sinB - dyS * cosB);",
      /* Lighting keeps the relief-scaled resolution of the legacy styles,
       * times the user's relief exaggeration. */
      "  float zFactor = 1.0 + 0.024 * pow(max(groundRes, 0.0), 0.664);",
      "  c.sdx = c.dx * zFactor * u_reliefExag; c.sdy = c.dy * zFactor * u_reliefExag;",
      "  c.slope = degrees(atan(length(vec2(c.dx, c.dy))));",
      "  c.aspect = length(vec2(c.dx, c.dy)) <= tan(radians(0.5)) ? -1.0 : cspAspectOf(c.dx, c.dy);",
      "  float baseValue;",
      "  c.base = csp_base(p, baseValue) ? baseValue : u_remFlatBase;",
      "  vec4 acc = vec4(0.0);",
      "  for(int i = 0; i < CSP_MAX_LAYERS; i++){",
      "    if(float(i) >= u_layerCount) break;",
      "    vec4 layer = u_layerA[i];",
      "    int style = int(layer.x + 0.5);",
      "    float param = u_layerC[i].x;",
      "    vec2 v = cspLayerValue(style, param, c);",
      "    if(v.y <= 0.0) continue;",
      "    vec4 colour = cspPalette(i, v.x);",
      /* Built-in relief shading for elevation-like layers (legacy tint look). */
      "    if((style == 5 || style == 10) && param > 0.0){",
      "      float shade = u_ambient + (1.0 - u_ambient) * cspDirectShade(c.sdx, c.sdy, u_sunAzimuth);",
      "      colour.rgb = min(colour.rgb * mix(1.0, 0.33 + 0.82 * shade, clamp(param, 0.0, 1.0)), vec3(1.0));",
      "    }",
      "    float alpha = clamp(colour.a * v.y * layer.y, 0.0, 1.0);",
      "    if(alpha <= 0.0) continue;",
      "    acc = cspComposite(acc, colour.rgb, alpha, int(layer.z + 0.5));",
      "  }",
      "  if(acc.a <= 0.0) return vec4(0.0);",
      "  vec3 straight = cspApplyAppearance(acc.rgb / acc.a);",
      "  return vec4(straight * acc.a, acc.a) * u_terrainOpacity;",
      "}"
    ].join("\n");
  }

  return Object.freeze({
    VERSION: "1",
    MAX_LAYERS: MAX_LAYERS,
    MAX_STOPS: MAX_STOPS,
    BLEND_IDS: BLEND_IDS,
    UNIFORM_ARRAYS: UNIFORM_ARRAYS,
    registerStyle: registerStyle,
    stackUniforms: stackUniforms,
    styleId: styleId,
    customStyles: function () { return customStyles.map(function (s) { return {name: s.name, id: s.id}; }); },
    STYLE_IDS: STYLE_IDS,
    fullscreenVertexSource: fullscreenVertexSource,
    SHADE_UNIFORMS: SHADE_UNIFORMS,
    shadeFragmentSource: shadeFragmentSource,
    uniformValues: uniformValues,
    cssFilterReference: cssFilterReference,
    metersPerPixel: metersPerPixel,
    screenToMercator: screenToMercator,
    latitudeFromMercatorY: latitudeFromMercatorY,
    reliefZFactor: reliefZFactor,
    rotateGradient: rotateGradient
  });
}));
