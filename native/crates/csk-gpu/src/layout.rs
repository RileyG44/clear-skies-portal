use crate::Error;

/// The shading program's uniform block, in the generated layout shared
/// verbatim by WGSL and MSL. Appearance changes only these bytes; they never
/// need new heights.
#[derive(Clone)]
pub struct Uniforms(Vec<u8>);

impl Default for Uniforms {
    fn default() -> Self {
        Self(include_bytes!("../../../shaders/generated/defaults.bin").to_vec())
    }
}

impl Uniforms {
    /// Sets one uniform. Matrices are column-major, as GLSL declares them.
    pub fn set(&mut self, name: &str, values: &[f32]) -> Result<(), Error> {
        let entry = &shade()["uniforms"][name];
        let kind = entry["type"].as_str().ok_or(Error::Input("unknown uniform"))?;
        let (components, slots) = match kind {
            "float" | "int" | "uint" | "bool" => (1, 1),
            "vec2" | "ivec2" => (2, 1),
            "vec3" => (3, 1),
            "vec4" => (4, 1),
            "mat3" => (3, 3),
            _ => return Err(Error::Input("unsupported uniform type")),
        };
        let count = entry["count"].as_u64().ok_or(Error::Input("uniform layout"))? as usize * slots;
        if values.len() != components * count || values.iter().any(|v| !v.is_finite()) {
            return Err(Error::Input("uniform shape or nonfinite value"));
        }
        let integer = matches!(kind, "int" | "ivec2" | "uint" | "bool");
        if integer && values.iter().any(|v| v.fract() != 0.0 || *v < i32::MIN as f32 || *v >= 2147483648.0) {
            return Err(Error::Input("integer uniform is out of range"));
        }
        let offset = entry["offset"].as_u64().ok_or(Error::Input("uniform layout"))? as usize;
        for (i, value) in values.iter().enumerate() {
            let at = offset + i / components * 16 + i % components * 4;
            let bytes = if integer { (*value as i32).to_le_bytes() } else { value.to_le_bytes() };
            self.0[at..at + 4].copy_from_slice(&bytes);
        }
        Ok(())
    }

    pub fn bytes(&self) -> &[u8] {
        &self.0
    }
}

pub(crate) fn shade() -> &'static serde_json::Value {
    static LAYOUT: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    &LAYOUT.get_or_init(|| {
        serde_json::from_str(include_str!("../../../shaders/generated/layouts.json")).expect("generated layout")
    })["shade"]
}
