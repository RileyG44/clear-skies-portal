//! The vector overlays (app/overlays.js GeoJSON layers and live feeds, and
//! the active fires of app/map-menu.js): where their features come from,
//! which are shown, how they draw (`ovGeoStyle`, `ovPointStyle`), and what
//! a tap on one says (`ovPointPopup`, `ovFeaturePopup`).

use std::time::Duration;

use csk_gpu::{Geometry, Marker, Point, Shape, Shapes, Style, View};
use serde_json::{Map as Object, Value, json};

use crate::state::Alerts;

/// A source's age limit before it is asked again.
const MONTH: Duration = Duration::from_secs(30 * 24 * 3600);
const FIVE_MINUTES: Duration = Duration::from_secs(5 * 60);
const FIFTEEN_MINUTES: Duration = Duration::from_secs(15 * 60);
const TEN_MINUTES: Duration = Duration::from_secs(10 * 60);

/// Where a layer's features come from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Source {
    /// A fixed query of a published service.
    Url(&'static str),
    /// Shipped with the app.
    Bundled(&'static [u8]),
    /// NOAA/NWS watches, warnings and advisories (`loadNwsWeatherAlerts`).
    Nws,
    /// The USGS earthquake summary feed (`loadEarthquakeAlerts`).
    Quakes,
    /// USGS Volcano Science Center status (`loadVolcanoAlerts`).
    Volcanoes,
    /// NIFC/WFIGS perimeters and incidents (`loadFires`).
    Fires,
    /// The bundled Maxar Open Data index (`loadMaxarFootprints`).
    Maxar(&'static [u8]),
}

/// A line-width slider (`lineWidth`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineWidth {
    pub label: &'static str,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub default: f64,
}

/// A time-slice slider (`timeSlice`): values oldest first.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slice {
    pub label: &'static str,
    pub unit: &'static str,
    pub default: f64,
    pub oldest: f64,
    pub newest: f64,
    pub step: f64,
}

impl Slice {
    pub fn values(&self) -> Vec<f64> {
        let n = ((self.oldest - self.newest) / self.step).round() as usize;
        (0..=n).map(|i| self.oldest - i as f64 * self.step).collect()
    }

    /// The nearest offered value.
    pub fn snap(&self, value: f64) -> f64 {
        let values = self.values();
        values.into_iter().min_by(|a, b| (a - value).abs().total_cmp(&(b - value).abs())).unwrap_or(self.default)
    }
}

pub struct Spec {
    pub id: &'static str,
    pub source: Source,
    pub ttl: Duration,
    pub line_width: Option<LineWidth>,
    pub slice: Option<Slice>,
    /// A tap on a feature shows its details instead of selecting a place.
    pub interactive: bool,
}

const NADI1: &[u8] = include_bytes!("../../../../nadi1-cordilleran.json");
const MAXAR: &[u8] = include_bytes!("../../../../maxar-catalog.json");
const ARCHAEOLOGY: &[u8] = include_bytes!("../../../shaders/generated/wa-archaeology.json");

pub const SPECS: &[Spec] = &[
    Spec {
        id: "waice",
        source: Source::Url(
            "https://gis.dnr.wa.gov/site1/rest/services/Public_Geology/250k_Surface_Geology/MapServer/0/query?where=1%3D1&outFields=OBJECTID&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=5&f=geojson",
        ),
        ttl: MONTH,
        line_width: Some(LineWidth {
            label: "Glacier / ice-limit border",
            min: 0.5,
            max: 6.0,
            step: 0.25,
            default: 2.25,
        }),
        slice: None,
        interactive: false,
    },
    Spec {
        id: "waflood",
        source: Source::Url(
            "https://services.arcgis.com/4x406oNViizbGo13/arcgis/rest/services/Ice_Age_Floods_National_Geologic_Trail_and_Sites/FeatureServer/2/query?where=1%3D1&outFields=ID&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=5&f=geojson",
        ),
        ttl: MONTH,
        line_width: None,
        slice: None,
        interactive: false,
    },
    Spec {
        id: "paleolakes",
        source: Source::Url(
            "https://services1.arcgis.com/igNkUJZ7SGoMjDNi/arcgis/rest/services/GlacialH2O_V1/FeatureServer/0/query?where=POLY_TYPE%3D%27Lake%27&outFields=POLY_TYPE&returnGeometry=true&outSR=4326&maxAllowableOffset=0.001&geometryPrecision=5&f=geojson",
        ),
        ttl: MONTH,
        line_width: Some(LineWidth { label: "Lake border", min: 0.5, max: 6.0, step: 0.25, default: 1.2 }),
        slice: None,
        interactive: false,
    },
    Spec {
        id: "nadi1ice",
        source: Source::Bundled(NADI1),
        ttl: MONTH,
        line_width: None,
        slice: Some(Slice { label: "Ice margin at", unit: "ka", default: 17.5, oldest: 25.0, newest: 10.5, step: 0.5 }),
        interactive: false,
    },
    Spec {
        id: "waarchaeology",
        source: Source::Bundled(ARCHAEOLOGY),
        ttl: MONTH,
        line_width: None,
        slice: None,
        interactive: true,
    },
    Spec {
        id: "weatheralerts",
        source: Source::Nws,
        ttl: FIVE_MINUTES,
        line_width: None,
        slice: None,
        interactive: true,
    },
    Spec {
        id: "earthquakes",
        source: Source::Quakes,
        ttl: FIVE_MINUTES,
        line_width: None,
        slice: None,
        interactive: true,
    },
    Spec {
        id: "volcanostatus",
        source: Source::Volcanoes,
        ttl: FIFTEEN_MINUTES,
        line_width: None,
        slice: None,
        interactive: true,
    },
    Spec { id: "fires", source: Source::Fires, ttl: TEN_MINUTES, line_width: None, slice: None, interactive: true },
    Spec { id: "maxarvhr", source: Source::Maxar(MAXAR), ttl: MONTH, line_width: None, slice: None, interactive: true },
];

