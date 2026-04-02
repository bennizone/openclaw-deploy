#!/usr/bin/env bash
# reflect-auto.sh — Automatisierte Session-Reflection via MiniMax
#
# Usage:
#   reflect-auto.sh <session.jsonl> [--output-dir <dir>]
#
# Führt die /reflect Analyse durch mit minimalen Claude-Tokens:
# 1. Tool-Calls extrahieren (Python)
# 2. Orchestrator Self-Audit (Python)
# 3. Session-Analyse via MiniMax (chunked)
# 4. Autonomie-Metriken aktualisieren
# 5. Ergebnis-Datei schreiben für Claude-Review
#
# Output: <output-dir>/reflect-result.md

set -euo pipefail

JSONL="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/reflect-$$}"

if [[ -z "$JSONL" ]]; then
  echo "Usage: reflect-auto.sh <session.jsonl> [--output-dir <dir>]"
  echo ""
  echo "Output files (in OUTPUT_DIR):"
  echo "  reflect-result.md  — Hauptdatei mit kompletter Analyse"
  echo "  calls.txt          — Extrahierte Tool-Calls"
  echo "  audit.txt          — Orchestrator Self-Audit"
  echo "  analysis.txt       — MiniMax Token-Waste Analyse"
  echo "  usage.log          — MiniMax Request-Log"
  echo ""
  echo "WICHTIG: Keine Datei 'reflect-result.md' im /tmp/reflect-test/ suchen!"
  exit 1
fi

# Parse remaining args
shift 1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done

mkdir -p "$OUTPUT_DIR"
USAGE_LOG="$OUTPUT_DIR/usage.log"

echo "=== reflect-auto.sh ===" >&2
echo "Session: $JSONL" >&2
echo "Output: $OUTPUT_DIR" >&2

# --- Schritt 1: Tool-Calls extrahieren ---
echo "Schritt 1: Tool-Calls extrahieren..." >&2
python3 "$SCRIPT_DIR/extract-session-calls.py" "$JSONL" --max-result-len 200 \
  > "$OUTPUT_DIR/calls.txt"

TOTAL=$(head -5 "$OUTPUT_DIR/calls.txt" | grep -oP '\d+ total' | grep -oP '\d+' || echo "?")
ERRORS=$(head -5 "$OUTPUT_DIR/calls.txt" | grep -oP 'Errors: \d+' | grep -oP '\d+' || echo "?")
echo "  → $TOTAL Calls, $ERRORS Errors" >&2

# --- Schritt 2: Orchestrator Self-Audit ---
echo "Schritt 2: Orchestrator Self-Audit..." >&2
python3 "$SCRIPT_DIR/orchestrator-audit.py" "$JSONL" \
  > "$OUTPUT_DIR/audit.txt" 2>&1 || true

VIOLATIONS=$(grep -c "^| [0-9]" "$OUTPUT_DIR/audit.txt" 2>/dev/null || echo "0")
echo "  → $VIOLATIONS Violations" >&2

# --- Schritt 3: MiniMax-Analyse (chunked) ---
echo "Schritt 3: MiniMax-Analyse (chunked)..." >&2

MAP_PROMPT="Analysiere diesen Ausschnitt einer Claude Code Session auf Token-Waste.

Finde:
1) Fehlgeschlagene Calls — wo haette die Info stehen muessen?
2) Wiederholte Reads gleicher Datei — warum nicht beim ersten Mal?
3) Exploratorische Ketten (ls, grep, head) — was fehlte?
4) Bekannte Fehler wiederholt — wo war es dokumentiert?

Fuer jedes Pattern: Schlage einen konkreten Patch vor.
Format: 'In DATEI nach STELLE ergaenzen: TEXT'
Falls kein Fix moeglich: 'KEIN FIX — <Grund>'"

REDUCE_PROMPT="Du bekommst Teilergebnisse einer Token-Waste-Analyse. Jedes Teilergebnis analysiert einen anderen Abschnitt derselben Session.

DEINE AUFGABE: Konsolidiere zu EINER Gesamtanalyse. Antworte NUR mit dem Ergebnis, stelle KEINE Rueckfragen.

