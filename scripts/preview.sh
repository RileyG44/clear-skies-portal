#!/bin/zsh
# A private, non-live copy of the portal for reviewing UI changes before they
# ship. It runs any branch from its own worktree, on its own port, cache and
# launch agent, and publishes it on the tailnet at
#
#     https://<this-mac>.<tailnet>.ts.net:8443/
#
# The live engine (launch agent com.rileyg44.clear-skies-portal on 127.0.0.1:8765,
# published by `tailscale serve --bg 8765` on :443) and GitHub Pages are never
# touched: nothing here reads or writes their port, cache, agent or serve entry.
#
#   scripts/preview.sh up [branch]   check out a branch (default: this checkout's) and publish it
#   scripts/preview.sh update        fetch the same branch again and restart
#   scripts/preview.sh status        what is running, which commit, and the URL
#   scripts/preview.sh logs          follow the preview engine's log
#   scripts/preview.sh down          stop it and remove the :8443 entry (keeps the cache)
#   scripts/preview.sh purge         down, then delete the preview checkout and cache
set -euo pipefail
setopt null_glob

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
LABEL="com.rileyg44.clear-skies-portal.preview"
USER_ID=$(id -u)
AGENT_FILE="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA_DIR=${CSP_PREVIEW_DIR:-"$HOME/Library/Application Support/ClearSkiesPortal-preview"}
CHECKOUT="$DATA_DIR/checkout"
CACHE_DIR=${CSP_PREVIEW_CACHE_DIR:-"$DATA_DIR/cache"}
LOG_DIR="$DATA_DIR/logs"
REF_FILE="$DATA_DIR/ref"
PREVIEW_PORT=${CSP_PREVIEW_PORT:-8766}
PREVIEW_HTTPS_PORT=${CSP_PREVIEW_HTTPS_PORT:-8443}
LIVE_PORT=8765

die(){ print -u2 -- "preview: $*"; exit 1 }

# The one guarantee this script makes is that it cannot collide with the live
# copy. Refuse any configuration that would.
[[ "$PREVIEW_PORT" == <1024-65535> ]] || die "CSP_PREVIEW_PORT must be a port number"
[[ "$PREVIEW_PORT" != "$LIVE_PORT" ]] || die "port $LIVE_PORT belongs to the live engine"
[[ "$PREVIEW_HTTPS_PORT" != 443 ]] || die "https port 443 carries the live bridge"
[[ "$CACHE_DIR" != *"/ClearSkiesPortal/cache"* ]] || die "the preview must not share the live cache"

tailscale_bin(){
  if command -v tailscale >/dev/null 2>&1; then command -v tailscale
  elif [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then print /Applications/Tailscale.app/Contents/MacOS/Tailscale
  else return 1; fi
}

valid_node(){
  [[ -x "$1" ]] || return 1
  "$1" -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)' >/dev/null 2>&1
}
find_node(){
  local candidate
  for candidate in "${CSP_NODE_BIN:-}" "$(command -v node 2>/dev/null || true)" "$HOME"/.nvm/versions/node/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -n "$candidate" ]] && valid_node "$candidate"; then print -r -- "$candidate"; return 0; fi
  done
  return 1
}

preview_url(){
  local ts dns
  ts=$(tailscale_bin) || return 1
  dns=$("$ts" status --json 2>/dev/null | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write((JSON.parse(s).Self.DNSName||"").replace(/\.$/,""))}catch{}})') || return 1
  [[ -n "$dns" ]] || return 1
  print -r -- "https://$dns:$PREVIEW_HTTPS_PORT/"
}

wait_for_health(){
  local i body
  for i in {1..60}; do
    body=$(curl --silent --max-time 2 "http://127.0.0.1:$PREVIEW_PORT/api/health" 2>/dev/null || true)
    if [[ "$body" == *'"channel":"preview"'* ]]; then return 0; fi
    if [[ "$body" == *'"ok":true'* ]]; then
      stop_agent
      die "that branch predates preview support (its server.js reports no channel); merge main into it first"
    fi
    if [[ -n "$body" ]]; then die "something other than a preview engine answers on port $PREVIEW_PORT"; fi
    sleep 0.5
  done
  die "the preview engine did not start; see $LOG_DIR/preview-engine.error.log"
}

stop_agent(){ launchctl bootout "gui/$USER_ID" "$AGENT_FILE" 2>/dev/null || true }

checkout_ref(){
  local ref=$1 commit
  git -C "$REPO_ROOT" fetch --quiet origin "$ref" 2>/dev/null || print -u2 "preview: could not fetch origin/$ref; using the local copy"
  commit=$(git -C "$REPO_ROOT" rev-parse --verify --quiet "origin/$ref^{commit}" 2>/dev/null ||
           git -C "$REPO_ROOT" rev-parse --verify --quiet "$ref^{commit}" 2>/dev/null) || die "unknown branch or commit: $ref"
  install -d -m 700 "$DATA_DIR"
  if [[ -e "$CHECKOUT/.git" ]]; then
    # A managed checkout: local edits here are never intentional, so a forced
    # detached checkout is the correct way to move it.
    git -C "$CHECKOUT" checkout --quiet --force --detach "$commit"
  else
    git -C "$REPO_ROOT" worktree prune
    git -C "$REPO_ROOT" worktree add --quiet --detach "$CHECKOUT" "$commit"
  fi
  [[ -f "$CHECKOUT/scripts/launch-terrain-engine.sh" ]] || die "$ref has no scripts/launch-terrain-engine.sh to run"
  print -r -- "$ref" >| "$REF_FILE"
  print -r -- "$commit"
}