pub fn spec(id: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.id == id)
}

/// A parsed feature: Web Mercator geometry and its properties.
#[derive(Clone, Debug, PartialEq)]
pub struct Feature {
    pub geometry: Geo,
    pub props: Object<String, Value>,
    /// The third coordinate of a point (an earthquake's depth, km).
    pub depth: Option<f64>,
    /// Which of a source's collections it came from (fires: 0 perimeters,
    /// 1 incidents).
    pub part: u8,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Geo {
    Point([f64; 2]),
    Lines(Vec<Vec<[f64; 2]>>),
    /// Polygons, each its rings.
    Areas(Vec<Vec<Vec<[f64; 2]>>>),
}

fn mercator(c: &Value) -> Option<[f64; 2]> {
    let (lon, lat) = (c.get(0)?.as_f64()?, c.get(1)?.as_f64()?);
    if !lon.is_finite() || !lat.is_finite() {
        return None;
    }
    let lat = lat.clamp(-85.051_128_78, 85.051_128_78).to_radians();
    Some([(lon + 180.0) / 360.0, (1.0 - (lat.tan() + 1.0 / lat.cos()).ln() / std::f64::consts::PI) / 2.0])
}

fn line(v: &Value) -> Vec<[f64; 2]> {
    v.as_array().map(|a| a.iter().filter_map(mercator).collect()).unwrap_or_default()
}

fn rings(v: &Value) -> Vec<Vec<[f64; 2]>> {
    v.as_array().map(|a| a.iter().map(line).filter(|r| r.len() >= 3).collect()).unwrap_or_default()
}

fn geometries(g: &Value, out: &mut Vec<Geo>) {
    let c = &g["coordinates"];
    match g["type"].as_str() {
        Some("Point") => out.extend(mercator(c).map(Geo::Point)),
        Some("MultiPoint") => out.extend(c.as_array().into_iter().flatten().filter_map(mercator).map(Geo::Point)),
        Some("LineString") => out.push(Geo::Lines(vec![line(c)])),
        Some("MultiLineString") => out.push(Geo::Lines(c.as_array().into_iter().flatten().map(line).collect())),
        Some("Polygon") => out.push(Geo::Areas(vec![rings(c)])),
        Some("MultiPolygon") => out.push(Geo::Areas(c.as_array().into_iter().flatten().map(rings).collect())),
        Some("GeometryCollection") => {
            for g in g["geometries"].as_array().into_iter().flatten() {
                geometries(g, out);
            }
        }
        _ => {}
    }
}

/// The Maxar index's footprints as features: each a rectangle with its
/// event's title, dates, licence and collection.
pub fn parse_maxar(bytes: &[u8]) -> Option<Vec<Feature>> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    let mut out = Vec::new();
    for event in v["events"].as_array()? {
        let mut props = Object::new();
        for key in ["title", "start", "end", "url"] {
            props.insert(key.into(), event[key].clone());
        }
        let title = event["title"].as_str().or(event["id"].as_str()).unwrap_or("Maxar Open Data");
        props.insert("title".into(), json!(title));
        props.insert("license".into(), event.get("license").or(v.get("license")).cloned().unwrap_or(Value::Null));
        for b in event["footprints"].as_array().into_iter().flatten() {
            let b: Vec<f64> = b.as_array().into_iter().flatten().filter_map(Value::as_f64).collect();
            let [west, south, east, north] = b[..] else { continue };
            let ring: Vec<[f64; 2]> = [[west, south], [east, south], [east, north], [west, north]]
                .iter()
                .filter_map(|c| mercator(&json!(c)))
                .collect();
            if ring.len() == 4 {
                out.push(Feature {
                    geometry: Geo::Areas(vec![vec![ring]]),
                    props: props.clone(),
                    depth: None,
                    part: 0,
                });
            }
        }
    }
    Some(out)
}

