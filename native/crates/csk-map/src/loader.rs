//! Terrain tile scheduling: which source tiles the view needs, in what
//! order, and keeping only those in flight.
//!
//! For each display tile, nearest the view centre first, every source whose
//! coverage allows it is asked at its native level, highest rank first, until
//! a held complete answer covers the tile: lower ranks beneath it would never
//! draw. While a lidar tile renders, a coarser stand-in from the same source
//! covers the visible tile. Requests run on the engine runtime; answers come
//! back through a channel the render thread drains, and each wakes the
//! platform's frame loop. Requests the view no longer needs are cancelled.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use csk_engine::Engine;
use csk_engine::elevation::{TerrainAnswer, TerrainCoverage, TerrainSource};
use csk_gpu::{Answer, Renderer, SourceSpec, Terrain, TileId, TileKey, View};

/// Concurrent requests per source: a slow survey source cannot starve the
/// fast overview, and the engine schedules its own upstream work.
const IN_FLIGHT_PER_SOURCE: usize = 6;
/// A stale stand-in (served after an upstream failure) is asked again after.
const REFRESH_STALE: Duration = Duration::from_secs(30);

pub type Wake = Arc<dyn Fn() + Send + Sync>;

fn id(source: TerrainSource) -> u16 {
    TerrainSource::ALL.iter().position(|s| *s == source).expect("listed source") as u16
}

fn source(id: u16) -> TerrainSource {
    TerrainSource::ALL[usize::from(id)]
}

/// The level-`z` tile containing (or equal to) display tile `d`.
fn ancestor(d: TileId, z: u8) -> TileId {
    let k = d.z.saturating_sub(z);
    TileId { z: d.z - k, x: d.x >> k, y: d.y >> k }
}

/// Drawing policy for the scene from a coverage snapshot.
pub fn sources(coverage: &TerrainCoverage, enabled: &[TerrainSource]) -> HashMap<u16, SourceSpec> {
    enabled
        .iter()
        .map(|&s| {
            let coverage = coverage.clone();
            let spec = SourceSpec {
                authoritative_coverage: s.authoritative(),
                allowed: Some(Arc::new(move |t: TileId| coverage.allows(s, t.z, t.x, t.y))),
            };
            (id(s), spec)
        })
        .collect()
}

pub struct Loader {
    runtime: tokio::runtime::Handle,
    engine: Arc<Engine>,
    /// Enabled sources, highest rank first.
    enabled: Vec<TerrainSource>,
    revision: i64,
    coverage: TerrainCoverage,
    in_flight: HashMap<TileKey, tokio::task::AbortHandle>,
    /// Not to be asked again before.
    later: HashMap<TileKey, Instant>,
    /// Held answers to ask for again (stale stand-ins, changed coverage).
    refresh: HashSet<TileKey>,
    tx: mpsc::Sender<(TileKey, TerrainAnswer)>,
    rx: mpsc::Receiver<(TileKey, TerrainAnswer)>,
    wake: Wake,
}

