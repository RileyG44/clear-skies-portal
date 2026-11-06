//! The reference overlays of "Labels & reference" (app/overlays.js), in the
//! page's order, and the raster layers that draw them.

use csk_engine::layers::RasterLayer;

pub struct Info {
    pub id: &'static str,
    pub name: &'static str,
    /// Who publishes it (the layer list's detail, and the sources list).
    pub via: &'static str,
    /// The swatch colour.
    pub color: &'static str,
}

pub const OVERLAYS: [Info; 7] = [
    Info { id: "roads", name: "Roads & streets", via: "Esri", color: "#e0a060" },
    Info { id: "trails", name: "Trails & paths", via: "USGS", color: "#d2691e" },
    Info { id: "places", name: "Cities & boundaries", via: "Esri", color: "#9fb4d0" },
    Info { id: "labels", name: "Place labels", via: "Esri", color: "#d8dee8" },
    Info { id: "water", name: "Rivers & lakes", via: "USGS NHD", color: "#5aa9e6" },
    Info { id: "peaks", name: "Peaks & landforms", via: "USGS GNIS", color: "#c9a227" },
    Info { id: "gnames", name: "Named places", via: "USGS GNIS", color: "#b0894f" },
];

/// An overlay's opacity until the person sets one (the web's overlay
/// opacity control starts at 90%).
pub const DEFAULT_OPACITY: f64 = 90.0;

pub fn info(id: &str) -> Option<&'static Info> {
    OVERLAYS.iter().find(|o| o.id == id)
}

/// The raster layer drawing an overlay in the map theme, and whether it is
/// muted (greyscale, brightened) there, as the web reads hydrography on a
/// dark basemap.
pub fn raster(id: &str, dark: bool) -> Option<(RasterLayer, bool)> {
    Some(match id {
        "roads" => (RasterLayer::Roads, false),
        "trails" => (RasterLayer::Trails, false),
        "places" => (RasterLayer::Places, false),
        "labels" => (if dark { RasterLayer::DarkLabels } else { RasterLayer::LightLabels }, false),
        "water" => (RasterLayer::Hydro, dark),
        "peaks" => (RasterLayer::Peaks, false),
        "gnames" => (RasterLayer::Names, false),
        _ => return None,
    })
}
