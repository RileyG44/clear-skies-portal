//! Vector map layers (GeoJSON areas, lines and points). Shapes are
//! tessellated once, off the render thread, into a mesh in local units;
//! each frame draws it with lines, dashes and markers sized in CSS pixels,
//! as a browser draws SVG over a map.
//!
//! Lines keep their path position and extrusion direction apart, so the
//! vertex program widens them in screen space: a zoom never re-tessellates.
//! Positions are relative to the mesh origin and reach the GPU in f32; the
//! view centre goes as a high and low pair, so the subtraction near the
//! screen centre is exact at any zoom.

use csk_core::resource::Reservation;
use lyon_tessellation as lyon;
use wgpu::util::DeviceExt;

use crate::marker::Marker;
use crate::terrain::View;
use crate::{Error, Renderer};

/// Local mesh units per Web Mercator unit: 2^26, about 0.6 m at the equator.
pub const UNITS: f64 = 67_108_864.0;

/// How shapes of one kind draw.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Style {
    /// Straight RGBA, 0..=1. Zero alpha draws no fill.
    pub fill: [f32; 4],
    /// Straight RGBA, 0..=1. Zero alpha draws no line.
    pub line: [f32; 4],
    /// Line width, CSS px.
    pub width: f32,
    /// Dash and gap lengths along the line, CSS px; a zero dash is solid.
    pub dash: [f32; 2],
}

#[derive(Clone, Debug, PartialEq)]
pub enum Geometry {
    /// Rings in Web Mercator, the outer first then holes, filled even-odd.
    Area(Vec<Vec<[f64; 2]>>),
    /// A line in Web Mercator.
    Line(Vec<[f64; 2]>),
}

/// An area or line, its style (an index into [`Shapes::styles`]) and the
/// feature it draws (for identifying a tap).
#[derive(Clone, Debug, PartialEq)]
pub struct Shape {
    pub geometry: Geometry,
    pub style: u32,
    pub feature: u32,
}

/// A point feature's marker.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub marker: Marker,
    pub feature: u32,
}

/// What one vector layer draws: areas and lines under its points.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shapes {
    pub styles: Vec<Style>,
    pub shapes: Vec<Shape>,
    pub points: Vec<Point>,
}

impl Shapes {
    /// The feature drawn under a screen point (CSS px), topmost first:
    /// points within their radius (plus `slop`), lines within half their
    /// width plus `slop`, then areas containing the point.
    pub fn hit(&self, view: &View, at: [f64; 2], slop: f64) -> Option<u32> {
        let mut best: Option<(f64, u32)> = None;
        for p in self.points.iter().rev() {
            let s = p.marker.screen(view);
            let d = (s[0] - at[0]).hypot(s[1] - at[1]);
            let reach = f64::from(p.marker.radius) + slop;
            if d <= reach && best.is_none_or(|(b, _)| d < b) {
                best = Some((d, p.feature));
            }
        }
        if let Some((_, feature)) = best {
            return Some(feature);
        }
        let world = 256.0 * view.zoom.exp2();
        let merc = view_unproject(view, at);
        let reach = |width: f32| (f64::from(width) * 0.5 + slop) / world;
        for shape in self.shapes.iter().rev() {
            let style = self.styles.get(shape.style as usize).copied().unwrap_or_default();
            let lined = style.line[3] > 0.0 && style.width > 0.0;
            match &shape.geometry {
                Geometry::Line(line) => {
                    if lined && near_line(line, merc, reach(style.width), false) {
                        return Some(shape.feature);
                    }
                }
                Geometry::Area(rings) => {
                    // Inside counts even unfilled: an outline marks an area.
                    if contains(rings, merc) {
                        return Some(shape.feature);
                    }
                    if lined && rings.iter().any(|r| near_line(r, merc, reach(style.width), true)) {
                        return Some(shape.feature);
                    }
                }
            }
        }
        None
    }
}

/// The Web Mercator point under a screen point, its x the copy nearest the
/// view centre.
fn view_unproject(view: &View, at: [f64; 2]) -> [f64; 2] {
    let world = 256.0 * view.zoom.exp2();
    let (u, v) = (at[0] - view.css[0] / 2.0, at[1] - view.css[1] / 2.0);
    let (sin, cos) = view.bearing.to_radians().sin_cos();
    // The inverse of the camera's rotation.
    let (x, y) = (u * cos + v * sin, -u * sin + v * cos);
    [view.center[0] + x / world, view.center[1] + y / world]
}

/// Copies of `x` shifted by whole worlds to lie within half a world of `near`.
fn wrap_near(x: f64, near: f64) -> f64 {
    near + (x - near + 0.5).rem_euclid(1.0) - 0.5
}

