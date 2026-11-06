//! Raster map layers for the native map: the cartographic basemap (light and
//! dark) and the cached USGS hydrography behind "Rivers & lakes". Tiles are
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
}

impl RasterLayer {
    pub const ALL: [RasterLayer; 3] = [RasterLayer::LightBase, RasterLayer::DarkBase, RasterLayer::Hydro];

    /// The finest level the service holds real tiles for (both caches stop
    /// at z16; finer views stretch them).
    pub fn max_zoom(self) -> u8 {
        16
    }

    fn url(self, z: u8, x: u32, y: u32) -> String {
        // ArcGIS tile order is level/row/column.
        match self {
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
        if z > layer.max_zoom() || x >= 1 << z || y >= 1 << z {
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
