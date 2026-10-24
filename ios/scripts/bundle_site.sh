#!/bin/zsh
# Bundle the web client into the app exactly as GitHub Pages ships it: the
# files from ci.yml's "Assemble the static site" step, then its "Minify the
# shipped bytes" step. Smaller scripts parse sooner on every launch.
#
#   bundle_site.sh <repository root> <destination> <configuration>
#
# Minifying needs Node and the repository's esbuild (npm ci). A Release build
# fails without them rather than shipping different bytes from Pages; a Debug
# build warns and bundles the readable sources.
set -euo pipefail
root=$1 destination=$2 configuration=${3:-Debug}

/usr/bin/python3 -I "$root/ios/scripts/assemble_site.py" "$root" "$destination"

# Xcode's build environment does not load a shell profile, so look where Node
# is usually installed.
node=""
for candidate in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node \
    $HOME/.nvm/versions/node/*/bin/node(NOn); do
  if [[ -n $candidate && -x $candidate ]]; then node=$candidate; break; fi
done

if [[ -n $node && -d "$root/node_modules/esbuild" ]]; then
  # Run from the repository so require("esbuild") resolves there.
  (cd "$root" && "$node" scripts/minify-site.js "$destination")
elif [[ $configuration == Release ]]; then
  echo "error: bundle_site: a Release build needs Node and esbuild to match the Pages bytes (run npm ci)." >&2
  exit 1
else
  echo "warning: bundle_site: Node or esbuild not found; bundling unminified sources for this Debug build." >&2
fi