start_agent(){
  local ref=$1 commit=$2
  install -d -m 700 "$HOME/Library/LaunchAgents" "$LOG_DIR" "$CACHE_DIR"
  # Start from the live agent's template for the same KeepAlive and resource
  # settings, then give it its own label, program, port, cache and logs.
  install -m 600 "$SCRIPT_DIR/com.rileyg44.clear-skies-portal.plist" "$AGENT_FILE"
  plutil -replace Label -string "$LABEL" "$AGENT_FILE"
  plutil -replace ProgramArguments -xml "<array><string>/bin/zsh</string><string>$CHECKOUT/scripts/launch-terrain-engine.sh</string></array>" "$AGENT_FILE"
  plutil -replace WorkingDirectory -string "$CHECKOUT" "$AGENT_FILE"
  plutil -replace EnvironmentVariables.CSP_NODE_BIN -string "$NODE_BIN" "$AGENT_FILE"
  plutil -replace EnvironmentVariables.CSP_CACHE_DIR -string "$CACHE_DIR" "$AGENT_FILE"
  plutil -replace EnvironmentVariables.CSP_ENGINE_PORT -string "$PREVIEW_PORT" "$AGENT_FILE"
  plutil -replace EnvironmentVariables.CSP_CHANNEL -string preview "$AGENT_FILE"
  plutil -replace EnvironmentVariables.CSP_PREVIEW_REF -string "$ref @ ${commit[1,8]}" "$AGENT_FILE"
  # Half the live engine's workers: the preview is for looking, not for batch
  # terrain downloads, and must not starve the live engine on the same Mac.
  plutil -replace EnvironmentVariables.CSP_TERRAIN_WORKERS -string 3 "$AGENT_FILE"
  plutil -replace StandardOutPath -string "$LOG_DIR/preview-engine.log" "$AGENT_FILE"
  plutil -replace StandardErrorPath -string "$LOG_DIR/preview-engine.error.log" "$AGENT_FILE"
  plutil -lint "$AGENT_FILE" >/dev/null
  stop_agent
  launchctl bootstrap "gui/$USER_ID" "$AGENT_FILE"
  launchctl kickstart -k "gui/$USER_ID/$LABEL"
}

publish(){
  local ts
  ts=$(tailscale_bin) || { print -u2 "preview: Tailscale CLI not found; the preview is running at http://127.0.0.1:$PREVIEW_PORT only"; return 0 }
  # Its own HTTPS port on the same machine name, tailnet-only. Serve keeps one
  # handler per port, so this cannot replace the live :443 entry. Never Funnel.
  "$ts" serve --bg --https="$PREVIEW_HTTPS_PORT" "http://127.0.0.1:$PREVIEW_PORT" >/dev/null
}

cmd=${1:-status}
case "$cmd" in
  up|update)
    NODE_BIN=$(find_node) || die "install Node 22.12 or newer"
    if [[ "$cmd" == update ]]; then
      [[ -f "$REF_FILE" ]] || die "nothing to update; run: scripts/preview.sh up <branch>"
      ref=$(<"$REF_FILE")
    else
      ref=${2:-$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)}
    fi
    commit=$(checkout_ref "$ref")
    start_agent "$ref" "$commit"
    wait_for_health
    publish
    print "Preview of $ref (${commit[1,8]}) is running."
    if url=$(preview_url); then print "Open it on any device signed in to your tailnet:\n  $url"
    else print "Local address: http://127.0.0.1:$PREVIEW_PORT/"; fi
    ;;
  status)
    NODE_BIN=$(find_node) || NODE_BIN=node
    if launchctl print "gui/$USER_ID/$LABEL" >/dev/null 2>&1; then
      print "Preview agent: loaded"
      if [[ -f "$REF_FILE" ]]; then print "Branch:        $(<"$REF_FILE") @ $(git -C "$CHECKOUT" rev-parse --short HEAD 2>/dev/null)"; fi
      if curl --silent --max-time 2 "http://127.0.0.1:$PREVIEW_PORT/api/health" | grep -q '"channel":"preview"'; then print "Engine:        healthy on 127.0.0.1:$PREVIEW_PORT"
      else print "Engine:        not answering on 127.0.0.1:$PREVIEW_PORT"; fi
      if url=$(preview_url); then print "URL:           $url"; fi
    else
      print "Preview agent: not running (start it with: scripts/preview.sh up [branch])"
    fi
    ;;
  logs)
    tail -n 50 -F "$LOG_DIR/preview-engine.log" "$LOG_DIR/preview-engine.error.log"
    ;;
  down|purge)
    if ts=$(tailscale_bin); then "$ts" serve --https="$PREVIEW_HTTPS_PORT" off >/dev/null 2>&1 || true; fi
    stop_agent
    rm -f "$AGENT_FILE"
    print "Preview stopped. The live portal was not touched."
    if [[ "$cmd" == purge ]]; then
      [[ -e "$CHECKOUT" ]] && git -C "$REPO_ROOT" worktree remove --force "$CHECKOUT" 2>/dev/null || true
      rm -rf "$CHECKOUT" "$CACHE_DIR" "$REF_FILE"
      git -C "$REPO_ROOT" worktree prune
      print "Removed the preview checkout and cache."
    fi
    ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    exit 64
    ;;
esac
