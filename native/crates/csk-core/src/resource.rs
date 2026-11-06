//! Shared byte admission. A reservation follows the allocation's final owner,
//! including cache readers, rather than ending when the decoder returns.

use std::sync::{Arc, Mutex};

#[derive(Debug, Default, Clone, Copy)]
pub struct Stats {
    pub limit: usize,
    pub used: usize,
    pub peak: usize,
}

#[derive(Debug)]
pub struct Budget(Mutex<Stats>);

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("memory admission requires {needed} bytes; {available} available")]
pub struct Unavailable {
    pub needed: usize,
    pub available: usize,
}

impl Budget {
    pub fn new(limit: usize) -> Arc<Self> {
        Arc::new(Self(Mutex::new(Stats { limit, ..Stats::default() })))
    }

    /// Never waits while a caller retains other allocations: that would deadlock
    /// a wide sampling window. Admission failure stays a retryable source error.
    pub fn reserve(self: &Arc<Self>, bytes: usize) -> Result<Reservation, Unavailable> {
        let mut stats = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let available = stats.limit.saturating_sub(stats.used);
        if bytes > available {
            return Err(Unavailable { needed: bytes, available });
        }
        stats.used += bytes;
        stats.peak = stats.peak.max(stats.used);
        Ok(Reservation { budget: self.clone(), bytes })
    }

    pub fn stats(&self) -> Stats {
        *self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn set_limit(&self, limit: usize) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).limit = limit;
    }
}

#[derive(Debug)]
pub struct Reservation {
    budget: Arc<Budget>,
    bytes: usize,
}
impl Reservation {
    pub fn grow_to(&mut self, bytes: usize) -> Result<(), Unavailable> {
        let additional = bytes.saturating_sub(self.bytes);
        let mut stats = self.budget.0.lock().unwrap_or_else(|e| e.into_inner());
        let available = stats.limit.saturating_sub(stats.used);
        if additional > available {
            return Err(Unavailable { needed: additional, available });
        }
        stats.used += additional;
        stats.peak = stats.peak.max(stats.used);
        self.bytes += additional;
        Ok(())
    }

    pub fn shrink(&mut self, bytes: usize) {
        assert!(bytes <= self.bytes);
        self.budget.0.lock().unwrap_or_else(|e| e.into_inner()).used -= self.bytes - bytes;
        self.bytes = bytes;
    }
}
impl Drop for Reservation {
    fn drop(&mut self) {
        self.budget.0.lock().unwrap_or_else(|e| e.into_inner()).used -= self.bytes;
    }
}

/// Float blocks keep their byte reservation until the final Arc reader leaves.
#[derive(Debug)]
pub struct Samples {
    values: Vec<f32>,
    _reservation: Option<Reservation>,
}
impl Samples {
    pub fn admitted(values: Vec<f32>, reservation: Reservation) -> Self {
        Self { values, _reservation: Some(reservation) }
    }
}
impl From<Vec<f32>> for Samples {
    fn from(values: Vec<f32>) -> Self {
        Self { values, _reservation: None }
    }
}
impl std::ops::Deref for Samples {
    type Target = [f32];
    fn deref(&self) -> &Self::Target {
        &self.values
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admission_is_atomic_and_resident_readers_keep_the_charge() {
        let budget = Budget::new(32);
        let mut reservation = budget.reserve(24).unwrap();
        assert_eq!(budget.reserve(9).unwrap_err().available, 8);
        reservation.shrink(16);
        let block = Arc::new(Samples::admitted(vec![0.0; 4], reservation));
        let reader = block.clone();
        drop(block);
        assert_eq!(budget.stats().used, 16);
        budget.set_limit(8);
        assert!(budget.reserve(1).is_err());
        drop(reader);
        assert_eq!(budget.stats().used, 0);
        assert_eq!(budget.stats().peak, 24);
    }

    #[test]
    fn competing_reservations_cannot_exceed_the_limit() {
        let budget = Budget::new(100);
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let budget = budget.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let reservation = budget.reserve(30).ok();
                    barrier.wait();
                    drop(reservation);
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(budget.stats().used, 0);
        assert!(budget.stats().peak <= 100);
    }
}
