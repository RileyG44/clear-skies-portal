//! Cached proxies for upstreams the page cannot use directly (no CORS) or
//! that offline use reads from the engine's cache: 3DEP rendered terrain,
//! NOHRSC snow, NASA FIRMS, Macrostrat geology, NHD reference exports, and
//! images for map snapshots. Each accepts only its own exact upstream and
//! checks that the answer really is what it claims before caching it.

use std::sync::Arc;
use std::time::Duration;

use csk_core::raster;
use csk_store::Kind;
use serde_json::json;
use url::Url;

use crate::Engine;
use crate::router::{Request, Response};
use crate::transport::{FetchRequest, FetchResponse};
use crate::usgs::catalog::encode_component;

const TTL_TILE: Duration = Duration::from_secs(90 * 24 * 3600);
const TTL_FIRMS: Duration = Duration::from_secs(20 * 60);
/// NOHRSC publishes four analyses a day.
const TTL_SNOW: Duration = Duration::from_secs(2 * 3600);
const TTL_SNAPSHOT: Duration = Duration::from_secs(24 * 3600);
const TILE_TIMEOUT: Duration = Duration::from_secs(30);
/// Cold NHD renders finish just under 10 s; CloudFront's CORS-less gateway
/// page follows at about 10.2 s. Stay under it.
const HYDRO_TIMEOUT: Duration = Duration::from_millis(9800);

pub const DEP_RULES: &[&str] = &[
    "Hillshade Gray",
    "Hillshade Multidirectional",
    "Hillshade Elevation Tinted",
    "Slope Map",
    "Aspect Map",
    "Preset 2ft Contour Interval",
    "Preset 5ft Contour Interval",
    "Preset 10ft Contour Interval",
    "Contour Smoothed 25",
];

/// Raster providers a snapshot may include. Matched exactly: the snapshot
/// helper must never become a general-purpose proxy.
const SNAPSHOT_HOSTS: &[&str] = &[
    "planetarycomputer.microsoft.com",
    "titiler.xyz",
    "gibs.earthdata.nasa.gov",
    "elevation.nationalmap.gov",
    "s3.amazonaws.com",
    "prd-tnm.s3.amazonaws.com",
    "services.arcgisonline.com",
    "tiles.maps.eox.at",
    "basemap.nationalmap.gov",
    "hydro.nationalmap.gov",
    "carto.nationalmap.gov",
    "mrdata.usgs.gov",
    "gis.dnr.wa.gov",
    "lidarportal.dnr.wa.gov",
    "tiles.macrostrat.org",
    "mapservices.weather.noaa.gov",
    "earthquake.usgs.gov",
    "tiles.arcgis.com",
];
const MAX_SNAPSHOT_URL: usize = 8192;
const MAX_SNAPSHOT_IMAGE: usize = 16 << 20;
const MAX_REDIRECTS: usize = 3;

pub fn is_png(b: &[u8]) -> bool {
    b.len() > 8 && b.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
}
fn is_jpeg(b: &[u8]) -> bool {
    b.len() > 3 && b.starts_with(&[0xff, 0xd8, 0xff])
}
fn is_webp(b: &[u8]) -> bool {
    b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP"
}

/// `w,s,e,n` in Web Mercator metres, inside the square and non-empty.
pub fn valid_merc_bbox(v: &str) -> bool {
    if v.is_empty() || v.len() > 240 {
        return false;
    }
    let parts: Vec<&str> = v.split(',').collect();
    if parts.len() != 4 || !parts.iter().all(|p| is_decimal(p)) {
        return false;
    }
    let b: Vec<f64> = parts.iter().filter_map(|p| p.parse().ok()).collect();
    let limit = 20_037_508.35;
    b.len() == 4 && b.iter().all(|x| x.abs() <= limit) && b[0] < b[2] && b[1] < b[3]
}

/// `-?\d+(\.\d+)?`
fn is_decimal(s: &str) -> bool {
    let s = s.strip_prefix('-').unwrap_or(s);
    let (int, frac) = s.split_once('.').map_or((s, None), |(a, b)| (a, Some(b)));
    !int.is_empty()
        && int.bytes().all(|c| c.is_ascii_digit())
        && frac.is_none_or(|f| !f.is_empty() && f.bytes().all(|c| c.is_ascii_digit()))
}

/// Exported map images come at 256 px, or 512 for high-density screens.
fn export_px(req: &Request) -> u32 {
    if req.param("size") == Some("512") { 512 } else { 256 }
}

fn upstream_error() -> Response {
    Response::new(204, "image/png", Vec::new())
        .header("X-Cache", "ERROR")
        .header("X-CSP-Error", "upstream")
        .header("Cache-Control", "no-store")
        .header("Retry-After", "2")
}

