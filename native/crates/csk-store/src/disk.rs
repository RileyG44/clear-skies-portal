//! Atomic disk-growth admission shared by Rust jobs and system-owned transfers.
//! Existing files already reduce filesystem availability. Claims cover only
//! future growth, so completed/pinned bytes are never counted a second time.
use rusqlite::{Connection, TransactionBehavior, params};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("disk admission: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("disk admission: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not enough device storage: {needed} bytes required; {available} available")]
    Unavailable { needed: u64, available: u64 },
    #[error("invalid disk claim")]
    Invalid,
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy)]
pub struct Capacity {
    pub available: u64,
    pub total: u64,
}
#[derive(Clone, Copy)]
struct Policy {
    min_reserve: u64,
    max_reserve: u64,
    cache_floor: u64,
}
impl Default for Policy {
    fn default() -> Self {
        Self { min_reserve: 2 << 30, max_reserve: 8 << 30, cache_floor: 256 << 20 }
    }
}

pub struct Budget {
    db: Mutex<Connection>,
    root: PathBuf,
    capacity: Box<dyn Fn() -> std::io::Result<Capacity> + Send + Sync>,
    policy: Policy,
}

#[derive(Clone, Copy, Debug)]
pub struct Stats {
    pub remaining: u64,
    pub available: u64,
    pub reserve: u64,
    pub cache_floor: u64,
}

