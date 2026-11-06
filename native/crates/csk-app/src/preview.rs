//! Look previews for the terrain page: each built-in look drawn on the web's
//! small synthetic landscape (lidar-render.js previewTerrain) by the map's own
//! GPU shading program, with its auto ranges fitted to that landscape and the
//! person's lighting. Published as PNG data under `csp-image:look:<id>`.

use std::collections::BTreeMap;

use csk_gpu::{Renderer, Uniforms};

use crate::render::{Appearance, Lighting, Look as Adjust, Spectrum};
use crate::terrain::{Fit, Look, Studio, fit_elevation, fit_range, fit_relative};

/// Preview size in pixels (lidar-studio.js PREVIEW_W/H).
pub const WIDTH: u32 = 168;
pub const HEIGHT: u32 = 112;

/// The synthetic landscape: a meandering river on a floodplain between
/// terraces and dissected hills. Returns heights and metres per pixel.
pub fn terrain(w: u32, h: u32) -> (Vec<f64>, f64) {
    let (wf, hf) = (f64::from(w), f64::from(h));
    let res = 8.0 * 96.0 / wf;
    let hash = |x: f64, y: f64| {
        let n = (x * 127.1 + y * 311.7).sin() * 43758.5453;
        n - n.floor()
    };
    let noise = |x: f64, y: f64| {
        let (xi, yi) = (x.floor(), y.floor());
        let (xf, yf) = (x - xi, y - yi);
        let (u, v) = (xf * xf * (3.0 - 2.0 * xf), yf * yf * (3.0 - 2.0 * yf));
        let (a, b, c, d) = (hash(xi, yi), hash(xi + 1.0, yi), hash(xi, yi + 1.0), hash(xi + 1.0, yi + 1.0));
        (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2.0 - 1.0
    };
    let ridged = |x: f64, y: f64| {
        let (mut sum, mut amp, mut f) = (0.0, 0.55, 1.0);
        for o in 0..5 {
            let o = f64::from(o);
            sum += amp * (1.0 - noise(x * f + o * 7.3, y * f - o * 3.1).abs());
            amp *= 0.5;
            f *= 2.03;
        }
        sum
    };
    let pi = std::f64::consts::PI;
    let mut grid = Vec::with_capacity((w * h) as usize);
    for y in 0..h {
        for x in 0..w {
            let (u, v) = (f64::from(x) / wf, f64::from(y) / hf);
            let centre = 0.5 + 0.16 * (u * pi * 2.2 + 0.6).sin() + 0.05 * (u * pi * 6.1 + 1.3).sin();
            let d = (v - centre).abs() * hf / wf * 1.5;
            let floodplain = ((d - 0.08) / 0.07).clamp(0.0, 1.0);
            let wall = floodplain * floodplain * (3.0 - 2.0 * floodplain);
            let upland = ridged(u * 3.2 + 0.3, v * 3.2 * hf / wf + 0.7) * (d * 3.0).min(1.0);
            let meander = (v - (centre + 0.03 * (u * pi * 14.0).sin())).abs() * hf / wf * 1.5;
            let channel = (1.0 - meander / 0.012).max(0.0);
            let bars = noise(u * 16.0, v * 16.0 * hf / wf) * 1.2 * (1.0 - wall);
            grid.push(300.0 + wall * (70.0 + upland * 110.0) + bars - channel * 4.0 + u * 18.0);
        }
    }
    (grid, res)
}

/// Separable minimum or Gaussian (sigma = max(0.5, r/2)) over valid values.
fn filter(grid: &[f64], w: usize, h: usize, radius: f64, minimum: bool) -> Vec<f64> {
    let r = radius.round().max(1.0) as i64;
    let sigma = (r as f64 / 2.0).max(0.5);
    let pass = |src: &[f64], dx: i64, dy: i64| {
        let mut out = vec![f64::NAN; w * h];
        for y in 0..h as i64 {
            for x in 0..w as i64 {
                let (mut acc, mut weight) = (if minimum { f64::INFINITY } else { 0.0 }, 0.0);
                for k in -r..=r {
                    let (xx, yy) = (x + dx * k, y + dy * k);
                    if xx < 0 || yy < 0 || xx >= w as i64 || yy >= h as i64 {
                        continue;
                    }
                    let v = src[yy as usize * w + xx as usize];
                    if !v.is_finite() {
                        continue;
                    }
                    if minimum {
                        acc = acc.min(v);
                        weight += 1.0;
                    } else {
                        let g = (-((k * k) as f64) / (2.0 * sigma * sigma)).exp();
                        acc += v * g;
                        weight += g;
                    }
                }
                if weight > 0.0 {
                    out[y as usize * w + x as usize] = if minimum { acc } else { acc / weight };
                }
            }
        }
        out
    };
    pass(&pass(grid, 1, 0), 0, 1)
}

fn floor(grid: &[f64], w: usize, h: usize, radius: f64) -> Vec<f64> {
    filter(&filter(grid, w, h, radius, true), w, h, radius, false)
}

/// A landscape to draw looks on, and its derived fields, computed once.
pub struct Landscape {
    grid: Vec<f64>,
    width: u32,
    height: u32,
    res: f64,
    floors: BTreeMap<u64, Vec<f64>>,
    blurs: BTreeMap<u64, Vec<f64>>,
}

impl Default for Landscape {
    fn default() -> Self {
        let (grid, res) = terrain(WIDTH, HEIGHT);
        Self::new(grid, WIDTH, HEIGHT, res)
    }
}

impl Landscape {
    /// Heights in rows, `res` metres a pixel.
    pub fn new(grid: Vec<f64>, width: u32, height: u32, res: f64) -> Self {
        assert_eq!(grid.len(), (width * height) as usize);
        Self { grid, width, height, res, floors: BTreeMap::new(), blurs: BTreeMap::new() }
    }

    fn floor(&mut self, radius: f64) -> &[f64] {
        let (w, h) = (self.width as usize, self.height as usize);
        let grid = &self.grid;
        self.floors.entry(radius.to_bits()).or_insert_with(|| floor(grid, w, h, radius))
    }

    fn blur(&mut self, radius: f64) -> &[f64] {
        let (w, h) = (self.width as usize, self.height as usize);
        let grid = &self.grid;
        self.blurs.entry(radius.to_bits()).or_insert_with(|| filter(grid, w, h, radius, false))
    }

    /// A look drawn with `lighting`: premultiplied RGBA, the landscape's size.
    pub fn render(&mut self, gpu: &Renderer, look: &Look, lighting: Lighting) -> Result<Vec<u8>, csk_gpu::Error> {
        let mut studio = Studio::default();
        let style = studio.apply_scene(&look.scene, Some(&look.id));
        let scene = &look.scene;
        // The preview's own floor scale (lidar-render.js renderScenePreview).
        let radius = (scene.effects.rem_radius / self.res / 8.0).clamp(2.0, 24.0);
        let mut fitted = BTreeMap::new();
        let mut layers = vec![("base".to_string(), scene.base.clone())];
        layers.extend(scene.overlays.iter().enumerate().map(|(i, l)| (format!("overlay:{i}"), l.clone())));
        let grid = self.grid.clone();
        for (key, layer) in layers.iter().filter(|(_, l)| l.auto) {
            let fit = if layer.style == "rem" {
                let base = self.floor(radius);
                let relative: Vec<f64> = grid.iter().zip(base).map(|(v, f)| (v - f).max(0.0)).collect();
                fit_relative(&relative, &grid, &[], &layer.range_mode)
            } else if layer.style == "tint" {
                fit_elevation(&grid, &[], &layer.range_mode)
            } else {
                fit_range(&grid, &layer.style, None).map(Fit::Range)
            };
            if let Some(fit) = fit {
                fitted.insert(key.clone(), fit);
            }
        }
        let stack = studio.build_stack(&style, &fitted, 0.0, None);
        let appearance = Appearance {
            style: style.clone(),
            opacity: 1.0,
            look: Adjust::default(),
            lighting,
            spectrum: Spectrum::default(),
            spectrum_opacity: 1.0,
            stack: stack.clone(),
        };
        let mut uniforms = Uniforms::default();
        appearance.apply(&mut uniforms)?;
        // A camera whose pixel is `res` metres at the equator.
        let zoom = (csk_gpu::WORLD_METRES / (256.0 * self.res)).log2();
        let (width, height) = (self.width, self.height);
        uniforms.set("u_cssSize", &[width as f32, height as f32])?;
        uniforms.set("u_dpr", &[1.0])?;
        uniforms.set("u_zoom", &[zoom as f32])?;
        uniforms.set("u_centerMerc", &[0.5, 0.5])?;
        uniforms.set("u_bearingRad", &[0.0])?;
        let field = |values: &[f64]| {
            let values: Vec<f32> = values.iter().map(|v| *v as f32).collect();
            gpu.field(width, height, &values)
        };
        let heights = field(&grid)?;
        let detail = stack.as_ref().filter(|s| s.detail != 0.0 && s.detail_radius / self.res >= 1.0);
        let blur = match detail {
            Some(s) => Some(field(self.blur((s.detail_radius / self.res).min(8.0)))?),
            None => None,
        };
        let rem = stack.as_ref().is_some_and(|s| s.layers.iter().any(|l| l.style == "rem"));
        // No water in the preview: the land-only floor is the floor.
        let base = if rem { Some(field(self.floor(radius))?) } else { None };
        let frame = gpu.render_derived(&heights, &uniforms, blur.as_ref(), base.as_ref(), base.as_ref())?;
        Ok(gpu.readback(&frame)?.to_vec())
    }
}

/// Premultiplied RGBA to a PNG data URL (straight alpha, as PNG stores it).
pub fn data_url(premultiplied: &[u8], w: u32, h: u32) -> String {
    let mut rgba = premultiplied.to_vec();
    for p in rgba.chunks_exact_mut(4) {
        let a = u16::from(p[3]);
        if a > 0 && a < 255 {
            for c in &mut p[..3] {
                *c = ((u16::from(*c) * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    let png = csk_core::raster::png::encode_rgba(&rgba, w, h);
    format!("data:image/png;base64,{}", base64(&png))
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn landscape_matches_the_web_preview_terrain() {
        // lidar-render.js previewTerrain(168, 112).
        let (grid, res) = terrain(WIDTH, HEIGHT);
        assert!((res - 4.571_428_571_428_571).abs() < 1e-12);
        assert_eq!(grid.len(), 168 * 112);
        // The web stores the grid as float32.
        for (i, expected) in
            [(0, 452.909_088_134_765_6), (5000, 420.833_557_128_906_25), (18815, 448.870_178_222_656_25)]
        {
            assert_eq!(grid[i] as f32, expected as f32, "sample {i}");
        }
    }

    #[test]
    fn base64_pads() {
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"M"), "TQ==");
    }
}
