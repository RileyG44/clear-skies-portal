#!/bin/zsh
# Build Clear Skies, install it on the paired iPhone and open it. The phone
# must be connected by cable or on the same network, and unlocked to open.
set -euo pipefail
cd "${0:A:h}/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
# Outside ~/Documents: iCloud Drive tags files there, and codesign rejects them.
derived="$HOME/Library/Developer/Xcode/DerivedData/ClearSkies-ios"

xcodegen generate --quiet
xcodebuild -project ClearSkies.xcodeproj -scheme ClearSkies -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$derived" -allowProvisioningUpdates build
app="$derived/Build/Products/Debug-iphoneos/ClearSkies.app"
bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")

list=$(mktemp)
xcrun devicectl list devices --json-output "$list" >/dev/null
device=$(/usr/bin/python3 -I -c '
import json, sys
devices = json.load(open(sys.argv[1]))["result"]["devices"]
ready = [d for d in devices
         if d.get("hardwareProperties", {}).get("platform") == "iOS"
         and d.get("connectionProperties", {}).get("pairingState") == "paired"
         and d.get("connectionProperties", {}).get("tunnelState") != "unavailable"]
print(ready[0]["identifier"] if ready else "")' "$list")
if [[ -z $device ]]; then
  echo "No paired iPhone is reachable. Connect it by cable or join the same network, then run this again." >&2
  exit 1
fi

xcrun devicectl device install app --device "$device" "$app"
xcrun devicectl device process launch --device "$device" --terminate-existing "$bundle" \
  || echo "Installed. Unlock the iPhone and open Clear Skies."
