//! The shell's content: the `ShellUpdate` the SwiftUI shell decodes
//! (ios/Sources/Shell/ShellTypes.swift), built from native app state.
//!
//! The pages keep the shell's established structure, wording and refs (the
//! reference is ios/Tests/Fixtures/shell). A ref names a control; the app
//! answers actions on it in `app.rs`.

use serde_json::{Value, json};

use crate::state::{AppState, Fitted};
use crate::terrain::{Fit, Layer, Studio, catalog, parse_hex};

const FT: f64 = 3.28084;
const EARTH_M: f64 = 40_075_016.685_578_49;
const MILE_M: f64 = 1609.344;
const FOOT_M: f64 = 0.3048;

/// Menu groups and their routes.
pub fn groups() -> Value {
    let route = |key: &str, title: &str, description: &str, icon: &str| json!({"key": key, "title": title, "description": description, "icon": icon});
    json!([
        {"label": "Explore the map", "routes": [
            route("layers", "Map layers", "Manage visibility, order and opacity", "layers"),
            route("satellite", "Satellite imagery", "Find and compare dated images", "satellite"),
            route("terrain", "Terrain & LiDAR", "Style terrain, adjust lighting and download data", "radar"),
            route("elevation", "Elevation colors", "Color heights and highlight elevation ranges", "mountain-snow"),
        ]},
        {"label": "Study & share", "routes": [
            route("analyze", "Terrain analysis", "Measure and reveal landform patterns", "scan-search"),
            route("markup", "Draw & annotate", "Add drawings, labels and notes", "pen-line"),
            route("export", "Export image", "Save the map view or a selected area", "download"),
        ]},
        {"label": "Reference layers", "routes": [
            route("conditions", "Live conditions", "Weather, fire, snow and recent events", "cloud-sun"),
            route("geology", "Geology & hazards", "Explore geology, faults and landslides", "triangle-alert"),
            route("past", "Past landscapes", "Explore ice-age and historical landscapes", "history"),
            route("labels", "Labels & reference", "Add roads, places and boundaries", "tags"),
        ]},
        {"label": "App", "routes": [
            route("appearance", "App appearance", "Choose the app theme, text and colors", "sliders-horizontal"),
            route("settings", "App settings", "Connection, accessibility and device preferences", "settings"),
        ]},
    ])
}

/// A route's title and description.
pub fn route_info(route: &str) -> Option<(String, String)> {
    groups().as_array()?.iter().flat_map(|g| g["routes"].as_array().cloned().unwrap_or_default()).find_map(|r| {
        if r["key"] != route {
            return None;
        }
        Some((r["title"].as_str()?.to_string(), r["description"].as_str()?.to_string()))
    })
}

/// The map dock, in the person's order.
pub fn dock(state: &AppState, bearing: f64) -> Value {
    let dark = state.theme == "dark";
    let mut tools = vec![
        json!({"ref": "#mapModeToggle", "id": "mapModeToggle", "tool": "mapMode", "title": "Map view: 2D map"}),
        json!({"ref": "#quickDraw", "id": "quickDraw", "tool": "draw", "title": "Draw on the map"}),
        json!({"ref": "#mapInfoToggle", "id": "mapInfoToggle", "tool": "scene", "title": "Show displayed imagery controls", "hidden": true}),
        json!({"ref": "#terrainSourceToggle", "id": "terrainSourceToggle", "tool": "terrain-source", "title": "Show layers"}),
        json!({"ref": "#snapshot", "id": "snapshot", "tool": "snapshot", "title": "Save current map viewport as an image"}),
        json!({"ref": "#mapTheme", "id": "mapTheme", "tool": "theme",
            "title": if dark { "Switch to light map" } else { "Switch to dark map" }}),
        json!({"ref": "#bearingReset", "id": "bearingReset", "tool": "bearing", "title": "Reset map to north",
            "hidden": bearing.abs() < 0.5}),
        json!({"ref": "#serverToggle", "id": "serverToggle", "tool": "server", "title": "Terrain engine: built into this app", "dot": "on"}),
    ];
    if !state.dock_order.is_empty() {
        let rank = |t: &Value| state.dock_order.iter().position(|id| t["id"] == id.as_str()).unwrap_or(usize::MAX);
        tools.sort_by_key(rank);
    }
    Value::Array(tools)
}

