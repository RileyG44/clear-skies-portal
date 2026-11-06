//! Independent Esri fixture plus malformed-data and secondary-compression gates.
use csk_core::codec::{self, DecodeError, Level};
use sha2::{Digest, Sha256};

const RAW: &[u8] = include_bytes!("../../../../test-fixtures/oregon/hood-survey-edge.lerc");

fn canonical(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| if v.is_nan() { 0x7fc00000u32.to_le_bytes() } else { v.to_le_bytes() }).collect()
}

fn level() -> Level {
    Level {
        width: 256,
        height: 256,
        block_width: 256,
        block_height: 256,
        compression: 34887,
        lerc_compression: 0,
        predictor: 1,
        bits_per_sample: 32,
        samples_per_pixel: 1,
        sample_format: 3,
        offsets: vec![],
        counts: vec![],
        stripped: false,
    }
}

#[test]
fn every_sample_and_mask_match_official_esri_decoder() {
    let reference: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/lerc/hood-survey-edge.json")).unwrap();
    let decoded = codec::lerc::decode(RAW, 65536).unwrap();
    assert_eq!((decoded.width, decoded.height), (256, 256));
    assert_eq!(decoded.values.iter().filter(|v| v.is_finite()).count(), reference["valid"].as_u64().unwrap() as usize);
    let hash = Sha256::digest(canonical(&decoded.values)).iter().map(|b| format!("{b:02x}")).collect::<String>();
    assert_eq!(hash, reference["canonicalFloat32Sha256"].as_str().unwrap());
}

#[test]
fn tiff_raw_deflate_and_zstd_preserve_mask_and_samples() {
    let expected = canonical(&codec::lerc::decode(RAW, 65536).unwrap().values);
    let mut lv = level();
    for (secondary, bytes) in [
        (0, RAW.to_vec()),
        (1, miniz_oxide::deflate::compress_to_vec_zlib(RAW, 6)),
        (2, zstd::stream::encode_all(RAW, 3).unwrap()),
    ] {
        lv.lerc_compression = secondary;
        assert_eq!(canonical(&codec::decode_block(&bytes, &lv, true).unwrap()), expected);
    }
    lv.lerc_compression = 0;
    lv.block_width = 128;
    lv.block_height = 512;
    assert_eq!(codec::decode_block(RAW, &lv, true), Err(DecodeError::Size));
    lv = level();
    lv.block_height = 512;
    assert_eq!(codec::decode_block(RAW, &lv, true), Err(DecodeError::Size));
    lv.stripped = true;
    let padded = codec::decode_block(RAW, &lv, true).unwrap();
    assert_eq!(canonical(&padded[..65536]), expected);
    assert!(padded[65536..].iter().all(|v| v.is_nan()));
}

#[test]
fn rejects_oversize_truncated_corrupt_and_non_scalar_blobs() {
    assert!(codec::lerc::decode(RAW, 65535).is_err());
    for len in [0, 6, 10, 60, RAW.len() - 1] {
        assert!(codec::lerc::decode(&RAW[..len], 65536).is_err());
    }
    let mut corrupt = RAW.to_vec();
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(codec::lerc::decode(&corrupt, 65536).is_err());
    let mut trailing = RAW.to_vec();
    trailing.push(0);
    assert!(codec::lerc::decode(&trailing, 65536).is_err());
    let multi = ::lerc::encode_borrowed(
        1,
        2,
        2,
        1,
        &[1f32, 2., 3., 4.],
        &[::lerc::bitmask::BitMask::all_valid(2)],
        None,
        ::lerc::Precision::Lossless,
    )
    .unwrap();
    assert!(codec::lerc::decode(&multi, 65536).is_err());
    // Valid-looking constant header: size admission must precede allocation.
    let mut oversized = ::lerc::encode_slice(2, 2, &[1f32; 4], ::lerc::Precision::Lossless).unwrap();
    oversized[14..18].copy_from_slice(&32768i32.to_le_bytes());
    oversized[18..22].copy_from_slice(&32768i32.to_le_bytes());
    assert!(
        matches!(codec::lerc::decode(&oversized, usize::MAX), Err(DecodeError::Lerc(message)) if message.contains("oversized"))
    );
}

#[test]
fn zstd_window_and_decompressed_output_are_bounded() {
    let mut lv = level();
    lv.lerc_compression = 2;
    // Non-single-segment frame declaring a 1 GiB window; no blocks needed.
    assert!(codec::decode_block(&[0x28, 0xb5, 0x2f, 0xfd, 0, 0xa0], &lv, true).is_err());
    let bomb = zstd::stream::encode_all(&vec![0; 2 << 20][..], 3).unwrap();
    assert_eq!(codec::decode_block(&bomb, &lv, true), Err(DecodeError::Size));
    lv.lerc_compression = 1;
    let bomb = miniz_oxide::deflate::compress_to_vec_zlib(&vec![0; 2 << 20], 6);
    assert!(codec::decode_block(&bomb, &lv, true).is_err());
}

#[test]
fn tiff_parses_lerc_secondary_compression_tag() {
    // Minimal little-endian IFD with two LONG LercParameters stored out of line.
    let tags = [
        (256u16, 4u16, 1u32, 1u32),
        (257, 4, 1, 1),
        (259, 3, 1, 34887),
        (322, 4, 1, 1),
        (323, 4, 1, 1),
        (324, 4, 1, 256),
        (325, 4, 1, 100),
        (50674, 4, 2, 110),
    ];
    let mut file = b"II\x2a\x00\x08\x00\x00\x00".to_vec();
    file.extend_from_slice(&(tags.len() as u16).to_le_bytes());
    for (tag, kind, count, value) in tags {
        file.extend_from_slice(&tag.to_le_bytes());
        file.extend_from_slice(&kind.to_le_bytes());
        file.extend_from_slice(&count.to_le_bytes());
        file.extend_from_slice(&value.to_le_bytes());
    }
    file.extend_from_slice(&0u32.to_le_bytes());
    file.extend_from_slice(&4u32.to_le_bytes());
    file.extend_from_slice(&2u32.to_le_bytes());
    let parsed = codec::parse(file.as_slice()).unwrap();
    assert_eq!(parsed.levels[0].compression, 34887);
    assert_eq!(parsed.levels[0].lerc_compression, 2);
    assert!(matches!(codec::parse(&file[..114]), Err(codec::TiffError::NoReadableIfd)));
}

#[test]
fn numeric_types_and_masked_zero_are_converted_without_unit_scaling() {
    let signed = ::lerc::encode_slice(2, 2, &[-7i16, 0, 123, 32767], ::lerc::Precision::Lossless).unwrap();
    assert_eq!(codec::lerc::decode(&signed, 4).unwrap().values, [-7., 0., 123., 32767.]);
    let double = ::lerc::encode_slice(2, 2, &[-7.25f64, 0., 123.125, 32767.], ::lerc::Precision::Lossless).unwrap();
    assert_eq!(codec::lerc::decode(&double, 4).unwrap().values, [-7.25, 0., 123.125, 32767.]);
    let mask = ::lerc::bitmask::BitMask::from_bytes(vec![0b10100000], 4);
    let masked = ::lerc::encode_slice_masked(2, 2, &[7f32, 0., 9., 0.], &mask, ::lerc::Precision::Lossless).unwrap();
    let decoded = codec::lerc::decode(&masked, 4).unwrap();
    assert_eq!(decoded.values[0], 7.);
    assert_eq!(decoded.values[2], 9.);
    assert!(decoded.values[1].is_nan() && decoded.values[3].is_nan());
}
