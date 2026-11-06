//! Styled terrain from an elevation grid: hillshade (single and
//! multidirectional), slope, aspect, northness, elevation tint and adaptive
//! contours. Ported from `terrain-raster.js` and `terrain-core.js` so the
//! engine draws exactly what the browser's CPU fallback and 3D drape draw.

/// Every style this module draws.
pub const STYLES: &[&str] = &["hs", "hsmulti", "tint", "slope", "aspect", "northness", "c2", "c5", "c10", "c25"];

const D2R: f64 = std::f64::consts::PI / 180.0;
const FLAT_EPSILON: f64 = 1e-12;
/// Below half a degree of slope, aspect is undefined rather than noise.
fn aspect_flat_grade() -> f64 {
    (0.5 * D2R).tan()
}
const MIN_CONTOUR_PX: f64 = 3.0;
pub const TINT_SHADE_FLOOR: f64 = 0.33;
pub const TINT_SHADE_GAIN: f64 = 0.82;

type Stop = (f64, [u8; 4]);

const fn rgb(hex: u32) -> [u8; 4] {
    [(hex >> 16) as u8, (hex >> 8) as u8, hex as u8, 255]
}

/// Slope in degrees (also LiDAR Studio's defaults and the legend).
pub const SLOPE_STOPS: &[Stop] = &[
    (0.0, rgb(0xf2f4ee)),
    (5.0, rgb(0xb1d28b)),
    (15.0, rgb(0xf6da6f)),
    (30.0, rgb(0xf09649)),
    (45.0, rgb(0xd54650)),
    (60.0, rgb(0x762c69)),
    (90.0, rgb(0x321948)),
];

/// Cyclic aspect: cool north, green east, warm south, violet west.
pub const ASPECT_STOPS: &[Stop] = &[
    (0.0, rgb(0x4d78c8)),
    (45.0, rgb(0x3ba5b0)),
    (90.0, rgb(0x57a765)),
    (135.0, rgb(0xc9ad4f)),
    (180.0, rgb(0xd96b52)),
    (225.0, rgb(0xc45b82)),
    (270.0, rgb(0x8d65bb)),
    (315.0, rgb(0x5e77c5)),
    (360.0, rgb(0x4d78c8)),
];

/// The "relief" elevation tint, metres.
pub const RELIEF_STOPS: &[Stop] = &[
    (-500.0, [22, 46, 72, 255]),
    (0.0, [40, 70, 95, 255]),
    (300.0, [70, 110, 70, 255]),
    (900.0, [128, 140, 92, 255]),
    (1600.0, [160, 140, 108, 255]),
    (2400.0, [190, 180, 170, 255]),
    (3200.0, [245, 246, 250, 255]),
    (6000.0, [255, 255, 255, 255]),
];

/// JavaScript's `Math.round`: halves toward +∞.
#[inline]
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

fn ramp(stops: &[Stop], value: f64, out: &mut [u8]) {
    let (mut lo, mut hi) = (0usize, stops.len() - 1);
    if value <= stops[0].0 {
        hi = lo;
    } else if value >= stops[hi].0 {
        lo = hi;
    } else {
        while hi - lo > 1 {
            let mid = (lo + hi) / 2;
            if value < stops[mid].0 { hi = mid } else { lo = mid }
        }
    }
    let (l, r) = (stops[lo], stops[hi]);
    let t = if lo == hi { 0.0 } else { ((value - l.0) / (r.0 - l.0)).clamp(0.0, 1.0) };
    for (c, o) in out.iter_mut().enumerate().take(4) {
        *o = js_round(f64::from(l.1[c]) + (f64::from(r.1[c]) - f64::from(l.1[c])) * t) as u8;
    }
}

fn normalize_degrees(d: f64) -> f64 {
    ((d % 360.0) + 360.0) % 360.0
}

#[derive(Debug, Clone, Copy)]
struct Light {
    east: f64,
    north: f64,
    up: f64,
}

impl Light {
    fn new(azimuth: f64, altitude: f64) -> Self {
        let (az, alt) = (normalize_degrees(azimuth) * D2R, altitude * D2R);
        Self { east: alt.cos() * az.sin(), north: alt.cos() * az.cos(), up: alt.sin() }
    }

