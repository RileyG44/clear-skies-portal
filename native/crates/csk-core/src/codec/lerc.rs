//! Native LERC1/2 decoding. Header inspection precedes allocation; invalid
//! pixels are NaN regardless of the numeric contents of their masked buffer.

use super::DecodeError;
use ::lerc;

pub struct Raster {
    pub width: u32,
    pub height: u32,
    pub values: Vec<f32>,
    /// Error tolerance in the source's stored vertical units, not accuracy.
    pub tolerance: f64,
    pub version: i32,
}

pub fn decode(raw: &[u8], max_samples: usize) -> Result<Raster, DecodeError> {
    let bad = |e: lerc::LercError| DecodeError::Lerc(e.to_string());
    let info = lerc::decode_info(raw).map_err(bad)?;
    let count = (info.width as usize).checked_mul(info.height as usize).ok_or(DecodeError::Size)?;
    if count == 0
        || count > max_samples.min(super::block::MAX_BLOCK_SAMPLES)
        || info.bands != 1
        || info.depth != 1
        || info.blob_size as usize != raw.len()
        || !info.tolerance.is_finite()
        || info.tolerance < 0.0
    {
        return Err(DecodeError::Lerc("invalid, oversized or non-scalar elevation blob".into()));
    }
    let image = lerc::decode(raw).map_err(bad)?;
    let mut values: Vec<f32> = match image.data {
        lerc::SampleData::F32(v) => v,
        lerc::SampleData::F64(v) => v.into_iter().map(|v| v as f32).collect(),
        lerc::SampleData::I8(v) => v.into_iter().map(f32::from).collect(),
        lerc::SampleData::U8(v) => v.into_iter().map(f32::from).collect(),
        lerc::SampleData::I16(v) => v.into_iter().map(f32::from).collect(),
        lerc::SampleData::U16(v) => v.into_iter().map(f32::from).collect(),
        lerc::SampleData::I32(v) => v.into_iter().map(|v| v as f32).collect(),
        lerc::SampleData::U32(v) => v.into_iter().map(|v| v as f32).collect(),
    };
    let mask = image.valid_masks.first().ok_or_else(|| DecodeError::Lerc("missing validity mask".into()))?;
    if values.len() != count || mask.num_pixels() != count {
        return Err(DecodeError::Size);
    }
    for (i, value) in values.iter_mut().enumerate() {
        if !mask.is_valid(i) || !value.is_finite() {
            *value = f32::NAN;
        }
    }
    Ok(Raster { width: info.width, height: info.height, values, tolerance: info.tolerance, version: info.version })
}
