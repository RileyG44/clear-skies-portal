#!/bin/bash
# Double-click this file to start Clear Skies Portal and open it in your browser.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install it from https://nodejs.org (v18 or newer), then run this again."
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
