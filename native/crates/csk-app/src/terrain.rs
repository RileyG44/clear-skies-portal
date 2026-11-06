//! Terrain looks: the palette, style and look catalogue, the studio state a
//! person edits (a base layer per style, overlays, effects), and the shader
//! stack compiled from it.
//!
//! The catalogue is content generated from the web client's `lidar-render.js`
//! at build time (`native/shaders/extract.cjs`). The rules here are the native
//! implementation of that file's layer model, pinned by its parity cases.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// A colour stop: position 0..1 and `#rrggbb[aa]`.
pub type Stop = (f64, String);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub style: String,
    pub palette: String,
    pub stops: Option<Vec<Stop>>,
    pub reverse: bool,
    pub opacity: f64,
    pub blend: String,
    pub auto: bool,
    pub range_mode: String,
    pub min: f64,
    pub max: f64,
    pub gamma: f64,
    pub steps: u32,
    pub param: f64,
    pub visible: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effects {
    pub detail: f64,
    pub detail_radius: f64,
    pub relief_exag: f64,
    pub rem_radius: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Scene {
    pub style: String,
    pub base: Layer,
    pub overlays: Vec<Layer>,
    pub effects: Effects,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Palette {
    pub name: String,
    pub kinds: Vec<String>,
    pub stops: Vec<Stop>,
    pub domain: Option<[f64; 2]>,
    pub shade: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub label: String,
    pub family: String,
    pub palette: String,
    pub unit: String,
    pub domain: [f64; 2],
    #[serde(default)]
    pub auto: bool,
    pub param: Option<String>,
    pub param_default: Option<f64>,
    pub hint: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Blend {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Look {
    pub id: String,
    pub name: String,
    pub blurb: String,
    /// Terrain opacity the look applies, percent.
    pub opacity: f64,
    pub scene: Scene,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub max_layers: usize,
    pub max_stops: usize,
    pub style_ids: BTreeMap<String, i32>,
    pub blend_ids: BTreeMap<String, i32>,
    pub palettes: BTreeMap<String, Palette>,
    pub styles: BTreeMap<String, Style>,
    pub overlay_styles: Vec<String>,
    pub blends: Vec<Blend>,
    pub effect_defaults: Effects,
    pub looks: Vec<Look>,
}

/// The generated catalogue.
pub fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../shaders/generated/terrain.json"))
            .expect("generated terrain catalogue")
    })
}

/// `#rrggbb[aa]` as RGBA in 0..1.
pub fn parse_hex(value: &str) -> Option<[f64; 4]> {
    let hex = value.trim().trim_start_matches('#');
    if !(hex.len() == 6 || hex.len() == 8) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).map(|b| f64::from(b) / 255.0).ok();
    Some([byte(0)?, byte(2)?, byte(4)?, if hex.len() == 8 { byte(6)? } else { 1.0 }])
}

impl Catalog {
    pub fn style(&self, id: &str) -> Option<&Style> {
        self.styles.get(id)
    }

    pub fn look(&self, id: &str) -> Option<&Look> {
        self.looks.iter().find(|l| l.id == id)
    }

    /// A style's untouched layer.
    pub fn default_layer(&self, style: &str) -> Layer {
        let (id, spec) = match self.styles.get_key_value(style) {
            Some((id, spec)) => (id.as_str(), spec),
            None => ("hs", &self.styles["hs"]),
        };
        let palette = self.palettes.get(&spec.palette);
        let domain = palette.and_then(|p| p.domain).unwrap_or(spec.domain);
        let param = match spec.param.as_deref() {
            Some("shade") => f64::from(palette.and_then(|p| p.shade).is_some_and(|s| s != 0.0)),
            Some("interval") => spec.param_default.unwrap_or(0.0),
            _ => 0.0,
        };
        Layer {
            style: id.to_string(),
            palette: spec.palette.clone(),
            stops: None,
            reverse: false,
            opacity: 1.0,
            blend: "normal".into(),
            auto: spec.auto && palette.is_none_or(|p| p.domain.is_none()),
            range_mode: "separate".into(),
            min: domain[0],
            max: domain[1],
            gamma: 1.0,
            steps: 0,
            param,
            visible: true,
        }
    }

