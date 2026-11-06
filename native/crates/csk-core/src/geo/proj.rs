//! Projected coordinate systems from GeoTIFF GeoKeys: Lambert Conformal
//! Conic (1 and 2 standard parallels) and Transverse Mercator on any
//! ellipsoid, in any declared linear unit. This covers WA DNR's State Plane
//! rasters (user-defined or by EPSG code) and UTM. Anything else fails
//! closed: no elevation is ever placed with a guessed projection.
//!
//! Datum shifts between NAD83 realisations and WGS84 are below a metre in
//! Washington and are not applied, as in the JavaScript engine (proj4js
//! without `towgs84`).

use std::f64::consts::{FRAC_PI_2, FRAC_PI_4};

use crate::codec::Geo;

const D2R: f64 = std::f64::consts::PI / 180.0;
pub const US_FOOT: f64 = 1200.0 / 3937.0;
const GRS80: (f64, f64) = (6_378_137.0, 298.257_222_101);
const WGS84: (f64, f64) = (6_378_137.0, 298.257_223_563);

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Method {
    /// Lambert Conformal Conic, two standard parallels (degrees).
    Lcc2 {
        lat1: f64,
        lat2: f64,
        lat0: f64,
        lon0: f64,
    },
    /// Lambert Conformal Conic, one standard parallel with a scale factor.
    Lcc1 {
        lat0: f64,
        lon0: f64,
        k0: f64,
    },
    TransverseMercator {
        lat0: f64,
        lon0: f64,
        k0: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Projection {
    pub method: Method,
    /// Semi-major axis (m) and inverse flattening.
    pub a: f64,
    pub rf: f64,
    /// False easting and northing, in the projection's linear unit.
    pub false_easting: f64,
    pub false_northing: f64,
    /// Metres per linear unit.
    pub unit: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProjError {
    #[error("coordinate system could not be decoded ({0}); no elevation was substituted")]
    Unsupported(String),
}

fn fail<T>(why: impl Into<String>) -> Result<T, ProjError> {
    Err(ProjError::Unsupported(why.into()))
}

/// Washington State Plane zones: (lat1, lat2, lat0, lon0), FE 500 km.
const WA_NORTH: (f64, f64, f64, f64) = (47.5, 48.733_333_333_333_33, 47.0, -120.833_333_333_333_3);
const WA_SOUTH: (f64, f64, f64, f64) = (45.833_333_333_333_34, 47.333_333_333_333_34, 45.333_333_333_333_34, -120.5);

fn state_plane(zone: (f64, f64, f64, f64), unit: f64) -> Projection {
    let (lat1, lat2, lat0, lon0) = zone;
    Projection {
        method: Method::Lcc2 { lat1, lat2, lat0, lon0 },
        a: GRS80.0,
        rf: GRS80.1,
        false_easting: 500_000.0 / unit,
        false_northing: 0.0,
        unit,
    }
}

fn utm(zone: u32, ellipsoid: (f64, f64)) -> Projection {
    Projection {
        method: Method::TransverseMercator { lat0: 0.0, lon0: f64::from(zone) * 6.0 - 183.0, k0: 0.9996 },
        a: ellipsoid.0,
        rf: ellipsoid.1,
        false_easting: 500_000.0,
        false_northing: 0.0,
        unit: 1.0,
    }
}

/// A projected EPSG code this engine knows exactly.
pub fn from_epsg(code: u32) -> Option<Projection> {
    Some(match code {
        26901..=26923 => utm(code - 26900, GRS80),
        32601..=32660 => utm(code - 32600, WGS84),
        // NAD83, HARN and 2011 realisations of Washington North / South.
        2285 | 2926 | 6597 => state_plane(WA_NORTH, US_FOOT),
        2286 | 2927 | 6599 => state_plane(WA_SOUTH, US_FOOT),
        32148 | 2855 | 6596 => state_plane(WA_NORTH, 1.0),
        32149 | 2856 | 6598 => state_plane(WA_SOUTH, 1.0),
        _ => return None,
    })
}

fn linear_unit(geo: &Geo) -> Result<f64, ProjError> {
    if let Some(size) = geo.double(3077).filter(|v| v.is_finite() && *v > 0.0) {
        return Ok(size);
    }
    match geo.short(3076) {
        Some(9001) => Ok(1.0),
        Some(9002) => Ok(0.3048),
        Some(9003) => Ok(US_FOOT),
        Some(other) => fail(format!("linear unit {other}")),
        None => fail("missing projected linear unit"),
    }
}

fn ellipsoid(geo: &Geo) -> Result<(f64, f64), ProjError> {
    if let Some(a) = geo.double(2057) {
        if let Some(rf) = geo.double(2059) {
            return Ok((a, rf));
        }
        if let Some(b) = geo.double(2058) {
            return Ok((a, a / (a - b)));
        }
    }
    match (geo.short(2056), geo.short(2048)) {
        (Some(7019), _) | (_, Some(4269 | 4152 | 6152 | 6318 | 4759)) => Ok(GRS80),
        (Some(7030), _) | (_, Some(4326)) => Ok(WGS84),
        _ => fail("missing ellipsoid"),
    }
}

impl Projection {
    /// The projection a raster's GeoKeys declare.
    pub fn from_geokeys(geo: &Geo) -> Result<Self, ProjError> {
        let model = geo.short(1024);
        if model == Some(2) {
            return fail("geographic rasters are not supported");
        }
        let code = geo.short(3072).map(u32::from).or(geo.epsg);
        if let Some(c) = code.filter(|c| *c != 32767) {
            return from_epsg(c).map_or_else(|| fail(format!("EPSG:{c}")), Ok);
        }
        // User-defined: method, parameters, units and ellipsoid from keys.
        let unit = linear_unit(geo)?;
        let (a, rf) = ellipsoid(geo)?;
        let d = |k: u16| geo.double(k);
        let any = |ks: &[u16]| ks.iter().find_map(|k| d(*k));
        let method = match geo.short(3075) {
            Some(8) => Method::Lcc2 {
                lat1: d(3078).ok_or(ProjError::Unsupported("missing standard parallel".into()))?,
                lat2: d(3079).ok_or(ProjError::Unsupported("missing standard parallel".into()))?,
                lat0: any(&[3085, 3081]).unwrap_or(0.0),
                lon0: any(&[3084, 3080, 3088]).ok_or(ProjError::Unsupported("missing origin longitude".into()))?,
            },
            Some(9) => Method::Lcc1 {
                lat0: any(&[3081, 3085]).ok_or(ProjError::Unsupported("missing origin latitude".into()))?,
                lon0: any(&[3080, 3084, 3088]).ok_or(ProjError::Unsupported("missing origin longitude".into()))?,
                k0: any(&[3092, 3093]).unwrap_or(1.0),
            },
            Some(1) => Method::TransverseMercator {
                lat0: any(&[3081, 3085]).unwrap_or(0.0),
                lon0: any(&[3080, 3084, 3088]).ok_or(ProjError::Unsupported("missing central meridian".into()))?,
                k0: any(&[3092, 3093]).unwrap_or(1.0),
            },
            Some(other) => return fail(format!("projection method {other}")),
            None => return fail("missing projected CRS parameters"),
        };
        let (fe, fnn) = match method {
            Method::Lcc2 { .. } => (any(&[3086, 3082]).unwrap_or(0.0), any(&[3087, 3083]).unwrap_or(0.0)),
            _ => (any(&[3082, 3086]).unwrap_or(0.0), any(&[3083, 3087]).unwrap_or(0.0)),
        };
        Ok(Self { method, a, rf, false_easting: fe, false_northing: fnn, unit })
    }

    fn e(&self) -> f64 {
        let f = 1.0 / self.rf;
        (f * (2.0 - f)).sqrt()
    }

    /// Geographic degrees to projected coordinates in the linear unit.
    pub fn forward(&self, lon: f64, lat: f64) -> (f64, f64) {
        let (x, y) = match self.method {
            Method::Lcc2 { .. } | Method::Lcc1 { .. } => self.lcc_forward(lon, lat),
            Method::TransverseMercator { lat0, lon0, k0 } => self.tm_forward(lon, lat, lat0, lon0, k0),
        };
        (x / self.unit + self.false_easting, y / self.unit + self.false_northing)
    }

    /// Projected coordinates (linear unit) to geographic degrees.
    pub fn inverse(&self, x: f64, y: f64) -> (f64, f64) {
        let (x, y) = ((x - self.false_easting) * self.unit, (y - self.false_northing) * self.unit);
        match self.method {
            Method::Lcc2 { .. } | Method::Lcc1 { .. } => self.lcc_inverse(x, y),
            Method::TransverseMercator { lat0, lon0, k0 } => self.tm_inverse(x, y, lat0, lon0, k0),
        }
    }

    // Snyder, Map Projections — A Working Manual (1987), §15.
    fn lcc_constants(&self) -> (f64, f64, f64, f64) {
        let e = self.e();
        let m = |p: f64| p.cos() / (1.0 - e * e * p.sin().powi(2)).sqrt();
        let t = |p: f64| (FRAC_PI_4 - p / 2.0).tan() / ((1.0 - e * p.sin()) / (1.0 + e * p.sin())).powf(e / 2.0);
        let (n, f_k, lat0, lon0) = match self.method {
            Method::Lcc2 { lat1, lat2, lat0, lon0 } => {
                let (p1, p2) = (lat1 * D2R, lat2 * D2R);
                let n = if (lat1 - lat2).abs() < 1e-10 {
                    p1.sin()
                } else {
                    (m(p1).ln() - m(p2).ln()) / (t(p1).ln() - t(p2).ln())
                };
                (n, m(p1) / (n * t(p1).powf(n)), lat0, lon0)
            }
            Method::Lcc1 { lat0, lon0, k0 } => {
                let p0 = lat0 * D2R;
                let n = p0.sin();
                (n, k0 * m(p0) / (n * t(p0).powf(n)), lat0, lon0)
            }
            Method::TransverseMercator { .. } => unreachable!("not a conic"),
        };
        let rho0 = self.a * f_k * t(lat0 * D2R).powf(n);
        (n, f_k, rho0, lon0)
    }

    fn lcc_forward(&self, lon: f64, lat: f64) -> (f64, f64) {
        let e = self.e();
        let (n, f_k, rho0, lon0) = self.lcc_constants();
        let p = lat * D2R;
        let t = (FRAC_PI_4 - p / 2.0).tan() / ((1.0 - e * p.sin()) / (1.0 + e * p.sin())).powf(e / 2.0);
        let rho = self.a * f_k * t.powf(n);
        let theta = n * (lon - lon0) * D2R;
        (rho * theta.sin(), rho0 - rho * theta.cos())
    }

    fn lcc_inverse(&self, x: f64, y: f64) -> (f64, f64) {
        let e = self.e();
        let (n, f_k, rho0, lon0) = self.lcc_constants();
        let (dx, dy) = (x, rho0 - y);
        let rho = n.signum() * dx.hypot(dy);
        let theta = if n > 0.0 { dx.atan2(dy) } else { (-dx).atan2(-dy) };
        let t = (rho / (self.a * f_k)).powf(1.0 / n);
        let mut p = FRAC_PI_2 - 2.0 * t.atan();
        for _ in 0..15 {
            let next = FRAC_PI_2 - 2.0 * (t * ((1.0 - e * p.sin()) / (1.0 + e * p.sin())).powf(e / 2.0)).atan();
            if (next - p).abs() < 1e-14 {
                p = next;
                break;
            }
            p = next;
        }
        (theta / n / D2R + lon0, p / D2R)
    }

    fn meridian(&self, p: f64) -> f64 {
        let e2 = self.e().powi(2);
        self.a
            * ((1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2.powi(3) / 256.0) * p
                - (3.0 * e2 / 8.0 + 3.0 * e2 * e2 / 32.0 + 45.0 * e2.powi(3) / 1024.0) * (2.0 * p).sin()
                + (15.0 * e2 * e2 / 256.0 + 45.0 * e2.powi(3) / 1024.0) * (4.0 * p).sin()
                - (35.0 * e2.powi(3) / 3072.0) * (6.0 * p).sin())
    }

    // Snyder §8 (the series `geo::lon_lat_to_utm` uses, generalised).
    fn tm_forward(&self, lon: f64, lat: f64, lat0: f64, lon0: f64, k0: f64) -> (f64, f64) {
        let e2 = self.e().powi(2);
        let ep2 = e2 / (1.0 - e2);
        let p = lat * D2R;
        let n = self.a / (1.0 - e2 * p.sin().powi(2)).sqrt();
        let t = p.tan().powi(2);
        let c = ep2 * p.cos().powi(2);
        let a = p.cos() * (lon - lon0) * D2R;
        let m = self.meridian(p);
        let m0 = self.meridian(lat0 * D2R);
        let x = k0
            * n
            * (a + (1.0 - t + c) * a.powi(3) / 6.0
                + (5.0 - 18.0 * t + t * t + 72.0 * c - 58.0 * ep2) * a.powi(5) / 120.0);
        let y = k0
            * (m - m0
                + n * p.tan()
                    * (a * a / 2.0
                        + (5.0 - t + 9.0 * c + 4.0 * c * c) * a.powi(4) / 24.0
                        + (61.0 - 58.0 * t + t * t + 600.0 * c - 330.0 * ep2) * a.powi(6) / 720.0));
        (x, y)
    }

    fn tm_inverse(&self, x: f64, y: f64, lat0: f64, lon0: f64, k0: f64) -> (f64, f64) {
        let e2 = self.e().powi(2);
        let ep2 = e2 / (1.0 - e2);
        let m = self.meridian(lat0 * D2R) + y / k0;
        let mu = m / (self.a * (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2.powi(3) / 256.0));
        let e1 = (1.0 - (1.0 - e2).sqrt()) / (1.0 + (1.0 - e2).sqrt());
        let p1 = mu
            + (3.0 * e1 / 2.0 - 27.0 * e1.powi(3) / 32.0) * (2.0 * mu).sin()
            + (21.0 * e1 * e1 / 16.0 - 55.0 * e1.powi(4) / 32.0) * (4.0 * mu).sin()
            + (151.0 * e1.powi(3) / 96.0) * (6.0 * mu).sin()
            + (1097.0 * e1.powi(4) / 512.0) * (8.0 * mu).sin();
        let n1 = self.a / (1.0 - e2 * p1.sin().powi(2)).sqrt();
        let t1 = p1.tan().powi(2);
        let c1 = ep2 * p1.cos().powi(2);
        let r1 = self.a * (1.0 - e2) / (1.0 - e2 * p1.sin().powi(2)).powf(1.5);
        let d = x / (n1 * k0);
        let p = p1
            - (n1 * p1.tan() / r1)
                * (d * d / 2.0 - (5.0 + 3.0 * t1 + 10.0 * c1 - 4.0 * c1 * c1 - 9.0 * ep2) * d.powi(4) / 24.0
                    + (61.0 + 90.0 * t1 + 298.0 * c1 + 45.0 * t1 * t1 - 252.0 * ep2 - 3.0 * c1 * c1) * d.powi(6)
                        / 720.0);
        let lam = (d - (1.0 + 2.0 * t1 + c1) * d.powi(3) / 6.0
            + (5.0 - 2.0 * c1 + 28.0 * t1 - 3.0 * c1 * c1 + 8.0 * ep2 + 24.0 * t1 * t1) * d.powi(5) / 120.0)
            / p1.cos();
        (lon0 + lam / D2R, p / D2R)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// proj4js on the ESRI WKT a King County East 2021 DNR DTM carries.
    #[test]
    fn washington_south_state_plane_matches_proj4js() {
        let p = from_epsg(2927).unwrap();
        for (lon, lat, x, y) in [
            (-121.41, 47.42, 1_415_132.835_424_062, 762_274.220_899_563_4),
            (-122.3, 46.8, 1_189_669.157_807_436_8, 539_987.887_576_370_6),
            (-119.9, 46.2, 1_792_341.804_284_325_8, 316_619.240_628_429_7),
        ] {
            let (gx, gy) = p.forward(lon, lat);
            assert!((gx - x).abs() < 1e-3 && (gy - y).abs() < 1e-3, "{gx} {gy}");
            let (blon, blat) = p.inverse(gx, gy);
            assert!((blon - lon).abs() < 1e-9 && (blat - lat).abs() < 1e-9);
        }
    }

    #[test]
    fn utm_matches_proj4js_to_the_millimetre() {
        let p = from_epsg(26910).unwrap();
        let (x, y) = p.forward(-121.41, 47.42);
        assert!((x - 619_928.864_419_250_2).abs() < 2e-3 && (y - 5_253_064.358_049_198).abs() < 2e-3, "{x} {y}");
        let (lon, lat) = p.inverse(x, y);
        assert!((lon + 121.41).abs() < 1e-8 && (lat - 47.42).abs() < 1e-8);
        assert!(from_epsg(4326).is_none());
    }
}
