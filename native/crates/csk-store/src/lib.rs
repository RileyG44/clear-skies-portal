//! ClearSkies native storage (docs/native/ARCHITECTURE.md §4.7).
//!
//! One SQLite database in WAL mode holds the disposable cache (source byte
//! ranges and derived tiles, inline as blobs) and the small catalogue tables
//! the sources keep. Readers use their own connections, so tile reads never
//! wait on a writer. Eviction is least-recently-used down to a byte budget
//! and never touches pinned rows.

mod pack;

use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub use pack::{PackError, pack_elevation, unpack_elevation};
pub use rusqlite;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("storage: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("storage: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// What a cache row holds. Eviction and statistics are per kind.
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
    pub pinned_bytes: u64,
    pub budget: u64,
}

const READERS: usize = 4;

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

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  kind INTEGER NOT NULL,
  status INTEGER NOT NULL,
  media TEXT NOT NULL,
  meta TEXT,
  body BLOB NOT NULL,
  bytes INTEGER NOT NULL,
  created INTEGER NOT NULL,
  accessed INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS cache_lru ON cache(pinned, accessed);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS usgs_cells (
  project TEXT NOT NULL,
  zone INTEGER NOT NULL,          -- 0 when the filename carries no zone
  cx INTEGER NOT NULL,
  cy INTEGER NOT NULL,
  file TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (project, zone, cx, cy)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS usgs_cells_at ON usgs_cells(cx, cy);

CREATE TABLE IF NOT EXISTS usgs_zones (
  project TEXT NOT NULL,
  cx INTEGER NOT NULL,
  cy INTEGER NOT NULL,
  zone INTEGER,                   -- NULL: the header could not say
  PRIMARY KEY (project, cx, cy)
) WITHOUT ROWID;
";

fn configure(c: &Connection) -> rusqlite::Result<()> {
    c.busy_timeout(Duration::from_secs(5))?;
    c.pragma_update(None, "journal_mode", "WAL")?;
    c.pragma_update(None, "synchronous", "NORMAL")?;
    c.pragma_update(None, "temp_store", "MEMORY")?;
    c.pragma_update(None, "mmap_size", 256i64 * 1024 * 1024)?;
    Ok(())
}

impl Store {
    /// Opens (creating if needed) the database at `path` with a cache budget.
    pub fn open(path: &Path, budget: u64) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let write = Connection::open(path)?;
        configure(&write)?;
        write.execute_batch(SCHEMA)?;
        let mut readers = Vec::with_capacity(READERS);
        for _ in 0..READERS {
            let r = Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
            )?;
            r.busy_timeout(Duration::from_secs(5))?;
            r.pragma_update(None, "mmap_size", 256i64 * 1024 * 1024)?;
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

    /// A cached entry no older than `max_age`. Marks it recently used.
    pub fn get(&self, key: &str, max_age: Duration) -> Result<Option<Entry>> {
        let oldest = now_ms() - max_age.as_millis() as i64;
        let hit = self.read(|c| {
            c.prepare_cached("SELECT status, media, meta, body, created FROM cache WHERE key = ?1 AND created >= ?2")?
                .query_row(params![key, oldest], |r| {
                    Ok(Entry {
                        status: r.get::<_, i64>(0)? as u16,
                        media: r.get(1)?,
                        meta: r.get(2)?,
                        body: r.get(3)?,
                        created: r.get(4)?,
                    })
                })
                .optional()
        })?;
        if hit.is_some() {
            // Access times only order eviction; a lost update is harmless.
            let _ = self.write(|c| {
                c.prepare_cached("UPDATE cache SET accessed = ?2 WHERE key = ?1")?.execute(params![key, now_ms()])
            });
        }
        Ok(hit)
    }

    /// Stores an entry, replacing any older one under the same key.
    pub fn put(&self, key: &str, kind: Kind, status: u16, media: &str, meta: Option<&str>, body: &[u8]) -> Result<()> {
        let now = now_ms();
        let bytes = (body.len() + key.len() + meta.map_or(0, str::len) + 64) as i64;
        self.write(|c| {
            c.prepare_cached(
                "INSERT INTO cache (key, kind, status, media, meta, body, bytes, created, accessed, pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8,
                         COALESCE((SELECT pinned FROM cache WHERE key = ?1), 0))
                 ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, status = excluded.status,
                   media = excluded.media, meta = excluded.meta, body = excluded.body,
                   bytes = excluded.bytes, created = excluded.created, accessed = excluded.accessed",
            )?
            .execute(params![key, kind as u8, i64::from(status), media, meta, body, bytes, now])
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
        self.write(|c| c.execute("DELETE FROM cache WHERE key = ?1", params![key]))?;
        Ok(())
    }

    /// Pins or unpins keys (offline areas). Pinned rows are never evicted.
    pub fn set_pinned(&self, keys: &[String], pinned: bool) -> Result<()> {
        self.write(|c| {
            let tx = c.transaction()?;
            {
                let mut st = tx.prepare_cached("UPDATE cache SET pinned = ?2 WHERE key = ?1")?;
                for k in keys {
                    st.execute(params![k, i64::from(pinned)])?;
                }
            }
            tx.commit()
        })?;
        Ok(())
    }

    pub fn set_budget(&self, bytes: u64) -> Result<()> {
        self.budget.store(bytes, Ordering::Relaxed);
        self.evict()
    }

    /// Removes least-recently-used unpinned rows until the unpinned bytes
    /// fit the budget.
    pub fn evict(&self) -> Result<()> {
        let budget = self.budget.load(Ordering::Relaxed) as i64;
        self.write(|c| {
            let used: i64 =
                c.query_row("SELECT COALESCE(SUM(bytes), 0) FROM cache WHERE pinned = 0", [], |r| r.get(0))?;
            if used <= budget {
                return Ok(());
            }
            // Down to 90% of the budget, so the next few puts do not evict again.
            let mut excess = used - budget * 9 / 10;
            let tx = c.transaction()?;
            {
                let mut pick =
                    tx.prepare("SELECT key, bytes FROM cache WHERE pinned = 0 ORDER BY accessed LIMIT 512")?;
                let mut del = tx.prepare("DELETE FROM cache WHERE key = ?1")?;
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
            c.query_row(
                "SELECT COUNT(*), COALESCE(SUM(bytes), 0), COALESCE(SUM(CASE WHEN pinned THEN bytes ELSE 0 END), 0) FROM cache",
                [],
                |r| {
                    Ok(Stats {
                        entries: r.get::<_, i64>(0)? as u64,
                        bytes: r.get::<_, i64>(1)? as u64,
                        pinned_bytes: r.get::<_, i64>(2)? as u64,
                        budget,
                    })
                },
            )
        })
    }

    /// A small persistent value (JSON by convention).
    pub fn kv_get(&self, key: &str) -> Result<Option<(String, i64)>> {
        self.read(|c| {
            c.prepare_cached("SELECT value, updated FROM kv WHERE key = ?1")?
                .query_row(params![key], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()
        })
    }

    pub fn kv_put(&self, key: &str, value: &str) -> Result<()> {
        self.write(|c| {
            c.prepare_cached(
                "INSERT INTO kv (key, value, updated) VALUES (?1, ?2, ?3)
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
        let s = Store::open(&dir.path().join("cache.sqlite"), 10_000).unwrap();
        s.put("a", Kind::Derived, 200, "image/png", Some("{\"c\":1}"), &[1; 4000]).unwrap();
        s.set_pinned(&["a".into()], true).unwrap();
        for i in 0..10 {
            s.put(&format!("k{i}"), Kind::Source, 200, "application/octet-stream", None, &[2; 3000]).unwrap();
        }
        s.evict().unwrap();
        let st = s.stats().unwrap();
        assert!(st.bytes - st.pinned_bytes <= 10_000, "{st:?}");
        let a = s.get("a", Duration::from_secs(60)).unwrap().unwrap();
        assert_eq!((a.status, a.meta.as_deref(), a.body.len()), (200, Some("{\"c\":1}"), 4000));
        assert!(s.get("k9", Duration::from_secs(60)).unwrap().is_some(), "newest survives");
        assert!(s.get("k0", Duration::from_secs(60)).unwrap().is_none(), "oldest evicted");
        s.kv_put("x", "1").unwrap();
        assert_eq!(s.kv_get("x").unwrap().unwrap().0, "1");
    }
}
