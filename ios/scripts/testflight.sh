#!/bin/zsh
# Archive Clear Skies and upload it to App Store Connect for internal TestFlight
# testing only (docs/ios CR-001). Needs the App Store Connect app record for the
# bundle ID in Config/Base.xcconfig and this Mac's team in Config/Local.xcconfig.
#
#   ios/scripts/testflight.sh            archive and upload
#   ios/scripts/testflight.sh --export   archive and export the .ipa locally only
set -euo pipefail
cd "${0:A:h}/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

# Minutes since 1970: always increasing, and small enough for CFBundleVersion.
build=$(( $(date +%s) / 60 ))
work=$(mktemp -d)
options=Config/ExportOptions-TestFlight.plist
if [[ ${1:-} == --export ]]; then
  sed 's#<string>upload</string>#<string>export</string>#' "$options" > "$work/ExportOptions.plist"
  options="$work/ExportOptions.plist"
fi

xcodegen generate --quiet
xcodebuild -project ClearSkies.xcodeproj -scheme ClearSkies -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$work/ClearSkies.xcarchive" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$build" archive
xcodebuild -exportArchive -archivePath "$work/ClearSkies.xcarchive" -exportPath "$work/export" \
  -exportOptionsPlist "$options" -allowProvisioningUpdates

if [[ ${1:-} == --export ]]; then
  echo "Exported build $build to $work/export"
else
  echo "Uploaded build $build for internal TestFlight testing. It appears in TestFlight once Apple finishes processing it."
fi
