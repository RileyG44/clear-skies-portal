//! Lidar surface analysis, ported from `terrain-analysis-core.js`:
//! RVT sky-view factor and openness, the red relief image map, GRASS
//! geomorphons, priority-flood hydrology (depressions, drainage, wetness),
//! avalanche slope angle, clear-sky insolation with cast shadows, and the
//! Winstral wind-shelter index.

use serde_json::json;

use crate::{Product, fixed, js_round};

const D2R: f64 = std::f64::consts::PI / 180.0;
const R2D: f64 = 180.0 / std::f64::consts::PI;
/// Neighbour order: N, NE, E, SE, S, SW, W, NW.
const NX: [isize; 8] = [0, 1, 1, 1, 0, -1, -1, -1];
const NY: [isize; 8] = [-1, -1, 0, 1, 1, 1, 0, -1];
const ND: [f64; 8] = [
    1.0,
    std::f64::consts::SQRT_2,
    1.0,
    std::f64::consts::SQRT_2,
    1.0,
    std::f64::consts::SQRT_2,
    1.0,
    std::f64::consts::SQRT_2,
];

/// Product options (all optional, clamped where read).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Options {
    pub cell_size: f64,
    pub radius_cells: Option<f64>,
    pub flat_degrees: Option<f64>,
    pub negative: bool,
    pub latitude: Option<f64>,
    pub day_of_year: Option<f64>,
    pub wind_azimuth: Option<f64>,
    pub search_metres: Option<f64>,
}

fn int_option(v: Option<f64>, fallback: i64, min: i64, max: i64) -> i64 {
    match v.filter(|v| v.is_finite()) {
        Some(v) => (js_round(v) as i64).clamp(min, max),
        None => fallback,
    }
}

/// Horn gradient with clamped edges; dzdx rises east, dzdy rises south. A
/// tap on no-data borrows the centre height so survey edges stay painted.
pub fn gradients(grid: &[f32], w: usize, h: usize, cell: f64) -> (Vec<f32>, Vec<f32>) {
    let n = w * h;
    let (mut gx, mut gy) = (vec![0f32; n], vec![0f32; n]);
    for y in 0..h {
        let (yn, ys) = (y.saturating_sub(1), if y + 1 < h { y + 1 } else { y });
        for x in 0..w {
            let i = y * w + x;
            let z = f64::from(grid[i]);
            if z.is_nan() {
                gx[i] = f32::NAN;
                gy[i] = f32::NAN;
                continue;
            }
            let (xw, xe) = (x.saturating_sub(1), if x + 1 < w { x + 1 } else { x });
            let at = |xx: usize, yy: usize| {
                let v = f64::from(grid[yy * w + xx]);
                if v.is_nan() { z } else { v }
            };
            let (a, b, c) = (at(xw, yn), at(x, yn), at(xe, yn));
            let (d, f) = (at(xw, y), at(xe, y));
            let (g, hh, k) = (at(xw, ys), at(x, ys), at(xe, ys));
            gx[i] = (((c + 2.0 * f + k) - (a + 2.0 * d + g)) / (8.0 * cell)) as f32;
            gy[i] = (((g + 2.0 * hh + k) - (a + 2.0 * b + c)) / (8.0 * cell)) as f32;
        }
    }
    (gx, gy)
}

pub fn slope_degrees(gx: &[f32], gy: &[f32]) -> Vec<f32> {
    gx.iter()
        .zip(gy)
        .map(|(&x, &y)| if x.is_nan() { f32::NAN } else { (f64::from(x).hypot(f64::from(y)).atan() * R2D) as f32 })
        .collect()
}

/// Every cell close in, then about 12% apart.
pub fn scan_distances(max_cells: i64) -> Vec<i64> {
    let mut out = Vec::new();
    let mut d = 1i64;
    while d <= max_cells {
        out.push(d);
        d = (d + 1).max(js_round(d as f64 * 1.12) as i64);
    }
    out
}

struct Ray {
    ox: Vec<isize>,
    oy: Vec<isize>,
    dist: Vec<f64>,
}

