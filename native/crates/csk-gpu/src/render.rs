use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use csk_core::resource::{Budget, Reservation};
use wgpu::util::DeviceExt;

use crate::{Error, Uniforms, layout};

/// Texture format of offscreen frames (export, QA): premultiplied RGBA.
pub const FRAME_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// Row-aligned bytes of a texture, plus allocator slack. Driver and pipeline
/// overhead need a separate measured platform allowance.
pub(crate) fn texture_bytes(width: u32, height: u32, bpp: usize) -> usize {
    (width as usize * bpp).div_ceil(256) * 256 * height as usize + 4096
}

/// One GPU device for terrain: the shading program generated from the JS
/// factory and the native composite/resample programs. Every resource it
/// creates is charged to the shared engine memory budget and released only
/// after the GPU has finished with it.
pub struct Renderer {
    pub(crate) device: wgpu::Device,
    pub(crate) queue: wgpu::Queue,
    pub(crate) budget: Arc<Budget>,
    pub(crate) identity: Arc<()>,
    shade_layout: wgpu::BindGroupLayout,
    shade_pipelines: Mutex<HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>>,
    raster_module: wgpu::ShaderModule,
    raster_layout: wgpu::BindGroupLayout,
    raster_sampler: wgpu::Sampler,
    marker_module: wgpu::ShaderModule,
    marker_layout: wgpu::BindGroupLayout,
    /// Overlay programs (raster, marker) by name and target format.
    overlay_pipelines: Mutex<HashMap<(&'static str, wgpu::TextureFormat), wgpu::RenderPipeline>>,
    shade_vertex: wgpu::ShaderModule,
    shade_fragment: wgpu::ShaderModule,
    pub(crate) composite: (wgpu::ComputePipeline, wgpu::BindGroupLayout),
    pub(crate) resample: (wgpu::ComputePipeline, wgpu::BindGroupLayout),
    pub(crate) sample: (wgpu::ComputePipeline, wgpu::BindGroupLayout),
    /// Derived-field passes (wgsl/derive.wgsl): rows, cols, erode, gauss.
    pub(crate) derive: ([wgpu::ComputePipeline; 4], wgpu::BindGroupLayout),
    /// Absent derived fields bind a 1x1 invalid texture with scale zero.
    pub(crate) empty_aux: wgpu::TextureView,
    /// The water geography, once installed, with its charge.
    water: Mutex<(wgpu::TextureView, Option<Reservation>)>,
    _resident: Reservation,
    pub adapter: wgpu::AdapterInfo,
}

/// A screen field: float32 metres, top-down, invalid where no source answers.
pub struct Field {
    pub(crate) view: wgpu::TextureView,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) charge: Arc<Reservation>,
    pub(crate) identity: Arc<()>,
}

/// An offscreen frame owns its resident charge. Pending submissions also
/// retain the charge, so dropping a frame cannot admit overlapping GPU work
/// too early.
pub struct Frame {
    texture: wgpu::Texture,
    width: u32,
    height: u32,
    charge: Arc<Reservation>,
    identity: Arc<()>,
}

pub struct Pixels {
    bytes: Vec<u8>,
    _charge: Arc<Reservation>,
}
impl std::ops::Deref for Pixels {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        &self.bytes
    }
}

fn compute(
    device: &wgpu::Device,
    label: &str,
    source: &str,
    entries: &[wgpu::BindGroupLayoutEntry],
) -> (wgpu::ComputePipeline, wgpu::BindGroupLayout) {
    let ([pipeline], layout) = programs(device, label, source, entries, ["main"]);
    (pipeline, layout)
}

/// One pipeline per entry point of `source`, sharing one layout.
fn programs<const N: usize>(
    device: &wgpu::Device,
    label: &str,
    source: &str,
    entries: &[wgpu::BindGroupLayoutEntry],
    points: [&str; N],
) -> ([wgpu::ComputePipeline; N], wgpu::BindGroupLayout) {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(label),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some(label), entries });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(label),
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    let pipelines = points.map(|point| {
        device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(point),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some(point),
            compilation_options: Default::default(),
            cache: None,
        })
    });
    (pipelines, layout)
}

