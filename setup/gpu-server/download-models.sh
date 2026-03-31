#!/usr/bin/env bash
# Laedt die benoetigten Modelle auf den GPU-Server
# Ausfuehren auf dem GPU-Server via SSH
set -euo pipefail

MODELS_DIR="${MODELS_DIR:-$HOME/models}"
mkdir -p "$MODELS_DIR"

echo "=== Modell-Download ==="

# huggingface-cli pruefen (wird fuer grosse Downloads benoetigt)
if ! command -v huggingface-cli &>/dev/null; then
  echo "[WARN] huggingface-cli nicht gefunden. Installiere..."
  pip3 install --user "huggingface_hub[cli]"
  export PATH="$HOME/.local/bin:$PATH"
  if ! command -v huggingface-cli &>/dev/null; then
    echo "[FAIL] huggingface-cli konnte nicht installiert werden."
    echo "       pip3 install huggingface_hub[cli]"
    exit 1
  fi
  echo "[OK] huggingface-cli installiert"
fi

# 1. bge-m3 Embedding-Modell
BGE_FILE="$MODELS_DIR/bge-m3-q8_0.gguf"
if [ -f "$BGE_FILE" ]; then
  echo "[OK] bge-m3-q8_0.gguf vorhanden ($(du -h "$BGE_FILE" | cut -f1))"
else
  echo "[...] Lade bge-m3-q8_0.gguf (~634MB)"
  if curl -L --fail --progress-bar -o "$BGE_FILE" \
    "https://huggingface.co/compilade/bge-m3-GGUF/resolve/main/bge-m3-q8_0.gguf" 2>/dev/null; then
    echo "[OK] bge-m3 heruntergeladen (curl)"
  else
    echo "[...] curl fehlgeschlagen, versuche huggingface-cli"
    huggingface-cli download compilade/bge-m3-GGUF bge-m3-q8_0.gguf --local-dir "$MODELS_DIR"
    echo "[OK] bge-m3 heruntergeladen (huggingface-cli)"
  fi
fi

# 2. Qwen 3.5 9B Chat-Modell
QWEN_FILE="$MODELS_DIR/Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf"
if [ -f "$QWEN_FILE" ]; then
  echo "[OK] Qwen 3.5 9B vorhanden ($(du -h "$QWEN_FILE" | cut -f1))"
else
  echo "[...] Lade Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf (~5.6GB)"
  echo "      (Dies kann einige Minuten dauern)"
  huggingface-cli download \
    Jackrong/Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-v2-GGUF \
    Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf \
    --local-dir "$MODELS_DIR"
  echo "[OK] Qwen 3.5 9B heruntergeladen"
fi

echo ""
echo "=== Modell-Status ==="
ls -lh "$MODELS_DIR"/*.gguf 2>/dev/null || echo "Keine .gguf Modelle gefunden"
