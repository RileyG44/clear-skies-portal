//! Cooperative execution for durable jobs. Expiry parks work at tile or
//! bounded I/O boundaries; it never turns a saved job into a failed download.

use std::sync::{Condvar, Mutex};
use tokio::sync::watch;

#[derive(Clone, Copy)]
struct State {
    allowed: bool,
    stopped: bool,
}

pub struct Work {
    state: Mutex<State>,
    wake: Condvar,
    changed: watch::Sender<State>,
}

impl Default for Work {
    fn default() -> Self {
        let state = State { allowed: true, stopped: false };
        Self { state: Mutex::new(state), wake: Condvar::new(), changed: watch::channel(state).0 }
    }
}

impl Work {
    pub fn is_stopped(&self) -> bool {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).stopped
    }

    pub fn reader<R: std::io::Read>(&self, inner: R) -> Reader<'_, R> {
        Reader { inner, work: self }
    }
    pub fn set_allowed(&self, allowed: bool) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.allowed = allowed;
        self.changed.send_replace(*state);
        self.wake.notify_all();
    }

    pub fn shutdown(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.stopped = true;
        self.changed.send_replace(*state);
        self.wake.notify_all();
    }

    pub async fn checkpoint(&self) -> bool {
        let mut changed = self.changed.subscribe();
        loop {
            let state = *changed.borrow_and_update();
            if state.stopped {
                return false;
            }
            if state.allowed {
                return true;
            }
            if changed.changed().await.is_err() {
                return false;
            }
        }
    }

    pub fn checkpoint_blocking(&self) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        while !state.allowed && !state.stopped {
            state = self.wake.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        !state.stopped
    }
}

pub struct Reader<'a, R> {
    inner: R,
    work: &'a Work,
}
impl<R: std::io::Read> std::io::Read for Reader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if !self.work.checkpoint_blocking() {
            return Err(std::io::Error::other("engine stopped"));
        }
        let len = buf.len().min(64 << 10);
        self.inner.read(&mut buf[..len])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    #[tokio::test]
    async fn expiry_parks_async_and_blocking_work_then_resumes_without_restart() {
        let work = Arc::new(Work::default());
        work.set_allowed(false);
        let async_work = work.clone();
        let mut pending = tokio::spawn(async move { async_work.checkpoint().await });
        let blocking_work = work.clone();
        let mut blocking = tokio::task::spawn_blocking(move || blocking_work.checkpoint_blocking());
        assert!(tokio::time::timeout(Duration::from_millis(10), &mut pending).await.is_err());
        assert!(tokio::time::timeout(Duration::from_millis(10), &mut blocking).await.is_err());
        work.set_allowed(true);
        assert!(pending.await.unwrap());
        assert!(blocking.await.unwrap());
        work.set_allowed(false);
        let blocking_work = work.clone();
        let blocking = tokio::task::spawn_blocking(move || blocking_work.checkpoint_blocking());
        work.shutdown();
        assert!(!work.checkpoint().await);
        assert!(!blocking.await.unwrap());
    }
}
