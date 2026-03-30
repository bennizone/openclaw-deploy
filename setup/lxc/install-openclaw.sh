#!/usr/bin/env bash
# Installiert OpenClaw und richtet den systemd Service ein
set -euo pipefail

echo "=== OpenClaw Installation ==="

# 1. OpenClaw installieren
if command -v openclaw &>/dev/null; then
  CURRENT_VERSION=$(openclaw --version 2>/dev/null || echo "unbekannt")
  echo "[OK] OpenClaw bereits installiert (Version: $CURRENT_VERSION)"
else
  echo "[...] Installiere OpenClaw"
  npm install -g openclaw
  echo "[OK] OpenClaw installiert ($(openclaw --version))"
fi

# 2. OpenClaw State-Verzeichnis
mkdir -p ~/.openclaw
echo "[OK] State-Verzeichnis: ~/.openclaw"

# 3. systemd Service
SYSTEMD_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SYSTEMD_DIR/openclaw-gateway.service"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mkdir -p "$SYSTEMD_DIR"

if [ -f "$SERVICE_FILE" ]; then
  echo "[OK] systemd Service existiert bereits"
else
  cp "$REPO_DIR/setup/lxc/systemd/openclaw-gateway.service.template" "$SERVICE_FILE"
  systemctl --user daemon-reload
  systemctl --user enable openclaw-gateway.service
  echo "[OK] systemd Service installiert + aktiviert"
fi

# 4. Service starten (nur wenn nicht schon laeuft)
if systemctl --user is-active openclaw-gateway.service &>/dev/null; then
  echo "[OK] OpenClaw Gateway laeuft bereits"
else
  echo "[...] Starte OpenClaw Gateway"
  systemctl --user start openclaw-gateway.service
  sleep 3
  if systemctl --user is-active openclaw-gateway.service &>/dev/null; then
    echo "[OK] OpenClaw Gateway gestartet (Port 18789)"
  else
    echo "[FAIL] Gateway konnte nicht gestartet werden"
    journalctl --user -u openclaw-gateway.service --no-pager -n 20
    exit 1
  fi
fi

echo ""
echo "Gateway: http://localhost:18789"
echo "Logs:    journalctl --user -u openclaw-gateway.service -f"
