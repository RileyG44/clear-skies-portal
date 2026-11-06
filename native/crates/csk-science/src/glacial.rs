//! Geomorphology screening primitives, ported from `glacial-research-core.js`
//! for the configuration the engine uses: metre units both ways, rows running
//! south, the "shrink" edge policy, half the window valid at least.
//!
//! Candidate scores are screening aids, never classifications of origin.

use serde_json::{Map, Value, json};

use crate::Product;

/// A square neighbourhood radius in cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Radius {
    pub x: usize,
    pub y: usize,
}

impl Radius {
    pub fn square(r: usize) -> Self {
        Self { x: r, y: r }
    }
}

const MIN_VALID_FRACTION: f64 = 0.5;

fn spatial_meta(kind: &str, cell: f64, output_unit: &str, details: Value) -> Value {
    let mut m = Map::new();
    m.insert("kind".into(), json!(kind));
    m.insert("resolution".into(), json!({"x": cell, "y": cell, "unit": "m"}));
    m.insert("horizontalUnit".into(), json!("m"));
    m.insert("verticalUnit".into(), json!("m"));
    m.insert("outputUnit".into(), json!(output_unit));
    m.insert("zFactor".into(), json!(1));
    m.insert("zFactorSource".into(), json!("same-unit"));
    m.insert("rowAxis".into(), json!("south"));
    m.insert("noDataRepresentation".into(), json!("NaN"));
    if let Value::Object(d) = details {
        for (k, v) in d {
            m.insert(k, v);
        }
    }
    Value::Object(m)
}

fn radius_meta(r: Radius, cell: f64) -> Value {
    json!({"cells": {"x": r.x, "y": r.y}, "distance": {"x": r.x as f64 * cell, "y": r.y as f64 * cell, "unit": "m"}})
}

#[inline]
fn sample(grid: &[f32], i: usize) -> f64 {
    let v = f64::from(grid[i]);
    if v.is_finite() { v } else { f64::NAN }
}

/// Summed-area tables: every rectangular window O(1), no-data aware.
struct Integral {
    sums: Vec<f64>,
    counts: Vec<u32>,
    stride: usize,
}

impl Integral {
    fn new(grid: &[f32], w: usize, h: usize) -> Self {
        let stride = w + 1;
        let mut sums = vec![0f64; stride * (h + 1)];
        let mut counts = vec![0u32; stride * (h + 1)];
        for y in 0..h {
            let (mut rs, mut rc) = (0f64, 0u32);
            for x in 0..w {
                let v = sample(grid, y * w + x);
                if v.is_finite() {
                    rs += v;
                    rc += 1;
                }
                let t = (y + 1) * stride + x + 1;
                sums[t] = sums[y * stride + x + 1] + rs;
                counts[t] = counts[y * stride + x + 1] + rc;
            }
        }
        Self { sums, counts, stride }
    }

    /// (sum, count, area) over [x0, x1) × [y0, y1).
    fn stats(&self, x0: usize, y0: usize, x1: usize, y1: usize) -> (f64, i64, i64) {
        let s = self.stride;
        let (a, b, c, d) = (y0 * s + x0, y0 * s + x1, y1 * s + x0, y1 * s + x1);
        (
            self.sums[d] - self.sums[b] - self.sums[c] + self.sums[a],
            i64::from(self.counts[d]) - i64::from(self.counts[b]) - i64::from(self.counts[c])
                + i64::from(self.counts[a]),
            ((x1 - x0) * (y1 - y0)) as i64,
        )
    }
}

fn window(x: usize, y: usize, r: Radius, w: usize, h: usize) -> (usize, usize, usize, usize) {
    (x.saturating_sub(r.x), y.saturating_sub(r.y), (x + r.x + 1).min(w), (y + r.y + 1).min(h))
}

fn local_relief_with(grid: &[f32], w: usize, h: usize, integral: &Integral, r: Radius) -> Vec<f32> {
    let mut out = vec![f32::NAN; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let c = sample(grid, i);
            if !c.is_finite() {
                continue;
            }
            let (x0, y0, x1, y1) = window(x, y, r, w, h);
            let (sum, count, area) = integral.stats(x0, y0, x1, y1);
            if count < 1 || (count as f64) / (area as f64) < MIN_VALID_FRACTION {
                continue;
            }
            out[i] = (c - sum / count as f64) as f32;
        }
    }
    out
}

