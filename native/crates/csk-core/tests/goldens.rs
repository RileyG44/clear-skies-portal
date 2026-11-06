//! L1 gate: every frozen golden in `native/fixtures/goldens.json` decodes
//! bit-exactly, including the cases today's cog.js gets wrong.

use std::path::PathBuf;

use csk_core::codec::{self, Windows};
use csk_core::geo;
use serde_json::Value;
use sha2::{Digest, Sha256};

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn manifest() -> Value {
    let text = std::fs::read_to_string(fixtures().join("goldens.json")).expect("goldens.json");
    serde_json::from_str(&text).expect("valid JSON")
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn f32_bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn u64s(v: &Value) -> Vec<u64> {
    v.as_array().unwrap().iter().map(|x| x.as_u64().unwrap()).collect()
}

fn f64s(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect()
}

#[test]
fn tiff_cases_decode_bit_exact() {
    let m = manifest();
    let cases = m["cases"].as_array().unwrap();
    assert!(cases.len() >= 9);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let file = std::fs::read(fixtures().join(case["file"].as_str().unwrap())).unwrap();
        assert_eq!(hex(&file), case["sha256"].as_str().unwrap(), "{name}: fixture bytes changed");
        let tiff = codec::parse(file.as_slice()).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(tiff.complete, "{name}: whole file held, so complete");
        assert_eq!(tiff.little_endian, case["le"].as_bool().unwrap(), "{name}");
        assert_eq!(tiff.big, case["big"].as_bool().unwrap(), "{name}");
        let levels = case["levels"].as_array().unwrap();
        assert_eq!(tiff.levels.len(), levels.len(), "{name}: level count");
        for (i, (lv, want)) in tiff.levels.iter().zip(levels).enumerate() {
            let ctx = format!("{name} level {i}");
            assert_eq!(u64::from(lv.width), want["w"].as_u64().unwrap(), "{ctx}");
            assert_eq!(u64::from(lv.height), want["h"].as_u64().unwrap(), "{ctx}");
            assert_eq!(u64::from(lv.block_width), want["tw"].as_u64().unwrap(), "{ctx}");
            assert_eq!(u64::from(lv.block_height), want["th"].as_u64().unwrap(), "{ctx}");
            assert_eq!(lv.stripped, want["stripped"].as_bool().unwrap(), "{ctx}");
            assert_eq!(u64::from(lv.compression), want["comp"].as_u64().unwrap(), "{ctx}");
            assert_eq!(u64::from(lv.predictor), want["pred"].as_u64().unwrap(), "{ctx}");
            assert_eq!(u64::from(lv.bits_per_sample), want["bps"].as_u64().unwrap(), "{ctx}");
            assert_eq!(u64::from(lv.sample_format), want["sf"].as_u64().unwrap(), "{ctx}");
            assert_eq!(lv.offsets, u64s(&want["offsets"]), "{ctx}");
            assert_eq!(lv.counts, u64s(&want["counts"]), "{ctx}");
            let blocks = want["blocks"].as_array().unwrap();
            assert_eq!(blocks.len(), lv.offsets.len(), "{ctx}");
            for (j, hash) in blocks.iter().enumerate() {
                let (o, n) = (lv.offsets[j] as usize, lv.counts[j] as usize);
                let px = codec::decode_block(&file[o..o + n], lv, tiff.little_endian)
                    .unwrap_or_else(|e| panic!("{ctx} block {j}: {e}"));
                assert_eq!(px.len(), (lv.block_width * lv.block_height) as usize, "{ctx} block {j}");
                assert_eq!(hex(&f32_bytes(&px)), hash.as_str().unwrap(), "{ctx} block {j} is not bit-exact");
                if j == 0 {
                    let sample: Vec<f32> = f64s(&want["sample"]).iter().map(|&v| v as f32).collect();
                    assert_eq!(&px[..4], sample.as_slice(), "{ctx}");
                }
            }
        }
        match case["geo"].as_object() {
            Some(g) => {
                assert_eq!(tiff.geo.pixel_scale, f64s(&g["scale"]), "{name}");
                assert_eq!(tiff.geo.tiepoint, f64s(&g["tie"]), "{name}");
                assert_eq!(tiff.geo.epsg.map(u64::from), g["epsg"].as_u64(), "{name}");
                assert_eq!(tiff.geo.citation, g["desc"].as_str().unwrap(), "{name}");
                assert_eq!(tiff.geo.nodata, g["nodata"].as_f64(), "{name}");
            }
            None => assert_eq!(tiff.geo, codec::Geo::default(), "{name}"),
        }
    }
}

