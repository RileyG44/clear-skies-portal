//! Satellite scenes (app/search.js, app/scenes.js, app/config.js): a STAC
//! search of each catalogue at a point, the scenes normalised to one shape,
//! NASA GIBS daily layers alongside them, and a scene's tiles as a template
//! the map draws like any raster layer (kept for offline use).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::Engine;
use crate::layers::RasterAnswer;
use crate::transport::{FetchRequest, Method};

const SEARCH_TIMEOUT: Duration = Duration::from_secs(20);
const TILE_TIMEOUT: Duration = Duration::from_secs(20);
const KEPT: Duration = Duration::from_secs(10 * 365 * 24 * 3600);
const MONTH: Duration = Duration::from_secs(30 * 24 * 3600);

const TITILER: &str = "https://titiler.xyz/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=";
const NISAR_GIBS: &str = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/NISAR_L2_Geocoded_Polarimetric_Covariance/default/{DATE}/GoogleMapsCompatible_Level13/{z}/{y}/{x}.png";
/// Planetary Computer's documented natural-colour formula for raw bands.
const MPC_NATURAL: &str = "gamma RGB 3.2 saturation 0.8 sigmoidal RGB 25 0.35";

/// Hosts a scene's tiles may come from (share-state.js IMAGERY_HOSTS).
const IMAGERY_HOSTS: &[&str] = &[
    "planetarycomputer.microsoft.com",
    "earth-search.aws.element84.com",
    "titiler.xyz",
    "gibs.earthdata.nasa.gov",
    "sentinel-cogs.s3.us-west-2.amazonaws.com",
];

/// A collection's display metadata (config.js COLL).
pub struct Collection {
    pub id: &'static str,
    pub label: &'static str,
    /// Ground sample distance, metres.
    pub gsd: f64,
    pub kind: &'static str,
    /// rgb, sar, false, terrain or night.
    pub vis: &'static str,
}

pub const COLLECTIONS: &[Collection] = &[
    Collection { id: "sentinel-2-l2a", label: "Sentinel-2 L2A", gsd: 10.0, kind: "Optical", vis: "rgb" },
    Collection { id: "sentinel-2-c1-l2a", label: "Sentinel-2 C1", gsd: 10.0, kind: "Optical", vis: "rgb" },
    Collection { id: "sentinel-1-grd", label: "Sentinel-1 GRD", gsd: 10.0, kind: "SAR", vis: "sar" },
    Collection { id: "sentinel-1-rtc", label: "Sentinel-1 RTC", gsd: 10.0, kind: "SAR", vis: "sar" },
    Collection { id: "landsat-c2-l2", label: "Landsat 8/9 C2", gsd: 30.0, kind: "Optical", vis: "rgb" },
    Collection { id: "landsat-c2-l1", label: "Landsat C2 L1", gsd: 30.0, kind: "Optical", vis: "rgb" },
    Collection { id: "naip", label: "NAIP aerial", gsd: 0.6, kind: "Aerial", vis: "rgb" },
    Collection { id: "hls2-s30", label: "HLS S30 (harmonised)", gsd: 30.0, kind: "Optical", vis: "rgb" },
    Collection { id: "hls2-l30", label: "HLS L30 (harmonised)", gsd: 30.0, kind: "Optical", vis: "rgb" },
    Collection { id: "aster-l1t", label: "ASTER L1T", gsd: 15.0, kind: "VNIR", vis: "false" },
    Collection { id: "goes-cmi", label: "GOES ABI", gsd: 500.0, kind: "Geostationary", vis: "rgb" },
    Collection { id: "cop-dem-glo-30", label: "Copernicus DEM", gsd: 30.0, kind: "Terrain", vis: "terrain" },
    Collection {
        id: "NISAR_L2_GCOV_PROVISIONAL_V1_1",
        label: "NISAR GCOV (provisional)",
        gsd: 20.0,
        kind: "L-band SAR",
        vis: "sar",
    },
    Collection { id: "NISAR_L2_GCOV_BETA_V1_1", label: "NISAR GCOV (beta)", gsd: 20.0, kind: "L-band SAR", vis: "sar" },
];