pub fn local_relief(grid: &[f32], w: usize, h: usize, cell: f64, r: Radius) -> Product {
    let data = local_relief_with(grid, w, h, &Integral::new(grid, w, h), r);
    Product {
        data,
        secondary: None,
        metadata: spatial_meta(
            "local-relief-model",
            cell,
            "m",
            json!({"algorithm": "elevation minus no-data-aware rectangular box mean", "radius": radius_meta(r, cell),
                   "edgePolicy": "shrink", "minValidFraction": 0.5,
                   "signConvention": "positive is above the local mean; negative is below it"}),
        ),
    }
}

pub fn terrain_position(grid: &[f32], w: usize, h: usize, cell: f64, outer: Radius, inner: Radius) -> Product {
    let integral = Integral::new(grid, w, h);
    let mut out = vec![f32::NAN; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let c = sample(grid, i);
            if !c.is_finite() {
                continue;
            }
            let (ox0, oy0, ox1, oy1) = window(x, y, outer, w, h);
            let (ix0, iy0, ix1, iy1) = window(x, y, inner, w, h);
            let (osum, ocount, oarea) = integral.stats(ox0, oy0, ox1, oy1);
            let (isum, icount, iarea) = integral.stats(ix0, iy0, ix1, iy1);
            let (count, area) = (ocount - icount, oarea - iarea);
            if count < 1 || area <= 0 || (count as f64) / (area as f64) < MIN_VALID_FRACTION {
                continue;
            }
            out[i] = (c - (osum - isum) / count as f64) as f32;
        }
    }
    Product {
        data: out,
        secondary: None,
        metadata: spatial_meta(
            "terrain-position-index",
            cell,
            "m",
            json!({"algorithm": "center elevation minus mean of a no-data-aware rectangular box annulus",
                   "outerRadius": radius_meta(outer, cell), "excludedInnerRadius": radius_meta(inner, cell),
                   "edgePolicy": "shrink", "minValidFraction": 0.5,
                   "signConvention": "positive is locally high; negative is locally low"}),
        ),
    }
}

/// Riley terrain ruggedness index over the full 3×3 neighbourhood.
pub fn ruggedness(grid: &[f32], w: usize, h: usize, cell: f64) -> Product {
    let r = Radius::square(1);
    let full = 8;
    let mut out = vec![f32::NAN; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let c = sample(grid, i);
            if !c.is_finite() {
                continue;
            }
            let (mut sq, mut count) = (0f64, 0usize);
            for oy in -1isize..=1 {
                for ox in -1isize..=1 {
                    if ox == 0 && oy == 0 {
                        continue;
                    }
                    let (sx, sy) = (x as isize + ox, y as isize + oy);
                    if sx < 0 || sy < 0 || sx >= w as isize || sy >= h as isize {
                        continue;
                    }
                    let v = sample(grid, sy as usize * w + sx as usize);
                    if !v.is_finite() {
                        continue;
                    }
                    let d = c - v;
                    sq += d * d;
                    count += 1;
                }
            }
            if count < full {
                continue;
            }
            out[i] = sq.sqrt() as f32;
        }
    }
    Product {
        data: out,
        secondary: None,
        metadata: spatial_meta(
            "terrain-ruggedness-index",
            cell,
            "m",
            json!({"method": "riley", "radius": radius_meta(r, cell), "minimumValidNeighbours": full,
                   "comparabilityWarning": "Riley TRI grows with neighbour count; keep radius and valid-neighbour policy fixed when comparing rasters."}),
        ),
    }
}

fn quantile_sorted(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let pos = p.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let (lo, hi) = (pos.floor() as usize, pos.ceil() as usize);
    if lo == hi {
        return sorted[lo];
    }
    let f = pos - lo as f64;
    sorted[lo] * (1.0 - f) + sorted[hi] * f
}

fn sort(v: &mut [f64]) {
    v.sort_by(f64::total_cmp);
}