/// The engine reads a 64-byte head and, for a directory at the end, a tail
/// from the first IFD (usgs.js:readCogHeader). Same answer from two windows.
#[test]
fn head_and_tail_windows() {
    let m = manifest();
    let case = m["cases"].as_array().unwrap().iter().find(|c| c["name"] == "late-ifd-lzw").unwrap();
    let file = std::fs::read(fixtures().join(case["file"].as_str().unwrap())).unwrap();
    let whole = codec::parse(file.as_slice()).unwrap();
    let ifd = case["ifd0"].as_u64().unwrap();
    assert!(ifd > 64, "the fixture's directory really is at the end");

    let windows = Windows::new().with(0, &file[..64]).with(ifd, &file[ifd as usize..]);
    assert_eq!(codec::parse(&windows).unwrap(), whole);

    // Only the head: no directory is held, which is an error, not zeros.
    assert_eq!(codec::parse(&file[..64]), Err(codec::TiffError::NoReadableIfd));
}

/// A head that holds the first directory but not its tile tables. cog.js
/// reads zeros there and reports complete with a tile table pointing at the
/// header; the port must say it needs more bytes instead.
#[test]
fn directory_without_its_tables_is_incomplete() {
    let m = manifest();
    let case = m["cases"].as_array().unwrap().iter().find(|c| c["name"] == "usgs-tiled-lzw-fp").unwrap();
    let file = std::fs::read(fixtures().join(case["file"].as_str().unwrap())).unwrap();
    let ifd = case["ifd0"].as_u64().unwrap() as usize;
    let entries = u16::from_le_bytes([file[ifd], file[ifd + 1]]) as usize;
    let end_of_dir = ifd + 2 + entries * 12 + 4;
    match codec::parse(&file[..end_of_dir]) {
        Err(codec::TiffError::NoReadableIfd) => {}
        Ok(t) => assert!(!t.complete && t.levels.iter().all(|l| l.offsets.iter().all(|&o| o > 0))),
        Err(e) => panic!("{e}"),
    }
    // With the whole first directory and its tables, but not the overviews:
    // level 0 is returned and the result is marked incomplete.
    let first_data = u64s(&case["levels"][0]["offsets"])[0] as usize;
    let lv1 = case["levels"][1]["offsets"][0].as_u64().unwrap() as usize;
    let cut = first_data.min(lv1);
    let t = codec::parse(&file[..cut]).unwrap();
    assert!(!t.levels.is_empty());
    assert_eq!(t.levels[0].offsets, u64s(&case["levels"][0]["offsets"]));
}

#[test]
fn geodesy_matches_the_engine() {
    let m = manifest();
    for p in m["utm"].as_array().unwrap() {
        let (lon, lat) = (p["lon"].as_f64().unwrap(), p["lat"].as_f64().unwrap());
        let zone = geo::utm_zone(lon);
        assert_eq!(i64::from(zone), p["zone"].as_i64().unwrap());
        let (e, n) = geo::lon_lat_to_utm(lon, lat, zone);
        assert!((e - p["e"].as_f64().unwrap()).abs() < 1e-6, "easting {lon},{lat}: {e}");
        assert!((n - p["n"].as_f64().unwrap()).abs() < 1e-6, "northing {lon},{lat}: {n}");
        let (blon, blat) = geo::utm_to_lon_lat(e, n, zone);
        assert!((blon - p["backLon"].as_f64().unwrap()).abs() < 1e-11);
        assert!((blat - p["backLat"].as_f64().unwrap()).abs() < 1e-11);
    }
    for p in m["merc"].as_array().unwrap() {
        let (x, y) = geo::lon_lat_to_merc(p["lon"].as_f64().unwrap(), p["lat"].as_f64().unwrap());
        assert!((x - p["x"].as_f64().unwrap()).abs() < 1e-6 && (y - p["y"].as_f64().unwrap()).abs() < 1e-6);
        let (lon, lat) = geo::merc_to_lon_lat(x, y);
        assert!(
            (lon - p["backLon"].as_f64().unwrap()).abs() < 1e-11
                && (lat - p["backLat"].as_f64().unwrap()).abs() < 1e-11
        );
    }
    for t in m["tiles"].as_array().unwrap() {
        let b = geo::tile_bounds_merc(
            t["z"].as_u64().unwrap() as u8,
            t["x"].as_u64().unwrap() as u32,
            t["y"].as_u64().unwrap() as u32,
        );
        for (got, key) in [(b.min_x, "minx"), (b.max_x, "maxx"), (b.min_y, "miny"), (b.max_y, "maxy"), (b.span, "span")]
        {
            assert_eq!(got, t[key].as_f64().unwrap(), "tile {t} {key}");
        }
    }
}
