//! Point markers drawn over the map: the selected place's dot and vector
//! layers' points.

use wgpu::util::DeviceExt;

use crate::Renderer;
use crate::terrain::View;

/// A filled, outlined circle at a Web Mercator point, sized in CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Marker {
    pub at: [f64; 2],
    pub radius: f32,
    pub stroke: f32,
    /// Straight RGBA, 0..=1.
    pub fill: [f32; 4],
    pub line: [f32; 4],
    /// Ring dash and gap along the circumference, CSS px; zero is solid.
    pub dash: [f32; 2],
}

impl Marker {
    /// Where the marker's centre falls on the screen, in CSS pixels: the
    /// nearest copy of the point across the antimeridian.
    pub fn screen(&self, view: &View) -> [f64; 2] {
        let world = 256.0 * view.zoom.exp2();
        let dx = (self.at[0] - view.center[0] + 0.5).rem_euclid(1.0) - 0.5;
        let (u, v) = (dx * world, (self.at[1] - view.center[1]) * world);
        let (sin, cos) = view.bearing.to_radians().sin_cos();
        [u * cos - v * sin + view.css[0] / 2.0, u * sin + v * cos + view.css[1] / 2.0]
    }
}

pub(crate) fn draw(
    gpu: &Renderer,
    pass: &mut wgpu::RenderPass<'_>,
    view: &View,
    format: wgpu::TextureFormat,
    markers: &[Marker],
) {
    if markers.is_empty() {
        return;
    }
    let mut data = Vec::with_capacity(markers.len() * 64);
    for m in markers {
        let [x, y] = m.screen(view);
        let tail = [m.dash[0], m.dash[1], 0.0, 0.0];
        for v in [x as f32, y as f32, m.radius, m.stroke].into_iter().chain(m.fill).chain(m.line).chain(tail) {
            data.extend_from_slice(&v.to_le_bytes());
        }
    }
    let mut frame = Vec::with_capacity(16);
    for v in [view.css[0] as f32, view.css[1] as f32, 0.0, 0.0] {
        frame.extend_from_slice(&v.to_le_bytes());
    }
    let buffer = |label, contents: &[u8], usage| {
        gpu.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents, usage })
    };
    let frame = buffer("marker frame", &frame, wgpu::BufferUsages::UNIFORM);
    let markers_buffer = buffer("markers", &data, wgpu::BufferUsages::STORAGE);
    let (pipeline, layout) = gpu.marker_pipeline(format);
    let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None,
        layout: &layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: frame.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: markers_buffer.as_entire_binding() },
        ],
    });
    pass.set_pipeline(&pipeline);
    pass.set_bind_group(0, &group, &[]);
    pass.draw(0..6, 0..markers.len() as u32);
}
