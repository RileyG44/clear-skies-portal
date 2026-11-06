#!/bin/sh
# Regenerates native/shaders/generated. CI requires the output to be unchanged.
set -eu
cd "$(dirname "$0")/.."
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
rm -rf shaders/generated
mkdir -p shaders/generated
cargo build --quiet -p csk-shader-tool
tool=target/debug/csk-shader-tool
# Shading programs extracted from the JS factory: GLSL -> SPIR-V -> WGSL + MSL.
node shaders/extract.cjs "$scratch"
for source in "$scratch"/*.vert "$scratch"/*.frag; do
  name=$(basename "$source")
  glslangValidator --quiet --target-env vulkan1.1 -V "$source" -o "$scratch/$name.spv"
  $tool "$scratch/$name.spv" "shaders/generated/$name"
done
# Native compute programs: WGSL is the source; MSL feeds the Metal comparator.
for source in crates/csk-gpu/src/wgsl/*.wgsl; do
  $tool "$source" "shaders/generated/$(basename "$source" .wgsl)"
done
cp "$scratch/layouts.json" "$scratch/defaults.bin" "$scratch/terrain.json" "$scratch/terrain-cases.json" \
  "$scratch/water-mask.rle" shaders/generated/