fn ray(azimuth: f64, max_cells: i64, cell: f64) -> Ray {
    let (sx, sy) = ((azimuth * D2R).sin(), -(azimuth * D2R).cos());
    let mut r = Ray { ox: Vec::new(), oy: Vec::new(), dist: Vec::new() };
    let (mut lx, mut ly) = (0isize, 0isize);
    for d in scan_distances(max_cells) {
        let (x, y) = (js_round(sx * d as f64) as isize, js_round(sy * d as f64) as isize);
        if x == lx && y == ly {
            continue;
        }
        lx = x;
        ly = y;
        r.ox.push(x);
        r.oy.push(y);
        r.dist.push((x as f64).hypot(y as f64) * cell);
    }
    r
}

fn directions(count: usize) -> Vec<f64> {
    (0..count).map(|k| k as f64 * 360.0 / count as f64).collect()
}

/// Steepest rise and fall tangents along a ray; NaN if it leaves the grid
/// before its first valid sample.
#[inline]
fn scan(grid: &[f32], w: usize, h: usize, x: usize, y: usize, z: f64, r: &Ray) -> (f64, f64) {
    let (mut best, mut worst) = (f64::NEG_INFINITY, f64::INFINITY);
    for s in 0..r.ox.len() {
        let (xx, yy) = (x as isize + r.ox[s], y as isize + r.oy[s]);
        if xx < 0 || yy < 0 || xx >= w as isize || yy >= h as isize {
            break;
        }
        let v = f64::from(grid[yy as usize * w + xx as usize]);
        if v.is_nan() {
            continue;
        }
        let t = (v - z) / r.dist[s];
        best = best.max(t);
        worst = worst.min(t);
    }
    (if best == f64::NEG_INFINITY { f64::NAN } else { best }, if worst == f64::INFINITY { f64::NAN } else { worst })
}

struct Horizon {
    svf: Vec<f32>,
    pos: Vec<f32>,
    neg: Vec<f32>,
    radius: i64,
}

fn horizon_products(grid: &[f32], w: usize, h: usize, o: &Options, svf: bool) -> Horizon {
    let cell = o.cell_size;
    let radius = int_option(o.radius_cells, 20, 2, 400);
    let count = if svf { 16 } else { 8 };
    let rays: Vec<Ray> = directions(count).into_iter().map(|a| ray(a, radius, cell)).collect();
    let n = w * h;
    let mut out = Horizon {
        svf: if svf { vec![0.0; n] } else { Vec::new() },
        pos: if svf { Vec::new() } else { vec![0.0; n] },
        neg: if svf { Vec::new() } else { vec![0.0; n] },
        radius,
    };
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let z = f64::from(grid[i]);
            let (mut sky, mut ps, mut ns, mut used) = (0.0, 0.0, 0.0, 0usize);
            if !z.is_nan() {
                for r in &rays {
                    let (best, worst) = scan(grid, w, h, x, y, z, r);
                    if best.is_nan() {
                        continue;
                    }
                    used += 1;
                    let (up, down) = (best.atan(), worst.atan());
                    if svf {
                        sky += up.max(0.0).sin();
                    } else {
                        ps += 90.0 - up * R2D;
                        ns += 90.0 + down * R2D;
                    }
                }
            }
            if used == 0 {
                if svf {
                    out.svf[i] = f32::NAN;
                } else {
                    out.pos[i] = f32::NAN;
                    out.neg[i] = f32::NAN;
                }
                continue;
            }
            if svf {
                out.svf[i] = (1.0 - sky / used as f64) as f32;
            } else {
                out.pos[i] = (ps / used as f64) as f32;
                out.neg[i] = (ns / used as f64) as f32;
            }
        }
    }
    out
}

pub fn sky_view_factor(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let r = horizon_products(grid, w, h, o, true);
    Product {
        data: r.svf,
        secondary: None,
        metadata: json!({"kind": "sky-view-factor", "unit": "fraction", "radiusCells": r.radius,
            "radiusMetres": r.radius as f64 * o.cell_size, "directions": 16, "method": "RVT sky-view factor"}),
    }
}

