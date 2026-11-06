// Point-samples the screen field on a grid: what auto layers fit their colour
// ranges to. Each sample is (height, floor, land-only floor, water class):
// the floors are the derived REM fields read exactly as the shading program
// reads them (bilinear over valid texels), and the class is the bundled
// water geography at the sample (0 land, 1 ocean, 2 inland water).
// Missing values are INVALID.

const INVALID: f32 = -3.0e38;
const PI: f32 = 3.141592653589793;

struct Grid {
    size: vec2<u32>,
    pad: vec2<u32>,
    // Downsample factors of the floors; 0 = absent.
    base_scale: f32,
    land_scale: f32,
    // Mercator of store coordinate (0, 0) and of one store texel.
    merc_step: f32,
    pad2: f32,
    merc_origin: vec2<f32>,
    pad3: vec2<f32>,
    // Field pixel centre -> store coordinates (csk_auxTransform), by column.
    t0: vec4<f32>,
    t1: vec4<f32>,
    t2: vec4<f32>,
}

@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> samples: array<vec4<f32>>;
@group(0) @binding(3) var base: texture_2d<f32>;
@group(0) @binding(4) var land_base: texture_2d<f32>;
@group(0) @binding(5) var mask: texture_2d<u32>;

fn valid(v: f32) -> bool {
    return (bitcast<u32>(v) & 0x7fffffffu) < 0x7f800000u && v > -1.0e20;
}

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

fn aux(t: texture_2d<f32>, scale: f32, at: vec2<f32>) -> f32 {
    if scale <= 0.0 {
        return INVALID;
    }
    let q = at / scale - 0.5;
    let b = vec2<i32>(floor(q));
    let fr = q - vec2<f32>(b);
    let ts = vec2<i32>(textureDimensions(t));
    var sum = 0.0;
    var w = 0.0;
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            let a = textureLoad(t, clamp(b + vec2<i32>(x, y), vec2<i32>(0), ts - 1), 0).r;
            let k = select(fr.x, 1.0 - fr.x, x == 0) * select(fr.y, 1.0 - fr.y, y == 0);
            if valid(a) && k > 0.0 {
                sum += a * k;
                w += k;
            }
        }
    }
    return select(INVALID, sum / w, w > 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if any(id.xy >= grid.size) {
        return;
    }
    let dims = vec2<f32>(textureDimensions(field));
    let p = vec2<i32>((vec2<f32>(id.xy) + 0.5) * dims / vec2<f32>(grid.size));
    let centre = vec2<f32>(p) + 0.5;
    let at = (grid.t0.xy * centre.x + grid.t1.xy * centre.y + grid.t2.xy);
    let height = textureLoad(field, p, 0).r;
    let kind = water_class(grid.merc_origin + at * grid.merc_step);
    samples[id.y * grid.size.x + id.x] = vec4<f32>(
        select(INVALID, height, valid(height)),
        aux(base, grid.base_scale, at),
        aux(land_base, grid.land_scale, at),
        f32(kind),
    );
}
