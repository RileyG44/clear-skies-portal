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
    shade_vertex: wgpu::ShaderModule,
    shade_fragment: wgpu::ShaderModule,
    pub(crate) composite: (wgpu::ComputePipeline, wgpu::BindGroupLayout),
    pub(crate) resample: (wgpu::ComputePipeline, wgpu::BindGroupLayout),
    /// Absent derived fields bind a 1x1 invalid texture with scale zero.
    empty_aux: wgpu::TextureView,
    water: Mutex<wgpu::TextureView>,
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
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(label),
        layout: Some(&pipeline_layout),
        module: &module,
        entry_point: Some("main"),
        compilation_options: Default::default(),
        cache: None,
    });
    (pipeline, layout)
}

fn entry(binding: u32, visibility: wgpu::ShaderStages, ty: wgpu::BindingType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry { binding, visibility, ty, count: None }
}

fn sampled(dimension: wgpu::TextureViewDimension, sample_type: wgpu::TextureSampleType) -> wgpu::BindingType {
    wgpu::BindingType::Texture { sample_type, view_dimension: dimension, multisampled: false }
}

const FLOAT: wgpu::TextureSampleType = wgpu::TextureSampleType::Float { filterable: false };

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
        let empty_aux = tiny(wgpu::TextureFormat::Rg32Float, &[0; 8]);
        let water = Mutex::new(tiny(wgpu::TextureFormat::Rgba8Uint, &[0; 4]));
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
            shade_vertex,
            shade_fragment,
            composite,
            resample,
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

    /// Installs the global water-class mask (`water-geography.js` packing).
    pub fn set_water_mask(&self, width: u32, height: u32, rgba: &[u8]) -> Result<(), Error> {
        if width == 0
            || height == 0
            || width > self.max_dimension()
            || height > self.max_dimension()
            || rgba.len() != width as usize * height as usize * 4
        {
            return Err(Error::Input("water-mask shape"));
        }
        let texture = self.device.create_texture_with_data(
            &self.queue,
            &wgpu::TextureDescriptor {
                label: Some("water mask"),
                size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Uint,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
            Default::default(),
            rgba,
        );
        *self.water.lock().unwrap() = texture.create_view(&Default::default());
        Ok(())
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
                            blend: None,
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
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
    ) {
        let uniform = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("ClearSkies appearance"),
            contents: uniforms.bytes(),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let water = self.water.lock().unwrap().clone();
        let mut entries = vec![wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() }];
        for (name, spec) in layout::shade()["textures"].as_object().expect("shade layout") {
            let view = match name.as_str() {
                "csk_field" => field,
                "u_waterMask" => &water,
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
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
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
        });
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
        self.encode_shade(&mut encoder, &field.view, uniforms, &Self::frame_view(&frame), FRAME_FORMAT);
        self.queue.submit([encoder.finish()]);
        self.retain_until_done((field.charge.clone(), frame.charge.clone()));
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
