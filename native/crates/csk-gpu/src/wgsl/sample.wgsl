// Point-samples the screen field on a grid: the visible heights that auto
// layers fit their colour ranges to. Invalid samples pass through.

struct Grid {
    size: vec2<u32>,
    pad: vec2<u32>,
}

@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var field: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> samples: array<f32>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if any(id.xy >= grid.size) {
        return;
    }
    let dims = vec2<f32>(textureDimensions(field));
    let p = (vec2<f32>(id.xy) + 0.5) * dims / vec2<f32>(grid.size);
    samples[id.y * grid.size.x + id.x] = textureLoad(field, vec2<i32>(p), 0).r;
}
