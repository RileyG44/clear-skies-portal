#!/bin/zsh
# Build the native engine (native/crates/csk-ffi) for the platform Xcode is
# building, and put libcsk_ffi.a where the app target links it.
#
#   build_native.sh <repository root> <output directory>
#
# Reads Xcode's PLATFORM_NAME, ARCHS and CONFIGURATION. Debug builds use the
# `app-dev` profile (optimised, without fat LTO) because unoptimised raster code
# is too slow to judge the map with; Release uses the full LTO profile.
set -euo pipefail
root=$1 out=$2

# Xcode's build environment does not load a shell profile.
for dir in "$HOME/.cargo/bin" /opt/homebrew/opt/rustup/bin /usr/local/opt/rustup/bin; do
  [[ -x $dir/cargo ]] && export PATH="$dir:$PATH" && break
done
command -v cargo >/dev/null || { echo "error: build_native: cargo not found (install rustup)" >&2; exit 1; }

case "${PLATFORM_NAME:-iphonesimulator}" in
  iphoneos) targets=(aarch64-apple-ios) ;;
  iphonesimulator)
    targets=()
    for arch in ${=ARCHS:-arm64}; do
      case $arch in
        arm64) targets+=(aarch64-apple-ios-sim) ;;
        x86_64) targets+=(x86_64-apple-ios) ;;
      esac
    done ;;
  *) echo "error: build_native: unsupported platform $PLATFORM_NAME" >&2; exit 1 ;;
esac

if [[ ${CONFIGURATION:-Debug} == Release ]]; then profile=release; else profile=app-dev; fi

# Xcode exports SDK variables for the app's own compile; cc-rs picks its own.
unset SDKROOT IPHONEOS_DEPLOYMENT_TARGET LLVM_TARGET_TRIPLE_SUFFIX
export IPHONEOS_DEPLOYMENT_TARGET=26.0

cd "$root/native"
libs=()
for t in $targets; do
  cargo build --locked -p csk-ffi --profile $profile --target $t
  libs+=("target/$t/$profile/libcsk_ffi.a")
done
mkdir -p "$out"
if (( ${#libs} > 1 )); then
  lipo -create $libs -output "$out/libcsk_ffi.a"
else
  cp -f $libs[1] "$out/libcsk_ffi.a"
fi