pub fn map_state(state: &AppState, bearing: f64) -> Value {
    json!({"mode": "2d", "theme": state.theme, "pointCloud": false, "terrain3d": false, "selecting": false,
        "drawing": false, "bearing": bearing})
}

fn group_digits(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}

/// A layer value as the shell shows it (feet, degrees or percent).
pub fn format_value(style: &str, value: f64) -> String {
    match catalog().style(style).map(|s| s.unit.as_str()) {
        Some("m") => format!("{} ft", group_digits((value * FT).round() as i64)),
        Some("deg") => format!("{}°", value.round()),
        Some("shade") => format!("{}%", (value * 100.0).round()),
        _ => format!("{}", (value * 100.0).round() / 100.0),
    }
}

fn nice(value: f64) -> Option<f64> {
    if value.is_nan() || value <= 0.0 || !value.is_finite() {
        return None;
    }
    let pow = 10f64.powf(value.log10().floor());
    let d = value / pow;
    Some(
        (if d >= 10.0 {
            10.0
        } else if d >= 5.0 {
            5.0
        } else if d >= 3.0 {
            3.0
        } else if d >= 2.0 {
            2.0
        } else {
            1.0
        }) * pow,
    )
}

fn format_distance(value: f64) -> String {
    if value >= 100.0 {
        group_digits(value.round() as i64)
    } else {
        let rounded = (value * 100.0).round() / 100.0;
        format!("{rounded}")
    }
}

/// The scale bar: the longest nice distance within the info tile's bar.
pub fn distance(lat: f64, zoom: f64) -> Option<Value> {
    let per_px = EARTH_M * lat.to_radians().cos() / (256.0 * zoom.exp2());
    let max_bar = (260.0f64 - 24.0).max(90.0) - 58.0;
    let metres = per_px * max_bar;
    let (amount, unit, length) = if metres >= MILE_M {
        let amount = nice(metres / MILE_M)?;
        (amount, "mi", amount * MILE_M)
    } else {
        let amount = nice(metres / FOOT_M)?;
        (amount, "ft", amount * FOOT_M)
    };
    Some(
        json!({"label": format!("{} {unit}", format_distance(amount)), "width": (length / per_px * 10.0).round() / 10.0,
        "amount": amount, "unit": unit}),
    )
}

fn ramp(stops: &[[f64; 5]], t: f64) -> [f64; 4] {
    let colour = |s: &[f64; 5]| [s[1], s[2], s[3], s[4]];
    if t <= stops[0][0] {
        return colour(&stops[0]);
    }
    for k in 1..stops.len() {
        if t <= stops[k][0] {
            let (a, b) = (stops[k - 1], stops[k]);
            let f = ((t - a[0]) / (b[0] - a[0]).max(1e-6)).clamp(0.0, 1.0);
            return [1, 2, 3, 4].map(|i| a[i] + (b[i] - a[i]) * f);
        }
    }
    colour(&stops[stops.len() - 1])
}

fn hex(c: [f64; 4]) -> String {
    let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", byte(c[0]), byte(c[1]), byte(c[2]))
}

/// A legend's gradient stops: the layer's ramp sampled in its value space,
/// so curve and bands read as they draw.
fn gradient(layer: &Layer, range: [f64; 2]) -> Vec<Value> {
    let stops = catalog().resolve_stops(layer);
    let elevation = layer.style == "tint" || layer.style == "rem";
    if !elevation {
        return stops
            .iter()
            .map(|s| json!({"color": hex([s[1], s[2], s[3], s[4]]), "opacity": s[4], "at": s[0]}))
            .collect();
    }
    (0..=128)
        .map(|i| {
            let t = f64::from(i) / 128.0;
            let value = range[0] + t * (range[1] - range[0]);
            let mut u = ((value - range[0]) / (range[1] - range[0])).clamp(0.0, 1.0).powf(layer.gamma);
            if layer.steps >= 2 {
                let steps = f64::from(layer.steps);
                u = (u * steps).floor().min(steps - 1.0) / (steps - 1.0);
            }
            let c = ramp(&stops, u);
            json!({"color": hex(c), "opacity": c[3], "at": t})
        })
        .collect()
}

