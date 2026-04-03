#!/usr/bin/env bash
# aggregate-sessions.sh — Multi-Session-Aggregation + MiniMax Meta-Analyse
#
# Usage:
#   scripts/aggregate-sessions.sh [--since YYYY-MM-DD] [--dir DIR]
#
# Das Script:
#   1. Fuehrt aggregate-sessions.py --minimax aus
#   2. Sendet Ergebnis via consult-sdk.mjs reviewer an MiniMax
#   3. Gibt MiniMax-Antwort (Meta-Analyse) aus

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMPFILE=$(mktemp /tmp/aggregate-XXXXXX.txt)
trap 'rm -f "$TMPFILE"' EXIT

echo "=== Schritt 1: Sessions aggregieren ==="
python3 "$SCRIPT_DIR/aggregate-sessions.py" --minimax "$@" > "$TMPFILE"

if [[ ! -s "$TMPFILE" ]]; then
  echo "ERROR: Aggregation hat keine Daten geliefert"
  exit 1
fi

cat "$TMPFILE"
echo ""

echo "=== Schritt 2: MiniMax Meta-Analyse ==="
AGGREGATION=$(cat "$TMPFILE")

# Frage als separate Variable — vermeidet Shell-Expansion-Probleme
read -r -d '' QUESTION <<ENDQUESTION || true
Analysiere diese Multi-Session-Aggregation.

Finde:
1) Strukturelle Probleme — Errors die sich ueber Sessions wiederholen
2) Tool-Verteilungs-Anomalien — ungewoehnlich hoher Anteil bestimmter Tools
3) Waste-Muster — exploratorische Ketten, wiederholte Reads, Task-Overhead
4) Verbesserungsvorschlaege — konkrete Patches fuer Checklisten oder Workflows

Fuer jedes Problem: Beschreibe es und schlage einen Fix vor.
Format: 'In DATEI nach STELLE ergaenzen: TEXT'

--- Aggregation ---
${AGGREGATION}
ENDQUESTION

node "$SCRIPT_DIR/consult-sdk.mjs" --component reviewer --question "$QUESTION"
