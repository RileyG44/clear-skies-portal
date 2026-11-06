//! App chrome preferences, matching ui-system.js's persisted shape and defaults.
use crate::elevation::color;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const ACCENTS: [(&str, &str); 10] = [
    ("Green", "#4cd964"),
    ("Mint", "#00c7be"),
    ("Teal", "#30b0c7"),
    ("Blue", "#0a84ff"),
    ("Indigo", "#5e5ce6"),
    ("Purple", "#bf5af2"),
    ("Pink", "#ff375f"),
    ("Red", "#ff453a"),
    ("Orange", "#ff9f0a"),
    ("Yellow", "#ffd60a"),
];
pub const DOTS: [(&str, &str); 9] = [
    ("White", "#ffffff"),
    ("Blue", "#4a9eff"),
    ("Red", "#ff453a"),
    ("Orange", "#ff9f0a"),
    ("Yellow", "#ffd60a"),
    ("Green", "#4cd964"),
    ("Pink", "#ff375f"),
    ("Purple", "#bf5af2"),
    ("Black", "#000000"),
];
pub const TRACKS: [(&str, &str); 6] = [
    ("Auto", ""),
    ("Light grey", "#d1d1d6"),
    ("Grey", "#8e8e93"),
    ("Charcoal", "#3a3a3c"),
    ("Black", "#000000"),
    ("White", "#ffffff"),
];
pub const PRESETS: [(&str, &str, &str, Option<&str>, &str); 5] = [
    ("meadow", "Meadow", "#4cd964", None, "#007aff"),
    ("ocean", "Ocean", "#30b0c7", None, "#0a84ff"),
    ("sunset", "Sunset", "#ff9f0a", None, "#ff453a"),
    ("berry", "Berry", "#bf5af2", None, "#ff375f"),
    ("graphite", "Graphite", "#98989d", Some("#3a3a3c"), "#636366"),
];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Appearance {
    pub toggle: Option<String>,
    pub track: Option<String>,
    pub button: Option<String>,
    pub font_color: Option<String>,
    pub location_dot: Option<String>,
    pub font: String,
    pub text_size: f64,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            toggle: None,
            track: None,
            button: None,
            font_color: None,
            location_dot: None,
            font: "system".into(),
            text_size: 1.0,
        }
    }
}
impl Appearance {
    pub fn normalize(&mut self) {
        for c in [&mut self.toggle, &mut self.track, &mut self.button, &mut self.font_color, &mut self.location_dot] {
            *c = c.as_deref().and_then(color);
        }
        if self.location_dot.as_deref() == Some("#ffffff") {
            self.location_dot = None;
        }
        if !["system", "inter", "serif", "mono"].contains(&self.font.as_str()) {
            self.font = "system".into();
        }
        if ![0.92, 1.0, 1.12].contains(&self.text_size) {
            self.text_size = 1.0;
        }
    }
    pub fn preset(&self) -> &'static str {
        if self.toggle.is_none() && self.track.is_none() && self.button.is_none() {
            return "meadow";
        }
        PRESETS
            .iter()
            .find(|p| {
                self.toggle.as_deref() == Some(p.2)
                    && self.track.as_deref() == p.3
                    && self.button.as_deref() == Some(p.4)
            })
            .map_or("custom", |p| p.0)
    }
    pub fn update(&self) -> Value {
        let mut v = serde_json::to_value(self).expect("appearance JSON");
        v["preset"] = json!(self.preset());
        v
    }
    pub fn act(&mut self, r: &str, value: &Value) -> bool {
        let Some(r) = r.strip_prefix("appearance:") else { return false };
        if r == "reset" {
            *self = Self::default();
            return true;
        }
        if r == "fontColor:auto" {
            self.font_color = None;
            return true;
        }
        if let Some(id) = r.strip_prefix("preset:") {
            let Some(p) = PRESETS.iter().find(|p| p.0 == id) else { return false };
            self.toggle = Some(p.2.into());
            self.track = p.3.map(str::to_owned);
            self.button = Some(p.4.into());
            return true;
        }
        if let Some(size) = r.strip_prefix("textSize:").and_then(|s| s.parse::<f64>().ok()) {
            if ![0.92, 1.0, 1.12].contains(&size) {
                return false;
            }
            self.text_size = size;
            return true;
        }
        if r == "font" {
            let Some(font) = value.as_str().filter(|f| ["system", "inter", "serif", "mono"].contains(f)) else {
                return false;
            };
            self.font = font.into();
            return true;
        }
        let (key, picked) = r.split_once(':').map_or((r, None), |(k, v)| (k, Some(v)));
        let c = match picked {
            Some("auto") => None,
            Some(v) => color(v),
            None => value.as_str().and_then(color),
        };
        if c.is_none() && picked != Some("auto") {
            return false;
        }
        match key {
            "toggle" => self.toggle = c,
            "track" => self.track = c,
            "button" => self.button = c,
            "fontColor" => self.font_color = c,
            "locationDot" => self.location_dot = c,
            _ => return false,
        }
        self.normalize();
        true
    }
}

