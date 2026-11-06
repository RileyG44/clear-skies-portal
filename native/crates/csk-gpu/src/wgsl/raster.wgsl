// Draws raster map tiles (basemap, reference overlays) as camera-aligned
// quads over the frame, composited "over" in premultiplied alpha, in the
// display's encoded colour space as a browser composites map layers.
//
// Each instance is one tile: its rectangle in CSS pixels relative to the view
// centre before rotation (computed in f64 on the CPU), and the part of a pool
// layer it shows (a whole tile, or a stand-in's sub-rectangle).

struct Frame {
    css: vec2<f32>,
    // cos and sin of the bearing (clockwise).
    turn: vec2<f32>,
    opacity: f32,
    // 0: as published; 1: greyscale, brightened (the dark-theme reading).
    mode: u32,
    pad: vec2<f32>,
}

struct Tile {
    rect: vec4<f32>,
    uv: vec4<f32>,
    layer: u32,
    pad: vec3<u32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> tiles: array<Tile>;
@group(0) @binding(2) var pool: texture_2d_array<f32>;
@group(0) @binding(3) var bilinear: sampler;

struct Varying {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) layer: u32,
}

@vertex
fn vertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Varying {
    let tile = tiles[i];
    let corner = vec2<f32>(f32((0x1au >> v) & 1u), f32((0x34u >> v) & 1u));
    let p = tile.rect.xy + corner * tile.rect.zw;
    // Map offset -> screen offset: the inverse of the camera's rotation.
    let c = frame.turn.x;
    let s = frame.turn.y;
    let screen = vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c) + frame.css * 0.5;
    var out: Varying;
    out.position = vec4<f32>(screen.x / frame.css.x * 2.0 - 1.0, 1.0 - screen.y / frame.css.y * 2.0, 0.0, 1.0);
    out.uv = mix(tile.uv.xy, tile.uv.zw, corner);
    out.layer = tile.layer;
    return out;
}

@fragment
fn fragment(in: Varying) -> @location(0) vec4<f32> {
    // Pool texels are premultiplied, so filtering never darkens edges.
    var colour = textureSample(pool, bilinear, in.uv, in.layer);
    if frame.mode == 1u {
        let grey = dot(colour.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        colour = vec4<f32>(min(vec3<f32>(grey * 1.35), vec3<f32>(colour.a)), colour.a);
    }
    return colour * frame.opacity;
}
