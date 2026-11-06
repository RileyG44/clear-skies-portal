use csk_core::resource::Budget;
use csk_gpu::{Renderer, Uniforms};

fn renderer(budget: std::sync::Arc<Budget>) -> Option<Renderer> {
    match pollster::block_on(Renderer::new(budget)) {
        Ok(renderer) => Some(renderer),
        Err(error @ csk_gpu::Error::Adapter(_)) if std::env::var_os("CSK_REQUIRE_GPU").is_none() => {
            eprintln!("GPU tests unavailable: {error}; set CSK_REQUIRE_GPU=1 to require the adapter");
            None
        }
        Err(error) => panic!("{error}"),
    }
}

#[test]
fn native_styles_match_frozen_javascript_and_release_resources() {
    let budget = Budget::new(32 << 20);
    let Some(renderer) = renderer(budget.clone()) else {
        return;
    };
    eprintln!("native GPU: {:?}", renderer.adapter);
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/gpu");
    let cases: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join("cases.json")).unwrap()).unwrap();
    let (w, h) = (cases["width"].as_u64().unwrap() as u32, cases["height"].as_u64().unwrap() as u32);
    let raw = std::fs::read(root.join("heights.f32")).unwrap();
    let heights: Vec<_> = raw.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    budget.set_limit(1);
    assert!(renderer.field(w, h, &heights).is_err());
    budget.set_limit(32 << 20);
    let idle = budget.stats().used;
    let field = renderer.field(w, h, &heights).unwrap();
    for case in cases["cases"].as_array().unwrap() {
        let mut uniforms = Uniforms::default();
        uniforms.set("u_style", &[case["id"].as_u64().unwrap() as f32]).unwrap();
        uniforms.set("u_cssSize", &[w as f32, h as f32]).unwrap();
        uniforms.set("u_groundResOverride", &[1.5]).unwrap();
        let frame = renderer.render(&field, &uniforms).unwrap();
        let rgba = renderer.readback(&frame).unwrap();
        let expected = std::fs::read(root.join(format!("{}.rgba", case["style"].as_str().unwrap()))).unwrap();
        let mut max = 0;
        for y in 1..h as usize - 1 {
            for x in 1..w as usize - 1 {
                for c in 0..4 {
                    let i = (y * w as usize + x) * 4 + c;
                    max = max.max(rgba[i].abs_diff(expected[i]));
                }
            }
        }
        assert!(max <= 1, "{} maximum channel error {max}", case["style"]);
    }
    // Nonfinite and sentinel heights stay transparent.
    let mut invalid = heights.clone();
    for (i, value) in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -3e38].into_iter().enumerate() {
        invalid[10 * w as usize + 10 + i] = value;
    }
    let bad_field = renderer.field(w, h, &invalid).unwrap();
    let frame = renderer.render(&bad_field, &Uniforms::default()).unwrap();
    let rgba = renderer.readback(&frame).unwrap();
    for x in 10..14 {
        assert_eq!(rgba[(10 * w as usize + x) * 4 + 3], 0);
    }
    assert!(budget.stats().used > idle);
    drop((rgba, frame, field, bad_field));
    renderer.poll().unwrap();
    assert_eq!(budget.stats().used, idle);
}

#[test]
fn uniform_layout_rejects_invalid_values() {
    let mut uniforms = Uniforms::default();
    assert!(uniforms.set("unknown", &[1.0]).is_err());
    assert!(uniforms.set("u_style", &[0.5]).is_err());
    assert!(uniforms.set("u_cssSize", &[1.0]).is_err());
    assert!(uniforms.set("u_zoom", &[f32::NAN]).is_err());
    assert!(uniforms.set("u_zoom", &[14.0]).is_ok());
}
