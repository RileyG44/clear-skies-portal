use crate::Error;

/// The generated binary layout is shared verbatim by WGSL and MSL. Native
/// controls change these bytes; changing a style never needs new heights.
#[derive(Clone)]
pub struct Uniforms(Vec<u8>);
impl Default for Uniforms {
    fn default() -> Self {
        Self(include_bytes!("../../../shaders/generated/defaults.bin").to_vec())
    }
}
impl Uniforms {
    pub fn set(&mut self, name: &str, values: &[f32]) -> Result<(), Error> {
        let layout = layout();
        let entry = &layout["uniforms"][name];
        let kind = entry["type"].as_str().ok_or(Error::Input("unknown uniform"))?;
        let components = match kind {
            "float" | "int" => 1,
            "vec2" => 2,
            "vec3" => 3,
            "vec4" => 4,
            _ => return Err(Error::Input("unsupported uniform type")),
        };
        let count = entry["count"].as_u64().unwrap() as usize;
        if values.len() != components * count || values.iter().any(|v| !v.is_finite()) {
            return Err(Error::Input("uniform shape or nonfinite value"));
        }
        if kind == "int" && values.iter().any(|v| v.fract() != 0.0 || *v < i32::MIN as f32 || *v >= 2147483648.0) {
            return Err(Error::Input("integer uniform is out of range"));
        }
        let offset = entry["offset"].as_u64().unwrap() as usize;
        for (i, value) in values.iter().enumerate() {
            let at = offset + i / components * 16 + i % components * 4;
            let bytes = if kind == "int" { (*value as i32).to_le_bytes() } else { value.to_le_bytes() };
            self.0[at..at + 4].copy_from_slice(&bytes);
        }
        Ok(())
    }
    pub fn bytes(&self) -> &[u8] {
        &self.0
    }
}

fn layout() -> &'static serde_json::Value {
    static LAYOUT: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    LAYOUT.get_or_init(|| serde_json::from_str(include_str!("../../../shaders/generated/uniforms.json")).unwrap())
}
