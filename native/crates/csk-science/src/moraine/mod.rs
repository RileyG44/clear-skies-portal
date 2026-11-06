//! Moraine leads (Beta): the complete raster pipeline from
//! glacial-moraine-analysis.js. Fixed physical defaults deliberately do not
//! depend on the research scale selector. Verdicts describe morphology only.

mod features;
mod geometry;

use std::f64::consts::PI;

use serde_json::json;

use crate::{Product, glacial, js_round};
use features::{BeltContext, Context, RidgeFeatures, quantile};
use geometry::{Segment, moments, orientation};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Verdict {
    Unsupported,
    Possible,
    Likely,
}

/// All transient memory, including graph storage, priority-flood heaps, kd
/// trees, input/output and the padded Euclidean closing buffers. An area too
/// small to contain a belt skips closing altogether (identical empty result).
pub fn scratch_bytes(w: usize, h: usize, cell: f64) -> usize {
    let n = w * h;
    let closing = if n as f64 >= 20000.0 / (cell * cell) {
        let pad = (60.0 / cell).ceil() as usize + 1;
        (w + 2 * pad) * (h + 2 * pad) * 18
    } else {
        0
    };
    n * 384 + closing + (1 << 20)
}

fn classify_ridge(s: &Segment, f: Option<&RidgeFeatures>, cell: f64) -> Verdict {
    let Some(f) = f else {
        return Verdict::Unsupported;
    };
    if !f.prominence.is_finite() || f.prominence < 1.0 {
        return Verdict::Unsupported;
    }
    let arc = s.arc_score >= 0.6;
    let first = s.path[0];
    let last = s.path.last().unwrap();
    // Recover spacing exactly as the reference classifier (area / count).
    let spacing = (s.pixels.len() as f64 * cell * cell / s.pixels.len() as f64).sqrt();
    let chord = (last[0] - first[0]).hypot(last[1] - first[1]) * spacing / s.length;
    let straight = !s.closed && s.net_bend.abs() < PI / 18.0 && chord > 0.97;
    let area = s.pixels.len() as f64 * cell * cell;
    let kettles =
        f.kettles >= 2 || f.kettles as f64 * 1000.0 / s.length >= 1.0 || f.kettles as f64 * 1000000.0 / area >= 20.0;
    let apron = f.apron >= 0.65;
    let crossing = f.crossing >= 0.6;
    let strong = f.prominence >= 3.0;
    let mut raw: f64 = if arc { 0.30 } else { 0.0 };
    raw += if straight { -0.25 } else { 0.0 };
    raw += if kettles { 0.25 } else { 0.0 };
    raw += if apron { 0.10 } else { 0.0 };
    raw += if apron && f.asymmetry >= 0.25 { 0.10 } else { 0.0 };
    raw += if crossing { 0.15 } else { 0.0 };
    raw += if strong { 0.10 } else { 0.0 };
    let score = raw.clamp(0.0f64, 1.0);
    let signals = [arc, kettles, apron, crossing].into_iter().filter(|b| *b).count();
    let likely = cell <= 5.0 && strong && !straight && !s.branched && signals >= 2 && (kettles || apron || crossing);
    if score + 1e-9 >= 0.55 && likely {
        Verdict::Likely
    } else if score + 1e-9 >= 0.25 && signals >= 1 {
        Verdict::Possible
    } else {
        Verdict::Unsupported
    }
}