/// The features of a GeoJSON FeatureCollection. None if it is not one.
pub fn parse(bytes: &[u8], part: u8) -> Option<Vec<Feature>> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    if v["type"] != "FeatureCollection" {
        return None;
    }
    let mut out = Vec::new();
    for f in v["features"].as_array()? {
        let props = f["properties"].as_object().cloned().unwrap_or_default();
        let depth = f["geometry"]["coordinates"].get(2).and_then(Value::as_f64);
        let mut parts = Vec::new();
        geometries(&f["geometry"], &mut parts);
        for geometry in parts {
            out.push(Feature { geometry, props: props.clone(), depth, part });
        }
    }
    Some(out)
}

/// West, south, east and north of the view, padded by `pad` of its size on
/// each side (Leaflet `pad`), clamped to the Web Mercator world.
pub fn view_bounds(view: &View, pad: f64) -> [f64; 4] {
    let world = 256.0 * view.zoom.exp2();
    let (sin, cos) = view.bearing.to_radians().sin_cos();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for (u, v) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
        let (u, v) = (u * view.css[0] / 2.0, v * view.css[1] / 2.0);
        let (x, y) = (view.center[0] + (u * cos + v * sin) / world, view.center[1] + (-u * sin + v * cos) / world);
        (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
    }
    let (dx, dy) = ((x1 - x0) * pad, (y1 - y0) * pad);
    let lon = |x: f64| x * 360.0 - 180.0;
    let lat = |y: f64| (std::f64::consts::PI * (1.0 - 2.0 * y)).sinh().atan().to_degrees();
    let (mut west, mut east) = (lon(x0 - dx), lon(x1 + dx));
    if east - west >= 360.0 {
        (west, east) = (-180.0, 180.0);
    }
    [west.max(-180.0), lat(y1 + dy).max(-85.0), east.min(180.0), lat(y0 - dy).min(85.0)]
}

/// Whether bounds lie inside others.
pub fn inside(inner: [f64; 4], outer: [f64; 4]) -> bool {
    inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3]
}

fn envelope(b: [f64; 4]) -> String {
    format!("{:.5}%2C{:.5}%2C{:.5}%2C{:.5}", b[0], b[1], b[2], b[3])
}

const NWS: &str = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query";
const FIRE_PERIMETERS: &str = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";
const FIRE_INCIDENTS: &str =
    "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/USA_Wildfires_v1/FeatureServer/0/query";

/// What a source must fetch for the view: its URLs and the bounds they
/// cover (None: the whole source).
pub fn request(spec: &Spec, alerts: &Alerts, view: Option<&View>) -> (Vec<String>, Option<[f64; 4]>) {
    match spec.source {
        Source::Url(url) => (vec![url.into()], None),
        Source::Bundled(_) | Source::Maxar(_) => (Vec::new(), None),
        Source::Nws => {
            // Beyond the screen, so ordinary pans stay inside the answer.
            let bounds = view.filter(|_| alerts.viewport).map(|v| view_bounds(v, 0.35));
            let mut url = format!(
                "{NWS}?where=1%3D1&outSR=4326&geometryPrecision=5&maxAllowableOffset={}&outFields=objectid%2Cprod_type%2Cmsg_type%2Csig%2Curl%2Cexpiration%2Conset%2Cissuance%2Cevent%2Cwfo&returnGeometry=true&f=geojson",
                if bounds.is_some() { "0.001" } else { "0.02" }
            );
            if let Some(b) = bounds {
                url.push_str(&format!("&geometry={}&geometryType=esriGeometryEnvelope&inSR=4326", envelope(b)));
            }
            (vec![url], bounds)
        }
        Source::Quakes => (
            vec![format!(
                "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_{}.geojson",
                alerts.quake_age()
            )],
            None,
        ),
        Source::Volcanoes => (vec!["https://volcanoes.usgs.gov/vsc/api/volcanoApi/geojson".into()], None),
        Source::Fires => {
            let pad = if view.is_some_and(|v| v.zoom < 5.0) { 0.2 } else { 0.7 };
            let b = view.map_or([-180.0, -85.0, 180.0, 85.0], |v| view_bounds(v, pad));
            let query = |base: &str, fields: &str| {
                format!(
                    "{base}?where=1%3D1&outFields={fields}&geometry={}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&resultRecordCount=2000&f=geojson",
                    envelope(b)
                )
            };
            (
                vec![
                    query(FIRE_PERIMETERS, "poly_IncidentName%2Cpoly_GISAcres%2Cattr_PercentContained"),
                    query(FIRE_INCIDENTS, "IncidentName%2CDailyAcres%2CPercentContained%2CFireDiscoveryDateTime"),
                ],
                Some(b),
            )
        }
    }
}

