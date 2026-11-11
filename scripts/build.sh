#!/usr/bin/env bash
# Builds installable plugin ZIPs into dist/
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/sync_guide.py
rm -f dist/*.zip
(cd wordpress-plugin && zip -qr ../dist/application-management-1.3.0.zip application-management -x '*.DS_Store')
(cd application && zip -qr ../dist/renewal-ledger-3.9.0.zip renewal-ledger -x '*.DS_Store')
cp index.html dist/PROCURE360.html
(cd application/standalone/windows && zip -qr ../../../dist/PROCURE360-Windows.zip RenewalLedger -x '*.DS_Store')
ls -l dist
