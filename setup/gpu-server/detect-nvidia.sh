#!/usr/bin/env bash
# Erkennt NVIDIA GPU und installiert Treiber
# Ausfuehren auf dem GPU-Server via SSH
set -euo pipefail

echo "=== NVIDIA GPU Erkennung ==="

# 1. GPU erkennen
if command -v nvidia-smi &>/dev/null; then
  echo "[OK] NVIDIA Treiber bereits installiert"
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
  exit 0
fi

# 2. PCI-Geraete pruefen
echo "[...] Suche nach NVIDIA GPUs"
if lspci | grep -i nvidia; then
  echo "[OK] NVIDIA GPU gefunden"
else
  echo "[FAIL] Keine NVIDIA GPU erkannt"
  echo "       Bitte pruefen: lspci | grep -i nvidia"
  exit 1
fi

# 3. Treiber installieren
echo ""
echo "NVIDIA Treiber muessen installiert werden."
echo "Empfohlene Methode (Ubuntu 24.04+):"
echo ""
echo "  sudo apt update"
echo "  sudo apt install -y nvidia-driver-560"
echo "  sudo reboot"
echo ""
echo "Nach dem Reboot: nvidia-smi"
echo ""
echo "HINWEIS: Die Treiber-Version (560) kann je nach GPU variieren."
echo "         Fuer GTX 1080 Ti ist 560+ empfohlen."
echo "         Alternativ: sudo ubuntu-drivers install"