/// The legend scales for the drawn look: caption, gradient and ticks.
pub fn legend(studio: &Studio, style: &str, fitted: &Fitted) -> Vec<Value> {
    if style == "off" {
        return Vec::new();
    }
    let c = catalog();
    let mut layers = vec![("base".to_string(), studio.base_layer(style))];
    layers.extend(studio.overlays.iter().enumerate().map(|(i, l)| (format!("overlay:{i}"), l.clone())));
    let visible: Vec<_> = layers.into_iter().filter(|(_, l)| l.visible && l.opacity > 0.0).collect();
    let Some((key, base)) = visible.first() else { return Vec::new() };
    let overlays: Vec<String> =
        visible[1..].iter().filter_map(|(_, l)| c.style(&l.style).map(|s| s.label.clone())).collect();
    let spec = c.style(&base.style).expect("visible layers have styles");
    let fit = if base.auto {
        fitted.ranges.get(key).and_then(|f| match f {
            Fit::Range(r) => Some(*r),
            Fit::Split { land, water, inland } => land.or(*water).or(*inland),
        })
    } else {
        None
    };
    let range = fit.unwrap_or([base.min, base.max]);
    let palette = if base.stops.is_some() {
        " · custom colors".to_string()
    } else {
        format!(" · {}", c.palettes.get(&base.palette).map_or("", |p| p.name.as_str()))
    };
    let joined = if overlays.is_empty() { String::new() } else { format!(" + {}", overlays.join(" + ")) };
    let caption = format!("{}{palette}{joined}", spec.label);
    let ticks: Vec<String> = if spec.unit == "shade" {
        vec!["shadow".into(), "relief".into(), "illuminated".into()]
    } else if spec.family == "lines" {
        vec!["intermediate".into(), "index".into()]
    } else {
        let suffix = if base.auto { if fit.is_some() { " · fitted" } else { " · waiting for terrain" } } else { "" };
        vec![
            format_value(&base.style, range[0]),
            format_value(&base.style, (range[0] + range[1]) / 2.0),
            format_value(&base.style, range[1]) + suffix,
        ]
    };
    vec![json!({"name": caption, "stops": gradient(base, range), "labels": ticks, "swatches": []})]
}

fn coordinates(lon: f64, lat: f64) -> String {
    format!(
        "{:.5}° {} · {:.5}° {}",
        lat.abs(),
        if lat >= 0.0 { "N" } else { "S" },
        lon.abs(),
        if lon >= 0.0 { "E" } else { "W" }
    )
}

/// The status block: the map-centre info tile, the message line and the
/// engine.
pub fn status(state: &AppState, fitted: &Fitted, lon: f64, lat: f64, zoom: f64, settled: bool) -> Value {
    let t = &state.terrain;
    let elevation =
        fitted.center.map_or_else(String::new, |m| format!("Elevation ≈ {} ft", group_digits((m * FT).round() as i64)));
    let terrain = if settled {
        json!({"state": "ready", "text": "Terrain picture ready"})
    } else {
        json!({"state": "loading", "text": "Preparing the terrain picture · visible picture still settling · Waiting for elevation"})
    };
    json!({
        "mapInfo": {"basis": "Map center", "coordinates": coordinates(lon, lat), "elevation": elevation,
            "source": "", "analysis": "", "terrain": terrain, "distance": distance(lat, zoom),
            "keys": legend(&t.studio, &t.style, fitted)},
        "terrain": null,
        "message": {"kind": "idle", "text": "Enter a location, or tap anywhere on the map.", "error": false},
        "snapshot": null,
        "engine": {"online": true, "state": "built into this app"},
    })
}

