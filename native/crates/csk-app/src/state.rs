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

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Overlay {
    pub on: bool,
    /// Percent.
    pub opacity: f64,
}

impl AppState {
    pub fn normalize(&mut self) {
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
        }
    }
}

/// View-dependent state that is never saved: ranges fitted to the view.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Fitted {
    pub ranges: BTreeMap<String, Fit>,
    /// Map-centre elevation in metres, from the last view sample.
    pub center: Option<f64>,
    /// Flat relative-elevation floors (the view's low elevation, and over
    /// land only), where the derived floor field has no value.
    pub rem_floor: Option<f64>,
    pub rem_land_floor: Option<f64>,
}
