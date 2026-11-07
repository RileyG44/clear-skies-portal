//! Satellite imagery (app/search.js, app/results.js, app/scenes.js): the
//! search filters, the scenes a search found, the recommendation and the
//! result list, the next passes, and the scene shown on the map.

use csk_engine::imagery::{Found, Scene};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The search and list filters, as the person left them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SatPrefs {
    /// Days back, 0 for all time.
    pub days: u32,
    /// Maximum cloud percent; 101 admits every scene.
    pub cloud: f64,
    /// "all" or a visualisation (rgb, sar, false, night, terrain).
    pub vis: String,
    /// "date" (newest first) or "gsd" (sharpest first).
    pub sort: String,
    /// Only scenes that draw on the map.
    pub viewable: bool,
    /// Group the list by catalogue.
    pub group_source: bool,
}

impl Default for SatPrefs {
    fn default() -> Self {
        Self { days: 365, cloud: 101.0, vis: "all".into(), sort: "date".into(), viewable: true, group_source: true }
    }
}

pub const DAYS: [(u32, &str); 6] = [
    (14, "Last 14 days"),
    (30, "Last 30 days"),
    (90, "Last 90 days"),
    (365, "Last 365 days"),
    (1825, "Last 5 years"),
    (0, "All time"),
];
pub const CLOUD: [(f64, &str); 4] = [(10.0, "Under 10%"), (30.0, "Under 30%"), (60.0, "Under 60%"), (101.0, "Any")];
pub const VIS: [(&str, &str); 6] = [
    ("all", "All types"),
    ("rgb", "Natural color (RGB)"),
    ("sar", "Radar (SAR)"),
    ("false", "False color / IR"),
    ("night", "Night lights"),
    ("terrain", "Terrain"),
];

impl SatPrefs {
    pub fn normalize(&mut self) {
        if !DAYS.iter().any(|(d, _)| *d == self.days) {
            self.days = 365;
        }
        if !CLOUD.iter().any(|(c, _)| *c == self.cloud) {
            self.cloud = 101.0;
        }
        if !VIS.iter().any(|(v, _)| *v == self.vis) {
            self.vis = "all".into();
        }
        if self.sort != "gsd" {
            self.sort = "date".into();
        }
    }

    pub fn window(&self) -> csk_engine::imagery::Window {
        csk_engine::imagery::Window { days: (self.days > 0).then_some(self.days) }
    }

    /// The filter chips' summary ("Last 365 days · any cloud · all types").
    fn summary(&self) -> String {
        let days = DAYS.iter().find(|(d, _)| *d == self.days).map_or("", |(_, l)| l);
        let cloud = if self.cloud > 100.0 { "any cloud".to_string() } else { format!("under {}% cloud", self.cloud) };
        let vis = if self.vis == "all" {
            "all types".to_string()
        } else {
            VIS.iter().find(|(v, _)| *v == self.vis).map_or(String::new(), |(_, l)| l.to_lowercase())
        };
        format!("{days} · {cloud} · {vis}")
    }
}

/// A scene shown on the map, and how far its tiles have got.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub scene: Scene,
    /// Percent.
    pub opacity: f64,
    /// Its tiles resolved and drawing, or None while resolving; Err when
    /// it cannot draw.
    pub drawing: Option<Result<(), String>>,
}

/// What the Satellite page shows that is not saved.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SatView {
    /// Where the last search ran, and its label.
    pub at: Option<(f64, f64, String)>,
    pub searching: bool,
    pub found: Option<Found>,
    /// Bumped with each new result list, so a pick names the list it saw.
    pub version: u64,
    pub shown: Option<Shown>,
}

/// A "photo": a daylight true-colour scene that draws (results.js `isPhoto`).
fn photo(s: &Scene) -> bool {
    s.tiles.is_some() && s.vis == "rgb" && s.kind != "Night"
}

/// Collections that ship a ready true-colour composite (`NATIVE_RGB`).
const NATIVE_RGB: [&str; 3] = ["sentinel-2-l2a", "landsat-c2-l2", "naip"];

fn gsd(s: &Scene) -> f64 {
    s.gsd.unwrap_or(1e9)
}

/// Newest first; ties to the finer product.
fn newest<'a>(set: impl Iterator<Item = &'a Scene>) -> Option<&'a Scene> {
    set.max_by(|a, b| a.date.cmp(&b.date).then(gsd(b).total_cmp(&gsd(a))))
}

