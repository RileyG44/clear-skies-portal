//! Derived fields of the terrain store (wgsl/derive.wgsl): the Detail blur
//! and the relative-elevation floors. They live in the world-anchored
//! store's texel space, so panning, zooming within a level and rotating
//! reuse them; they are rebuilt only when the store's terrain or the
//! requested radii change.

use std::sync::Arc;

use csk_core::resource::Reservation;
use wgpu::util::DeviceExt;

use crate::render::texture_bytes;
use crate::{Error, Renderer};

/// Ground length of the Web Mercator world at the equator, metres.
pub const WORLD_METRES: f64 = 2.0 * std::f64::consts::PI * 6_378_137.0;

/// Radii of the derived fields in metres; zero where a field is not needed.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Derive {
    /// The Detail unsharp mask's blur (stack detail radius), when detail != 0.
    pub blur: f64,
    /// The valley floor of relative-elevation layers.
    pub base: f64,
    /// The land-only floor of separated relative-elevation layers.
    pub land_base: f64,
}

/// One field's downsample factor, filter radius and size, all in texels: a
/// factor that keeps the filter radius at most 32 texels, capped at 64.
/// Radii below one texel produce nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Plan {
    pub factor: u32,
    pub radius: u32,
    pub width: u32,
    pub height: u32,
}

impl Plan {
    pub fn new(radius: f64, width: u32, height: u32) -> Option<Self> {
        if radius.is_nan() || radius < 1.0 {
            return None;
        }
        let factor = (radius / 32.0).ceil().clamp(1.0, 64.0) as u32;
        Some(Self {
            factor,
            radius: (radius / f64::from(factor)).round().clamp(1.0, 32.0) as u32,
            width: width.div_ceil(factor),
            height: height.div_ceil(factor),
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Blur,
    Floor { land: bool },
}

/// One built field: its output in `a`, a ping-pong partner, and the row
/// reduction scratch.
pub(crate) struct Aux {
    plan: Plan,
    a_view: wgpu::TextureView,
    b_view: wgpu::TextureView,
    scratch: wgpu::Buffer,
    charge: Arc<Reservation>,
}

impl Aux {
    pub fn view(&self) -> (&wgpu::TextureView, u32) {
        (&self.a_view, self.plan.factor)
    }
}

/// The store's derived fields and what they were built from.
#[derive(Default)]
pub(crate) struct Fields {
    pub blur: Option<Aux>,
    pub base: Option<Aux>,
    pub land_base: Option<Aux>,
    built: Option<(u64, [Option<Plan>; 3])>,
}

/// Where the store lies: its size in texels, the Mercator of its corner and
/// of one texel, and the ground size of one texel at its centre.
pub(crate) struct Placement {
    pub size: (u32, u32),
    pub merc_origin: [f64; 2],
    pub merc_step: f64,
}

impl Placement {
    pub fn metres_per_texel(&self) -> f64 {
        let y = self.merc_origin[1] + f64::from(self.size.1) * 0.5 * self.merc_step;
        let latitude = (std::f64::consts::PI * (1.0 - 2.0 * y)).sinh().atan();
        WORLD_METRES * latitude.cos() * self.merc_step
    }
}

impl Fields {
    pub fn charges(&self) -> Vec<Arc<Reservation>> {
        [&self.blur, &self.base, &self.land_base].into_iter().flatten().map(|a| a.charge.clone()).collect()
    }

    /// Rebuilds the fields when the store (`generation`) or the radii
    /// changed. Records the passes into `encoder`.
    pub fn update(
        &mut self,
        gpu: &Renderer,
        encoder: &mut wgpu::CommandEncoder,
        store: &wgpu::TextureView,
        generation: u64,
        place: &Placement,
        radii: Derive,
    ) -> Result<(), Error> {
        let mpt = place.metres_per_texel();
        let (w, h) = place.size;
        let plan = |metres: f64| if metres > 0.0 && mpt > 0.0 { Plan::new(metres / mpt, w, h) } else { None };
        let plans = [plan(radii.blur), plan(radii.base), plan(radii.land_base)];
        if self.built == Some((generation, plans)) {
            return Ok(());
        }
        let kinds = [Kind::Blur, Kind::Floor { land: false }, Kind::Floor { land: true }];
        for ((slot, plan), kind) in
            [&mut self.blur, &mut self.base, &mut self.land_base].into_iter().zip(plans).zip(kinds)
        {
            let Some(plan) = plan else {
                if let Some(old) = slot.take() {
                    gpu.retain_until_done(old.charge);
                }
                continue;
            };
            if slot.as_ref().is_none_or(|a| a.plan != plan) {
                if let Some(old) = slot.take() {
                    gpu.retain_until_done(old.charge);
                }
                *slot = Some(allocate(gpu, plan, h)?);
            }
            let aux = slot.as_ref().expect("allocated");
            encode(gpu, encoder, store, aux, kind, place, h);
            gpu.retain_until_done(aux.charge.clone());
        }
        self.built = Some((generation, plans));
        Ok(())
    }
}

fn allocate(gpu: &Renderer, plan: Plan, src_height: u32) -> Result<Aux, Error> {
    let scratch_bytes = u64::from(plan.width) * u64::from(src_height) * 8;
    let charge =
        Arc::new(gpu.budget.reserve(2 * texture_bytes(plan.width, plan.height, 4) + scratch_bytes as usize + 4096)?);
    let make = || {
        gpu.texture(
            plan.width,
            plan.height,
            1,
            wgpu::TextureFormat::R32Float,
            wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
        )
    };
    let (a, b) = (make(), make());
    let scratch = gpu.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("derive rows"),
        size: scratch_bytes,
        usage: wgpu::BufferUsages::STORAGE,
        mapped_at_creation: false,
    });
    Ok(Aux {
        plan,
        a_view: a.create_view(&Default::default()),
        b_view: b.create_view(&Default::default()),
        scratch,
        charge,
    })
}

struct Pass<'a> {
    point: usize,
    dir: [i32; 2],
    src: &'a wgpu::TextureView,
    dst: &'a wgpu::TextureView,
    groups: (u32, u32),
}