fn near_line(line: &[[f64; 2]], at: [f64; 2], reach: f64, closed: bool) -> bool {
    if line.is_empty() {
        return false;
    }
    let x = wrap_near(at[0], line[0][0]);
    let at = [x, at[1]];
    let segments = line.windows(2).map(|w| (w[0], w[1]));
    let closing = closed.then(|| (line[line.len() - 1], line[0]));
    segments.chain(closing).any(|(a, b)| {
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let length = dx * dx + dy * dy;
        let t = if length > 0.0 { (((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / length).clamp(0.0, 1.0) } else { 0.0 };
        let (px, py) = (a[0] + t * dx - at[0], a[1] + t * dy - at[1]);
        px.hypot(py) <= reach
    })
}

/// Even-odd containment over all rings.
fn contains(rings: &[Vec<[f64; 2]>], at: [f64; 2]) -> bool {
    let Some(first) = rings.first().and_then(|r| r.first()) else { return false };
    let (x, y) = (wrap_near(at[0], first[0]), at[1]);
    let mut inside = false;
    for ring in rings {
        let n = ring.len();
        for i in 0..n {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            if (a[1] > y) != (b[1] > y) && x < a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]) {
                inside = !inside;
            }
        }
    }
    inside
}

/// A mesh vertex (32 bytes, as `Vertex` in wgsl/vector.wgsl).
#[derive(Clone, Copy)]
struct Vertex {
    /// Position on the path, local units from the mesh origin.
    at: [f32; 2],
    /// Line extrusion direction, unit length per side; zero for fills.
    normal: [f32; 2],
    /// Distance along the line, local units.
    advance: f32,
    /// +1 or -1 by side of the line.
    across: f32,
    style: u32,
    /// 0 fill, 1 line.
    kind: u32,
}

/// A tessellated layer, ready to upload. Built on any thread.
pub struct Mesh {
    origin: [f64; 2],
    /// Web Mercator x extent of the areas and lines.
    span: [f64; 2],
    vertices: Vec<u8>,
    indices: Vec<u32>,
    styles: Vec<u8>,
    points: Vec<Marker>,
}

impl Mesh {
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty() && self.points.is_empty()
    }
}

fn finite(p: &[f64; 2]) -> bool {
    p[0].is_finite() && p[1].is_finite()
}