fn text<'a>(p: &'a Object<String, Value>, key: &str) -> &'a str {
    p.get(key).and_then(Value::as_str).unwrap_or("")
}

fn num(p: &Object<String, Value>, key: &str) -> Option<f64> {
    match p.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
    .filter(|v: &f64| v.is_finite())
}

fn has(name: &str, words: &[&str]) -> bool {
    let lower = name.to_lowercase();
    words.iter().any(|w| lower.contains(&w.to_lowercase()))
}

/// The NWS alert type a filter switch covers (`nwsAlertCategory`).
pub fn nws_category(p: &Object<String, Value>) -> &'static str {
    let name = if text(p, "prod_type").is_empty() { text(p, "event") } else { text(p, "prod_type") };
    if has(
        name,
        &[
            "Tsunami",
            "Marine",
            "Coastal",
            "Surf",
            "Rip Current",
            "Beach",
            "Hurricane",
            "Tropical",
            "Typhoon",
            "Storm Surge",
            "Small Craft",
        ],
    ) {
        "coast"
    } else if has(name, &["Fire", "Red Flag", "Smoke", "Ashfall"]) {
        "fire"
    } else if has(name, &["Winter", "Snow", "Blizzard", "Ice", "Avalanche", "Sleet"]) {
        "winter"
    } else if has(name, &["Heat", "Cold", "Freeze", "Frost", "Air Quality", "Stagnation", "Fog"]) {
        "temperature"
    } else if has(name, &["Tornado", "Thunderstorm", "Flood", "Wind", "Hail", "Dust", "Rain", "Lightning", "Squall"]) {
        "storm"
    } else {
        "other"
    }
}

/// 2 warning, 1 watch, 0 advisory or statement (`nwsAlertRank`).
pub fn nws_rank(p: &Object<String, Value>) -> u8 {
    let sig = text(p, "sig").to_uppercase();
    let name = text(p, "prod_type");
    if sig == "W" || has(name, &["Warning", "Emergency", "Evacuation"]) {
        2
    } else if sig == "A" || has(name, &["Watch"]) {
        1
    } else {
        0
    }
}

/// Whether a feature passes the person's filters for its layer.
pub fn shown(id: &str, f: &Feature, alerts: &Alerts, slice: Option<f64>) -> bool {
    match id {
        "weatheralerts" => {
            let threshold = match alerts.nws_severity.as_str() {
                "watch" => 1,
                "warning" => 2,
                _ => 0,
            };
            nws_rank(&f.props) >= threshold && alerts.types.get(nws_category(&f.props)).copied().unwrap_or(true)
        }
        "earthquakes" => num(&f.props, "mag").is_none_or(|m| m >= alerts.quake_mag),
        "nadi1ice" => slice.is_some_and(|s| num(&f.props, "ka").is_some_and(|ka| (ka - s).abs() < 1e-6)),
        _ => true,
    }
}

fn hex(colour: &str, alpha: f64) -> [f32; 4] {
    let c = crate::terrain::parse_hex(colour).unwrap_or([1.0; 4]);
    [c[0] as f32, c[1] as f32, c[2] as f32, alpha as f32]
}

fn style(line: &str, width: f64, opacity: f64, fill: Option<(&str, f64)>, dash: [f32; 2]) -> Style {
    Style {
        fill: fill.map_or([0.0; 4], |(c, a)| hex(c, a)),
        line: if opacity > 0.0 { hex(line, opacity) } else { [0.0; 4] },
        width: width as f32,
        dash,
    }
}

