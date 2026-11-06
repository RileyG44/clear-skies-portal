//! ClearSkies native storage (docs/native/ARCHITECTURE.md §4.7).
//!
//! Two SQLite files in WAL mode act as one store:
//!
//! - **cache** (`Library/Caches` on iOS): source byte ranges and derived
//!   tiles, inline as blobs. Disposable: least-recently-used rows are evicted
//!   down to a byte budget, and iOS may delete the file.
//! - **pinned** (Application Support, excluded from backup): copies of the
//!   rows offline areas need, referenced per area. Never evicted; a row goes
//!   when the last area referencing it is removed.
//!
//! Reads look in the cache, then the pinned tier. Readers use their own
//! connections, so tile reads never wait on a writer.

mod pack;
mod user;

use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub use pack::{PackError, pack_elevation, unpack_elevation};
pub use rusqlite;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
pub use user::UserStore;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("storage: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("storage: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// What a cache row holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Kind {
    /// Upstream bytes, unchanged (a COG byte range, an upstream image).
    Source = 1,
    /// A tile the engine derived (packed elevation, a rendered image).
    Derived = 2,
}

/// A cached answer: status, media type, metadata (JSON) and body.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub status: u16,
    pub media: String,
    pub meta: Option<String>,
    pub body: Vec<u8>,
    /// Unix milliseconds when it was stored.
    pub created: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Stats {
    pub entries: u64,
    pub bytes: u64,
    pub pinned_entries: u64,
    pub pinned_bytes: u64,
    pub budget: u64,
}

const READERS: usize = 4;
/// Bumped when the cache tables change. The cache is disposable, so a
/// different version simply starts empty; pinned and user data migrate.
const CACHE_VERSION: i64 = 2;
const COLUMNS: &str = "key, kind, status, media, meta, body, bytes, created, accessed";

pub struct Store {
    write: Mutex<Connection>,
    readers: Vec<Mutex<Connection>>,
    next: AtomicUsize,
    budget: AtomicU64,
    /// Bytes written since the last eviction pass.
    since_evict: AtomicU64,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

const CACHE_TABLE: &str = "(
  key TEXT PRIMARY KEY,
  kind INTEGER NOT NULL,
  status INTEGER NOT NULL,
  media TEXT NOT NULL,
  meta TEXT,
  body BLOB NOT NULL,
  bytes INTEGER NOT NULL,
  created INTEGER NOT NULL,
  accessed INTEGER NOT NULL
) WITHOUT ROWID";