/// The best clear daylight photo (results.js `bestPhoto`).
pub fn best_photo<'a>(pool: &[&'a Scene]) -> Option<&'a Scene> {
    let tiers = |set: Vec<&'a Scene>| -> Option<&'a Scene> {
        let sharp: Vec<&Scene> = set.iter().copied().filter(|s| gsd(s) <= 60.0).collect();
        newest(sharp.iter().copied().filter(|s| s.cloud.is_some_and(|c| c < 20.0)))
            .or_else(|| newest(sharp.iter().copied().filter(|s| s.cloud.is_none_or(|c| c < 50.0))))
            .or_else(|| newest(sharp.iter().copied()))
            .or_else(|| newest(set.iter().copied().filter(|s| s.cloud.is_none_or(|c| c < 50.0))))
            .or_else(|| newest(set.iter().copied()))
    };
    let photos: Vec<&Scene> = pool.iter().copied().filter(|s| photo(s)).collect();
    tiers(photos.iter().copied().filter(|s| NATIVE_RGB.contains(&s.collection.as_str())).collect())
        .or_else(|| tiers(photos))
}

/// The scenes the list filters allow (results.js `resultPool`).
pub fn pool<'a>(found: &'a Found, prefs: &SatPrefs) -> Vec<&'a Scene> {
    found
        .scenes
        .iter()
        .filter(|s| !prefs.viewable || s.tiles.is_some())
        .filter(|s| prefs.vis == "all" || s.vis == prefs.vis)
        .collect()
}

/// Unix seconds of an ISO 8601 UTC date ("2026-11-01T19:05:12Z").
fn epoch(date: &str) -> Option<i64> {
    let field = |r: std::ops::Range<usize>| date.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (field(0..4)?, field(5..7)?, field(8..10)?);
    let (hh, mm, ss) = (field(11..13).unwrap_or(0), field(14..16).unwrap_or(0), field(17..19).unwrap_or(0));
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146_097 + doe - 719_468) * 86_400 + hh * 3600 + mm * 60 + ss)
}

/// How long ago, in the web's words (`ago`).
pub fn ago(date: &str, now: i64) -> String {
    let Some(t) = epoch(date) else { return String::new() };
    let days = (now - t) as f64 / 86_400.0;
    if days < 1.0 {
        let hours = ((now - t) as f64 / 3600.0).round().max(1.0);
        format!("{hours} h ago")
    } else if days < 60.0 {
        format!("{} d ago", days.round())
    } else if days < 730.0 {
        format!("{} mo ago", (days / 30.4).round())
    } else {
        format!("{} yr ago", (days / 365.25).round())
    }
}

/// Ground resolution in feet or miles (ui.js `res`).
pub fn res(gsd: Option<f64>) -> String {
    let Some(m) = gsd else { return String::new() };
    let feet = m * 3.280_84;
    if feet < 10.0 {
        format!("{feet:.1} ft")
    } else if feet < 5280.0 {
        format!("{} ft", feet.round())
    } else {
        format!("{:.1} mi", feet / 5280.0)
    }
}

/// A projected next pass (results.js `computePasses`).
#[derive(Clone, Debug, PartialEq)]
pub struct Pass {
    pub platform: String,
    pub cycle_days: f64,
    /// Unix seconds.
    pub next: i64,
    pub seen: usize,
}

fn pretty_platform(p: &str) -> String {
    let lower = p.to_lowercase();
    if let Some(rest) = lower.strip_prefix("sentinel-") {
        let mut chars = rest.chars();
        let n = chars.next().map(String::from).unwrap_or_default();
        let letter = chars.next().map(|c| c.to_ascii_uppercase().to_string()).unwrap_or_default();
        return format!("Sentinel-{n}{letter}");
    }
    if let Some(n) = lower.strip_prefix("landsat-") {
        return format!("Landsat {n}");
    }
    if lower == "nisar" {
        return "NISAR".into();
    }
    p.to_owned()
}

/// Next passes over the point, from its own acquisition history: repeat
/// cycles of sun-synchronous tracks, one row per platform, soonest first.
pub fn passes(found: &Found, now: i64) -> Vec<Pass> {
    let mut groups: std::collections::BTreeMap<(String, String), Vec<i64>> = Default::default();
    for s in found.scenes.iter().filter(|s| s.source_key != "gibs") {
        let (Some(platform), Some(t)) = (&s.platform, epoch(&s.date)) else { continue };
        let track = s.orbit.map_or_else(|| format!("t{}", (t.rem_euclid(86_400) / 60) / 12), |o| format!("ro{o}"));
        groups.entry((platform.clone(), track)).or_default().push(t);
    }
    let mut best: std::collections::BTreeMap<String, Pass> = Default::default();
    for ((platform, _), mut times) in groups {
        times.sort_unstable();
        times.dedup();
        if times.len() < 2 {
            continue;
        }
        let mut gaps: Vec<i64> = times.windows(2).map(|w| w[1] - w[0]).collect();
        gaps.sort_unstable();
        let median = gaps[gaps.len() / 2];
        let days = median as f64 / 86_400.0;
        if !(0.6..=40.0).contains(&days) {
            continue;
        }
        let mut next = times[times.len() - 1] + median;
        while next < now {
            next += median;
        }
        let pass = Pass { platform: pretty_platform(&platform), cycle_days: days, next, seen: times.len() };
        if best.get(&pass.platform).is_none_or(|b| pass.next < b.next) {
            best.insert(pass.platform.clone(), pass);
        }
    }
    let mut out: Vec<Pass> = best.into_values().collect();
    out.sort_by_key(|p| p.next);
    out
}

