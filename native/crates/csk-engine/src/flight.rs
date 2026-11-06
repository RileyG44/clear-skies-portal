//! Shared work. Identical requests (two map layers asking for the same tile,
//! a pan re-requesting a tile still in flight) run once. The work belongs to
//! its callers: it is aborted only when the last one has gone away, and runs
//! to completion otherwise, even if the first caller left.

use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::{Arc, Mutex};

use tokio::sync::watch;
use tokio::task::AbortHandle;

struct Slot<V> {
    rx: watch::Receiver<Option<V>>,
    waiters: usize,
    abort: AbortHandle,
}

pub struct Flights<K, V> {
    slots: Arc<Mutex<HashMap<K, Slot<V>>>>,
}

impl<K, V> Default for Flights<K, V> {
    fn default() -> Self {
        Self { slots: Arc::new(Mutex::new(HashMap::new())) }
    }
}

struct Waiter<K: Hash + Eq + Clone, V> {
    slots: Arc<Mutex<HashMap<K, Slot<V>>>>,
    key: K,
    done: bool,
}

impl<K: Hash + Eq + Clone, V> Drop for Waiter<K, V> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(slot) = slots.get_mut(&self.key) {
            slot.waiters -= 1;
            if slot.waiters == 0 {
                slot.abort.abort();
                slots.remove(&self.key);
            }
        }
    }
}

impl<K, V> Flights<K, V>
where
    K: Hash + Eq + Clone + Send + 'static,
    V: Clone + Send + Sync + 'static,
{
    pub fn len(&self) -> usize {
        self.slots.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Joins the work running under `key`, or starts `work` on the runtime.
    /// Returns `None` only if the work was aborted or panicked.
    pub async fn run<F, Fut>(&self, key: K, work: F) -> Option<V>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = V> + Send + 'static,
    {
        let mut rx = {
            let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(slot) = slots.get_mut(&key) {
                slot.waiters += 1;
                slot.rx.clone()
            } else {
                let (tx, rx) = watch::channel(None);
                let fut = work();
                let table = self.slots.clone();
                let k = key.clone();
                let handle = tokio::spawn(async move {
                    let v = fut.await;
                    // Remove first, so a caller arriving after this point
                    // starts fresh work instead of joining a finished slot.
                    table.lock().unwrap_or_else(|e| e.into_inner()).remove(&k);
                    let _ = tx.send(Some(v));
                });
                slots.insert(key.clone(), Slot { rx: rx.clone(), waiters: 1, abort: handle.abort_handle() });
                rx
            }
        };
        let mut waiter = Waiter { slots: self.slots.clone(), key, done: false };
        let out = loop {
            if let Some(v) = rx.borrow_and_update().clone() {
                break Some(v);
            }
            if rx.changed().await.is_err() {
                break None; // aborted or panicked: the sender is gone
            }
        };
        waiter.done = true;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn shares_and_aborts_with_last_waiter() {
        let f: Arc<Flights<u32, u32>> = Arc::default();
        let runs = Arc::new(AtomicUsize::new(0));
        let job = |runs: Arc<AtomicUsize>| {
            move || async move {
                runs.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(30)).await;
                7
            }
        };
        let (a, b) = tokio::join!(f.run(1, job(runs.clone())), f.run(1, job(runs.clone())));
        assert_eq!((a, b, runs.load(Ordering::SeqCst)), (Some(7), Some(7), 1));
        assert!(f.is_empty());

        // A lone caller that gives up aborts the work.
        let r = tokio::time::timeout(Duration::from_millis(5), f.run(2, job(runs.clone()))).await;
        assert!(r.is_err());
        assert!(f.is_empty());
    }
}
