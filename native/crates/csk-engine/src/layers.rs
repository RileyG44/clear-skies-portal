//! Raster map layers for the native map: the cartographic basemap (light and
//! dark) and the raster reference overlays of the web client's catalogue
//! (app/overlays.js): cached tile services, ArcGIS dynamic services exported
//! one tile at a time in the tile's own Web Mercator bounds, and NASA GIBS
//! daily products. Tiles are kept in the engine's store, so a map viewed once
//! keeps drawing offline; after a failed refresh the kept tile is served and
//! asked for again later.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use csk_store::Kind;

use crate::Engine;
use crate::transport::FetchRequest;

const KEPT: Duration = Duration::from_secs(10 * 365 * 24 * 3600);
const TIMEOUT: Duration = Duration::from_secs(20);
/// Refreshed after this; served (as stale) for as long as it is kept.
const MONTH: Duration = Duration::from_secs(30 * 24 * 3600);
/// NOAA refreshes the snow analysis four times a day.
const SIX_HOURS: Duration = Duration::from_secs(6 * 3600);

/// Export tiles are drawn at twice the CSS tile size, as the web does on
/// high-density screens (its ceiling of 3x would triple memory for little).
pub const EXPORT_DENSITY: u32 = 2;

/// Where a layer's tiles come from.
#[derive(Debug)]
pub enum Source {
    /// A tile cache; the template has `{z}`, `{x}` and `{y}`.
    Tiles(&'static str),
    /// An ArcGIS dynamic MapServer `export`, one request per tile. `dpi`
    /// asks for display-density symbols (services that ignore it omit it).
    Export { endpoint: &'static str, layers: &'static str, dpi: bool },
    /// A NASA GIBS daily product in Web Mercator, for the last complete UTC
    /// day.
    Gibs(&'static str),
}

/// One raster layer: its source, the levels it holds and how long a tile is
/// fresh.
#[derive(Debug)]
pub struct Spec {
    /// The store key's name; stable, so kept tiles stay valid.
    pub id: &'static str,
    pub source: Source,
    /// Below this level the layer draws nothing.
    pub min_zoom: u8,
    /// The finest level the service holds real tiles for; finer views
    /// stretch them.
    pub max_zoom: u8,
    /// Tile side in pixels as the service sends it.
    pub pixels: u32,
    pub ttl: Duration,
    /// Tiles may be kept for offline use. Display-only imagery (Esri World
    /// Imagery's terms: not cached or re-served) is fetched every time.
    pub kept: bool,
    /// Imagery drawn one level finer on high-density screens (the web's
    /// `sharp` tiles), so a photograph is not softened by the screen.
    pub sharp: bool,
}

const EXPORT_PX: u32 = 256 * EXPORT_DENSITY;

const fn tiles(id: &'static str, url: &'static str, max_zoom: u8) -> Spec {
    Spec { id, source: Source::Tiles(url), min_zoom: 0, max_zoom, pixels: 256, ttl: MONTH, kept: true, sharp: false }
}

const fn export(id: &'static str, endpoint: &'static str, layers: &'static str, zoom: (u8, u8)) -> Spec {
    Spec {
        id,
        source: Source::Export { endpoint, layers, dpi: true },
        min_zoom: zoom.0,
        max_zoom: zoom.1,
        pixels: EXPORT_PX,
        ttl: MONTH,
        kept: true,
        sharp: false,
    }
}

const NOHRSC: &str =
    "https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export";

const fn snow(id: &'static str, layers: &'static str) -> Spec {
    Spec {
        id,
        source: Source::Export { endpoint: NOHRSC, layers, dpi: false },
        min_zoom: 0,
        max_zoom: 14,
        pixels: EXPORT_PX,
        ttl: SIX_HOURS,
        kept: true,
        sharp: false,
    }
}

/// Every raster layer. Ids are the store keys' names and never change.
pub static CATALOGUE: &[Spec] = &[
    // Esri Canvas grey bases (keyless, published for basemap use).
    tiles(
        "light",
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        16,
    ),
    tiles(
        "dark",
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        16,
    ),
    // Labels & reference.
    tiles(
        "hydro",
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}",
        16,
    ),
    tiles(
        "roads",
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
        19,
    ),
    tiles(
        "places",
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        19,
    ),
    tiles(
        "labels-light",
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        16,
    ),
    tiles(
        "labels-dark",
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        16,
    ),
    export(
        "trails",
        "https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/export",
        "37,24",
        (10, 19),
    ),
    export("peaks", "https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/export", "5", (10, 19)),
    export("names", "https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/export", "3", (9, 19)),
    // Geology & hazards. Macrostrat and the landslide cache send 512 px
    // tiles on the standard grid.
    Spec { pixels: 512, ..tiles("geology", "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png", 16) },
    tiles("sgmc", "https://mrdata.usgs.gov/mapcache/wmts/1.0.0/sgmc/default/GoogleMapsCompatible/{z}/{y}/{x}.png", 14),
    export(
        "wageology",
        "https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/100K_Surface_Geology_WA_GeMS/MapServer/export",
        "11",
        (6, 17),
    ),
    export(
        "wafaults",
        "https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/Earthquakes_and_Faults/MapServer/export",
        "12",
        (6, 18),
    ),
    export(
        "wavents",
        "https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/Volcanic_Vents/MapServer/export",
        "0",
        (7, 18),
    ),
    export(
        "usfaults",
        "https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/export",
        "21,22",
        (4, 18),
    ),
    Spec {
        pixels: 512,
        ..tiles(
            "landslide",
            "https://tiles.arcgis.com/tiles/v01gqwM5QqNysAAi/arcgis/rest/services/US_Landslide_Susceptibility/MapServer/tile/{z}/{y}/{x}",
            22,
        )
    },
    export(
        "plateboundaries",
        "https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/export",
        "0,1",
        (1, 12),
    ),
    export("vs30", "https://earthquake.usgs.gov/arcgis/rest/services/eq/vs30_mosaic/MapServer/export", "0", (3, 18)),
    // Conditions.
    snow("snowdepth", "3"),
    snow("swe", "7"),
    Spec {
        id: "snowcover",
        source: Source::Gibs("MODIS_Terra_NDSI_Snow_Cover"),
        min_zoom: 0,
        max_zoom: 8,
        pixels: 256,
        ttl: MONTH,
        kept: true,
        sharp: false,
    },
    // Imagery: reference mosaics drawn beneath a selected scene.
    Spec {
        kept: false,
        sharp: true,
        ..tiles(
            "imagery",
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            19,
        )
    },
    Spec {
        sharp: true,
        ..tiles(
            "s2cloudless",
            "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
            16,
        )
    },
];

/// A raster layer, by its catalogue entry. Equal, hashed and shown by id.
#[derive(Clone, Copy)]
pub struct RasterLayer(&'static Spec);

impl PartialEq for RasterLayer {
    fn eq(&self, other: &Self) -> bool {
        self.0.id == other.0.id
    }
}

impl Eq for RasterLayer {}

impl std::hash::Hash for RasterLayer {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.id.hash(state);
    }
}

impl std::fmt::Debug for RasterLayer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "RasterLayer({})", self.0.id)
    }
}