pub fn openness(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let r = horizon_products(grid, w, h, o, false);
    let neg = o.negative;
    Product {
        data: if neg { r.neg } else { r.pos },
        secondary: None,
        metadata: json!({"kind": if neg { "negative-openness" } else { "positive-openness" }, "unit": "degrees",
            "radiusCells": r.radius, "radiusMetres": r.radius as f64 * o.cell_size, "directions": 8,
            "method": "Yokoyama openness"}),
    }
}

/// Red relief image map (Chiba 2008): data is differential openness,
/// secondary the slope in degrees.
pub fn red_relief(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let r = horizon_products(grid, w, h, o, false);
    let (gx, gy) = gradients(grid, w, h, o.cell_size);
    let slope = slope_degrees(&gx, &gy);
    let diff = r.pos.iter().zip(&r.neg).map(|(p, n)| ((f64::from(*p) - f64::from(*n)) / 2.0) as f32).collect();
    Product {
        data: diff,
        secondary: Some(slope),
        metadata: json!({"kind": "red-relief-image-map", "unit": "degrees", "radiusCells": r.radius,
            "radiusMetres": r.radius as f64 * o.cell_size, "method": "Chiba red relief image map"}),
    }
}

pub const GEOMORPHON_CLASSES: [&str; 11] =
    ["", "Flat", "Peak", "Ridge", "Shoulder", "Spur", "Slope", "Hollow", "Footslope", "Valley", "Pit"];
const FL: u8 = 1;
const PK: u8 = 2;
const RI: u8 = 3;
const SH: u8 = 4;
const SP: u8 = 5;
const SL: u8 = 6;
const HL: u8 = 7;
const FS: u8 = 8;
const VL: u8 = 9;
const PT: u8 = 10;
/// GRASS r.geomorphon: rows count lower directions, columns higher.
const GEOMORPHON_TABLE: [[u8; 9]; 9] = [
    [FL, FL, FL, FS, FS, VL, VL, VL, PT],
    [FL, FL, FS, FS, FS, VL, VL, VL, 0],
    [FL, SH, SL, SL, HL, HL, VL, 0, 0],
    [SH, SH, SL, SL, SL, HL, 0, 0, 0],
    [SH, SH, SP, SL, SL, 0, 0, 0, 0],
    [RI, RI, SP, SP, 0, 0, 0, 0, 0],
    [RI, RI, RI, 0, 0, 0, 0, 0, 0],
    [RI, RI, 0, 0, 0, 0, 0, 0, 0],
    [PK, 0, 0, 0, 0, 0, 0, 0, 0],
];

pub fn geomorphon_class(lower: usize, higher: usize) -> u8 {
    match GEOMORPHON_TABLE[lower][higher] {
        0 => SL,
        c => c,
    }
}

pub fn geomorphons(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let cell = o.cell_size;
    let radius = int_option(o.radius_cells, 20, 2, 400);
    let flat = (o.flat_degrees.filter(|v| v.is_finite()).unwrap_or(1.0) * D2R).tan();
    let rays: Vec<Ray> = directions(8).into_iter().map(|a| ray(a, radius, cell)).collect();
    let mut out = vec![0f32; w * h];
    let mut counts = [0u32; 11];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let z = f64::from(grid[i]);
            if z.is_nan() {
                out[i] = f32::NAN;
                continue;
            }
            let (mut higher, mut lower) = (0, 0);
            for r in &rays {
                let (best, worst) = scan(grid, w, h, x, y, z, r);
                if best.is_nan() {
                    continue;
                }
                let (up, down) = (best.max(0.0), (-worst).max(0.0));
                if up - down > flat {
                    higher += 1;
                } else if down - up > flat {
                    lower += 1;
                }
            }
            let form = geomorphon_class(lower, higher);
            out[i] = f32::from(form);
            counts[form as usize] += 1;
        }
    }
    let total = counts.iter().sum::<u32>().max(1);
    let mut shares = serde_json::Map::new();
    for c in 1..=10 {
        shares.insert(GEOMORPHON_CLASSES[c].into(), json!(fixed(f64::from(counts[c]) / f64::from(total), 4)));
    }
    Product {
        data: out,
        secondary: None,
        metadata: json!({"kind": "geomorphons", "unit": "class", "classes": &GEOMORPHON_CLASSES[1..], "shares": shares,
            "radiusCells": radius, "radiusMetres": radius as f64 * cell, "flatDegrees": flat.atan() * R2D,
            "method": "Jasiewicz & Stepinski geomorphons"}),
    }
}

