#!/bin/bash
# Double-click this file to start Clear Skies Portal and open it in your browser.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' 2>/dev/null; then
  echo "Node.js 22.12 or newer is required. Install the current LTS from https://nodejs.org, then run this again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
node server.js &
SERVER_PID=$!
sleep 1
open "http://localhost:8765"
echo
echo "Clear Skies Portal is running at http://localhost:8765"
echo "Close this window (or press Ctrl-C) to stop the server."
echo
wait $SERVER_PID
