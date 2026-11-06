//! Range-read access to Cloud Optimized (and ordinary) GeoTIFFs on S3.
//!
//! Source bytes are cached unchanged in the store, keyed by object and
//! range; parsed headers and decoded blocks are kept in memory. Identical
//! reads in flight are shared.

use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use csk_core::codec::{self, Tiff, TiffError, Windows};
use csk_core::resource::{Budget, Samples};
use csk_store::{Kind, Store};
use lru::LruCache;

use crate::flight::Flights;
use crate::transport::{FetchError, FetchRequest};
use crate::upstream::Upstream;

/// First look: most directories fit in 64 KiB.
const PROBE: u64 = 64 << 10;
/// IFD chain and tile tables of a COG live in the first 256 KiB.
const HEAD: u64 = 256 << 10;
/// When the directory is at the end of an ordinary TIFF and the size is unknown.
const TAIL: u64 = 1 << 20;
/// Source ranges never change for a given object key.
const RANGE_TTL: Duration = Duration::from_secs(365 * 24 * 3600);
const HEADERS: usize = 512;
/// Decoded 256² float blocks: 256 KiB each.
const BLOCKS: usize = 192;
const BLOCK_BYTES: usize = 48 << 20;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReadError {
    #[error(transparent)]
    Fetch(#[from] FetchError),
    #[error("S3 answered {0}")]
    Status(u16),
    #[error("short range: {got} of {want} bytes")]
    Short { got: usize, want: usize },
    #[error("{0}")]
    Tiff(String),
    #[error("block decode: {0}")]
    Decode(String),
    #[error("read stopped")]
    Stopped,
}

type BlockKey = (Arc<str>, usize, u32);
type BlockResult = Result<Option<Arc<Samples>>, ReadError>;

pub struct CogReader {
    store: Arc<Store>,
    upstream: Arc<Upstream>,
    base_url: String,
    headers: Mutex<LruCache<Arc<str>, Arc<Tiff>>>,
    blocks: Mutex<LruCache<BlockKey, Arc<Samples>>>,
    memory: Arc<Budget>,
    header_flights: Flights<Arc<str>, Result<Arc<Tiff>, ReadError>>,
    block_flights: Flights<BlockKey, BlockResult>,
}

impl CogReader {
    /// Existing callers retain their Arc; disposable cache ownership drops now.
    pub fn purge_memory(&self) {
        self.blocks.lock().unwrap_or_else(|e| e.into_inner()).clear();
        self.headers.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
    /// `base_url` is the bucket origin, e.g. `https://prd-tnm.s3.amazonaws.com`.
    pub fn new(store: Arc<Store>, upstream: Arc<Upstream>, base_url: impl Into<String>) -> Arc<Self> {
        Self::with_memory(store, upstream, base_url, Budget::new(256 << 20))
    }

    pub fn with_memory(
        store: Arc<Store>,
        upstream: Arc<Upstream>,
        base_url: impl Into<String>,
        memory: Arc<Budget>,
    ) -> Arc<Self> {
        Arc::new(Self {
            memory,
            store,
            upstream,
            base_url: base_url.into(),
            headers: Mutex::new(LruCache::new(NonZeroUsize::new(HEADERS).expect("nonzero"))),
            blocks: Mutex::new(LruCache::new(NonZeroUsize::new(BLOCKS).expect("nonzero"))),
            header_flights: Flights::default(),
            block_flights: Flights::default(),
        })
    }

    fn url(&self, key: &str) -> String {
        format!("{}/{}", self.base_url, key)
    }

    /// Bytes `first..=last` of an object: a local file for `file:` keys
    /// (prepared DNR rasters), else from the store or the network.
    pub async fn range(&self, key: &str, first: u64, last: u64) -> Result<Arc<[u8]>, ReadError> {
        if let Some(path) = key.strip_prefix("file:") {
            let path = std::path::PathBuf::from(path);
            return tokio::task::spawn_blocking(move || {
                use std::io::{Read, Seek, SeekFrom};
                let mut f =
                    std::fs::File::open(&path).map_err(|e| ReadError::Tiff(format!("{}: {e}", path.display())))?;
                let size = f.metadata().map_err(|e| ReadError::Tiff(e.to_string()))?.len();
                if first >= size || last < first {
                    return Ok(Arc::from([]));
                }
                let last = last.min(size.saturating_sub(1));
                if last - first + 1 > 64 << 20 {
                    return Err(ReadError::Tiff("local read exceeds the 64 MiB budget".into()));
                }
                let mut buf = vec![0u8; (last + 1).saturating_sub(first) as usize];
                f.seek(SeekFrom::Start(first)).map_err(|e| ReadError::Tiff(e.to_string()))?;
                f.read_exact(&mut buf).map_err(|e| ReadError::Tiff(e.to_string()))?;
                Ok(Arc::from(buf))
            })
            .await
            .map_err(|_| ReadError::Stopped)?;
        }
        let ck = format!("range:{key}:{first}-{last}");
        let want = (last - first + 1) as usize;
        if let Ok(Some(hit)) = self.store.get(&ck, RANGE_TTL)
            && hit.body.len() == want
        {
            return Ok(hit.body.into());
        }
        let r = self
            .upstream
            .fetch(
                FetchRequest::get(self.url(key)).range(first, last).max_body(want + 1).timeout(Duration::from_secs(30)),
            )
            .await?;
        let body = match r.status {
            206 => r.body,
            // A server that ignores Range sends the whole object.
            200 if r.body.len() as u64 > last => r.body[first as usize..=last as usize].to_vec(),
            200 => r.body,
            s => return Err(ReadError::Status(s)),
        };
        // The last range of an object can be shorter than asked for.
        if body.len() > want {
            return Err(ReadError::Short { got: body.len(), want });
        }
        let _ = self.store.put(&ck, Kind::Source, 200, "application/octet-stream", None, &body);
        Ok(body.into())
    }

    /// The parsed directory of an object. `size` (from the listing) lets an
    /// end-of-file directory be read in one request.
    pub async fn header(self: &Arc<Self>, key: &str, size: u64) -> Result<Arc<Tiff>, ReadError> {
        let key: Arc<str> = Arc::from(key);
        if let Some(t) = self.headers.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
            return Ok(t.clone());
        }
        let me = self.clone();
        let k = key.clone();
        let t = self
            .header_flights
            .run(key.clone(), move || async move { me.read_header(&k, size).await.map(Arc::new) })
            .await
            .unwrap_or(Err(ReadError::Stopped))?;
        self.headers.lock().unwrap_or_else(|e| e.into_inner()).put(key, t.clone());
        Ok(t)
    }

    async fn read_header(&self, key: &str, size: u64) -> Result<Tiff, ReadError> {
        let cap = |n: u64| if size > 0 { n.min(size) } else { n };
        let probe = self.range(key, 0, cap(PROBE) - 1).await?;
        let mut head = probe;
        let mut parsed = codec::parse(&head[..]);
        // A directory that ran past the probe: read the full head.
        if matches!(&parsed, Ok(t) if !t.complete) && (head.len() as u64) < cap(HEAD) {
            head = self.range(key, 0, cap(HEAD) - 1).await?;
            parsed = codec::parse(&head[..]);
        }
        match parsed {
            Ok(t) if !t.levels.is_empty() => return Ok(t),
            Ok(_) | Err(TiffError::NoReadableIfd) => {}
            Err(e) => return Err(ReadError::Tiff(e.to_string())),
        }
        // An ordinary TIFF with its directory at the end (WA_ColumbiaValley's
        // first IFD is at byte 328,958,768 of a 329 MB file).
        let ifd = first_ifd(&head).ok_or_else(|| ReadError::Tiff("no TIFF header".into()))?;
        if ifd < head.len() as u64 {
            return Err(ReadError::Tiff("no readable IFD found".into()));
        }
        let last = if size > ifd { (size - 1).min(ifd + TAIL - 1) } else { ifd + TAIL - 1 };
        let tail = self.range(key, ifd, last).await?;
        let windows = Windows::new().with(0, &head[..]).with(ifd, &tail[..]);
        match codec::parse(&windows) {
            Ok(t) if !t.levels.is_empty() => Ok(t),
            Ok(_) => Err(ReadError::Tiff(format!("no readable IFD found at {ifd}"))),
            Err(e) => Err(ReadError::Tiff(e.to_string())),
        }
    }

    /// One decoded block of a level; `None` for a block the file leaves empty.
    pub async fn block(
        self: &Arc<Self>,
        key: &str,
        tiff: &Arc<Tiff>,
        level: usize,
        tx: u32,
        ty: u32,
    ) -> Result<Option<Arc<Samples>>, ReadError> {
        let lv = &tiff.levels[level];
        let idx = ty * lv.blocks_across() + tx;
        let bk: BlockKey = (Arc::from(key), level, idx);
        if let Some(b) = self.blocks.lock().unwrap_or_else(|e| e.into_inner()).get(&bk) {
            return Ok(Some(b.clone()));
        }
        let (Some(&off), Some(&count)) = (lv.offsets.get(idx as usize), lv.counts.get(idx as usize)) else {
            return Ok(None);
        };
        if count == 0 {
            return Ok(None);
        }
        let me = self.clone();
        let t = tiff.clone();
        let k = bk.clone();
        let out = self
            .block_flights
            .run(bk.clone(), move || async move {
                let level = &t.levels[k.1];
                let samples = u64::from(level.block_width)
                    * u64::from(level.block_height)
                    * u64::from(level.samples_per_pixel.max(1));
                let output = samples
                    .checked_mul(4)
                    .filter(|v| *v <= 32 << 20)
                    .ok_or_else(|| ReadError::Decode("decoded block exceeds 32 MiB".into()))?
                    as usize;
                let scratch = samples
                    .checked_mul(u64::from(level.bits_per_sample).div_ceil(8))
                    .and_then(|v| v.checked_add(count))
                    .filter(|v| *v <= 64 << 20)
                    .ok_or_else(|| ReadError::Decode("decode scratch exceeds 64 MiB".into()))?
                    as usize;
                let mut reservation = match me.memory.reserve(output + scratch) {
                    Ok(r) => r,
                    Err(_) => {
                        me.purge_memory();
                        me.memory.reserve(output + scratch).map_err(|e| ReadError::Decode(e.to_string()))?
                    }
                };
                let last =
                    off.checked_add(count - 1).ok_or_else(|| ReadError::Decode("block offset overflow".into()))?;
                let raw = me.range(&k.0, off, last).await?;
                let px = tokio::task::spawn_blocking(move || {
                    let px = codec::decode_block(&raw, &t.levels[k.1], t.little_endian)
                        .map_err(|e| ReadError::Decode(e.to_string()))?;
                    drop(raw);
                    reservation.shrink(output);
                    Ok::<_, ReadError>(Arc::new(Samples::admitted(px, reservation)))
                })
                .await
                .map_err(|_| ReadError::Stopped)??;
                let mut cache = me.blocks.lock().unwrap_or_else(|e| e.into_inner());
                cache.put(k, px.clone());
                // DNR blocks may be much larger than USGS's 256² blocks.
                // A count limit alone is not a memory budget.
                let mut bytes: usize = cache.iter().map(|(_, b)| b.len() * 4).sum();
                while bytes > BLOCK_BYTES {
                    let Some((_, b)) = cache.pop_lru() else { break };
                    bytes -= b.len() * 4;
                }
                Ok(Some(px))
            })
            .await
            .unwrap_or(Err(ReadError::Stopped))?;
        Ok(out)
    }
}

/// The first IFD offset from a TIFF or BigTIFF header.
fn first_ifd(head: &[u8]) -> Option<u64> {
    let le = match head.get(..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |i: usize| {
        head.get(i..i + 2).map(|b| if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
    };
    match u16_at(2)? {
        42 => {
            let b: [u8; 4] = head.get(4..8)?.try_into().ok()?;
            Some(u64::from(if le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) }))
        }
        43 => {
            let b: [u8; 8] = head.get(8..16)?.try_into().ok()?;
            Some(if le { u64::from_le_bytes(b) } else { u64::from_be_bytes(b) })
        }
        _ => None,
    }
}