/// The UTC calendar date of a Unix day (Hinnant's days-to-civil).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

/// The last complete UTC day at `now` (GIBS publishes on a lag, so today's
/// product can be empty for hours), as `YYYY-MM-DD`.
pub fn gibs_day(now: SystemTime) -> String {
    let secs = now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (y, m, d) = civil(secs.div_euclid(86_400) - 1);
    format!("{y:04}-{m:02}-{d:02}")
}

impl RasterLayer {
    /// The layer with this id.
    pub fn by_id(id: &str) -> Option<Self> {
        CATALOGUE.iter().find(|s| s.id == id).map(RasterLayer)
    }

    pub fn id(self) -> &'static str {
        self.0.id
    }

    pub fn spec(self) -> &'static Spec {
        self.0
    }

    pub fn max_zoom(self) -> u8 {
        self.0.max_zoom
    }

    pub fn min_zoom(self) -> u8 {
        self.0.min_zoom
    }

    /// Tile side in pixels.
    pub fn pixels(self) -> u32 {
        self.0.pixels
    }

    /// Drawn one level finer on high-density screens.
    pub fn sharp(self) -> bool {
        self.0.sharp
    }

    /// The tile's address at `now` (which picks a daily product's day).
    pub fn url_at(self, z: u8, x: u32, y: u32, now: SystemTime) -> String {
        let fill =
            |t: &str| t.replace("{z}", &z.to_string()).replace("{x}", &x.to_string()).replace("{y}", &y.to_string());
        match self.0.source {
            Source::Tiles(template) => fill(template),
            Source::Gibs(product) => format!(
                "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{product}/default/{}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
                gibs_day(now)
            ),
            Source::Export { endpoint, layers, dpi } => {
                // The tile's EPSG:3857 bounds: west, south, east, north.
                let half = std::f64::consts::PI * 6_378_137.0;
                let side = 2.0 * half / f64::from(1u32 << z);
                let (west, north) = (f64::from(x) * side - half, half - f64::from(y) * side);
                let px = self.pixels();
                let dpi = if dpi { format!("&dpi={}", 96 * px / 256) } else { String::new() };
                format!(
                    "{endpoint}?bbox={west},{},{},{north}&bboxSR=3857&imageSR=3857\
                     &size={px},{px}&format=png32&transparent=true{dpi}&f=image&layers=show:{layers}",
                    north - side,
                    west + side,
                )
            }
        }
    }

    pub fn url(self, z: u8, x: u32, y: u32) -> String {
        self.url_at(z, x, y, SystemTime::now())
    }

    /// The store key of the tile at `now`; a daily product's day is part of
    /// it, so each day is its own tile.
    pub fn key_at(self, z: u8, x: u32, y: u32, now: SystemTime) -> String {
        match self.0.source {
            Source::Gibs(_) => format!("layer:{}:{}:{z}/{x}/{y}", self.0.id, gibs_day(now)),
            _ => format!("layer:{}:{z}/{x}/{y}", self.0.id),
        }
    }

    pub fn key(self, z: u8, x: u32, y: u32) -> String {
        self.key_at(z, x, y, SystemTime::now())
    }
}

