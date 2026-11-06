//! Geodesy the engine uses today, ported from `cog.js`.
//!
//! UTM on the GRS80/WGS84 ellipsoid (NAD83 and WGS84 differ by about a metre
//! in Washington, below the 1 m pixel), Web Mercator, and XYZ tile bounds.
//! Phase 1's PROJ / proj4rs bake-off replaces the UTM series for datum-aware
//! work; these stay as the reference the goldens were frozen from.

pub mod proj;

use std::f64::consts::{FRAC_PI_2, FRAC_PI_4, PI};

const A: f64 = 6_378_137.0;
const F: f64 = 1.0 / 298.257_223_563;
const K0: f64 = 0.9996;
const E0: f64 = 500_000.0;
const ECC2: f64 = F * (2.0 - F);
const EP2: f64 = ECC2 / (1.0 - ECC2);
const D2R: f64 = PI / 180.0;
const R2D: f64 = 180.0 / PI;

/// UTM zone of a longitude. Washington straddles 10 and 11 at −120°.
pub fn utm_zone(lon: f64) -> i32 {
    ((lon + 180.0) / 6.0).floor() as i32 + 1
}

fn central_meridian(zone: i32) -> f64 {
    (f64::from((zone - 1) * 6) - 180.0 + 3.0) * D2R
}

/// Geographic to UTM easting/northing (northern-hemisphere false northing 0,
/// as the engine uses it).
pub fn lon_lat_to_utm(lon: f64, lat: f64, zone: i32) -> (f64, f64) {
    let lam0 = central_meridian(zone);
    let (phi, lam) = (lat * D2R, lon * D2R);
    let n = A / (1.0 - ECC2 * phi.sin().powi(2)).sqrt();
    let t = phi.tan().powi(2);
    let c = EP2 * phi.cos().powi(2);
    let a = phi.cos() * (lam - lam0);
    let m = A
        * ((1.0 - ECC2 / 4.0 - 3.0 * ECC2.powi(2) / 64.0 - 5.0 * ECC2.powi(3) / 256.0) * phi
            - (3.0 * ECC2 / 8.0 + 3.0 * ECC2.powi(2) / 32.0 + 45.0 * ECC2.powi(3) / 1024.0) * (2.0 * phi).sin()
            + (15.0 * ECC2.powi(2) / 256.0 + 45.0 * ECC2.powi(3) / 1024.0) * (4.0 * phi).sin()
            - (35.0 * ECC2.powi(3) / 3072.0) * (6.0 * phi).sin());
    let e = E0
        + K0 * n
            * (a + (1.0 - t + c) * a.powi(3) / 6.0
                + (5.0 - 18.0 * t + t * t + 72.0 * c - 58.0 * EP2) * a.powi(5) / 120.0);
    let north = K0
        * (m + n
            * phi.tan()
            * (a * a / 2.0
                + (5.0 - t + 9.0 * c + 4.0 * c * c) * a.powi(4) / 24.0
                + (61.0 - 58.0 * t + t * t + 600.0 * c - 330.0 * EP2) * a.powi(6) / 720.0));
    (e, north)
}

/// UTM easting/northing back to geographic (lon, lat) degrees.
pub fn utm_to_lon_lat(e: f64, n: f64, zone: i32) -> (f64, f64) {
    let lam0 = central_meridian(zone);
    let (x, y) = (e - E0, n);
    let m = y / K0;
    let mu = m / (A * (1.0 - ECC2 / 4.0 - 3.0 * ECC2.powi(2) / 64.0 - 5.0 * ECC2.powi(3) / 256.0));
    let e1 = (1.0 - (1.0 - ECC2).sqrt()) / (1.0 + (1.0 - ECC2).sqrt());
    let phi1 = mu
        + (3.0 * e1 / 2.0 - 27.0 * e1.powi(3) / 32.0) * (2.0 * mu).sin()
        + (21.0 * e1.powi(2) / 16.0 - 55.0 * e1.powi(4) / 32.0) * (4.0 * mu).sin()
        + (151.0 * e1.powi(3) / 96.0) * (6.0 * mu).sin()
        + (1097.0 * e1.powi(4) / 512.0) * (8.0 * mu).sin();
    let n1 = A / (1.0 - ECC2 * phi1.sin().powi(2)).sqrt();
    let t1 = phi1.tan().powi(2);
    let c1 = EP2 * phi1.cos().powi(2);
    let r1 = A * (1.0 - ECC2) / (1.0 - ECC2 * phi1.sin().powi(2)).powf(1.5);
    let d = x / (n1 * K0);
    let phi = phi1
        - (n1 * phi1.tan() / r1)
            * (d * d / 2.0 - (5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1 * c1 - 9.0 * EP2) * d.powi(4) / 24.0
                + (61.0 + 90.0 * t1 + 298.0 * c1 + 45.0 * t1 * t1 - 252.0 * EP2 - 3.0 * c1 * c1) * d.powi(6) / 720.0);
    let lam = lam0
        + (d - (1.0 + 2.0 * t1 + c1) * d.powi(3) / 6.0
            + (5.0 - 2.0 * c1 + 28.0 * t1 - 3.0 * c1 * c1 + 8.0 * EP2 + 24.0 * t1 * t1) * d.powi(5) / 120.0)
            / phi1.cos();
    (lam * R2D, phi * R2D)
}

pub const MERC_R: f64 = 6_378_137.0;
pub const MERC_MAX: f64 = 20_037_508.342_789_244;

pub fn lon_lat_to_merc(lon: f64, lat: f64) -> (f64, f64) {
    (lon * D2R * MERC_R, (FRAC_PI_4 + lat * D2R / 2.0).tan().ln() * MERC_R)
}

pub fn merc_to_lon_lat(x: f64, y: f64) -> (f64, f64) {
    (x / MERC_R * R2D, (2.0 * (y / MERC_R).exp().atan() - FRAC_PI_2) * R2D)
}

/// Pixel edges of an XYZ tile in Web Mercator metres.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TileBounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
    pub span: f64,
}

pub fn tile_bounds_merc(z: u8, x: u32, y: u32) -> TileBounds {
    let s = 2.0 * MERC_MAX / 2f64.powi(i32::from(z));
    TileBounds {
        min_x: -MERC_MAX + f64::from(x) * s,
        max_x: -MERC_MAX + f64::from(x + 1) * s,
        max_y: MERC_MAX - f64::from(y) * s,
        min_y: MERC_MAX - f64::from(y + 1) * s,
        span: s,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rainier_control() {
        // test-cog.js control values.
        let (lon, lat) = (-121.7603, 46.8523);
        assert_eq!(utm_zone(lon), 10);
        let (e, n) = lon_lat_to_utm(lon, lat, 10);
        assert!((e - 594_508.0).abs() <= 2.0 && (n - 5_189_497.0).abs() <= 2.0, "{e} {n}");
        let (blon, blat) = utm_to_lon_lat(e, n, 10);
        assert!((blon - lon).abs() < 1e-8 && (blat - lat).abs() < 1e-8);
        assert_eq!(utm_zone(-118.5), 11);
    }
}
