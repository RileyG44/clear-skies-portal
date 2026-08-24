#!/bin/zsh
# Keeps the private terrain engine alive behind Tailscale Serve. The service is
# deliberately bound to loopback: Tailscale is the only network-facing bridge.
set -u -o pipefail
setopt null_glob

SCRIPT_DIR=${0:A:h}
if [[ -f "$SCRIPT_DIR/server.js" ]]; then
  REPO_ROOT=$SCRIPT_DIR                 # installed runtime in Application Support
else
  REPO_ROOT=${SCRIPT_DIR:h}             # source checkout's scripts/ directory
fi
ENGINE_PORT=${CSP_ENGINE_PORT:-8765}
ENGINE_CACHE=${CSP_CACHE_DIR:-"$REPO_ROOT/.cache"}
NODE_BIN=${CSP_NODE_BIN:-}
ENGINE_PID=""
CHECK_INTERVAL=${CSP_HEALTH_INTERVAL:-20}
CHECK_TIMEOUT=${CSP_HEALTH_TIMEOUT:-6}
MAX_HEALTH_MISSES=${CSP_MAX_HEALTH_MISSES:-3}

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
  print -u2 "Clear Skies Portal needs Node 22.12 or newer."
  exit 78
fi

stop_engine(){
  [[ -n "$ENGINE_PID" ]] && kill -TERM "$ENGINE_PID" 2>/dev/null || true
  [[ -n "$ENGINE_PID" ]] && wait "$ENGINE_PID" 2>/dev/null || true
  exit 0
}
trap stop_engine INT TERM HUP

while true; do
  HOST=127.0.0.1 PORT="$ENGINE_PORT" CSP_CACHE_DIR="$ENGINE_CACHE" "$NODE_BIN" "$REPO_ROOT/server.js" &
  ENGINE_PID=$!
  health_misses=0
  while kill -0 "$ENGINE_PID" 2>/dev/null; do
    sleep "$CHECK_INTERVAL"
    if curl --fail --silent --show-error --max-time "$CHECK_TIMEOUT" "http://127.0.0.1:${ENGINE_PORT}/api/health" >/dev/null 2>&1; then
      health_misses=0
    else
      ((health_misses++))
      if (( health_misses >= MAX_HEALTH_MISSES )); then
        # Rendering runs in replaceable workers, so an unresponsive coordinator
        # is unhealthy even when CPU use is high. Restart after about a minute.
        print -u2 "Terrain engine missed ${health_misses} health checks; restarting it."
        kill -TERM "$ENGINE_PID" 2>/dev/null || true
      fi
    fi
  done
  wait "$ENGINE_PID" 2>/dev/null || true
  ENGINE_PID=""
  sleep 2
done