fn schema() -> String {
    format!(
        "
CREATE TABLE IF NOT EXISTS main.cache {CACHE_TABLE};
CREATE INDEX IF NOT EXISTS main.cache_lru ON cache(accessed);

CREATE TABLE IF NOT EXISTS pinned.cache {CACHE_TABLE};
CREATE TABLE IF NOT EXISTS pinned.refs (
  area TEXT NOT NULL,
  key TEXT NOT NULL,
  PRIMARY KEY (area, key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS pinned.refs_key ON refs(key);

-- Download jobs: device-local progress, resumable after the app is killed.
CREATE TABLE IF NOT EXISTS pinned.jobs (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  source TEXT NOT NULL,
  spec TEXT NOT NULL,
  state TEXT NOT NULL,            -- running, stopped, done
  total INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS pinned.job_tiles (
  job TEXT NOT NULL,
  z INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job, z, x, y)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS main.kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS main.usgs_cells (
  project TEXT NOT NULL,
  zone INTEGER NOT NULL,          -- 0 when the filename carries no zone
  cx INTEGER NOT NULL,
  cy INTEGER NOT NULL,
  file TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (project, zone, cx, cy)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS main.usgs_cells_at ON usgs_cells(cx, cy);

CREATE TABLE IF NOT EXISTS main.usgs_zones (
  project TEXT NOT NULL,
  cx INTEGER NOT NULL,
  cy INTEGER NOT NULL,
  zone INTEGER,                   -- NULL: the header could not say
  PRIMARY KEY (project, cx, cy)
) WITHOUT ROWID;
"
    )
}

fn configure(c: &Connection) -> rusqlite::Result<()> {
    c.busy_timeout(Duration::from_secs(5))?;
    c.pragma_update(None, "journal_mode", "WAL")?;
    c.pragma_update(None, "synchronous", "NORMAL")?;
    c.pragma_update(None, "temp_store", "MEMORY")?;
    c.pragma_update(None, "mmap_size", 256i64 * 1024 * 1024)?;
    Ok(())
}

fn attach(c: &Connection, pinned: &Path) -> rusqlite::Result<()> {
    c.execute("ATTACH DATABASE ?1 AS pinned", params![pinned.to_string_lossy()])?;
    c.pragma_update(Some("pinned"), "journal_mode", "WAL")?;
    Ok(())
}

impl Store {
    /// Opens (creating if needed) the cache at `cache` and the pinned tier
    /// at `pinned`, with a cache budget in bytes.
    pub fn open(cache: &Path, pinned: &Path, budget: u64) -> Result<Self> {
        for p in [cache, pinned] {
            if let Some(dir) = p.parent() {
                std::fs::create_dir_all(dir)?;
            }
        }
        let write = Connection::open(cache)?;
        configure(&write)?;
        let version: i64 = write.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version != CACHE_VERSION {
            write.execute_batch(
                "DROP TABLE IF EXISTS cache; DROP TABLE IF EXISTS kv; DROP TABLE IF EXISTS usgs_cells; DROP TABLE IF EXISTS usgs_zones;",
            )?;
            write.pragma_update(None, "user_version", CACHE_VERSION)?;
        }
        attach(&write, pinned)?;
        write.execute_batch(&schema())?;
        let mut readers = Vec::with_capacity(READERS);
        for _ in 0..READERS {
            let r = Connection::open_with_flags(
                cache,
                OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
            )?;
            r.busy_timeout(Duration::from_secs(5))?;
            r.pragma_update(None, "mmap_size", 256i64 * 1024 * 1024)?;
            r.pragma_update(None, "query_only", true)?;
            attach(&r, pinned)?;
            readers.push(Mutex::new(r));
        }
        Ok(Self {
            write: Mutex::new(write),
            readers,
            next: AtomicUsize::new(0),
            budget: AtomicU64::new(budget),
            since_evict: AtomicU64::new(0),
        })
    }

    /// Runs `f` on a read connection.
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T> {
        let i = self.next.fetch_add(1, Ordering::Relaxed) % self.readers.len();
        let c = self.readers[i].lock().unwrap_or_else(|e| e.into_inner());
        Ok(f(&c)?)
    }

    /// Runs `f` on the write connection.
    pub fn write<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T> {
        let mut c = self.write.lock().unwrap_or_else(|e| e.into_inner());
        Ok(f(&mut c)?)
    }

    /// An entry no older than `max_age`, from the cache or the pinned tier.
    /// Pinned rows are offline data and are returned at any age.
    pub fn get(&self, key: &str, max_age: Duration) -> Result<Option<Entry>> {
        let oldest = now_ms() - max_age.as_millis() as i64;
        let row = |r: &rusqlite::Row<'_>| {
            Ok(Entry {
                status: r.get::<_, i64>(0)? as u16,
                media: r.get(1)?,
                meta: r.get(2)?,
                body: r.get(3)?,
                created: r.get(4)?,
            })
        };
        let (hit, cached) = self.read(|c| {
            let hit = c
                .prepare_cached(
                    "SELECT status, media, meta, body, created FROM main.cache WHERE key = ?1 AND created >= ?2",
                )?
                .query_row(params![key, oldest], row)
                .optional()?;
            if hit.is_some() {
                return Ok((hit, true));
            }
            let pinned = c
                .prepare_cached("SELECT status, media, meta, body, created FROM pinned.cache WHERE key = ?1")?
                .query_row(params![key], row)
                .optional()?;
            Ok((pinned, false))
        })?;
        if hit.is_some() && cached {
            // Access times only order eviction; a lost update is harmless.
            let _ = self.write(|c| {
                c.prepare_cached("UPDATE main.cache SET accessed = ?2 WHERE key = ?1")
                    .and_then(|mut s| s.execute(params![key, now_ms()]))
            });
        }
        Ok(hit)
    }

    /// Stores an entry, replacing any older one. A key some area pins is
    /// refreshed in the pinned tier too, so offline data follows updates.
    pub fn put(&self, key: &str, kind: Kind, status: u16, media: &str, meta: Option<&str>, body: &[u8]) -> Result<()> {
        let now = now_ms();
        let bytes = (body.len() + key.len() + meta.map_or(0, str::len) + 64) as i64;
        self.write(|c| {
            let sql =
                "INSERT OR REPLACE INTO main.cache (key, kind, status, media, meta, body, bytes, created, accessed)
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)";
            c.prepare_cached(sql)?.execute(params![
                key,
                kind as u8,
                i64::from(status),
                media,
                meta,
                body,
                bytes,
                now
            ])?;
            c.prepare_cached(&format!(
                "INSERT OR REPLACE INTO pinned.cache ({COLUMNS}) SELECT {COLUMNS} FROM main.cache WHERE key = ?1
                 AND EXISTS (SELECT 1 FROM pinned.refs WHERE key = ?1)"
            ))?
            .execute(params![key])
        })?;
        let written = self.since_evict.fetch_add(bytes as u64, Ordering::Relaxed) + bytes as u64;
        // Evict in batches: a pass per put would dominate small writes.
        if written > (self.budget.load(Ordering::Relaxed) / 64).max(4 << 20) {
            self.since_evict.store(0, Ordering::Relaxed);
            self.evict()?;
        }
        Ok(())
    }

    pub fn remove(&self, key: &str) -> Result<()> {
        self.write(|c| c.execute("DELETE FROM main.cache WHERE key = ?1", params![key]))?;
        Ok(())
    }

    /// Pins `keys` for `area`: copies them from the cache into the pinned
    /// tier and records the reference. Returns how many were held to copy.
    pub fn pin(&self, area: &str, keys: &[String]) -> Result<usize> {
        self.write(|c| {
            let tx = c.transaction()?;
            let mut copied = 0;
            {
                let mut copy =
                    tx.prepare_cached("INSERT OR REPLACE INTO pinned.cache SELECT * FROM main.cache WHERE key = ?1")?;
                let mut held = tx.prepare_cached("SELECT 1 FROM pinned.cache WHERE key = ?1")?;
                let mut add = tx.prepare_cached("INSERT OR IGNORE INTO pinned.refs (area, key) VALUES (?1, ?2)")?;
                for k in keys {
                    copy.execute(params![k])?;
                    if held.exists(params![k])? {
                        add.execute(params![area, k])?;
                        copied += 1;
                    }
                }
            }
            tx.commit()?;
            Ok(copied)
        })
    }

    /// Removes an area's references; pinned rows no area needs go.
    pub fn unpin_area(&self, area: &str) -> Result<()> {
        self.write(|c| {
            let tx = c.transaction()?;
            tx.execute("DELETE FROM pinned.refs WHERE area = ?1", params![area])?;
            tx.execute("DELETE FROM pinned.cache WHERE key NOT IN (SELECT key FROM pinned.refs)", [])?;
            tx.commit()
        })?;
        Ok(())
    }

    /// Bytes an area holds in the pinned tier.
    pub fn area_bytes(&self, area: &str) -> Result<u64> {
        self.read(|c| {
            c.query_row(
                "SELECT COALESCE(SUM(p.bytes), 0) FROM pinned.refs r JOIN pinned.cache p ON p.key = r.key WHERE r.area = ?1",
                params![area],
                |r| r.get::<_, i64>(0),
            )
        })
        .map(|b| b as u64)
    }

    /// Stored bytes of these keys (cache or pinned).
    pub fn bytes_of(&self, keys: &[String]) -> Result<u64> {
        self.read(|c| {
            let mut total = 0i64;
            let mut st = c.prepare_cached(
                "SELECT COALESCE((SELECT bytes FROM main.cache WHERE key = ?1), (SELECT bytes FROM pinned.cache WHERE key = ?1), 0)",
            )?;
            for k in keys {
                total += st.query_row(params![k], |r| r.get::<_, i64>(0))?;
            }
            Ok(total as u64)
        })
    }

    pub fn set_budget(&self, bytes: u64) -> Result<()> {
        self.budget.store(bytes, Ordering::Relaxed);
        self.evict()
    }

    /// Removes least-recently-used cache rows until the cache fits its budget.
    pub fn evict(&self) -> Result<()> {
        let budget = self.budget.load(Ordering::Relaxed) as i64;
        self.write(|c| {
            let used: i64 = c.query_row("SELECT COALESCE(SUM(bytes), 0) FROM main.cache", [], |r| r.get(0))?;
            if used <= budget {
                return Ok(());
            }
            // Down to 90% of the budget, so the next few puts do not evict again.
            let mut excess = used - budget * 9 / 10;
            let tx = c.transaction()?;
            {
                let mut pick = tx.prepare("SELECT key, bytes FROM main.cache ORDER BY accessed LIMIT 512")?;
                let mut del = tx.prepare("DELETE FROM main.cache WHERE key = ?1")?;
                while excess > 0 {
                    let rows: Vec<(String, i64)> =
                        pick.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
                    if rows.is_empty() {
                        break;
                    }
                    for (k, b) in rows {
                        del.execute(params![k])?;
                        excess -= b;
                        if excess <= 0 {
                            break;
                        }
                    }
                }
            }
            tx.commit()
        })?;
        Ok(())
    }

    pub fn stats(&self) -> Result<Stats> {
        let budget = self.budget.load(Ordering::Relaxed);
        self.read(|c| {
            let (entries, bytes) =
                c.query_row("SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM main.cache", [], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                })?;
            let (pe, pb) = c.query_row("SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM pinned.cache", [], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })?;
            Ok(Stats {
                entries: entries as u64,
                bytes: bytes as u64,
                pinned_entries: pe as u64,
                pinned_bytes: pb as u64,
                budget,
            })
        })
    }

    /// A small persistent value (JSON by convention).
    pub fn kv_get(&self, key: &str) -> Result<Option<(String, i64)>> {
        self.read(|c| {
            c.prepare_cached("SELECT value, updated FROM main.kv WHERE key = ?1")?
                .query_row(params![key], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()
        })
    }

    pub fn kv_put(&self, key: &str, value: &str) -> Result<()> {
        self.write(|c| {
            c.prepare_cached(
                "INSERT INTO main.kv (key, value, updated) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
            )?
            .execute(params![key, value, now_ms()])
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_get_evict_pin() {
        let dir = tempfile::tempdir().unwrap();
        let s =
            Store::open(&dir.path().join("cache.sqlite"), &dir.path().join("pinned/pinned.sqlite"), 10_000).unwrap();
        s.put("a", Kind::Derived, 200, "image/png", Some("{\"c\":1}"), &[1; 4000]).unwrap();
        assert_eq!(s.pin("area1", &["a".into(), "missing".into()]).unwrap(), 1);
        for i in 0..10 {
            s.put(&format!("k{i}"), Kind::Source, 200, "application/octet-stream", None, &[2; 3000]).unwrap();
        }
        s.evict().unwrap();
        let st = s.stats().unwrap();
        assert!(st.bytes <= 10_000, "{st:?}");
        assert_eq!(st.pinned_entries, 1);
        // Evicted from the cache, still served from the pinned tier.
        let a = s.get("a", Duration::from_secs(60)).unwrap().unwrap();
        assert_eq!((a.status, a.meta.as_deref(), a.body.len()), (200, Some("{\"c\":1}"), 4000));
        assert!(s.get("k9", Duration::from_secs(60)).unwrap().is_some(), "newest survives");
        assert!(s.get("k0", Duration::from_secs(60)).unwrap().is_none(), "oldest evicted");
        // A refreshed pinned key updates its offline copy.
        s.put("a", Kind::Derived, 200, "image/png", None, &[3; 10]).unwrap();
        s.remove("a").unwrap();
        assert_eq!(s.get("a", Duration::from_secs(60)).unwrap().unwrap().body, vec![3; 10]);
        assert!(s.area_bytes("area1").unwrap() > 0);
        s.unpin_area("area1").unwrap();
        assert!(s.get("a", Duration::from_secs(60)).unwrap().is_none());
        s.kv_put("x", "1").unwrap();
        assert_eq!(s.kv_get("x").unwrap().unwrap().0, "1");
    }
}
