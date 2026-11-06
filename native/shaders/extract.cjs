"use strict";
// Build-time extraction only. No fork of the style math lives in the native
// renderer. Every uniform gets an explicit 16-byte slot (arrays: one per vec4).
const fs = require("node:fs");
const path = require("node:path");
const shaders = require("../../gpu-terrain-shaders.js");
const output = process.argv[2];
if (!output) throw new Error("usage: node native/shaders/extract.cjs OUTPUT_DIR");
fs.mkdirSync(output, {recursive: true});

shaders.registerStyle({name: "native_reference", glsl:
  "return vec2(mod(c.height, 17.0) / 17.0, c.height == c.height ? 1.0 : 0.0);"});
const prelude = `
bool csk_isnan(float v){return (floatBitsToUint(v)&0x7fffffffu)>0x7f800000u;}
bool csk_isinf(float v){return (floatBitsToUint(v)&0x7fffffffu)==0x7f800000u;}
layout(set=0,binding=1) uniform texture2D csk_heights;
layout(set=0,binding=2) uniform utexture2D csk_ranks;
ivec2 csp_size(){return textureSize(csk_heights,0);}
ivec2 csk_clamp(ivec2 p){return clamp(p,ivec2(0),csp_size()-1);}
float csp_height(ivec2 p){return texelFetch(csk_heights,csk_clamp(p),0).r;}
int csp_rank(ivec2 p){return int(texelFetch(csk_ranks,csk_clamp(p),0).r);}
bool csp_valid(ivec2 p){float h=csp_height(p);return csp_rank(p)>0&&!isnan(h)&&!isinf(h)&&h>-1e20;}
// Aux fields use (height, validity); absent fields contain validity zero.
#define CSP_HAS_AUX 1
#define CSP_HAS_LAND_BASE 1
layout(set=0,binding=4) uniform texture2D csk_blur;
layout(set=0,binding=5) uniform texture2D csk_base;
layout(set=0,binding=6) uniform texture2D csk_land;
bool csk_aux(texture2D image,ivec2 p,out float v){vec2 a=texelFetch(image,clamp(p,ivec2(0),textureSize(image,0)-1),0).rg;v=a.r;return a.g>0.&&!isnan(v)&&!isinf(v);}
bool csp_blur(ivec2 p,out float v){return csk_aux(csk_blur,p,v);}
bool csp_base(ivec2 p,out float v){return csk_aux(csk_base,p,v);}
bool csp_landBase(ivec2 p,out float v){return csk_aux(csk_land,p,v);}
`;
const uniforms = {};
let offset = 0;
let fragment = shaders.shadeFragmentSource(prelude);
const declarations = [];
fragment = fragment.replace(/^uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)(?:\[(\d+)\])?;/gm,
  (_, type, name, count) => {
    if (type === "usampler2D") return `layout(set=0,binding=3) uniform utexture2D ${name};`;
    const length = Number(count || 1);
    uniforms[name] = {offset, type, count: length};
    declarations.push(`layout(offset=${offset}) ${type} ${name}${count ? `[${count}]` : ""};`);
    // Naga's WGSL writer does not retain arbitrary SPIR-V member gaps.
    // Explicit scalar padding makes the layouts identical in every language.
    const components = type === "vec4" ? 4 : type === "vec3" ? 3 : type === "vec2" ? 2 : 1;
    if (!count) for (let i = components; i < 4; i++)
      declarations.push(`float csk_pad_${name}_${i};`);
    offset += 16 * length;
    return "";
  });
// Every rewrite must match the factory source. A silent miss would let the
// native shaders drift from the web renderer, so a changed source fails here.
function rewrite(source, label, pattern, replacement) {
  const matches = typeof pattern === "string" ? source.split(pattern).length - 1 : (source.match(pattern) || []).length;
  if (matches === 0) throw new Error(`extract.cjs: ${label} rewrite matched nothing; update it with the JS shader factory`);
  return source.replace(pattern, replacement);
}
fragment = rewrite(fragment, "fragment version", "#version 300 es", `#version 450\n#extension GL_EXT_samplerless_texture_functions: require\nlayout(std140,set=0,binding=0) uniform CskUniforms {\n${declarations.join("\n")}\n};`);
fragment = rewrite(fragment, "isnan", /\bisnan\(/g, "csk_isnan(");
fragment = fragment.replace(/\bisinf\(/g, "csk_isinf(");
fragment = rewrite(fragment, "precision", /precision highp float;/g, "");
fragment = rewrite(fragment, "fragment input", "in vec2 v_screenUv;", "layout(location=0) in vec2 v_screenUv;");
fragment = rewrite(fragment, "fragment output", "out vec4 fragColor;", "layout(location=0) out vec4 fragColor;");
// The original fullscreen vertex is GL-oriented. Naga's SPIR-V front end
// converts Vulkan Y-down clip coordinates; UVs retain top-left row order.
let vertex = rewrite(shaders.fullscreenVertexSource, "vertex version", "#version 300 es", "#version 450");
vertex = rewrite(vertex, "vertex output", "out vec2 v_screenUv;", "layout(location=0) out vec2 v_screenUv;");
vertex = rewrite(vertex, "vertex index", /gl_VertexID/g, "gl_VertexIndex");
vertex = rewrite(vertex, "vertex flip", "vec2(p.x,1.0-p.y)", "p");
fs.writeFileSync(path.join(output, "shade.frag"), fragment);
fs.writeFileSync(path.join(output, "fullscreen.vert"), vertex);
fs.writeFileSync(path.join(output, "uniforms.json"), JSON.stringify({bytes: offset, uniforms}, null, 2) + "\n");
const defaults = shaders.uniformValues({}, {cssSize: [256, 256], dpr: 1, zoom: 14, centerMerc: [0.5, 0.5]});
const data = Buffer.alloc(offset);
for (const [name, spec] of Object.entries(uniforms)) {
  const values = Array.isArray(defaults[name]) ? defaults[name] : [defaults[name]];
  const components = spec.type === "vec4" ? 4 : spec.type === "vec3" ? 3 : spec.type === "vec2" ? 2 : 1;
  for (let i = 0; i < values.length; i++) {
    const at = spec.offset + Math.floor(i / components) * 16 + i % components * 4;
    if (spec.type === "int") data.writeInt32LE(values[i], at);
    else data.writeFloatLE(values[i], at);
  }
}
fs.writeFileSync(path.join(output, "defaults.bin"), data);