/// (center, scale, method, count) of a residual raster.
type Normalization = (f64, f64, &'static str, usize);

/// Median/MAD, falling back to mean/standard deviation when MAD is zero.
fn robust_location_scale(data: &[f32]) -> Normalization {
    let mut values: Vec<f64> = data.iter().map(|v| f64::from(*v)).filter(|v| v.is_finite()).collect();
    if values.is_empty() {
        return (f64::NAN, f64::NAN, "none", 0);
    }
    sort(&mut values);
    let median = quantile_sorted(&values, 0.5);
    let mut dev: Vec<f64> = values.iter().map(|v| (v - median).abs()).collect();
    sort(&mut dev);
    let mad = 1.4826 * quantile_sorted(&dev, 0.5);
    if mad > f64::EPSILON {
        return (median, mad, "median/MAD", values.len());
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let sd = (values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64).sqrt();
    (mean, sd, if sd > f64::EPSILON { "mean/standard-deviation-fallback" } else { "constant" }, values.len())
}

/// Signed standardised residual with the greatest magnitude across scales.
pub fn multi_scale_residual(grid: &[f32], w: usize, h: usize, cell: f64, scales: &[usize]) -> Product {
    let integral = Integral::new(grid, w, h);
    let residuals: Vec<(Vec<f32>, Normalization)> = scales
        .iter()
        .map(|&r| {
            let d = local_relief_with(grid, w, h, &integral, Radius::square(r));
            let n = robust_location_scale(&d);
            (d, n)
        })
        .collect();
    let mut anomaly = vec![f32::NAN; w * h];
    for (i, a) in anomaly.iter_mut().enumerate() {
        let (mut best, mut best_mag, mut found) = (f64::NAN, -1.0, false);
        for (d, (center, scale, _, _)) in &residuals {
            let r = f64::from(d[i]);
            if !r.is_finite() {
                continue;
            }
            let s = if *scale > f64::EPSILON { (r - center) / scale } else { 0.0 };
            if s.abs() > best_mag {
                best = s;
                best_mag = s.abs();
                found = true;
            }
        }
        if found {
            *a = best as f32;
        }
    }
    Product {
        data: anomaly,
        secondary: None,
        metadata: spatial_meta(
            "multi-scale-local-relief-anomaly",
            cell,
            "standard deviations",
            json!({"residualOutputUnit": "m", "dominantRadiusOutputUnit": "m",
                   "normalization": "per-scale robust median/MAD, with standard-deviation fallback for zero MAD",
                   "composite": "signed standardized residual with the greatest absolute magnitude at each pixel",
                   "caution": "Scores are relative to this raster and scale set; they are not probabilities and should not be compared across differently sampled rasters without calibration."}),
        ),
    }
}

fn neighbour(grid: &[f32], w: usize, h: usize, x: isize, y: isize) -> f64 {
    if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
        return f64::NAN;
    }
    sample(grid, y as usize * w + x as usize)
}

fn first_derivative(neg: f64, center: f64, pos: f64, spacing: f64) -> f64 {
    match (neg.is_finite(), pos.is_finite()) {
        (true, true) => (pos - neg) / (2.0 * spacing),
        (false, true) => (pos - center) / spacing,
        (true, false) => (center - neg) / spacing,
        _ => f64::NAN,
    }
}

/// Slope (radians), northness and eastness.
pub struct SlopeAspect {
    pub slope_radians: Vec<f32>,
    pub northness: Vec<f32>,
    pub eastness: Vec<f32>,
}

pub fn slope_aspect(grid: &[f32], w: usize, h: usize, cell: f64) -> SlopeAspect {
    let n = w * h;
    let mut out =
        SlopeAspect { slope_radians: vec![f32::NAN; n], northness: vec![f32::NAN; n], eastness: vec![f32::NAN; n] };
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let c = sample(grid, i);
            if !c.is_finite() {
                continue;
            }
            let (xi, yi) = (x as isize, y as isize);
            let p = first_derivative(neighbour(grid, w, h, xi - 1, yi), c, neighbour(grid, w, h, xi + 1, yi), cell);
            let q = first_derivative(neighbour(grid, w, h, xi, yi - 1), c, neighbour(grid, w, h, xi, yi + 1), cell);
            if !p.is_finite() || !q.is_finite() {
                continue;
            }
            let grade = p.hypot(q);
            out.slope_radians[i] = grade.atan() as f32;
            if grade <= 1e-12 {
                continue;
            }
            let north = -q;
            let aspect = (((-p).atan2(-north) * 180.0 / std::f64::consts::PI) % 360.0 + 360.0) % 360.0;
            let rad = aspect * std::f64::consts::PI / 180.0;
            out.northness[i] = rad.cos() as f32;
            out.eastness[i] = rad.sin() as f32;
        }
    }
    out
}

pub fn aspect_components(grid: &[f32], w: usize, h: usize, cell: f64) -> Product {
    let s = slope_aspect(grid, w, h, cell);
    Product {
        data: s.northness,
        secondary: Some(s.eastness),
        metadata: spatial_meta(
            "finite-difference-slope-aspect-components",
            cell,
            "mixed; see outputs",
            json!({"derivative": "central difference with one-sided finite fallback at edges or beside no-data",
                   "slopeUnit": "degrees and radians", "aspectConvention": "downslope compass bearing clockwise from north",
                   "northnessConvention": "cos(aspect); +1 north-facing and -1 south-facing",
                   "eastnessConvention": "sin(aspect); +1 east-facing and -1 west-facing",
                   "flatConvention": "aspect, northness, and eastness are NaN on flats; slope-weighted components are zero"}),
        ),
    }
}