impl Loader {
    pub fn new(runtime: tokio::runtime::Handle, engine: Arc<Engine>, wake: Wake) -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            revision: engine.terrain_revision(),
            coverage: engine.terrain_coverage(),
            runtime,
            engine,
            enabled: Vec::new(),
            in_flight: HashMap::new(),
            later: HashMap::new(),
            refresh: HashSet::new(),
            tx,
            rx,
            wake,
        }
    }

    /// Sets the enabled sources (the terrain source preference) and the
    /// scene's drawing policy for them.
    pub fn set_sources(&mut self, terrain: &mut Terrain, enabled: &[TerrainSource]) {
        let mut enabled = enabled.to_vec();
        enabled.sort_by_key(|s| std::cmp::Reverse(s.rank()));
        enabled.dedup();
        self.enabled = enabled;
        terrain.set_sources(sources(&self.coverage, &self.enabled));
    }

    pub fn in_flight(&self) -> usize {
        self.in_flight.len()
    }

    /// Wakes the frame loop at `at`, when a deferred request becomes due.
    fn wake_at(&self, after: Duration) {
        let wake = self.wake.clone();
        self.runtime.spawn(async move {
            tokio::time::sleep(after).await;
            wake();
        });
    }

    /// Takes in arrived answers and coverage changes, then cancels and
    /// starts requests for `view`. Returns whether the scene changed.
    pub fn update(&mut self, gpu: &Renderer, terrain: &mut Terrain, view: &View) -> bool {
        let now = Instant::now();
        let mut changed = false;
        let revision = self.engine.terrain_revision();
        if revision != self.revision {
            self.revision = revision;
            self.coverage = self.engine.terrain_coverage();
            terrain.set_sources(sources(&self.coverage, &self.enabled));
            for s in TerrainSource::ALL.into_iter().filter(|s| s.authoritative()) {
                self.refresh.extend(terrain.keys_of(id(s)));
            }
            self.later.clear();
            changed = true;
        }
        while let Ok((key, answer)) = self.rx.try_recv() {
            // An answer for a request since cancelled still holds.
            self.in_flight.remove(&key);
            self.refresh.remove(&key);
            let rank = source(key.source).rank();
            let stored = match answer {
                TerrainAnswer::Tile { values, lasting } => {
                    if !lasting {
                        self.refresh.insert(key);
                        self.later.insert(key, now + REFRESH_STALE);
                        self.wake_at(REFRESH_STALE);
                    }
                    terrain.insert(gpu, key, rank, &values)
                }
                TerrainAnswer::Empty { lasting } => {
                    if !lasting {
                        self.refresh.insert(key);
                        self.later.insert(key, now + REFRESH_STALE);
                        self.wake_at(REFRESH_STALE);
                    }
                    terrain.insert_empty(key, rank)
                }
                TerrainAnswer::Retry { after } => {
                    self.later.insert(key, now + after);
                    self.wake_at(after);
                    Ok(())
                }
            };
            changed |= stored.is_ok();
        }
        let wanted = self.wanted(terrain, view);
        let keep: HashSet<TileKey> = wanted.iter().copied().collect();
        self.in_flight.retain(|key, task| {
            let kept = keep.contains(key);
            if !kept {
                task.abort();
            }
            kept
        });
        self.later.retain(|key, at| keep.contains(key) && *at > now);
        let mut busy: HashMap<u16, usize> = HashMap::new();
        for key in self.in_flight.keys() {
            *busy.entry(key.source).or_default() += 1;
        }
        for key in wanted {
            let held = terrain.answer(key).is_some();
            if (held && !self.refresh.contains(&key))
                || self.in_flight.contains_key(&key)
                || self.later.contains_key(&key)
            {
                continue;
            }
            let count = busy.entry(key.source).or_default();
            if *count >= IN_FLIGHT_PER_SOURCE {
                continue;
            }
            *count += 1;
            let (engine, tx, wake) = (self.engine.clone(), self.tx.clone(), self.wake.clone());
            let s = source(key.source);
            let TileId { z, x, y } = key.tile;
            let task = self.runtime.spawn(async move {
                let answer = engine.terrain_tile(s, z, x, y).await;
                if tx.send((key, answer)).is_ok() {
                    wake();
                }
            });
            self.in_flight.insert(key, task.abort_handle());
        }
        changed
    }

    /// Source tiles the view needs, most urgent first.
    fn wanted(&self, terrain: &Terrain, view: &View) -> Vec<TileKey> {
        let level = view.level();
        let visible: HashSet<TileId> = view.tiles_at(level, 0).into_iter().collect();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        let mut stand_ins = Vec::new();
        for d in view.wanted() {
            for &s in &self.enabled {
                if !self.coverage.allows(s, d.z, d.x, d.y) {
                    continue;
                }
                let key = TileKey { source: id(s), tile: ancestor(d, level.min(s.max_zoom())) };
                if seen.insert(key) {
                    out.push(key);
                }
                match terrain.answer(key) {
                    // Nothing ranked lower would draw under a complete answer.
                    Some(Answer::Complete) => break,
                    Some(_) => {}
                    None if s.stand_in() > 0 && visible.contains(&d) => {
                        let coarse =
                            TileKey { source: key.source, tile: ancestor(key.tile, key.tile.z - s.stand_in()) };
                        let t = coarse.tile;
                        if t.z < key.tile.z && self.coverage.allows(s, t.z, t.x, t.y) && seen.insert(coarse) {
                            stand_ins.push(coarse);
                        }
                    }
                    None => {}
                }
            }
        }
        // Stand-ins are cheap cover: ask for them right after the nearest
        // visible tiles.
        let split = out.len().min(self.enabled.len() * 4);
        out.splice(split..split, stand_ins);
        out
    }
}

impl Drop for Loader {
    fn drop(&mut self) {
        for task in self.in_flight.values() {
            task.abort();
        }
    }
}