fn classify_belt(
    pixels: &[usize],
    w: usize,
    grid: &[f32],
    cell: f64,
    context: &Context,
    layers: &BeltContext,
    ridge_support: usize,
) -> Verdict {
    let area = pixels.len() as f64 * (cell * cell);
    let mut elevations = Vec::new();
    let (mut raised, mut rough_sum, mut rough_count) = (0, 0.0, 0);
    for &i in pixels {
        if grid[i].is_finite() {
            elevations.push(f64::from(grid[i]));
        }
        if layers.tpi[i].is_finite() && layers.tpi[i] > 0.0 {
            raised += 1;
        }
        if layers.lrm[i].is_finite() {
            rough_sum += f64::from(layers.lrm[i]).abs();
            rough_count += 1;
        }
    }
    elevations.sort_by(f64::total_cmp);
    let relief = quantile(&elevations, 0.95) - quantile(&elevations, 0.05);
    if area < 20000.0 || raised as f64 / (pixels.len() as f64) < 0.3 || relief < 1.0 {
        return Verdict::Unsupported;
    }
    let hc = layers.peaks.iter().filter(|i| pixels.binary_search(i).is_ok()).count();
    let kc = context.blobs.iter().filter(|b| pixels.binary_search(&b.index).is_ok()).count();
    let hd = hc as f64 * 1000000.0 / area;
    let kd = kc as f64 * 1000000.0 / area;
    let texture = (hd / (hd + 100.0) * kd / (kd + 20.0)).sqrt();
    let hummocks = hc >= 3 && hd >= 20.0;
    let kettles = kc >= 3 && kd >= 10.0;
    let (_, xx, yy, xy) = moments(pixels, w);
    let xx = xx / pixels.len() as f64 + 1.0 / 12.0;
    let yy = yy / pixels.len() as f64 + 1.0 / 12.0;
    let xy = xy / pixels.len() as f64;
    let half = (xx + yy) / 2.0;
    let spread = (((xx - yy) / 2.0) * ((xx - yy) / 2.0) + xy * xy).sqrt();
    let elongation = ((half + spread) / (half - spread).max(1e-12)).sqrt();
    let mut raw: f64 = if hummocks { 0.25 } else { 0.0 };
    raw += if kettles { 0.20 } else { 0.0 };
    raw += if texture >= 0.4 { 0.25 } else { 0.0 };
    raw += if ridge_support > 0 { 0.15 } else { 0.0 };
    raw += if (2.0..=12.0).contains(&elongation) { 0.05 } else { 0.0 };
    if hc < 3 && kc < 3 && texture < 0.1 {
        raw -= 0.35;
    }
    let roughness = if rough_count > 0 { rough_sum / rough_count as f64 } else { 0.0 };
    if roughness >= 15.0 && kd <= 1.0 {
        raw -= 0.35;
    }
    let score = raw.clamp(0.0f64, 1.0);
    if score + 1e-9 >= 0.55 && cell <= 5.0 && ((hummocks && kettles) || texture >= 0.6) {
        Verdict::Likely
    } else if score + 1e-9 >= 0.25 {
        Verdict::Possible
    } else {
        Verdict::Unsupported
    }
}