fn entry(binding: u32, visibility: wgpu::ShaderStages, ty: wgpu::BindingType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility, ty, count: None }
}

fn sampled(dimension: wgpu::TextureViewDimension, sample_type: wgpu::TextureSampleType) -> wgpu::BindingType {
    wgpu::BindingType::Texture { sample_type, view_dimension: dimension, multisampled: false }
}

const FLOAT: wgpu::TextureSampleType = wgpu::TextureSampleType::Float { filterable: false };
const UINT: wgpu::TextureSampleType = wgpu::TextureSampleType::Uint;

/// Derived fields bound to one shading pass: each view with its downsample
/// factor, and the field pixel centre -> store coordinate transform
/// (column-major mat3).
#[derive(Default)]
pub(crate) struct AuxViews<'a> {
    pub blur: Option<(&'a wgpu::TextureView, u32)>,
    pub base: Option<(&'a wgpu::TextureView, u32)>,
    pub land_base: Option<(&'a wgpu::TextureView, u32)>,
    pub transform: [f32; 9],
}

fn storage(format: wgpu::TextureFormat) -> wgpu::BindingType {
    wgpu::BindingType::StorageTexture {
        access: wgpu::StorageTextureAccess::WriteOnly,
        format,
        view_dimension: wgpu::TextureViewDimension::D2,
    }
}

fn buffer(ty: wgpu::BufferBindingType) -> wgpu::BindingType {
    wgpu::BindingType::Buffer { ty, has_dynamic_offset: false, min_binding_size: None }
}

impl Renderer {
    pub async fn new(budget: Arc<Budget>) -> Result<Self, Error> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .map_err(|e| Error::Adapter(e.to_string()))?;
        Self::with_adapter(adapter, budget).await
    }

    /// A renderer on a given adapter, e.g. one compatible with a presentation
    /// surface. Requests the adapter's own limits: Apple GPUs allow 16K
    /// textures and 2048 array layers, well above the portable defaults.
    pub async fn with_adapter(adapter: wgpu::Adapter, budget: Arc<Budget>) -> Result<Self, Error> {
        let info = adapter.get_info();
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor { required_limits: adapter.limits(), ..Default::default() })
            .await
            .map_err(|e| Error::Device(e.to_string()))?;
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let vf = wgpu::ShaderStages::VERTEX_FRAGMENT;
        let fragment = wgpu::ShaderStages::FRAGMENT;
        let mut entries = vec![entry(0, vf, buffer(wgpu::BufferBindingType::Uniform))];
        let textures = layout::shade()["textures"].as_object().ok_or(Error::Input("shade layout"))?;
        for spec in textures.values() {
            let binding = spec["binding"].as_u64().ok_or(Error::Input("shade layout"))? as u32;
            let kind = if spec["kind"] == "uint" { wgpu::TextureSampleType::Uint } else { FLOAT };
            entries.push(entry(binding, fragment, sampled(wgpu::TextureViewDimension::D2, kind)));
        }
        let shade_layout = device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some("shade"), entries: &entries });
        let shade_vertex = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ClearSkies fullscreen"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../../../shaders/generated/shade.vert.wgsl").into()),
        });
        let shade_fragment = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ClearSkies terrain"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../../../shaders/generated/shade.frag.wgsl").into()),
        });
        let c = wgpu::ShaderStages::COMPUTE;
        let composite = compute(
            &device,
            "composite",
            include_str!("wgsl/composite.wgsl"),
            &[
                entry(0, c, sampled(wgpu::TextureViewDimension::D2Array, FLOAT)),
                entry(1, c, storage(wgpu::TextureFormat::R32Float)),
                entry(2, c, buffer(wgpu::BufferBindingType::Storage { read_only: true })),
                entry(3, c, buffer(wgpu::BufferBindingType::Storage { read_only: true })),
            ],
        );
        let resample = compute(
            &device,
            "resample",
            include_str!("wgsl/resample.wgsl"),
            &[
                entry(0, c, buffer(wgpu::BufferBindingType::Uniform)),
                entry(1, c, sampled(wgpu::TextureViewDimension::D2, FLOAT)),
                entry(2, c, storage(wgpu::TextureFormat::R32Float)),
            ],
        );
        let sample = compute(
            &device,
            "sample",
            include_str!("wgsl/sample.wgsl"),
            &[
                entry(0, c, buffer(wgpu::BufferBindingType::Uniform)),
                entry(1, c, sampled(wgpu::TextureViewDimension::D2, FLOAT)),
                entry(2, c, buffer(wgpu::BufferBindingType::Storage { read_only: false })),
                entry(3, c, sampled(wgpu::TextureViewDimension::D2, FLOAT)),
                entry(4, c, sampled(wgpu::TextureViewDimension::D2, FLOAT)),
                entry(5, c, sampled(wgpu::TextureViewDimension::D2, UINT)),
            ],
        );
        let derive = programs(
            &device,
            "derive",
            include_str!("wgsl/derive.wgsl"),
            &[
                entry(0, c, buffer(wgpu::BufferBindingType::Uniform)),
                entry(1, c, sampled(wgpu::TextureViewDimension::D2, FLOAT)),
                entry(2, c, storage(wgpu::TextureFormat::R32Float)),
                entry(3, c, buffer(wgpu::BufferBindingType::Storage { read_only: false })),
                entry(4, c, sampled(wgpu::TextureViewDimension::D2, UINT)),
            ],
            ["rows", "cols", "erode", "gauss"],
        );
        let raster_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("raster"),
            source: wgpu::ShaderSource::Wgsl(include_str!("wgsl/raster.wgsl").into()),
        });
        let raster_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("raster"),
            entries: &[
                entry(0, vf, buffer(wgpu::BufferBindingType::Uniform)),
                entry(1, wgpu::ShaderStages::VERTEX, buffer(wgpu::BufferBindingType::Storage { read_only: true })),
                entry(
                    2,
                    fragment,
                    sampled(wgpu::TextureViewDimension::D2Array, wgpu::TextureSampleType::Float { filterable: true }),
                ),
                entry(3, fragment, wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering)),
            ],
        });
        let raster_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("raster"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let marker_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("marker"),
            source: wgpu::ShaderSource::Wgsl(include_str!("wgsl/marker.wgsl").into()),
        });
        let marker_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("marker"),
            entries: &[
                entry(0, vf, buffer(wgpu::BufferBindingType::Uniform)),
                entry(1, vf, buffer(wgpu::BufferBindingType::Storage { read_only: true })),
            ],
        });
        let tiny = |format, bytes: &[u8]| {
            device
                .create_texture_with_data(
                    &queue,
                    &wgpu::TextureDescriptor {
                        label: None,
                        size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format,
                        usage: wgpu::TextureUsages::TEXTURE_BINDING,
                        view_formats: &[],
                    },
                    Default::default(),
                    bytes,
                )
                .create_view(&Default::default())
        };
        let empty_aux = tiny(wgpu::TextureFormat::R32Float, &(-3.0e38f32).to_le_bytes());
        let water = Mutex::new((tiny(wgpu::TextureFormat::Rgba16Uint, &[0; 8]), None));
        if let Some(error) = scope.pop().await {
            return Err(Error::Device(error.to_string()));
        }
        let resident = budget.reserve(2 * 4096 + (64 << 10))?;
        Ok(Self {
            device,
            queue,
            budget,
            identity: Arc::new(()),
            shade_layout,
            shade_pipelines: Mutex::new(HashMap::new()),
            raster_module,
            raster_layout,
            raster_sampler,
            marker_module,
            marker_layout,
            overlay_pipelines: Mutex::new(HashMap::new()),
            shade_vertex,
            shade_fragment,
            composite,
            resample,
            sample,
            derive,
            empty_aux,
            water,
            _resident: resident,
            adapter: info,
        })
    }

    pub(crate) fn texture(
        &self,
        width: u32,
        height: u32,
        layers: u32,
        format: wgpu::TextureFormat,
        usage: wgpu::TextureUsages,
    ) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width, height, depth_or_array_layers: layers },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        })
    }

    pub(crate) fn max_dimension(&self) -> u32 {
        self.device.limits().max_texture_dimension_2d
    }

    /// Keeps `charge` alive until the GPU finishes the work submitted so far.
    pub(crate) fn retain_until_done<T: Send + 'static>(&self, charge: T) {
        self.queue.on_submitted_work_done(move || drop(charge));
    }

    /// Uploads a CPU height grid (row-major, top-down metres; non-finite or
    /// <= -1e20 is no data) as a screen field, for exports and QA.
    pub fn field(&self, width: u32, height: u32, heights: &[f32]) -> Result<Field, Error> {
        if width == 0 || height == 0 || width > self.max_dimension() || height > self.max_dimension() {
            return Err(Error::Input("field dimensions exceed device limits"));
        }
        if heights.len() != width as usize * height as usize {
            return Err(Error::Input("height grid shape"));
        }
        // Texture, upload staging and conversion scratch are admitted together.
        self.poll()?;
        let charge = Arc::new(self.budget.reserve(texture_bytes(width, height, 4) * 3 + (64 << 10))?);
        let texture = self.texture(
            width,
            height,
            1,
            wgpu::TextureFormat::R32Float,
            wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        );
        let bytes: Vec<u8> = heights.iter().flat_map(|v| v.to_le_bytes()).collect();
        self.queue.write_texture(
            texture.as_image_copy(),
            &bytes,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: Some(height) },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        // Flush queue-owned staging even if no draw follows this upload.
        self.queue.submit([]);
        self.retain_until_done(charge.clone());
        Ok(Field {
            view: texture.create_view(&Default::default()),
            width,
            height,
            charge,
            identity: self.identity.clone(),
        })
    }

    /// Installs the water geography (`water::packed`), charged to the budget.
    /// Until then every place is land.
    pub fn install_water(&self, packed: &[u16]) -> Result<(), Error> {
        let (width, height) = crate::water::TEXTURE;
        if packed.len() != (width * height * 4) as usize {
            return Err(Error::Input("water-mask shape"));
        }
        let charge = self.budget.reserve(texture_bytes(width, height, 8))?;
        let bytes: Vec<u8> = packed.iter().flat_map(|v| v.to_le_bytes()).collect();
        let texture = self.device.create_texture_with_data(
            &self.queue,
            &wgpu::TextureDescriptor {
                label: Some("water mask"),
                size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba16Uint,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            Default::default(),
            &bytes,
        );
        *self.water.lock().unwrap() = (texture.create_view(&Default::default()), Some(charge));
        Ok(())
    }

    pub(crate) fn water_view(&self) -> wgpu::TextureView {
        self.water.lock().unwrap().0.clone()
    }

    fn shade_pipeline(&self, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        let mut cache = self.shade_pipelines.lock().unwrap();
        cache
            .entry(format)
            .or_insert_with(|| {
                let layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: None,
                    bind_group_layouts: &[Some(&self.shade_layout)],
                    immediate_size: 0,
                });
                self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some("ClearSkies shade"),
                    layout: Some(&layout),
                    vertex: wgpu::VertexState {
                        module: &self.shade_vertex,
                        entry_point: Some("main"),
                        compilation_options: Default::default(),
                        buffers: &[],
                    },
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    fragment: Some(wgpu::FragmentState {
                        module: &self.shade_fragment,
                        entry_point: Some("main"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format,
                            blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    multiview_mask: None,
                    cache: None,
                })
            })
            .clone()
    }

    /// The raster layer program for a target format, its layout and sampler.
    pub(crate) fn raster_pipeline(
        &self,
        format: wgpu::TextureFormat,
    ) -> (wgpu::RenderPipeline, wgpu::BindGroupLayout, wgpu::Sampler) {
        let pipeline = self.overlay_pipeline("raster", &self.raster_module, &self.raster_layout, format);
        (pipeline, self.raster_layout.clone(), self.raster_sampler.clone())
    }

    /// The marker program for a target format, and its layout.
    pub(crate) fn marker_pipeline(&self, format: wgpu::TextureFormat) -> (wgpu::RenderPipeline, wgpu::BindGroupLayout) {
        (self.overlay_pipeline("marker", &self.marker_module, &self.marker_layout, format), self.marker_layout.clone())
    }

    /// A full-frame overlay program (`vertex`/`fragment` entry points)
    /// blending premultiplied "over" into `format`.
    fn overlay_pipeline(
        &self,
        name: &'static str,
        module: &wgpu::ShaderModule,
        group: &wgpu::BindGroupLayout,
        format: wgpu::TextureFormat,
    ) -> wgpu::RenderPipeline {
        let mut cache = self.overlay_pipelines.lock().unwrap();
        cache
            .entry((name, format))
            .or_insert_with(|| {
                let layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: None,
                    bind_group_layouts: &[Some(group)],
                    immediate_size: 0,
                });
                self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(name),
                    layout: Some(&layout),
                    vertex: wgpu::VertexState {
                        module,
                        entry_point: Some("vertex"),
                        compilation_options: Default::default(),
                        buffers: &[],
                    },
                    primitive: Default::default(),
                    depth_stencil: None,
                    multisample: Default::default(),
                    fragment: Some(wgpu::FragmentState {
                        module,
                        entry_point: Some("fragment"),
                        compilation_options: Default::default(),
                        targets: &[Some(wgpu::ColorTargetState {
                            format,
                            blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                    }),
                    multiview_mask: None,
                    cache: None,
                })
            })
            .clone()
    }

    /// Records the shading pass of `field` into `target` (any colour format,
    /// e.g. a presentation surface). Premultiplied output, cleared to clear.
    pub(crate) fn encode_shade(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        field: &wgpu::TextureView,
        uniforms: &Uniforms,
        aux: &AuxViews<'_>,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
    ) {
        let mut pass = Self::begin(encoder, target);
        self.shade(&mut pass, field, uniforms, aux, format);
    }

    /// A frame's render pass into `target`, cleared to transparent.
    pub(crate) fn begin<'e>(encoder: &'e mut wgpu::CommandEncoder, target: &wgpu::TextureView) -> wgpu::RenderPass<'e> {
        encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        })
    }

    /// Draws the shaded terrain "over" what `pass` holds (premultiplied).
    pub(crate) fn shade(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        field: &wgpu::TextureView,
        uniforms: &Uniforms,
        aux: &AuxViews<'_>,
        format: wgpu::TextureFormat,
    ) {
        let mut uniforms = uniforms.clone();
        let factor = |a: Option<(&wgpu::TextureView, u32)>| [a.map_or(0.0, |(_, f)| f as f32)];
        for (name, value) in
            [("csk_blurScale", aux.blur), ("csk_baseScale", aux.base), ("csk_landBaseScale", aux.land_base)]
        {
            uniforms.set(name, &factor(value)).expect("generated aux uniforms");
        }
        uniforms.set("csk_auxTransform", &aux.transform).expect("generated aux uniforms");
        let uniform = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("ClearSkies appearance"),
            contents: uniforms.bytes(),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let water = self.water_view();
        let mut entries = vec![wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() }];
        for (name, spec) in layout::shade()["textures"].as_object().expect("shade layout") {
            let view = match name.as_str() {
                "csk_field" => field,
                "u_waterMask" => &water,
                "csk_blur" => aux.blur.map_or(&self.empty_aux, |(v, _)| v),
                "csk_base" => aux.base.map_or(&self.empty_aux, |(v, _)| v),
                "csk_landBase" => aux.land_base.map_or(&self.empty_aux, |(v, _)| v),
                _ => &self.empty_aux,
            };
            entries.push(wgpu::BindGroupEntry {
                binding: spec["binding"].as_u64().expect("shade layout") as u32,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.shade_layout,
            entries: &entries,
        });
        let pipeline = self.shade_pipeline(format);
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &group, &[]);
        pass.draw(0..3, 0..1);
    }

    /// Allocates an offscreen frame of the given size, charged to the budget.
    pub(crate) fn frame(&self, width: u32, height: u32, extra: usize) -> Result<Frame, Error> {
        let charge = Arc::new(self.budget.reserve(texture_bytes(width, height, 4) + extra + (64 << 10))?);
        let texture = self.texture(
            width,
            height,
            1,
            FRAME_FORMAT,
            wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        Ok(Frame { texture, width, height, charge, identity: self.identity.clone() })
    }

    pub(crate) fn frame_view(frame: &Frame) -> wgpu::TextureView {
        frame.texture.create_view(&Default::default())
    }

    pub(crate) fn frame_charge(frame: &Frame) -> Arc<Reservation> {
        frame.charge.clone()
    }

    /// Shades an uploaded field into an offscreen frame.
    pub fn render(&self, field: &Field, uniforms: &Uniforms) -> Result<Frame, Error> {
        if !Arc::ptr_eq(&field.identity, &self.identity) {
            return Err(Error::Input("field belongs to another GPU device"));
        }
        self.poll()?;
        let frame = self.frame(field.width, field.height, uniforms.bytes().len())?;
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let aux = AuxViews::default();
        self.encode_shade(&mut encoder, &field.view, uniforms, &aux, &Self::frame_view(&frame), FRAME_FORMAT);
        self.queue.submit([encoder.finish()]);
        self.retain_until_done((field.charge.clone(), frame.charge.clone()));
        Ok(frame)
    }

    /// Shades an uploaded field with derived fields of its own size (Detail
    /// blur, REM floors), e.g. a look preview.
    pub fn render_derived(
        &self,
        field: &Field,
        uniforms: &Uniforms,
        blur: Option<&Field>,
        base: Option<&Field>,
        land_base: Option<&Field>,
    ) -> Result<Frame, Error> {
        for f in [Some(field), blur, base, land_base].into_iter().flatten() {
            if !Arc::ptr_eq(&f.identity, &self.identity) {
                return Err(Error::Input("field belongs to another GPU device"));
            }
            if (f.width, f.height) != (field.width, field.height) {
                return Err(Error::Input("derived field size"));
            }
        }
        self.poll()?;
        let frame = self.frame(field.width, field.height, uniforms.bytes().len())?;
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let aux = AuxViews {
            blur: blur.map(|f| (&f.view, 1)),
            base: base.map(|f| (&f.view, 1)),
            land_base: land_base.map(|f| (&f.view, 1)),
            transform: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        };
        self.encode_shade(&mut encoder, &field.view, uniforms, &aux, &Self::frame_view(&frame), FRAME_FORMAT);
        self.queue.submit([encoder.finish()]);
        let charges: Vec<_> =
            [Some(field), blur, base, land_base].into_iter().flatten().map(|f| f.charge.clone()).collect();
        self.retain_until_done((charges, frame.charge.clone()));
        Ok(frame)
    }

    pub fn poll(&self) -> Result<(), Error> {
        self.device.poll(wgpu::PollType::Poll).map_err(|e| Error::Device(e.to_string()))?;
        Ok(())
    }

    /// Explicit offscreen export/QA path. Call on a worker, never the display
    /// thread. Interactive presentation renders straight into its surface.
    pub fn readback(&self, frame: &Frame) -> Result<Pixels, Error> {
        if !Arc::ptr_eq(&frame.identity, &self.identity) {
            return Err(Error::Input("frame belongs to another GPU device"));
        }
        self.read(&frame.texture, frame.width, frame.height, 4, frame.charge.clone())
    }

    pub(crate) fn read(
        &self,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
        bpp: u32,
        hold: Arc<Reservation>,
    ) -> Result<Pixels, Error> {
        let stride = (width * bpp).div_ceil(256) * 256;
        let size = u64::from(stride) * u64::from(height);
        let charge = Arc::new(self.budget.reserve(size as usize * 2)?);
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ClearSkies export"),
            size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        let submission = self.queue.submit([encoder.finish()]);
        self.retain_until_done((hold, charge.clone()));
        let (tx, rx) = std::sync::mpsc::channel();
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.device
            .poll(wgpu::PollType::Wait { submission_index: Some(submission), timeout: Some(Duration::from_secs(30)) })
            .map_err(|e| Error::Device(e.to_string()))?;
        rx.recv_timeout(Duration::from_secs(1))
            .map_err(|e| Error::Device(e.to_string()))?
            .map_err(|e| Error::Device(e.to_string()))?;
        let mapped = buffer.slice(..).get_mapped_range().map_err(|e| Error::Device(e.to_string()))?;
        let row = (width * bpp) as usize;
        let mut bytes = Vec::with_capacity(row * height as usize);
        for line in mapped.chunks_exact(stride as usize) {
            bytes.extend_from_slice(&line[..row]);
        }
        drop(mapped);
        buffer.unmap();
        Ok(Pixels { bytes, _charge: charge })
    }
}