    fn is_default_layer(&self, layer: &Layer, style: &str) -> bool {
        let base = self.default_layer(style);
        layer.style == style
            && layer.palette == base.palette
            && layer.stops.is_none()
            && !layer.reverse
            && layer.opacity == 1.0
            && layer.blend == "normal"
            && layer.range_mode == base.range_mode
            && layer.auto == base.auto
            && layer.min == base.min
            && layer.max == base.max
            && layer.gamma == 1.0
            && layer.steps == 0
            && layer.param == base.param
            && layer.visible
    }

    /// The stops a layer draws with, reversed if asked: [position, r, g, b, a].
    pub fn resolve_stops(&self, layer: &Layer) -> Vec<[f64; 5]> {
        let stops = layer.stops.as_ref().unwrap_or_else(|| {
            &self
                .palettes
                .get(&layer.palette)
                .or_else(|| self.styles.get(&layer.style).and_then(|s| self.palettes.get(&s.palette)))
                .unwrap_or(&self.palettes["default-hs"])
                .stops
        });
        let mut out: Vec<[f64; 5]> = stops
            .iter()
            .filter_map(|(position, colour)| {
                let [r, g, b, a] = parse_hex(colour)?;
                Some([if layer.reverse { 1.0 - position } else { *position }, r, g, b, a])
            })
            .collect();
        out.sort_by(|a, b| a[0].total_cmp(&b[0]));
        out
    }
}

/// A fitted value range for an auto layer: one range, or separate ranges for
/// land, water and inland water.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum Fit {
    Range([f64; 2]),
    Split { land: Option<[f64; 2]>, water: Option<[f64; 2]>, inland: Option<[f64; 2]> },
}

/// One layer of the shader stack.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackLayer {
    pub style: String,
    pub opacity: f64,
    pub blend: String,
    pub stops: Vec<[f64; 5]>,
    pub min: f64,
    pub max: f64,
    pub water: Option<[f64; 2]>,
    pub inland: Option<[f64; 2]>,
    pub separate_rem: bool,
    pub gamma: f64,
    pub steps: u32,
    pub param: f64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stack {
    pub layers: Vec<StackLayer>,
    pub detail: f64,
    pub detail_radius: f64,
    pub relief_exag: f64,
    pub rem_radius: f64,
    pub rem_flat_base: f64,
    pub rem_land_base: f64,
}

/// What a person has built in the terrain studio.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Studio {
    /// Each style's own base layer, once edited or set by a look.
    pub base: BTreeMap<String, Layer>,
    /// Overlays, bottom to top.
    pub overlays: Vec<Layer>,
    pub effects: Effects,
    /// The applied look, until something diverges from it.
    pub look: Option<String>,
}

impl Default for Studio {
    fn default() -> Self {
        Self {
            base: BTreeMap::new(),
            overlays: Vec::new(),
            effects: catalog().effect_defaults,
            look: Some("classic".into()),
        }
    }
}

impl Studio {
    pub fn base_layer(&self, style: &str) -> Layer {
        self.base.get(style).cloned().unwrap_or_else(|| catalog().default_layer(style))
    }

    /// Applying a scene replaces the overlays, effects and its style's base
    /// layer; other styles keep their own saved colours. Returns the style.
    pub fn apply_scene(&mut self, scene: &Scene, look: Option<&str>) -> String {
        self.base.insert(scene.style.clone(), scene.base.clone());
        self.overlays = scene.overlays.iter().take(catalog().max_layers - 1).cloned().collect();
        self.effects = scene.effects;
        self.look = look.map(str::to_owned);
        scene.style.clone()
    }

