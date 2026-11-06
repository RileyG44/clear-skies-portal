// Composites display-level store tiles from pooled 256x256 source tiles.
//
// One job is one store slot (256x256 texels at the display level). Its draws
// are ordered lowest priority first (rank, then level), as terrain.rs plans
// them; the last draw with a valid sample wins each texel, so a higher-ranked
// survey is never overwritten by later lower-ranked data and its no-data
// reveals the terrain below. Composition runs when tiles arrive or the store
// re-anchors, never per frame.

const TILE: i32 = 256;
const INVALID: f32 = -3.0e38;

struct Draw {
    // Native texel coordinate of slot texel (0,0), and native texels per
    // store texel (<1 magnifies a coarser ancestor, >1 averages finer data).
    origin: vec2<f32>,
    scale: f32,
    rank: f32,
    // Covered slot texels [x0,x1) x [y0,y1).
    rect: vec4<u32>,
    layer: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

struct Job {
    // Store texel of the slot's top-left texel.
    origin: vec2<u32>,
    first: u32,
    count: u32,
}

@group(0) @binding(0) var pool: texture_2d_array<f32>;
@group(0) @binding(1) var store: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<storage, read> jobs: array<Job>;
@group(0) @binding(3) var<storage, read> draws: array<Draw>;

// IEEE bit tests: fast-math compilers may fold NaN comparisons away.
fn valid(v: f32) -> bool {
    return (bitcast<u32>(v) & 0x7fffffffu) < 0x7f800000u && v > -1.0e20;
}

fn at(layer: u32, p: vec2<i32>) -> f32 {
    return textureLoad(pool, clamp(p, vec2<i32>(0), vec2<i32>(TILE - 1)), layer, 0).r;
}

fn cubic(t: f32) -> vec4<f32> {
    let t2 = t * t;
    let t3 = t2 * t;
    return vec4<f32>(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2) * 0.5;
}

// (value, 1) for a valid sample, (INVALID, 0) otherwise.
fn sample(d: Draw, t: vec2<u32>) -> vec2<f32> {
    let p = d.origin + vec2<f32>(t) * d.scale;
    if d.scale > 1.0 {
        // Finer data: the mean of the valid texels this store texel covers.
        let n = i32(round(d.scale));
        let start = vec2<i32>(round(p + vec2<f32>(0.5 - 0.5 * d.scale)));
        var sum = 0.0;
        var count = 0.0;
        for (var y = 0; y < n; y++) {
            for (var x = 0; x < n; x++) {
                let v = at(d.layer, start + vec2<i32>(x, y));
                if valid(v) {
                    sum += v;
                    count += 1.0;
                }
            }
        }
        return select(vec2<f32>(INVALID, 0.0), vec2<f32>(sum / count, 1.0), count > 0.0);
    }
    if d.scale == 1.0 {
        let v = at(d.layer, vec2<i32>(round(p)));
        return select(vec2<f32>(INVALID, 0.0), vec2<f32>(v, 1.0), valid(v));
    }
    // A coarser ancestor, magnified: Catmull-Rom where all 16 taps are
    // valid, otherwise bilinear over the valid taps (the web display rule).
    let b = vec2<i32>(floor(p));
    let f = p - vec2<f32>(b);
    let wx = cubic(f.x);
    let wy = cubic(f.y);
    var value = 0.0;
    var complete = true;
    for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
            let v = at(d.layer, b + vec2<i32>(x - 1, y - 1));
            if valid(v) {
                value += v * wx[x] * wy[y];
            } else {
                complete = false;
            }
        }
    }
    if complete {
        return vec2<f32>(value, 1.0);
    }
    var sum = 0.0;
    var weight = 0.0;
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            let v = at(d.layer, b + vec2<i32>(x, y));
            let w = select(f.x, 1.0 - f.x, x == 0) * select(f.y, 1.0 - f.y, y == 0);
            if valid(v) && w > 0.0 {
                sum += v * w;
                weight += w;
            }
        }
    }
    return select(vec2<f32>(INVALID, 0.0), vec2<f32>(sum / weight, 1.0), weight > 0.0);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let job = jobs[id.z];
    let t = id.xy;
    var result = vec2<f32>(INVALID, 0.0);
    for (var i = job.count; i > 0u; i--) {
        let d = draws[job.first + i - 1u];
        if any(t < d.rect.xy) || any(t >= d.rect.zw) {
            continue;
        }
        let s = sample(d, t);
        if s.y > 0.0 {
            result = vec2<f32>(s.x, d.rank);
            break;
        }
    }
    textureStore(store, vec2<i32>(job.origin + t), vec4<f32>(result, 0.0, 0.0));
}
