use std::sync::Arc;
use std::time::Duration;

use csk_core::resource::{Budget, Reservation};
use wgpu::util::DeviceExt;

use crate::{Error, Uniforms};

pub struct WaterMask<'a> {
    pub width: u32,
    pub height: u32,
    pub rgba: &'a [u8],
}

/// Row-major top-left heights in metres. Ranks keep their source meaning;
/// zero is invalid. Aux fields contain (height, validity) for every pixel.
pub struct Input<'a> {
    pub width: u32,
    pub height: u32,
    pub heights: &'a [f32],
    pub ranks: &'a [u8],
    pub aux: [Option<&'a [f32]>; 3],
    pub water: Option<WaterMask<'a>>,
}

pub struct Renderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    budget: Arc<Budget>,
    identity: Arc<()>,
    pub adapter: wgpu::AdapterInfo,
}

/// A frame owns its resident charge. Pending submissions also retain the
/// charge, so dropping a frame cannot admit overlapping GPU work too early.
pub struct Frame {
    texture: wgpu::Texture,
    width: u32,
    height: u32,
    charge: Arc<Reservation>,
    identity: Arc<()>,
}

/// Uploaded source fields persist across appearance changes. The ownership
/// charge includes every bound texture and remains alive through submissions.
pub struct Field {
    views: Vec<wgpu::TextureView>,
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

impl Renderer {
    pub async fn new(budget: Arc<Budget>) -> Result<Self, Error> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .map_err(|e| Error::Adapter(e.to_string()))?;
        let info = adapter.get_info();
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| Error::Device(e.to_string()))?;
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let vertex = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ClearSkies fullscreen"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../../../shaders/generated/fullscreen.wgsl").into()),
        });
        let fragment = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ClearSkies terrain"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../../../shaders/generated/shade.wgsl").into()),
        });
        let mut entries = vec![wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        }];
        for binding in 1..=6 {
            entries.push(wgpu::BindGroupLayoutEntry {
                binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: if binding == 2 || binding == 3 {
                        wgpu::TextureSampleType::Uint
                    } else {
                        wgpu::TextureSampleType::Float { filterable: false }
                    },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            });
        }
        let layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: None, entries: &entries });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ClearSkies shade"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &vertex,
                entry_point: Some("main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &fragment,
                entry_point: Some("main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        if let Some(error) = scope.pop().await {
            return Err(Error::Device(error.to_string()));
        }
        Ok(Self { device, queue, pipeline, layout, budget, adapter: info, identity: Arc::new(()) })
    }

    pub fn upload(&self, input: &Input<'_>) -> Result<Field, Error> {
        let (w, h) = (input.width, input.height);
        let limit = self.device.limits().max_texture_dimension_2d;
        if w == 0 || h == 0 || w > limit || h > limit {
            return Err(Error::Input("texture dimensions exceed device limits"));
        }
        let n = w as usize * h as usize;
        if input.heights.len() != n || input.ranks.len() != n || input.aux.iter().flatten().any(|a| a.len() != n * 2) {
            return Err(Error::Input("height, rank or auxiliary shape"));
        }
        if let Some(water) = &input.water
            && (water.width == 0
                || water.height == 0
                || water.width > limit
                || water.height > limit
                || water.rgba.len() != water.width as usize * water.height as usize * 4)
        {
            return Err(Error::Input("water-mask shape"));
        }
        // Row-aligned textures, uploads, conversion scratch and allocator
        // slack are admitted together. Driver/pipeline overhead needs separate
        // measured platform allowance; this estimate is for frame resources.
        let texture_bytes =
            |width: u32, height: u32, bpp: usize| (width as usize * bpp).div_ceil(256) * 256 * height as usize + 4096;
        let mut bytes = texture_bytes(w, h, 4) * 3 + texture_bytes(w, h, 1) * 2 + (64 << 10);
        for aux in input.aux {
            bytes += if aux.is_some() { texture_bytes(w, h, 8) * 3 } else { 4096 };
        }
        bytes += input.water.as_ref().map_or(4096, |a| texture_bytes(a.width, a.height, 4) * 2);
        self.poll()?;
        let charge = Arc::new(self.budget.reserve(bytes)?);
        let upload = |width, height, format, bytes: &[u8], bpp| {
            let texture = self.texture(
                width,
                height,
                format,
                wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            );
            self.queue.write_texture(
                texture.as_image_copy(),
                bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(width * bpp),
                    rows_per_image: Some(height),
                },
                wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            );
            texture
        };
        let floats = |values: &[f32]| values.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<_>>();
        let heights = upload(w, h, wgpu::TextureFormat::R32Float, &floats(input.heights), 4);
        let ranks = upload(w, h, wgpu::TextureFormat::R8Uint, input.ranks, 1);
        let water = if let Some(a) = &input.water {
            upload(a.width, a.height, wgpu::TextureFormat::Rgba8Uint, a.rgba, 4)
        } else {
            upload(1, 1, wgpu::TextureFormat::Rgba8Uint, &[0; 4], 4)
        };
        let aux: Vec<_> = input
            .aux
            .iter()
            .map(|a| {
                if let Some(a) = a {
                    upload(w, h, wgpu::TextureFormat::Rg32Float, &floats(a), 8)
                } else {
                    upload(1, 1, wgpu::TextureFormat::Rg32Float, &[0; 8], 8)
                }
            })
            .collect();
        let views: Vec<_> = [&heights, &ranks, &water, &aux[0], &aux[1], &aux[2]]
            .iter()
            .map(|t| t.create_view(&Default::default()))
            .collect();
        // Flush queue-owned staging even if no draw follows this upload.
        self.queue.submit([]);
        let pending = charge.clone();
        self.queue.on_submitted_work_done(move || drop(pending));
        Ok(Field { views, width: w, height: h, charge, identity: self.identity.clone() })
    }

    pub fn render(&self, field: &Field, uniforms: &Uniforms) -> Result<Frame, Error> {
        if !Arc::ptr_eq(&field.identity, &self.identity) {
            return Err(Error::Input("field belongs to another GPU device"));
        }
        self.poll()?;
        let (w, h) = (field.width, field.height);
        let bytes = (w as usize * 4).div_ceil(256) * 256 * h as usize + uniforms.bytes().len() + (64 << 10);
        let charge = Arc::new(self.budget.reserve(bytes)?);
        let uniform = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("ClearSkies appearance"),
            contents: uniforms.bytes(),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let mut entries = vec![wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() }];
        entries.extend(field.views.iter().enumerate().map(|(i, view)| wgpu::BindGroupEntry {
            binding: i as u32 + 1,
            resource: wgpu::BindingResource::TextureView(view),
        }));
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &entries,
        });
        let texture = self.texture(
            w,
            h,
            wgpu::TextureFormat::Rgba8Unorm,
            wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let view = texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        let pending = (field.charge.clone(), charge.clone());
        self.queue.on_submitted_work_done(move || drop(pending));
        Ok(Frame { texture, width: w, height: h, charge, identity: self.identity.clone() })
    }

    fn texture(
        &self,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
        usage: wgpu::TextureUsages,
    ) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage,
            view_formats: &[],
        })
    }

    pub fn poll(&self) -> Result<(), Error> {
        self.device.poll(wgpu::PollType::Poll).map_err(|e| Error::Device(e.to_string()))?;
        Ok(())
    }

    /// Explicit offscreen export/QA path. Call on a worker, never the display
    /// thread. Interactive presentation uses the resident frame texture.
    pub fn readback(&self, frame: &Frame) -> Result<Pixels, Error> {
        if !Arc::ptr_eq(&frame.identity, &self.identity) {
            return Err(Error::Input("frame belongs to another GPU device"));
        }
        let stride = (frame.width * 4).div_ceil(256) * 256;
        let size = u64::from(stride) * u64::from(frame.height);
        let charge = Arc::new(self.budget.reserve(size as usize * 2)?);
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ClearSkies export"),
            size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            frame.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: Some(frame.height),
                },
            },
            wgpu::Extent3d { width: frame.width, height: frame.height, depth_or_array_layers: 1 },
        );
        let submission = self.queue.submit([encoder.finish()]);
        let pending = (frame.charge.clone(), charge.clone());
        self.queue.on_submitted_work_done(move || drop(pending));
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
        let mut bytes = Vec::with_capacity(frame.width as usize * frame.height as usize * 4);
        for row in mapped.chunks_exact(stride as usize) {
            bytes.extend_from_slice(&row[..frame.width as usize * 4]);
        }
        drop(mapped);
        buffer.unmap();
        Ok(Pixels { bytes, _charge: charge })
    }
}