pub fn counts(state: &AppState) -> Value {
    let overlays = state.overlays.values().filter(|o| o.on).count();
    let layers = 1 + overlays + usize::from(state.terrain.style != "off");
    json!({"layers": layers.to_string(), "terrain": "1"})
}

pub fn appearance() -> Value {
    json!({"toggle": null, "track": null, "button": null, "font": "system", "fontColor": null, "locationDot": null,
        "textSize": 1, "preset": "meadow"})
}

/// The selected place: where search or a map tap put it.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Location {
    pub lat: f64,
    pub lng: f64,
    pub label: String,
}

/// The search field and the selected place's actions.
pub fn search(location: Option<&Location>, version: u64) -> Value {
    let Some(l) = location else {
        return json!({"version": version, "label": "", "query": "", "canCopy": false, "coordinates": "", "mapsURL": "",
            "earthURL": "", "canClear": false});
    };
    let compact = format!("{:.6},{:.6}", l.lat, l.lng);
    json!({"version": version, "label": l.label, "lat": l.lat, "lng": l.lng, "query": l.label, "canCopy": true,
        "coordinates": format!("{:.6}, {:.6}", l.lat, l.lng),
        "mapsURL": format!("https://www.google.com/maps/search/?api=1&query={}", compact.replace(',', "%2C")),
        "earthURL": format!("https://earth.google.com/web/search/{compact}/"),
        "canClear": true})
}

/// A place's label once picked: its name and the first two parts of its
/// context.
pub fn place_label(primary: &str, secondary: &str) -> String {
    if secondary.is_empty() {
        return primary.to_owned();
    }
    let context: Vec<&str> = secondary.split(',').map(str::trim).take(2).collect();
    format!("{primary}, {}", context.join(", "))
}

/// Relief depth's slider position for an exaggeration: log2 steps.
pub fn relief_to_slider(exag: f64) -> f64 {
    (exag.log2() * 100.0).round()
}

pub fn slider_to_relief(value: f64) -> f64 {
    ((value / 100.0).exp2() * 1000.0).round() / 1000.0
}

pub fn slider_to_detail_radius(value: f64) -> f64 {
    ((1.0 + 499.0 * (value / 100.0).powi(2)) * 10.0).round() / 10.0
}

pub fn slider_to_rem_radius(value: f64) -> f64 {
    (50.0 + 19950.0 * (value / 100.0).powi(2)).round()
}

fn detail_label(detail: f64) -> String {
    if detail == 0.0 {
        "Natural".into()
    } else if detail < 0.0 {
        format!("Smooth {}%", (-detail * 100.0).round())
    } else {
        format!("Sharpen {}%", (detail * 100.0).round())
    }
}

/// A ground distance in feet, or miles from three quarters of a mile.
fn distance_label(metres: f64) -> String {
    let ft = metres * FT;
    if ft >= 5280.0 * 0.75 {
        if ft >= 52800.0 { format!("{:.0} mi", ft / 5280.0) } else { format!("{:.1} mi", ft / 5280.0) }
    } else {
        format!("{} ft", group_digits(ft.round() as i64))
    }
}

fn slider(r: &str, title: &str, value: f64, min: f64, max: f64, step: f64, display: String) -> Value {
    json!({"kind": "slider", "ref": r, "title": title, "disabled": false, "value": value, "min": min, "max": max,
        "step": step, "display": display})
}

fn hint(text: &str) -> Value {
    json!({"kind": "text", "style": "hint", "title": text})
}

const STYLE_CHOICES: [(&str, &str, &str); 12] = [
    ("off", "Off", "Off"),
    ("hs", "Hillshade", "Hillshade"),
    ("hsmulti", "Hillshade (multi-directional)", "Multi hillshade"),
    ("tint", "Elevation tinted", "Elevation"),
    ("rem", "Relative elevation", "Relative"),
    ("slope", "Slope", "Slope"),
    ("aspect", "Aspect", "Aspect"),
    ("northness", "North–south exposure", "Exposure"),
    ("c2", "Contours — 2 ft", "Contours 2 ft"),
    ("c5", "Contours — 5 ft", "Contours 5 ft"),
    ("c10", "Contours — 10 ft", "Contours 10 ft"),
    ("c25", "Contours — 25 ft", "Contours 25 ft"),
];