/// The JavaScript engine's binary min-heap, reproduced exactly: pop order
/// among equal keys decides flat-routing, so it must match.
struct Heap {
    items: Vec<u32>,
}

impl Heap {
    fn push(&mut self, keys: &[f64], index: u32) {
        let mut at = self.items.len();
        self.items.push(index);
        let key = keys[index as usize];
        while at > 0 {
            let parent = (at - 1) >> 1;
            if keys[self.items[parent] as usize] <= key {
                break;
            }
            self.items[at] = self.items[parent];
            at = parent;
        }
        self.items[at] = index;
    }

    fn pop(&mut self, keys: &[f64]) -> u32 {
        let top = self.items[0];
        let last = self.items.pop().expect("non-empty");
        let size = self.items.len();
        if size > 0 {
            let mut at = 0;
            let key = keys[last as usize];
            loop {
                let mut child = 2 * at + 1;
                if child >= size {
                    break;
                }
                if child + 1 < size && keys[self.items[child + 1] as usize] < keys[self.items[child] as usize] {
                    child += 1;
                }
                if keys[self.items[child] as usize] >= key {
                    break;
                }
                self.items[at] = self.items[child];
                at = child;
            }
            self.items[at] = last;
        }
        top
    }
}

/// Priority-flood (Barnes 2014): edge and no-data-adjacent cells drain out;
/// `epsilon > 0` gives flats a gradient toward their outlet. Returns the
/// filled surface and the pop order (downstream first).
pub fn priority_flood(grid: &[f32], w: usize, h: usize, epsilon: f64) -> (Vec<f64>, Vec<u32>) {
    let n = w * h;
    let mut filled = vec![0f64; n];
    let mut closed = vec![false; n];
    let mut order = Vec::with_capacity(n);
    let mut heap = Heap { items: Vec::with_capacity(n) };
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let z = f64::from(grid[i]);
            if z.is_nan() {
                filled[i] = f64::NAN;
                closed[i] = true;
                continue;
            }
            filled[i] = z;
            let mut edge = x == 0 || y == 0 || x == w - 1 || y == h - 1;
            for k in 0..8 {
                if edge {
                    break;
                }
                let v = grid[(y as isize + NY[k]) as usize * w + (x as isize + NX[k]) as usize];
                if v.is_nan() {
                    edge = true;
                }
            }
            if edge {
                closed[i] = true;
                heap.push(&filled, i as u32);
            }
        }
    }
    while !heap.items.is_empty() {
        let c = heap.pop(&filled) as usize;
        order.push(c as u32);
        let (cx, cy) = (c % w, c / w);
        let base = filled[c];
        for k in 0..8 {
            let (x, y) = (cx as isize + NX[k], cy as isize + NY[k]);
            if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
                continue;
            }
            let nb = y as usize * w + x as usize;
            if closed[nb] {
                continue;
            }
            closed[nb] = true;
            let floor = if epsilon > 0.0 { base + epsilon * ND[k] } else { base };
            if filled[nb] < floor {
                filled[nb] = floor;
            }
            heap.push(&filled, nb as u32);
        }
    }
    (filled, order)
}

