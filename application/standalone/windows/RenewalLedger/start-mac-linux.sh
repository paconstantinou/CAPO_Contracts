#!/bin/sh
# Opens Renewal Ledger in its own app-style window (Chrome, Edge or Chromium required).
DIR="$(cd "$(dirname "$0")" && pwd)"
DATA="$HOME/.renewal-ledger/data"
URL="file://$DIR/app/index.html"
mkdir -p "$DATA"
for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable; do
  if command -v "$b" >/dev/null 2>&1; then
    exec "$b" --app="$URL" --user-data-dir="$DATA" --no-first-run --no-default-browser-check
  fi
done
for app in "/Applications/Google Chrome.app" "/Applications/Microsoft Edge.app" "/Applications/Chromium.app"; do
  if [ -d "$app" ]; then
    exec open -na "$app" --args --app="$URL" --user-data-dir="$DATA" --no-first-run --no-default-browser-check
  fi
done
echo "Chrome, Edge or Chromium was not found."
exit 1
