//! The reference overlays (app/overlays.js), in the web's page order, and the
//! raster or vector layers (vectors.rs) that draw them.

use csk_engine::layers::RasterLayer;

/// The page an overlay belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    Labels,
    Geology,
    Conditions,
    Past,
    /// Reference imagery & coverage, on the Satellite imagery page.
    Imagery,
}

impl Group {
    pub const ALL: [Group; 5] = [Group::Labels, Group::Geology, Group::Conditions, Group::Past, Group::Imagery];

    /// The web's group name (the layer list's detail).
    pub fn name(self) -> &'static str {
        match self {
            Group::Labels => "Labels & reference",
            Group::Geology => "Geology & hazards",
            Group::Conditions => "Conditions",
            Group::Past => "Past landscapes",
            Group::Imagery => "Imagery",
        }
    }

    /// The route whose page lists the group.
    pub fn route(self) -> &'static str {
        match self {
            Group::Labels => "labels",
            Group::Geology => "geology",
            Group::Conditions => "conditions",
            Group::Past => "past",
            Group::Imagery => "satellite",
        }
    }

    /// The title of the page's layer list.
    pub fn pane(self) -> &'static str {
        match self {
            Group::Labels => "Reference layers",
            Group::Geology => "Geology layers",
            Group::Conditions => "Conditions layers",
            Group::Past => "Past landscape layers",
            Group::Imagery => "Reference imagery & coverage",
        }
    }

    pub fn for_route(route: &str) -> Option<Group> {
        Group::ALL.into_iter().find(|g| g.route() == route)
    }
}

