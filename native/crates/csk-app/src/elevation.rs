//! Physical elevation settings, independent of the unit used to edit them.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::render::{Band as RenderBand, Spectrum};
use crate::shell::{group_digits, hint, slider};
use crate::terrain::parse_hex;

pub const FOOT: f64 = 0.3048;
pub const PALETTES: [(&str, &str, [&str; 3]); 6] = [
    ("classic", "Red / white / blue", ["#f85c6c", "#fffffa", "#46a0ff"]),
    ("orange-blue", "Orange / cream / blue", ["#b35806", "#f7f7f7", "#2166ac"]),
    ("terrain", "Forest / sand / snow", ["#24553b", "#d9bd87", "#f4f7ff"]),
    ("ember", "Ember", ["#230d26", "#ec592c", "#fff3b0"]),
    ("glacier", "Glacier", ["#102632", "#348e9b", "#d5ffff"]),
    ("viridis", "Viridis", ["#440154", "#21918c", "#fde725"]),
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Band {
    pub on: bool,
    pub level_m: f64,
    pub color: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Elevation {
    pub on: bool,
    pub level_m: f64,
    pub span_m: f64,
    pub alpha: f64,
    pub colors: [String; 3],
    pub unit: String,
    pub below: Band,
    pub above: Band,
    pub band_alpha: f64,
    pub feather_m: f64,
    pub outline: bool,
}

impl Default for Elevation {
    fn default() -> Self {
        Self {
            on: false,
            level_m: 1100.0 * FOOT,
            span_m: 300.0 * FOOT,
            alpha: 48.0,
            colors: PALETTES[0].2.map(str::to_owned),
            unit: "ft".into(),
            below: Band { on: false, level_m: 1000.0 * FOOT, color: "#f85c6c".into() },
            above: Band { on: false, level_m: 1500.0 * FOOT, color: "#46a0ff".into() },
            band_alpha: 52.0,
            feather_m: 40.0 * FOOT,
            outline: false,
        }
    }
}

/// The web accepts six-digit RGB colours, persisted in lower case.
pub fn color(value: &str) -> Option<String> {
    (value.len() == 7 && value.starts_with('#') && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit))
        .then(|| value.to_ascii_lowercase())
}

pub fn span_position(feet: f64) -> f64 {
    ((feet.clamp(10.0, 20000.0) / 10.0).ln() / 2000f64.ln() * 1000.0).round()
}
pub fn span_from_position(position: f64) -> f64 {
    let feet = (10f64.ln() + position.clamp(0.0, 1000.0) / 1000.0 * 2000f64.ln()).exp();
    [50.0, 150.0, 300.0, 600.0, 1200.0, 2500.0]
        .into_iter()
        .find(|v| (feet - v).abs() / v < 0.025)
        .unwrap_or(feet.round())
}

impl Elevation {
    /// Admission for restored documents/preferences; controls use the same limits.
    pub fn normalize(&mut self) {
        self.level_m = self.level_m.clamp(-500.0, 8850.0);
        self.span_m = self.span_m.clamp(10.0 * FOOT, 20000.0 * FOOT);
        self.alpha = self.alpha.clamp(0.0, 100.0);
        self.band_alpha = self.band_alpha.clamp(0.0, 100.0);
        self.feather_m = self.feather_m.clamp(0.0, 10000.0 * FOOT);
        if !["ft", "m"].contains(&self.unit.as_str()) {
            self.unit = "ft".into();
        }
        let defaults = Self::default();
        for (c, d) in self.colors.iter_mut().zip(defaults.colors) {
            *c = color(c).unwrap_or(d);
        }
        self.below.color = color(&self.below.color).unwrap_or(defaults.below.color);
        self.above.color = color(&self.above.color).unwrap_or(defaults.above.color);
    }
    pub fn factor(&self) -> f64 {
        if self.unit == "m" { 1.0 } else { FOOT }
    }
    pub fn bands_on(&self) -> bool {
        self.below.on || self.above.on
    }
    pub fn palette(&self) -> (&str, &str) {
        PALETTES
            .iter()
            .find(|p| p.2.iter().zip(&self.colors).all(|(a, b)| *a == b))
            .map_or(("custom", "Custom"), |p| (p.0, p.1))
    }
    pub fn height(&self, m: f64) -> String {
        format!("{} {}", group_digits((m / self.factor()).round() as i64), self.unit)
    }
    pub fn spectrum(&self) -> Spectrum {
        let rgb = |c: &str| parse_hex(c).map(|c| [c[0], c[1], c[2]]);
        let band = |b: &Band| RenderBand { enabled: b.on, level: b.level_m, color: rgb(&b.color) };
        Spectrum {
            spectrum_on: self.on,
            level: self.level_m,
            span: self.span_m,
            spectrum_alpha: (255.0 * self.alpha / 100.0).round() / 255.0,
            spectrum_low: rgb(&self.colors[0]).map(|c| c.map(|v| v * 255.0)),
            spectrum_mid: rgb(&self.colors[1]).map(|c| c.map(|v| v * 255.0)),
            spectrum_high: rgb(&self.colors[2]).map(|c| c.map(|v| v * 255.0)),
            below: band(&self.below),
            above: band(&self.above),
            band_alpha: self.band_alpha / 100.0,
            band_feather: self.feather_m,
            outline: self.outline,
            outline_width: 8.0 * FOOT,
        }
    }
    pub fn reset_bands(&mut self) {
        let d = Self::default();
        self.below = d.below;
        self.above = d.above;
        self.band_alpha = d.band_alpha;
        self.feather_m = d.feather_m;
        self.outline = d.outline;
    }
    pub fn act(&mut self, r: &str, value: &Value) -> bool {
        let n = value.as_f64().or_else(|| value.as_str()?.parse().ok()).filter(|v| v.is_finite());
        let c = value.as_str().and_then(color);
        let factor = self.factor();
        // Fields display whole units: resubmitting an unchanged displayed value
        // must keep the exact physical height that produced it.
        let height = |v: f64, old: f64| if (old / factor).round() == v { old } else { v * factor };
        match (r, n) {
            ("#elevSh", _) => self.on = value.as_bool().unwrap_or(!self.on),
            ("#elevBelowOn", _) => self.below.on = value.as_bool().unwrap_or(!self.below.on),
            ("#elevAboveOn", _) => self.above.on = value.as_bool().unwrap_or(!self.above.on),
            ("#elevBandOutline", _) => self.outline = value.as_bool().unwrap_or(!self.outline),
            ("#elevSlide", Some(v)) => self.level_m = v.clamp(-500.0, 8850.0),
            ("#elevVal", Some(v)) => self.level_m = height(v, self.level_m).clamp(-500.0, 8850.0),
            ("#elevSpanSlide", Some(v)) => self.span_m = span_from_position(v) * FOOT,
            ("#elevSpan", Some(v)) => self.span_m = height(v, self.span_m).clamp(10.0 * FOOT, 20000.0 * FOOT),
            ("#elevAlpha", Some(v)) => self.alpha = v.clamp(0.0, 100.0),
            ("#elevBandAlpha", Some(v)) => self.band_alpha = v.clamp(0.0, 100.0),
            ("#elevBelowVal", Some(v)) => self.below.level_m = height(v, self.below.level_m),
            ("#elevAboveVal", Some(v)) => self.above.level_m = height(v, self.above.level_m),
            ("#elevBandFeather", Some(v)) => self.feather_m = height(v, self.feather_m).clamp(0.0, 10000.0 * FOOT),
            ("#elevLowColor", _) if c.is_some() => self.colors[0] = c.unwrap(),
            ("#elevMidColor", _) if c.is_some() => self.colors[1] = c.unwrap(),
            ("#elevHighColor", _) if c.is_some() => self.colors[2] = c.unwrap(),
            ("#elevBelowColor", _) if c.is_some() => self.below.color = c.unwrap(),
            ("#elevAboveColor", _) if c.is_some() => self.above.color = c.unwrap(),
            ("#elevUnit", _) => {
                let Some(unit) = value.as_str().filter(|u| ["ft", "m"].contains(u)) else { return false };
                self.unit = unit.into();
            }
            ("#elevPalette", _) => {
                let Some(p) = PALETTES.iter().find(|p| value == p.0) else { return false };
                self.colors = p.2.map(str::to_owned);
            }
            ("#elevPaletteReverse", _) => self.colors.reverse(),
            ("#elevPaletteReset", _) => self.colors = Self::default().colors,
            ("#elevSpectrumReset", _) => {
                let d = Self::default();
                self.on = false;
                self.level_m = d.level_m;
                self.span_m = d.span_m;
                self.colors = d.colors;
                self.alpha = d.alpha;
            }
            ("#elevBandsReset", _) => self.reset_bands(),
            _ => return false,
        }
        true
    }
}

fn button(r: &str, title: &str) -> Value {
    json!({"kind":"button", "ref":r, "title":title, "role":"link"})
}
fn well(r: &str, title: &str, value: &str) -> Value {
    json!({"kind":"color", "ref":r, "title":title, "value":value})
}
fn field(e: &Elevation, r: &str, title: &str, m: f64) -> Value {
    json!({"kind":"field", "input":"number", "ref":r, "title":title, "value":(m / e.factor()).round(), "step":10, "unit":e.unit})
}

pub fn page(e: &Elevation) -> Value {
    let mut reference =
        slider("#elevSlide", "Reference elevation", e.level_m, -500.0, 8850.0, 1.0, e.height(e.level_m));
    reference["entry"] = json!({"ref":"#elevVal", "value":(e.level_m / e.factor()).round(), "title":"Reference elevation", "unit":e.unit});
    reference["unit"] = json!(e.unit);
    let mut span =
        slider("#elevSpanSlide", "Color span", span_position(e.span_m / FOOT), 0.0, 1000.0, 1.0, e.height(e.span_m));
    span["entry"] =
        json!({"ref":"#elevSpan", "value":(e.span_m / e.factor()).round(), "title":"Color span", "unit":e.unit});
    span["unit"] = json!(e.unit);
    let options: Vec<Value> = PALETTES
        .iter()
        .map(|p| json!({"value":p.0,"title":p.1}))
        .chain([json!({"value":"custom","title":"Custom"})])
        .collect();
    let summary = if e.on {
        format!("{} ± {} · {} · {}%", e.height(e.level_m), e.height(e.span_m), e.palette().1, e.alpha)
    } else {
        "Off".into()
    };
    let mut bands = Vec::new();
    for (name, b) in [("Below", &e.below), ("Above", &e.above)] {
        bands.extend([
            json!({"kind":"toggle","ref":format!("#elev{name}On"),"title":format!("Highlight ground {}",name.to_lowercase()),"value":b.on}),
            well(&format!("#elev{name}Color"), &format!("{name} color"), &b.color),
            field(e, &format!("#elev{name}Val"), &format!("{name} elevation"), b.level_m),
        ]);
    }
    bands.extend([
        json!({"kind":"header","title":"Edges & opacity"}),
        slider("#elevBandAlpha", "Opacity", e.band_alpha, 0.0, 100.0, 1.0, format!("{}%", e.band_alpha)),
        field(e, "#elevBandFeather", "Soft edge", e.feather_m),
        hint("Blends the highlight in over this height instead of a hard cut. 0 gives a sharp edge."),
        json!({"kind":"toggle","ref":"#elevBandOutline","title":"Outline edges","value":e.outline}),
        button("#elevBandsReset", "Reset highlights"),
    ]);
    let summary_bands = [("Below", &e.below), ("Above", &e.above)]
        .into_iter()
        .filter(|(_, b)| b.on)
        .map(|(name, b)| format!("{name} {}", e.height(b.level_m)))
        .collect::<Vec<_>>()
        .join(" · ");
    json!({"route":"elevation","title":"Elevation colors","description":"Color heights and highlight elevation ranges","items":[
        {"kind":"group","ref":"elevation:color","title":"Color by elevation","detail":summary,"collapsible":true,"open":e.on,
            "toggle":{"ref":"#elevSh","title":"Color by elevation on map","value":e.on},"items":[
                reference, span, {"kind":"picker","ref":"#elevPalette","title":"Color preset","value":e.palette().0,"options":options},
                well("#elevLowColor","Lower color",&e.colors[0]), well("#elevMidColor","Reference color",&e.colors[1]),
                well("#elevHighColor","Higher color",&e.colors[2]), button("#elevPaletteReverse","Reverse colors"),
                slider("#elevAlpha","Opacity",e.alpha,0.0,100.0,1.0,format!("{}%",e.alpha)),
                button("#elevPaletteReset","Reset colors"), button("#elevSpectrumReset","Reset coloring")
            ]},
        {"kind":"group","ref":"elevation:bands","title":"Highlight elevations","detail":if summary_bands.is_empty(){"Off"}else{&summary_bands},"items":bands},
        {"kind":"group","ref":"elevation:units","title":"Units","items":[
            {"kind":"picker","ref":"#elevUnit","title":"Heights shown in","value":e.unit,"options":[{"value":"ft","title":"feet"},{"value":"m","title":"metres"}]}
        ]}
    ]})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn units_roundtrip_without_moving_physical_heights() {
        let mut e = Elevation::default();
        let original = e.clone();
        assert!(e.act("#elevUnit", &json!("m")));
        for (r, m) in [
            ("#elevSpan", e.span_m),
            ("#elevBelowVal", e.below.level_m),
            ("#elevAboveVal", e.above.level_m),
            ("#elevBandFeather", e.feather_m),
        ] {
            assert!(e.act(r, &json!(m.round())));
        }
        e.act("#elevUnit", &json!("ft"));
        assert_eq!(e, original);
        e.act("#elevBelowVal", &json!(2000));
        assert_eq!(e.below.level_m, 2000.0 * FOOT);
        for feet in [50.0, 150.0, 300.0, 600.0, 1200.0, 2500.0] {
            assert_eq!(span_from_position(span_position(feet)), feet);
        }
    }
    #[test]
    fn actions_clamp_reset_and_compile_shader_values() {
        let mut e = Elevation::default();
        e.act("#elevSlide", &json!(99999));
        assert_eq!(e.level_m, 8850.0);
        e.act("#elevSpanSlide", &json!(-100));
        assert_eq!(e.span_m, 10.0 * FOOT);
        e.act("#elevBandFeather", &json!(99999));
        assert_eq!(e.feather_m, 10000.0 * FOOT);
        e.act("#elevPalette", &json!("glacier"));
        assert_eq!(e.palette().0, "glacier");
        e.act("#elevPaletteReverse", &Value::Null);
        assert_eq!(e.palette().0, "custom");
        assert!(!e.act("#elevHighColor", &json!("invalid")));
        e.act("#elevBelowOn", &json!(true));
        e.act("#elevSh", &json!(true));
        let s = e.spectrum();
        assert!(s.below.enabled && s.spectrum_on);
        assert_eq!(s.outline_width, 8.0 * FOOT);
        assert_eq!(s.spectrum_alpha, 122.0 / 255.0);
        e.act("#elevSpectrumReset", &Value::Null);
        assert!(!e.on && e.bands_on());
        e.act("#elevBandsReset", &Value::Null);
        assert_eq!(e, Elevation::default());
        assert_eq!(serde_json::from_str::<Elevation>(&serde_json::to_string(&e).unwrap()).unwrap(), e);
    }
}
