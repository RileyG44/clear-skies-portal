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

# A reinstall must not undo settings added to this Mac's service by hand, such
# as another port when something else holds 8765, health timing or
# CSP_MAINTAIN_TAILSCALE. The template still owns every key it sets.
kept=()
if [[ -f "$AGENT_FILE" ]]; then
  kept=(${(f)"$("$NODE_BIN" -e '
    const [installed,template]=process.argv.slice(1).map(json=>JSON.parse(json).EnvironmentVariables||{});
    for(const [key,value] of Object.entries(installed)) if(!(key in template)) console.log(`${key}=${value}`);
  ' "$(plutil -convert json -o - "$AGENT_FILE")" "$(plutil -convert json -o - "$SCRIPT_DIR/$LABEL.plist")")"})
fi
ENGINE_PORT=${CSP_ENGINE_PORT:-$(plutil -extract EnvironmentVariables.CSP_ENGINE_PORT raw "$AGENT_FILE" 2>/dev/null || print 8765)}
# Only a Clear Skies server may already hold the port. Anything else leaves the
# engine unable to bind behind a launch agent that still looks loaded.
for pid in $(lsof -nP -t -iTCP:"$ENGINE_PORT" -sTCP:LISTEN 2>/dev/null || true); do
  holder=$(ps -ww -o args= -p "$pid" 2>/dev/null || true)
  if [[ $holder != (*[\ /]|)server.js(\ *|) ]]; then
    print -u2 "Port $ENGINE_PORT is in use by pid $pid: $holder"
    print -u2 "Rerun with a free port, e.g. CSP_ENGINE_PORT=8770 $0. Later reinstalls keep it."
    exit 78
  fi
done

install -d -m 700 "$AGENT_DIR" "$DATA_DIR" "$RUNTIME_DIR" "$LOG_DIR" "$CACHE_DIR"
# site.json lists the app; the engine also needs its own Node modules.
for asset in $("$NODE_BIN" -e 'const s=require(process.argv[1]);console.log([...s.web,...s.app,...s.engine].filter(f=>!f.startsWith("vendor/")).join("\n"))' "$REPO_ROOT/site.json"); do
  install -d -m 755 "$RUNTIME_DIR/${asset:h}"
  install -m 644 "$REPO_ROOT/$asset" "$RUNTIME_DIR/$asset"
done
rm -rf "$RUNTIME_DIR/vendor"
cp -R "$REPO_ROOT/vendor" "$RUNTIME_DIR/vendor"
install -m 700 "$SCRIPT_DIR/launch-terrain-engine.sh" "$RUNTIME_DIR/launch-terrain-engine.sh"
install -m 700 "$SCRIPT_DIR/share-terrain-engine.sh" "$RUNTIME_DIR/share-terrain-engine.sh"

# A previous terminal-run engine may have valuable rendered tiles. Copy once
# into the launch-agent-safe cache outside the privacy-protected Documents tree.
LEGACY_CACHE="$HOME/Documents/clear-skies-portal/.cache"
if [[ -d "$LEGACY_CACHE" && ! -e "$CACHE_DIR/.legacy-imported" ]]; then
  # A warm cache can contain thousands of range chunks (measured: 1.8 GB in this
  # checkout). It must not hold up recovery; the engine can read whatever has
  # arrived while the copy continues.
  #
  # `&!` alone is not enough. It disowns the job, but the child still inherits
  # this shell's stdout, so anything that captures our output blocks until the
  # copy finishes - `install-mac-service.sh | tee log`, `$(...)`, or CI would
  # hang for as long as 1.8 GB takes, which is the opposite of the intent above.
  # Detach the child's stdio completely and record its outcome in a log instead.
  (
    if rsync -a --ignore-existing "$LEGACY_CACHE/" "$CACHE_DIR/"; then
      touch "$CACHE_DIR/.legacy-imported"
      print -r -- "legacy cache imported $(date +%FT%T)"
    else
      print -r -- "legacy cache import failed $(date +%FT%T) (recovery is unaffected; the engine rebuilds what it needs)"
    fi
  ) </dev/null >>"$LOG_DIR/legacy-import.log" 2>&1 &!
fi

install -m 600 "$SCRIPT_DIR/com.rileyg44.clear-skies-portal.plist" "$AGENT_FILE"
plutil -replace ProgramArguments -xml "<array><string>/bin/zsh</string><string>$RUNTIME_DIR/launch-terrain-engine.sh</string></array>" "$AGENT_FILE"
plutil -replace WorkingDirectory -string "$RUNTIME_DIR" "$AGENT_FILE"
plutil -replace EnvironmentVariables.CSP_NODE_BIN -string "$NODE_BIN" "$AGENT_FILE"
plutil -replace EnvironmentVariables.CSP_CACHE_DIR -string "$CACHE_DIR" "$AGENT_FILE"
plutil -replace StandardOutPath -string "$LOG_DIR/terrain-engine.log" "$AGENT_FILE"
plutil -replace StandardErrorPath -string "$LOG_DIR/terrain-engine.error.log" "$AGENT_FILE"
for setting in $kept; do
  plutil -replace "EnvironmentVariables.${setting%%=*}" -string "${setting#*=}" "$AGENT_FILE"
done
plutil -replace EnvironmentVariables.CSP_ENGINE_PORT -string "$ENGINE_PORT" "$AGENT_FILE"
plutil -lint "$AGENT_FILE"

launchctl bootout "gui/$USER_ID" "$AGENT_FILE" 2>/dev/null || true
launchctl bootstrap "gui/$USER_ID" "$AGENT_FILE"
launchctl kickstart -k "gui/$USER_ID/$LABEL"
print "Installed $LABEL with Node $NODE_BIN"
print "It listens only on 127.0.0.1:$ENGINE_PORT; Tailscale Serve is the secure remote bridge."