/// Plan second derivative and Laplacian.
pub struct Curvature {
    pub plan: Vec<f32>,
    pub laplacian: Vec<f32>,
}

pub fn curvature_fields(grid: &[f32], w: usize, h: usize, cell: f64) -> Curvature {
    let n = w * h;
    let mut out = Curvature { plan: vec![f32::NAN; n], laplacian: vec![f32::NAN; n] };
    let (dx, dy) = (cell, cell);
    for y in 1..h.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let i = y * w + x;
            let s9 =
                [i, i - 1, i + 1, i - w, i + w, i - w - 1, i - w + 1, i + w - 1, i + w + 1].map(|k| sample(grid, k));
            if !s9.iter().all(|v| v.is_finite()) {
                continue;
            }
            let [c, wv, e, nv, s, nw, ne, sw, se] = s9;
            let p = (e - wv) / (2.0 * dx);
            let q = (s - nv) / (2.0 * dy);
            let r = (e - 2.0 * c + wv) / (dx * dx);
            let t = (s - 2.0 * c + nv) / (dy * dy);
            let mixed = (se - sw - ne + nw) / (4.0 * dx * dy);
            out.laplacian[i] = (r + t) as f32;
            let g2 = p * p + q * q;
            if g2 <= 1e-12 * 1e-12 {
                continue;
            }
            out.plan[i] = ((r * q * q - 2.0 * mixed * p * q + t * p * p) / g2) as f32;
        }
    }
    out
}

pub fn curvature(grid: &[f32], w: usize, h: usize, cell: f64) -> Product {
    let c = curvature_fields(grid, w, h, cell);
    Product {
        data: c.laplacian,
        secondary: None,
        metadata: spatial_meta(
            "finite-difference-directional-curvature",
            cell,
            "inverse m",
            json!({"algorithm": "three-by-three central finite differences",
                   "profileDefinition": "directional second derivative along the horizontal elevation gradient",
                   "planDefinition": "directional second derivative perpendicular to the horizontal elevation gradient",
                   "laplacianDefinition": "east-west plus north-south second derivatives",
                   "signConvention": "positive is locally concave-up and negative is locally convex-up",
                   "flatConvention": "directional profile and plan outputs are NaN where gradient direction is undefined; Laplacian remains defined",
                   "caution": "Curvature magnitude depends strongly on DEM resolution, smoothing, vertical datum, and noise."}),
        ),
    }
}

/// Transforms finite values (clamped at 0), scales by an upper quantile to 0..1.
fn normalized(data: &[f32], transform: impl Fn(f64) -> f64, p: f64) -> Vec<f32> {
    let mut out = vec![f32::NAN; data.len()];
    let mut finite = Vec::new();
    for (i, v) in data.iter().enumerate() {
        if v.is_finite() {
            let t = transform(f64::from(*v)).max(0.0);
            out[i] = t as f32;
            finite.push(t);
        }
    }
    sort(&mut finite);
    let mut scale = if finite.is_empty() { f64::NAN } else { quantile_sorted(&finite, p) };
    if (scale.is_nan() || scale <= f64::EPSILON) && !finite.is_empty() {
        scale = finite[finite.len() - 1];
    }
    for v in out.iter_mut().filter(|v| v.is_finite()) {
        *v = if scale > f64::EPSILON { (f64::from(*v) / scale).clamp(0.0, 1.0) as f32 } else { 0.0 };
    }
    out
}

fn combine(grid: &[f32], features: &[&[f32]], weights: &[f64]) -> Vec<f32> {
    let min_count = features.len().min(2);
    let mut score = vec![f32::NAN; grid.len()];
    for (i, s) in score.iter_mut().enumerate() {
        if !grid[i].is_finite() {
            continue;
        }
        let (mut weighted, mut wsum, mut count) = (0f64, 0f64, 0usize);
        for (f, wgt) in features.iter().zip(weights) {
            let v = f64::from(f[i]);
            if !v.is_finite() {
                continue;
            }
            weighted += wgt * v;
            wsum += wgt;
            count += 1;
        }
        if count < min_count || wsum <= 0.0 {
            continue;
        }
        *s = (weighted / wsum) as f32;
    }
    score
}