    /// True when the scene draws exactly like the single-style renderer.
    pub fn is_legacy(&self, style: &str) -> bool {
        let c = catalog();
        if style == "off" || style.is_empty() {
            return true;
        }
        if style == "rem" || c.style(style).is_none() {
            return style != "rem";
        }
        let effects_default = self.effects.detail == 0.0 && self.effects.relief_exag == 1.0;
        !self.overlays.iter().any(|l| l.visible)
            && c.is_default_layer(&self.base_layer(style), style)
            && effects_default
    }

    /// The shader stack for `style` with the view's fitted ranges, or None
    /// for the single-style renderer.
    pub fn build_stack(
        &self,
        style: &str,
        fitted: &BTreeMap<String, Fit>,
        rem_flat_base: f64,
        rem_land_base: Option<f64>,
    ) -> Option<Stack> {
        if self.is_legacy(style) {
            return None;
        }
        let c = catalog();
        let mut list = vec![("base".to_string(), self.base_layer(style))];
        list.extend(self.overlays.iter().enumerate().map(|(i, l)| (format!("overlay:{i}"), l.clone())));
        let mut layers = Vec::new();
        for (key, layer) in list {
            if !layer.visible || layers.len() >= c.max_layers {
                continue;
            }
            let raw = fitted.get(&key);
            let fit = match raw {
                Some(Fit::Range(r)) => Some(*r),
                Some(Fit::Split { land, water, inland }) => land.or(*water).or(*inland),
                None => None,
            };
            let (mut min, mut max) = (layer.min, layer.max);
            if layer.auto
                && let Some([low, high]) = fit
                && low.is_finite()
                && high.is_finite()
                && high > low
            {
                (min, max) = (low, high);
            }
            let split = (layer.style == "tint" || layer.style == "rem") && layer.auto && layer.range_mode == "separate";
            let (water, inland) = match raw {
                Some(Fit::Split { water, inland, .. }) if split => (*water, *inland),
                _ => (None, None),
            };
            let has_param = layer.style == "contour" || c.style(&layer.style).is_some_and(|s| s.param.is_some());
            layers.push(StackLayer {
                stops: c.resolve_stops(&layer),
                style: layer.style.clone(),
                opacity: layer.opacity,
                blend: layer.blend.clone(),
                min,
                max,
                water,
                inland,
                separate_rem: layer.style == "rem" && layer.auto && layer.range_mode == "separate",
                gamma: layer.gamma,
                steps: layer.steps,
                param: if has_param { layer.param } else { 0.0 },
            });
        }
        let e = self.effects;
        Some(Stack {
            layers,
            detail: e.detail,
            detail_radius: e.detail_radius,
            relief_exag: e.relief_exag,
            rem_radius: e.rem_radius,
            rem_flat_base,
            rem_land_base: rem_land_base.unwrap_or(rem_flat_base),
        })
    }
}

/// The value range an auto layer fits to the sampled view: full extrema for
/// elevation, 2-98 percentiles when robust, and 0 to the 60th percentile for
/// relative elevation, rounded outward to a readable unit.
pub fn fit_range(values: &[f64], style: &str, mode: Option<&str>) -> Option<[f64; 2]> {
    let mode = mode.unwrap_or(if style == "tint" { "full" } else { "robust" });
    let mut sorted: Vec<f64> = values.iter().copied().filter(|v| v.is_finite()).collect();
    if sorted.is_empty() {
        return None;
    }
    sorted.sort_by(f64::total_cmp);
    let pick = |q: f64| sorted[(q * (sorted.len() - 1) as f64).round() as usize];
    let low = if style == "rem" {
        0.0
    } else if mode == "robust" {
        pick(0.02)
    } else {
        sorted[0]
    };
    let mut high = if style == "rem" {
        pick(0.6)
    } else if mode == "robust" {
        pick(0.98)
    } else {
        sorted[sorted.len() - 1]
    };
    if high <= low {
        high = low + 1.0;
    }
    let span = high - low;
    let unit = if span > 200.0 {
        10.0
    } else if span > 20.0 {
        1.0
    } else {
        0.1
    };
    Some([(low / unit).floor() * unit, (high / unit).ceil() * unit])
}