/// One raster layer's answer for a tile.
#[derive(Debug)]
pub enum RasterAnswer {
    /// An encoded PNG or JPEG. `lasting` is false for a kept tile served
    /// after a failed refresh.
    Image { bytes: Vec<u8>, lasting: bool },
    /// The service has nothing here.
    Empty,
    /// Unavailable now; ask again later.
    Retry { after: Duration },
}

pub(crate) fn image(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G']) || bytes.starts_with(&[0xff, 0xd8, 0xff])
}

impl Engine {
    pub async fn raster_tile(self: &Arc<Self>, layer: RasterLayer, z: u8, x: u32, y: u32) -> RasterAnswer {
        if z > layer.max_zoom() || z < layer.min_zoom() || x >= 1 << z || y >= 1 << z {
            return RasterAnswer::Empty;
        }
        let now = SystemTime::now();
        let key = layer.key_at(z, x, y, now);
        if !layer.spec().kept {
            return self.display_tile(layer, z, x, y, now).await;
        }
        if let Ok(Some(hit)) = self.store.get(&key, layer.spec().ttl) {
            return if hit.body.is_empty() {
                RasterAnswer::Empty
            } else {
                RasterAnswer::Image { bytes: hit.body, lasting: true }
            };
        }
        let fetch = FetchRequest::get(layer.url_at(z, x, y, now)).timeout(TIMEOUT).max_body(4 << 20);
        let me = self.clone();
        let k = key.clone();
        let fetched = self
            .layer_flights
            .run(key.clone(), move || async move {
                let r = me.upstream.fetch(fetch).await.ok()?;
                let media = r.header("content-type").unwrap_or("application/octet-stream").to_owned();
                // ArcGIS answers tiles outside its cache with 404.
                let body = match r.status {
                    200 if image(&r.body) => r.body,
                    404 => Vec::new(),
                    _ => return None,
                };
                let _ = me.store.put(&k, Kind::Source, 200, &media, None, &body);
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

impl Engine {
    /// A display-only tile: fetched for the screen, never written to the
    /// store, so it is neither kept offline nor served again.
    async fn display_tile(
        self: &Arc<Self>,
        layer: RasterLayer,
        z: u8,
        x: u32,
        y: u32,
        now: SystemTime,
    ) -> RasterAnswer {
        let fetch = FetchRequest::get(layer.url_at(z, x, y, now)).timeout(TIMEOUT).max_body(4 << 20);
        let me = self.clone();
        let fetched = self
            .layer_flights
            .run(layer.key_at(z, x, y, now), move || async move {
                let r = me.upstream.fetch(fetch).await.ok()?;
                match r.status {
                    200 if image(&r.body) => Some(r.body),
                    404 => Some(Vec::new()),
                    _ => None,
                }
            })
            .await
            .flatten();
        match fetched {
            Some(bytes) if bytes.is_empty() => RasterAnswer::Empty,
            Some(bytes) => RasterAnswer::Image { bytes, lasting: true },
            None => RasterAnswer::Retry { after: Duration::from_secs(5) },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDS: [&str; 23] = [
        "light",
        "dark",
        "hydro",
        "roads",
        "places",
        "labels-light",
        "labels-dark",
        "trails",
        "peaks",
        "names",
        "geology",
        "sgmc",
        "wageology",
        "wafaults",
        "wavents",
        "usfaults",
        "landslide",
        "plateboundaries",
        "vs30",
        "snowdepth",
        "swe",
        "imagery",
        "s2cloudless",
    ];

    #[test]
    fn every_id_resolves_once() {
        for id in IDS.iter().chain(&["snowcover"]) {
            let layer = RasterLayer::by_id(id).unwrap_or_else(|| panic!("{id}"));
            assert_eq!(layer.id(), *id);
            assert_eq!(CATALOGUE.iter().filter(|s| s.id == *id).count(), 1);
        }
        assert_eq!(CATALOGUE.len(), IDS.len() + 1);
        assert!(RasterLayer::by_id("nope").is_none());
    }

    #[test]
    fn urls_and_keys_are_exact() {
        let now = UNIX_EPOCH + Duration::from_secs(1_793_577_600); // 2026-11-02T00:00Z
        let roads = RasterLayer::by_id("roads").unwrap();
        assert_eq!(
            roads.url_at(10, 164, 357, now),
            "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/10/357/164"
        );
        assert_eq!(roads.key_at(10, 164, 357, now), "layer:roads:10/164/357");
        let geology = RasterLayer::by_id("geology").unwrap();
        assert_eq!(geology.url_at(10, 164, 357, now), "https://tiles.macrostrat.org/carto/10/164/357.png");
        assert_eq!(geology.pixels(), 512);
        // The western hemisphere's north-east quarter at z1: x 0, y 0.
        let faults = RasterLayer::by_id("wafaults").unwrap();
        assert_eq!(
            faults.url_at(1, 0, 0, now),
            "https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/Earthquakes_and_Faults/MapServer/export\
             ?bbox=-20037508.342789244,0,0,20037508.342789244&bboxSR=3857&imageSR=3857&size=512,512\
             &format=png32&transparent=true&dpi=192&f=image&layers=show:12"
        );
        let depth = RasterLayer::by_id("snowdepth").unwrap();
        assert_eq!(
            depth.url_at(1, 0, 0, now),
            "https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export\
             ?bbox=-20037508.342789244,0,0,20037508.342789244&bboxSR=3857&imageSR=3857&size=512,512\
             &format=png32&transparent=true&f=image&layers=show:3"
        );
        assert_eq!(depth.spec().ttl, SIX_HOURS);
        let cover = RasterLayer::by_id("snowcover").unwrap();
        assert_eq!(
            cover.url_at(5, 5, 11, now),
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDSI_Snow_Cover/default/2026-11-01\
             /GoogleMapsCompatible_Level8/5/11/5.png"
        );
        assert_eq!(cover.key_at(5, 5, 11, now), "layer:snowcover:2026-11-01:5/5/11");
    }

    #[test]
    fn gibs_day_is_the_last_complete_utc_day() {
        let at = |secs: u64| gibs_day(UNIX_EPOCH + Duration::from_secs(secs));
        assert_eq!(at(1_793_577_600 - 1), "2026-10-31");
        assert_eq!(at(1_793_577_600), "2026-11-01");
        // Across a year and a leap day.
        assert_eq!(at(1_767_225_600), "2025-12-31"); // 2026-01-01T00:00Z
        assert_eq!(at(1_709_251_200), "2024-02-29"); // 2024-03-01T00:00Z
    }
}
