//! Markup (annotation) layers, held on the device as user state.
//!
//! The contract is the Node engine's (`engine/markup-store.js`), which the
//! page's sync already speaks: saves are last-edit-wins by `markup.updated`,
//! an older save is answered 409 with the stored layer, and a delete leaves a
//! tombstone so an older copy cannot bring the layer back (410). Phase 6b
//! replaces last-edit-wins with merged sync (ARCHITECTURE.md §4.8).

use csk_store::rusqlite::{OptionalExtension, params};
use csk_store::{UserStore, now_ms};
use serde_json::{Value, json};

use crate::router::{Request, Response};

const MAX_BODY: usize = 8 << 20;
const MAX_FEATURES: usize = 20_000;

fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn no_store(r: Response) -> Response {
    r.header("Cache-Control", "no-store")
}

fn error(status: u16, msg: &str) -> Response {
    no_store(Response::json(status, &json!({"error": msg})))
}

/// Checks a layer document; `Err` is the 4xx to send.
fn validate(doc: &Value, id: &str) -> Result<(), Response> {
    let bad = |m: &str| Err(error(400, m));
    let Some(meta) = doc.get("markup").filter(|m| m.is_object()) else {
        return bad("markup layer must be a GeoJSON FeatureCollection with a markup header");
    };
    let Some(features) = doc.get("features").and_then(Value::as_array) else {
        return bad("markup layer must be a GeoJSON FeatureCollection with a markup header");
    };
    if doc.get("type").and_then(Value::as_str) != Some("FeatureCollection") {
        return bad("markup layer must be a GeoJSON FeatureCollection with a markup header");
    }
    if meta.get("id").and_then(Value::as_str) != Some(id) {
        return bad("markup layer id does not match its address");
    }
    let name = meta.get("name").and_then(Value::as_str).unwrap_or("");
    if name.trim().is_empty() || name.encode_utf16().count() > 120 {
        return bad("markup layer needs a name");
    }
    if let Some(d) = meta.get("description")
        && !d.as_str().is_some_and(|d| d.encode_utf16().count() <= 1000)
    {
        return bad("markup description must be text up to 1000 characters");
    }
    let color = meta.get("color").and_then(Value::as_str).unwrap_or("");
    if !(color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|c| c.is_ascii_hexdigit())) {
        return bad("markup layer colour must be #rrggbb");
    }
    if !meta.get("updated").and_then(Value::as_f64).is_some_and(f64::is_finite) {
        return bad("markup layer needs an updated time");
    }
    if features.len() > MAX_FEATURES {
        return Err(error(413, "too many markup features"));
    }
    for f in features {
        let ok = f.get("type").and_then(Value::as_str) == Some("Feature")
            && f.get("geometry").and_then(|g| g.get("type")).is_some_and(Value::is_string)
            && f.get("properties").is_some_and(Value::is_object);
        if !ok {
            return bad("markup features must be GeoJSON Features with properties");
        }
    }
    Ok(())
}

pub fn handle(store: &UserStore, req: &Request) -> Response {
    let p = req.path.as_str();
    if p == "/api/markup" {
        if req.method != "GET" {
            return error(405, "method not allowed").header("Allow", "GET");
        }
        return list(store);
    }
    let Some(rest) = p.strip_prefix("/api/markup/") else { return error(404, "not found") };
    let (id, delete) = match rest.strip_suffix("/delete") {
        Some(id) => (id, true),
        None => (rest, false),
    };
    if id.contains('/') {
        return error(404, "not found");
    }
    if !valid_id(id) {
        return error(400, "invalid markup layer id");
    }
    match (delete, req.method.as_str()) {
        (true, "POST") => remove(store, id, req),
        (true, _) => error(405, "method not allowed").header("Allow", "POST"),
        (false, "GET") => get(store, id),
        (false, "POST") => save(store, id, req),
        _ => error(405, "method not allowed").header("Allow", "GET, POST"),
    }
}

fn internal(e: impl std::fmt::Display) -> Response {
    error(500, &format!("markup storage failed: {e}"))
}

fn list(store: &UserStore) -> Response {
    let r = store.with(|c| {
        let layers: Vec<Value> = c
            .prepare("SELECT id, name, color, updated, features FROM markup_layers")?
            .query_map([], |r| {
                Ok(json!({"id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "color": r.get::<_, String>(2)?,
                          "updated": r.get::<_, f64>(3)?, "count": r.get::<_, i64>(4)?}))
            })?
            .collect::<Result<_, _>>()?;
        let mut deleted = serde_json::Map::new();
        let mut st = c.prepare("SELECT id, at FROM markup_tombstones")?;
        for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))? {
            let (id, at) = row?;
            deleted.insert(id, json!(at));
        }
        Ok(json!({"layers": layers, "deleted": deleted}))
    });
    match r {
        Ok(v) => no_store(Response::json(200, &v)),
        Err(e) => internal(e),
    }
}

fn stored(c: &csk_store::rusqlite::Connection, id: &str) -> csk_store::rusqlite::Result<Option<String>> {
    c.query_row("SELECT doc FROM markup_layers WHERE id = ?1", params![id], |r| r.get(0)).optional()
}