fn compass(degrees: f64) -> &'static str {
    const NAMES: [&str; 8] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    NAMES[((degrees / 45.0).round() as usize) % 8]
}

fn sun_height(degrees: f64) -> &'static str {
    if degrees < 25.0 {
        "low sun"
    } else if degrees < 60.0 {
        "mid sun"
    } else {
        "high sun"
    }
}

/// A one-line description of the drawn style for the display group.
fn display_summary(state: &AppState, fitted: &Fitted) -> Vec<Value> {
    let t = &state.terrain;
    legend(&t.studio, &t.style, fitted)
        .into_iter()
        .take(1)
        .flat_map(|key| {
            [
                json!({"kind": "text", "title": key["name"], "style": "hint"}),
                json!({"kind": "gradient", "stops": key["stops"], "labels": key["labels"]}),
            ]
        })
        .collect()
}

fn layer_row(studio: &Studio, key: &str, layer: &Layer, bottom: bool) -> Value {
    let c = catalog();
    let label = c.style(&layer.style).map_or(layer.style.clone(), |s| s.label.clone());
    let blend = c.blends.iter().find(|b| b.id == layer.blend).map_or("Normal", |b| b.label.as_str());
    let palette = if layer.stops.is_some() {
        "Custom".to_string()
    } else {
        c.palettes.get(&layer.palette).map_or(String::new(), |p| p.name.clone())
    };
    let place = if bottom { "Bottom layer".to_string() } else { blend.to_string() };
    let _ = studio;
    json!({"kind": "lidarLayer", "ref": format!("studio:{key}"), "title": label,
        "detail": format!("{place} · {}% · {palette}", (layer.opacity * 100.0).round()),
        "visible": layer.visible, "eye": format!("studio:{key}:eye"), "open": false})
}

