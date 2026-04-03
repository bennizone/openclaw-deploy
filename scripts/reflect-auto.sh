#!/usr/bin/env bash
# reflect-auto.sh — Automatisierte Session-Reflection via MiniMax
#
# Usage:
#   reflect-auto.sh <session.jsonl> [--output-dir <dir>]
#
# Führt die /reflect Analyse durch mit minimalen Claude-Tokens:
# 1. Tool-Calls extrahieren (Python)
# 2. Orchestrator Self-Audit (Python)
# 3. Session-Analyse via MiniMax (SDK-Agent)
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

# --- Schritt 3: MiniMax-Analyse (SDK-Agent) ---
echo "Schritt 3: MiniMax-Analyse (SDK-Agent)..." >&2

ANALYSIS_PROMPT="Analysiere diese Claude Code Session-Datei auf Token-Waste.

Finde und liste fuer jedes Pattern:
1) Fehlgeschlagene Calls — wo haette die Info stehen muessen?
2) Wiederholte Reads gleicher Datei — warum nicht beim ersten Mal?
3) Exploratorische Ketten (ls, grep, head) — was fehlte?
4) Bekannte Fehler wiederholt — wo war es dokumentiert?

Fuer jedes gefundene Pattern: Schlage einen konkreten Patch vor.
Format: 'In DATEI nach STELLE ergaenzen: TEXT'
Falls kein Fix moeglich: 'KEIN FIX — <Grund>'

Erstelle abschliessend:
- Eine Patch-Tabelle: | # | Pattern | Betroffene Datei | Vorgeschlagener Patch |
- Eine workflow-patterns.md Zeile: | Datum | Feature | Pattern | Fix | Status | Anzahl |
- Eine kommaseparierte Liste der betroffenen Komponenten-Namen"

node "$SCRIPT_DIR/consult-sdk.mjs" \
  --component reviewer \
  --question "$ANALYSIS_PROMPT" \
  --input-file "$OUTPUT_DIR/calls.txt" \
  --usage-log "$USAGE_LOG" \
  > "$OUTPUT_DIR/analysis.txt"

echo "  → Analyse fertig ($(wc -l < "$OUTPUT_DIR/analysis.txt") Zeilen)" >&2

# --- Schritt 3b: SDK-Sessions analysieren ---
SDK_SESSION_DIR="$HOME/.openclaw/sdk-sessions"
SDK_TIMESTAMP_MARKER="$SDK_SESSION_DIR/.last-reflect-timestamp"
SDK_ANALYSIS=""
SDK_SESSION_COUNT=0

if [[ -d "$SDK_SESSION_DIR" ]]; then
  echo "Schritt 3b: SDK-Sessions analysieren..." >&2

  # Sessions finden die neuer sind als der Marker (oder letzte 24h)
  SDK_SESSIONS_FILE="$OUTPUT_DIR/sdk-sessions-list.txt"
  if [[ -f "$SDK_TIMESTAMP_MARKER" ]]; then
    find "$SDK_SESSION_DIR" -name "*.jsonl" -newer "$SDK_TIMESTAMP_MARKER" -type f \
      > "$SDK_SESSIONS_FILE" 2>/dev/null || true
  else
    find "$SDK_SESSION_DIR" -name "*.jsonl" -mtime -1 -type f \
      > "$SDK_SESSIONS_FILE" 2>/dev/null || true
  fi

  # Meta-Loop-Schutz: Sessions rausfiltern die von reflect selbst stammen
  # (component "reviewer" + question enthaelt "Token-Waste")
  SDK_FILTERED="$OUTPUT_DIR/sdk-sessions-filtered.txt"
  > "$SDK_FILTERED"
  while IFS= read -r session_file; do
    # Letzte Zeile mit type:"summary" prüfen
    summary=$(tail -1 "$session_file" 2>/dev/null || true)
    if echo "$summary" | grep -q '"type":"summary"' 2>/dev/null; then
      comp=$(echo "$summary" | grep -oP '"component"\s*:\s*"[^"]*"' | grep -oP ':\s*"\K[^"]+' || true)
      q=$(echo "$summary" | grep -oP '"question"\s*:\s*"[^"]*"' | grep -oP ':\s*"\K[^"]+' || true)
      # Meta-Loop: reflect-eigene Analyse-Sessions ueberspringen
      if [[ "$comp" == "reviewer" ]] && echo "$q" | grep -qi "token-waste" 2>/dev/null; then
        echo "  → Ueberspringe reflect-eigene Session: $(basename "$session_file")" >&2
        continue
      fi
    fi
    echo "$session_file" >> "$SDK_FILTERED"
  done < "$SDK_SESSIONS_FILE"

  SDK_SESSION_COUNT=$(wc -l < "$SDK_FILTERED" 2>/dev/null || echo "0")
  SDK_SESSION_COUNT=$(echo "$SDK_SESSION_COUNT" | tr -d ' ')

  if [[ "$SDK_SESSION_COUNT" -gt 0 ]]; then
    echo "  → $SDK_SESSION_COUNT SDK-Sessions gefunden" >&2

    # Sessions zusammenfuehren mit Trennern fuer MiniMax
    SDK_COMBINED="$OUTPUT_DIR/sdk-combined.txt"
    > "$SDK_COMBINED"
    while IFS= read -r session_file; do
      echo "=== SESSION: $(basename "$session_file") ===" >> "$SDK_COMBINED"
      cat "$session_file" >> "$SDK_COMBINED"
      echo "" >> "$SDK_COMBINED"
    done < "$SDK_FILTERED"

    # MiniMax analysieren lassen
    SDK_ANALYSIS_PROMPT="Analysiere diese MiniMax SDK-Agent-Sessions. Finde komponentenspezifische Learnings:
