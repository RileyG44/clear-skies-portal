#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
node shaders/extract.cjs "$scratch"
mkdir -p shaders/generated
for program in fullscreen.vert shade.frag; do
  glslangValidator --target-env vulkan1.1 -V "$scratch/$program" -o "$scratch/$program.spv"
  cargo run --quiet -p csk-gpu --features shader-tools --bin shader-tool -- "$scratch/$program.spv" "shaders/generated/${program%.*}"
done
cp "$scratch/uniforms.json" "$scratch/defaults.bin" shaders/generated/