/// The Terrain & LiDAR page.
pub fn terrain_page(state: &AppState, fitted: &Fitted) -> Value {
    let c = catalog();
    let t = &state.terrain;
    let looks: Vec<Value> = c
        .looks
        .iter()
        .map(|l| json!({"ref": format!("look:{}", l.id), "title": l.name, "selected": t.studio.look.as_deref() == Some(l.id.as_str()),
            "src": format!("csp-image:look:{}", l.id)}))
        .collect();
    let chips: Vec<Value> = STYLE_CHOICES
        .iter()
        .map(|(id, _, short)| json!({"ref": format!("style:{id}"), "title": short, "selected": t.style == *id}))
        .collect();
    let opacity = slider("#terOp", "Terrain opacity", t.opacity, 0.0, 100.0, 1.0, format!("{}%", t.opacity.round()));
    let mut presets = vec![
        json!({"kind": "looks", "ref": "studio:looks", "title": "Terrain presets", "options": looks}),
        json!({"kind": "text", "ref": "#ls-preset-hint", "style": "hint",
            "title": "Choosing a preset replaces the current layer mix. Customize its layers and effects below."}),
        json!({"kind": "segmented", "ref": "#cspStyleChips", "title": "Map display", "options": chips}),
    ];
    presets.extend(display_summary(state, fitted));
    presets.push(opacity.clone());
    let style = t.style.as_str();
    let mut mix = Vec::new();
    if style != "off" {
        mix.push(layer_row(&t.studio, "base", &t.studio.base_layer(style), true));
        for (i, layer) in t.studio.overlays.iter().enumerate().rev() {
            mix.insert(0, layer_row(&t.studio, &format!("overlay:{i}"), layer, false));
        }
    }
    let e = t.studio.effects;
    mix.push(json!({"kind": "button", "ref": "studio:add", "title": "Add layer",
        "disabled": t.studio.overlays.len() + 1 >= c.max_layers, "expanded": false}));
    if style != "off" {
        mix.extend([
            slider(
                "#ls-relief",
                "Relief depth",
                relief_to_slider(e.relief_exag),
                -200.0,
                300.0,
                1.0,
                format!("{:.2}×", e.relief_exag),
            ),
            hint("Deepen or flatten the shading in every shaded layer."),
            slider("#ls-detail", "Detail", (e.detail * 100.0).round(), -100.0, 300.0, 1.0, detail_label(e.detail)),
            hint("Smooth away noise, or sharpen tiny features like old roads and channels."),
        ]);
        if e.detail != 0.0 {
            mix.extend([
                slider(
                    "#ls-detail-size",
                    "Detail size",
                    (((e.detail_radius - 1.0) / 499.0).sqrt() * 100.0).round(),
                    1.0,
                    100.0,
                    1.0,
                    distance_label(e.detail_radius),
                ),
                hint("How large a feature counts as detail."),
            ]);
        }
        let uses_rem = style == "rem" || t.studio.overlays.iter().any(|l| l.visible && l.style == "rem");
        if uses_rem {
            mix.extend([
                slider("#ls-valley", "Valley width", (((e.rem_radius - 50.0) / 19950.0).sqrt() * 100.0).round(), 0.0, 100.0,
                    1.0, distance_label(e.rem_radius)),
                hint("How far relative elevation looks for the valley floor. Widen it for big rivers, narrow it for creeks."),
            ]);
        }
    }
    mix.extend([
        json!({"kind": "button", "ref": "studio:reset", "title": "Reset colors & layers", "disabled": false, "role": "link"}),
    ]);
    let look = t.look;
    let appearance = vec![
        slider(
            "#terBrightness",
            "Brightness",
            look.brightness,
            75.0,
            150.0,
            1.0,
            format!("{}%", look.brightness.round()),
        ),
        slider("#terContrast", "Contrast", look.contrast, 60.0, 180.0, 1.0, format!("{}%", look.contrast.round())),
        slider(
            "#terSaturation",
            "Color intensity",
            look.saturation,
            0.0,
            180.0,
            1.0,
            format!("{}%", look.saturation.round()),
        ),
        json!({"kind": "button", "ref": "#terLookReset", "title": "Reset appearance", "disabled": false, "role": "action"}),
    ];
    let l = t.lighting;
    let lighting = vec![
        json!({"kind": "sun", "ref": "#terSunAz", "title": "Sun",
            "azimuth": {"kind": "slider", "ref": "#terSunAz", "title": "Azimuth", "disabled": false, "value": l.azimuth,
                "min": 0, "max": 359, "step": 1, "accessibility": format!("{} degrees {}", l.azimuth.round(), compass(l.azimuth)),
                "display": format!("{}°", l.azimuth.round())},
            "altitude": {"kind": "slider", "ref": "#terSunAlt", "title": "Altitude", "disabled": false, "value": l.altitude,
                "min": 5, "max": 90, "step": 1, "accessibility": format!("{} degrees, {}", l.altitude.round(), sun_height(l.altitude)),
                "display": format!("{}°", l.altitude.round())}}),
        slider(
            "#terAmbient",
            "Shadow fill",
            (l.ambient * 100.0).round(),
            0.0,
            60.0,
            1.0,
            format!("{}%", (l.ambient * 100.0).round()),
        ),
        slider(
            "#terExaggeration",
            "3D relief",
            t.exaggeration,
            25.0,
            400.0,
            5.0,
            format!("{:.2}×", t.exaggeration / 100.0),
        ),
        json!({"kind": "button", "ref": "#terLightReset", "title": "Reset lighting", "disabled": false, "role": "action"}),
    ];
    let styles: Vec<Value> = STYLE_CHOICES.iter().map(|(id, title, _)| json!({"value": id, "title": title})).collect();
    let mut display = vec![json!({"kind": "picker", "ref": "#terStyle", "title": "Terrain style", "disabled": false,
        "value": t.style, "options": styles})];
    display.extend(display_summary(state, fitted));
    display.push(opacity);
    let items = vec![
        json!({"kind": "group", "ref": "terrain:presets", "title": "Quick presets", "items": presets.into_iter()
            .chain([
                json!({"kind": "group", "ref": "studio:mix", "title": "Layers & colorsMix layers, edit palettes and apply terrain effects", "open": true, "items": mix}),
                json!({"kind": "group", "ref": "studio:appearance", "title": "Color & contrastBrightness, contrast and saturation", "open": true, "items": appearance.clone()}),
                json!({"kind": "group", "ref": "studio:lighting", "title": "Lighting & 3D reliefSun direction, ambient light and vertical exaggeration", "open": true, "items": lighting.clone()}),
            ]).collect::<Vec<_>>()}),
        json!({"kind": "group", "ref": "terrain:display", "title": "Map display", "items": display}),
        json!({"kind": "group", "ref": "terrain:custom", "title": "Customize terrain", "items": [
            {"kind": "disclosure", "ref": "terrain:appearance", "title": "Color & contrast", "items": appearance},
            {"kind": "disclosure", "ref": "terrain:lighting", "title": "Lighting & 3D relief", "items": lighting},
        ]}),
        json!({"kind": "group", "ref": "terrain:data", "title": "Data & downloads", "items": [
            {"kind": "disclosure", "ref": "terrain:downloads", "title": "Terrain downloads",
                "detail": "Source preference, offline areas and Washington LiDAR", "items": [
                {"kind": "picker", "ref": "#terSrc", "title": "Preferred terrain source", "disabled": false, "value": t.source,
                    "options": [{"value": "auto", "title": "Best available"}, {"value": "3dep", "title": "USGS 3DEP (national)"},
                        {"value": "usgs1m", "title": "USGS 3.3 ft (offline-capable)"}]},
            ]},
        ]}),
        json!({"kind": "group", "ref": "terrain:reset", "title": "Reset", "items": [
            {"kind": "button", "ref": "#terReset", "title": "Reset all terrain settings", "disabled": false, "role": "link"},
        ]}),
    ];
    let (title, description) = route_info("terrain").unwrap_or_default();
    json!({"route": "terrain", "title": title, "description": description, "items": items})
}