/// Validated metre DEM in, raster plus the unchanged scientific metadata out.
pub fn analyze(grid: &[f32], w: usize, h: usize, cell: f64) -> Product {
    let stage1 = glacial::glacial_margin(grid, w, h, cell, glacial::Radius::square(5));
    let position =
        glacial::terrain_position(grid, w, h, cell, glacial::Radius::square(5), glacial::Radius::square(0)).data;
    let candidates: Vec<u8> = stage1.data.iter().zip(position).map(|(&s, t)| candidate(s, t)).collect();
    let segments: Vec<Segment> = geometry::components(&candidates, w, h, 5000.0 / (cell * cell))
        .into_iter()
        .map(|c| geometry::describe(c, w, cell))
        .collect();
    let zones = if (w * h) as f64 >= 20000.0 / (cell * cell) {
        geometry::closed_zones(&candidates, w, h, cell)
    } else {
        Vec::new()
    };
    let mut score = vec![0.0f32; grid.len()];
    let paint = |score: &mut [f32], pixels: &[usize], verdict: Verdict| {
        for &i in pixels {
            if !grid[i].is_finite() {
                continue;
            }
            let value = match verdict {
                Verdict::Likely => 1.0,
                Verdict::Possible => 0.55,
                Verdict::Unsupported => {
                    if stage1.data[i].is_finite() {
                        (f64::from(stage1.data[i]) * 0.3) as f32
                    } else {
                        0.0
                    }
                }
            };
            if value > score[i] {
                score[i] = value;
            }
        }
    };
    let context = if segments.is_empty() && zones.is_empty() { None } else { Some(Context::new(grid, w, h, cell)) };
    let mut verdicts = Vec::with_capacity(segments.len());
    for s in &segments {
        let features = if s.length >= 150.0 && s.elongation >= 2.0 {
            Some(features::ridge(grid, w, h, s, cell, context.as_ref().unwrap()))
        } else {
            None
        };
        let verdict = classify_ridge(s, features.as_ref(), cell);
        paint(&mut score, &s.pixels, verdict);
        verdicts.push(verdict);
    }
    let (mut likely, mut possible) = (0, 0);
    if !zones.is_empty() {
        let layers = BeltContext::new(grid, w, h, cell);
        let context = context.as_ref().unwrap();
        for zone in &zones {
            let (_, xx, yy, xy) = moments(&zone.pixels, w);
            let count = zone.pixels.len() as f64;
            let (vx, vy, cov) = (xx / count + 1.0 / 12.0, yy / count + 1.0 / 12.0, xy / count);
            let half = (vx + vy) / 2.0;
            let spread = (((vx - vy) / 2.0) * ((vx - vy) / 2.0) + cov * cov).sqrt();
            let elongated = ((half + spread) / (half - spread).max(1e-12)).sqrt() >= 2.0;
            let angle = orientation(vx, vy, cov);
            let support = segments
                .iter()
                .zip(&verdicts)
                .filter(|(s, v)| {
                    if **v != Verdict::Likely {
                        return false;
                    }
                    let (x, y) = (js_round(s.centroid[0]) as usize, js_round(s.centroid[1]) as usize);
                    if x >= w
                        || y >= h
                        || zone.pixels.binary_search(&(y * w + x)).is_err()
                        || !s.pixels.iter().any(|i| zone.pixels.binary_search(i).is_ok())
                    {
                        return false;
                    }
                    if elongated {
                        let mut diff = (s.orientation - angle).abs() % PI;
                        if diff > PI / 2.0 {
                            diff = PI - diff;
                        }
                        if diff > PI / 6.0 {
                            return false;
                        }
                    }
                    true
                })
                .count();
            let verdict = classify_belt(&zone.pixels, w, grid, cell, context, &layers, support);
            if verdict == Verdict::Likely {
                likely += 1;
            } else if verdict == Verdict::Possible {
                possible += 1;
            }
            paint(&mut score, &zone.pixels, verdict);
        }
    }
    // This is scientific contract data, frozen from the reference modules and
    // checked by the differential corpus, rather than translated prose.
    let reference: serde_json::Value =
        serde_json::from_str(include_str!("metadata.json")).expect("bundled moraine metadata");
    let mut metadata = stage1.metadata.clone();
    let m = metadata.as_object_mut().unwrap();
    let mut config = reference["config"].clone();
    config["allowLikely"] = json!(cell <= 5.0);
    for (key, value) in [
        ("kind", json!("glacial-moraine-object-screen-v2")),
        ("noDataRepresentation", json!("0 (background)")),
        ("candidateThreshold", json!(0.45)),
        ("stage1TpiFilter", json!(true)),
        ("minAreaM2", json!(5000)),
        ("config", config),
        ("belt", json!({"zones":zones.len(),"likely":likely,"possible":possible})),
        ("beltIdOffset", json!(100000usize.max(segments.len() + 1))),
        ("stage1", stage1.metadata),
        ("featureMetadata", reference["featureMetadata"].clone()),
        ("rasterValues", json!({"likely":1,"possible":0.55,"unsupported":"stage-1 score * 0.3","background":0})),
        ("screeningNotice", reference["screeningNotice"].clone()),
        ("beta", json!(true)),
    ] {
        m.insert(key.into(), value);
    }
    Product { data: score, secondary: None, metadata }
}

fn candidate(score: f32, position: f32) -> u8 {
    // Float32 storage promotes to a JS Number before the threshold comparison.
    // 0.45f32 is just BELOW 0.45, and must not be accepted at that boundary.
    u8::from(score.is_finite() && f64::from(score) >= 0.45 && position > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_threshold_uses_the_reference_number_precision() {
        assert_eq!(candidate(0.45, 1.0), 0);
        assert_eq!(candidate(f32::from_bits(0.45f32.to_bits() + 1), 1.0), 1);
        assert_eq!(candidate(1.0, f32::NAN), 0);
        assert_eq!(candidate(f32::NAN, 1.0), 0);
    }
}