pub fn collection(id: &str) -> Option<&'static Collection> {
    COLLECTIONS.iter().find(|c| c.id == id)
}

/// A STAC catalogue (config.js SOURCES).
pub struct Catalogue {
    pub key: &'static str,
    pub name: &'static str,
    pub api: &'static str,
    /// Collections searched together; a backend rejects a search across groups.
    pub groups: &'static [&'static [&'static str]],
}

pub const CATALOGUES: &[Catalogue] = &[
    Catalogue {
        key: "pc",
        name: "Microsoft Planetary Computer",
        api: "https://planetarycomputer.microsoft.com/api/stac/v1/search",
        groups: &[
            &["sentinel-2-l2a", "sentinel-1-grd", "landsat-c2-l2", "hls2-s30", "hls2-l30"],
            &["naip", "aster-l1t", "cop-dem-glo-30"],
        ],
    },
    Catalogue {
        key: "es",
        name: "AWS Earth Search (Element 84)",
        api: "https://earth-search.aws.element84.com/v1/search",
        groups: &[&["sentinel-2-l2a", "sentinel-1-grd", "landsat-c2-l2", "naip", "cop-dem-glo-30"]],
    },
    Catalogue {
        key: "cdse",
        name: "Copernicus Data Space",
        api: "https://stac.dataspace.copernicus.eu/v1/search",
        groups: &[&["sentinel-2-l2a", "sentinel-1-grd"]],
    },
    Catalogue {
        key: "nisar",
        name: "NISAR (NASA-ISRO L-band SAR)",
        api: "https://cmr.earthdata.nasa.gov/stac/ASF/search",
        groups: &[&["NISAR_L2_GCOV_PROVISIONAL_V1_1", "NISAR_L2_GCOV_BETA_V1_1"]],
    },
];

/// Products stamped once (the DEM, 2021): searched without a date window.
const STATIC: &[&str] = &["cop-dem-glo-30"];

/// A NASA GIBS daily global layer (config.js GIBS).
struct Daily {
    id: &'static str,
    label: &'static str,
    gsd: f64,
    vis: &'static str,
    /// Tile matrix set; Level9 unless given.
    tms: Option<&'static str>,
    /// A composite with one date.
    fixed: Option<&'static str>,
}

const DAILY: &[Daily] = &[
    Daily {
        id: "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
        label: "VIIRS NOAA-21 true color",
        gsd: 375.0,
        vis: "rgb",
        tms: None,
        fixed: None,
    },
    Daily {
        id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
        label: "VIIRS NOAA-20 true color",
        gsd: 375.0,
        vis: "rgb",
        tms: None,
        fixed: None,
    },
    Daily {
        id: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
        label: "VIIRS Suomi-NPP true color",
        gsd: 375.0,
        vis: "rgb",
        tms: None,
        fixed: None,
    },
    Daily {
        id: "MODIS_Terra_CorrectedReflectance_TrueColor",
        label: "MODIS Terra true color",
        gsd: 250.0,
        vis: "rgb",
        tms: None,
        fixed: None,
    },
    Daily {
        id: "MODIS_Aqua_CorrectedReflectance_TrueColor",
        label: "MODIS Aqua true color",
        gsd: 250.0,
        vis: "rgb",
        tms: None,
        fixed: None,
    },
    Daily {
        id: "VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1",
        label: "VIIRS NOAA-20 false color (snow/fire)",
        gsd: 375.0,
        vis: "false",
        tms: None,
        fixed: None,
    },
    Daily {
        id: "MODIS_Terra_CorrectedReflectance_Bands721",
        label: "MODIS Terra false color (burn/snow)",
        gsd: 250.0,
        vis: "false",
        tms: None,
        fixed: None,
    },
    Daily {
        id: "VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance",
        label: "VIIRS NOAA-20 night lights",
        gsd: 750.0,
        vis: "night",
        tms: Some("GoogleMapsCompatible_Level8"),
        fixed: None,
    },
    Daily {
        id: "VIIRS_NOAA21_DayNightBand",
        label: "VIIRS NOAA-21 night lights",
        gsd: 750.0,
        vis: "night",
        tms: Some("GoogleMapsCompatible_Level8"),
        fixed: None,
    },
    Daily {
        id: "VIIRS_Black_Marble",
        label: "Black Marble night composite",
        gsd: 500.0,
        vis: "night",
        tms: Some("GoogleMapsCompatible_Level8"),
        fixed: Some("2016-01-01"),
    },
];

/// How a scene's tiles are addressed.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Tiles {
    /// A template with `{z}`, `{x}` and `{y}`.
    Xyz(String),
    /// A TileJSON document naming the template.
    TileJson(String),
}