/// Records one field's passes: rows and columns of the block reduction into
/// `a`, then (floors) an exact minimum and the Gaussian, each separable and
/// ping-ponging through `b` back to `a`.
fn encode(
    gpu: &Renderer,
    encoder: &mut wgpu::CommandEncoder,
    store: &wgpu::TextureView,
    aux: &Aux,
    kind: Kind,
    place: &Placement,
    src_height: u32,
) {
    let Plan { factor, radius, width, height } = aux.plan;
    let (minimum, land) = match kind {
        Kind::Blur => (0u32, 0u32),
        Kind::Floor { land } => (1, u32::from(land)),
    };
    let field = (width.div_ceil(16), height.div_ceil(16));
    let (a, b) = (&aux.a_view, &aux.b_view);
    let mut passes = vec![
        Pass { point: 0, dir: [1, 0], src: store, dst: a, groups: (width.div_ceil(16), src_height.div_ceil(16)) },
        Pass { point: 1, dir: [0, 1], src: store, dst: a, groups: field },
    ];
    if minimum != 0 {
        passes.push(Pass { point: 2, dir: [1, 0], src: a, dst: b, groups: field });
        passes.push(Pass { point: 2, dir: [0, 1], src: b, dst: a, groups: field });
    }
    passes.push(Pass { point: 3, dir: [1, 0], src: a, dst: b, groups: field });
    passes.push(Pass { point: 3, dir: [0, 1], src: b, dst: a, groups: field });
    let water = gpu.water_view();
    let sigma = (f64::from(radius) / 2.0).max(0.5) as f32;
    for pass in passes {
        let mut params = Vec::with_capacity(48);
        for v in pass.dir {
            params.extend_from_slice(&v.to_le_bytes());
        }
        for v in [factor, radius, minimum, land, src_height, width] {
            params.extend_from_slice(&v.to_le_bytes());
        }
        for v in [place.merc_origin[0] as f32, place.merc_origin[1] as f32, place.merc_step as f32, sigma] {
            params.extend_from_slice(&v.to_le_bytes());
        }
        let params = gpu.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("derive"),
            contents: &params,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &gpu.derive.1,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: params.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(pass.src) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(pass.dst) },
                wgpu::BindGroupEntry { binding: 3, resource: aux.scratch.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(&water) },
            ],
        });
        let mut compute = encoder.begin_compute_pass(&Default::default());
        compute.set_pipeline(&gpu.derive.0[pass.point]);
        compute.set_bind_group(0, &group, &[]);
        compute.dispatch_workgroups(pass.groups.0, pass.groups.1, 1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_match_the_web_aux_plan() {
        assert_eq!(Plan::new(0.5, 100, 100), None);
        assert_eq!(Plan::new(6.0, 1000, 600), Some(Plan { factor: 1, radius: 6, width: 1000, height: 600 }));
        assert_eq!(Plan::new(625.0, 1000, 600), Some(Plan { factor: 20, radius: 31, width: 50, height: 30 }));
        assert_eq!(Plan::new(1e6, 1000, 600).unwrap().factor, 64);
    }
}
