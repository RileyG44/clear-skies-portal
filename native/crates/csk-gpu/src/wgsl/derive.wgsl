// Derived fields of the terrain store: the Detail blur and the
// relative-elevation (REM) valley floor, in the world-anchored store's texel
// space, so they are rebuilt only when the store's terrain changes.
//
// A field is the store downsampled by an integer factor (block mean for the
// blur, block minimum for a floor), then for a floor an exact separable
// minimum over [-radius, radius], then a separable Gaussian with
// sigma = max(0.5, radius / 2) normalized over valid samples. Values are
// float metres; INVALID (<= -1e20) or non-finite is no data. A land-only floor
// skips water texels of the bundled geography when reading the store.
//
// Entry points share one layout: `rows` reduces store rows into `scratch`
// (accumulator, count), `cols` finishes the 2D block into `dst`, and
// `erode` and `gauss` filter `src` into `dst` along `dir`.

const INVALID: f32 = -3.0e38;
const PI: f32 = 3.141592653589793;

struct Params {
    dir: vec2<i32>,
    factor: u32,
    radius: u32,
    // 0: block mean, 1: block minimum.
    minimum: u32,
    // Skip water texels (land-only floor).
    land: u32,
    src_height: u32,
    out_width: u32,
    // Mercator of store coordinate (0, 0) (a texel's corner) and of one texel.
    merc_origin: vec2<f32>,
    merc_step: f32,
    sigma: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<r32float, write>;
@group(0) @binding(3) var<storage, read_write> scratch: array<vec2<f32>>;
@group(0) @binding(4) var mask: texture_2d<u32>;

// IEEE bit test: fast-math compilers may fold NaN comparisons away.
fn valid(v: f32) -> bool {
    return (bitcast<u32>(v) & 0x7fffffffu) < 0x7f800000u && v > -1.0e20;
}

// 0: dry land, 1: ocean, 2: inland water (water-geography.js).
fn water_class(merc: vec2<f32>) -> u32 {
    let latitude = degrees(atan(sinh(PI * (1.0 - 2.0 * merc.y))));
    let q = vec2<i32>(
        i32(min(16383.0, floor(fract(merc.x) * 16384.0))),
        i32(clamp(floor((90.0 - latitude) / 180.0 * 8192.0), 0.0, 8191.0)),
    );
    let size = vec2<i32>(textureDimensions(mask));
    let packed = textureLoad(mask, min(vec2<i32>(q.x / 8, q.y / 4), size - 1), 0);
    return (packed[q.y % 4] >> u32(14 - 2 * (q.x % 8))) & 3u;
}

fn store_value(p: vec2<i32>) -> f32 {
    let v = textureLoad(src, p, 0).r;
    if !valid(v) {
        return INVALID;
    }
    if params.land != 0u {
        let merc = params.merc_origin + (vec2<f32>(p) + 0.5) * params.merc_step;
        if water_class(merc) != 0u {
            return INVALID;
        }
    }
    return v;
}

fn combine(acc: vec2<f32>, v: f32, weight: f32) -> vec2<f32> {
    if params.minimum != 0u {
        return vec2<f32>(min(acc.x, v), acc.y + weight);
    }
    return vec2<f32>(acc.x + v * weight, acc.y + weight);
}

fn start() -> vec2<f32> {
    return vec2<f32>(select(0.0, 3.0e38, params.minimum != 0u), 0.0);
}

@compute @workgroup_size(16, 16, 1)
fn rows(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<i32>(textureDimensions(src));
    if id.x >= params.out_width || i32(id.y) >= size.y {
        return;
    }
    var acc = start();
    let x0 = i32(id.x * params.factor);
    for (var k = 0; k < i32(params.factor); k++) {
        let x = x0 + k;
        if x >= size.x {
            break;
        }
        let v = store_value(vec2<i32>(x, i32(id.y)));
        if v > -1.0e20 {
            acc = combine(acc, v, 1.0);
        }
    }
    scratch[id.y * params.out_width + id.x] = acc;
}

@compute @workgroup_size(16, 16, 1)
fn cols(@builtin(global_invocation_id) id: vec3<u32>) {
    let out = textureDimensions(dst);
    if any(id.xy >= out) {
        return;
    }
    var acc = start();
    let y0 = id.y * params.factor;
    for (var k = 0u; k < params.factor; k++) {
        let y = y0 + k;
        if y >= params.src_height {
            break;
        }
        let row = scratch[y * params.out_width + id.x];
        if row.y > 0.0 {
            if params.minimum != 0u {
                acc = vec2<f32>(min(acc.x, row.x), acc.y + row.y);
            } else {
                acc += row;
            }
        }
    }
    var value = INVALID;
    if acc.y > 0.0 {
        value = select(acc.x / acc.y, acc.x, params.minimum != 0u);
    }
    textureStore(dst, vec2<i32>(id.xy), vec4<f32>(value, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(16, 16, 1)
fn erode(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<i32>(textureDimensions(src));
    let o = vec2<i32>(id.xy);
    if any(o >= size) {
        return;
    }
    var acc = 3.0e38;
    var any_valid = false;
    let r = i32(params.radius);
    for (var k = -r; k <= r; k++) {
        let q = o + params.dir * k;
        if any(q < vec2<i32>(0)) || any(q >= size) {
            continue;
        }
        let v = textureLoad(src, q, 0).r;
        if valid(v) {
            acc = min(acc, v);
            any_valid = true;
        }
    }
    textureStore(dst, o, vec4<f32>(select(INVALID, acc, any_valid), 0.0, 0.0, 0.0));
}

@compute @workgroup_size(16, 16, 1)
fn gauss(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<i32>(textureDimensions(src));
    let o = vec2<i32>(id.xy);
    if any(o >= size) {
        return;
    }
    var sum = 0.0;
    var weight = 0.0;
    let r = i32(params.radius);
    let s = 2.0 * params.sigma * params.sigma;
    for (var k = -r; k <= r; k++) {
        let q = o + params.dir * k;
        if any(q < vec2<i32>(0)) || any(q >= size) {
            continue;
        }
        let v = textureLoad(src, q, 0).r;
        if valid(v) {
            let g = exp(-f32(k * k) / s);
            sum += v * g;
            weight += g;
        }
    }
    textureStore(dst, o, vec4<f32>(select(INVALID, sum / weight, weight > 0.0), 0.0, 0.0, 0.0));
}