impl Engine {
    /// A cached upstream answer `ok` accepts, shared while in flight.
    async fn cached_fetch(
        self: &Arc<Self>,
        key: String,
        ttl: Duration,
        req: FetchRequest,
        ok: fn(&FetchResponse) -> bool,
    ) -> Option<(Vec<u8>, String, bool)> {
        if let Ok(Some(hit)) = self.store.get(&key, ttl) {
            return Some((hit.body, hit.media, true));
        }
        let me = self.clone();
        let k = key.clone();
        self.proxy_flights
            .run(key, move || async move {
                let r = me.upstream.fetch(req).await.ok()?;
                if !ok(&r) {
                    return None;
                }
                let media = r.header("content-type").unwrap_or("application/octet-stream").to_owned();
                let _ = me.store.put(&k, Kind::Source, 200, &media, None, &r.body);
                Some((r.body, media, false))
            })
            .await
            .flatten()
    }
}

fn png_ok(r: &FetchResponse) -> bool {
    r.status == 200 && is_png(&r.body)
}

pub async fn dep(engine: &Arc<Engine>, req: &Request) -> Response {
    let bbox = req.param("bbox").unwrap_or("");
    let rule = req.param("rule").unwrap_or("Hillshade Gray");
    if !valid_merc_bbox(bbox) || !DEP_RULES.contains(&rule) {
        return Response::json(400, &json!({"error": "bad bbox or rendering rule"}));
    }
    let px = export_px(req);
    let rr = encode_component(&json!({"rasterFunction": rule}).to_string());
    let path = |px: u32| {
        format!(
            "/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={bbox}&bboxSR=3857&imageSR=3857\
             &size={px},{px}&format=png&transparent=true&f=image&renderingRule={rr}"
        )
    };
    let key = |px: u32| format!("3dep:{}", path(px));
    let url = format!("https://{}{}", crate::upstream::DEP_HOST, path(px));
    let fetch = FetchRequest::get(url).timeout(TILE_TIMEOUT).max_body(8 << 20);
    if let Some((body, _, hit)) = engine.cached_fetch(key(px), TTL_TILE, fetch, png_ok).await {
        return Response::new(200, "image/png", body)
            .header("X-Cache", if hit { "HIT" } else { "MISS" })
            .header("Cache-Control", "public, max-age=604800");
    }
    // A sharp tile failed: the 256 px one, if held, is better than nothing.
    if px != 256
        && let Ok(Some(low)) = engine.store.get(&key(256), TTL_TILE)
    {
        return Response::new(200, "image/png", low.body)
            .header("X-Cache", "HIT-256")
            .header("Cache-Control", "no-store");
    }
    upstream_error()
}

pub async fn snow(engine: &Arc<Engine>, req: &Request) -> Response {
    let bbox = req.param("bbox").unwrap_or("");
    if !valid_merc_bbox(bbox) {
        return Response::json(400, &json!({"error": "bad bbox"}));
    }
    let layer = req.param("layer").unwrap_or("3");
    if layer != "3" && layer != "7" {
        return Response::json(400, &json!({"error": "bad layer"})); // 3 = depth, 7 = SWE
    }
    let px = export_px(req);
    let path = format!(
        "/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export?bbox={bbox}&bboxSR=3857&imageSR=3857\
         &size={px},{px}&format=png32&transparent=true&f=image&layers=show:{layer}"
    );
    let fetch = FetchRequest::get(format!("https://mapservices.weather.noaa.gov{path}"))
        .timeout(TILE_TIMEOUT)
        .max_body(8 << 20);
    match engine.cached_fetch(format!("snow:{path}"), TTL_SNOW, fetch, png_ok).await {
        Some((body, _, hit)) => Response::new(200, "image/png", body)
            .header("X-Cache", if hit { "HIT" } else { "MISS" })
            .header("Cache-Control", "public, max-age=3600"),
        None => upstream_error(),
    }
}

pub async fn firms(engine: &Arc<Engine>, req: &Request) -> Response {
    let rel = match req.param("sat").unwrap_or("J1").to_ascii_uppercase().as_str() {
        "J2" => "noaa-21-viirs-c2/csv/J2_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
        "SV" => "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
        _ => "noaa-20-viirs-c2/csv/J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv",
    };
    let fetch = FetchRequest::get(format!("https://firms.modaps.eosdis.nasa.gov/data/active_fire/{rel}"))
        .timeout(TILE_TIMEOUT)
        .max_body(32 << 20);
    match engine.cached_fetch(format!("firms:{rel}"), TTL_FIRMS, fetch, |r| r.status == 200).await {
        Some((body, _, hit)) => Response::new(200, "text/csv; charset=utf-8", body)
            .header("X-Cache", if hit { "HIT" } else { "MISS" })
            .header("Cache-Control", "public, max-age=600"),
        None => Response::text(502, "FIRMS unavailable").header("Cache-Control", "no-store"),
    }
}