/// An area or line feature's style (`ovGeoStyle` at full opacity; the layer
/// opacity applies on the GPU).
fn area_style(id: &str, f: &Feature, width: Option<f64>) -> Style {
    match id {
        "weatheralerts" => {
            let rank = nws_rank(&f.props);
            let colour = match rank {
                2 => "#ff4f5e",
                1 => "#f5a33b",
                _ => "#54a7e8",
            };
            let fill = match rank {
                2 => 0.18,
                1 => 0.13,
                _ => 0.09,
            };
            style(
                colour,
                if rank >= 2 { 2.4 } else { 1.8 },
                0.96,
                Some((colour, fill)),
                if rank == 0 { [5.0, 4.0] } else { [0.0; 2] },
            )
        }
        "nadi1ice" => match text(&f.props, "kind") {
            "ice" => style("#e4f6ff", 0.0, 0.0, Some(("#e4f6ff", 0.46)), [0.0; 2]),
            "max" => style("#ff6b6b", 1.6, 0.92, None, [7.0, 5.0]),
            "min" => style("#f2c744", 1.6, 0.92, None, [2.0, 5.0]),
            _ => style("#ffffff", 2.2, 0.96, None, [0.0; 2]),
        },
        "waice" => style("#7ed9ee", width.unwrap_or(2.25), 0.95, None, [0.0; 2]),
        "waflood" => style("#25a9c4", 1.4, 0.95, Some(("#36c4de", 0.44)), [0.0; 2]),
        "paleolakes" => style("#5c9df2", width.unwrap_or(1.2), 0.95, Some(("#69b7ff", 0.42)), [0.0; 2]),
        // Leaflet's default path: 3 px #3388ff, no fill.
        "maxarvhr" => style("#3388ff", 3.0, 1.0, None, [0.0; 2]),
        // Fire perimeters.
        _ => style("#f85149", 2.0, 1.0, Some(("#f85149", 0.22)), [0.0; 2]),
    }
}

/// A point feature's marker (`ovPointStyle`, and the fires' incidents).
fn point_marker(id: &str, f: &Feature, at: [f64; 2]) -> Marker {
    let p = &f.props;
    let marker = |radius: f64, stroke: f64, line: [f32; 4], fill: [f32; 4], dash: [f32; 2]| Marker {
        at,
        radius: radius as f32,
        stroke: stroke as f32,
        fill,
        line,
        dash,
    };
    match id {
        "earthquakes" => {
            let mag = num(p, "mag");
            let colour = match f.depth {
                None => "#aeb7c2",
                Some(d) if d < 35.0 => "#ff6a5b",
                Some(d) if d < 70.0 => "#f1aa43",
                Some(d) if d < 300.0 => "#4fa9e8",
                Some(_) => "#8c73d6",
            };
            let radius = (3.0 + mag.map_or(0.0, |m| m.max(0.0) * 1.35)).clamp(3.0, 13.0);
            marker(radius, 1.0, hex("#ffffff", 0.82), hex(colour, 0.82), [0.0; 2])
        }
        "waarchaeology" => {
            let precision = text(p, "precision");
            let lead = p.get("researchLead").and_then(Value::as_bool).unwrap_or(false);
            let colour = match precision {
                "estimated" => "#f0b35a",
                "generalized" => "#b28ada",
                _ => "#56c9a7",
            };
            marker(
                if lead { 7.0 } else { 6.0 },
                if lead { 1.5 } else { 1.1 },
                hex("#ffffff", 0.9),
                hex(colour, if lead { 0.28 } else { 0.78 }),
                if precision == "estimated" { [3.0, 2.0] } else { [0.0; 2] },
            )
        }
        "fires" => {
            let acres = num(p, "DailyAcres").unwrap_or(0.0);
            let radius = ((acres + 10.0).log10() * 5.0).clamp(5.0, 16.0);
            marker(radius, 2.0, hex("#ff7b72", 1.0), hex("#f85149", 0.8), [0.0; 2])
        }
        // Volcano status.
        _ => {
            let colour = match text(p, "colorCode").to_uppercase().as_str() {
                "RED" => "#f04444",
                "ORANGE" => "#f08a3c",
                "YELLOW" => "#e9bd39",
                "GREEN" => "#4caf78",
                _ => "#8c96a4",
            };
            marker(6.0, 1.25, hex("#ffffff", 0.9), hex(colour, 0.88), [0.0; 2])
        }
    }
}