/// The routes "Add layers" leads to, in the page's order.
const ADD_LAYERS: [(&str, &str); 8] = [
    ("satellite", "Dated optical, radar, IR, and global mosaics"),
    ("terrain", "Style terrain, adjust lighting and download data"),
    ("elevation", "Color heights and highlight elevation ranges"),
    ("conditions", "Weather, fire, snow and recent events"),
    ("geology", "Surface geology, faults, and landslides"),
    ("past", "Glaciers, ice-age lakes, and archaeology"),
    ("labels", "Roads, trails, water, places, and boundaries"),
    ("markup", "Add drawings, labels and notes"),
];

/// A layer's title and detail in the layer list.
pub fn layer_title(state: &AppState, id: &str) -> Option<(String, String)> {
    match id {
        id if id.starts_with("overlay:") => {
            let info = crate::overlays::info(&id["overlay:".len()..])?;
            Some((info.name.into(), format!("Labels & reference · {}", info.via)))
        }
        "terrain" => {
            let t = &state.terrain;
            let title = catalog().style(&t.style).map_or("Terrain".to_string(), |s| s.label.clone());
            let detail = if t.source == "usgs1m" { "USGS 3.3 ft LiDAR" } else { "USGS 3DEP elevation" };
            Some((title, detail.into()))
        }
        _ => None,
    }
}