/// Depth in sink (WhiteboxTools): closed basins, metres.
pub fn depressions(grid: &[f32], w: usize, h: usize, _o: &Options) -> Product {
    let (filled, _) = priority_flood(grid, w, h, 0.0);
    let mut out = vec![0f32; w * h];
    let (mut cells, mut deepest) = (0u64, 0f64);
    for i in 0..out.len() {
        let z = f64::from(grid[i]);
        if z.is_nan() {
            out[i] = f32::NAN;
            continue;
        }
        let depth = filled[i] - z;
        out[i] = if depth > 0.005 { depth as f32 } else { 0.0 };
        if out[i] > 0.0 {
            cells += 1;
            deepest = deepest.max(depth);
        }
    }
    Product {
        data: out,
        secondary: None,
        metadata: json!({"kind": "depth-in-sink", "unit": "m", "sinkCells": cells, "maxDepth": deepest,
            "method": "Priority-flood depth in sink"}),
    }
}

fn flow_epsilon(grid: &[f32]) -> f64 {
    let max = grid.iter().map(|v| f64::from(*v).abs()).filter(|v| !v.is_nan()).fold(0.0, f64::max);
    (max * 4e-12).max(1e-7)
}

/// Freeman (1991) multiple-flow accumulation with Quinn contour lengths, in cells.
fn mfd(filled: &[f64], order: &[u32], w: usize, h: usize, cell: f64, exponent: f64) -> Vec<f64> {
    const CONTOUR: [f64; 8] = [0.5, 0.354, 0.5, 0.354, 0.5, 0.354, 0.5, 0.354];
    let mut acc: Vec<f64> = filled.iter().map(|v| if v.is_nan() { 0.0 } else { 1.0 }).collect();
    let mut weights = [0f64; 8];
    for &c in order.iter().rev() {
        let c = c as usize;
        let (cx, cy) = (c % w, c / w);
        let z = filled[c];
        let mut total = 0.0;
        for k in 0..8 {
            weights[k] = 0.0;
            let (x, y) = (cx as isize + NX[k], cy as isize + NY[k]);
            if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
                continue;
            }
            let v = filled[y as usize * w + x as usize];
            if v.is_nan() || v >= z {
                continue;
            }
            weights[k] = ((z - v) / (ND[k] * cell)).powf(exponent) * CONTOUR[k];
            total += weights[k];
        }
        if total.is_nan() || total <= 0.0 {
            continue;
        }
        let a = acc[c];
        for k in 0..8 {
            if weights[k] > 0.0 {
                let nb = (cy as isize + NY[k]) as usize * w + (cx as isize + NX[k]) as usize;
                acc[nb] += a * weights[k] / total;
            }
        }
    }
    acc
}

/// Contributing area, m². Upslope area outside the view is unknown.
pub fn drainage(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let cell = o.cell_size;
    let (filled, order) = priority_flood(grid, w, h, flow_epsilon(grid));
    let acc = mfd(&filled, &order, w, h, cell, 8.0);
    let area = cell * cell;
    let mut peak = 0f32;
    let mut out: Vec<f32> = (0..w * h)
        .map(|i| {
            let v = if filled[i].is_nan() { f32::NAN } else { (acc[i] * area) as f32 };
            if v > peak {
                peak = v;
            }
            v
        })
        .collect();
    // The view edge is an outlet; blank a two-cell frame of artificial streams.
    for y in 0..h {
        for x in 0..w {
            if x < 2 || y < 2 || x + 2 >= w || y + 2 >= h {
                out[y * w + x] = f32::NAN;
            }
        }
    }
    Product {
        data: out,
        secondary: None,
        metadata: json!({"kind": "flow-accumulation", "unit": "m2", "maxArea": peak, "cellArea": area,
            "method": "Priority-flood + steep multiple flow direction",
            "caution": "Only drainage inside this view is counted, so streams that enter from outside it start small."}),
    }
}

/// Topographic wetness index ln(a / tan β), Freeman MFD exponent 1.1.
pub fn wetness(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let cell = o.cell_size;
    let (filled, order) = priority_flood(grid, w, h, flow_epsilon(grid));
    let acc = mfd(&filled, &order, w, h, cell, 1.1);
    let (gx, gy) = gradients(grid, w, h, cell);
    let out = (0..w * h)
        .map(|i| {
            if filled[i].is_nan() {
                return f32::NAN;
            }
            let tan_b = f64::from(gx[i]).hypot(f64::from(gy[i])).max(0.001);
            (acc[i] * cell / tan_b).ln() as f32
        })
        .collect();
    Product {
        data: out,
        secondary: None,
        metadata: json!({"kind": "topographic-wetness-index", "unit": "index", "method": "Freeman MFD wetness index",
            "caution": "Only drainage inside this view is counted; wetness along streams entering the view is underestimated."}),
    }
}

