#!/usr/bin/env bash
# Builds installable plugin ZIPs into dist/
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f dist/*.zip
(cd wordpress-plugin && zip -qr ../dist/application-management-1.0.0.zip application-management -x '*.DS_Store')
(cd application && zip -qr ../dist/renewal-ledger-2.0.0.zip renewal-ledger -x '*.DS_Store')
ls -l dist
