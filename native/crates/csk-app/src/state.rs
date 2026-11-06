//! What a person has chosen, as the app keeps and restores it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::render::{Lighting, Look};
use crate::terrain::{Fit, Studio, catalog};

/// The look a fresh launch shows (docs/native/PROGRESS.md, prototype).
pub const LAUNCH_LOOK: &str = "swiss";
/// Rivers & lakes opacity on a fresh launch, percent.
pub const LAUNCH_WATER_OPACITY: f64 = 5.0;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TerrainState {
    /// A style id, or "off".
    pub style: String,
    /// Terrain opacity, percent.
    pub opacity: f64,
    /// Brightness, contrast and saturation, percent.
    pub look: Look,
    pub lighting: Lighting,
    /// Vertical exaggeration for 3D relief, percent.
    pub exaggeration: f64,
    /// "auto", "3dep" or "usgs1m".
    pub source: String,
    pub studio: Studio,
}

impl Default for TerrainState {
    fn default() -> Self {
        let mut terrain = Self {
            style: "hs".into(),
            opacity: 70.0,
            look: Look::default(),
            lighting: Lighting::default(),
            exaggeration: 125.0,
            source: "auto".into(),
            studio: Studio::default(),
        };
        terrain.apply_look(LAUNCH_LOOK);
        terrain
    }
}

impl TerrainState {
    /// Applies a built-in look: its scene and its opacity.
    pub fn apply_look(&mut self, id: &str) -> bool {
        let Some(look) = catalog().look(id) else { return false };
        self.style = self.studio.apply_scene(&look.scene, Some(&look.id));
        self.opacity = look.opacity;
        true
    }
}

/// The live-alert filters (app/overlays.js `alertPrefs`). Which feeds are
/// on is the overlays' own state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Alerts {
    /// Ask NWS for the view only, and count what is in view.
    pub viewport: bool,
    /// "all", "watch" or "warning".
    pub nws_severity: String,
    /// "hour", "day", "week" or "month".
    pub quake_age: String,
    /// -1 for every detected event.
    pub quake_mag: f64,
    /// NWS alert types by category (vectors.rs `nws_category`).
    pub types: BTreeMap<String, bool>,
}

/// The NWS alert type switches, in the web's order.
pub const ALERT_TYPES: [(&str, &str); 6] = [
    ("storm", "Storm & flood"),
    ("winter", "Winter & avalanche"),
    ("fire", "Fire & smoke"),
    ("coast", "Coast & marine"),
    ("temperature", "Heat, cold & air"),
    ("other", "Other public alerts"),
];

impl Default for Alerts {
    fn default() -> Self {
        Self {
            viewport: true,
            nws_severity: "all".into(),
            quake_age: "week".into(),
            quake_mag: -1.0,
            types: ALERT_TYPES.iter().map(|(k, _)| ((*k).to_owned(), true)).collect(),
        }
    }
}

impl Alerts {
    pub fn quake_age(&self) -> &str {
        match self.quake_age.as_str() {
            age @ ("hour" | "day" | "week" | "month") => age,
            _ => "week",
        }
    }

