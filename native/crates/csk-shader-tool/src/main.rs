//! Offline build tool; never compiles shaders from the network at runtime.
//!
//! `shader-tool INPUT.spv PREFIX` writes PREFIX.wgsl and PREFIX.metal from a
//! glslang module. `shader-tool INPUT.wgsl PREFIX` validates a native WGSL
//! program and writes PREFIX.metal for the raw-Metal comparator.
use std::{fs, path::Path};

use naga::valid::{Capabilities, ValidationFlags, Validator};

fn validate(module: &naga::Module) -> Result<naga::valid::ModuleInfo, Box<dyn std::error::Error>> {
    Ok(Validator::new(ValidationFlags::all(), Capabilities::empty()).validate(module)?)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        return Err("usage: shader-tool INPUT.{spv,wgsl} OUTPUT_PREFIX".into());
    }
    let (input, prefix) = (&args[1], &args[2]);
    let (module, info) = if input.ends_with(".wgsl") {
        let module = naga::front::wgsl::parse_str(&fs::read_to_string(input)?)?;
        let info = validate(&module)?;
        (module, info)
    } else {
        let module = naga::front::spv::parse_u8_slice(&fs::read(input)?, &naga::front::spv::Options::default())?;
        let info = validate(&module)?;
        let wgsl = naga::back::wgsl::write_string(&module, &info, naga::back::wgsl::WriterFlags::EXPLICIT_TYPES)?;
        // Re-parse the generated WGSL: both runtime inputs must validate, and
        // the Metal comparator must be compiled from the same semantic program.
        let checked = naga::front::wgsl::parse_str(&wgsl)?;
        validate(&checked)?;
        if uniform_layouts(&module) != uniform_layouts(&checked) {
            return Err("uniform layout changed between SPIR-V and WGSL".into());
        }
        fs::write(Path::new(&format!("{prefix}.wgsl")), wgsl)?;
        (module, info)
    };
    let mut resources = naga::back::msl::EntryPointResources::default();
    for (_, var) in module.global_variables.iter() {
        if let Some(binding) = var.binding {
            let mut target = naga::back::msl::BindTarget::default();
            match var.space {
                naga::AddressSpace::Uniform | naga::AddressSpace::Storage { .. } => {
                    target.buffer = Some(binding.binding as u8)
                }
                naga::AddressSpace::Handle if matches!(module.types[var.ty].inner, naga::TypeInner::Sampler { .. }) => {
                    target.sampler = Some(naga::back::msl::BindSamplerTarget::Resource(binding.binding as u8))
                }
                naga::AddressSpace::Handle => target.texture = Some(binding.binding as u8),
                _ => return Err("unexpected shader resource address space".into()),
            }
            resources.resources.insert(binding, target);
        }
    }
    // Runtime-sized storage arrays read their lengths from this slot.
    resources.sizes_buffer = Some(30);
    let mut options =
        naga::back::msl::Options { lang_version: (2, 3), fake_missing_bindings: false, ..Default::default() };
    for entry in &module.entry_points {
        options.per_entry_point_map.insert(entry.name.clone(), resources.clone());
    }
    let (msl, translation) =
        naga::back::msl::write_string(&module, &info, &options, &naga::back::msl::PipelineOptions::default())?;
    for entry in translation.entry_point_names {
        entry.map_err(|e| format!("Metal binding translation: {e:?}"))?;
    }
    fs::write(Path::new(&format!("{prefix}.metal")), msl)?;
    Ok(())
}

fn uniform_layouts(module: &naga::Module) -> Vec<(u32, Vec<u32>)> {
    module
        .global_variables
        .iter()
        .filter_map(|(_, var)| {
            if var.space != naga::AddressSpace::Uniform {
                return None;
            }
            let naga::TypeInner::Struct { members, span } = &module.types[var.ty].inner else {
                return None;
            };
            Some((*span, members.iter().map(|member| member.offset).collect()))
        })
        .collect()
}
