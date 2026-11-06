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
    // A view sample returns the drawn heights without blocking the frame.
    terrain.request_sample();
    terrain.render_offscreen(&gpu, &view, &uniforms).unwrap();
    let sample = loop {
        if let Some(sample) = terrain.take_sample(&gpu) {
            break sample;
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    };
    assert_eq!(sample.heights.len(), (sample.width * sample.height) as usize);
    assert!(sample.width > sample.height && sample.heights.len() > 8000, "{}x{}", sample.width, sample.height);
    assert!(sample.heights.iter().all(|h| h.is_finite()), "every sample has terrain");
}

/// The valley floor lies under the terrain it was derived from, and samples
/// carry the bundled water geography: Lake Superior's north shore.
#[test]
fn derived_floor_stays_under_terrain_and_samples_classify_water() {
    let Some(gpu) = renderer() else { return };
    gpu.install_water(&csk_gpu::water::packed().unwrap()).unwrap();
    let mut terrain = Terrain::new(&gpu, 64).unwrap();
    terrain.set_sources(HashMap::from([(NATIONAL, SourceSpec::default())]));
    let view = View { center: [0.250_83, 0.347_82], zoom: 12.6, bearing: 15.0, css: [240.0, 180.0], dpr: 1.0 };
    let z = view.level();
    for tile in view.wanted() {
        let mut heights = Vec::with_capacity((TILE * TILE) as usize);
        for j in 0..TILE {
            for i in 0..TILE {
                let x = f64::from(tile.x * TILE + i) * 0.05;
                let y = f64::from(tile.y * TILE + j) * 0.03;
                heights.push((300.0 + 40.0 * x.sin() * y.cos() + 0.2 * f64::from(i)) as f32);
            }
        }
        terrain.insert(&gpu, TileKey { source: NATIONAL, tile }, 1, &heights).unwrap();
    }
    let metres = csk_gpu::WORLD_METRES / f64::from(TILE) / f64::from(1u32 << z);
    terrain.set_derive(csk_gpu::Derive { blur: 4.0 * metres, base: 12.0 * metres, land_base: 12.0 * metres });
    terrain.request_sample();
    terrain.render_offscreen(&gpu, &view, &Uniforms::default()).unwrap();
    let sample = (0..400)
        .find_map(|_| {
            std::thread::sleep(std::time::Duration::from_millis(5));
            terrain.take_sample(&gpu)
        })
        .expect("view sample");
    let pairs: Vec<_> =
        sample.heights.iter().zip(&sample.base).filter(|(h, b)| h.is_finite() && b.is_finite()).collect();
    assert!(pairs.len() * 10 > sample.heights.len() * 9, "floors cover the view");
    // Bilinear reads of floor and field differ by at most the in-texel slope.
    assert!(pairs.iter().all(|(h, b)| **b <= **h + 1.0), "floor above terrain");
    assert!(pairs.iter().any(|(h, b)| **h - **b > 5.0), "floor follows the valleys");
    let (w, h) = view.device_size();
    for (index, class) in sample.water.iter().enumerate() {
        let (sx, sy) = (index as u32 % sample.width, index as u32 / sample.width);
        let px = ((f64::from(sx) + 0.5) * f64::from(w) / f64::from(sample.width)) as u32;
        let py = ((f64::from(sy) + 0.5) * f64::from(h) / f64::from(sample.height)) as u32;
        let (mx, my) = texel(&view, px, py, w, h);
        let merc = [mx / f64::from(1u32 << 24), my / f64::from(1u32 << 24)];
        let near = [-1e-5, 0.0, 1e-5]
            .iter()
            .flat_map(|dx| [-1e-5, 0.0, 1e-5].map(|dy| [merc[0] + dx, merc[1] + dy]))
            .any(|m| csk_gpu::water::class_at(csk_gpu::water::packed_cached(), m) == *class);
        assert!(near, "water class at sample {index}");
    }
    assert!(sample.water.contains(&2) && sample.water.contains(&0), "shore view has land and inland water");
}

