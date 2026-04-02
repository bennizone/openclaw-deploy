#!/usr/bin/env bash
# Erkennt NVIDIA GPU und installiert Treiber
# Ausfuehren auf dem GPU-Server via SSH
set -euo pipefail

echo "=== NVIDIA GPU Erkennung ==="

# 1. GPU erkennen
if command -v nvidia-smi &>/dev/null; then
  echo "[OK] NVIDIA Treiber bereits installiert"
  nvidia-smi --query-gpu=name,memory.total,memory.free,compute_cap,driver_version --format=csv,noheader
  echo ""

  # VRAM-Info fuer Onboarding
  VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 | tr -d '[:space:]')
  COMPUTE_CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | head -1 | tr -d '[:space:]')
  echo "[INFO] VRAM: ${VRAM_MB} MiB ($((VRAM_MB / 1024)) GB)"
  echo "[INFO] Compute Capability: ${COMPUTE_CAP}"
  if [ "$VRAM_MB" -le 8192 ] 2>/dev/null; then
    echo "[INFO] Empfohlene ctx-size: 32768 (<=8 GB VRAM, konservativ)"
  else
    echo "[INFO] Empfohlene ctx-size: 196608 (>8 GB VRAM, aggressiv)"
  fi

  # Ollama-Check: belegt VRAM und kann mit llama.cpp kollidieren
  if systemctl is-active --quiet ollama 2>/dev/null || pgrep -x ollama &>/dev/null; then
    echo ""
    echo "[WARN] Ollama laeuft! Ollama belegt GPU-VRAM und Port 11434."
    echo "       Zwei GPU-Inferenz-Engines gleichzeitig koennen zu OOM-Crashes fuehren."
    echo "       Deaktiviere Ollama mit:"
    echo "         sudo systemctl stop ollama && sudo systemctl disable ollama"
  fi

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
