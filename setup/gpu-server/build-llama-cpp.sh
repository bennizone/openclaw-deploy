#!/usr/bin/env bash
# Baut llama.cpp mit CUDA-Support auf dem GPU-Server
# Ausfuehren auf dem GPU-Server via SSH
set -euo pipefail

LLAMA_DIR="${LLAMA_DIR:-$HOME/llama.cpp}"

echo "=== llama.cpp Build (CUDA) ==="

# 1. Voraussetzungen pruefen
if ! command -v nvidia-smi &>/dev/null; then
  echo "[FAIL] nvidia-smi nicht gefunden. Bitte zuerst NVIDIA Treiber installieren."
  exit 1
fi

# GPU Compute Capability ermitteln → CUDA_ARCHITECTURES setzen
COMPUTE_CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader,nounits | head -1 | tr -d '[:space:]')
if [ -n "$COMPUTE_CAP" ]; then
  # Compute Capability in CUDA Architecture umrechnen (z.B. 7.5 → 75)
  CUDA_ARCH=$(echo "$COMPUTE_CAP" | tr -d '.')
  case "$CUDA_ARCH" in
    61) echo "[OK] GPU-Architektur: Pascal (sm_61, z.B. GTX 1080 Ti)" ;;
    75) echo "[OK] GPU-Architektur: Turing (sm_75, z.B. RTX 2070/2080)" ;;
    80) echo "[OK] GPU-Architektur: Ampere (sm_80, z.B. A100)" ;;
    86) echo "[OK] GPU-Architektur: Ampere (sm_86, z.B. RTX 3060/3090)" ;;
    89) echo "[OK] GPU-Architektur: Ada Lovelace (sm_89, z.B. RTX 4070/4090)" ;;
    *)  echo "[WARN] Unbekannte GPU-Architektur: sm_${CUDA_ARCH}. Nutze Fallback sm_80."
        CUDA_ARCH=80 ;;
  esac
else
  echo "[WARN] Konnte GPU Compute Capability nicht ermitteln. Nutze Fallback sm_80."
  CUDA_ARCH=80
fi
echo "     GGML_CUDA_ARCHITECTURES=${CUDA_ARCH}"

# CUDA Toolkit pruefen
if ! command -v nvcc &>/dev/null; then
  echo "[...] CUDA Toolkit nicht gefunden. Installiere..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq nvidia-cuda-toolkit
  echo "[OK] CUDA Toolkit installiert"
fi

# Build-Tools pruefen
for tool in cmake g++ git make; do
  if ! command -v $tool &>/dev/null; then
    echo "[...] Installiere $tool"
    sudo apt-get install -y -qq $tool
  fi
done

# Python3 + pip (fuer huggingface-cli in download-models.sh)
if ! command -v python3 &>/dev/null || ! command -v pip3 &>/dev/null; then
  echo "[...] Installiere python3-pip"
  sudo apt-get install -y -qq python3-pip
fi

# 2. Klonen/Updaten
if [ -d "$LLAMA_DIR" ]; then
  echo "[OK] llama.cpp bereits vorhanden"
  cd "$LLAMA_DIR"
  git pull --ff-only 2>/dev/null || echo "[WARN] Git pull fehlgeschlagen, nutze bestehende Version"
else
  echo "[...] Klone llama.cpp"
  git clone https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
  cd "$LLAMA_DIR"
fi

# 3. Bauen mit CUDA
if [ -f "$LLAMA_DIR/build/bin/llama-server" ]; then
  echo "[OK] llama-server bereits gebaut"
  echo "     Um neu zu bauen: rm -rf $LLAMA_DIR/build && dieses Script erneut ausfuehren"
else
  echo "[...] Baue llama.cpp mit CUDA fuer sm_${CUDA_ARCH} (das dauert einige Minuten)"
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=ON -DGGML_CUDA_ARCHITECTURES="${CUDA_ARCH}"
  cmake --build build --config Release -j$(nproc) --target llama-server
  echo "[OK] llama-server mit CUDA gebaut"
fi

# 4. Testen
echo ""
"$LLAMA_DIR/build/bin/llama-server" --version 2>/dev/null || true
echo ""
echo "[OK] llama.cpp bereit"
echo "     Binary: $LLAMA_DIR/build/bin/llama-server"
