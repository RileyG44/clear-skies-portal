//! National 3DEP elevation (USGS ImageServer exports): the continuous
//! baseline under 1 m lidar, everywhere in the United States.

use std::sync::Arc;
use std::time::Duration;

use csk_core::codec;
use csk_core::geo::MERC_MAX;

use crate::transport::FetchRequest;
use crate::upstream::{DEP_HOST, Upstream, UpstreamError};

/// 3DEP reads ocean as 0 m, which flattens the overview's seafloor in whole
/// tiles: below this zoom the national layer stays out for every client.
pub const MIN_ZOOM: u8 = 9;

#[derive(Debug, Clone, PartialEq)]
pub struct NationalTile {
    /// `size × size` metres, NaN where 3DEP has no value.
    pub grid: Vec<f32>,
    pub size: u32,
    pub coverage: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum NationalError {
    #[error(transparent)]
    Upstream(#[from] UpstreamError),
    #[error("3DEP export was not a readable TIFF: {0}")]
    Format(String),
}

impl NationalError {
    pub fn circuit_open(&self) -> bool {
        matches!(self, Self::Upstream(UpstreamError::CircuitOpen(_)))
    }
}

pub fn export_url(z: u8, x: u32, y: u32, size: u32) -> String {
    let sp = 2.0 * MERC_MAX / 2f64.powi(i32::from(z));
    let x0 = -MERC_MAX + f64::from(x) * sp;
    let y1 = MERC_MAX - f64::from(y) * sp;
    format!(
        "https://{DEP_HOST}/arcgis/rest/services/3DEPElevation/ImageServer/exportImage\
         ?bbox={x0},{},{},{y1}&bboxSR=3857&imageSR=3857&size={size},{size}&format=tiff&f=image",
        y1 - sp,
        x0 + sp
    )
}

fn is_tiff(b: &[u8]) -> bool {
    b.len() > 8 && (b.starts_with(b"II*\0") || b.starts_with(b"MM\0*"))
}

/// Fetches and decodes one export. `Ok(None)` when 3DEP has no value anywhere
/// in the tile.
pub async fn fetch(
    upstream: &Arc<Upstream>,
    z: u8,
    x: u32,
    y: u32,
    size: u32,
) -> Result<Option<NationalTile>, NationalError> {
    let req = FetchRequest::get(export_url(z, x, y, size)).timeout(Duration::from_secs(18)).max_body(16 << 20);
    let r = upstream.fetch_guarded(req, |r| r.status == 200 && is_tiff(&r.body)).await?;
    tokio::task::spawn_blocking(move || decode(&r.body, size))
        .await
        .map_err(|_| NationalError::Format("decode stopped".into()))?
}

/// Decodes an export, keeping only plausible metres (−2 km to 10 km).
pub fn decode(body: &[u8], size: u32) -> Result<Option<NationalTile>, NationalError> {
    let t = codec::parse(body).map_err(|e| NationalError::Format(e.to_string()))?;
    let l = t.levels.first().ok_or_else(|| NationalError::Format("no image".into()))?;
    if l.width != size || l.height != size {
        return Err(NationalError::Format(format!("{}×{} export, expected {size}²", l.width, l.height)));
    }
    let (w, h) = (l.width as usize, l.height as usize);
    let mut grid = vec![f32::NAN; w * h];
    let cols = l.blocks_across() as usize;
    let mut covered = 0usize;
    for (i, (&off, &count)) in l.offsets.iter().zip(&l.counts).enumerate() {
        let (off, count) = (off as usize, count as usize);
        let Some(raw) = off.checked_add(count).and_then(|end| body.get(off..end)) else { continue };
        if count == 0 {
            continue;
        }
        let Ok(block) = codec::decode_block(raw, l, t.little_endian) else { continue };
        let (bw, bh) = (l.block_width as usize, l.block_height as usize);
        let (x0, y0) = ((i % cols) * bw, (i / cols) * bh);
        for y in y0..(y0 + bh).min(h) {
            for x in x0..(x0 + bw).min(w) {
                let v = block[(y - y0) * bw + (x - x0)];
                if !v.is_finite()
                    || t.geo.nodata.is_some_and(|nd| f64::from(v) == nd)
                    || !(-2000.0..=10000.0).contains(&v)
                {
                    continue;
                }
                grid[y * w + x] = v;
                covered += 1;
            }
        }
    }
    Ok((covered > 0).then(|| NationalTile { grid, size, coverage: covered as f64 / (w * h) as f64 }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_url_matches_the_engine() {
        // cache-budget.js:mercBbox for z=0 is the whole square.
        assert_eq!(
            super::export_url(0, 0, 0, 256),
            "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage\
             ?bbox=-20037508.342789244,-20037508.342789244,20037508.342789244,20037508.342789244\
             &bboxSR=3857&imageSR=3857&size=256,256&format=tiff&f=image"
        );
    }
}