/// Raster tiles land where the camera puts them, at their opacity, with a
/// held ancestor standing in for a tile still loading.
#[test]
fn raster_layers_draw_in_place_with_stand_ins() {
    use csk_gpu::{Layer, Raster, RasterStyle};
    let Some(gpu) = renderer() else { return };
    let mut terrain = Terrain::new(&gpu, 8).unwrap();
    let mut raster = Raster::new(&gpu, 8, 0, 16, TILE).unwrap();
    // The view centre sits in the middle of tile (12, 1000, 1500).
    let view =
        View { center: [1000.5 / 4096.0, 1500.5 / 4096.0], zoom: 12.0, bearing: 30.0, css: [512.0, 512.0], dpr: 1.0 };
    let solid = |rgba: [u8; 4]| rgba.repeat((TILE * TILE) as usize);
    let style = RasterStyle { opacity: 0.5, muted: false };
    let centre = |terrain: &mut Terrain, raster: &mut Raster| {
        let (frame, _) = terrain
            .render_offscreen_layers(&gpu, &view, &Uniforms::default(), &mut [Layer::Raster(raster, style)])
            .unwrap();
        let pixels = gpu.readback(&frame).unwrap();
        let at = |x: usize, y: usize| pixels[(y * 512 + x) * 4..(y * 512 + x) * 4 + 4].to_vec();
        (at(256, 256), at(456, 256))
    };
    raster.insert(&gpu, TileId { z: 11, x: 500, y: 750 }, &solid([0, 0, 255, 255])).unwrap();
    assert_eq!(centre(&mut terrain, &mut raster).0, vec![0, 0, 128, 128], "ancestor stands in");
    raster.insert(&gpu, TileId { z: 12, x: 1000, y: 1500 }, &solid([255, 0, 0, 255])).unwrap();
    let (middle, corner) = centre(&mut terrain, &mut raster);
    assert_eq!(middle, vec![128, 0, 0, 128], "tile at half opacity");
    // 200 px east on screen is, turned 30°, a neighbour inside the ancestor.
    assert_eq!(corner, vec![0, 0, 128, 128]);
    raster.insert_empty(TileId { z: 12, x: 1000, y: 1500 });
    assert_eq!(centre(&mut terrain, &mut raster).0, vec![0, 0, 0, 0], "an empty answer hides the stand-in");
}

/// Vector layers: a filled, outlined area, a dashed line and a point land
/// where the camera puts them at zoom 18 with the map turned, fills under
/// lines, lines at their screen width, all at the layer's opacity.
#[test]
fn vector_layers_draw_in_place_at_screen_widths() {
    use csk_gpu::{Geometry, Layer, Marker, Point, Shape, Shapes, Style, Vector, vector::tessellate};
    let Some(gpu) = renderer() else { return };
    let mut terrain = Terrain::new(&gpu, 8).unwrap();
    // Far from the mesh origin, so precision near the view centre matters.
    let centre = [0.1712345678, 0.3456789012];
    let view = View { center: centre, zoom: 18.0, bearing: 90.0, css: [256.0, 256.0], dpr: 1.0 };
    let world = 256.0 * 2f64.powi(18);
    let px = |dx: f64, dy: f64| [centre[0] + dx / world, centre[1] + dy / world];
    let red = Style { fill: [1.0, 0.0, 0.0, 1.0], line: [0.0, 1.0, 0.0, 1.0], width: 4.0, dash: [0.0; 2] };
    let blue = Style { fill: [0.0; 4], line: [0.0, 0.0, 1.0, 1.0], width: 6.0, dash: [10.0, 10.0] };
    let far = [centre[0] + 0.01, centre[1] + 0.01];
    let shapes = Shapes {
        styles: vec![red, blue],
        shapes: vec![
            // A 60 px square centred on the view; a far shape moves the origin.
            Shape {
                geometry: Geometry::Area(vec![vec![
                    px(-30.0, -30.0),
                    px(30.0, -30.0),
                    px(30.0, 30.0),
                    px(-30.0, 30.0),
                ]]),
                style: 0,
                feature: 0,
            },
            Shape { geometry: Geometry::Line(vec![far, [far[0] + 1e-6, far[1]]]), style: 0, feature: 1 },
            // A dashed line 80 px north on the map, running east-west.
            Shape { geometry: Geometry::Line(vec![px(-100.0, -80.0), px(100.0, -80.0)]), style: 1, feature: 2 },
        ],
        points: vec![Point {
            marker: Marker {
                at: px(0.0, 60.0),
                radius: 6.0,
                stroke: 2.0,
                fill: [1.0, 1.0, 0.0, 1.0],
                line: [1.0; 4],
                dash: [0.0; 2],
            },
            feature: 3,
        }],
    };
    let vector = Vector::new(&gpu, &tessellate(&shapes)).unwrap();
    let (frame, _) =
        terrain.render_offscreen_layers(&gpu, &view, &Uniforms::default(), &mut [Layer::Vector(&vector, 0.5)]).unwrap();
    let pixels = gpu.readback(&frame).unwrap();
    let at = |x: usize, y: usize| pixels[(y * 256 + x) * 4..(y * 256 + x) * 4 + 4].to_vec();
    // Turned 90° clockwise: map north is screen east, map east screen south.
    assert_eq!(at(128, 128), vec![128, 0, 0, 128], "fill at half opacity");
    // Half-opacity green over the half-opacity red fill.
    assert_eq!(at(128, 128 - 30), vec![64, 128, 0, 191], "outline over the fill, on the edge");
    assert_eq!(at(128, 128 - 34), vec![0, 0, 0, 0], "a 4 px outline ends 2 px out");
    // The line runs down the screen from y = 28; 10 px dashes, 10 px gaps.
    assert_eq!(at(128 + 80, 128 + 5), vec![0, 0, 128, 128], "dash");
    assert_eq!(at(128 + 80, 128 + 15), vec![0, 0, 0, 0], "gap");
    assert_eq!(at(128 + 84, 128 + 5), vec![0, 0, 0, 0], "a 6 px line ends 3 px out");
    assert_eq!(at(128 - 60, 128), vec![128, 128, 0, 128], "point fill");
}
