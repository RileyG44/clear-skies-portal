#!/bin/zsh
# Build Clear Skies, install it on the paired iPhone and open it. The phone
# must be connected by cable or on the same network, and unlocked to open.
# Pass --no-activate to install and launch without taking over the screen.
set -euo pipefail
launch_options=(--terminate-existing)
if [[ $# -eq 1 && ${1:-} == --no-activate ]]; then
  launch_options+=(--no-activate)
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--no-activate]" >&2
  exit 2
fi
cd "${0:A:h}/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
# Outside ~/Documents: iCloud Drive tags files there, and codesign rejects them.
derived="$HOME/Library/Developer/Xcode/DerivedData/ClearSkies-ios"

# CoreDevice also lists paired simulators. Select and contact physical iPhone
# hardware before building; a remembered pairing alone does not mean reachable.
list=$(mktemp)
trap 'rm -f "$list"' EXIT
xcrun devicectl list devices --json-output "$list" >/dev/null
device=$(/usr/bin/python3 -I scripts/select_iphone.py "$list")
echo "Using physical iPhone $device."

xcodegen generate --quiet
xcodebuild -project ClearSkies.xcodeproj -scheme ClearSkies -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$derived" -allowProvisioningUpdates build
app="$derived/Build/Products/Debug-iphoneos/ClearSkies.app"
bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")

xcrun devicectl device install app --device "$device" "$app"
echo "Installed Clear Skies on physical iPhone $device."
xcrun devicectl device process launch --device "$device" "${launch_options[@]}" "$bundle" \
  || { echo "Installed on the physical iPhone, but launch failed. Unlock it and open Clear Skies." >&2; exit 1; }
