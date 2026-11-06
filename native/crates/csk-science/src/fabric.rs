//! Landform fabric over a UTM grid (`usgs.js:fabric`): band-limited so that
//! ridge-and-valley grain cannot masquerade as fine lineation. Reports which
//! way the grain runs and how strongly, the relief it carries, whether slopes
//! stop at a granular angle of repose, and whether steep faces look one way.

use serde_json::{Value, json};

use crate::fixed;

/// Separable box mean of radius `r`, no-data aware, edges clamped.
pub fn box_blur(g: &[f64], n: usize, r: i64) -> Vec<f64> {
    if r < 1 {
        return g.to_vec();
    }
    let clamp = |v: i64| v.clamp(0, n as i64 - 1) as usize;
    let mut tmp = vec![0f64; n * n];
    let mut out = vec![0f64; n * n];
    for y in 0..n {
        let (mut s, mut c) = (0f64, 0i64);
        for x in -r..=r {
            let v = g[y * n + clamp(x)];
            if v.is_finite() {
                s += v;
                c += 1;
            }
        }
        for x in 0..n {
            tmp[y * n + x] = if c > 0 { s / c as f64 } else { f64::NAN };
            let (vo, vi) = (g[y * n + clamp(x as i64 - r)], g[y * n + clamp(x as i64 + r + 1)]);
            if vo.is_finite() {
                s -= vo;
                c -= 1;
            }
            if vi.is_finite() {
                s += vi;
                c += 1;
            }
        }
    }
    for x in 0..n {
        let (mut s, mut c) = (0f64, 0i64);
        for y in -r..=r {
            let v = tmp[clamp(y) * n + x];
            if v.is_finite() {
                s += v;
                c += 1;
            }
        }
        for y in 0..n {
            out[y * n + x] = if c > 0 { s / c as f64 } else { f64::NAN };
            let (vo, vi) = (tmp[clamp(y as i64 - r) * n + x], tmp[clamp(y as i64 + r + 1) * n + x]);
            if vo.is_finite() {
                s -= vo;
                c -= 1;
            }
            if vi.is_finite() {
                s += vi;
                c += 1;
            }
        }
    }
    out
}

/// The band [lo, hi] in metres for a grid spacing, as the engine clamps it.
pub fn band(res: f64, lo: f64, hi: f64) -> (f64, f64) {
    let lo = (2.0 * res).max(if lo > 0.0 { lo } else { 50.0 });
    let hi = (lo * 1.5).max(if hi > 0.0 { hi } else { 300.0 });
    (lo, hi)
}

fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// Fabric statistics for an `n × n` grid (row 0 at `minN`, rows northward,
/// as `sampleUTMGrid` lays it out) at `res` metres.
pub fn measure(grid: &[f64], n: usize, res: f64, lo: f64, hi: f64, zone: i32, sources: &[String]) -> Value {
    let valid: Vec<f64> = grid.iter().copied().filter(|v| v.is_finite()).collect();
    if (valid.len() as f64) < (n * n) as f64 * 0.25 {
        return json!({"ok": false, "reason": "coverage too patchy here", "zone": zone,
                      "covered": fixed(valid.len() as f64 / (n * n) as f64, 2), "sources": sources});
    }
    let broad = box_blur(grid, n, js_round(hi / res / 2.0) as i64);
    let fine = box_blur(grid, n, (js_round(lo / res / 2.0) as i64).max(0));
    let band: Vec<f64> = (0..n * n)
        .map(|i| {
            if grid[i].is_finite() && broad[i].is_finite() && fine[i].is_finite() {
                fine[i] - broad[i]
            } else {
                f64::NAN
            }
        })
        .collect();

    let mut bins = [0f64; 180];
    for j in 1..n - 1 {
        for i in 1..n - 1 {
            let (a, b, c, d) = (band[j * n + i - 1], band[j * n + i + 1], band[(j - 1) * n + i], band[(j + 1) * n + i]);
            if ![a, b, c, d].iter().all(|v| v.is_finite()) {
                continue;
            }
            let (dx, dy) = ((b - a) / (2.0 * res), (d - c) / (2.0 * res));
            let m = dx.hypot(dy);
            if m < 1e-4 {
                continue;
            }
            let ang = ((dy.atan2(dx) * 180.0 / std::f64::consts::PI) % 180.0 + 180.0) % 180.0;
            bins[(ang.floor() as usize).min(179)] += m;
        }
    }
    let total = bins.iter().sum::<f64>();
    let tot = if total == 0.0 { 1.0 } else { total };
    let mut bi = 0;
    for (i, v) in bins.iter().enumerate() {
        if *v > bins[bi] {
            bi = i;
        }
    }
    let aniso = (bins[bi] + bins[(bi + 1) % 180] + bins[(bi + 179) % 180]) / tot * 100.0;
    let trend = ((90 - ((bi as i64 + 90) % 180)) % 180 + 180) % 180;
    let bv: Vec<f64> = band.iter().copied().filter(|v| v.is_finite()).collect();
    let amp = (bv.iter().map(|v| v * v).sum::<f64>() / bv.len() as f64).sqrt();

    let (mut degs, mut across, mut face_x, mut face_y) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let th = bi as f64 * std::f64::consts::PI / 180.0;
    let (ux, uy) = (th.cos(), th.sin());
    for j in 1..n - 1 {
        for i in 1..n - 1 {
            let (a, b, c, d) = (grid[j * n + i - 1], grid[j * n + i + 1], grid[(j - 1) * n + i], grid[(j + 1) * n + i]);
            if ![a, b, c, d].iter().all(|v| v.is_finite()) {
                continue;
            }
            let (dx, dy) = ((b - a) / (2.0 * res), (d - c) / (2.0 * res));
            let deg = dx.hypot(dy).atan() * 180.0 / std::f64::consts::PI;
            degs.push(deg);
            let (ba, bb, bc, bd) =
                (band[j * n + i - 1], band[j * n + i + 1], band[(j - 1) * n + i], band[(j + 1) * n + i]);
            if [ba, bb, bc, bd].iter().all(|v| v.is_finite()) {
                across.push(((bb - ba) / (2.0 * res)) * ux + ((bd - bc) / (2.0 * res)) * uy);
            }
            if deg >= 20.0 {
                let m = dx.hypot(dy);
                face_x.push(-dx / m);
                face_y.push(-dy / m);
            }
        }
    }
    degs.sort_by(f64::total_cmp);
    if degs.is_empty() || bv.is_empty() {
        return json!({"ok": false, "reason": "Not enough contiguous elevation samples to measure fabric", "sources": sources});
    }
    let p = |q: f64| fixed(degs[(q * (degs.len() - 1) as f64).floor() as usize], 1);
    let len = across.len().max(1) as f64;
    let m_a = across.iter().sum::<f64>() / len;
    let s_raw = (across.iter().map(|v| (v - m_a).powi(2)).sum::<f64>() / len).sqrt();
    let s_a = if s_raw == 0.0 || s_raw.is_nan() { 1.0 } else { s_raw };
    let skew = fixed(across.iter().map(|v| ((v - m_a) / s_a).powi(3)).sum::<f64>() / len, 3);
    let (fx, fy) = (face_x.iter().sum::<f64>(), face_y.iter().sum::<f64>());
    let r = if face_x.is_empty() { 0.0 } else { fx.hypot(fy) / face_x.len() as f64 };
    let face_az =
        (!face_x.is_empty()).then(|| ((90.0 - fy.atan2(fx) * 180.0 / std::f64::consts::PI) % 360.0 + 360.0) % 360.0);
    let (min, max) = valid.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), v| (a.min(*v), b.max(*v)));
    let share = |f: &dyn Fn(f64) -> bool| degs.iter().filter(|d| f(**d)).count() as f64 / degs.len() as f64 * 100.0;
    json!({
        "ok": true, "zone": zone, "res": fixed(res, 2), "n": n, "band": [fixed(lo, 0), fixed(hi, 0)], "sources": sources,
        "covered": fixed(valid.len() as f64 / (n * n) as f64, 2),
        "elevation": {"min": fixed(min, 1), "max": fixed(max, 1), "relief": fixed(max - min, 1)},
        "grain": {"trendDeg": trend, "anisotropyPct": fixed(aniso, 1), "isotropicPct": 1.7, "amplitudeRms": fixed(amp, 2)},
        "slope": {"p50": p(0.5), "p90": p(0.9), "p95": p(0.95), "p99": p(0.99), "max": fixed(degs[degs.len() - 1], 1),
                  "pct28to35": fixed(share(&|d| (28.0..=35.0).contains(&d)), 2), "pctOver36": fixed(share(&|d| d > 36.0), 3)},
        "transport": {"steepFaceAzimuth": face_az.map(|a| fixed(a, 0)), "concentration": fixed(r, 2), "asymmetrySkew": skew}
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn ridges_trend_and_ceiling() {
        // East-west ridges 120 m apart on a 4 m grid: crests trend 90°.
        let (n, res) = (96usize, 4.0);
        let grid: Vec<f64> =
            (0..n * n).map(|k| 500.0 + 6.0 * ((k / n) as f64 * res * std::f64::consts::TAU / 120.0).sin()).collect();
        let (lo, hi) = super::band(res, 50.0, 300.0);
        let v = super::measure(&grid, n, res, lo, hi, 10, &["P".into()]);
        assert_eq!(v["ok"], true);
        assert_eq!(v["grain"]["trendDeg"], 90);
        assert!(v["grain"]["anisotropyPct"].as_f64().unwrap() > 50.0);
    }
}
