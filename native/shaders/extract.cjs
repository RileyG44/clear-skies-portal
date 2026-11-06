"use strict";
// Build-time extraction only. No fork of the terrain math lives in the native
// renderer: the shading program comes from the authoritative factory
// (gpu-terrain-shaders.js) and is translated from GLSL ES 3.00 to Vulkan GLSL
// for glslang. Every uniform gets an explicit 16-byte slot (arrays and matrix
// columns: one slot each). Tile composition and resampling are native
// designs (csk-gpu/src/wgsl), not translations of the WebGL engine.
const fs = require("node:fs");
const path = require("node:path");
const shaders = require("../../gpu-terrain-shaders.js");
const output = process.argv[2];
if (!output) throw new Error("usage: node native/shaders/extract.cjs OUTPUT_DIR");
fs.mkdirSync(output, {recursive: true});

shaders.registerStyle({name: "native_reference", glsl:
  "return vec2(mod(c.height, 17.0) / 17.0, c.height == c.height ? 1.0 : 0.0);"});

// Every rewrite must match its source. A silent miss would let the native
// shaders drift from the web renderer, so a changed source fails here.
function rewrite(source, label, pattern, replacement) {
  const matches = typeof pattern === "string" ? source.split(pattern).length - 1 : (source.match(pattern) || []).length;
  if (matches === 0) throw new Error(`extract.cjs: ${label} rewrite matched nothing; update it with the JS shader source`);
  return source.replace(pattern, replacement);
}

const COMPONENTS = {float: 1, int: 1, uint: 1, bool: 1, vec2: 2, ivec2: 2, vec3: 3, vec4: 4};
const DECLARATION = /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;{]+);/g;
const HELPERS = `
bool csk_isnan(float v){return (floatBitsToUint(v)&0x7fffffffu)>0x7f800000u;}
bool csk_isinf(float v){return (floatBitsToUint(v)&0x7fffffffu)==0x7f800000u;}
`;

/* One program: stages share a single uniform block (binding 0) with the
 * union of their uniforms; textures take bindings from 1 in declaration
 * order. GLSL samplers become sampler-less textures (texelFetch only). */
