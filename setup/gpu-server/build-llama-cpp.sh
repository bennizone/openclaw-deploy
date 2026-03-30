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

# CUDA Toolkit pruefen
if ! command -v nvcc &>/dev/null; then
  echo "[...] CUDA Toolkit nicht gefunden. Installiere..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq nvidia-cuda-toolkit
  echo "[OK] CUDA Toolkit installiert"
fi

# Build-Tools pruefen
for tool in cmake g++ git; do
  if ! command -v $tool &>/dev/null; then
    echo "[...] Installiere $tool"
    sudo apt-get install -y -qq $tool
  fi
done

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
  echo "[...] Baue llama.cpp mit CUDA (das dauert einige Minuten)"
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=ON
  cmake --build build --config Release -j$(nproc) --target llama-server
  echo "[OK] llama-server mit CUDA gebaut"
fi

# 4. Testen
echo ""
"$LLAMA_DIR/build/bin/llama-server" --version 2>/dev/null || true
echo ""
echo "[OK] llama.cpp bereit"
echo "     Binary: $LLAMA_DIR/build/bin/llama-server"