1) Entferne Redundanzen (gleiches Pattern in mehreren Chunks = 1x listen)
2) Pruefe Cross-Chunk-Patterns (Error in Teil 1 + Fix-Versuch in Teil 3 = zusammengehoeriges Pattern)
3) Erstelle finale Patch-Tabelle:
   | # | Pattern | Betroffene Datei | Vorgeschlagener Patch |
4) Erstelle fertige workflow-patterns.md Zeilen:
   | Datum | Feature | Pattern | Fix | Status | Anzahl |
5) Liste betroffene Komponenten-Namen (nur Namen, kommasepariert)"

"$SCRIPT_DIR/consult-agent.sh" reviewer \
  "$MAP_PROMPT" \
  --input-file "$OUTPUT_DIR/calls.txt" \
  --reduce-prompt "$REDUCE_PROMPT" \
  --usage-log "$USAGE_LOG" \
  --overlap 5 \
  > "$OUTPUT_DIR/analysis.txt" 2>"$OUTPUT_DIR/chunking.log"

echo "  → Analyse fertig ($(wc -l < "$OUTPUT_DIR/analysis.txt") Zeilen)" >&2

# --- Schritt 4: Autonomie-Komponenten erkennen ---
echo "Schritt 4: Autonomie-Updates..." >&2

# Bekannte Komponenten aus dem Repo lesen
KNOWN_COMPONENTS=$(ls -1 "$REPO_DIR/components/" 2>/dev/null | tr '\n' '|' | sed 's/|$//')
COMPONENTS=$(grep -oP "components/($KNOWN_COMPONENTS)/" "$OUTPUT_DIR/calls.txt" 2>/dev/null | grep -oP 'components/\K[^/]+' | sort -u || true)
AUTONOMY_LOG=""
if [[ -n "$COMPONENTS" ]]; then
  echo "  Betroffene Komponenten: $COMPONENTS" >&2
  for comp in $COMPONENTS; do
    if python3 "$SCRIPT_DIR/autonomy-status.py" status 2>/dev/null | grep -q "\"$comp\""; then
      result=$(python3 "$SCRIPT_DIR/autonomy-status.py" record "$comp" 2>&1 | head -1)
      AUTONOMY_LOG="$AUTONOMY_LOG\n- $result"
      echo "  $result" >&2
    fi
  done
fi

PROMOTIONS=$(python3 "$SCRIPT_DIR/autonomy-status.py" suggest-promotions 2>&1)
echo "  $PROMOTIONS" >&2

# --- Schritt 5: Ergebnis-Datei zusammenbauen ---
echo "Schritt 5: Ergebnis schreiben..." >&2

{
  echo "# /reflect Ergebnis (automatisiert)"
  echo ""
  echo "## Statistik"
  echo "- **Session:** $(basename "$JSONL")"
  echo "- **Total Calls:** $TOTAL"
  echo "- **Errors:** $ERRORS"
  echo "- **Violations:** $VIOLATIONS"
  echo ""
  echo "## Orchestrator Self-Audit"
  echo ""
  cat "$OUTPUT_DIR/audit.txt"
  echo ""
  echo "## MiniMax-Analyse"
  echo ""
  cat "$OUTPUT_DIR/analysis.txt"
  echo ""
  echo "## Autonomie-Updates"
  echo "- Betroffene Komponenten: ${COMPONENTS:-keine}"
  if [[ -n "$AUTONOMY_LOG" ]]; then
    echo -e "$AUTONOMY_LOG"
  fi
  echo "- Promotions: $PROMOTIONS"
  echo ""
  echo "## Token-Bilanz"
  if [[ -f "$USAGE_LOG" && -s "$USAGE_LOG" ]]; then
    CHUNKS=$(wc -l < "$USAGE_LOG")
    echo "- MiniMax: $CHUNKS Requests"
    while IFS= read -r logline; do
      echo "  $logline"
    done < "$USAGE_LOG"
  else
    echo "- Kein Usage-Log verfuegbar"
  fi
} > "$OUTPUT_DIR/reflect-result.md"

echo "" >&2
echo "=== Fertig ===" >&2
echo "Ergebnis: $OUTPUT_DIR/reflect-result.md" >&2
echo "Claude muss nur noch diese Datei lesen und User fragen." >&2