1) Welche Fehler hat der Agent gemacht?
2) Was hat unerwartet gut/schlecht funktioniert?
3) Welche Hinweise sollten in die Komponenten-Dokumentation?

Fuer jedes Learning: Gib component, type, trigger, recommendation an.
Format pro Learning:
component: <name>
type: pattern|anti-pattern|config|api
trigger: <was hat es ausgeloest>
recommendation: <konkreter Hinweis>
---

Wenn keine relevanten Learnings vorhanden: Schreibe 'Keine Learnings gefunden.'"

    node "$SCRIPT_DIR/consult-sdk.mjs" \
      --component reviewer \
      --question "$SDK_ANALYSIS_PROMPT" \
      --input-file "$SDK_COMBINED" \
      --usage-log "$USAGE_LOG" \
      > "$OUTPUT_DIR/sdk-analysis.txt" 2>/dev/null || {
        echo "  → WARN: SDK-Analyse fehlgeschlagen, ueberspringe" >&2
        echo "SDK-Analyse fehlgeschlagen" > "$OUTPUT_DIR/sdk-analysis.txt"
      }

    SDK_ANALYSIS=$(cat "$OUTPUT_DIR/sdk-analysis.txt")
    echo "  → SDK-Analyse fertig ($(wc -l < "$OUTPUT_DIR/sdk-analysis.txt") Zeilen)" >&2
  else
    echo "  → Keine neuen SDK-Sessions gefunden" >&2
  fi
else
  echo "Schritt 3b: SDK-Session-Verzeichnis nicht vorhanden, ueberspringe" >&2
fi

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
  echo "## SDK-Session-Analyse"
  echo ""
  if [[ "$SDK_SESSION_COUNT" -gt 0 && -n "$SDK_ANALYSIS" ]]; then
    echo "- **Analysierte SDK-Sessions:** $SDK_SESSION_COUNT"
    echo ""
    echo "$SDK_ANALYSIS"
    echo ""
    # Betroffene Komponenten aus Learnings extrahieren fuer Hinweis
    LEARNING_COMPS=$(grep -oP '^component:\s*\K\S+' "$OUTPUT_DIR/sdk-analysis.txt" 2>/dev/null | sort -u || true)
    if [[ -n "$LEARNING_COMPS" ]]; then
      echo "### Vorgeschlagene learnings.md Updates"
      echo ""
      for lcomp in $LEARNING_COMPS; do
        echo "- \`components/$lcomp/learnings.md\`"
      done
      echo ""
    fi
  else
    echo "- Keine neuen SDK-Sessions seit letztem Reflect"
  fi
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

# --- Timestamp-Marker fuer SDK-Sessions aktualisieren ---
if [[ -d "$SDK_SESSION_DIR" ]]; then
  touch "$SDK_TIMESTAMP_MARKER" 2>/dev/null || true
fi

echo "" >&2
echo "=== Fertig ===" >&2
echo "Ergebnis: $OUTPUT_DIR/reflect-result.md" >&2
echo "Claude muss nur noch diese Datei lesen und User fragen." >&2