/// One scene, from any catalogue (search.js `norm`).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Scene {
    pub id: String,
    pub source: String,
    pub source_key: String,
    pub collection: String,
    pub label: String,
    pub kind: String,
    pub vis: String,
    pub gsd: Option<f64>,
    /// ISO 8601, UTC.
    pub date: String,
    pub cloud: Option<f64>,
    pub thumb: Option<String>,
    pub tiles: Option<Tiles>,
    pub link: Option<String>,
    /// West, south, east, north.
    pub bbox: Option<[f64; 4]>,
    /// The finest level the tiles hold.
    pub native_max: Option<u8>,
    /// The satellite and its repeat track, for estimating the next pass.
    pub platform: Option<String>,
    pub orbit: Option<i64>,
}

/// The date window of a search (search.js `relWindow`): the last `days`
/// days, or all time.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Window {
    pub days: Option<u32>,
}

impl Window {
    fn stac(self, now: SystemTime) -> Option<String> {
        let days = self.days?;
        let from = now.checked_sub(Duration::from_secs(u64::from(days) * 86_400))?;
        Some(format!("{}/..", iso(from)))
    }
}

fn iso(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    let (date, rem) = civil(secs);
    format!("{date}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// "YYYY-MM-DD" and seconds into the day, from Unix seconds.
fn civil(secs: i64) -> (String, i64) {
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (format!("{year:04}-{month:02}-{day:02}"), rem)
}

fn safe_http(url: Option<&str>) -> Option<String> {
    url.filter(|u| u.starts_with("https://") || u.starts_with("http://")).map(str::to_owned)
}

fn finite_bbox(v: &Value) -> Option<[f64; 4]> {
    let a = v.as_array()?;
    if a.len() != 4 {
        return None;
    }
    let b = [a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?, a[3].as_f64()?];
    b.iter().all(|x| x.is_finite()).then_some(b)
}

/// A STAC item as a scene (search.js `norm`). None without a date.
pub fn normalise(f: &Value, catalogue: &Catalogue) -> Option<Scene> {
    let p = &f["properties"];
    let a = &f["assets"];
    let cid = f["collection"].as_str().or(p["odc:product"].as_str()).unwrap_or("").to_owned();
    let info = collection(&cid);
    let href = |name: &str| a[name]["href"].as_str();
    let mut thumb = href("rendered_preview").or(href("thumbnail")).or(href("preview")).map(str::to_owned);
    let mut tiles = if let Some(t) = href("tilejson") {
        Some(Tiles::TileJson(t.to_owned()))
    } else {
        href("visual")
            .filter(|h| {
                let l = h.to_ascii_lowercase();
                l.ends_with(".tif") || l.ends_with(".tiff")
            })
            .map(|h| Tiles::Xyz(format!("{TITILER}{}", encode(h))))
    };
    let mut link = None;
    let mut native_max = None;
    let date = p["datetime"].as_str().or(p["start_datetime"].as_str())?.to_owned();
    if date.len() < 10 {
        return None;
    }
    if catalogue.key == "nisar" {
        tiles = Some(Tiles::Xyz(NISAR_GIBS.replace("{DATE}", &date[..10])));
        link = Some("https://search.asf.alaska.edu/#/?dataset=NISAR".to_owned());
        thumb = thumb.or_else(|| href("browse").map(str::to_owned));
        native_max = Some(13);
    }
    if catalogue.key == "cdse" {
        link = Some("https://browser.dataspace.copernicus.eu/".to_owned());
        thumb = thumb.or_else(|| href("QUICKLOOK").map(str::to_owned));
    }
    let gsd = info.map(|c| c.gsd).or(p["gsd"].as_f64()).filter(|g| g.is_finite() && *g > 0.0);
    let cloud = p["eo:cloud_cover"].as_f64().filter(|c| c.is_finite()).map(|c| c.clamp(0.0, 100.0));
    Some(Scene {
        id: f["id"].as_str().map_or_else(|| format!("{}:{cid}:{date}", catalogue.key), str::to_owned),
        source: catalogue.name.to_owned(),
        source_key: catalogue.key.to_owned(),
        label: info.map_or(cid.clone(), |c| c.label.to_owned()),
        kind: info.map_or("", |c| c.kind).to_owned(),
        vis: info.map_or("rgb", |c| c.vis).to_owned(),
        collection: cid,
        gsd,
        date,
        cloud,
        thumb: safe_http(thumb.as_deref()),
        tiles,
        link: safe_http(link.as_deref()),
        bbox: finite_bbox(&f["bbox"]),
        native_max,
        platform: p["platform"].as_str().or(p["constellation"].as_str()).map(str::to_owned),
        orbit: p["sat:relative_orbit"].as_i64(),
    })
}

/// Percent-encodes a URL for a query parameter.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// GIBS daily layers for the window: the last three complete UTC days of
/// each (search.js `gibsItems`), and fixed composites always.
pub fn daily(window: Window, now: SystemTime) -> Vec<Scene> {
    let secs = now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
    // Today's set is still being acquired: the last complete day is yesterday.
    let complete = secs.div_euclid(86_400) * 86_400 - 1;
    let start = window.days.map_or(i64::MIN, |d| secs - i64::from(d) * 86_400);
    let mut out = Vec::new();
    for g in DAILY {
        let tms = g.tms.unwrap_or("GoogleMapsCompatible_Level9");
        let format = if g.vis == "night" { "png" } else { "jpg" };
        let level: u8 = tms.rsplit("Level").next().and_then(|l| l.parse().ok()).unwrap_or(9);
        let mut push = |date: String| {
            out.push(Scene {
                id: format!("{}/{date}", g.id),
                source: "NASA GIBS (near real-time)".into(),
                source_key: "gibs".into(),
                collection: g.id.into(),
                label: g.label.into(),
                kind: if g.vis == "night" { "Night" } else { "Optical NRT" }.into(),
                vis: g.vis.into(),
                gsd: Some(g.gsd),
                date: format!("{date}T12:00:00Z"),
                cloud: None,
                thumb: None,
                tiles: Some(Tiles::Xyz(format!(
                    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{}/default/{date}/{tms}/{{z}}/{{y}}/{{x}}.{format}",
                    g.id
                ))),
                link: Some(format!("https://worldview.earthdata.nasa.gov/?v=-180,-90,180,90&t={date}")),
                bbox: None,
                native_max: Some(level),
                platform: None,
                orbit: None,
            });
        };
        if let Some(fixed) = g.fixed {
            push(fixed.into());
            continue;
        }
        for d in 0..3 {
            let t = complete - d * 86_400;
            if t < start {
                break;
            }
            push(civil(t).0);
        }
    }
    out
}

/// The tile template a map draws, sharpened for high-density screens
/// (map.js `sharpSceneUrl`) and colour-tuned (scenes.js `tuneTileUrl`).
pub fn tune(url: &str, collection: &str) -> String {
    let mut url = url.to_owned();
    if url.contains("planetarycomputer.microsoft.com")
        && (url.contains("?assets=B") || url.contains("&assets=B"))
        && !url.contains("color_formula=")
    {
        url.push_str(&format!("&color_formula={}", encode(MPC_NATURAL)));
    }
    if collection.starts_with("hls2-") && !url.contains("rescale=") {
        let softer = encode("gamma RGB 1.4, saturation 1.3");
        if let Some(i) = url.find("color_formula=") {
            let end = url[i..].find('&').map_or(url.len(), |e| i + e);
            url.replace_range(i + "color_formula=".len()..end, &softer);
        }
        url.push_str("&rescale=0,3000");
    }
    // High density: titiler at 512 px, others at @2x.
    if url.starts_with("https://titiler.xyz/cog/tiles/") {
        if url.contains("tilesize=") {
            return url;
        }
        let sep = if url.contains('?') { '&' } else { '?' };
        return format!("{url}{sep}tilesize=512");
    }
    if url.contains("{y}@1x") {
        return url.replace("{y}@1x", "{y}@2x");
    }
    if url.contains("/tiles/WebMercatorQuad/{z}/{x}/{y}")
        && !url.contains("{y}@")
        && (url.contains("titiler") || url.contains("planetarycomputer"))
    {
        for ext in [".png", ".jpg", ".jpeg", ".webp", ""] {
            let from = format!("/{{y}}{ext}");
            if let Some(i) = url.find(&from) {
                let after = &url[i + from.len()..];
                if ext.is_empty() && !(after.is_empty() || after.starts_with('?') || after.starts_with('#')) {
                    continue;
                }
                url.replace_range(i..i + from.len(), &format!("/{{y}}@2x{ext}"));
                break;
            }
        }
    }
    url
}

/// The tile side a tuned template sends (512 for titiler and @2x tiles).
pub fn tile_pixels(template: &str) -> u32 {
    if template.contains("tilesize=512") || template.contains("@2x") { 512 } else { 256 }
}

fn host(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    rest.split(['/', '?', '#']).next().unwrap_or("").rsplit('@').next().unwrap_or("")
}

/// Whether tiles may be fetched from `url`'s host.
pub fn imagery_host(url: &str) -> bool {
    url.starts_with("https://") && IMAGERY_HOSTS.contains(&host(url))
}

/// What a search found.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Found {
    pub scenes: Vec<Scene>,
    /// Catalogues that answered, with how many scenes, and those that failed.
    pub answered: Vec<(String, usize)>,
    pub failed: Vec<String>,
}

/// Recently resolved TileJSON templates (scenes.js `tjCache`, 30 minutes).
#[derive(Default)]
pub struct TileJsonCache(Mutex<HashMap<String, (String, Instant)>>);

impl Engine {
    async fn stac_post(self: &Arc<Self>, api: &str, body: &Value) -> Result<Vec<Value>, u16> {
        let mut fetch = FetchRequest::get(api).timeout(SEARCH_TIMEOUT).max_body(16 << 20);
        fetch.method = Method::Post;
        fetch.headers.push(("Content-Type".into(), "application/json".into()));
        fetch.body = body.to_string().into_bytes();
        let r = self.upstream.fetch(fetch).await.map_err(|_| 0u16)?;
        if r.status != 200 {
            return Err(r.status);
        }
        let v: Value = serde_json::from_slice(&r.body).map_err(|_| 0u16)?;
        Ok(v["features"].as_array().cloned().unwrap_or_default())
    }

    /// One catalogue's scenes at a point (search.js `stacSearch`).
    async fn search_catalogue(
        self: &Arc<Self>,
        c: &'static Catalogue,
        lat: f64,
        lng: f64,
        window: Window,
        cloud_max: f64,
        now: SystemTime,
    ) -> Result<Vec<Scene>, ()> {
        let stac = window.stac(now);
        let mut base = json!({
            "intersects": {"type": "Point", "coordinates": [lng, lat]},
            "limit": 60,
            "sortby": [{"field": "properties.datetime", "direction": "desc"}],
        });
        if let Some(stac) = &stac {
            base["datetime"] = json!(stac);
        }
        if c.key == "nisar" {
            // CMR-STAC ignores sortby and answers oldest first: a recent window.
            let d = 0.35;
            base = json!({
                "bbox": [lng - d, lat - d, lng + d, lat + d],
                "limit": 40,
                "datetime": Window { days: Some(window.days.unwrap_or(150).min(150)) }.stac(now),
            });
        }
        let mut jobs = Vec::new();
        for group in c.groups {
            let dated: Vec<&str> = group.iter().copied().filter(|g| !STATIC.contains(g)).collect();
            if !dated.is_empty() {
                let mut body = base.clone();
                body["collections"] = json!(dated);
                jobs.push(body);
            }
        }
        let statics: Vec<&str> =
            c.groups.iter().flat_map(|g| g.iter().copied()).filter(|g| STATIC.contains(g)).collect();
        if !statics.is_empty() && c.key != "nisar" {
            jobs.push(
                json!({"collections": statics, "intersects": {"type": "Point", "coordinates": [lng, lat]}, "limit": 2}),
            );
        }
        let mut features = Vec::new();
        let mut any = false;
        for body in jobs {
            match self.stac_post(c.api, &body).await {
                Ok(f) => {
                    features.extend(f);
                    any = true;
                }
                // A catalogue that rejects a multi-collection search still
                // answers per collection; merge those answers.
                Err(400) => {
                    for coll in body["collections"].as_array().cloned().unwrap_or_default() {
                        let mut one = body.clone();
                        one["collections"] = json!([coll]);
                        if let Ok(f) = self.stac_post(c.api, &one).await {
                            features.extend(f);
                            any = true;
                        }
                    }
                }
                Err(_) => {}
            }
        }
        if !any {
            return Err(());
        }
        Ok(features
            .iter()
            .filter_map(|f| normalise(f, c))
            .filter(|s| s.cloud.is_none_or(|cl| cl <= cloud_max))
            .collect())
    }

    /// Scenes at a point from every catalogue at once, then the GIBS daily
    /// layers. `cloud_max` 101 admits every scene.
    pub async fn search_scenes(self: &Arc<Self>, lat: f64, lng: f64, window: Window, cloud_max: f64) -> Found {
        let now = SystemTime::now();
        let jobs = CATALOGUES.iter().map(|c| {
            let me = self.clone();
            async move { (c, me.search_catalogue(c, lat, lng, window, cloud_max, now).await) }
        });
        let mut found = Found::default();
        for (c, result) in futures_join(jobs).await {
            match result {
                Ok(scenes) => {
                    found.answered.push((c.name.to_owned(), scenes.len()));
                    found.scenes.extend(scenes);
                }
                Err(()) => found.failed.push(c.name.to_owned()),
            }
        }
        found.scenes.extend(daily(window, now));
        found
    }

    /// A scene's tile template, resolving a TileJSON document (cached for
    /// 30 minutes) and tuning it. None if it has no usable template.
    pub async fn scene_template(self: &Arc<Self>, scene: &Scene) -> Option<String> {
        let raw = match scene.tiles.as_ref()? {
            Tiles::Xyz(t) => t.clone(),
            Tiles::TileJson(url) => {
                if let Some((t, at)) = self.tilejson.0.lock().unwrap_or_else(|e| e.into_inner()).get(url)
                    && at.elapsed() < Duration::from_secs(30 * 60)
                {
                    return Some(t.clone());
                }
                let fetch = FetchRequest::get(url.as_str()).timeout(Duration::from_secs(10)).max_body(1 << 20);
                let r = self.upstream.fetch(fetch).await.ok()?;
                let v: Value = serde_json::from_slice(&r.body).ok().filter(|_| r.status == 200)?;
                let template = tune(v["tiles"][0].as_str()?, &scene.collection);
                if !imagery_host(&template) {
                    return None;
                }
                self.tilejson
                    .0
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(url.clone(), (template.clone(), Instant::now()));
                return Some(template);
            }
        };
        let template = tune(&raw, &scene.collection);
        imagery_host(&template).then_some(template)
    }

    /// One tile of a scene's template, kept for offline use. Hosts outside
    /// the imagery list are refused.
    pub async fn scene_tile(self: &Arc<Self>, template: &str, z: u8, x: u32, y: u32) -> RasterAnswer {
        if !imagery_host(template) || x >= 1 << z || y >= 1 << z {
            return RasterAnswer::Empty;
        }
        let digest = Sha256::digest(template.as_bytes());
        let id: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
        let key = format!("scene:{id}:{z}/{x}/{y}");
        if let Ok(Some(hit)) = self.store.get(&key, MONTH) {
            return if hit.body.is_empty() {
                RasterAnswer::Empty
            } else {
                RasterAnswer::Image { bytes: hit.body, lasting: true }
            };
        }
        let url = template.replace("{z}", &z.to_string()).replace("{x}", &x.to_string()).replace("{y}", &y.to_string());
        let fetch = FetchRequest::get(url).timeout(TILE_TIMEOUT).max_body(8 << 20);
        let me = self.clone();
        let k = key.clone();
        let fetched = self
            .layer_flights
            .run(key.clone(), move || async move {
                let r = me.upstream.fetch(fetch).await.ok()?;
                let media = r.header("content-type").unwrap_or("application/octet-stream").to_owned();
                // Outside a scene's footprint the tilers answer 404 or 204.
                let body = match r.status {
                    200 if crate::layers::image(&r.body) => r.body,
                    204 | 404 => Vec::new(),
                    _ => return None,
                };
                let _ = me.store.put(&k, csk_store::Kind::Source, 200, &media, None, &body);
                Some(body)
            })
            .await
            .flatten();
        match fetched {
            Some(bytes) if bytes.is_empty() => RasterAnswer::Empty,
            Some(bytes) => RasterAnswer::Image { bytes, lasting: true },
            None => match self.store.get(&key, KEPT) {
                Ok(Some(hit)) if !hit.body.is_empty() => RasterAnswer::Image { bytes: hit.body, lasting: false },
                _ => RasterAnswer::Retry { after: Duration::from_secs(5) },
            },
        }
    }
}

/// Runs futures together and answers in their order.
async fn futures_join<F>(jobs: impl Iterator<Item = F>) -> Vec<F::Output>
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    let handles: Vec<_> = jobs.map(tokio::spawn).collect();
    let mut out = Vec::with_capacity(handles.len());
    for h in handles {
        if let Ok(v) = h.await {
            out.push(v);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_items_and_tunes_templates_as_the_web_does() {
        let es = &CATALOGUES[1];
        let item = json!({
            "id": "S2B_10TEN_20261101_0_L2A", "collection": "sentinel-2-l2a",
            "bbox": [-118.0, 47.0, -117.0, 48.0],
            "properties": {"datetime": "2026-11-01T19:05:12Z", "eo:cloud_cover": 3.2},
            "assets": {"thumbnail": {"href": "https://example.com/t.jpg"},
                       "visual": {"href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/x/TCI.tif"}}
        });
        let s = normalise(&item, es).unwrap();
        assert_eq!((s.label.as_str(), s.gsd, s.cloud), ("Sentinel-2 L2A", Some(10.0), Some(3.2)));
        let Some(Tiles::Xyz(t)) = &s.tiles else { panic!("tiles") };
        assert!(t.starts_with(TITILER) && t.ends_with("TCI.tif"));
        let tuned = tune(t, &s.collection);
        assert!(tuned.ends_with("&tilesize=512") && imagery_host(&tuned));
        assert_eq!(tile_pixels(&tuned), 512);
        let pc = "https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}.png?assets=B04&assets=B03";
        let tuned = tune(pc, "sentinel-2-l2a");
        assert!(tuned.contains("/{y}@2x.png?") && tuned.contains("color_formula=gamma%20RGB%203.2"));
        assert!(!imagery_host("https://evil.example.com/{z}/{x}/{y}"));
        assert!(normalise(&json!({"properties": {}}), es).is_none());
    }

    #[test]
    fn daily_layers_use_complete_utc_days() {
        // 6 Nov 2026 21:20 UTC: the newest complete day is 5 Nov.
        let now = UNIX_EPOCH + Duration::from_secs(1_794_000_000);
        let d = daily(Window { days: Some(365) }, now);
        assert!(d.iter().any(|s| s.id == "MODIS_Terra_CorrectedReflectance_TrueColor/2026-11-05"));
        assert!(!d.iter().any(|s| s.id.ends_with("/2026-11-06")));
        assert!(d.iter().any(|s| s.id == "VIIRS_Black_Marble/2016-01-01"));
        assert_eq!(d.iter().filter(|s| s.collection == "MODIS_Aqua_CorrectedReflectance_TrueColor").count(), 3);
        assert_eq!(Window { days: Some(1) }.stac(now).unwrap(), "2026-11-05T21:20:00Z/..");
    }
}