/// The shapes a layer draws from its features, with each shape's feature
/// index for identifying taps.
pub fn shapes(id: &str, features: &[Feature], alerts: &Alerts, width: Option<f64>, slice: Option<f64>) -> Shapes {
    let mut out = Shapes::default();
    let mut styles: Vec<Style> = Vec::new();
    let mut style_index = |s: Style| -> u32 {
        if let Some(i) = styles.iter().position(|o| *o == s) {
            return i as u32;
        }
        styles.push(s);
        (styles.len() - 1) as u32
    };
    for (index, f) in features.iter().enumerate() {
        if !shown(id, f, alerts, slice) {
            continue;
        }
        let feature = index as u32;
        match &f.geometry {
            Geo::Point(at) => out.points.push(Point { marker: point_marker(id, f, *at), feature }),
            Geo::Lines(lines) => {
                let style = style_index(area_style(id, f, width));
                for line in lines.iter().filter(|l| l.len() >= 2) {
                    out.shapes.push(Shape { geometry: Geometry::Line(line.clone()), style, feature });
                }
            }
            Geo::Areas(polygons) => {
                let style = style_index(area_style(id, f, width));
                for rings in polygons.iter().filter(|r| !r.is_empty()) {
                    out.shapes.push(Shape { geometry: Geometry::Area(rings.clone()), style, feature });
                }
            }
        }
    }
    out.styles = styles;
    out
}

/// Whether a feature lies in the view (padded by 15%), as the web counts
/// the current view's alerts.
pub fn in_view(f: &Feature, bounds: [f64; 4]) -> bool {
    let at = match &f.geometry {
        Geo::Point(p) => *p,
        Geo::Lines(l) => match l.first().and_then(|l| l.first()) {
            Some(p) => *p,
            None => return false,
        },
        Geo::Areas(a) => match a.first().and_then(|r| r.first()).and_then(|r| r.first()) {
            Some(p) => *p,
            None => return false,
        },
    };
    let lon = at[0] * 360.0 - 180.0;
    let lat = (std::f64::consts::PI * (1.0 - 2.0 * at[1])).sinh().atan().to_degrees();
    lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3]
}

/// Unix milliseconds as a UTC date and time ("6 Nov 2026, 14:05 UTC").
pub fn utc(ms: f64) -> String {
    if !ms.is_finite() {
        return String::new();
    }
    let secs = (ms / 1000.0).floor() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    format!("{day} {} {year}, {:02}:{:02} UTC", MONTHS[(month - 1) as usize], rem / 3600, rem % 3600 / 60)
}

/// Unix milliseconds of an ISO 8601 time with an offset or Z
/// ("2026-11-06T18:30:00-07:00").
fn iso_ms(s: &str) -> Option<f64> {
    let s = s.trim();
    let field = |range: std::ops::Range<usize>| s.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (field(0..4)?, field(5..7)?, field(8..10)?);
    let (hour, minute) = (field(11..13)?, field(14..16)?);
    let second = field(17..19).unwrap_or(0);
    let zone = s.get(19..)?.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    let offset = match zone {
        "" | "Z" => 0,
        z => {
            let sign = if z.starts_with('-') { -1 } else { 1 };
            let (h, m) =
                (z.get(1..3)?.parse::<i64>().ok()?, z.get(4..6).and_then(|m| m.parse::<i64>().ok()).unwrap_or(0));
            sign * (h * 3600 + m * 60)
        }
    };
    // Days since 1970 from a civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + hour * 3600 + minute * 60 + second - offset) * 1000) as f64)
}

/// A date the NWS service sends: epoch milliseconds or an ISO string.
fn when(v: Option<&Value>) -> String {
    match v {
        Some(Value::Number(n)) => n.as_f64().map(utc).unwrap_or_default(),
        Some(Value::String(s)) if !s.is_empty() => iso_ms(s).map_or_else(|| s.clone(), utc),
        _ => String::new(),
    }
}

/// Only http(s) links are offered (`safeHttpUrl`).
fn link(title: &str, url: &str) -> Option<Value> {
    (url.starts_with("https://") || url.starts_with("http://")).then(|| json!({"kind":"link","title":title,"href":url}))
}

fn row(title: &str, value: impl Into<String>) -> Option<Value> {
    let value = value.into();
    (!value.is_empty()).then(|| json!({"kind":"text","style":"row","title":title,"value":value}))
}

fn hint(text: &str) -> Option<Value> {
    (!text.is_empty()).then(|| json!({"kind":"text","style":"hint","title":text}))
}

fn thousands(v: f64) -> String {
    let digits = format!("{}", v.round() as i64);
    let (sign, digits) = digits.strip_prefix('-').map_or(("", digits.as_str()), |d| ("-", d));
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    format!("{sign}{out}")
}

