//! The USGS 1 m project catalogue: which projects hold which 10 km UTM cell.
//!
//! The archive has three live filename conventions (`USGS_1M_<zone>_x..y..`,
//! `USGS_1m_x..y..`, `USGS_one_meter_x..y..`), so filenames are never
//! guessed: each project's `TIFF/` prefix is listed once and its cells are
//! stored in SQLite, indexed by cell. A listing that failed is unknown
//! coverage, not a gap: the catalogue is *incomplete* until every project in
//! scope has listed, and only a complete catalogue may say "no 1 m here".

use std::sync::{Arc, Mutex};
use std::time::Duration;

use csk_store::rusqlite::params;
use csk_store::{Store, now_ms};
use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};

use crate::flight::Flights;
use crate::transport::FetchRequest;
use crate::upstream::{S3_HOST, Upstream};

pub const S3_BASE: &str = "StagedProducts/Elevation/1m/Projects/";
const META_KEY: &str = "usgs.catalog";
const VERSION: u32 = 3;
/// The archive changes on a yearly rhythm.
const TTL: Duration = Duration::from_secs(30 * 24 * 3600);
/// An incomplete catalogue retries its failed listings this often.
const RETRY: Duration = Duration::from_secs(10 * 60);
/// S3 listing is latency-bound, not rate-limited.
const CONCURRENCY: usize = 12;

/// Washington plus bordering Oregon and Idaho projects, and the Elwha
/// survey: the raw 1 m discovery scope the desktop engine uses by default.
pub const DEFAULT_SCOPE: &[&str] = &["WA_", "OR_", "ID_", "Elwha_"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Meta {
    pub version: u32,
    /// Unix ms of the last full build.
    pub built: i64,
    /// Prefixes enumerated, comma-joined ("ALL" for the whole archive).
    pub scope: String,
    /// Projects whose listing failed and are retried.
    pub failed: Vec<String>,
    /// False while some scope prefix could not even be enumerated.
    pub enumerated: bool,
    pub projects: usize,
}

/// One file covering a cell, as listed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellFile {
    pub project: String,
    /// The zone from the filename, if it carries one.
    pub zone: Option<i32>,
    pub file: String,
    pub size: u64,
}

/// A cell named by its 10 km indices: west edge at `cx·10 km`, north edge at
/// `cy·10 km` (so `cy` is the ceiling of the northing).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Cell {
    pub cx: i64,
    pub cy: i64,
}

pub const CELL_M: f64 = 10_000.0;

impl Cell {
    pub fn of(e: f64, n: f64) -> Self {
        Self { cx: (e / CELL_M).floor() as i64, cy: (n / CELL_M).ceil() as i64 }
    }
    pub fn name(&self) -> String {
        format!("x{}y{}", self.cx, self.cy)
    }
}

/// Parses a 1 m tile filename: `(zone, cx, cy)`.
pub fn parse_tile_name(file: &str) -> Option<(Option<i32>, i64, i64)> {
    let rest = file.strip_prefix("USGS_")?;
    let (zone, rest) = if let Some(r) = rest.strip_prefix("1M_").or_else(|| rest.strip_prefix("1m_")) {
        // An optional "<zone>_" before the cell name.
        match r.split_once('_') {
            Some((z, tail)) if !z.is_empty() && z.bytes().all(|b| b.is_ascii_digit()) => (Some(z.parse().ok()?), tail),
            _ => (None, r),
        }
    } else {
        (None, rest.strip_prefix("one_meter_")?)
    };
    let rest = rest.strip_prefix('x')?;
    let xs = rest.bytes().take_while(u8::is_ascii_digit).count();
    let (x, rest) = rest.split_at(xs);
    let rest = rest.strip_prefix('y')?;
    let ys = rest.bytes().take_while(u8::is_ascii_digit).count();
    let (y, rest) = rest.split_at(ys);
    let suffix = rest.strip_prefix('_')?.strip_suffix(".tif")?;
    if x.is_empty() || y.is_empty() || suffix.is_empty() {
        return None;
    }
    Some((zone, x.parse().ok()?, y.parse().ok()?))
}