/// Tessellates shapes: every fill, then every line over them.
pub fn tessellate(shapes: &Shapes) -> Mesh {
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    for shape in &shapes.shapes {
        let rings: &[Vec<[f64; 2]>] = match &shape.geometry {
            Geometry::Area(rings) => rings,
            Geometry::Line(line) => std::slice::from_ref(line),
        };
        for p in rings.iter().flatten().filter(|p| finite(p)) {
            for i in 0..2 {
                lo[i] = lo[i].min(p[i]);
                hi[i] = hi[i].max(p[i]);
            }
        }
    }
    let origin = if lo[0].is_finite() { [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0] } else { [0.0; 2] };
    let local =
        |p: &[f64; 2]| lyon::math::point(((p[0] - origin[0]) * UNITS) as f32, ((p[1] - origin[1]) * UNITS) as f32);
    let path = |rings: &[Vec<[f64; 2]>], closed: bool| {
        let mut builder = lyon::path::Path::builder();
        let mut any = false;
        for ring in rings {
            let mut points = ring.iter().filter(|p| finite(p)).map(local).peekable();
            let Some(first) = points.next() else { continue };
            let mut count = 1;
            builder.begin(first);
            let mut last = first;
            for p in points {
                if p != last {
                    builder.line_to(p);
                    last = p;
                    count += 1;
                }
            }
            builder.end(closed);
            any |= count >= if closed { 3 } else { 2 };
        }
        any.then(|| builder.build())
    };
    let style = |i: u32| shapes.styles.get(i as usize).copied().unwrap_or_default();

    let mut fills: lyon::VertexBuffers<Vertex, u32> = lyon::VertexBuffers::new();
    let mut fill = lyon::FillTessellator::new();
    let fill_options = lyon::FillOptions::even_odd().with_tolerance(0.5);
    for shape in &shapes.shapes {
        let Geometry::Area(rings) = &shape.geometry else { continue };
        if style(shape.style).fill[3] <= 0.0 {
            continue;
        }
        let Some(path) = path(rings, true) else { continue };
        let s = shape.style;
        let mut out = lyon::BuffersBuilder::new(&mut fills, |v: lyon::FillVertex| Vertex {
            at: v.position().to_array(),
            normal: [0.0; 2],
            advance: 0.0,
            across: 0.0,
            style: s,
            kind: 0,
        });
        // A malformed polygon draws nothing rather than failing the layer.
        let _ = fill.tessellate_path(&path, &fill_options, &mut out);
    }

    let mut lines: lyon::VertexBuffers<Vertex, u32> = lyon::VertexBuffers::new();
    let mut stroke = lyon::StrokeTessellator::new();
    // Widths are applied on screen; the tessellated width only shapes the
    // round joins and caps.
    let stroke_options = lyon::StrokeOptions::default()
        .with_line_width(1.0)
        .with_line_join(lyon::LineJoin::Round)
        .with_line_cap(lyon::LineCap::Round)
        .with_tolerance(0.05);
    for shape in &shapes.shapes {
        let st = style(shape.style);
        if st.line[3] <= 0.0 || st.width <= 0.0 {
            continue;
        }
        let built = match &shape.geometry {
            Geometry::Area(rings) => path(rings, true),
            Geometry::Line(line) => path(std::slice::from_ref(line), false),
        };
        let Some(path) = built else { continue };
        let s = shape.style;
        let mut out = lyon::BuffersBuilder::new(&mut lines, |v: lyon::StrokeVertex| Vertex {
            at: v.position_on_path().to_array(),
            normal: v.normal().to_array(),
            advance: v.advancement(),
            across: if v.side() == lyon::Side::Positive { 1.0 } else { -1.0 },
            style: s,
            kind: 1,
        });
        let _ = stroke.tessellate_path(&path, &stroke_options, &mut out);
    }

    let base = fills.vertices.len() as u32;
    let mut indices = fills.indices;
    indices.extend(lines.indices.iter().map(|i| i + base));
    let mut vertices = Vec::with_capacity((fills.vertices.len() + lines.vertices.len()) * 32);
    for v in fills.vertices.iter().chain(&lines.vertices) {
        for f in [v.at[0], v.at[1], v.normal[0], v.normal[1], v.advance, v.across] {
            vertices.extend_from_slice(&f.to_le_bytes());
        }
        vertices.extend_from_slice(&v.style.to_le_bytes());
        vertices.extend_from_slice(&v.kind.to_le_bytes());
    }
    let mut styles = Vec::with_capacity(shapes.styles.len().max(1) * 48);
    for s in shapes.styles.iter().copied().chain(shapes.styles.is_empty().then(Style::default)) {
        for f in s.fill.into_iter().chain(s.line).chain([s.width, s.dash[0], s.dash[1], 0.0]) {
            styles.extend_from_slice(&f.to_le_bytes());
        }
    }
    Mesh {
        origin,
        span: if lo[0].is_finite() { [lo[0], hi[0]] } else { [0.0; 2] },
        vertices,
        indices,
        styles,
        points: shapes.points.iter().map(|p| p.marker).collect(),
    }
}

/// A vector layer on the GPU.
pub struct Vector {
    buffers: Option<(wgpu::Buffer, wgpu::Buffer, wgpu::Buffer, u32)>,
    origin: [f64; 2],
    span: [f64; 2],
    points: Vec<Marker>,
    _charge: Option<Reservation>,
}