    /// Direct illumination for a gradient, rows running south.
    #[inline]
    fn direct(&self, dzdx: f64, dzdy: f64) -> f64 {
        let (east, north) = (dzdx, -dzdy);
        let d = (-east * self.east - north * self.north + self.up) / (east * east + north * north + 1.0).sqrt();
        d.clamp(0.0, 1.0)
    }
}

/// Sun position and ambient light.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lighting {
    pub azimuth: f64,
    pub altitude: f64,
    pub ambient: f64,
}

impl Default for Lighting {
    fn default() -> Self {
        Self { azimuth: 315.0, altitude: 45.0, ambient: 0.12 }
    }
}

struct Shaders {
    ambient: f64,
    direct: Light,
    /// Mark's multidirectional hillshade (as GDAL): four illuminants
    /// weighted by terrain aspect.
    multi: [(f64, Light); 4],
}

impl Shaders {
    fn new(l: Lighting) -> Self {
        let az = l.azimuth.clamp(0.0, 359.0);
        let alt = l.altitude.clamp(5.0, 90.0);
        let multi = [az - 90.0, az - 45.0, az, az + 45.0].map(|a| (normalize_degrees(a), Light::new(a, alt)));
        Self { ambient: l.ambient.clamp(0.0, 0.6), direct: Light::new(az, alt), multi }
    }

    fn shade(&self, dzdx: f64, dzdy: f64) -> f64 {
        self.ambient + (1.0 - self.ambient) * self.direct.direct(dzdx, dzdy)
    }

    fn shade_multi(&self, dzdx: f64, dzdy: f64) -> f64 {
        let (east, north) = (dzdx, -dzdy);
        let flat = east.hypot(north) <= FLAT_EPSILON;
        let aspect = if flat { 0.0 } else { normalize_degrees((-east).atan2(-north) / D2R) };
        let (mut total, mut sum) = (0.0, 0.0);
        for (az, light) in &self.multi {
            let w = if flat { 1.0 } else { ((aspect - az) * D2R).sin().powi(2) };
            if w <= 0.0 {
                continue;
            }
            total += w;
            sum += w * light.direct(dzdx, dzdy);
        }
        let direct = if total > 0.0 { sum / total } else { 0.0 };
        self.ambient + (1.0 - self.ambient) * direct
    }
}

/// An elevation surface: `side × side` metres (NaN invalid), with or
/// without a one-pixel skirt, at `ground_res` metres per pixel.
pub struct Surface<'a> {
    pub grid: &'a [f32],
    pub side: usize,
    pub skirt: bool,
    pub ground_res: f64,
}

impl Surface<'_> {
    fn size(&self) -> usize {
        if self.skirt { self.side - 2 } else { self.side }
    }

    #[inline]
    fn at(&self, x: isize, y: isize) -> f64 {
        let (x, y) = if self.skirt {
            ((x + 1) as usize, (y + 1) as usize)
        } else {
            let m = self.side as isize - 1;
            (x.clamp(0, m) as usize, y.clamp(0, m) as usize)
        };
        f64::from(self.grid[y * self.side + x])
    }

    /// Horn's 3×3 gradient (ArcGIS, GDAL), so renders compare with 3DEP's.
    #[inline]
    fn gradient(&self, x: isize, y: isize) -> Option<(f64, f64)> {
        let (a, b, c) = (self.at(x - 1, y - 1), self.at(x, y - 1), self.at(x + 1, y - 1));
        let (d, f) = (self.at(x - 1, y), self.at(x + 1, y));
        let (g, h, k) = (self.at(x - 1, y + 1), self.at(x, y + 1), self.at(x + 1, y + 1));
        if [a, b, c, d, f, g, h, k].iter().any(|v| !v.is_finite() || *v <= -1e20) {
            return None;
        }
        let r = 8.0 * self.ground_res;
        Some((((c + 2.0 * f + k) - (a + 2.0 * d + g)) / r, ((g + 2.0 * h + k) - (a + 2.0 * b + c)) / r))
    }
}

fn aspect_of(dzdx: f64, dzdy: f64) -> Option<f64> {
    if dzdx.hypot(dzdy) <= aspect_flat_grade() {
        return None;
    }
    Some(normalize_degrees((-dzdx).atan2(dzdy) / D2R))
}

