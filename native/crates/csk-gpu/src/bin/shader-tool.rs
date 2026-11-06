//! Offline build tool; never compiles shaders from the network at runtime.
use std::{fs, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        return Err("usage: shader-tool INPUT.spv OUTPUT_PREFIX".into());
    }
    let bytes = fs::read(&args[1])?;
    let module = naga::front::spv::parse_u8_slice(&bytes, &naga::front::spv::Options::default())?;
    let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
        .validate(&module)?;
    let wgsl = naga::back::wgsl::write_string(&module, &info, naga::back::wgsl::WriterFlags::EXPLICIT_TYPES)?;
    // Re-parse the generated WGSL: both runtime inputs must validate, and the
    // Metal comparator must be compiled from the same semantic program.
    let checked = naga::front::wgsl::parse_str(&wgsl)?;
    naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
        .validate(&checked)?;
    if uniform_layouts(&module) != uniform_layouts(&checked) {
        return Err("uniform layout changed between SPIR-V and WGSL".into());
    }
    let mut resources = naga::back::msl::EntryPointResources::default();
    for (_, var) in module.global_variables.iter() {
        if let Some(binding) = var.binding {
            let mut target = naga::back::msl::BindTarget::default();
            match var.space {
                naga::AddressSpace::Uniform => target.buffer = Some(binding.binding as u8),
                naga::AddressSpace::Handle => target.texture = Some(binding.binding as u8),
                _ => return Err("unexpected shader resource address space".into()),
            }
            resources.resources.insert(binding, target);
        }
    }
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
    fs::write(Path::new(&format!("{}.wgsl", args[2])), wgsl)?;
    fs::write(Path::new(&format!("{}.metal", args[2])), msl)?;
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
