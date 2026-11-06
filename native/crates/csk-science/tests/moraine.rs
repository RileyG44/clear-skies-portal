//! Frozen JS differential corpus: every output bit, finite/no-data policy,
//! beta/scientific notice, belt counts and all metadata must agree.
use std::path::Path;

use csk_science::contract::{self, Raw, Request};
use serde_json::Value;

fn equal_json(actual: &Value, expected: &Value, path: &str) {
    match (actual, expected) {
        // JSON/JavaScript has one number type; 5 and 5.0 are the same value.
        (Value::Number(a), Value::Number(b)) => assert_eq!(a.as_f64(), b.as_f64(), "{path}"),
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{path}: keys");
            for (k, v) in a {
                equal_json(v, b.get(k).unwrap_or_else(|| panic!("{path}.{k}: missing")), &format!("{path}.{k}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}: length");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                equal_json(a, b, &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}

#[test]
fn moraine_matches_reference_corpus() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/moraine");
    let cases: Value = serde_json::from_slice(&std::fs::read(root.join("cases.json")).unwrap()).unwrap();
    for case in cases.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let (w, h) = (case["width"].as_u64().unwrap() as usize, case["height"].as_u64().unwrap() as usize);
        let res = case["resolution"].as_f64().unwrap();
        let packed = std::fs::read(root.join(format!("{name}.bin.zlib"))).unwrap();
        let bytes = miniz_oxide::inflate::decompress_to_vec_zlib(&packed).unwrap();
        let (input, expected) = bytes.split_at(w * h * 4);
        let grid: Vec<f32> = input.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
        let request = Request::new(&Raw {
            product: "moraine",
            scale: "balanced",
            width: w as f64,
            height: h as f64,
            resolution: res,
            day: None,
            lat: None,
            wind: None,
        })
        .unwrap();
        assert!(request.scratch_bytes() <= 256 << 20, "{name}: scratch must fit engine budget");
        let (product, label, notice) = contract::run(&request, &grid).unwrap();
        assert_eq!(label, "Moraine leads (Beta)");
        let descriptor_bytes = u32::from_le_bytes(expected[16..20].try_into().unwrap()) as usize;
        let descriptor: Value = serde_json::from_slice(&expected[24..24 + descriptor_bytes]).unwrap();
        equal_json(&product.metadata, &descriptor["metadata"], &format!("{name}.metadata"));
        equal_json(notice.as_ref().unwrap(), &descriptor["notice"], &format!("{name}.notice"));
        let data_offset = 24 + ((descriptor_bytes + 3) & !3);
        let reference = &expected[data_offset..];
        assert_eq!(product.data.len() * 4, reference.len(), "{name}: raster shape");
        for (i, (&actual, bytes)) in product.data.iter().zip(reference.chunks_exact(4)).enumerate() {
            let expected = f32::from_le_bytes(bytes.try_into().unwrap());
            assert_eq!(
                actual.to_bits(),
                expected.to_bits(),
                "{name}: pixel {i} ({}, {}), got {actual}, expected {expected}",
                i % w,
                i / w
            );
        }
        assert!(product.data.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)), "{name}: bounded finite score");
        for (i, v) in grid.iter().enumerate() {
            if !v.is_finite() {
                assert_eq!(product.data[i], 0.0, "{name}: no-data remains background");
            }
        }
        // The physical defaults do not follow the unrelated scale selector.
        if name == "arc" {
            for scale in ["fine", "broad"] {
                let mut other = request.clone();
                other.scale = scale.into();
                let result = contract::run(&other, &grid).unwrap();
                assert_eq!(result.0, product, "{name}: scale invariance");
            }
        }
        println!("{name}: all {} pixels and metadata match", w * h);
    }
}