/// RGBA for `style` (unknown styles draw as `hs`).
pub fn render(style: &str, s: &Surface<'_>, lighting: Lighting) -> Vec<u8> {
    let style = if STYLES.contains(&style) { style } else { "hs" };
    let size = s.size();
    let mut out = vec![0u8; size * size * 4];
    let sh = Shaders::new(lighting);
    let contour_ft = match style {
        "c2" => Some(2.0),
        "c5" => Some(5.0),
        "c10" => Some(10.0),
        "c25" => Some(25.0),
        _ => None,
    };
    let mut colour = [0u8; 4];
    for y in 0..size {
        for x in 0..size {
            let (xi, yi) = (x as isize, y as isize);
            let value = s.at(xi, yi);
            let px = &mut out[(y * size + x) * 4..(y * size + x) * 4 + 4];
            if !value.is_finite() || value <= -1e20 {
                continue;
            }
            let Some((dzdx, dzdy)) = s.gradient(xi, yi) else { continue };
            if let Some(base) = contour_ft {
                let feet = value * 3.28084;
                let mut interval = base;
                let per_pixel = dzdx.hypot(dzdy) * s.ground_res * 3.28084;
                // Thin adaptively: promote to the index interval where lines
                // would collide, and draw nothing where even those would.
                if per_pixel > 0.0 {
                    let spacing = interval / per_pixel;
                    if spacing < MIN_CONTOUR_PX {
                        if spacing * 5.0 >= MIN_CONTOUR_PX {
                            interval *= 5.0;
                        } else {
                            continue;
                        }
                    }
                }
                let multiple = feet / interval;
                let distance = (multiple - js_round(multiple)).abs() * interval;
                let width = (interval * 0.5).min(per_pixel * 0.7).max(0.35);
                if distance >= width {
                    continue;
                }
                let index = js_round(multiple) % 5.0 == 0.0;
                px.copy_from_slice(&if index { [120, 70, 40, 255] } else { [150, 110, 80, 200] });
                continue;
            }
            match style {
                "slope" => ramp(SLOPE_STOPS, dzdx.hypot(dzdy).atan() / D2R, px),
                "aspect" => {
                    let Some(a) = aspect_of(dzdx, dzdy) else { continue };
                    ramp(ASPECT_STOPS, a, px);
                }
                "northness" => {
                    let Some(a) = aspect_of(dzdx, dzdy) else { continue };
                    let n = (a * D2R).cos();
                    let t = n.abs();
                    let (r, g, b) = if n >= 0.0 { (55.0, 137.0, 92.0) } else { (214.0, 82.0, 78.0) };
                    px[0] = js_round(247.0 + (r - 247.0) * t) as u8;
                    px[1] = js_round(243.0 + (g - 243.0) * t) as u8;
                    px[2] = js_round(224.0 + (b - 224.0) * t) as u8;
                    px[3] = 255;
                }
                "tint" => {
                    ramp(RELIEF_STOPS, value, &mut colour);
                    let m = TINT_SHADE_FLOOR + TINT_SHADE_GAIN * sh.shade(dzdx, dzdy);
                    for (p, c) in px.iter_mut().zip(colour).take(3) {
                        *p = js_round(f64::from(c) * m).min(255.0) as u8;
                    }
                    px[3] = 255;
                }
                _ => {
                    let v = if style == "hsmulti" { sh.shade_multi(dzdx, dzdy) } else { sh.shade(dzdx, dzdy) };
                    let byte = js_round(v * 255.0) as u8;
                    px.copy_from_slice(&[byte, byte, byte, 255]);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plane_shades_and_styles() {
        // A plane rising 1 m per metre to the east, with a skirt.
        let side = 6;
        let grid: Vec<f32> = (0..side * side).map(|i| (i % side) as f32 + 100.0).collect();
        let s = Surface { grid: &grid, side, skirt: true, ground_res: 1.0 };
        let hs = render("hs", &s, Lighting::default());
        assert_eq!(hs.len(), 4 * 4 * 4);
        // Facing west, lit from the north-west: brighter than flat ground's shade.
        let flat = (0.12 + 0.88 * (45.0 * D2R).sin()) * 255.0;
        assert!(f64::from(hs[0]) > flat, "{} vs {flat}", hs[0]);
        let slope = render("slope", &s, Lighting::default());
        assert_eq!(slope[3], 255);
        // 45° slope: exactly the 45° stop.
        assert_eq!(&slope[..4], &rgb(0xd54650));
        let aspect = render("aspect", &s, Lighting::default());
        assert_eq!(&aspect[..4], &rgb(0x8d65bb), "faces west (270°)");
        assert_eq!(js_round(-2.5), -2.0);
    }
}