    fn normalize(&mut self) {
        if !["all", "watch", "warning"].contains(&self.nws_severity.as_str()) {
            self.nws_severity = "all".into();
        }
        self.quake_age = self.quake_age().to_owned();
        if ![-1.0, 1.0, 2.5, 4.0, 5.5].contains(&self.quake_mag) {
            self.quake_mag = -1.0;
        }
        for (k, _) in ALERT_TYPES {
            self.types.entry(k.into()).or_insert(true);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Overlay {
    pub on: bool,
    /// Percent.
    pub opacity: f64,
}

impl AppState {
    /// Preferences only: terrain, coloring, active layers and camera content stay.
    pub fn reset_preferences(&mut self) {
        self.appearance = crate::appearance::Appearance::default();
        self.dock_order.clear();
        self.layer_order =
            vec!["overlay:water".into(), "elevation-bands".into(), "elevation-spectrum".into(), "terrain".into()];
        for o in crate::overlays::OVERLAYS {
            if o.drawn() && o.id != "water" && self.overlay(o.id).on {
                self.layer_order.insert(0, format!("overlay:{}", o.id));
            }
        }
    }

    pub fn normalize(&mut self) {
        self.alerts.normalize();
        self.line_widths.retain(|id, _| crate::vectors::spec(id).is_some_and(|s| s.line_width.is_some()));
        self.slices.retain(|id, _| crate::vectors::spec(id).is_some_and(|s| s.slice.is_some()));
        self.elevation.normalize();
        self.appearance.normalize();
        for (id, on) in [("elevation-spectrum", self.elevation.on), ("elevation-bands", self.elevation.bands_on())] {
            if on && !self.layer_order.iter().any(|l| l == id) {
                self.layer_order.insert(0, id.into());
            }
        }
    }

    /// An overlay's state: off at the default opacity until set.
    pub fn overlay(&self, id: &str) -> Overlay {
        self.overlays.get(id).copied().unwrap_or(Overlay { on: false, opacity: Self::default_opacity(id) })
    }

    /// An overlay's opacity on a fresh launch: the catalogue's, except Rivers
    /// & lakes, which the launch view shows faintly.
    pub fn default_opacity(id: &str) -> f64 {
        if id == "water" {
            return LAUNCH_WATER_OPACITY;
        }
        crate::overlays::find(id).map_or(crate::overlays::DEFAULT_OPACITY, |o| o.default_opacity)
    }

    /// A vector overlay's line width (CSS px), if it offers one.
    pub fn line_width(&self, id: &str) -> Option<f64> {
        let spec = crate::vectors::spec(id)?.line_width?;
        Some(self.line_widths.get(id).copied().unwrap_or(spec.default).clamp(spec.min, spec.max))
    }

    /// A time-sliced overlay's slice, if it has one.
    pub fn slice(&self, id: &str) -> Option<f64> {
        let spec = crate::vectors::spec(id)?.slice?;
        Some(spec.snap(self.slices.get(id).copied().unwrap_or(spec.default)))
    }

    /// Turns an overlay on or off; one turned on joins the top of the order.
    pub fn set_overlay(&mut self, id: &str, on: bool) {
        let mut overlay = self.overlay(id);
        overlay.on = on;
        self.overlays.insert(id.to_owned(), overlay);
        let key = format!("overlay:{id}");
        if on && !self.layer_order.contains(&key) {
            self.layer_order.insert(0, key);
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppState {
    /// "", "light" or "dark".
    pub theme: String,
    pub terrain: TerrainState,
    pub elevation: crate::elevation::Elevation,
    pub appearance: crate::appearance::Appearance,
    /// Reference overlays by id (overlays.rs), once the person has set them.
    pub overlays: BTreeMap<String, Overlay>,
    /// Map layers, top first.
    pub layer_order: Vec<String>,
    /// Dock tool ids, in the person's order.
    pub dock_order: Vec<String>,
    pub alerts: Alerts,
    /// Vector overlays' line widths (CSS px), once set.
    pub line_widths: BTreeMap<String, f64>,
    /// Time-sliced overlays' slices, once set.
    pub slices: BTreeMap<String, f64>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            theme: String::new(),
            terrain: TerrainState::default(),
            elevation: crate::elevation::Elevation::default(),
            appearance: crate::appearance::Appearance::default(),
            overlays: BTreeMap::from([("water".into(), Overlay { on: true, opacity: LAUNCH_WATER_OPACITY })]),
            layer_order: vec!["overlay:water".into(), "terrain".into()],
            dock_order: Vec::new(),
            alerts: Alerts::default(),
            line_widths: BTreeMap::new(),
            slices: BTreeMap::new(),
        }
    }
}

/// View-dependent state that is never saved: ranges fitted to the view.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Fitted {
    pub ranges: BTreeMap<String, Fit>,
    /// Map-centre elevation in metres, from the last view sample.
    pub center: Option<f64>,
    /// Platform version/build, supplied at startup; never persisted in a view document.
    pub build: Option<String>,
    /// Flat relative-elevation floors (the view's low elevation, and over
    /// land only), where the derived floor field has no value.
    pub rem_floor: Option<f64>,
    pub rem_land_floor: Option<f64>,
    /// Vector overlays' loading state, by id ("Loading", "12 in view").
    pub vector_status: BTreeMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resetting_preferences_preserves_map_content_and_keeps_all_active_layers() {
        let mut s = AppState { theme: "dark".into(), ..AppState::default() };
        s.terrain.apply_look("missoula");
        s.set_overlay("snowdepth", true);
        s.elevation.below.on = true;
        s.normalize();
        let terrain = s.terrain.clone();
        let elevation = s.elevation.clone();
        let overlays = s.overlays.clone();
        s.appearance.act("appearance:preset:ocean", &serde_json::Value::Null);
        s.dock_order = vec!["snapshot".into()];
        s.layer_order.reverse();
        s.reset_preferences();
        assert_eq!(s.terrain, terrain);
        assert_eq!(s.elevation, elevation);
        assert_eq!(s.overlays, overlays);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.appearance, crate::appearance::Appearance::default());
        assert!(s.dock_order.is_empty());
        assert!(s.layer_order.contains(&"overlay:snowdepth".into()));
        assert!(s.layer_order.contains(&"elevation-bands".into()));
    }
}
