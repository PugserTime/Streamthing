#!/usr/bin/env bash
# Run as your normal user (NOT root). Needs sudo only for apt + systemd.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/media-center}"; cd "$APP_DIR"
command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "Install Node 22+ (arm64) first, e.g. via https://nodejs.org/en/download or NodeSource"; exit 1; }
[ -f .env ] || cp .env.example .env
npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
npm run build
sed "s|__USER__|$USER|g; s|__DIR__|$APP_DIR|g; s|__NODE__|$(command -v node)|g" deploy/media-center.service | sudo tee /etc/systemd/system/media-center.service >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now media-center
echo "Running: http://127.0.0.1:8080   logs: journalctl -u media-center -f"
echo "Optional kiosk: see deploy/kiosk.md"