impl Budget {
    pub fn open(root: &Path) -> Result<Arc<Self>> {
        let dir = root.to_owned();
        Self::with_capacity(
            root,
            Box::new(move || Ok(Capacity { available: fs2::available_space(&dir)?, total: fs2::total_space(&dir)? })),
        )
    }
    /// A platform or deterministic test supplies volume readings; the same
    /// reserve policy and transaction govern every caller.
    pub fn with_capacity(
        root: &Path,
        capacity: Box<dyn Fn() -> std::io::Result<Capacity> + Send + Sync>,
    ) -> Result<Arc<Self>> {
        Self::with_policy_capacity(root, Policy::default(), capacity)
    }
    fn with_policy_capacity(
        root: &Path,
        policy: Policy,
        capacity: Box<dyn Fn() -> std::io::Result<Capacity> + Send + Sync>,
    ) -> Result<Arc<Self>> {
        std::fs::create_dir_all(root)?;
        let db = Connection::open(root.join("admission.sqlite"))?;
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, remaining INTEGER NOT NULL CHECK(remaining>=0)) WITHOUT ROWID;")?;
        Ok(Arc::new(Self { db: Mutex::new(db), root: root.into(), capacity, policy }))
    }

    /// Replacing an identity is idempotent. A reduction/release always succeeds,
    /// even if another application consumed space after initial admission.
    pub fn reserve(&self, id: &str, remaining: u64) -> Result<()> {
        if id.is_empty() || id.len() > 256 || !id.is_ascii() || remaining > 8 << 40 {
            return Err(Error::Invalid);
        }
        let mut db = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let previous: u64 =
            tx.query_row("SELECT COALESCE((SELECT remaining FROM claims WHERE id=?1),0)", [id], |r| r.get(0))?;
        if remaining > previous {
            if previous == 0 && tx.query_row("SELECT COUNT(*) FROM claims", [], |r| r.get::<_, u64>(0))? >= 4096 {
                return Err(Error::Invalid);
            }
            let pending: u64 = tx.query_row("SELECT COALESCE(SUM(remaining),0) FROM claims", [], |r| r.get(0))?;
            let cap = (self.capacity)()?;
            let reserve = (cap.total / 20).clamp(self.policy.min_reserve, self.policy.max_reserve);
            let needed = pending
                .saturating_sub(previous)
                .saturating_add(remaining)
                .saturating_add(reserve)
                .saturating_add(self.policy.cache_floor);
            if needed > cap.available {
                return Err(Error::Unavailable { needed, available: cap.available });
            }
        }
        if remaining == 0 {
            tx.execute("DELETE FROM claims WHERE id=?1", [id])?;
        } else {
            tx.execute("INSERT OR REPLACE INTO claims VALUES (?1,?2)", params![id, remaining])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn stats(&self) -> Result<Stats> {
        let db = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let remaining = db.query_row("SELECT COALESCE(SUM(remaining),0) FROM claims", [], |r| r.get(0))?;
        let cap = (self.capacity)()?;
        Ok(Stats {
            remaining,
            available: cap.available,
            reserve: (cap.total / 20).clamp(self.policy.min_reserve, self.policy.max_reserve),
            cache_floor: self.policy.cache_floor,
        })
    }

    /// Drop abandoned identities from a single owner's durable journal. The
    /// caller must own this namespace; transfer and CPU-job claims stay separate.
    pub fn reconcile(&self, prefix: &str, live: &[String]) -> Result<()> {
        if prefix.is_empty() {
            return Err(Error::Invalid);
        }
        let mut db = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let ids: Vec<String> =
            tx.prepare("SELECT id FROM claims")?.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        for id in ids {
            if id.starts_with(prefix) && !live.contains(&id) {
                tx.execute("DELETE FROM claims WHERE id=?1", [id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// A file lock proves the old engine is gone before clearing its abandoned
    /// transient claims. Background URLSession transfers retain their namespace.
    pub fn engine_session(self: &Arc<Self>) -> Result<Arc<Session>> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.root.join("engine.lock"))?;
        fs2::FileExt::try_lock_exclusive(&file)?;
        self.reconcile("engine:", &[])?;
        Ok(Arc::new(Session { budget: self.clone(), _file: file, next: AtomicU64::new(1) }))
    }
}

pub struct Session {
    pub budget: Arc<Budget>,
    _file: std::fs::File,
    next: AtomicU64,
}
impl Session {
    pub fn claim(self: &Arc<Self>, bytes: u64) -> Result<Arc<Lease>> {
        let id = format!("engine:{}", self.next.fetch_add(1, Ordering::Relaxed));
        self.budget.reserve(&id, bytes)?;
        Ok(Arc::new(Lease { session: self.clone(), id, remaining: Mutex::new(bytes) }))
    }
}
pub struct Lease {
    session: Arc<Session>,
    id: String,
    remaining: Mutex<u64>,
}
impl Lease {
    pub fn consume(&self, bytes: u64) -> Result<()> {
        let mut remaining = self.remaining.lock().unwrap_or_else(|e| e.into_inner());
        let next = remaining.saturating_sub(bytes);
        self.session.budget.reserve(&self.id, next)?;
        *remaining = next;
        Ok(())
    }
    pub fn materialized(&self) -> Result<()> {
        self.consume(u64::MAX)
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        let _ = self.session.budget.reserve(&self.id, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn open(root: &Path, free: Arc<AtomicU64>) -> Arc<Budget> {
        Budget::with_policy_capacity(
            root,
            Policy { min_reserve: 10, max_reserve: 10, cache_floor: 5 },
            Box::new(move || Ok(Capacity { available: free.load(Ordering::SeqCst), total: 1000 })),
        )
        .unwrap()
    }
    #[test]
    fn handles_and_relaunch_share_outstanding_claims_without_double_counting_written_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let free = Arc::new(AtomicU64::new(100));
        let a = open(dir.path(), free.clone());
        let b = open(dir.path(), free.clone());
        a.reserve("transfer:one", 60).unwrap();
        assert!(b.reserve("transfer:two", 26).is_err());
        b.reserve("transfer:two", 25).unwrap();
        // Thirty bytes reached disk. Reduce future growth by the same amount.
        free.store(70, Ordering::SeqCst);
        a.reserve("transfer:one", 30).unwrap();
        assert!(b.reserve("new", 1).is_err());
        drop(a);
        drop(b);
        let a = open(dir.path(), free.clone());
        assert_eq!(a.stats().unwrap().remaining, 55);
        free.store(1, Ordering::SeqCst);
        a.reserve("transfer:one", 0).unwrap();
        assert_eq!(a.stats().unwrap().remaining, 25);
    }
    #[test]
    fn concurrent_admission_is_atomic_and_sessions_preserve_platform_transfers() {
        let dir = tempfile::tempdir().unwrap();
        let free = Arc::new(AtomicU64::new(100));
        let a = open(dir.path(), free.clone());
        let b = open(dir.path(), free);
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let handles = [a.clone(), b.clone()]
            .into_iter()
            .enumerate()
            .map(|(i, budget)| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    budget.reserve(&format!("transfer:{i}"), 50).is_ok()
                })
            })
            .collect::<Vec<_>>();
        assert_eq!(handles.into_iter().map(|h| h.join().unwrap() as usize).sum::<usize>(), 1);
        a.reserve("engine:orphan", 10).unwrap();
        let session = a.engine_session().unwrap();
        assert!(b.engine_session().is_err());
        assert_eq!(a.stats().unwrap().remaining, 50);
        let lease = session.claim(20).unwrap();
        assert_eq!(a.stats().unwrap().remaining, 70);
        lease.consume(10).unwrap();
        assert_eq!(a.stats().unwrap().remaining, 60);
        drop(lease);
        drop(session);
        assert_eq!(a.stats().unwrap().remaining, 50);
        assert!(b.engine_session().is_ok());
    }
}
