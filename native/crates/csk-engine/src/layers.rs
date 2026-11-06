//! Raster map layers for the native map: the cartographic basemap (light and
//! dark) and the reference overlays of "Labels & reference" (app/overlays.js):
//! cached tile services, and ArcGIS dynamic services exported one tile at a
//! time in the tile's own Web Mercator bounds, at display density. Tiles are
//! kept in the engine's store, so a map viewed once keeps drawing offline;
//! after a failed refresh the kept tile is served and asked for again later.

use std::sync::Arc;
use std::time::Duration;

use csk_store::Kind;

use crate::Engine;
use crate::transport::FetchRequest;

/// Refreshed after this; served (as stale) for as long as it is kept.
const TTL: Duration = Duration::from_secs(30 * 24 * 3600);
const KEPT: Duration = Duration::from_secs(10 * 365 * 24 * 3600);
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RasterLayer {
    /// Esri Canvas light grey base (keyless, published for basemap use).
    LightBase,
    DarkBase,
    /// USGS The National Map hydrography cache (NHD), transparent PNG.
    Hydro,
    /// Esri reference overlays.
    Roads,
    Places,
    LightLabels,
    DarkLabels,
    /// USGS National Map trails (layers 37, 24), exported.
    Trails,
    /// USGS GNIS summits and landforms (layer 5), exported.
    Peaks,
    /// USGS GNIS named places (layer 3), exported.
    Names,
}

const ESRI: &str = "https://services.arcgisonline.com/ArcGIS/rest/services";
const CARTO: &str = "https://carto.nationalmap.gov/arcgis/rest/services";
/// Export tiles are drawn at twice the CSS tile size, as the web does on
/// high-density screens (its ceiling of 3x would triple memory for little).
pub const EXPORT_DENSITY: u32 = 2;

impl RasterLayer {
    /// The finest level the service holds real tiles for; finer views
    /// stretch them.
    pub fn max_zoom(self) -> u8 {
        match self {
            RasterLayer::LightBase
            | RasterLayer::DarkBase
            | RasterLayer::Hydro
            | RasterLayer::LightLabels
            | RasterLayer::DarkLabels => 16,
            _ => 19,
        }
    }

    /// Below this level the layer draws nothing.
    pub fn min_zoom(self) -> u8 {
        match self {
            RasterLayer::Trails | RasterLayer::Peaks => 10,
            RasterLayer::Names => 9,
            _ => 0,
        }
    }

    /// Tile side in pixels.
    pub fn pixels(self) -> u32 {
        if self.export().is_some() { 256 * EXPORT_DENSITY } else { 256 }
    }

    /// The dynamic service and its layers, for exported layers.
    fn export(self) -> Option<(&'static str, &'static str)> {
        match self {
            RasterLayer::Trails => Some(("transportation", "37,24")),
            RasterLayer::Peaks => Some(("geonames", "5")),
            RasterLayer::Names => Some(("geonames", "3")),
            _ => None,
        }
    }

    fn url(self, z: u8, x: u32, y: u32) -> String {
        if let Some((service, layers)) = self.export() {
            // The tile's EPSG:3857 bounds: west, south, east, north.
            let half = std::f64::consts::PI * 6_378_137.0;
            let side = 2.0 * half / f64::from(1u32 << z);
            let (west, north) = (f64::from(x) * side - half, half - f64::from(y) * side);
            let px = self.pixels();
            return format!(
                "{CARTO}/{service}/MapServer/export?bbox={west},{},{},{north}&bboxSR=3857&imageSR=3857\
                 &size={px},{px}&format=png32&transparent=true&dpi={}&f=image&layers=show:{layers}",
                north - side,
                west + side,
                96 * EXPORT_DENSITY,
            );
        }
        // ArcGIS tile order is level/row/column.
        match self {
            RasterLayer::Roads => format!("{ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"),
            RasterLayer::Places => format!("{ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"),
            RasterLayer::LightLabels => format!("{ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"),
            RasterLayer::DarkLabels => format!("{ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"),
            RasterLayer::Trails | RasterLayer::Peaks | RasterLayer::Names => unreachable!("exported"),
            RasterLayer::LightBase => format!(
                "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            ),
            RasterLayer::DarkBase => format!(
                "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            ),
            RasterLayer::Hydro => format!(
                "https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}"
            ),
        }
    }

    fn key(self, z: u8, x: u32, y: u32) -> String {
        let name = match self {
            RasterLayer::LightBase => "light",
            RasterLayer::DarkBase => "dark",
            RasterLayer::Hydro => "hydro",
            RasterLayer::Roads => "roads",
            RasterLayer::Places => "places",
            RasterLayer::LightLabels => "labels-light",
            RasterLayer::DarkLabels => "labels-dark",
            RasterLayer::Trails => "trails",
            RasterLayer::Peaks => "peaks",
            RasterLayer::Names => "names",
        };
        format!("layer:{name}:{z}/{x}/{y}")
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

fn image(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G']) || bytes.starts_with(&[0xff, 0xd8, 0xff])
}

impl Engine {
    pub async fn raster_tile(self: &Arc<Self>, layer: RasterLayer, z: u8, x: u32, y: u32) -> RasterAnswer {
        if z > layer.max_zoom() || z < layer.min_zoom() || x >= 1 << z || y >= 1 << z {
            return RasterAnswer::Empty;
        }
        let key = layer.key(z, x, y);
        if let Ok(Some(hit)) = self.store.get(&key, TTL) {
            return if hit.body.is_empty() {
                RasterAnswer::Empty
            } else {
                RasterAnswer::Image { bytes: hit.body, lasting: true }
            };
        }
        let fetch = FetchRequest::get(layer.url(z, x, y)).timeout(TIMEOUT).max_body(4 << 20);
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