/// A project's flight year, for preferring newer data. The name is the only
/// place it appears; several carry two (2019_D20 = flown 2019, delivered 2020).
pub fn project_year(name: &str) -> i32 {
    let years: Vec<i32> = name
        .split('_')
        .filter(|p| p.len() == 4 && (p.starts_with("19") || p.starts_with("20")))
        .filter_map(|p| p.parse().ok())
        .collect();
    if let Some(y) = years.into_iter().max() {
        return y;
    }
    // ..._B21, ..._D22
    if let Some((_, last)) = name.rsplit_once('_') {
        let b = last.as_bytes();
        if b.len() == 3 && b[0].is_ascii_uppercase() && b[1].is_ascii_digit() && b[2].is_ascii_digit() {
            return 2000 + i32::from(b[1] - b'0') * 10 + i32::from(b[2] - b'0');
        }
    }
    0
}

/// The text of every `<tag>…</tag>`, entities decoded.
fn tags<'a>(xml: &'a str, tag: &str) -> Vec<String> {
    let (open, close) = (format!("<{tag}>"), format!("</{tag}>"));
    let mut out = Vec::new();
    let mut rest: &'a str = xml;
    while let Some(i) = rest.find(&open) {
        let after = &rest[i + open.len()..];
        let Some(j) = after.find(&close) else { break };
        out.push(unescape(&after[..j]));
        rest = &after[j + close.len()..];
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// encodeURIComponent's unreserved set.
const COMPONENT: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

pub fn encode_component(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, COMPONENT).to_string()
}

/// One listed tile: filename zone, cell indices, filename, size.
type Listed = (Option<i32>, i64, i64, String, u64);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CatalogError {
    #[error("S3 listing failed: {0}")]
    Listing(String),
    #[error("{0}")]
    Store(String),
}

pub struct Catalog {
    store: Arc<Store>,
    upstream: Arc<Upstream>,
    scope: Vec<String>,
    meta: Mutex<Option<Meta>>,
    building: Flights<u8, Result<Meta, CatalogError>>,
    last_repair: Mutex<Option<std::time::Instant>>,
}

impl Catalog {
    pub fn new(store: Arc<Store>, upstream: Arc<Upstream>, scope: Vec<String>) -> Arc<Self> {
        let meta = store
            .kv_get(META_KEY)
            .ok()
            .flatten()
            .and_then(|(v, _)| serde_json::from_str::<Meta>(&v).ok())
            .filter(|m| m.version == VERSION);
        Arc::new(Self {
            store,
            upstream,
            scope,
            meta: Mutex::new(meta),
            building: Flights::default(),
            last_repair: Mutex::new(None),
        })
    }

    pub fn scope_name(&self) -> String {
        if self.scope.iter().any(|s| s.eq_ignore_ascii_case("ALL")) { "ALL".into() } else { self.scope.join(",") }
    }

    /// The scope that a final "no coverage" answer was given under. Answers
    /// cached under another scope are asked again.
    pub fn coverage_scope(&self) -> String {
        format!("{}|elwha-opr-v1", self.scope_name())
    }

    pub fn meta(&self) -> Option<Meta> {
        self.meta.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn covers_scope(&self, m: &Meta) -> bool {
        m.scope == "ALL" || self.scope_name().split(',').all(|s| m.scope.split(',').any(|t| t == s))
    }

    /// Whether a "no 1 m coverage" answer is final.
    pub fn complete(&self) -> bool {
        self.meta().is_some_and(|m| m.failed.is_empty() && m.enumerated && self.covers_scope(&m))
    }

    /// A usable catalogue: the stored one (repairing it in the background if
    /// incomplete, rebuilding if expired), or a fresh build.
    pub async fn ensure(self: &Arc<Self>) -> Result<Meta, CatalogError> {
        if let Some(m) = self.meta() {
            let age = now_ms() - m.built;
            if age > TTL.as_millis() as i64 {
                let me = self.clone();
                tokio::spawn(async move { me.build().await });
            } else if !(m.failed.is_empty() && m.enumerated && self.covers_scope(&m)) {
                self.repair_soon();
            }
            return Ok(m);
        }
        self.build().await
    }

    /// Lists the whole scope again. Shared: concurrent callers wait for one build.
    pub async fn build(self: &Arc<Self>) -> Result<Meta, CatalogError> {
        let me = self.clone();
        self.building
            .run(0, move || async move { me.build_now(None).await })
            .await
            .unwrap_or_else(|| Err(CatalogError::Listing("catalogue build stopped".into())))
    }

    fn repair_soon(self: &Arc<Self>) {
        {
            let mut last = self.last_repair.lock().unwrap_or_else(|e| e.into_inner());
            if last.is_some_and(|t| t.elapsed() < RETRY) || !self.building.is_empty() {
                return;
            }
            *last = Some(std::time::Instant::now());
        }
        let me = self.clone();
        tokio::spawn(async move {
            let Some(base) = me.meta() else { return };
            let only = if base.enumerated && me.covers_scope(&base) { Some(base.failed.clone()) } else { None };
            let m2 = me.clone();
            let _ = me.building.run(0, move || async move { m2.build_now(only).await }).await;
        });
    }

    /// Lists `only` these projects (a repair), or everything in scope.
    async fn build_now(self: &Arc<Self>, only: Option<Vec<String>>) -> Result<Meta, CatalogError> {
        let previous = self.meta();
        let (names, enumerated) = match &only {
            Some(list) => (list.clone(), true),
            None => {
                let mut names = Vec::new();
                let mut enumerated = true;
                for prefix in &self.scope {
                    let p = if prefix.eq_ignore_ascii_case("ALL") { String::new() } else { prefix.clone() };
                    match self.list_projects(&p).await {
                        Ok(n) => names.extend(n),
                        Err(_) => enumerated = false,
                    }
                }
                names.sort();
                names.dedup();
                (names, enumerated)
            }
        };
        if names.is_empty() && !enumerated {
            if let Some(prev) = previous {
                return Ok(prev); // nothing reachable: keep serving what we had
            }
            return Err(CatalogError::Listing("no project listing reachable".into()));
        }
        let results: Vec<(String, Result<Vec<Listed>, CatalogError>)> = stream::iter(names.into_iter().map(|p| {
            let me = self.clone();
            async move {
                let r = me.list_project_tiles(&p).await;
                (p, r)
            }
        }))
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;

        let mut failed = Vec::new();
        let listed: Vec<_> = results
            .into_iter()
            .filter_map(|(p, r)| match r {
                Ok(rows) => Some((p, rows)),
                Err(_) => {
                    failed.push(p);
                    None
                }
            })
            .collect();
        failed.sort();
        let full = only.is_none();
        self.store
            .write(|c| {
                let tx = c.transaction()?;
                {
                    let mut del = tx.prepare_cached("DELETE FROM usgs_cells WHERE project = ?1")?;
                    let mut ins = tx.prepare_cached(
                        "INSERT OR REPLACE INTO usgs_cells (project, zone, cx, cy, file, size) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    )?;
                    if full {
                        // Projects gone from the archive go too, except ones
                        // whose listing failed this time: those keep serving.
                        let keep: std::collections::HashSet<&str> =
                            listed.iter().map(|(p, _)| p.as_str()).chain(failed.iter().map(String::as_str)).collect();
                        let existing: Vec<String> = tx
                            .prepare("SELECT DISTINCT project FROM usgs_cells")?
                            .query_map([], |r| r.get(0))?
                            .collect::<Result<_, _>>()?;
                        for p in existing.iter().filter(|p| !keep.contains(p.as_str())) {
                            del.execute(params![p])?;
                        }
                    }
                    for (p, rows) in &listed {
                        del.execute(params![p])?;
                        for (zone, cx, cy, file, size) in rows {
                            ins.execute(params![p, zone.unwrap_or(0), cx, cy, file, *size as i64])?;
                        }
                    }
                }
                tx.commit()
            })
            .map_err(|e| CatalogError::Store(e.to_string()))?;
        let projects = self
            .store
            .read(|c| c.query_row("SELECT COUNT(DISTINCT project) FROM usgs_cells", [], |r| r.get::<_, i64>(0)))
            .map_err(|e| CatalogError::Store(e.to_string()))? as usize;
        let meta = Meta {
            version: VERSION,
            built: if full { now_ms() } else { previous.as_ref().map_or(now_ms(), |m| m.built) },
            scope: self.scope_name(),
            failed,
            enumerated: if full { enumerated } else { previous.as_ref().is_none_or(|m| m.enumerated) },
            projects,
        };
        let text = serde_json::to_string(&meta).expect("meta serialises");
        self.store.kv_put(META_KEY, &text).map_err(|e| CatalogError::Store(e.to_string()))?;
        *self.meta.lock().unwrap_or_else(|e| e.into_inner()) = Some(meta.clone());
        Ok(meta)
    }

    async fn list(&self, query: &str) -> Result<String, CatalogError> {
        let url = format!("https://{S3_HOST}/?{query}");
        let r = self
            .upstream
            .fetch(FetchRequest::get(url).timeout(Duration::from_secs(30)))
            .await
            .map_err(|e| CatalogError::Listing(e.to_string()))?;
        if r.status != 200 {
            return Err(CatalogError::Listing(format!("S3 listing {}", r.status)));
        }
        String::from_utf8(r.body).map_err(|_| CatalogError::Listing("listing is not UTF-8".into()))
    }

    async fn list_projects(&self, prefix: &str) -> Result<Vec<String>, CatalogError> {
        let mut out = Vec::new();
        let mut token = String::new();
        loop {
            let mut q = format!(
                "list-type=2&prefix={}&delimiter=/&max-keys=1000",
                encode_component(&format!("{S3_BASE}{prefix}"))
            );
            if !token.is_empty() {
                q += &format!("&continuation-token={}", encode_component(&token));
            }
            let xml = self.list(&q).await?;
            // Only CommonPrefixes end in "/"; the echoed request prefix does not.
            for p in tags(&xml, "Prefix").into_iter().filter(|p| p.ends_with('/')) {
                if let Some(name) = p.trim_end_matches('/').rsplit('/').next()
                    && !name.is_empty()
                    && p.len() > S3_BASE.len()
                {
                    out.push(name.to_owned());
                }
            }
            token = tags(&xml, "NextContinuationToken").pop().unwrap_or_default();
            if token.is_empty() {
                return Ok(out);
            }
        }
    }

    async fn list_project_tiles(&self, project: &str) -> Result<Vec<Listed>, CatalogError> {
        let mut out = Vec::new();
        let mut token = String::new();
        loop {
            let mut q =
                format!("list-type=2&prefix={}&max-keys=1000", encode_component(&format!("{S3_BASE}{project}/TIFF/")));
            if !token.is_empty() {
                q += &format!("&continuation-token={}", encode_component(&token));
            }
            let xml = self.list(&q).await?;
            for contents in tags(&xml, "Contents") {
                let (Some(key), Some(size)) = (tags(&contents, "Key").pop(), tags(&contents, "Size").pop()) else {
                    continue;
                };
                let file = key.rsplit('/').next().unwrap_or("");
                if let Some((zone, cx, cy)) = parse_tile_name(file) {
                    out.push((zone, cx, cy, file.to_owned(), size.parse().unwrap_or(0)));
                }
            }
            token = tags(&xml, "NextContinuationToken").pop().unwrap_or_default();
            if token.is_empty() {
                return Ok(out);
            }
        }
    }

    /// Files listed for a cell in `zone` (zoned names must match it) and
    /// every zoneless file for that cell name. Where one project has both, the
    /// zoned file wins.
    pub fn files_at(&self, cell: Cell, zone: i32) -> Result<Vec<CellFile>, CatalogError> {
        let rows: Vec<CellFile> = self
            .store
            .read(|c| {
                c.prepare_cached(
                    "SELECT project, zone, file, size FROM usgs_cells WHERE cx = ?1 AND cy = ?2 AND zone IN (?3, 0)
                     ORDER BY project, zone DESC",
                )?
                .query_map(params![cell.cx, cell.cy, zone], |r| {
                    let z: i32 = r.get(1)?;
                    Ok(CellFile {
                        project: r.get(0)?,
                        zone: (z != 0).then_some(z),
                        file: r.get(2)?,
                        size: r.get::<_, i64>(3)? as u64,
                    })
                })?
                .collect()
            })
            .map_err(|e| CatalogError::Store(e.to_string()))?;
        let mut out: Vec<CellFile> = Vec::with_capacity(rows.len());
        for r in rows {
            if out.last().is_some_and(|l| l.project == r.project) {
                continue; // zoned row came first
            }
            out.push(r);
        }
        Ok(out)
    }

    /// A zoneless file's zone, as read from its header earlier.
    pub fn cached_zone(&self, project: &str, cell: Cell) -> Option<Option<i32>> {
        self.store
            .read(|c| {
                use csk_store::rusqlite::OptionalExtension;
                c.prepare_cached("SELECT zone FROM usgs_zones WHERE project = ?1 AND cx = ?2 AND cy = ?3")?
                    .query_row(params![project, cell.cx, cell.cy], |r| r.get::<_, Option<i32>>(0))
                    .optional()
            })
            .ok()
            .flatten()
    }

    pub fn remember_zone(&self, project: &str, cell: Cell, zone: Option<i32>) {
        let _ = self.store.write(|c| {
            c.prepare_cached("INSERT OR REPLACE INTO usgs_zones (project, cx, cy, zone) VALUES (?1, ?2, ?3, ?4)")?
                .execute(params![project, cell.cx, cell.cy, zone])
        });
    }

    /// Per-project totals for the catalogue route.
    pub fn summary(&self) -> Result<Vec<(String, usize, u64)>, CatalogError> {
        self.store
            .read(|c| {
                c.prepare("SELECT project, COUNT(*), SUM(size) FROM usgs_cells GROUP BY project")?
                    .query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as usize, r.get::<_, i64>(2)? as u64)))?
                    .collect()
            })
            .map_err(|e| CatalogError::Store(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_years_cells() {
        assert_eq!(parse_tile_name("USGS_1M_10_x59y519_WA_Olympics_2019.tif"), Some((Some(10), 59, 519)));
        assert_eq!(parse_tile_name("USGS_1m_x59y519_WA_Olympics_2019.tif"), Some((None, 59, 519)));
        assert_eq!(parse_tile_name("USGS_one_meter_x59y519_WA_X_2016.tif"), Some((None, 59, 519)));
        assert_eq!(parse_tile_name("USGS_1M_x59y519.tif"), None);
        assert_eq!(parse_tile_name("readme.txt"), None);
        assert_eq!(project_year("WA_KingCounty_2016"), 2016);
        assert_eq!(project_year("WA_Lewis_2019_D20"), 2019);
        assert_eq!(project_year("WA_NorthCentral_B21"), 2021);
        assert_eq!(project_year("Elwha_River"), 0);
        // West edge floors, north edge ceils (a floor is one cell too far south).
        assert_eq!(Cell::of(594_508.0, 5_189_497.0), Cell { cx: 59, cy: 519 });
        assert_eq!(encode_component("a/b c"), "a%2Fb%20c");
        let xml =
            "<Contents><Key>a&amp;b</Key><Size>3</Size></Contents><Contents><Key>c</Key><Size>4</Size></Contents>";
        assert_eq!(tags(xml, "Contents").len(), 2);
        assert_eq!(tags(xml, "Key"), vec!["a&b", "c"]);
    }
}
