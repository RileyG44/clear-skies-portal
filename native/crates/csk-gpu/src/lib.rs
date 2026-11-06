//! Native terrain renderer. The shading program comes from the authoritative
//! JS factory through glslang/SPIR-V/naga, shared by wgpu and raw Metal; tile
//! composition and resampling are native compute programs (`src/wgsl`).

mod layout;
mod render;
mod terrain;

pub use layout::Uniforms;
pub use render::{FRAME_FORMAT, Field, Frame, Pixels, Renderer};
pub use terrain::{FrameStats, SourceSpec, TILE, Terrain, TileId, TileKey, View};

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
