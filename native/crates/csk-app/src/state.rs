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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Overlay {
    pub on: bool,
    /// Percent.
    pub opacity: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppState {
    /// "", "light" or "dark".
    pub theme: String,
    pub terrain: TerrainState,
    pub water: Overlay,
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
            water: Overlay { on: true, opacity: LAUNCH_WATER_OPACITY },
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
}
