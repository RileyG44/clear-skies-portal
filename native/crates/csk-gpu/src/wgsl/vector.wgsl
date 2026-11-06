// Vector map layers (vector.rs): tessellated fills, then lines widened on
// screen, composited "over" in premultiplied alpha. Vertices are pulled from
// storage by index; positions are local units from the mesh origin.

struct Frame {
    css: vec2<f32>,
    // cos and sin of the bearing (clockwise).
    turn: vec2<f32>,
    // The view centre in local units from the mesh origin, as a high and a
    // low part: (at - high) is exact near the centre, then low refines it.
    high: vec2<f32>,
    low: vec2<f32>,
    // CSS px per local unit.
    scale: f32,
    opacity: f32,
    pad: vec2<f32>,
}

struct Vertex {
    at: vec2<f32>,
    // Line extrusion direction, unit length per side; zero for fills.
    normal: vec2<f32>,
    // Distance along the line, local units.
    advance: f32,
    // +1 or -1 by side of the line.
    across: f32,
    style: u32,
    // 0 fill, 1 line.
    kind: u32,
}

struct Style {
    // Straight (unpremultiplied) RGBA.
    fill: vec4<f32>,
    line: vec4<f32>,
    // Line width, then dash and gap (CSS px).
    width: f32,
    dash: f32,
    gap: f32,
    pad: f32,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(2) var<storage, read> styles: array<Style>;

struct Varying {
    @builtin(position) position: vec4<f32>,
    // Distance along the line (CSS px) and across it (-1..1 of the drawn
    // half width plus the smoothing margin).
    @location(0) along: f32,
    @location(1) across: f32,
    @location(2) @interpolate(flat) style: u32,
    @location(3) @interpolate(flat) kind: u32,
}

// Half the drawn width: at least one CSS px wide, thinner lines fade instead.
fn half_width(s: Style) -> f32 {
    return max(s.width, 1.0) * 0.5;
}

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> Varying {
    let v = vertices[index];
    let s = styles[v.style];
    let c = frame.turn.x;
    let n = frame.turn.y;
    let p = ((v.at - frame.high) - frame.low) * frame.scale;
    var screen = vec2<f32>(p.x * c - p.y * n, p.x * n + p.y * c);
    if v.kind == 1u {
        let extent = half_width(s) + 1.0;
        screen += vec2<f32>(v.normal.x * c - v.normal.y * n, v.normal.x * n + v.normal.y * c) * extent;
    }
    screen += frame.css * 0.5;
    var out: Varying;
    out.position = vec4<f32>(screen.x / frame.css.x * 2.0 - 1.0, 1.0 - screen.y / frame.css.y * 2.0, 0.0, 1.0);
    out.along = v.advance * frame.scale;
    out.across = v.across;
    out.style = v.style;
    out.kind = v.kind;
    return out;
}

@fragment
fn fragment(in: Varying) -> @location(0) vec4<f32> {
    let s = styles[in.style];
    if in.kind == 0u {
        return vec4<f32>(s.fill.rgb * s.fill.a, s.fill.a) * frame.opacity;
    }
    let half = half_width(s);
    let d = abs(in.across) * (half + 1.0);
    // About one device pixel of smoothing, in CSS px.
    let aa = max(fwidth(d), 1e-3);
    var a = 1.0 - smoothstep(half - aa * 0.5, half + aa * 0.5, d);
    if s.dash > 0.0 {
        let t = in.along % (s.dash + s.gap);
        let ta = max(fwidth(in.along), 1e-3);
        a *= smoothstep(-ta * 0.5, ta * 0.5, t) * (1.0 - smoothstep(s.dash - ta * 0.5, s.dash + ta * 0.5, t));
    }
    a *= min(s.width, 1.0);
    return vec4<f32>(s.line.rgb * s.line.a, s.line.a) * a * frame.opacity;
}
