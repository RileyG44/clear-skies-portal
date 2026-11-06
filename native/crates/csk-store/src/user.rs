//! User state: what the person made, kept apart from the disposable cache
//! (Application Support on iOS, backed up; never in Caches, which iOS may
//! clear). Small, durable, `synchronous = FULL`.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;

use crate::Result;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS markup_layers (
  id TEXT PRIMARY KEY,
  doc TEXT NOT NULL,              -- the GeoJSON FeatureCollection with its markup header
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  updated REAL NOT NULL,
  features INTEGER NOT NULL
) WITHOUT ROWID;
-- A delete leaves a tombstone, so an older copy elsewhere cannot bring a layer back.
CREATE TABLE IF NOT EXISTS markup_tombstones (
  id TEXT PRIMARY KEY,
  at REAL NOT NULL
) WITHOUT ROWID;
-- Saved offline areas: what was asked for and what it matched (synced later;
-- the pinned tiles themselves stay on each device).
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  manifest TEXT NOT NULL,
  created INTEGER NOT NULL
) WITHOUT ROWID;
-- Deleted layers stay recoverable.
CREATE TABLE IF NOT EXISTS markup_trash (
  id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  doc TEXT NOT NULL
);
";

pub struct UserStore {
    conn: Mutex<Connection>,
}

impl UserStore {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let c = Connection::open(path)?;
        c.busy_timeout(Duration::from_secs(5))?;
        c.pragma_update(None, "journal_mode", "WAL")?;
        c.pragma_update(None, "synchronous", "FULL")?;
        c.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(c) })
    }

    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T> {
        let mut c = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        Ok(f(&mut c)?)
    }
}
