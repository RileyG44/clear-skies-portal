//! Place search: Photon (komoot), the geocoder the web app uses, whose
//! policy permits type-ahead traffic. Answers are display data only.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::Engine;
use crate::transport::FetchRequest;

const PHOTON: &str = "https://photon.komoot.io";
const TIMEOUT: Duration = Duration::from_secs(10);

/// One place: its name, where it is, what it is, and its extent
/// (`[west, north, east, south]` degrees) when it has one.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Place {
    pub primary: String,
    pub secondary: String,
    pub kind: String,
    pub lat: f64,
    pub lng: f64,
    pub extent: Option<[f64; 4]>,
}

fn place(feature: &Value) -> Option<Place> {
    let at = feature["geometry"]["coordinates"].as_array()?;
    let (lng, lat) = (at.first()?.as_f64()?, at.get(1)?.as_f64()?);
    let p = &feature["properties"];
    let s = |k: &str| p[k].as_str().filter(|v| !v.is_empty());
    let street = [s("housenumber"), s("street")].into_iter().flatten().collect::<Vec<_>>().join(" ");
    let primary = s("name")
        .map(str::to_owned)
        .or_else(|| (!street.is_empty()).then_some(street))
        .or_else(|| s("city").or(s("county")).map(str::to_owned))
        .unwrap_or_else(|| "Unnamed place".into());
    let mut context: Vec<&str> = Vec::new();
    for part in [s("city").filter(|c| *c != primary), s("county"), s("state"), s("country")].into_iter().flatten() {
        if !context.contains(&part) {
            context.push(part);
        }
    }
    let kind = s("osm_value").or(s("osm_key")).or(s("type")).unwrap_or("place").replace('_', " ");
    let extent = p["extent"].as_array().and_then(|e| {
        let v: Vec<f64> = e.iter().filter_map(Value::as_f64).collect();
        (v.len() == 4).then(|| [v[0], v[1], v[2], v[3]])
    });
    Some(Place { primary, secondary: context.join(", "), kind, lat, lng, extent })
}

impl Engine {
    /// Up to `limit` distinct places matching `text`, best first.
    pub async fn places(self: &Arc<Self>, text: &str, limit: usize) -> Result<Vec<Place>, String> {
        let mut url = url::Url::parse(&format!("{PHOTON}/api/")).map_err(|e| e.to_string())?;
        url.query_pairs_mut().append_pair("limit", &limit.to_string()).append_pair("q", text);
        let r = self
            .upstream
            .fetch(FetchRequest::get(url.to_string()).timeout(TIMEOUT).max_body(1 << 20))
            .await
            .map_err(|e| e.to_string())?;
        if r.status != 200 {
            return Err(format!("geocoder {}", r.status));
        }
        let json: Value = serde_json::from_slice(&r.body).map_err(|e| e.to_string())?;
        let mut seen = std::collections::HashSet::new();
        Ok(json["features"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .filter_map(place)
            .filter(|p| seen.insert(format!("{}|{}|{}", p.primary, p.secondary, p.kind).to_lowercase()))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_places_as_the_web_does() {
        let f = serde_json::json!({"geometry": {"coordinates": [-117.43, 47.66]},
            "properties": {"name": "Spokane", "city": "Spokane", "county": "Spokane County", "state": "Washington",
                "country": "United States", "osm_value": "city", "extent": [-117.6, 47.76, -117.3, 47.58]}});
        let p = place(&f).unwrap();
        assert_eq!(p.primary, "Spokane");
        assert_eq!(p.secondary, "Spokane County, Washington, United States");
        assert_eq!(p.kind, "city");
        assert_eq!(p.extent, Some([-117.6, 47.76, -117.3, 47.58]));
        let street = serde_json::json!({"geometry": {"coordinates": [0.0, 0.0]},
            "properties": {"housenumber": "12", "street": "Main St", "osm_key": "building_part"}});
        assert_eq!(place(&street).unwrap().primary, "12 Main St");
        assert_eq!(place(&street).unwrap().kind, "building part");
    }
}
