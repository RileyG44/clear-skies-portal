use std::collections::HashMap;

use csk_core::resource::Budget;
use csk_gpu::{Renderer, SourceSpec, TILE, Terrain, TileId, TileKey, Uniforms, View};

const NATIONAL: u16 = 1;
const SURVEY: u16 = 2;
/// Survey no-data square, in texels of one survey tile.
const HOLE: std::ops::Range<u32> = 100..160;

fn renderer() -> Option<Renderer> {
    match pollster::block_on(Renderer::new(Budget::new(512 << 20))) {
        Ok(renderer) => Some(renderer),
        Err(error @ csk_gpu::Error::Adapter(_)) if std::env::var_os("CSK_REQUIRE_GPU").is_none() => {
            eprintln!("GPU tests unavailable: {error}; set CSK_REQUIRE_GPU=1 to require the adapter");
            None
        }
        Err(error) => panic!("{error}"),
    }
}

/// A tilted plane in level-16 texel units around a reference point.
struct Plane([f64; 2]);
impl Plane {
    fn at(&self, x16: f64, y16: f64) -> f64 {
        0.01 * (x16 - self.0[0]) - 0.02 * (y16 - self.0[1])
    }
    /// Texel-centre samples of `tile`, plus `offset`; survey tiles get the hole.
    fn tile(&self, tile: TileId, offset: f64, hole: bool) -> Vec<f32> {
        let scale = f64::from(1u32 << (16 - tile.z));
        let mut out = Vec::with_capacity((TILE * TILE) as usize);
        for j in 0..TILE {
            for i in 0..TILE {
                if hole && HOLE.contains(&i) && HOLE.contains(&j) {
                    out.push(f32::NAN);
                    continue;
                }
                let x = (f64::from(tile.x * TILE + i) + 0.5) * scale;
                let y = (f64::from(tile.y * TILE + j) + 0.5) * scale;
                out.push((self.at(x, y) + offset) as f32);
            }
        }
        out
    }
}

/// Level-16 texel coordinate of a device pixel centre (the camera model).
fn texel(view: &View, px: u32, py: u32, w: u32, h: u32) -> (f64, f64) {
    let (sin, cos) = view.bearing.to_radians().sin_cos();
    let a = (f64::from(px) + 0.5) / f64::from(w) * view.css[0] - view.css[0] / 2.0;
    let b = (f64::from(py) + 0.5) / f64::from(h) * view.css[1] - view.css[1] / 2.0;
    let world = 256.0 * view.zoom.exp2();
    let mx = view.center[0] + (a * cos + b * sin) / world;
    let my = view.center[1] + (-a * sin + b * cos) / world;
    (mx * f64::from(1u32 << 24), my * f64::from(1u32 << 24))
}

#[test]
fn rotated_fractional_view_registers_and_keeps_survey_priority() {
    let Some(gpu) = renderer() else { return };
    let mut terrain = Terrain::new(&gpu, 96).unwrap();
    let survey = SourceSpec { authoritative_coverage: true, ..Default::default() };
    terrain.set_sources(HashMap::from([(NATIONAL, SourceSpec::default()), (SURVEY, survey)]));
    let mut view = View { center: [0.170_31, 0.360_77], zoom: 15.3, bearing: 20.0, css: [300.0, 200.0], dpr: 2.0 };
    assert_eq!(view.level(), 16);
    let plane = Plane([view.center[0] * f64::from(1u32 << 24), view.center[1] * f64::from(1u32 << 24)]);
    let mut surveyed = Vec::new();
    let mut load = |terrain: &mut Terrain, view: &View| {
        for tile in view.wanted() {
            if surveyed.contains(&tile) {
                continue;
            }
            surveyed.push(tile);
            let key = TileKey { source: SURVEY, tile };
            terrain.insert(&gpu, key, 3, &plane.tile(tile, 0.0, true)).unwrap();
            let parent = TileId { z: 14, x: tile.x >> 2, y: tile.y >> 2 };
            if surveyed.contains(&parent) {
                continue;
            }
            surveyed.push(parent);
            terrain
                .insert(&gpu, TileKey { source: NATIONAL, tile: parent }, 1, &plane.tile(parent, 5.0, false))
                .unwrap();
        }
    };
    load(&mut terrain, &view);
    let uniforms = Uniforms::default();
    let check = |terrain: &mut Terrain, view: &View| {
        let (_frame, stats) = terrain.render_offscreen(&gpu, view, &uniforms).unwrap();
        assert_eq!(stats.coverage, 1.0);
        let field = terrain.read_field(&gpu).unwrap();
        let (w, h) = view.device_size();
        let (mut plain, mut holes, mut worst) = (0, 0, 0.0f64);
        for py in 0..h {
            for px in 0..w {
                let (x, y) = texel(view, px, py, w, h);
                // Position inside its survey tile; skip texels near the hole edge.
                let (u, v) = (x.rem_euclid(f64::from(TILE)), y.rem_euclid(f64::from(TILE)));
                let inside = |c: f64| c > f64::from(HOLE.start) + 2.0 && c < f64::from(HOLE.end) - 2.0;
                let outside = |c: f64| c < f64::from(HOLE.start) - 2.0 || c > f64::from(HOLE.end) + 2.0;
                let expected = if inside(u) && inside(v) {
                    holes += 1;
                    plane.at(x, y) + 5.0
                } else if outside(u) || outside(v) {
                    plain += 1;
                    plane.at(x, y)
                } else {
                    continue;
                };
                let got = f64::from(field[(py * w + px) as usize]);
                worst = worst.max((got - expected).abs());
            }
        }
        eprintln!("worst {worst:.2e} m over {plain} survey + {holes} hole samples; {stats:?}");
        // 2e-4 m is 0.01 texel along the steeper axis: the registration gate.
        assert!(worst < 2e-4, "max error {worst} m");
        assert!(plain > 1000 && holes > 100, "{plain} plain, {holes} hole samples");
        stats
    };
    let first = check(&mut terrain, &view);
    assert!(first.composited > 0);
    // Pan by a tile and a half: the store re-anchors, copying the overlap.
    view.center[0] += 1.5 / f64::from(1u32 << 16);
    load(&mut terrain, &view);
    let second = check(&mut terrain, &view);
    assert!(second.composited < first.composited + 8, "{second:?} after {first:?}");
    // Unchanged view: nothing recomposites.
    assert_eq!(check(&mut terrain, &view).composited, 0);
}
