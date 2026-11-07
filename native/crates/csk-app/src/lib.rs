//! The native app state behind the SwiftUI shell (docs/native/ARCHITECTURE.md
//! §4.1): what a person has chosen (terrain looks, layers, appearance), the
//! pages the shell shows for it, and the actions the shell sends back. The
//! map draws what this state compiles to.

pub mod app;
pub mod appearance;
pub mod coords;
pub mod elevation;
pub mod export;
pub mod overlays;
pub mod preview;
pub mod render;
pub mod shell;
pub mod state;
pub mod terrain;
pub mod vectors;

pub use app::{App, Publish};