pub fn avalanche_slope(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let (gx, gy) = gradients(grid, w, h, o.cell_size);
    let slope = slope_degrees(&gx, &gy);
    let (mut start, mut total) = (0u64, 0u64);
    for s in slope.iter().filter(|s| !s.is_nan()) {
        total += 1;
        if (30.0..=45.0).contains(s) {
            start += 1;
        }
    }
    Product {
        data: slope,
        secondary: None,
        metadata: json!({"kind": "avalanche-slope-angle", "unit": "degrees",
            "startZoneShare": if total > 0 { fixed(start as f64 / total as f64, 4) } else { 0.0 },
            "method": "Horn slope angle",
            "caution": "Slope angle is one input to avalanche terrain. It does not account for snowpack, weather or terrain traps, and coarse elevation underestimates short steep rolls."}),
    }
}

/// Solar altitude and azimuth in degrees (NOAA low precision), local solar time.
pub fn sun_position(latitude: f64, day: f64, hour: f64) -> (f64, f64) {
    let decl = 23.44 * D2R * (2.0 * std::f64::consts::PI * (284.0 + day) / 365.0).sin();
    let lat = latitude * D2R;
    let ha = (hour - 12.0) * 15.0 * D2R;
    let sin_alt = lat.sin() * decl.sin() + lat.cos() * decl.cos() * ha.cos();
    let alt = sin_alt.clamp(-1.0, 1.0).asin();
    let denom = alt.cos() * lat.cos();
    let cos_az = (decl.sin() - alt.sin() * lat.sin()) / if denom == 0.0 { 1e-12 } else { denom };
    let mut az = cos_az.clamp(-1.0, 1.0).acos() * R2D;
    if ha > 0.0 {
        az = 360.0 - az;
    }
    (alt * R2D, az)
}

/// Clear-sky beam normal irradiance, W/m² (Kasten–Young air mass, Meinel).
pub fn beam_irradiance(altitude: f64, day: f64) -> f64 {
    if altitude <= 0.0 {
        return 0.0;
    }
    let am = 1.0 / ((altitude * D2R).sin() + 0.50572 * (altitude + 6.07995).powf(-1.6364));
    1361.0 * (1.0 + 0.033 * (2.0 * std::f64::consts::PI * day / 365.0).cos()) * 0.7f64.powf(am.powf(0.678))
}

