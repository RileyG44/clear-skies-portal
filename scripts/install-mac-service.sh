#!/bin/zsh
# Install the self-healing private terrain service for this checkout.
set -euo pipefail
setopt null_glob

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
LABEL="com.rileyg44.clear-skies-portal"
USER_ID=$(id -u)
AGENT_DIR="$HOME/Library/LaunchAgents"
DATA_DIR="$HOME/Library/Application Support/ClearSkiesPortal"
RUNTIME_DIR="$DATA_DIR/app"
LOG_DIR="$DATA_DIR/logs"
AGENT_FILE="$AGENT_DIR/$LABEL.plist"
CACHE_DIR=${CSP_CACHE_DIR:-"$DATA_DIR/cache"}
NODE_BIN=${CSP_NODE_BIN:-}

valid_node(){
  [[ -x "$1" ]] || return 1
  "$1" -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)' >/dev/null 2>&1
}
if [[ -z "$NODE_BIN" ]] || ! valid_node "$NODE_BIN"; then
  NODE_BIN=""
  for candidate in "$HOME"/.nvm/versions/node/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if valid_node "$candidate"; then NODE_BIN="$candidate"; break; fi
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  print -u2 "Install Node 22.12 or newer, then run this installer again."
  exit 78
fi

install -d -m 700 "$AGENT_DIR" "$DATA_DIR" "$RUNTIME_DIR" "$LOG_DIR" "$CACHE_DIR"
for asset in server.js terrain-pool.js terrain-worker.js usgs.js cog.js mosaic-core.js terrain-core.js terrain-raster.js \
             elevation-bands.js elevation-tile-core.js wa-archaeology.js glacial-research-core.js research-analysis.js research-worker.js index.html version.js sw.js manifest.json \
             icon-180.png icon-192.png icon-512.png sources.json LICENSE; do
  install -m 644 "$REPO_ROOT/$asset" "$RUNTIME_DIR/$asset"
done
install -m 700 "$SCRIPT_DIR/launch-terrain-engine.sh" "$RUNTIME_DIR/launch-terrain-engine.sh"

# A previous terminal-run engine may have valuable rendered tiles. Copy once
# into the launch-agent-safe cache outside the privacy-protected Documents tree.
LEGACY_CACHE="$HOME/Documents/clear-skies-portal/.cache"
if [[ -d "$LEGACY_CACHE" && ! -e "$CACHE_DIR/.legacy-imported" ]]; then
  # A warm cache can contain thousands of range chunks. It must not hold up
  # recovery; the engine can read whatever has arrived while the copy continues.
  (rsync -a --ignore-existing "$LEGACY_CACHE/" "$CACHE_DIR/" && touch "$CACHE_DIR/.legacy-imported") &!
fi

install -m 600 "$SCRIPT_DIR/com.rileyg44.clear-skies-portal.plist" "$AGENT_FILE"
plutil -replace ProgramArguments -xml "<array><string>/bin/zsh</string><string>$RUNTIME_DIR/launch-terrain-engine.sh</string></array>" "$AGENT_FILE"
plutil -replace WorkingDirectory -string "$RUNTIME_DIR" "$AGENT_FILE"
plutil -replace EnvironmentVariables.CSP_NODE_BIN -string "$NODE_BIN" "$AGENT_FILE"
plutil -replace EnvironmentVariables.CSP_CACHE_DIR -string "$CACHE_DIR" "$AGENT_FILE"
plutil -replace StandardOutPath -string "$LOG_DIR/terrain-engine.log" "$AGENT_FILE"
plutil -replace StandardErrorPath -string "$LOG_DIR/terrain-engine.error.log" "$AGENT_FILE"
plutil -lint "$AGENT_FILE"

launchctl bootout "gui/$USER_ID" "$AGENT_FILE" 2>/dev/null || true
launchctl bootstrap "gui/$USER_ID" "$AGENT_FILE"
launchctl kickstart -k "gui/$USER_ID/$LABEL"
print "Installed $LABEL with Node $NODE_BIN"
print "It listens only on 127.0.0.1:8765; Tailscale Serve is the secure remote bridge."
