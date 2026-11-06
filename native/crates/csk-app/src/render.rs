//! Terrain appearance to shading uniforms: the values the generated shading
//! program reads for a style, its opacity, colour adjustments, lighting,
//! elevation bands and layer stack. The camera uniforms are set per frame by
//! the scene (`csk_gpu::Terrain::render`).

use serde::{Deserialize, Serialize};

use crate::terrain::{Stack, catalog};

const STOP_VECS: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Look {
    /// Percent.
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
}

impl Default for Look {
    fn default() -> Self {
        Self { brightness: 100.0, contrast: 100.0, saturation: 100.0 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Lighting {
    /// Degrees clockwise from north.
    pub azimuth: f64,
    pub altitude: f64,
    /// Shadow fill, 0..0.6.
    pub ambient: f64,
}

impl Default for Lighting {
    fn default() -> Self {
        Self { azimuth: 315.0, altitude: 45.0, ambient: 0.12 }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct Band {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub level: f64,
    pub color: Option<[f64; 3]>,
}

/// Elevation colours: a spectrum around a level and bands below and above.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Spectrum {
    /// 0..255 RGB.
    pub spectrum_low: Option<[f64; 3]>,
    pub spectrum_mid: Option<[f64; 3]>,
    pub spectrum_high: Option<[f64; 3]>,
    pub spectrum_on: bool,
    pub level: f64,
    pub span: f64,
    pub spectrum_alpha: f64,
    pub below: Band,
    pub above: Band,
    pub band_alpha: f64,
    pub band_feather: f64,
    pub outline: bool,
    pub outline_width: f64,
}

impl Default for Spectrum {
    fn default() -> Self {
        Self {
            spectrum_low: None,
            spectrum_mid: None,
            spectrum_high: None,
            spectrum_on: false,
            level: 0.0,
            span: 1.0,
            spectrum_alpha: 0.0,
            below: Band::default(),
            above: Band::default(),
            band_alpha: 0.52,
            band_feather: 0.0,
            outline: false,
            outline_width: 8.0 * 0.3048,
        }
    }
}

/// Everything the shading program draws, apart from the camera.
#[derive(Clone, Debug, PartialEq)]
pub struct Appearance {
    /// A style id, or "off".
    pub style: String,
    /// 0..1.
    pub opacity: f64,
    pub look: Look,
    pub lighting: Lighting,
    pub spectrum: Spectrum,
    pub spectrum_opacity: f64,
    pub stack: Option<Stack>,
}

fn clamp(v: f64, low: f64, high: f64) -> f64 {
    v.max(low).min(high)
}

fn colour(rgb: Option<[f64; 3]>, scale: f64, fallback: [f64; 3]) -> Vec<f32> {
    rgb.filter(|c| c.iter().all(|v| v.is_finite()))
        .map_or(fallback, |c| c.map(|v| v / scale))
        .map(|v| clamp(v, 0.0, 1.0) as f32)
        .to_vec()
}

impl Appearance {
    /// Uniform names and values, one per appearance uniform.
    pub fn uniforms(&self) -> Vec<(&'static str, Vec<f32>)> {
        let c = catalog();
        let style = if self.style == "off" { -1 } else { c.style_ids.get(&self.style).copied().unwrap_or(0) };
        let s = &self.spectrum;
        let one = |v: f64| vec![v as f32];
        let mut out = vec![
            ("u_style", one(f64::from(style))),
            ("u_terrainOpacity", one(clamp(self.opacity, 0.0, 1.0))),
            ("u_sunAzimuth", one(clamp(self.lighting.azimuth, 0.0, 359.0))),
            ("u_sunAltitude", one(clamp(self.lighting.altitude, 5.0, 90.0))),
            ("u_ambient", one(clamp(self.lighting.ambient, 0.0, 0.6))),
            ("u_lookSaturation", one(clamp(self.look.saturation, 0.0, 1000.0) / 100.0)),
            ("u_lookContrast", one(clamp(self.look.contrast, 0.0, 1000.0) / 100.0)),
            ("u_lookBrightness", one(clamp(self.look.brightness, 0.0, 1000.0) / 100.0)),
            ("u_spectrumLow", colour(s.spectrum_low, 255.0, [248.0 / 255.0, 92.0 / 255.0, 108.0 / 255.0])),
            ("u_spectrumMid", colour(s.spectrum_mid, 255.0, [1.0, 1.0, 250.0 / 255.0])),
            ("u_spectrumHigh", colour(s.spectrum_high, 255.0, [70.0 / 255.0, 160.0 / 255.0, 1.0])),
            ("u_spectrumOn", one(f64::from(s.spectrum_on))),
            ("u_spectrumLevel", one(s.level)),
            ("u_spectrumSpan", one(s.span)),
            ("u_spectrumAlpha", one(clamp(s.spectrum_alpha, 0.0, 1.0))),
            ("u_belowOn", one(f64::from(s.below.enabled))),
            ("u_belowLevel", one(s.below.level)),
            ("u_belowColor", colour(s.below.color, 1.0, [1.0, 0.0, 0.0])),
            ("u_aboveOn", one(f64::from(s.above.enabled))),
            ("u_aboveLevel", one(s.above.level)),
            ("u_aboveColor", colour(s.above.color, 1.0, [0.0, 0.0, 1.0])),
            ("u_bandAlpha", one(clamp(s.band_alpha, 0.0, 1.0))),
            ("u_bandFeather", one(s.band_feather.max(0.0))),
            ("u_outlineOn", one(f64::from(s.outline))),
            ("u_outlineWidth", one(s.outline_width.max(0.0))),
            ("u_spectrumOpacity", one(clamp(self.spectrum_opacity, 0.0, 1.0))),
            ("u_groundResOverride", one(0.0)),
        ];
        out.extend(stack_uniforms(self.stack.as_ref()));
        out
    }

    /// Writes the appearance into a uniform block.
    pub fn apply(&self, uniforms: &mut csk_gpu::Uniforms) -> Result<(), csk_gpu::Error> {
        for (name, values) in self.uniforms() {
            uniforms.set(name, &values)?;
        }
        Ok(())
    }
}

fn stack_uniforms(stack: Option<&Stack>) -> Vec<(&'static str, Vec<f32>)> {
    let c = catalog();
    let (max_layers, max_stops) = (c.max_layers, c.max_stops);
    let mut a = vec![0.0; max_layers * 4];
    let mut b = a.clone();
    let mut cc = a.clone();
    let mut d = a.clone();
    let mut pos = vec![1.0; max_layers * STOP_VECS * 4];
    let mut colors = vec![0.0; max_layers * max_stops * 4];
    let (mut count, mut gradient) = (0usize, 0.0);
    for layer in stack.map_or(&[][..], |s| &s.layers) {
        if count >= max_layers {
            break;
        }
        let Some(&id) = c.style_ids.get(&layer.style) else { continue };
        if id < 0 {
            continue;
        }
        let mut stops: Vec<[f64; 5]> = layer
            .stops
            .iter()
            .filter(|s| s.iter().all(|v| v.is_finite()))
            .take(max_stops)
            .map(|s| s.map(|v| clamp(v, 0.0, 1.0)))
            .collect();
        stops.sort_by(|x, y| x[0].total_cmp(&y[0]));
        if stops.is_empty() {
            stops = vec![[0.0, 0.0, 0.0, 0.0, 1.0], [1.0, 1.0, 1.0, 1.0, 1.0]];
        }
        let (min, mut max) = (layer.min, layer.max);
        if max == min {
            max = min + 1e-6;
        }
        let blend = c.blend_ids.get(&layer.blend).copied().unwrap_or(0);
        let flags = f64::from(u8::from(layer.water.is_some()))
            + 2.0 * f64::from(u8::from(layer.separate_rem))
            + 4.0 * f64::from(u8::from(layer.inland.is_some()));
        // Absent ranges are off in `flags`; their slots hold zero.
        let water = layer.water.unwrap_or([0.0; 2]);
        let inland = layer.inland.unwrap_or([0.0; 2]);
        a[count * 4..count * 4 + 4].copy_from_slice(&[
            f64::from(id),
            clamp(layer.opacity, 0.0, 1.0),
            f64::from(blend),
            stops.len() as f64,
        ]);
        b[count * 4..count * 4 + 4].copy_from_slice(&[min, max, clamp(layer.gamma, 0.1, 10.0), f64::from(layer.steps)]);
        cc[count * 4..count * 4 + 4].copy_from_slice(&[layer.param, flags, water[0], water[1]]);
        d[count * 4..count * 4 + 4].copy_from_slice(&[inland[0], inland[1], 0.0, 0.0]);
        // Unshaded elevation/relative-elevation ramps use only height/base.
        if (id != 5 && id != 10) || layer.param > 0.0 {
            gradient = 1.0;
        }
        for (k, stop) in stops.iter().enumerate() {
            pos[count * STOP_VECS * 4 + k] = stop[0];
            let at = (count * max_stops + k) * 4;
            colors[at..at + 4].copy_from_slice(&stop[1..5]);
        }
        count += 1;
    }
    let on = stack.is_some();
    let f = |v: Vec<f64>| v.into_iter().map(|x| x as f32).collect::<Vec<f32>>();
    let one = |v: f64| vec![v as f32];
    vec![
        ("u_stackOn", one(f64::from(u8::from(on)))),
        ("u_stackGradient", one(gradient)),
        ("u_layerCount", one(count as f64)),
        ("u_layerA", f(a)),
        ("u_layerB", f(b)),
        ("u_layerC", f(cc)),
        ("u_layerD", f(d)),
        ("u_layerPos", f(pos)),
        ("u_layerColors", f(colors)),
        ("u_detail", one(stack.map_or(0.0, |s| clamp(s.detail, -1.0, 4.0)))),
        ("u_reliefExag", one(stack.map_or(1.0, |s| clamp(s.relief_exag, 0.1, 20.0)))),
        ("u_remFlatBase", one(stack.map_or(0.0, |s| s.rem_flat_base))),
        ("u_remLandBase", one(stack.map_or(0.0, |s| s.rem_land_base))),
    ]
}