/// Daily clear-sky insolation with cast shadows: data kWh/m²/day,
/// secondary hours of direct sun.
pub fn solar_exposure(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let cell = o.cell_size;
    let latitude = o.latitude.filter(|v| v.is_finite()).unwrap_or(45.0).clamp(-85.0, 85.0);
    let day = int_option(o.day_of_year, 355, 1, 366) as f64;
    let radius = int_option(o.radius_cells, (5000.0 / cell).ceil() as i64, 4, 320);
    const SECTORS: usize = 32;
    let rays: Vec<Ray> = directions(SECTORS).into_iter().map(|a| ray(a, radius, cell)).collect();
    let n = w * h;
    let mut horizon = vec![0f32; SECTORS * n];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let z = f64::from(grid[i]);
            if z.is_nan() {
                continue;
            }
            for (k, r) in rays.iter().enumerate() {
                let (best, _) = scan(grid, w, h, x, y, z, r);
                horizon[k * n + i] = if best.is_nan() { 0.0 } else { (best.atan() * R2D).max(0.0) as f32 };
            }
        }
    }
    let (gx, gy) = gradients(grid, w, h, cell);
    let mut energy = vec![0f64; n];
    let mut hours = vec![0f32; n];
    let step = 1.0 / 6.0;
    let (mut daylight, mut noon) = (0.0, -90.0f64);
    let mut t = step / 2.0;
    while t < 24.0 {
        let (alt, az) = sun_position(latitude, day, t);
        t += step;
        noon = noon.max(alt);
        if alt <= 0.0 {
            continue;
        }
        daylight += step;
        let beam = beam_irradiance(alt, day);
        let diffuse = 0.12 * beam * (alt * D2R).sin();
        let (sa, ca, sz, cz) = ((alt * D2R).sin(), (alt * D2R).cos(), (az * D2R).sin(), (az * D2R).cos());
        let sector = az / (360.0 / SECTORS as f64);
        let k0 = (sector.floor() as usize) % SECTORS;
        let k1 = (k0 + 1) % SECTORS;
        let f = sector - sector.floor();
        for i in 0..n {
            let east = f64::from(gx[i]);
            if east.is_nan() {
                continue;
            }
            let north = -f64::from(gy[i]);
            let norm = (east * east + north * north + 1.0).sqrt();
            let cos_i = (sa - east * ca * sz - north * ca * cz) / norm;
            let mut direct = 0.0;
            if cos_i > 0.0 {
                let hz = f64::from(horizon[k0 * n + i]) * (1.0 - f) + f64::from(horizon[k1 * n + i]) * f;
                if alt > hz {
                    direct = beam * cos_i;
                    hours[i] = (f64::from(hours[i]) + step) as f32;
                }
            }
            energy[i] += (direct + diffuse * (1.0 + 1.0 / norm) / 2.0) * step;
        }
    }
    let mut out = vec![0f32; n];
    let mut peak = 0f32;
    for i in 0..n {
        if gx[i].is_nan() {
            out[i] = f32::NAN;
            hours[i] = f32::NAN;
            continue;
        }
        out[i] = (energy[i] / 1000.0) as f32;
        peak = peak.max(out[i]);
    }
    Product {
        data: out,
        secondary: Some(hours),
        metadata: json!({"kind": "clear-sky-insolation", "unit": "kWh/m2/day", "secondaryUnit": "hours",
            "dayOfYear": day, "latitude": latitude, "daylightHours": fixed(daylight, 2),
            "noonSunAltitude": fixed(noon, 1), "maxEnergy": peak, "horizonMetres": radius as f64 * cell,
            "method": "Clear-sky beam with horizon cast shadows",
            "caution": "Clear-sky estimate. Clouds, forest canopy and terrain beyond the horizon search are not modelled."}),
    }
}

/// Winstral maximum upwind slope Sx over a ±15° fan; positive sheltered.
pub fn wind_exposure(grid: &[f32], w: usize, h: usize, o: &Options) -> Product {
    let cell = o.cell_size;
    let from = int_option(o.wind_azimuth, 270, 0, 359).rem_euclid(360) as f64;
    let reach = o.search_metres.filter(|v| v.is_finite()).unwrap_or(300.0).max(cell * 2.0);
    let radius = ((reach / cell).ceil() as i64).clamp(2, 300);
    let fan: Vec<Ray> = [-15.0, -7.5, 0.0, 7.5, 15.0].iter().map(|off| ray(from + off, radius, cell)).collect();
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let z = f64::from(grid[i]);
            if z.is_nan() {
                out[i] = f32::NAN;
                continue;
            }
            let (mut sum, mut used) = (0.0, 0usize);
            for r in &fan {
                let (best, _) = scan(grid, w, h, x, y, z, r);
                if best.is_nan() {
                    continue;
                }
                sum += best.atan() * R2D;
                used += 1;
            }
            out[i] = if used > 0 { (sum / used as f64) as f32 } else { f32::NAN };
        }
    }
    Product {
        data: out,
        secondary: None,
        metadata: json!({"kind": "winstral-sx", "unit": "degrees", "windFrom": from, "searchMetres": radius as f64 * cell,
            "method": "Winstral maximum upwind slope",
            "caution": "Terrain-only wind index. Real loading depends on wind speed, snow supply and vegetation."}),
    }
}