function translate(stages) {
  const uniforms = {}, textures = {}, members = [];
  let offset = 0, binding = 1;
  for (const source of Object.values(stages)) {
    for (const [, type, list] of source.matchAll(DECLARATION)) {
      for (const item of list.split(",").map((s) => s.trim())) {
        const [, name, count] = item.match(/^(\w+)(?:\[(\d+)\])?$/) || [];
        if (!name) throw new Error(`extract.cjs: unsupported uniform declaration "${item}"`);
        if (type === "sampler2D" || type === "usampler2D") {
          if (!textures[name]) textures[name] = {binding: binding++, kind: type === "usampler2D" ? "uint" : "float"};
          continue;
        }
        if (uniforms[name]) {
          if (uniforms[name].type !== type) throw new Error(`extract.cjs: ${name} changes type between stages`);
          continue;
        }
        const slots = type === "mat3" ? 3 : Number(count || 1);
        if (type !== "mat3" && !COMPONENTS[type]) throw new Error(`extract.cjs: unsupported uniform type ${type}`);
        uniforms[name] = {offset, type, count: Number(count || 1)};
        members.push(`layout(offset=${offset}) ${type} ${name}${count ? `[${count}]` : ""};`);
        // Naga's WGSL writer does not retain arbitrary SPIR-V member gaps.
        // Explicit scalar padding makes the layouts identical in every language.
        if (!count && type !== "mat3") for (let i = COMPONENTS[type]; i < 4; i++) members.push(`float csk_pad_${name}_${i};`);
        offset += 16 * slots;
      }
    }
  }
  const block = members.length ? `layout(std140,set=0,binding=0) uniform CskUniforms {\n${members.join("\n")}\n};\n` : "";
  const out = {};
  for (const [stage, source] of Object.entries(stages)) {
    const declares = [...source.matchAll(DECLARATION)].some(([, type]) => type !== "sampler2D" && type !== "usampler2D");
    let text = source.replace(DECLARATION, (_, type, list) => {
      if (type !== "sampler2D" && type !== "usampler2D") return "";
      const kind = type === "usampler2D" ? "utexture2D" : "texture2D";
      return list.split(",").map((s) => `layout(set=0,binding=${textures[s.trim()].binding}) uniform ${kind} ${s.trim()};`).join("\n");
    });
    // Remaining samplers are function parameters.
    text = text.replace(/\b(?:(?:highp|mediump|lowp)\s+)?usampler2D\b/g, "utexture2D")
      .replace(/\b(?:(?:highp|mediump|lowp)\s+)?sampler2D\b/g, "texture2D")
      .replace(/precision\s+(?:highp|mediump|lowp)\s+(?:float|int)\s*;/g, "")
      .replace(/\bisnan\(/g, "csk_isnan(").replace(/\bisinf\(/g, "csk_isinf(")
      .replace(/\bgl_VertexID\b/g, "gl_VertexIndex");
    let inputs = 0, outputs = 0;
    text = text.replace(/(^|[;}\n])(\s*)(in|out)\s+((?:highp\s+)?\w+\s+\w+;)/g, (_, lead, space, dir, rest) =>
      `${lead}${space}layout(location=${dir === "in" ? inputs++ : outputs++}) ${dir} ${rest}`);
    out[stage] = rewrite(text, `${stage} version`, "#version 300 es",
      `#version 450\n#extension GL_EXT_samplerless_texture_functions: require\n${HELPERS}${declares ? block : ""}`);
  }
  return {stages: out, layout: {bytes: offset, uniforms, textures}};
}

// GL-oriented fullscreen UVs become top-left; the native field is top-down.
const shadeVertex = rewrite(shaders.fullscreenVertexSource, "shade vertex flip", "vec2(p.x,1.0-p.y)", "p");

/* The native field contract (see csk-gpu/src/terrain.rs). The screen field is
 * the resampled terrain store: float32 metres, top-down, NaN where no source
 * answers. Derived fields live in the world-anchored store's texel space;
 * csk_auxTransform maps a field pixel centre into it and csk_*Scale is the
 * field's downsample factor (0 = absent). Validity is the value itself. */
const prelude = `
uniform highp sampler2D csk_field;
uniform highp sampler2D csk_blur,csk_base,csk_landBase;
uniform float csk_blurScale,csk_baseScale,csk_landBaseScale;
uniform mat3 csk_auxTransform;
#define CSP_HAS_AUX 1
#define CSP_HAS_LAND_BASE 1
ivec2 csp_size(){return textureSize(csk_field,0);}
float csp_height(ivec2 p){return texelFetch(csk_field,clamp(p,ivec2(0),csp_size()-1),0).r;}
bool csk_ok(float v){return !isnan(v)&&!isinf(v)&&v>-1e20;}
bool csp_valid(ivec2 p){return csk_ok(csp_height(p));}
int csp_rank(ivec2 p){return csp_valid(p)?1:0;}
#define CSK_AUX(NAME,TEX,SCALE) bool NAME(ivec2 p,out float v){v=0.;if(SCALE<=0.)return false;\\
vec2 q=(csk_auxTransform*vec3(vec2(p)+.5,1.)).xy/SCALE-.5;ivec2 b=ivec2(floor(q));vec2 fr=q-vec2(b);ivec2 ts=textureSize(TEX,0);float sum=0.,w=0.;\\
for(int y=0;y<2;y++)for(int x=0;x<2;x++){float a=texelFetch(TEX,clamp(b+ivec2(x,y),ivec2(0),ts-1),0).r;float k=(x==0?1.-fr.x:fr.x)*(y==0?1.-fr.y:fr.y);\\
if(csk_ok(a)&&k>0.){sum+=a*k;w+=k;}}if(w<=0.)return false;v=sum/w;return true;}
CSK_AUX(csp_blur,csk_blur,csk_blurScale)
CSK_AUX(csp_base,csk_base,csk_baseScale)
CSK_AUX(csp_landBase,csk_landBase,csk_landBaseScale)
`;

const programs = {shade: {vert: shadeVertex, frag: shaders.shadeFragmentSource(prelude)}};
const layouts = {};
for (const [name, stages] of Object.entries(programs)) {
  const program = translate(stages);
  for (const [stage, text] of Object.entries(program.stages)) fs.writeFileSync(path.join(output, `${name}.${stage}`), text);
  layouts[name] = program.layout;
}
fs.writeFileSync(path.join(output, "layouts.json"), JSON.stringify(layouts, null, 2) + "\n");

// Default shade appearance, packed as the native renderer uploads it.
const shade = layouts.shade;
const defaults = shaders.uniformValues({}, {cssSize: [256, 256], dpr: 1, zoom: 14, centerMerc: [0.5, 0.5]});
const data = Buffer.alloc(shade.bytes);
for (const [name, spec] of Object.entries(shade.uniforms)) {
  if (defaults[name] === undefined) continue;
  const values = Array.isArray(defaults[name]) || ArrayBuffer.isView(defaults[name]) ? Array.from(defaults[name]) : [defaults[name]];
  const components = spec.type === "mat3" ? 3 : COMPONENTS[spec.type];
  for (let i = 0; i < values.length; i++) {
    const at = spec.offset + Math.floor(i / components) * 16 + i % components * 4;
    if (spec.type === "int" || spec.type === "ivec2") data.writeInt32LE(values[i], at);
    else if (spec.type === "bool" || spec.type === "uint") data.writeUInt32LE(values[i] ? 1 : 0, at);
    else data.writeFloatLE(values[i], at);
  }
}
fs.writeFileSync(path.join(output, "defaults.bin"), data);

// Terrain looks for the native app state (csk-app): the palettes, styles,
// blends and looks of lidar-render.js, normalized by its own functions, with
// the shader's numeric ids. Content, not logic: the native app compiles them
// with its own port of buildStack/uniformValues, pinned by the cases below.
const R = require("../../lidar-render.js");
const looks = R.LOOKS.map(look => ({id: look.id, name: look.name, blurb: look.blurb, opacity: look.opacity,
  scene: R.normalizeScene(look.scene)}));
fs.writeFileSync(path.join(output, "terrain.json"), JSON.stringify({
  maxLayers: R.MAX_LAYERS, maxStops: R.MAX_STOPS,
  styleIds: Object.fromEntries(Object.entries(shaders.STYLE_IDS).filter(([id]) => R.STYLES[id])),
  blendIds: shaders.BLEND_IDS,
  palettes: R.PALETTES, styles: R.STYLES, overlayStyles: R.OVERLAY_STYLES.filter(id => R.STYLES[id]),
  blends: R.BLENDS, effectDefaults: R.EFFECT_DEFAULTS, looks,
}, null, 1) + "\n");

// Parity cases: every look applied, stacked with fitted ranges and drawn
// with adjusted appearance, lighting and elevation bands.
const view = {cssSize: [390, 844], dpr: 3, zoom: 13.4, centerMerc: [0.172, 0.359], bearing: 12};
const fits = [{base: [312, 1648], "overlay:0": [0, 41], "overlay:1": [2, 9]},
  {base: {land: [310, 1650], water: [-12, 0]}, "overlay:0": [0, 40]}];
const cases = looks.map((look, index) => {
  const applied = R.applyScene(R.emptyState(), look.scene, look.id);
  const fitted = fits[index % fits.length];
  const remFlatBase = index % 3 ? 0 : 287.5;
  const stack = R.buildStack(applied.state, applied.style, fitted, {remFlatBase});
  const input = {
    style: applied.style, opacity: look.opacity / 100,
    look: {brightness: 100 + index, contrast: 96 + 2 * index, saturation: 110 - index},
    lighting: {azimuth: 300 + index, altitude: 40 + index, ambient: 0.1 + index / 100},
    spectrum: index % 2 ? {} : {below: {enabled: true, level: 707.1, color: [0, 0.41, 0.51]}, bandAlpha: 0.35, bandFeather: 12.2,
      spectrumOn: index % 4 === 0, level: 900, span: 400, spectrumAlpha: 0.5},
  };
  const values = shaders.uniformValues({terrain: {style: input.style, opacity: input.opacity, look: input.look,
    lighting: input.lighting, stack}, spectrum: input.spectrum}, view);
  return {look: look.id, fitted, remFlatBase, input, view, stack, values};
});
fs.writeFileSync(path.join(output, "terrain-cases.json"), JSON.stringify(cases) + "\n");

// The display-only water geography (water-geography.js): its run-length
// packing, decoded natively into the same RGBA16UI mask the shader reads.
fs.writeFileSync(path.join(output, "water-mask.rle"), Buffer.from(require("../../water-geography-data.js"), "base64"));

