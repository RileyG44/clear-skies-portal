//! Presentation: the terrain scene drawn into a platform surface (a
//! `CAMetalLayer` on iOS). The surface is sized from the view each frame, so
//! the camera is the single source of truth for drawable size.

use std::sync::Arc;

use csk_core::resource::Reservation;

use crate::render::texture_bytes;
use crate::{Error, FrameStats, Renderer, Terrain, Uniforms, View};

/// Frames the GPU may queue ahead of the display.
const FRAME_LATENCY: u32 = 2;

/// What one frame did.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Presented {
    Shown(FrameStats),
    /// No drawable this vsync (occluded, timed out, or reconfigured); try the
    /// next one.
    Skipped,
}

pub struct Presenter {
    surface: wgpu::Surface<'static>,
    format: wgpu::TextureFormat,
    alpha: wgpu::CompositeAlphaMode,
    size: Option<(u32, u32)>,
    /// The drawables' memory, charged to the shared budget.
    charge: Option<Arc<Reservation>>,
    identity: Arc<()>,
}

/// A wgpu instance for presentation on this platform's native backend.
/// Surfaces come from it (raw layer handles are created at the FFI
/// boundary, the one place unsafe code is allowed).
pub fn instance() -> wgpu::Instance {
    let backends = if cfg!(target_vendor = "apple") { wgpu::Backends::METAL } else { wgpu::Backends::PRIMARY };
    wgpu::Instance::new(wgpu::InstanceDescriptor { backends, ..wgpu::InstanceDescriptor::new_without_display_handle() })
}

impl Renderer {
    /// A renderer on a GPU that can drive `surface`, made from `instance`,
    /// and a presenter for it.
    pub async fn for_surface(
        instance: &wgpu::Instance,
        surface: wgpu::Surface<'static>,
        budget: Arc<csk_core::resource::Budget>,
    ) -> Result<(Self, Presenter), Error> {
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                power_preference: wgpu::PowerPreference::HighPerformance,
                ..Default::default()
            })
            .await
            .map_err(|e| Error::Adapter(e.to_string()))?;
        let mut presenter = Presenter::new(surface, &adapter)?;
        let gpu = Self::with_adapter(adapter, budget).await?;
        presenter.identity = gpu.identity.clone();
        Ok((gpu, presenter))
    }
}

impl Presenter {
    fn new(surface: wgpu::Surface<'static>, adapter: &wgpu::Adapter) -> Result<Self, Error> {
        let caps = surface.get_capabilities(adapter);
        // The shading program writes display-encoded sRGB values, as the web
        // canvas does: the drawable must not encode them again.
        let format = [wgpu::TextureFormat::Bgra8Unorm, wgpu::TextureFormat::Rgba8Unorm]
            .into_iter()
            .find(|f| caps.formats.contains(f))
            .ok_or_else(|| Error::Adapter("no 8-bit unorm surface format".into()))?;
        // Invalid terrain is transparent over the layers beneath the map.
        let alpha = [wgpu::CompositeAlphaMode::PreMultiplied, wgpu::CompositeAlphaMode::Opaque]
            .into_iter()
            .find(|a| caps.alpha_modes.contains(a))
            .or_else(|| caps.alpha_modes.first().copied())
            .ok_or_else(|| Error::Adapter("surface has no alpha modes".into()))?;
        Ok(Self { surface, format, alpha, size: None, charge: None, identity: Arc::new(()) })
    }

    pub fn format(&self) -> wgpu::TextureFormat {
        self.format
    }

    fn configure(&mut self, gpu: &Renderer, (width, height): (u32, u32)) -> Result<(), Error> {
        if width > gpu.max_dimension() || height > gpu.max_dimension() {
            return Err(Error::Input("viewport exceeds device limits"));
        }
        // Release the old drawables' charge before admitting the new ones.
        if let Some(old) = self.charge.take() {
            gpu.retain_until_done(old);
        }
        let bytes = texture_bytes(width, height, 4) * (FRAME_LATENCY as usize + 1);
        self.charge = Some(Arc::new(gpu.budget.reserve(bytes)?));
        self.surface.configure(
            &gpu.device,
            &wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format: self.format,
                width,
                height,
                present_mode: wgpu::PresentMode::Fifo,
                desired_maximum_frame_latency: FRAME_LATENCY,
                alpha_mode: self.alpha,
                view_formats: Vec::new(),
                color_space: wgpu::SurfaceColorSpace::Srgb,
            },
        );
        self.size = Some((width, height));
        Ok(())
    }

    /// Draws the view and presents it at the next vsync.
    pub fn present(
        &mut self,
        gpu: &Renderer,
        terrain: &mut Terrain,
        view: &View,
        uniforms: &Uniforms,
        layers: &mut [crate::terrain::Layer<'_>],
    ) -> Result<Presented, Error> {
        if !Arc::ptr_eq(&self.identity, &gpu.identity) {
            return Err(Error::Input("presenter belongs to another GPU device"));
        }
        let size = view.device_size();
        if self.size != Some(size) {
            self.configure(gpu, size)?;
        }
        let (texture, suboptimal) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) => (t, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(t) => (t, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(Presented::Skipped);
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.size = None;
                return Ok(Presented::Skipped);
            }
            wgpu::CurrentSurfaceTexture::Lost => return Err(Error::Surface("presentation surface lost")),
            wgpu::CurrentSurfaceTexture::Validation => return Err(Error::Surface("surface validation failed")),
        };
        let target = texture.texture.create_view(&Default::default());
        let stats = terrain.render(gpu, view, uniforms, &target, self.format, layers)?;
        gpu.queue.present(texture);
        if suboptimal {
            self.size = None;
        }
        Ok(Presented::Shown(stats))
    }
}