fn get(store: &UserStore, id: &str) -> Response {
    match store.with(|c| stored(c, id)) {
        Ok(Some(doc)) => no_store(Response::new(200, "application/geo+json", doc.into_bytes())),
        Ok(None) => error(404, "no such markup layer"),
        Err(e) => internal(e),
    }
}

fn save(store: &UserStore, id: &str, req: &Request) -> Response {
    if req.body.len() > MAX_BODY {
        return error(413, "markup layer too large");
    }
    let Ok(doc) = serde_json::from_slice::<Value>(&req.body) else { return error(400, "invalid JSON body") };
    if let Err(r) = validate(&doc, id) {
        return r;
    }
    let meta = &doc["markup"];
    let updated = meta["updated"].as_f64().unwrap_or(0.0);
    let text = doc.to_string();
    let r = store.with(|c| {
        let tx = c.transaction()?;
        let tomb: Option<f64> =
            tx.query_row("SELECT at FROM markup_tombstones WHERE id = ?1", params![id], |r| r.get(0)).optional()?;
        if let Some(at) = tomb
            && at >= updated
        {
            return Ok(Err(no_store(Response::json(410, &json!({"error": "markup layer was deleted", "deleted": at})))));
        }
        let current: Option<(String, f64)> = tx
            .query_row("SELECT doc, updated FROM markup_layers WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        if let Some((doc, at)) = current
            && at > updated
        {
            return Ok(Err(no_store(Response::new(409, "application/geo+json", doc.into_bytes()))));
        }
        tx.execute(
            "INSERT OR REPLACE INTO markup_layers (id, doc, name, color, updated, features) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                text,
                meta["name"].as_str().unwrap_or(""),
                meta["color"].as_str().unwrap_or(""),
                updated,
                doc["features"].as_array().map_or(0, Vec::len) as i64
            ],
        )?;
        tx.commit()?;
        Ok(Ok(()))
    });
    match r {
        Ok(Ok(())) => no_store(Response::json(200, &json!({"ok": true, "updated": meta["updated"]}))),
        Ok(Err(resp)) => resp,
        Err(e) => internal(e),
    }
}

fn remove(store: &UserStore, id: &str, req: &Request) -> Response {
    let at = serde_json::from_slice::<Value>(&req.body)
        .ok()
        .and_then(|b| b.get("at").and_then(Value::as_f64))
        .filter(|v| v.is_finite() && *v != 0.0)
        .unwrap_or(now_ms() as f64);
    let r = store.with(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO markup_tombstones (id, at) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET at = MAX(at, excluded.at)",
            params![id, at],
        )?;
        if let Some(doc) = stored(&tx, id)? {
            tx.execute("INSERT INTO markup_trash (id, deleted_at, doc) VALUES (?1, ?2, ?3)", params![id, now_ms(), doc])?;
            tx.execute("DELETE FROM markup_layers WHERE id = ?1", params![id])?;
        }
        let at: f64 = tx.query_row("SELECT at FROM markup_tombstones WHERE id = ?1", params![id], |r| r.get(0))?;
        tx.commit()?;
        Ok(at)
    });
    match r {
        Ok(at) => no_store(Response::json(200, &json!({"ok": true, "deleted": at}))),
        Err(e) => internal(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(id: &str, updated: f64) -> Vec<u8> {
        json!({"type": "FeatureCollection", "markup": {"id": id, "name": "Camp", "color": "#ff0000", "updated": updated},
               "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {}}]})
        .to_string()
        .into_bytes()
    }

    fn req(method: &str, path: &str, body: Vec<u8>) -> Request {
        Request::new(method, path, body).unwrap()
    }

    #[test]
    fn last_edit_wins_with_tombstones() {
        let dir = tempfile::tempdir().unwrap();
        let s = UserStore::open(&dir.path().join("user.sqlite")).unwrap();
        assert_eq!(handle(&s, &req("POST", "/api/markup/camp-a1", layer("camp-a1", 10.0))).status, 200);
        let older = handle(&s, &req("POST", "/api/markup/camp-a1", layer("camp-a1", 5.0)));
        assert_eq!(older.status, 409, "older save gets the stored layer");
        assert!(String::from_utf8(older.body).unwrap().contains("\"updated\":10"));
        assert_eq!(handle(&s, &req("POST", "/api/markup/camp-a1", layer("other", 11.0))).status, 400);
        assert_eq!(handle(&s, &req("POST", "/api/markup/BAD", layer("BAD", 11.0))).status, 400);
        let list = String::from_utf8(handle(&s, &req("GET", "/api/markup", vec![])).body).unwrap();
        assert!(list.contains("\"count\":1"));
        assert_eq!(handle(&s, &req("POST", "/api/markup/camp-a1/delete", b"{\"at\":20}".to_vec())).status, 200);
        assert_eq!(handle(&s, &req("GET", "/api/markup/camp-a1", vec![])).status, 404);
        assert_eq!(handle(&s, &req("POST", "/api/markup/camp-a1", layer("camp-a1", 15.0))).status, 410);
        assert_eq!(handle(&s, &req("POST", "/api/markup/camp-a1", layer("camp-a1", 25.0))).status, 200);
    }
}