fn until(next: i64, now: i64) -> String {
    let hours = (next - now) as f64 / 3600.0;
    if hours < 1.0 {
        "<1 h".into()
    } else if hours < 48.0 {
        format!("{} h", hours.round())
    } else {
        format!("{:.1} d", hours / 24.0)
    }
}

fn meta(s: &Scene, now: i64) -> String {
    let cloud = s.cloud.map(|c| format!("{c:.0}% cloud"));
    let provider = s.source.split(' ').next().unwrap_or("").to_owned();
    [Some(ago(&s.date, now)), Some(res(s.gsd)), cloud, Some(provider)]
        .into_iter()
        .flatten()
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}

/// The scene's reference in the list it was shown in.
fn scene_ref(view: &SatView, index: usize) -> String {
    format!("scene:{}:{index}", view.version)
}

/// Whether two scenes are the same one.
fn same(a: &Scene, b: &Scene) -> bool {
    a.id == b.id && a.source == b.source
}

/// The Satellite imagery page.
pub fn page(prefs: &SatPrefs, view: &SatView, reference: Value, now: i64) -> Vec<Value> {
    let options = |pairs: Vec<(String, &str)>| -> Vec<Value> {
        pairs.into_iter().map(|(v, t)| json!({"value": v, "title": t})).collect()
    };
    let mut items = vec![
        json!({"kind": "scenesearch", "ref": "#cspSatQuery", "placeholder": "Place or coordinates",
            "value": view.at.as_ref().map_or(String::new(), |(_, _, l)| l.clone())}),
        json!({"kind": "chips", "ref": "#cspSatFilterBox", "title": "Search filters", "detail": prefs.summary(), "items": [
            {"kind": "picker", "ref": "#days", "title": "Time window", "value": prefs.days.to_string(),
                "options": options(DAYS.iter().map(|(d, l)| (d.to_string(), *l)).collect())},
            {"kind": "picker", "ref": "#cloud", "title": "Max cloud", "value": format!("{}", prefs.cloud),
                "options": options(CLOUD.iter().map(|(c, l)| (format!("{c}"), *l)).collect())},
            {"kind": "picker", "ref": "#vis", "title": "Image type", "value": prefs.vis,
                "options": options(VIS.iter().map(|(v, l)| ((*v).to_owned(), *l)).collect())},
        ]}),
    ];
    let shown = view.shown.as_ref().map(|s| &s.scene);
    let mut results = Vec::new();
    match (&view.found, view.at.is_some(), view.searching) {
        (_, false, _) => results.push(json!({"kind": "text", "style": "hint",
            "title": "No search yet. Search a place, or double-tap the map."})),
        (None, true, true) => {
            results.push(json!({"kind": "text", "style": "status", "title": "Searching imagery catalogs…"}))
        }
        (None, true, false) => results.push(json!({"kind": "text", "style": "hint",
            "title": "No imagery found. Widen the date range or cloud filter."})),
        (Some(found), true, searching) => {
            let pool = pool(found, prefs);
            // Which catalogues answered.
            let mut status: Vec<String> =
                found.answered.iter().map(|(n, c)| format!("{} {c}", n.split(' ').next().unwrap_or(n))).collect();
            status.extend(found.failed.iter().map(|n| format!("{} failed", n.split(' ').next().unwrap_or(n))));
            if searching {
                status.push("more catalogs answering…".into());
            }
            results.push(json!({"kind": "text", "style": "status", "title": status.join(" · ")}));
            if pool.is_empty() {
                results.push(json!({"kind": "text", "style": "hint", "title": if found.scenes.is_empty() {
                    "No imagery found. Widen the date range or cloud filter.".to_string()
                } else {
                    format!("None of the {} scenes match these list filters.", found.scenes.len())
                }}));
            } else {
                let index = |s: &Scene| found.scenes.iter().position(|x| same(x, s)).unwrap_or(0);
                // The recommendation: the best clear photo, or why there is none.
                if let Some(best) = best_photo(&pool) {
                    let showing = shown.is_some_and(|s| same(s, best));
                    let mut card = json!({"kind": "recommendation", "title": format!("{} · {}", best.label, &best.date[..10]),
                        "detail": meta(best, now), "selected": showing,
                        "edit": {"ref": scene_ref(view, index(best)), "title": "Show best clear image"}});
                    if showing {
                        card["badge"] = json!("Shown");
                    }
                    results.push(card);
                } else {
                    results.push(json!({"kind": "text", "style": "hint",
                        "title": "No clear daylight photo matches these filters. Try a wider time window or Any cloud."}));
                }
                let mut sorted = pool.clone();
                if prefs.sort == "gsd" {
                    sorted.sort_by(|a, b| gsd(a).total_cmp(&gsd(b)).then(b.date.cmp(&a.date)));
                } else {
                    sorted.sort_by(|a, b| b.date.cmp(&a.date).then(gsd(a).total_cmp(&gsd(b))));
                }
                let row = |s: &Scene| {
                    let mut tags = vec![json!({"title": s.kind})];
                    if s.tiles.is_none() {
                        tags.push(json!({"title": "Outline only"}));
                    }
                    json!({"kind": "scene", "ref": scene_ref(view, index(s)), "title": s.label,
                        "detail": format!("{} · {}", &s.date[..10], meta(s, now)), "src": s.thumb, "tags": tags,
                        "selected": shown.is_some_and(|x| same(x, s))})
                };
                if prefs.group_source {
                    // Catalogues in their usual order, the daily layers last.
                    let rank = |name: &str| {
                        csk_engine::imagery::CATALOGUES.iter().position(|c| c.name == name).unwrap_or(usize::MAX)
                    };
                    let mut sources: Vec<&str> = Vec::new();
                    for s in &sorted {
                        if !sources.contains(&s.source.as_str()) {
                            sources.push(&s.source);
                        }
                    }
                    sources.sort_by_key(|name| rank(name));
                    for source in sources {
                        let rows: Vec<Value> = sorted.iter().filter(|s| s.source == source).map(|s| row(s)).collect();
                        results.push(
                            json!({"kind": "group", "ref": format!("satellite:source:{source}"), "title": source,
                            "detail": format!("{} scenes", rows.len()), "items": rows}),
                        );
                    }
                } else {
                    results.extend(sorted.iter().map(|s| row(s)));
                }
            }
        }
    }
    results.push(json!({"kind": "group", "ref": "#cspSatResultOptions", "title": "Result options",
        "detail": format!("{} · {} · {}",
            if prefs.sort == "gsd" { "Sharpest first" } else { "Newest first" },
            if prefs.viewable { "Drawable only" } else { "All scenes" },
            if prefs.group_source { "By source" } else { "One list" }),
        "items": [
            {"kind": "picker", "ref": "#sort", "title": "Sort by", "value": prefs.sort, "options": [
                {"value": "date", "title": "Newest first"}, {"value": "gsd", "title": "Sharpest first"}]},
            {"kind": "toggle", "ref": "#viewable", "title": "Only scenes that draw on the map", "value": prefs.viewable},
            {"kind": "toggle", "ref": "#groupSrc", "title": "Group by source", "value": prefs.group_source},
            {"kind": "text", "style": "hint", "title": "Preset windows also list fixed-date composites, such as the Black Marble night lights."},
        ]}));
    items.push(json!({"kind": "group", "ref": "satellite:results", "pane": true, "title": "Satellite scenes",
        "open": true, "items": results}));
    items.push(reference);
    if let Some(found) = &view.found {
        let passes = passes(found, now);
        if !passes.is_empty() {
            let mut rows: Vec<Value> = passes
                .iter()
                .map(|p| json!({"kind": "text", "style": "row", "title": p.platform,
                    "detail": format!("{:.1}-day cycle", p.cycle_days), "value": format!("about {}", until(p.next, now))}))
                .collect();
            let seen: usize = passes.iter().map(|p| p.seen).sum();
            rows.push(json!({"kind": "text", "style": "hint", "title": format!(
                "Estimated from the {seen} past acquisitions over this point, not from orbital elements. Treat these as \
                 approximate; a pass does not guarantee a usable or cloud-free image.")}));
            items.push(json!({"kind": "group", "ref": "satellite:passes", "title": "Estimated next acquisitions",
                "detail": format!("{} sats", passes.len()), "items": rows}));
        }
    }
    items
}

