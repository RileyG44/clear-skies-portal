//! Export image (app/snapshot.js): the person's resolution and map-info
//! choices, and the Export page and dock panel that start an export of the
//! whole view or a selected area.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Output pixels per screen point the web offers.
pub const SCALES: [f64; 6] = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ExportPrefs {
    pub scale: f64,
    /// Draw the map info card (coordinates, elevation and colour keys).
    pub readout: bool,
}

impl Default for ExportPrefs {
    fn default() -> Self {
        Self { scale: 2.0, readout: false }
    }
}

impl ExportPrefs {
    pub fn normalize(&mut self) {
        if !SCALES.contains(&self.scale) {
            self.scale = 2.0;
        }
    }
}

/// What the export controls show that is not saved: the view they would
/// export and an export under way or just finished.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ExportView {
    /// The view's size in CSS px, its zoom and centre latitude.
    pub css: [f64; 2],
    pub zoom: f64,
    pub lat: f64,
    /// The map is showing the area selection.
    pub selecting: bool,
    /// Blocks done of all, while exporting.
    pub running: Option<(u32, u32)>,
    /// The last export's outcome, and whether it failed.
    pub message: Option<(String, bool)>,
}

/// A ground distance in feet or miles (ui.js `res`).
fn ground(metres: f64) -> String {
    let feet = metres * 3.280_84;
    if feet < 10.0 {
        format!("{feet:.1} ft")
    } else if feet < 5280.0 {
        format!("{} ft", crate::shell::group_digits(feet.round() as i64))
    } else {
        format!("{:.1} mi", feet / 5280.0)
    }
}

fn megapixels(w: u32, h: u32) -> String {
    let mp = f64::from(w) * f64::from(h) / 1e6;
    if mp < 10.0 { format!("{mp:.1}") } else { format!("{mp:.0}") }
}

/// The whole view's export size at a scale.
pub fn size(view: &ExportView, scale: f64) -> (u32, u32) {
    ((view.css[0] * scale).round().max(1.0) as u32, (view.css[1] * scale).round().max(1.0) as u32)
}

/// The Export page's and the dock panel's items (index.html #snapshotPanel).
pub fn items(prefs: &ExportPrefs, view: &ExportView) -> Vec<Value> {
    let scale = prefs.scale;
    let (w, h) = size(view, scale);
    let metres = 156_543.033_92 * view.lat.to_radians().cos() / view.zoom.exp2() / scale;
    let too_big = u64::from(w) * u64::from(h) > csk_map::export::MAX_PIXELS;
    let mut meta = format!(
        "The whole view at {}× is {} × {} px ({} MP, {}/px).",
        scale,
        crate::shell::group_digits(i64::from(w)),
        crate::shell::group_digits(i64::from(h)),
        megapixels(w, h),
        ground(metres)
    );
    if too_big {
        meta.push_str(" Over the 200 MP limit for this device — choose a lower resolution or Select Area.");
    }
    let options: Vec<Value> =
        SCALES.iter().map(|s| json!({"value": format!("{s}"), "title": format!("{s}×")})).collect();
    let busy = view.running.is_some();
    let mut settings = vec![
        json!({"kind": "picker", "ref": "#snapshotScale", "title": "Resolution", "value": format!("{scale}"),
            "options": options, "disabled": busy}),
        json!({"kind": "text", "style": "status", "title": meta}),
        json!({"kind": "toggle", "ref": "#snapshotReadout", "title": "Include map info",
            "detail": "Coordinates, elevation and color keys", "value": prefs.readout, "disabled": busy}),
    ];
    if let Some((done, total)) = view.running {
        let percent = (done * 100).checked_div(total).unwrap_or(0);
        settings.push(json!({"kind": "text", "style": "status", "title": format!("Exporting… {percent}%")}));
    } else if let Some((text, failed)) = &view.message {
        settings.push(json!({"kind": "text", "style": if *failed { "warning" } else { "success" }, "title": text}));
    }
    let buttons = if busy {
        vec![json!({"kind": "button", "ref": "#snapshotCancel", "title": "Cancel export",
            "detail": "Stop and discard this image."})]
    } else {
        vec![
            json!({"kind": "button", "ref": "#snapshotSelect", "title": "Select area",
                "detail": "Draw a rectangle on the map to save."}),
            json!({"kind": "button", "ref": "#snapshotCapture", "title": "Capture view",
                "detail": "Save the whole map view.", "disabled": too_big}),
        ]
    };
    vec![
        json!({"kind": "group", "ref": "export:settings", "title": "Image settings", "items": settings}),
        json!({"kind": "text", "style": "hint",
            "title": "Higher resolutions request finer source tiles where available. Enlarging a source adds no new detail."}),
        json!({"kind": "actions", "items": buttons}),
    ]
}

/// The file name the web gives an export (snapshotFilename), from Unix ms.
pub fn file_name(now_ms: i64) -> String {
    // "6 Nov 2026, 21:20 UTC" is not a file name; build the compact form.
    let secs = now_ms.div_euclid(1000);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("clear-skies-{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z.png", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_the_view_as_the_web_does() {
        let view = ExportView { css: [440.0, 956.0], zoom: 12.0, lat: 47.6, ..Default::default() };
        let items = items(&ExportPrefs::default(), &view);
        let meta = items[0]["items"][1]["title"].as_str().unwrap();
        assert!(meta.starts_with("The whole view at 2× is 880 × 1,912 px (1.7 MP, "), "{meta}");
        assert!(meta.ends_with(" ft/px)."), "{meta}");
        assert_eq!(items[2]["items"][1]["ref"], "#snapshotCapture");
        let huge = super::items(&ExportPrefs { scale: 32.0, readout: false }, &view);
        assert_eq!(huge[2]["items"][1]["disabled"], true);
        let running = super::items(&ExportPrefs::default(), &ExportView { running: Some((1, 4)), ..view.clone() });
        assert_eq!(running[2]["items"][0]["ref"], "#snapshotCancel");
        assert_eq!(file_name(1_794_000_000_000), "clear-skies-20261106T212000Z.png");
        assert_eq!(ground(0.5), "1.6 ft");
    }
}
