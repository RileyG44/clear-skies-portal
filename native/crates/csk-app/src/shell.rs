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

pub fn map_state(state: &AppState, fitted: &Fitted, bearing: f64) -> Value {
    json!({"mode": "2d", "theme": state.theme, "pointCloud": false, "terrain3d": false,
        "selecting": fitted.export.selecting, "exportScale": state.export.scale, "drawing": false, "bearing": bearing})
}

pub(crate) fn group_digits(n: i64) -> String {
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
    let overlays = crate::overlays::OVERLAYS.iter().filter(|o| o.drawn() && state.overlay(o.id).on).count();
    let layers = 1
        + overlays
        + usize::from(state.terrain.style != "off")
        + usize::from(state.elevation.on)
        + usize::from(state.elevation.bands_on());
    json!({"layers": layers.to_string(), "terrain": "1"})
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

pub(crate) fn slider(r: &str, title: &str, value: f64, min: f64, max: f64, step: f64, display: String) -> Value {
    json!({"kind": "slider", "ref": r, "title": title, "disabled": false, "value": value, "min": min, "max": max,
        "step": step, "display": display})
}

pub(crate) fn hint(text: &str) -> Value {
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
            let info = crate::overlays::find(&id["overlay:".len()..])?;
            if !info.drawn() {
                return None;
            }
            Some((info.name.into(), format!("{} · {}", info.group.name(), info.via)))
        }
        "elevation-spectrum" => Some(("Color by elevation".into(), "USGS 3DEP elevation".into())),
        "elevation-bands" => Some(("Elevation highlights".into(), "USGS 3DEP elevation".into())),
        "terrain" => {
            let t = &state.terrain;
            let title = catalog().style(&t.style).map_or("Terrain".to_string(), |s| s.label.clone());
            let detail =
                if t.source == "usgs1m" { "Elevation · prefers USGS 3.3 ft detail" } else { "USGS 3DEP elevation" };
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
    let active = |id: &str| match id {
        "elevation-spectrum" => state.elevation.on,
        "elevation-bands" => state.elevation.bands_on(),
        _ => id.strip_prefix("overlay:").is_none_or(|o| state.overlay(o).on),
    };
    let order: Vec<&String> =
        state.layer_order.iter().filter(|id| layer_title(state, id).is_some() && active(id)).collect();
    for (index, id) in order.iter().enumerate() {
        let (title, detail) = layer_title(state, id).expect("listed layer");
        let (on, opacity) = match id.strip_prefix("overlay:") {
            Some(o) => (state.overlay(o).on, state.overlay(o).opacity),
            None if *id == "elevation-spectrum" => (state.elevation.on, state.elevation.alpha),
            None if *id == "elevation-bands" => (state.elevation.bands_on(), state.elevation.band_alpha),
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

/// A reference-layer page (Labels & reference, Geology & hazards, Live
/// conditions, Past landscapes): on Live conditions the live-alert
/// controls first; each overlay's switch and, once on, its opacity, line
/// width and time slice; and where the layers come from.
fn overlay_page(route: &str, group: crate::overlays::Group, state: &AppState, fitted: &Fitted) -> Value {
    use crate::overlays::{Group, in_group};
    let mut rows = Vec::new();
    for o in in_group(group).filter(|o| o.listed) {
        let r = format!("#ov_{}", o.id);
        if !o.drawn() {
            rows.push(json!({"kind": "toggle", "ref": r, "title": o.name, "color": o.color, "value": false,
                "disabled": true, "detail": "Not in this build yet"}));
            continue;
        }
        let overlay = state.overlay(o.id);
        let mut toggle = json!({"kind": "toggle", "ref": r, "title": o.name, "color": o.color, "value": overlay.on});
        if let Some(status) = fitted.vector_status.get(o.id).filter(|_| overlay.on) {
            toggle["detail"] = json!(status);
        }
        rows.push(toggle);
        if !overlay.on {
            continue;
        }
        let spec = crate::vectors::spec(o.id);
        if let (Some(width), Some(value)) = (spec.and_then(|s| s.line_width), state.line_width(o.id)) {
            rows.push(json!({"kind": "slider", "ref": format!("#ovLine_{}", o.id), "title": width.label,
                "disabled": false, "value": value, "min": width.min, "max": width.max, "step": width.step,
                "display": format!("{} px", trim(value))}));
        }
        if let (Some(slice), Some(value)) = (spec.and_then(|s| s.slice), state.slice(o.id)) {
            let values = slice.values();
            let index = values.iter().position(|v| (v - value).abs() < 1e-9).unwrap_or(0);
            rows.push(json!({"kind": "slider", "ref": format!("#ovTime_{}", o.id), "title": slice.label,
                "disabled": false, "value": index, "min": 0, "max": values.len() - 1, "step": 1,
                "display": format!("{} {}", trim(value), slice.unit)}));
        }
        let value = overlay.opacity.round();
        rows.push(json!({"kind": "slider", "ref": format!("#ovOpacity_{}", o.id), "title": "Opacity",
            "disabled": false, "value": value, "min": 0, "max": 100, "step": 1, "display": format!("{value}%")}));
    }
    let on = in_group(group).filter(|o| o.listed && o.drawn() && state.overlay(o.id).on).count();
    // Each source, and what its publisher says it is and is not.
    let sources: Vec<Value> = in_group(group)
        .flat_map(|o| {
            let row = json!({"kind": "text", "style": "row", "title": o.name, "detail": o.via});
            std::iter::once(row).chain(o.note.map(hint))
        })
        .collect();
    let mut items = Vec::new();
    if group == Group::Conditions {
        items.push(alerts_pane(state, fitted));
    }
    items.push(json!({"kind": "group", "ref": format!("{route}:layers"), "pane": true, "title": group.pane(),
        "detail": if on == 0 { "None on".to_string() } else { format!("{on} on") }, "open": true, "items": rows}));
    items.push(json!({"kind": "group", "ref": format!("{route}:sources"), "title": "About these layers", "items": [
        {"kind": "disclosure", "ref": format!("{route}:provenance"), "title": "Sources & scale",
            "items": sources},
    ]}));
    let (title, description) = route_info(route).unwrap_or_default();
    json!({"route": route, "title": title, "description": description, "items": items})
}

/// A number without trailing zeros ("2.25", "17.5", "6").
fn trim(v: f64) -> String {
    let text = format!("{v:.2}");
    text.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// The live-alert sources and filters (index.html's alerts pane).
fn alerts_pane(state: &AppState, fitted: &Fitted) -> Value {
    let a = &state.alerts;
    let feed = |r: &str, title: &str, id: &str| json!({"kind": "toggle", "ref": r, "title": title, "value": state.overlay(id).on});
    let nws = state.overlay("weatheralerts").on;
    let mut items = vec![
        feed("#alertNws", "NWS weather", "weatheralerts"),
        feed("#alertQuakes", "USGS earthquakes", "earthquakes"),
        feed("#alertVolcanoes", "USGS volcanoes", "volcanostatus"),
        feed("#alertFires", "Active fires", "fires"),
        json!({"kind": "toggle", "ref": "#alertViewport", "title": "Current view only", "value": a.viewport}),
        json!({"kind": "picker", "ref": "#alertNwsSeverity", "title": "Weather level", "value": a.nws_severity,
        "disabled": !nws, "options": [
            {"value": "all", "title": "All advisories"},
            {"value": "watch", "title": "Watches + warnings"},
            {"value": "warning", "title": "Warnings only"},
        ]}),
    ];
    for (key, title) in crate::state::ALERT_TYPES {
        items.push(json!({"kind": "toggle", "ref": format!("#alertType_{key}"), "title": title,
            "value": a.types.get(key).copied().unwrap_or(true), "disabled": !nws}));
    }
    items.push(json!({"kind": "picker", "ref": "#alertQuakeAge", "title": "Earthquake age", "value": a.quake_age(),
    "options": [
        {"value": "hour", "title": "Past hour"},
        {"value": "day", "title": "Past day"},
        {"value": "week", "title": "Past 7 days"},
        {"value": "month", "title": "Past 30 days"},
    ]}));
    items.push(json!({"kind": "picker", "ref": "#alertQuakeMag", "title": "Minimum magnitude",
    "value": trim(a.quake_mag), "options": [
        {"value": "-1", "title": "All detected"},
        {"value": "1", "title": "M1+"},
        {"value": "2.5", "title": "M2.5+"},
        {"value": "4", "title": "M4+"},
        {"value": "5.5", "title": "M5.5+"},
    ]}));
    // The web's alert status line: each live source's count, or its state.
    let mut parts = Vec::new();
    for (id, label) in
        [("weatheralerts", "weather"), ("earthquakes", "quakes"), ("volcanoes", "volcanoes"), ("fires", "fires")]
    {
        let id = if id == "volcanoes" { "volcanostatus" } else { id };
        if state.overlay(id).on {
            parts.push(format!(
                "{label} {}",
                fitted.vector_status.get(id).map_or("loading", String::as_str).to_lowercase()
            ));
        }
    }
    let summary = if parts.is_empty() { "No live alert sources selected".to_string() } else { parts.join(" · ") };
    let scope = if a.viewport { "current view" } else { "all available" };
    items.push(json!({"kind": "text", "style": "hint", "title": summary}));
    items.push(json!({"kind": "text", "style": "hint", "title": format!("Automatic refresh · {scope} · NWS/USGS official feeds")}));
    let on =
        ["weatheralerts", "earthquakes", "volcanostatus", "fires"].iter().filter(|id| state.overlay(id).on).count();
    json!({"kind": "group", "ref": "conditions:alerts", "pane": true, "title": "Live conditions",
        "detail": if on == 0 { String::new() } else { format!("{on} on") }, "open": true, "items": items})
}

/// Pages that do not have a native implementation in this demo.
pub fn unavailable(route: &str) -> Option<Value> {
    let (title, description) = route_info(route)?;
    Some(json!({"route":route,"title":title,"description":description,"items":[
        hint(&format!("{title} isn't in this build yet.")), hint(&description)
    ]}))
}

/// Sources for the map content that is actually enabled. Terrain attribution
/// covers its source tiers without claiming the overview is survey detail.
pub fn map_sources(state: &AppState) -> Value {
    let mut items = vec![
        json!({"kind":"text","style":"row","title":"Reference basemap","detail":"Esri Canvas · Esri, HERE, Garmin, OpenStreetMap contributors"}),
    ];
    if state.terrain.style != "off" || state.elevation.on || state.elevation.bands_on() {
        items.push(json!({"kind":"text","style":"row","title":"Elevation sources","detail":"USGS 3DEP · AWS Terrain Tiles overview"}));
        if state.terrain.source == "auto" {
            items.push(json!({"kind":"text","style":"row","title":"Regional detail where available","detail":"Washington DNR · Oregon DOGAMI"}));
        }
    }
    for o in crate::overlays::OVERLAYS.iter().filter(|o| o.drawn() && state.overlay(o.id).on) {
        items.push(json!({"kind":"text","style":"row","title":o.name,"detail":o.via}));
        if let Some(note) = o.note {
            items.push(hint(note));
        }
    }
    json!({"kind":"disclosure","ref":"settings:sources","title":"Map sources","items":items})
}

fn settings_page(state: &AppState, fitted: &Fitted) -> Value {
    let (title, description) = route_info("settings").unwrap_or_default();
    json!({"route":"settings","title":title,"description":description,"items":[
        {"kind":"group","ref":"settings:engine","title":"Terrain engine","items":[
            {"kind":"text","style":"row","title":"Secure terrain engine · built into this app"}
        ]},
        {"kind":"group","ref":"settings:device","title":"This device","items":[
            {"kind":"text","style":"row","title":"Build details","detail":fitted.build.as_deref().unwrap_or("App version unavailable")},
            {"kind":"text","style":"row","title":"Terrain engine version","detail":csk_engine::VERSION},
            {"kind":"button","ref":"settings:resetPreferences","title":"Reset app preferences","role":"link","hint":"Resets appearance, dock order, layer order and pane states. Map content stays."},
            {"kind":"button","ref":"settings:resetMenuLayout","title":"Reset menu layout","role":"link"}
        ]},
        {"kind":"group","ref":"settings:sources:group","title":"About the map","items":[map_sources(state)]}
    ]})
}

/// Dock panels use the same active layer controls as the full page.
pub fn panel_for_tool(tool: &str) -> Option<&'static str> {
    match tool {
        "quickDraw" => Some("mkBar"),
        "snapshot" => Some("snapshotPanel"),
        "terrainSourceToggle" => Some("terrainSourcePanel"),
        "serverToggle" => Some("serverPanel"),
        "mapModeToggle" => Some("mapModePanel"),
        _ => None,
    }
}
/// What the engine panel reports: stored map data, and working memory in
/// use of its limit (bytes).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Usage {
    pub cache: u64,
    pub memory: (usize, usize),
}

pub fn panel(id: &str, state: &AppState, fitted: &Fitted, usage: Usage) -> Option<Value> {
    let (title, items) = match id {
        "terrainSourcePanel" => {
            let p = layers_page(state);
            let rows: Vec<Value> =
                p["items"].as_array()?.iter().take_while(|r| r["title"] != "Add layers").cloned().collect();
            ("Layers", rows)
        }
        "serverPanel" => (
            "Terrain engine",
            vec![
                json!({"kind":"text","style":"row","title":"Terrain engine built into this app"}),
                json!({"kind":"text","style":"row","title":"Stored map data","detail":format!("{:.1} MiB",usage.cache as f64 / 1048576.0)}),
                json!({"kind":"text","style":"row","title":"Working memory","detail":format!("{:.0} of {:.0} MiB",
                    usage.memory.0 as f64 / 1048576.0, usage.memory.1 as f64 / 1048576.0)}),
            ],
        ),
        "mkBar" => ("Draw & annotate", unavailable("markup")?["items"].as_array()?.clone()),
        "snapshotPanel" => ("Export image", crate::export::items(&state.export, &fitted.export)),
        "mapModePanel" => (
            "Map view",
            vec![hint("3D and point-cloud views aren't in this build yet. The map uses the native 2D terrain view.")],
        ),
        _ => return None,
    };
    Some(json!({"id":id,"title":title,"items":items}))
}

/// A page for `route`, from native state.
pub fn page(route: &str, state: &AppState, fitted: &Fitted) -> Option<Value> {
    route_info(route)?;
    Some(match route {
        "terrain" => terrain_page(state, fitted),
        "layers" => layers_page(state),
        "elevation" => crate::elevation::page(&state.elevation),
        "appearance" => crate::appearance::page(&state.appearance),
        "settings" => settings_page(state, fitted),
        "export" => {
            let (title, description) = route_info(route)?;
            json!({"route": route, "title": title, "description": description,
                "items": crate::export::items(&state.export, &fitted.export)})
        }
        "labels" | "geology" | "conditions" | "past" => {
            let group = crate::overlays::Group::for_route(route)?;
            overlay_page(route, group, state, fitted)
        }
        _ => unavailable(route)?,
    })
}

/// Hex colour helper for palettes in pages.
pub fn colour_hex(value: &str) -> Option<String> {
    parse_hex(value).map(hex)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dock_panels_share_live_layer_controls_and_show_hints_for_unfinished_tools() {
        let mut state = AppState::default();
        state.set_overlay("snowdepth", true);
        let p = panel("terrainSourcePanel", &state, &Fitted::default(), Usage::default()).unwrap();
        let expected = layers_page(&state);
        let rows: Vec<Value> =
            expected["items"].as_array().unwrap().iter().take_while(|r| r["title"] != "Add layers").cloned().collect();
        assert_eq!(p["items"], json!(rows));
        for tool in ["quickDraw", "mapModeToggle"] {
            let p = panel(panel_for_tool(tool).unwrap(), &state, &Fitted::default(), Usage::default()).unwrap();
            assert_eq!(p["items"][0]["style"], "hint");
        }
        // The snapshot tool opens the Export page's own controls.
        let p = panel("snapshotPanel", &state, &Fitted::default(), Usage::default()).unwrap();
        assert_eq!(p["items"], page("export", &state, &Fitted::default()).unwrap()["items"]);
        let p = panel("serverPanel", &state, &Fitted::default(), Usage { cache: 10485760, memory: (0, 0) }).unwrap();
        assert_eq!(p["items"][1]["detail"], "10.0 MiB");
    }
    #[test]
    fn every_route_has_content_and_settings_only_advertises_supported_controls() {
        let mut state = AppState::default();
        state.set_overlay("wafaults", true);
        for route in groups().as_array().unwrap().iter().flat_map(|g| g["routes"].as_array().unwrap()) {
            let p = page(route["key"].as_str().unwrap(), &state, &Fitted::default()).unwrap();
            assert!(!p["items"].as_array().unwrap().is_empty(), "{route}");
        }
        for route in ["satellite", "analyze", "markup"] {
            let p = page(route, &state, &Fitted::default()).unwrap();
            assert_eq!(p["items"][0]["style"], "hint");
            assert!(p["items"][0]["title"].as_str().unwrap().contains("isn't in this build yet"));
        }
        let p = page("settings", &state, &Fitted::default()).unwrap().to_string();
        assert!(p.contains("built into this app") && p.contains("WA active faults"));
        for unsupported in ["Manage terrain engine", "Smoother panning", "Reduce motion", "Image export"] {
            assert!(!p.contains(unsupported));
        }
        state.terrain.source = "usgs1m".into();
        assert!(!layer_title(&state, "terrain").unwrap().1.contains("LiDAR"));
    }
    #[test]
    fn overlay_pages_list_every_layer_with_its_controls() {
        let mut state = AppState::default();
        state.set_overlay("wafaults", true);
        let geology = page("geology", &state, &Fitted::default()).unwrap();
        let rows = geology["items"][0]["items"].as_array().unwrap();
        assert!(rows.iter().any(|r| r["ref"] == "#ov_wafaults" && r["value"] == true));
        assert!(rows.iter().any(|r| r["ref"] == "#ovOpacity_wafaults" && r["value"] == 86.0));
        assert_eq!(layer_title(&state, "overlay:wafaults").unwrap().1, "Geology & hazards · WGS · DDS-1");
        assert!(geology["items"][1].to_string().contains("site-specific setback"));
        // Every listed overlay is a working switch; none is a dead end.
        for group in crate::overlays::Group::ALL {
            let p = page(group.route(), &state, &Fitted::default()).unwrap();
            let layers =
                p["items"].as_array().unwrap().iter().find(|g| g["ref"] == format!("{}:layers", group.route()));
            let rows = layers.unwrap()["items"].as_array().unwrap();
            for o in crate::overlays::in_group(group).filter(|o| o.listed) {
                let row = rows.iter().find(|r| r["ref"] == format!("#ov_{}", o.id)).unwrap();
                assert!(row["disabled"].is_null(), "{}", o.id);
                assert!(layer_title(&state, &format!("overlay:{}", o.id)).is_some());
            }
            assert!(!p.to_string().contains("in this build"), "{}", group.route());
        }
        // Vector layers offer their line width and time slice once on.
        state.set_overlay("waice", true);
        state.set_overlay("nadi1ice", true);
        let past = page("past", &state, &Fitted::default()).unwrap();
        let rows = past["items"][0]["items"].as_array().unwrap();
        let line = rows.iter().find(|r| r["ref"] == "#ovLine_waice").unwrap();
        assert_eq!((line["value"].as_f64(), line["display"].as_str()), (Some(2.25), Some("2.25 px")));
        let time = rows.iter().find(|r| r["ref"] == "#ovTime_nadi1ice").unwrap();
        assert_eq!(
            (time["value"].as_u64(), time["max"].as_u64(), time["display"].as_str()),
            (Some(15), Some(29), Some("17.5 ka"))
        );
        // Live conditions leads with its feeds and filters; fires come from there.
        let conditions = page("conditions", &state, &Fitted::default()).unwrap();
        assert_eq!(conditions["items"][0]["ref"], "conditions:alerts");
        assert!(conditions["items"][0].to_string().contains("#alertFires"));
        assert!(!conditions["items"][1].to_string().contains("#ov_fires"));
        assert_eq!(state.overlay("water").opacity, 5.0);
        assert_eq!(state.overlay("snowdepth").opacity, 70.0);
    }
}
