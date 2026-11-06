#!/bin/zsh
# Archive an app and upload it to App Store Connect for internal TestFlight
# testing only (docs/ios CR-001). Needs the App Store Connect app record for
# the app's bundle ID (Config/Base.xcconfig) and this Mac's team in
# Config/Local.xcconfig.
#
#   ios/scripts/testflight.sh                 ClearSkies: archive and upload
#   ios/scripts/testflight.sh --app Drumlin   Drumlin, the fully native app
#   ios/scripts/testflight.sh --export        archive and export the .ipa locally only
set -euo pipefail
cd "${0:A:h}/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

scheme=ClearSkies
export_only=false
while (( $# )); do
  case $1 in
    --export) export_only=true ;;
    --app) shift; scheme=${1:?--app needs ClearSkies or Drumlin} ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
  shift
done
case $scheme in
  ClearSkies|Drumlin) ;;
  *) echo "unknown app $scheme: ClearSkies or Drumlin" >&2; exit 64 ;;
esac

# Minutes since 1970: always increasing, and small enough for CFBundleVersion.
build=$(( $(date +%s) / 60 ))
work=$(mktemp -d)
# Not "options": that name is zsh's own table of shell options.
export_options=Config/ExportOptions-TestFlight.plist
if $export_only; then
  sed 's#<string>upload</string>#<string>export</string>#' "$export_options" > "$work/ExportOptions.plist"
  export_options="$work/ExportOptions.plist"
fi

xcodegen generate --quiet
xcodebuild -project ClearSkies.xcodeproj -scheme "$scheme" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$work/$scheme.xcarchive" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$build" archive
xcodebuild -exportArchive -archivePath "$work/$scheme.xcarchive" -exportPath "$work/export" \
  -exportOptionsPlist "$export_options" -allowProvisioningUpdates

if $export_only; then
  echo "Exported $scheme build $build to $work/export"
else
  echo "Uploaded $scheme build $build for internal TestFlight testing. It appears in TestFlight once Apple finishes processing it."
fi
