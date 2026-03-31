#!/usr/bin/env bash
# Baut llama.cpp und richtet den CPU-Embedding-Fallback ein
set -euo pipefail

MODELS_DIR="${MODELS_DIR:-$HOME/models}"
LLAMA_DIR="${LLAMA_DIR:-$HOME/llama.cpp}"

echo "=== llama.cpp Embedding Fallback (CPU) ==="

# 0. Voraussetzungen pruefen
for dep in cmake g++ make; do
  if ! command -v $dep &>/dev/null; then
    echo "[FAIL] '$dep' nicht gefunden. Bitte zuerst bootstrap.sh ausfuehren oder:"
    echo "       sudo apt install -y build-essential cmake"
    exit 1
  fi
done

# 1. llama.cpp klonen/updaten
if [ -d "$LLAMA_DIR" ]; then
  echo "[OK] llama.cpp bereits vorhanden"
else
  echo "[...] Klone llama.cpp"
  git clone https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
  echo "[OK] llama.cpp geklont"
fi

# 2. Bauen (CPU only)
if [ -f "$LLAMA_DIR/build/bin/llama-server" ]; then
  echo "[OK] llama-server bereits gebaut"
else
  echo "[...] Baue llama.cpp (CPU)"
  cd "$LLAMA_DIR"
  cmake -B build -DCMAKE_BUILD_TYPE=Release
  cmake --build build --config Release -j$(nproc) --target llama-server
  echo "[OK] llama-server gebaut"
fi

# 3. Modell downloaden
mkdir -p "$MODELS_DIR"
MODEL_FILE="$MODELS_DIR/bge-m3-q8_0.gguf"
if [ -f "$MODEL_FILE" ]; then
  echo "[OK] bge-m3 Modell vorhanden ($(du -h "$MODEL_FILE" | cut -f1))"
else
  echo "[...] Lade bge-m3-q8_0.gguf herunter (~634MB)"
  echo "      (Dies kann einige Minuten dauern)"
  # URL muss ggf. angepasst werden - siehe config/versions.json
  curl -L -o "$MODEL_FILE" \
    "https://huggingface.co/compilade/bge-m3-GGUF/resolve/main/bge-m3-q8_0.gguf"
  echo "[OK] bge-m3 Modell heruntergeladen"
fi

# 4. systemd Service
SYSTEMD_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SYSTEMD_DIR/llama-embed-fallback.service"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

mkdir -p "$SYSTEMD_DIR"

if [ -f "$SERVICE_FILE" ]; then
  echo "[OK] systemd Service existiert bereits"
else
  cp "$REPO_DIR/setup/lxc/systemd/llama-embed-fallback.service.template" "$SERVICE_FILE"
  systemctl --user daemon-reload
  systemctl --user enable llama-embed-fallback.service
  echo "[OK] systemd Service installiert + aktiviert"
fi

# 5. Starten
if systemctl --user is-active llama-embed-fallback.service &>/dev/null; then
  echo "[OK] Embedding-Fallback laeuft bereits"
else
  echo "[...] Starte Embedding-Fallback"
  systemctl --user start llama-embed-fallback.service
  sleep 5
  if curl -sf http://localhost:8081/health > /dev/null 2>&1; then
    echo "[OK] Embedding-Fallback laeuft auf Port 8081"
  else
    echo "[WARN] Embedding-Fallback antwortet noch nicht (CPU-Start kann langsam sein)"
    echo "       Pruefe spaeter: curl http://localhost:8081/health"
  fi
fi
