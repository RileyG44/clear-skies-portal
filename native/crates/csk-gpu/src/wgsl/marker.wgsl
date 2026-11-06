// Point markers (the selected place, vector points): a filled, outlined circle per
// instance, anti-aliased by its distance field, composited "over" in
// premultiplied alpha. Positions are CSS pixels on the screen, computed in
// f64 on the CPU.

struct Frame {
    css: vec2<f32>,
    pad: vec2<f32>,
}

struct Marker {
    // Centre on screen (CSS px), radius and stroke width (CSS px).
    at: vec2<f32>,
    radius: f32,
    stroke: f32,
    // Straight (unpremultiplied) RGBA.
    fill: vec4<f32>,
    line: vec4<f32>,
    // Ring dash and gap along the circumference (CSS px); zero is solid.
    dash: vec2<f32>,
    pad: vec2<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> markers: array<Marker>;

struct Varying {
    @builtin(position) position: vec4<f32>,
    // Offset from the centre, CSS px.
    @location(0) offset: vec2<f32>,
    @location(1) @interpolate(flat) index: u32,
}

@vertex
fn vertex(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Varying {
    let m = markers[i];
    let corner = vec2<f32>(f32((0x1au >> v) & 1u), f32((0x34u >> v) & 1u)) * 2.0 - 1.0;
    let extent = m.radius + m.stroke * 0.5 + 1.0;
    let screen = m.at + corner * extent;
    var out: Varying;
    out.position = vec4<f32>(screen.x / frame.css.x * 2.0 - 1.0, 1.0 - screen.y / frame.css.y * 2.0, 0.0, 1.0);
    out.offset = corner * extent;
    out.index = i;
    return out;
}

@fragment
fn fragment(in: Varying) -> @location(0) vec4<f32> {
    let m = markers[in.index];
    let d = length(in.offset);
    // About one device pixel of smoothing, in CSS px.
    let aa = max(fwidth(d), 1e-3);
    let inside = 1.0 - smoothstep(m.radius - aa, m.radius + aa, d);
    var ring = 1.0 - smoothstep(m.stroke * 0.5 - aa, m.stroke * 0.5 + aa, abs(d - m.radius));
    if m.dash.x > 0.0 {
        // Arc length from the top, clockwise.
        let along = (atan2(in.offset.x, -in.offset.y) + 3.14159265) * m.radius;
        let t = along % (m.dash.x + m.dash.y);
        ring *= 1.0 - smoothstep(m.dash.x - aa, m.dash.x + aa, t);
    }
    let fill = vec4<f32>(m.fill.rgb * m.fill.a, m.fill.a) * inside;
    let line = vec4<f32>(m.line.rgb * m.line.a, m.line.a) * ring;
    // The ring over the fill.
    return line + fill * (1.0 - line.a);
}