fn notice_glacial() -> Value {
    json!({
        "id": "glacial-lobe-margin-observational-screen-v1",
        "observationalOnly": true, "diagnostic": false, "scoreIsProbability": false,
        "interpretation": "High scores mark coincident topographic breaks, local relief, curvature, and ridge-or-trough position that may be useful when tracing possible margins.",
        "cannotDetermine": ["glacial origin", "ice limit", "age", "advance or retreat phase", "subsurface continuity"],
        "commonConfounders": ["river terraces", "fault scarps", "landslides", "shorelines", "roads", "quarries", "DEM seams", "modern earthworks"],
        "corroboration": ["surficial geology", "stratigraphy", "sedimentology", "chronology", "imagery", "field observations"],
        "warning": "A high score is a prompt for inspection, never evidence by itself that a glacier occupied the site."
    })
}

fn notice_flood() -> Value {
    json!({
        "id": "flood-channel-observational-screen-v1",
        "observationalOnly": true, "diagnostic": false, "scoreIsProbability": false,
        "interpretation": "High scores mark multi-scale negative relief and concave cross-sectional terrain that may help find channel-like corridors.",
        "cannotDetermine": ["megaflood origin", "flow direction", "discharge", "age", "event count", "sediment transport process"],
        "commonConfounders": ["modern rivers", "glacial troughs", "irrigation canals", "road cuts", "landslides", "karst", "DEM seams", "data voids"],
        "corroboration": ["regional gradient", "mapped deposits", "bar and scour morphology", "stratigraphy", "chronology", "imagery", "field observations"],
        "warning": "A high score describes shape only; it does not establish a flood, much less a megaflood."
    })
}

const NORMALIZATION: &str = "each feature is scaled to a within-raster robust upper quantile; scores are not comparable across rasters without calibration";

pub fn glacial_margin(grid: &[f32], w: usize, h: usize, cell: f64, r: Radius) -> Product {
    let relief = local_relief(grid, w, h, cell, r).data;
    let tpi = terrain_position(grid, w, h, cell, r, Radius::square(0)).data;
    let slope = slope_aspect(grid, w, h, cell).slope_radians;
    let lap = curvature_fields(grid, w, h, cell).laplacian;
    let relief_n = normalized(&relief, f64::abs, 0.9);
    let pos_n = normalized(&tpi, |v| v.max(0.0) + 0.35 * (-v).max(0.0), 0.9);
    let slope_n = normalized(&slope, f64::sin, 0.9);
    let break_n = normalized(&lap, f64::abs, 0.9);
    let score = combine(grid, &[&break_n, &pos_n, &relief_n, &slope_n], &[0.30, 0.25, 0.25, 0.20]);
    Product {
        data: score,
        secondary: None,
        metadata: spatial_meta(
            "glacial-lobe-margin-candidate-score",
            cell,
            "unitless 0 to 1",
            json!({"threshold": 0.58, "neighbourhoodRadius": radius_meta(r, cell),
                   "weights": {"topographicBreak": 0.30, "ridgeOrTroughPosition": 0.25, "localRelief": 0.25, "slope": 0.20},
                   "normalization": NORMALIZATION, "screeningNotice": notice_glacial()}),
        ),
    }
}

pub fn flood_channel(grid: &[f32], w: usize, h: usize, cell: f64, r: Radius) -> Product {
    let relief = local_relief(grid, w, h, cell, r).data;
    let tpi = terrain_position(grid, w, h, cell, r, Radius::square(0)).data;
    let curv = curvature_fields(grid, w, h, cell);
    let neg_relief = normalized(&relief, |v| -v, 0.9);
    let neg_pos = normalized(&tpi, |v| -v, 0.9);
    let cross: Vec<f32> = curv
        .plan
        .iter()
        .zip(&curv.laplacian)
        .map(|(p, l)| {
            if p.is_finite() {
                p.max(0.0)
            } else if l.is_finite() {
                l.max(0.0)
            } else {
                f32::NAN
            }
        })
        .collect();
    let concavity = normalized(&cross, |v| v, 0.9);
    let score = combine(grid, &[&neg_relief, &neg_pos, &concavity], &[0.40, 0.35, 0.25]);
    Product {
        data: score,
        secondary: None,
        metadata: spatial_meta(
            "flood-channel-candidate-score",
            cell,
            "unitless 0 to 1",
            json!({"threshold": 0.58, "neighbourhoodRadius": radius_meta(r, cell),
                   "weights": {"negativeLocalRelief": 0.40, "negativeTerrainPosition": 0.35, "crossSectionConcavity": 0.25},
                   "normalization": NORMALIZATION, "screeningNotice": notice_flood()}),
        ),
    }
}