/// The Map layers page: the person's layers top first, the pinned basemap,
/// and where to add more.
fn layers_page(state: &AppState) -> Value {
    let mut items = vec![json!({"kind": "header", "title": "Active layers"})];
    // Active layers: the terrain, and the overlays that are on.
    let active = |id: &str| id.strip_prefix("overlay:").is_none_or(|o| state.overlay(o).on);
    let order: Vec<&String> =
        state.layer_order.iter().filter(|id| layer_title(state, id).is_some() && active(id)).collect();
    for (index, id) in order.iter().enumerate() {
        let (title, detail) = layer_title(state, id).expect("listed layer");
        let (on, opacity) = match id.strip_prefix("overlay:") {
            Some(o) => (state.overlay(o).on, state.overlay(o).opacity),
            None => (state.terrain.style != "off", state.terrain.opacity),
        };
        let r = |what: &str| format!("layer:{id}:{what}");
        let opacity = opacity.round();
        items.push(json!({
            "kind": "layer", "ref": r("card"), "id": id, "title": title, "detail": detail,
            "edit": {"ref": r("edit")},
            "toggle": {"ref": r("toggle"), "value": on},
            "opacity": {"ref": r("opacity"), "value": opacity, "display": format!("{opacity}%")},
            "actions": [
                {"ref": r("up"), "action": "up", "title": format!("Move {title} up"), "disabled": index == 0},
                {"ref": r("down"), "action": "down", "title": format!("Move {title} down"), "disabled": index + 1 == order.len()},
                {"ref": r("edit"), "action": "edit", "title": format!("Edit {title}")},
                {"ref": r("reset"), "action": "reset", "title": format!("Reset {title}")},
            ],
        }));
    }
    items.push(json!({"kind": "layer", "ref": "layer:basemap:card", "id": "basemap", "title": "Reference basemap",
        "detail": "Pinned below all research layers", "locked": true,
        "toggle": {"ref": "layer:basemap:toggle", "value": true, "disabled": true}, "actions": []}));
    items.push(json!({"kind": "header", "title": "Add layers"}));
    for (route, detail) in ADD_LAYERS {
        let (title, _) = route_info(route).unwrap_or_default();
        items.push(json!({"kind": "button", "ref": format!("open:{route}"), "role": "navigate", "title": title, "detail": detail}));
    }
    let (title, description) = route_info("layers").unwrap_or_default();
    json!({"route": "layers", "title": title, "description": description, "items": items})
}

/// Labels & reference: the reference overlays, each with its opacity once
/// on, and where they come from.
fn labels_page(state: &AppState) -> Value {
    use crate::overlays::OVERLAYS;
    let mut rows = Vec::new();
    for o in &OVERLAYS {
        let overlay = state.overlay(o.id);
        rows.push(json!({"kind": "toggle", "ref": format!("#ov_{}", o.id), "title": o.name, "color": o.color,
            "value": overlay.on}));
        if overlay.on {
            let value = overlay.opacity.round();
            rows.push(json!({"kind": "slider", "ref": format!("#ovOpacity_{}", o.id), "title": "Opacity",
                "disabled": false, "value": value, "min": 0, "max": 100, "step": 1, "display": format!("{value}%")}));
        }
    }
    let on = OVERLAYS.iter().filter(|o| state.overlay(o.id).on).count();
    let sources: Vec<Value> =
        OVERLAYS.iter().map(|o| json!({"kind": "text", "style": "row", "title": o.name, "detail": o.via})).collect();
    let items = vec![
        json!({"kind": "group", "ref": "labels:layers", "pane": true, "title": "Reference layers",
            "detail": if on == 0 { "None on".to_string() } else { format!("{on} on") }, "open": true, "items": rows}),
        json!({"kind": "group", "ref": "labels:sources", "title": "About these layers", "items": [
            {"kind": "disclosure", "ref": "labels:provenance", "title": "Sources & scale", "items": sources},
        ]}),
    ];
    let (title, description) = route_info("labels").unwrap_or_default();
    json!({"route": "labels", "title": title, "description": description, "items": items})
}

/// A page for `route`, from native state.
pub fn page(route: &str, state: &AppState, fitted: &Fitted) -> Option<Value> {
    let (title, description) = route_info(route)?;
    Some(match route {
        "terrain" => terrain_page(state, fitted),
        "layers" => layers_page(state),
        "labels" => labels_page(state),
        _ => json!({"route": route, "title": title, "description": description, "items": []}),
    })
}

/// Hex colour helper for palettes in pages.
pub fn colour_hex(value: &str) -> Option<String> {
    parse_hex(value).map(hex)
}