/// The engine layer drawing an overlay.
#[derive(Clone, Copy, Debug)]
pub enum Raster {
    One(&'static str),
    /// Light and dark variants that follow the map theme.
    Themed {
        light: &'static str,
        dark: &'static str,
    },
}

pub struct Info {
    pub id: &'static str,
    pub name: &'static str,
    /// Who publishes it (the layer list's detail, and the sources list).
    pub via: &'static str,
    /// The swatch colour.
    pub color: &'static str,
    pub group: Group,
    /// What the layer is and is not, from its publisher.
    pub note: Option<&'static str>,
    /// Percent, until the person sets one.
    pub default_opacity: f64,
    /// The raster layer drawing it; None for vector overlays.
    pub raster: Option<Raster>,
    /// Drawn from features (vectors.rs).
    pub vector: bool,
    /// Listed on its group's page. Active fires are switched from the
    /// live-alert controls, as on the web.
    pub listed: bool,
    /// Drawn greyscale and brightened on the dark map, as the web reads
    /// hydrography on a dark basemap.
    pub muted_dark: bool,
}

/// The web's overlay opacity when the catalogue sets none.
pub const DEFAULT_OPACITY: f64 = 90.0;

const fn info(id: &'static str, name: &'static str, via: &'static str, color: &'static str, group: Group) -> Info {
    Info {
        id,
        name,
        via,
        color,
        group,
        note: None,
        default_opacity: DEFAULT_OPACITY,
        raster: Some(Raster::One(id)),
        vector: false,
        listed: true,
        muted_dark: false,
    }
}

impl Info {
    /// Whether the app draws it.
    pub fn drawn(&self) -> bool {
        self.raster.is_some() || self.vector
    }
}

const fn layer(base: Info, opacity: f64, note: &'static str) -> Info {
    Info { default_opacity: opacity, note: Some(note), ..base }
}

const fn vector(base: Info, opacity: f64, note: &'static str) -> Info {
    Info { raster: None, vector: true, default_opacity: opacity, note: Some(note), ..base }
}

use Group::{Conditions, Geology, Imagery, Labels, Past};

pub static OVERLAYS: &[Info] = &[
    // Labels & reference.
    info("roads", "Roads & streets", "Esri", "#e0a060", Labels),
    info("trails", "Trails & paths", "USGS", "#d2691e", Labels),
    info("places", "Cities & boundaries", "Esri", "#9fb4d0", Labels),
    Info {
        raster: Some(Raster::Themed { light: "labels-light", dark: "labels-dark" }),
        ..info("labels", "Place labels", "Esri", "#d8dee8", Labels)
    },
    Info {
        raster: Some(Raster::One("hydro")),
        muted_dark: true,
        note: Some("USGS NHD hydrography from The National Map's cached tiles, kept on this device once viewed."),
        ..info("water", "Rivers & lakes", "USGS NHD", "#5aa9e6", Labels)
    },
    info("peaks", "Peaks & landforms", "USGS GNIS", "#c9a227", Labels),
    Info { raster: Some(Raster::One("names")), ..info("gnames", "Named places", "USGS GNIS", "#b0894f", Labels) },
    // Past landscapes.
    vector(
        info("waice", "Continental ice limits", "WGS · 1:250k", "#7ed9ee", Past),
        80.0,
        "Mapped late-Wisconsinan and older continental ice limits at 1:250,000; reference linework, not present-day ice.",
    ),
    vector(
        info("waflood", "Ice Age flood extent", "WGS", "#35bdd5", Past),
        42.0,
        "Regional affected-area reference only—not flood depth, timing, frequency, or a parcel-scale boundary.",
    ),
    vector(
        info("paleolakes", "Pleistocene lakes", "EWU · IAFI", "#6aaeff", Past),
        48.0,
        "Interpretive EWU/IAFI reconstruction using circa-2010 lake boundaries; not an observed water-depth or age surface.",
    ),
    vector(
        info("nadi1ice", "Cordilleran ice by age", "NADI-1 · 25–10.5 ka", "#cfeefa", Past),
        85.0,
        "NADI-1 reconstruction in thousands of calendar years before present. A continental-scale synthesis — use the \
         WGS ice limits for mapped local detail.",
    ),
    // Geology & hazards.
    layer(
        info("geology", "Surface geology", "Macrostrat", "#c98f6a", Geology),
        55.0,
        "Blends source maps at several scales for visual context; identify a point to see every contributing \
         compilation and cite its original source.",
    ),
    Info { default_opacity: 55.0, ..info("sgmc", "State geologic map", "USGS", "#b06a5a", Geology) },
    layer(
        info("wageology", "WA surface geology", "WGS · DS-18", "#c69b67", Geology),
        52.0,
        "Gapless statewide WGS compilation intended for about 1:100,000 display and regional interpretation.",
    ),
    layer(
        info("wafaults", "WA active faults", "WGS · DDS-1", "#f05a54", Geology),
        86.0,
        "Reconnaissance/regional fault compilation; do not measure a site-specific setback distance from this linework.",
    ),
    layer(
        info("wavents", "WA volcanic vents", "WGS", "#f28c45", Geology),
        90.0,
        "Mapped eruptive centers classified by age; reference locations, not volcanic hazard zones.",
    ),
    layer(
        info("usfaults", "US faults & folds", "USGS", "#ff5b57", Geology),
        90.0,
        "National reconnaissance reference, including mapped fault areas; not a site-specific setback, recurrence, \
         or rupture-hazard determination.",
    ),
    // Conditions (live feeds).
    vector(
        info("weatheralerts", "Active weather hazards", "NOAA/NWS · 5 min", "#ff5b68", Conditions),
        90.0,
        "Official NWS watches, warnings, advisories, and public-safety statements. Boundaries and text can be revised \
         as an event develops.",
    ),
    vector(
        info("earthquakes", "Earthquakes", "USGS · 5 min", "#ff8d5b", Conditions),
        94.0,
        "Preliminary real-time locations; marker size follows magnitude and color follows reported depth. Event \
         values can be revised.",
    ),
    vector(
        info("volcanostatus", "Volcano status", "USGS VSC · 15 min", "#f26b54", Conditions),
        94.0,
        "Current observatory status markers, not hazard-zone boundaries.",
    ),
    // Geology & hazards, continued.
    layer(
        info("landslide", "Landslide susceptibility", "USGS", "#b78a55", Geology),
        62.0,
        "Broad susceptibility screening, not a forecast or parcel-scale slope-stability assessment.",
    ),
    layer(
        info("plateboundaries", "Plate boundaries", "USGS", "#bb7cff", Geology),
        84.0,
        "Generalized plate and microplate boundaries for regional tectonic context; line placement is not a survey \
         boundary.",
    ),
    layer(
        info("vs30", "Vs30 site conditions", "USGS", "#65a8dd", Geology),
        58.0,
        "Near-surface shear-wave velocity proxy for seismic site conditions. It is not lithology, bedrock depth, or a \
         substitute for field measurements.",
    ),
    vector(
        info("waarchaeology", "WA archaeology index", "agency + academic", "#d6a6ff", Past),
        96.0,
        "A public-safe research index, not Washington's protected inventory. Every marker states its precision, \
         uncertainty, access limits, and source.",
    ),
    // Imagery: reference mosaics beneath a selected scene, and coverage.
    layer(
        info("imagery", "Satellite imagery", "Esri", "#7d8f6a", Imagery),
        DEFAULT_OPACITY,
        "Best-available global mosaic, sub-metre over most populated land. Display only under Esri's terms: not \
         cached or re-served.",
    ),
    layer(
        info("s2cloudless", "Sentinel-2 cloudless", "EOX", "#6a86a8", Imagery),
        DEFAULT_OPACITY,
        "Cloud-free 33 ft composite for 2024, complete over all land. Coarser than the Esri mosaic but never \
         cloudy and never missing.",
    ),
    vector(
        info("maxarvhr", "Maxar VHR coverage", "Maxar Open Data", "#c88fb0", Imagery),
        DEFAULT_OPACITY,
        "Outlines where 12–20 inch disaster imagery exists. Tap one for its dates and the download collection. \
         Licensed CC-BY-NC-4.0 — non-commercial use only.",
    ),
    // Conditions: active fires (app/map-menu.js), from the live-alert controls.
    Info {
        listed: false,
        ..vector(
            info("fires", "Active fires", "NIFC live perimeter feed", "#f85149", Conditions),
            100.0,
            "Current interagency fire perimeters and incident locations; perimeters lag the fire line and can be \
             revised.",
        )
    },
    // Conditions: snow.
    layer(
        info("snowdepth", "Snow depth", "NOHRSC", "#7fc4ff", Conditions),
        70.0,
        "Modeled snow depth in inches at about 0.6 mile resolution across CONUS; NOAA refreshes the analysis four \
         times daily.",
    ),
    layer(
        info("swe", "Snow water equivalent", "NOHRSC", "#4f8fd0", Conditions),
        70.0,
        "Modeled liquid-water content of the snowpack in inches at about 0.6 mile resolution; not a point measurement.",
    ),
    layer(
        info("snowcover", "Snow cover", "NASA GIBS", "#cfe9ff", Conditions),
        65.0,
        "The last complete day's MODIS Terra pass; finer views enlarge its 1,640 ft native level.",
    ),
];

pub fn find(id: &str) -> Option<&'static Info> {
    OVERLAYS.iter().find(|o| o.id == id)
}

