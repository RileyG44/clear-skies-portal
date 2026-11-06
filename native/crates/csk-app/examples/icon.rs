//! Draws the Drumlin app icon: a drumlin field in the Glacier look, shaded by
//! the map's own GPU program, as a 1024 px opaque RGB PNG.
//!
//!     cargo run -p csk-app --example icon -- ios/Drumlin/Drumlin.xcassets/DrumlinIcon.appiconset/AppIcon.png

use csk_app::preview::Landscape;
use csk_app::render::Lighting;
use csk_app::terrain::catalog;
use csk_core::resource::Budget;
use csk_gpu::Renderer;

const SIDE: u32 = 1024;
/// Metres a pixel: the icon spans about 3 km of till plain.
const RES: f64 = 3.0;

/// One drumlin: blunt stoss end up-ice, a long tapering lee down-ice.
struct Drumlin {
    x: f64,
    y: f64,
    length: f64,
    width: f64,
    height: f64,
}

impl Drumlin {
    fn at(&self, x: f64, y: f64, (fx, fy): (f64, f64)) -> f64 {
        let (dx, dy) = (x - self.x, y - self.y);
        // Along the flow (positive down-ice) and across it.
        let along = dx * fx + dy * fy;
        let across = -dx * fy + dy * fx;
        let half = if along > 0.0 { self.length * 0.62 } else { self.length * 0.38 };
        // Narrowing down-ice, to the tail.
        let taper = if along > 0.0 { 1.0 - 0.3 * (along / half).min(1.0) } else { 1.0 };
        let r = (along / half).powi(2) + (across / (self.width / 2.0 * taper)).powi(2);
        if r >= 1.0 { 0.0 } else { self.height * (1.0 - r).powf(1.6) }
    }
}

fn hash(x: f64, y: f64) -> f64 {
    let n = (x * 127.1 + y * 311.7).sin() * 43758.5453;
    n - n.floor()
}

fn noise(x: f64, y: f64) -> f64 {
    let (xi, yi) = (x.floor(), y.floor());
    let (xf, yf) = (x - xi, y - yi);
    let (u, v) = (xf * xf * (3.0 - 2.0 * xf), yf * yf * (3.0 - 2.0 * yf));
    let (a, b, c, d) = (hash(xi, yi), hash(xi + 1.0, yi), hash(xi, yi + 1.0), hash(xi + 1.0, yi + 1.0));
    (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2.0 - 1.0
}

fn field() -> Vec<f64> {
    // Ice moved from the north-east to the south-west.
    let flow = {
        let a = 215f64.to_radians();
        (a.sin(), -a.cos())
    };
    let span = f64::from(SIDE) * RES;
    // A staggered field, rows across the flow, each hill jittered: a
    // landscape, not a pattern.
    let mut drumlins = Vec::new();
    let (across, along) = ((-flow.1, flow.0), flow);
    for row in -4i32..=4 {
        for col in -4i32..=4 {
            let (r, c) = (f64::from(row), f64::from(col));
            let seed = (r * 13.1 + c * 7.7, r * 3.3 - c * 11.9);
            let (a, b, k) = (hash(seed.0, seed.1), hash(seed.1, seed.0), hash(seed.0 + 1.7, seed.1 - 4.1));
            let s = c * 0.26 + 0.13 * (row & 1) as f64 + (a - 0.5) * 0.1;
            let t = r * 0.36 + (b - 0.5) * 0.14;
            let (x, y) = (0.5 + s * across.0 + t * along.0, 0.5 + s * across.1 + t * along.1);
            if !(-0.2..1.2).contains(&x) || !(-0.2..1.2).contains(&y) || k < 0.12 {
                continue;
            }
            drumlins.push(Drumlin { x, y, length: 0.34 + 0.2 * k, width: 0.12 + 0.06 * k, height: 70.0 + 110.0 * k });
        }
    }
    let mut grid = Vec::with_capacity((SIDE * SIDE) as usize);
    for row in 0..SIDE {
        for col in 0..SIDE {
            let (u, v) = (f64::from(col) / f64::from(SIDE), f64::from(row) / f64::from(SIDE));
            // Overlapping hills merge, the higher one showing.
            let hills = drumlins.iter().map(|d| d.at(u, v, flow)).fold(0.0, |a, b| {
                const K: f64 = 24.0;
                let h = (K - (a - b).abs()).max(0.0) / K;
                a.max(b) + h * h * K / 4.0
            });
            let swell = 4.0 * noise(u * 3.0 + 1.3, v * 3.0 - 0.4) + 1.2 * noise(u * 24.0, v * 24.0);
            // The plain falls gently toward the south-west.
            grid.push(250.0 + hills + swell + (u - v) * 0.002 * span);
        }
    }
    grid
}

fn main() {
    let out = std::env::args().nth(1).expect("an output path");
    let gpu = pollster::block_on(Renderer::new(Budget::new(1 << 30))).expect("a GPU");
    let look = catalog().look("glacier").expect("the Glacier look");
    let mut landscape = Landscape::new(field(), SIDE, SIDE, RES);
    let rgba = landscape.render(&gpu, look, Lighting { altitude: 32.0, ..Lighting::default() }).expect("rendered");
    // App Store icons carry no alpha.
    let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
    let file = std::io::BufWriter::new(std::fs::File::create(&out).expect("output file"));
    let mut encoder = png::Encoder::new(file, SIDE, SIDE);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().and_then(|mut w| w.write_image_data(&rgb)).expect("PNG written");
}
