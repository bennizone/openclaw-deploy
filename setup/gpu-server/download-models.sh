#!/usr/bin/env bash
# Laedt die benoetigten Modelle auf den GPU-Server
# Ausfuehren auf dem GPU-Server via SSH
set -euo pipefail

MODELS_DIR="${MODELS_DIR:-$HOME/models}"
mkdir -p "$MODELS_DIR"

echo "=== Modell-Download ==="

# 1. bge-m3 Embedding-Modell
BGE_FILE="$MODELS_DIR/bge-m3-q8_0.gguf"
if [ -f "$BGE_FILE" ]; then
  echo "[OK] bge-m3-q8_0.gguf vorhanden ($(du -h "$BGE_FILE" | cut -f1))"
else
  echo "[...] Lade bge-m3-q8_0.gguf (~634MB)"
  curl -L --progress-bar -o "$BGE_FILE" \
    "https://huggingface.co/compilade/bge-m3-GGUF/resolve/main/bge-m3-q8_0.gguf"
  echo "[OK] bge-m3 heruntergeladen"
fi

# 2. Qwen 3.5 9B Chat-Modell
# HINWEIS: Die URL muss an das tatsaechliche HuggingFace-Repo angepasst werden
QWEN_FILE="$MODELS_DIR/Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf"
if [ -f "$QWEN_FILE" ]; then
  echo "[OK] Qwen 3.5 9B vorhanden ($(du -h "$QWEN_FILE" | cut -f1))"
else
  echo "[...] Lade Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf"
  echo "      HINWEIS: Pruefe die URL in config/versions.json"
  echo ""
  echo "      Falls der Download fehlschlaegt, manuell herunterladen:"
  echo "      huggingface-cli download <repo> <filename> --local-dir $MODELS_DIR"
  echo ""
  # Platzhalter-URL - muss im Onboarding angepasst werden
  # curl -L --progress-bar -o "$QWEN_FILE" "https://huggingface.co/..."
  echo "[SKIP] Bitte manuell herunterladen oder URL in diesem Script anpassen"
fi

echo ""
echo "=== Modell-Status ==="
ls -lh "$MODELS_DIR"/*.gguf 2>/dev/null || echo "Keine .gguf Modelle gefunden"