/// `/api/geo/macrostrat/{z}/{x}/{y}.png`
pub async fn geology(engine: &Arc<Engine>, req: &Request) -> Response {
    let Some((z, x, y)) = crate::router::tile_coords(&req.path, "/api/geo/macrostrat/", ".png", 22) else {
        return Response::text(400, "bad geo tile path");
    };
    let path = format!("/carto/{z}/{x}/{y}.png");
    let fetch =
        FetchRequest::get(format!("https://tiles.macrostrat.org{path}")).timeout(TILE_TIMEOUT).max_body(4 << 20);
    match engine.cached_fetch(format!("geo:macrostrat:{path}"), TTL_TILE, fetch, png_ok).await {
        Some((body, _, hit)) => Response::new(200, "image/png", body)
            .header("X-Cache", if hit { "HIT" } else { "MISS" })
            .header("Cache-Control", "public, max-age=2592000"),
        None => upstream_error(),
    }
}

/// An NHD MapServer export, rebuilt from an allowlist of parameters so the
/// route cannot fetch anything else.
pub fn hydro_export_url(value: &str) -> Option<String> {
    let target = Url::parse(value).ok()?;
    if target.scheme() != "https"
        || !target.username().is_empty()
        || target.password().is_some()
        || target.port().is_some_and(|p| p != 443)
        || target.host_str() != Some("hydro.nationalmap.gov")
        || target.path() != "/arcgis/rest/services/nhd/MapServer/export"
    {
        return None;
    }
    let get = |k: &str| target.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    let mut out = Url::parse("https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export").ok()?;
    {
        let mut q = out.query_pairs_mut();
        for k in ["bbox", "bboxSR", "imageSR", "size", "format", "transparent", "dpi", "f", "layers"] {
            let v = get(k)?;
            if v.is_empty() || v.len() > 200 {
                return None;
            }
            q.append_pair(k, &v);
        }
    }
    let v = |k: &str| get(k).unwrap_or_default();
    let digits = |s: &str, lo: usize, hi: usize| (lo..=hi).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_digit());
    let size_ok = v("size").split_once(',').is_some_and(|(a, b)| digits(a, 2, 4) && digits(b, 2, 4));
    let layers_ok =
        v("layers").strip_prefix("show:").is_some_and(|l| !l.is_empty() && l.split(',').all(|n| digits(n, 1, 12)));
    let bbox = v("bbox");
    let bbox_ok = bbox.split(',').count() == 4 && bbox.split(',').all(is_decimal);
    (v("bboxSR") == "3857"
        && v("imageSR") == "3857"
        && v("format") == "png32"
        && v("f") == "image"
        && v("transparent") == "true"
        && digits(&v("dpi"), 2, 3)
        && size_ok
        && layers_ok
        && bbox_ok)
        .then(|| out.to_string())
}

