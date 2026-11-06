// Resamples the world-anchored terrain store at each screen pixel centre into
// the screen field the shading program reads (float metres, top-down).
//
// The affine screen -> store mapping is computed in f64 on the CPU relative
// to the store's origin, so large Mercator coordinates never reach f32.

const INVALID: f32 = -3.0e38;

struct Params {
    // Store texel coordinate (texel centres at integers) of pixel (0,0).
    origin: vec2<f32>,
    axis_x: vec2<f32>,
    axis_y: vec2<f32>,
    // 1 when a store texel spans more than a screen pixel (magnification).
    magnify: u32,
    pad: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var store: texture_2d<f32>;
@group(0) @binding(2) var field: texture_storage_2d<r32float, write>;

fn valid(v: f32) -> bool {
    return (bitcast<u32>(v) & 0x7fffffffu) < 0x7f800000u && v > -1.0e20;
}

fn at(p: vec2<i32>, size: vec2<i32>) -> f32 {
    if any(p < vec2<i32>(0)) || any(p >= size) {
        return INVALID;
    }
    return textureLoad(store, p, 0).r;
}

fn cubic(t: f32) -> vec4<f32> {
    let t2 = t * t;
    let t3 = t2 * t;
    return vec4<f32>(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2) * 0.5;
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let out = textureDimensions(field);
    if any(id.xy >= out) {
        return;
    }
    let size = vec2<i32>(textureDimensions(store));
    let p = params.origin + f32(id.x) * params.axis_x + f32(id.y) * params.axis_y;
    let b = vec2<i32>(floor(p));
    let f = p - vec2<f32>(b);
    if params.magnify != 0u {
        let wx = cubic(f.x);
        let wy = cubic(f.y);
        var value = 0.0;
        var complete = true;
        for (var y = 0; y < 4; y++) {
            for (var x = 0; x < 4; x++) {
                let v = at(b + vec2<i32>(x - 1, y - 1), size);
                if valid(v) {
                    value += v * wx[x] * wy[y];
                } else {
                    complete = false;
                }
            }
        }
        if complete {
            textureStore(field, vec2<i32>(id.xy), vec4<f32>(value, 0.0, 0.0, 0.0));
            return;
        }
    }
    var sum = 0.0;
    var weight = 0.0;
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            let v = at(b + vec2<i32>(x, y), size);
            let w = select(f.x, 1.0 - f.x, x == 0) * select(f.y, 1.0 - f.y, y == 0);
            if valid(v) && w > 0.0 {
                sum += v * w;
                weight += w;
            }
        }
    }
    let value = select(INVALID, sum / weight, weight > 0.0);
    textureStore(field, vec2<i32>(id.xy), vec4<f32>(value, 0.0, 0.0, 0.0));
}
