#!/bin/zsh
# Share only Clear Skies API namespaces. Preserve T3 Code and all other Serve
# handlers, including the root page. The hosted portal uses these APIs directly.
set -euo pipefail
SCRIPT_DIR=${0:A:h}
NODE_BIN=${CSP_NODE_BIN:-node}
TAILSCALE_BIN=$(command -v tailscale || true)
if [[ -z "$TAILSCALE_BIN" ]]; then
  for candidate in /usr/local/bin/tailscale /opt/homebrew/bin/tailscale; do
    if [[ -x "$candidate" ]]; then TAILSCALE_BIN=$candidate; break; fi
  done
fi
[[ -n "$TAILSCALE_BIN" ]] || exit 0
if [[ "${1:-}" == "--check" ]]; then
  # Inspect local Serve state, not a network endpoint. This runs only for a
  # supervisor explicitly configured with CSP_MAINTAIN_TAILSCALE=1.
  config=$("$TAILSCALE_BIN" serve status --json) || exit 0
  if print -r -- "$config" | "$NODE_BIN" -e '
    let text="";process.stdin.on("data",v=>text+=v).on("end",()=>{
      try{
        const config=JSON.parse(text),web=Object.entries(config.Web||{}).find(([key])=>key.endsWith(":443"));
        const handlers=web?.[1]?.Handlers||{},base="http://127.0.0.1:"+(process.env.CSP_ENGINE_PORT||8765);
        const paths=["health","terrain","snapshot","wadnr","3dep","firms","warm","usgs","elev","geo","snow","markup"];
        process.exit(paths.every(name=>handlers["/api/"+name]?.Proxy===base+"/api/"+name)?0:1);
      }catch{process.exit(0);}
    });'; then exit 0; fi
fi
for namespace in health terrain snapshot wadnr 3dep firms warm usgs elev geo snow markup; do
  "$TAILSCALE_BIN" serve --bg --https=443 --set-path="/api/$namespace" \
    "http://127.0.0.1:${CSP_ENGINE_PORT:-8765}/api/$namespace" >/dev/null
done
if [[ "${1:-}" != "--check" ]]; then "$TAILSCALE_BIN" serve status; fi