pub async fn hydro(engine: &Arc<Engine>, req: &Request) -> Response {
    let Some(url) = req.param("url").and_then(hydro_export_url) else {
        return Response::json(400, &json!({"error": "bad reference export"}));
    };
    let quiet = || {
        // The 1 px sentinel the map treats as "no detail".
        Response::new(200, "image/png", raster::transparent_png().to_vec())
            .header("Cache-Control", "no-store")
            .header("X-CSP-Error", "upstream")
    };
    let r = engine.upstream.fetch(FetchRequest::get(url).timeout(HYDRO_TIMEOUT).max_body(8 << 20)).await;
    match r {
        Ok(r) if png_ok(&r) && r.body.len() > raster::transparent_png().len() => {
            Response::new(200, "image/png", r.body).header("Cache-Control", "public, max-age=86400")
        }
        _ => quiet(),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Refused(pub u16, pub &'static str);

/// Validates a snapshot image URL: HTTPS, port 443, no credentials, an
/// exact allowed host, never a literal or private name.
pub fn snapshot_url(value: &str) -> Result<Url, Refused> {
    if value.trim().is_empty() {
        return Err(Refused(400, "snapshot image URL is required"));
    }
    if value.len() > MAX_SNAPSHOT_URL {
        return Err(Refused(400, "snapshot image URL is too long"));
    }
    let mut u = Url::parse(value).map_err(|_| Refused(400, "snapshot image URL is invalid"))?;
    if u.scheme() != "https" {
        return Err(Refused(400, "snapshot image URL must use HTTPS"));
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err(Refused(400, "snapshot image URL must not contain credentials"));
    }
    if u.port().is_some_and(|p| p != 443) {
        return Err(Refused(400, "snapshot image URL must use port 443"));
    }
    let host = match u.host() {
        Some(url::Host::Domain(d)) => d.trim_end_matches('.').to_ascii_lowercase(),
        _ => return Err(Refused(403, "snapshot image URL must not use a literal or private host")),
    };
    if host == "localhost" || [".localhost", ".local", ".internal", ".home.arpa"].iter().any(|s| host.ends_with(s)) {
        return Err(Refused(403, "snapshot image URL must not use a literal or private host"));
    }
    if !SNAPSHOT_HOSTS.contains(&host.as_str()) {
        return Err(Refused(403, "snapshot image host is not allowed"));
    }
    u.set_host(Some(&host)).map_err(|_| Refused(400, "snapshot image URL is invalid"))?;
    u.set_fragment(None);
    Ok(u)
}

pub async fn snapshot(engine: &Arc<Engine>, req: &Request) -> Response {
    let mut target = match snapshot_url(req.param("url").unwrap_or("")) {
        Ok(u) => u,
        Err(Refused(s, m)) => return Response::json(s, &json!({"error": m})),
    };
    let key = format!("snapshot:image:v2:{target}");
    if let Ok(Some(hit)) = engine.store.get(&key, TTL_SNAPSHOT) {
        return Response::new(200, &hit.media, hit.body)
            .header("X-Cache", "HIT")
            .header("Cache-Control", "public, max-age=86400");
    }
    let fail = |s: u16, m: String| Response::json(s, &json!({"error": m}));
    let mut seen = Vec::new();
    for hop in 0..=MAX_REDIRECTS {
        if seen.contains(&target) {
            return fail(502, "snapshot image upstream redirect loop".into());
        }
        seen.push(target.clone());
        let r = match engine
            .upstream
            .fetch(FetchRequest::get(target.as_str()).timeout(TILE_TIMEOUT).max_body(MAX_SNAPSHOT_IMAGE))
            .await
        {
            Ok(r) => r,
            Err(e) => return fail(502, format!("snapshot image upstream request failed: {e}")),
        };
        if matches!(r.status, 301 | 302 | 303 | 307 | 308) {
            if hop == MAX_REDIRECTS {
                return fail(502, "snapshot image upstream sent too many redirects".into());
            }
            // Every hop is validated again: a redirect must not leave the allowlist.
            let next = r.header("location").and_then(|l| target.join(l).ok());
            match next.map(|n| snapshot_url(n.as_str())) {
                Some(Ok(n)) => target = n,
                Some(Err(Refused(s, m))) => return fail(s, m.into()),
                None => return fail(502, "snapshot image upstream sent an invalid redirect".into()),
            }
            continue;
        }
        if r.status != 200 {
            return fail(502, format!("snapshot image upstream returned HTTP {}", r.status));
        }
        let media = r.header("content-type").unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        let check: fn(&[u8]) -> bool = match media.as_str() {
            "image/png" => is_png,
            "image/jpeg" => is_jpeg,
            "image/webp" => is_webp,
            _ => return fail(415, "snapshot image upstream did not return PNG, JPEG, or WebP".into()),
        };
        if !check(&r.body) {
            return fail(502, format!("snapshot image upstream returned invalid {media} data"));
        }
        let _ = engine.store.put(&key, Kind::Source, 200, &media, None, &r.body);
        return Response::new(200, &media, r.body)
            .header("X-Cache", "MISS")
            .header("Cache-Control", "public, max-age=86400");
    }
    fail(502, "snapshot image upstream sent too many redirects".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation() {
        assert!(valid_merc_bbox("-13580000,6000000,-13570000,6010000"));
        assert!(!valid_merc_bbox("1,2,3"));
        assert!(!valid_merc_bbox("3,2,1,4"));
        assert!(!valid_merc_bbox("1e3,2,3,4"));
        let ok = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/export?bbox=-1.5,2,3,4&bboxSR=3857\
                  &imageSR=3857&size=256,256&format=png32&transparent=true&dpi=96&f=image&layers=show:6,8&evil=1";
        let rebuilt = hydro_export_url(ok).unwrap();
        assert!(!rebuilt.contains("evil") && rebuilt.contains("layers=show%3A6%2C8"));
        assert!(hydro_export_url(&ok.replace("hydro.", "evil.")).is_none());
        assert!(hydro_export_url(&ok.replace("png32", "json")).is_none());
        assert!(snapshot_url("https://services.arcgisonline.com/x.png#a").is_ok());
        assert_eq!(snapshot_url("http://services.arcgisonline.com/x").unwrap_err().0, 400);
        assert_eq!(snapshot_url("https://127.0.0.1/x").unwrap_err().0, 403);
        assert_eq!(snapshot_url("https://evil.example/x").unwrap_err().0, 403);
        assert_eq!(snapshot_url("https://u:p@titiler.xyz/x").unwrap_err().0, 400);
    }
}