impl Vector {
    /// Uploads a mesh, charged to the shared memory budget.
    pub fn new(gpu: &Renderer, mesh: &Mesh) -> Result<Self, Error> {
        let mut buffers = None;
        let mut charge = None;
        if !mesh.indices.is_empty() {
            let bytes = mesh.vertices.len() + mesh.indices.len() * 4 + mesh.styles.len();
            charge = Some(gpu.budget.reserve(bytes + 3 * 4096)?);
            let init = |label, contents: &[u8], usage| {
                gpu.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents, usage })
            };
            let indices: Vec<u8> = mesh.indices.iter().flat_map(|i| i.to_le_bytes()).collect();
            buffers = Some((
                init("vector vertices", &mesh.vertices, wgpu::BufferUsages::STORAGE),
                init("vector indices", &indices, wgpu::BufferUsages::INDEX),
                init("vector styles", &mesh.styles, wgpu::BufferUsages::STORAGE),
                mesh.indices.len() as u32,
            ));
        }
        Ok(Self { buffers, origin: mesh.origin, span: mesh.span, points: mesh.points.clone(), _charge: charge })
    }

    pub(crate) fn draw(
        &self,
        gpu: &Renderer,
        pass: &mut wgpu::RenderPass<'_>,
        view: &View,
        format: wgpu::TextureFormat,
        opacity: f32,
    ) {
        if opacity <= 0.0 {
            return;
        }
        if let Some((vertices, indices, styles, count)) = &self.buffers {
            let world = 256.0 * view.zoom.exp2();
            let reach = view.css[0].hypot(view.css[1]) / 2.0 / world;
            let (pipeline, layout) = gpu.vector_pipeline(format);
            pass.set_pipeline(&pipeline);
            pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
            let (sin, cos) = view.bearing.to_radians().sin_cos();
            // Each copy of the world the view reaches.
            for copy in -1i32..=1 {
                let shift = f64::from(copy);
                if self.span[1] + shift < view.center[0] - reach || self.span[0] + shift > view.center[0] + reach {
                    continue;
                }
                let centre =
                    [(view.center[0] - self.origin[0] - shift) * UNITS, (view.center[1] - self.origin[1]) * UNITS];
                let high = centre.map(|c| c as f32);
                let low = [(centre[0] - f64::from(high[0])) as f32, (centre[1] - f64::from(high[1])) as f32];
                let scale = (world / UNITS) as f32;
                let mut frame = Vec::with_capacity(48);
                for v in [
                    view.css[0] as f32,
                    view.css[1] as f32,
                    cos as f32,
                    sin as f32,
                    high[0],
                    high[1],
                    low[0],
                    low[1],
                    scale,
                    opacity,
                    0.0,
                    0.0,
                ] {
                    frame.extend_from_slice(&v.to_le_bytes());
                }
                let frame = gpu.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("vector frame"),
                    contents: &frame,
                    usage: wgpu::BufferUsages::UNIFORM,
                });
                let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: None,
                    layout: &layout,
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: frame.as_entire_binding() },
                        wgpu::BindGroupEntry { binding: 1, resource: vertices.as_entire_binding() },
                        wgpu::BindGroupEntry { binding: 2, resource: styles.as_entire_binding() },
                    ],
                });
                pass.set_bind_group(0, &group, &[]);
                pass.draw_indexed(0..*count, 0, 0..1);
            }
        }
        if !self.points.is_empty() {
            let points: Vec<Marker> = self
                .points
                .iter()
                .map(|m| {
                    let mut m = *m;
                    m.fill[3] *= opacity;
                    m.line[3] *= opacity;
                    m
                })
                .collect();
            crate::marker::draw(gpu, pass, view, format, &points);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view() -> View {
        View { center: [0.5, 0.5], zoom: 10.0, bearing: 0.0, css: [400.0, 400.0], dpr: 2.0, export: false }
    }

    fn square(c: [f64; 2], half: f64) -> Vec<[f64; 2]> {
        vec![
            [c[0] - half, c[1] - half],
            [c[0] + half, c[1] - half],
            [c[0] + half, c[1] + half],
            [c[0] - half, c[1] + half],
        ]
    }

    #[test]
    fn tessellates_fills_under_lines_and_hits_features() {
        let world = 256.0 * 1024.0;
        let styles = vec![
            Style { fill: [1.0, 0.0, 0.0, 0.5], line: [1.0; 4], width: 2.0, dash: [0.0; 2] },
            Style { fill: [0.0; 4], line: [0.0, 0.0, 1.0, 1.0], width: 4.0, dash: [6.0, 4.0] },
        ];
        // A square with a hole, centred on the view, and a line to its right.
        let mut ring = square([0.5, 0.5], 50.0 / world);
        ring.push(ring[0]);
        let shapes = Shapes {
            styles,
            shapes: vec![
                Shape { geometry: Geometry::Area(vec![ring, square([0.5, 0.5], 10.0 / world)]), style: 0, feature: 7 },
                Shape {
                    geometry: Geometry::Line(vec![[0.5 + 120.0 / world, 0.4], [0.5 + 120.0 / world, 0.6]]),
                    style: 1,
                    feature: 8,
                },
            ],
            points: vec![],
        };
        let mesh = tessellate(&shapes);
        assert!(!mesh.is_empty());
        let kinds: Vec<u32> =
            mesh.vertices.chunks_exact(32).map(|v| u32::from_le_bytes(v[28..32].try_into().unwrap())).collect();
        // Fills come first, then lines.
        let first_line = kinds.iter().position(|k| *k == 1).unwrap();
        assert!(first_line > 0 && kinds[first_line..].iter().all(|k| *k == 1));

        let v = view();
        // Inside the ring, in the hole, on the line, and in empty space.
        assert_eq!(shapes.hit(&v, [200.0 + 30.0, 200.0], 0.0), Some(7));
        assert_eq!(shapes.hit(&v, [200.0, 200.0], 0.0), None);
        assert_eq!(shapes.hit(&v, [200.0 + 121.0, 230.0], 0.0), Some(8));
        assert_eq!(shapes.hit(&v, [200.0 + 160.0, 230.0], 0.0), None);
        // Across the antimeridian, the nearer copy is hit.
        let east = View { center: [1.5, 0.5], ..v };
        assert_eq!(shapes.hit(&east, [230.0, 200.0], 0.0), Some(7));
    }
}