impl Fit {
    /// The range a legend or a single-range layer shows.
    pub fn display(&self) -> Option<[f64; 2]> {
        match self {
            Fit::Range(r) => Some(*r),
            Fit::Split { land, water, inland } => land.or(*water).or(*inland),
        }
    }
}

/// Values split by water class (0 land, 1 ocean, 2 inland water) into one
/// fit per class; None when no class has values.
fn split(land: &[f64], water: &[f64], inland: &[f64], land_style: &str) -> Option<Fit> {
    let fit = Fit::Split {
        land: fit_range(land, land_style, None),
        water: fit_range(water, "tint", None),
        inland: if inland.is_empty() { None } else { fit_range(inland, "tint", None) },
    };
    fit.display().map(|_| fit)
}

/// An elevation layer's fit: separate land, ocean and inland-water ranges,
/// or one continuous range in "full" or "robust" mode.
pub fn fit_elevation(values: &[f64], water: &[u8], mode: &str) -> Option<Fit> {
    if mode != "separate" {
        return fit_range(values, "tint", Some(mode)).map(Fit::Range);
    }
    // Classification must align with every height; without it keep one
    // continuous scale rather than guess water from the height's sign.
    if water.len() != values.len() {
        return fit_range(values, "tint", None).map(Fit::Range);
    }
    let (mut land, mut depths, mut inland) = (Vec::new(), Vec::new(), Vec::new());
    for (v, class) in values.iter().zip(water) {
        if v.is_finite() {
            match class {
                0 => land.push(*v),
                2 => inland.push(*v),
                _ => depths.push(*v),
            }
        }
    }
    split(&land, &depths, &inland, "tint")
}

/// A relative-elevation layer's fit: its near-valley contrast over land
/// only, with water keyed by absolute elevation.
pub fn fit_relative(relative: &[f64], heights: &[f64], water: &[u8], mode: &str) -> Option<Fit> {
    if mode != "separate" || water.len() != heights.len() || relative.len() != heights.len() {
        return fit_range(relative, "rem", None).map(Fit::Range);
    }
    let (mut land, mut depths, mut inland) = (Vec::new(), Vec::new(), Vec::new());
    for ((r, h), class) in relative.iter().zip(heights).zip(water) {
        match class {
            0 if r.is_finite() => land.push(*r),
            0 => {}
            2 if h.is_finite() => inland.push(*h),
            _ if h.is_finite() => depths.push(*h),
            _ => {}
        }
    }
    split(&land, &depths, &inland, "rem")
}

/// Ignores small inward endpoint changes while always admitting a newly
/// sampled extreme, so colours hold steady while panning.
pub fn stable_fit(next: Fit, previous: Option<&Fit>) -> Fit {
    let stabilize = |n: Option<[f64; 2]>, p: Option<[f64; 2]>| {
        let (Some(n), Some(p)) = (n, p) else { return n };
        let threshold = (n[1] - n[0]).max(1e-6) * 0.04;
        Some([
            if n[0] < p[0] || n[0] - p[0] > threshold { n[0] } else { p[0] },
            if n[1] > p[1] || p[1] - n[1] > threshold { n[1] } else { p[1] },
        ])
    };
    match (next, previous) {
        (next, None) => next,
        (Fit::Range(n), Some(Fit::Range(p))) => Fit::Range(stabilize(Some(n), Some(*p)).expect("range")),
        (Fit::Range(n), Some(_)) => Fit::Range(n),
        (Fit::Split { land, water, inland }, Some(Fit::Split { land: pl, water: pw, inland: pi })) => Fit::Split {
            land: stabilize(land, *pl),
            water: stabilize(water, *pw),
            inland: inland.and_then(|i| stabilize(Some(i), *pi)),
        },
        // A split stabilized against a single range: the web reads the
        // range's missing class fields, so nothing holds.
        (split @ Fit::Split { .. }, Some(Fit::Range(_))) => split,
    }
}