/// The "Displayed on map" panel (index.html #ctl).
pub fn panel(view: &SatView) -> Vec<Value> {
    let Some(shown) = &view.shown else {
        return vec![
            json!({"kind": "text", "style": "hint", "title": "No scene is shown. Pick one on the Satellite imagery page."}),
        ];
    };
    let s = &shown.scene;
    let state = match &shown.drawing {
        None => "Loading imagery".to_string(),
        Some(Ok(())) => "Satellite imagery".to_string(),
        Some(Err(e)) => e.clone(),
    };
    let mut items = vec![
        json!({"kind": "text", "style": "row", "title": s.label, "detail": format!("{} · {}", &s.date[..s.date.len().min(10)], state)}),
        json!({"kind": "slider", "ref": "#op", "title": "Opacity", "value": shown.opacity.round(), "min": 0, "max": 100, "step": 1,
            "display": format!("{}%", shown.opacity.round())}),
        json!({"kind": "button", "ref": "#ctlReset", "title": "Reset", "detail": "Remove this scene from the map."}),
    ];
    if let Some(link) = &s.link {
        items.push(json!({"kind": "link", "title": "Open the source", "href": link}));
    }
    items.push(json!({"kind": "text", "style": "hint", "title": "Double-tap any point for its best clear image."}));
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene(id: &str, coll: &str, date: &str, cloud: Option<f64>, gsd: f64) -> Scene {
        Scene {
            id: id.into(),
            source: "AWS Earth Search (Element 84)".into(),
            source_key: "es".into(),
            collection: coll.into(),
            label: coll.into(),
            kind: "Optical".into(),
            vis: "rgb".into(),
            gsd: Some(gsd),
            date: date.into(),
            cloud,
            thumb: None,
            tiles: Some(csk_engine::imagery::Tiles::Xyz("https://titiler.xyz/{z}/{x}/{y}".into())),
            link: None,
            bbox: None,
            native_max: None,
            platform: Some("sentinel-2b".into()),
            orbit: Some(13),
        }
    }

    #[test]
    fn best_photo_prefers_clear_native_composites_then_newest() {
        let a = scene("a", "sentinel-2-l2a", "2026-11-01T19:00:00Z", Some(45.0), 10.0);
        let b = scene("b", "sentinel-2-l2a", "2026-10-22T19:00:00Z", Some(3.0), 10.0);
        let c = scene("c", "hls2-s30", "2026-11-03T19:00:00Z", Some(1.0), 30.0);
        let pool = vec![&a, &b, &c];
        // The clear Sentinel-2 wins over a newer cloudy one and over HLS.
        assert_eq!(best_photo(&pool).unwrap().id, "b");
        let found = Found {
            scenes: vec![
                a.clone(),
                b.clone(),
                scene("d", "sentinel-2-l2a", "2026-10-12T19:00:00Z", None, 10.0),
                scene("e", "sentinel-2-l2a", "2026-10-02T19:00:00Z", None, 10.0),
            ],
            ..Found::default()
        };
        let now = epoch("2026-11-06T21:20:00Z").unwrap();
        let p = passes(&found, now);
        assert_eq!(p.len(), 1);
        assert_eq!((p[0].platform.as_str(), p[0].cycle_days.round()), ("Sentinel-2B", 10.0));
        assert!(p[0].next > now);
        assert_eq!(ago("2026-11-01T19:00:00Z", now), "5 d ago");
        assert_eq!(res(Some(10.0)), "33 ft");
    }

    #[test]
    fn page_lists_scenes_by_source_with_the_recommendation_first() {
        let found = Found {
            scenes: vec![scene("a", "sentinel-2-l2a", "2026-11-01T19:00:00Z", Some(3.0), 10.0)],
            answered: vec![("AWS Earth Search (Element 84)".into(), 1)],
            failed: vec!["Copernicus Data Space".into()],
        };
        let view = SatView {
            at: Some((47.0, -117.0, "Spokane".into())),
            found: Some(found),
            version: 3,
            ..Default::default()
        };
        let now = epoch("2026-11-06T21:20:00Z").unwrap();
        let items = page(&SatPrefs::default(), &view, json!({"kind": "group"}), now);
        assert_eq!(items[0]["value"], "Spokane");
        let results = items[2]["items"].as_array().unwrap();
        assert_eq!(results[0]["title"], "AWS 1 · Copernicus failed");
        assert_eq!(results[1]["kind"], "recommendation");
        assert_eq!(results[1]["edit"]["ref"], "scene:3:0");
        assert_eq!(results[2]["items"][0]["ref"], "scene:3:0");
    }
}