fn swatches(key: &str, title: &str, detail: &str, value: &str, choices: &[(&str, &str)]) -> Value {
    let options: Vec<Value> = choices
        .iter()
        .map(|(name, c)| json!({"ref":format!("appearance:{key}:{c}"),"title":name,"color":c,"selected":*c == value}))
        .collect();
    json!({"kind":"swatches","ref":format!("appearance:{key}:swatches"),"title":title,"detail":detail,"options":options,
        "custom":{"ref":format!("appearance:{key}"),"title":format!("Custom {title}"),"value":value}})
}
pub fn page(a: &Appearance) -> Value {
    let presets: Vec<Value> = PRESETS
        .iter()
        .map(|p| json!({"ref":format!("appearance:preset:{}",p.0),"title":p.1,"selected":a.preset() == p.0}))
        .collect();
    let tracks: Vec<Value> = TRACKS.iter().map(|(title,c)|json!({"ref":format!("appearance:track:{}",if c.is_empty(){"auto"}else{c}),"title":title,"selected":a.track.as_deref().unwrap_or("") == *c})).collect();
    let fonts: Vec<Value> = [("system", "System"), ("inter", "Inter"), ("serif", "Serif"), ("mono", "Mono")]
        .iter()
        .map(|(id, title)| json!({"value":id,"title":title}))
        .collect();
    let sizes: Vec<Value> = [(0.92,"Small"),(1.0,"Default"),(1.12,"Large")].iter().map(|(size,title)|json!({"ref":format!("appearance:textSize:{size}"),"title":title,"selected":a.text_size == *size})).collect();
    json!({"route":"appearance","title":"App appearance","description":"Choose the app theme, text and colors","items":[
        {"kind":"group","ref":"appearance:presets","title":"Theme presets","items":[
            {"kind":"segmented","ref":"appearance:presets:choices","title":"Theme preset","detail":"Sets the colors below together. Change any one and it becomes Custom.","options":presets}
        ]},
        {"kind":"group","ref":"appearance:controls","title":"Controls","items":[
            swatches("toggle","Toggle & slider color","Fills every switch knob and the filled part of a slider when it is on.",a.toggle.as_deref().unwrap_or("#4cd964"),&ACCENTS),
            {"kind":"segmented","ref":"appearance:track:choices","title":"Slider track color","detail":"The part of the slider bar after the thumb. Auto follows light and dark mode.","options":tracks},
            {"kind":"color","ref":"appearance:track","title":"Custom Slider track color","value":a.track.as_deref().unwrap_or("#000000")},
            swatches("button","Button color","Coloured buttons, like Capture in the camera pop-up, and links.",a.button.as_deref().unwrap_or("#007aff"),&ACCENTS)
        ]},
        {"kind":"group","ref":"appearance:text","title":"Text","items":[
            {"kind":"picker","ref":"appearance:font","title":"Font","detail":"The typeface for menus and panels. Map labels keep their own.","value":a.font,"options":fonts},
            {"kind":"text","style":"row","title":"Text color","detail":"Overrides the main text color in both light and dark mode."},
            {"kind":"button","ref":"appearance:fontColor:auto","title":"Auto","role":"link"},
            {"kind":"color","ref":"appearance:fontColor","title":"Text color","value":a.font_color.as_deref().unwrap_or("#000000")},
            {"kind":"segmented","ref":"appearance:textSize:choices","title":"Text size","detail":"Scales the sidebar and pop-up panels.","options":sizes}
        ]},
        {"kind":"group","ref":"appearance:location","title":"Selected location","items":[
            swatches("locationDot","Location dot color","The dot that marks the place you select on the map.",a.location_dot.as_deref().unwrap_or("#ffffff"),&DOTS)
        ]},
        {"kind":"group","ref":"appearance:reset:group","title":"Reset","items":[
            {"kind":"button","ref":"appearance:reset","title":"Reset appearance","role":"link"}
        ]}
    ]})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presets_are_derived_from_exact_control_colors_only() {
        let mut a = Appearance::default();
        assert_eq!(a.preset(), "meadow");
        for p in PRESETS {
            assert!(a.act(&format!("appearance:preset:{}", p.0), &Value::Null));
            assert_eq!(a.preset(), p.0);
            assert!(a.act("appearance:locationDot", &json!("#FF9F0A")));
            assert_eq!(a.preset(), p.0);
            assert_eq!(a.location_dot.as_deref(), Some("#ff9f0a"));
        }
        a.act("appearance:toggle", &json!("#010203"));
        assert_eq!(a.preset(), "custom");
        a.act("appearance:font", &json!("mono"));
        a.act("appearance:textSize:1.12", &Value::Null);
        let restored: Appearance = serde_json::from_value(a.update()).unwrap();
        assert_eq!(restored, a);
        assert!(!a.act("appearance:button", &json!("#fff")));
        a.act("appearance:reset", &Value::Null);
        assert_eq!(a, Appearance::default());
    }
    #[test]
    fn appearance_page_matches_fixture_titles_details_and_default_controls() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../../ios/Tests/Fixtures/shell/web-fresh-launch.json")).unwrap();
        let actual = page(&Appearance::default());
        let expected = &fixture["pages"]["appearance"];
        for (a, e) in actual["items"].as_array().unwrap()[..4].iter().zip(&expected["items"].as_array().unwrap()[..4]) {
            assert_eq!(a["title"], e["title"]);
            for (a, e) in a["items"].as_array().unwrap().iter().zip(e["items"].as_array().unwrap()) {
                assert_eq!(a["title"], e["title"]);
                assert_eq!(a["detail"], e["detail"]);
                if let Some(options) = e["options"].as_array() {
                    for (a, e) in a["options"].as_array().unwrap().iter().zip(options) {
                        assert_eq!(a["title"], e["title"]);
                        assert_eq!(a["selected"], e["selected"]);
                    }
                }
            }
        }
    }
}
