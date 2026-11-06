//! Native terrain renderer. Shader sources come from the authoritative JS
//! factory through glslang/SPIR-V/naga, shared by wgpu and raw Metal.

mod render;
mod uniforms;

pub use render::{Field, Frame, Input, Pixels, Renderer, WaterMask};
pub use uniforms::Uniforms;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("native GPU adapter unavailable: {0}")]
    Adapter(String),
    #[error("native GPU unavailable: {0}")]
    Device(String),
    #[error("invalid terrain frame: {0}")]
    Input(&'static str),
    #[error(transparent)]
    Memory(#[from] csk_core::resource::Unavailable),
}