/// A tapped feature's title and the rows describing it (the web pop-up).
pub fn details(id: &str, f: &Feature) -> (String, Vec<Value>) {
    let p = &f.props;
    let or = |key: &str, fallback: &str| {
        let t = text(p, key);
        if t.is_empty() { fallback.to_owned() } else { t.to_owned() }
    };
    let (title, items): (String, Vec<Option<Value>>) = match id {
        "earthquakes" => (
            or("place", "Earthquake"),
            vec![
                row("Magnitude", num(p, "mag").map_or("not reported".into(), |m| format!("{m:.1}"))),
                row("Depth", f.depth.map_or("not reported".into(), |d| format!("{:.1} mi", d * 0.621_371))),
                row("Time", num(p, "time").map(utc).unwrap_or_default()),
                hint("Preliminary real-time values; USGS can revise them."),
                link("Open USGS event", text(p, "url")),
            ],
        ),
        "volcanostatus" => (
            or("volcanoName", "US volcano"),
            vec![
                row("Region", text(p, "region")),
                row("Alert level", or("alertLevel", "unassigned")),
                row("Aviation color", or("colorCode", "unassigned")),
                row("Threat", text(p, "nvewsThreat")),
                hint(text(p, "noticeSynopsis")),
                link("Open observatory page", text(p, "volcanoUrl")),
            ],
        ),
        "weatheralerts" => {
            let rank = match nws_rank(p) {
                2 => "Warning",
                1 => "Watch",
                _ => "Advisory / statement",
            };
            let title = if text(p, "prod_type").is_empty() { or("event", "NWS alert") } else { or("prod_type", "") };
            let onset = if p.get("onset").is_some_and(|v| !v.is_null()) { p.get("onset") } else { p.get("issuance") };
            (
                title,
                vec![
                    row("Level", rank),
                    row("Issued by", text(p, "wfo")),
                    row("Starts", when(onset)),
                    row("Expires", when(p.get("expiration"))),
                    link("Open official NWS alert", text(p, "url")),
                ],
            )
        }
        "fires" if f.part == 0 => (
            or("poly_IncidentName", "Fire"),
            vec![
                row("Area", format!("{} acres", thousands(num(p, "poly_GISAcres").unwrap_or(0.0)))),
                row("Contained", format!("{}%", num(p, "attr_PercentContained").unwrap_or(0.0))),
            ],
        ),
        "fires" => (
            or("IncidentName", "Fire incident"),
            vec![
                row("Area", format!("{} acres", thousands(num(p, "DailyAcres").unwrap_or(0.0)))),
                row("Contained", format!("{}%", num(p, "PercentContained").unwrap_or(0.0))),
                row("Discovered", num(p, "FireDiscoveryDateTime").map(utc).unwrap_or_default()),
            ],
        ),
        "maxarvhr" => {
            // Both ends of an event's extent (maxarWhen): its collections
            // carry pre-event archive alongside the post-event collect.
            let day = |key: &str| text(p, key).get(..10).unwrap_or("").to_owned();
            let (start, end) = (day("start"), day("end"));
            let when = match (start.is_empty(), end.is_empty()) {
                (false, false) if start != end => format!("{start} to {end}"),
                (false, _) => start,
                (true, false) => end,
                (true, true) => "Date not published".into(),
            };
            (
                or("title", "Maxar Open Data"),
                vec![
                    row("Imagery", when),
                    hint("12–20 inch optical, Cloud-Optimised GeoTIFF"),
                    row("Licence", "CC-BY-NC-4.0 — non-commercial use only"),
                    link("Open the STAC collection", text(p, "url")),
                ],
            )
        }
        "waarchaeology" => {
            let uncertainty = num(p, "uncertaintyMi")
                .map_or(String::new(), |u| if u < 1.0 { format!("±{u:.1} mi") } else { format!("±{u:.0} mi") });
            let mut items = vec![
                row("Type", or("siteType", "Archaeological landscape")),
                row("Period", or("period", "date not stated")),
                row(&or("precisionLabel", "Location note"), uncertainty),
                hint(&or("access", "Check land ownership and access before visiting.")),
                hint(text(p, "summary")),
                row("Context", text(p, "tribalContext")),
            ];
            for s in p.get("sources").and_then(Value::as_array).into_iter().flatten() {
                let title = s["title"].as_str().unwrap_or("Source");
                items.push(link(title, s["url"].as_str().unwrap_or("")));
            }
            (or("name", "Washington archaeology"), items)
        }
        _ => (String::new(), Vec::new()),
    };
    (title, items.into_iter().flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feature(props: Value, depth: Option<f64>) -> Feature {
        Feature { geometry: Geo::Point([0.5, 0.5]), props: props.as_object().unwrap().clone(), depth, part: 0 }
    }

    #[test]
    fn bundled_layers_parse_and_slice() {
        let nadi = parse(NADI1, 0).unwrap();
        let slice = spec("nadi1ice").unwrap().slice.unwrap();
        assert_eq!(slice.values().len(), 30);
        assert_eq!(slice.values()[0], 25.0);
        assert_eq!(slice.snap(17.4), 17.5);
        let alerts = Alerts::default();
        let at = shapes("nadi1ice", &nadi, &alerts, None, Some(17.5));
        assert!(!at.shapes.is_empty() && at.shapes.len() < nadi.len());
        // Ice fills carry no line; margins are dashed by kind.
        assert!(at.styles.iter().any(|s| s.fill[3] > 0.0 && s.line[3] == 0.0));
        assert!(at.styles.iter().any(|s| s.dash == [7.0, 5.0]));
        let sites = parse(ARCHAEOLOGY, 0).unwrap();
        let drawn = shapes("waarchaeology", &sites, &alerts, None, None);
        assert_eq!(drawn.points.len(), sites.len());
        assert!(drawn.points.iter().any(|p| p.marker.dash == [3.0, 2.0]));
        let (title, rows) = details("waarchaeology", &sites[0]);
        assert!(!title.is_empty() && rows.iter().any(|r| r["kind"] == "link"));
    }

    #[test]
    fn alerts_filter_style_and_describe_as_the_web() {
        let warning = feature(
            json!({"prod_type":"Winter Storm Warning","sig":"W","wfo":"SEW","expiration":1_794_000_000_000.0_f64}),
            None,
        );
        let advisory = feature(json!({"prod_type":"Dense Fog Advisory","sig":"Y"}), None);
        assert_eq!((nws_rank(&warning.props), nws_category(&warning.props)), (2, "winter"));
        assert_eq!((nws_rank(&advisory.props), nws_category(&advisory.props)), (0, "temperature"));
        let mut alerts = Alerts { nws_severity: "warning".into(), ..Alerts::default() };
        assert!(shown("weatheralerts", &warning, &alerts, None) && !shown("weatheralerts", &advisory, &alerts, None));
        alerts.types.insert("winter".into(), false);
        assert!(!shown("weatheralerts", &warning, &alerts, None));
        let quake = feature(
            json!({"mag":4.2,"place":"10 km N of Somewhere","time":1_794_000_000_000.0_f64,"url":"https://earthquake.usgs.gov/x"}),
            Some(12.0),
        );
        alerts.quake_mag = 4.5;
        assert!(!shown("earthquakes", &quake, &alerts, None));
        let m = point_marker("earthquakes", &quake, [0.5, 0.5]);
        assert!((m.radius - (3.0 + 4.2 * 1.35) as f32).abs() < 1e-5 && m.fill == hex("#ff6a5b", 0.82));
        let (title, rows) = details("earthquakes", &quake);
        assert_eq!(title, "10 km N of Somewhere");
        assert_eq!(rows[1]["value"], "7.5 mi");
        assert!(rows.iter().any(|r| r["href"] == "https://earthquake.usgs.gov/x"));
        assert_eq!(utc(1_794_000_000_000.0), "6 Nov 2026, 21:20 UTC");
        assert_eq!(thousands(1_234_567.0), "1,234,567");
        assert_eq!(iso_ms("2026-11-06T14:20:00-07:00"), Some(1_794_000_000_000.0));
        assert_eq!(when(Some(&json!("2026-11-06T21:20:00Z"))), "6 Nov 2026, 21:20 UTC");
    }

    #[test]
    fn view_bounds_pad_and_requests_follow_the_view() {
        let view = View { center: [0.5, 0.5], zoom: 2.0, bearing: 0.0, css: [256.0, 256.0], dpr: 2.0, export: false };
        let b = view_bounds(&view, 0.0);
        // A 256 px view of a 1,024 px world spans 45° of longitude each way.
        assert!((b[0] + 45.0).abs() < 1e-9 && (b[2] - 45.0).abs() < 1e-9 && b[1] < 0.0 && b[3] > 0.0);
        assert!(inside(view_bounds(&view, 0.1), view_bounds(&view, 0.35)));
        let alerts = Alerts::default();
        let (urls, bounds) = request(spec("weatheralerts").unwrap(), &alerts, Some(&view));
        assert!(urls[0].contains("geometryType=esriGeometryEnvelope") && bounds.is_some());
        let (urls, _) = request(spec("earthquakes").unwrap(), &alerts, Some(&view));
        assert!(urls[0].ends_with("all_week.geojson"));
        assert_eq!(request(spec("fires").unwrap(), &alerts, Some(&view)).0.len(), 2);
    }
}