/// A group's overlays, in page order.
pub fn in_group(group: Group) -> impl Iterator<Item = &'static Info> {
    OVERLAYS.iter().filter(move |o| o.group == group)
}

/// The raster layer drawing an overlay in the map theme, and whether it is
/// muted there. None for overlays not drawn natively.
pub fn raster(id: &str, dark: bool) -> Option<(RasterLayer, bool)> {
    let info = find(id)?;
    let layer = match info.raster? {
        Raster::One(id) => id,
        Raster::Themed { light, dark: night } => {
            if dark {
                night
            } else {
                light
            }
        }
    };
    Some((RasterLayer::by_id(layer)?, info.muted_dark && dark))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_raster_overlay_resolves_in_both_themes() {
        for o in OVERLAYS {
            for dark in [false, true] {
                assert_eq!(raster(o.id, dark).is_some(), o.raster.is_some(), "{}", o.id);
                assert!(o.drawn(), "{}", o.id);
                assert_eq!(o.vector, crate::vectors::spec(o.id).is_some(), "{}", o.id);
            }
        }
        assert_eq!(raster("labels", true).unwrap().0.id(), "labels-dark");
        assert!(raster("water", true).unwrap().1 && !raster("water", false).unwrap().1);
        let ids: std::collections::HashSet<_> = OVERLAYS.iter().map(|o| o.id).collect();
        assert_eq!(ids.len(), OVERLAYS.len());
    }
}
