#!/usr/bin/env bash
# consult-agent.sh — MiniMax-Konsultation via OpenClaw Gateway
#
# Usage:
#   consult-agent.sh <component> "<frage>" [optionen]
#
# Optionen:
#   --with-decisions    Haengt decisions.md an den System-Prompt an
#   --brief             Kompakte Antwort (max 5-8 Saetze)
#   --no-chunk          Chunking deaktivieren (auch bei langen Fragen)
#
# Beispiele:
#   consult-agent.sh tool-hub "Ist ein Wetter-Tool machbar?"
#   consult-agent.sh gateway "Brauche ich einen neuen Port?" --with-decisions
#   consult-agent.sh ha-integration "Aenderungen noetig?" --brief
#
# Das Script:
#   - Liest GATEWAY_AUTH_TOKEN aus ~/.openclaw/.env
#   - Laedt description.md der Komponente als System-Prompt
#   - Optional: haengt decisions.md an (--with-decisions)
#   - Sendet an chatCompletions mit korrektem Scopes-Header
#   - Timeout: 90 Sekunden (curl -m)
#   - Bei langen Fragen (>3000 Zeichen): Automatisches Chunking

set -euo pipefail

COMPONENT="${1:-}"
QUESTION="${2:-}"
shift 2 2>/dev/null || true

WITH_DECISIONS=""
BRIEF=""
NO_CHUNK=""
for arg in "$@"; do
  case "$arg" in
    --with-decisions) WITH_DECISIONS="1" ;;
    --brief) BRIEF="1" ;;
    --no-chunk) NO_CHUNK="1" ;;
  esac
done

# Chunking-Schwellwert (Zeichen)
MAX_QUESTION_LEN=3000

if [[ -z "$COMPONENT" || -z "$QUESTION" ]]; then
  echo "Usage: consult-agent.sh <component> \"<frage>\" [--with-decisions]"
  echo ""
  echo "Komponenten:"
  ls -1 "$(dirname "$0")/../components/" 2>/dev/null | sed 's/^/  /'
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMP_DIR="$REPO_DIR/components/$COMPONENT"

if [[ ! -d "$COMP_DIR" ]]; then
  echo "ERROR: Komponente '$COMPONENT' nicht gefunden in $REPO_DIR/components/"
  exit 1
fi

DESC_FILE="$COMP_DIR/description.md"
if [[ ! -f "$DESC_FILE" ]]; then
  echo "ERROR: $DESC_FILE nicht gefunden"
  exit 1
fi

# Token aus .env lesen
TOKEN=$(grep -E '^GATEWAY_AUTH_TOKEN=' ~/.openclaw/.env 2>/dev/null | cut -d= -f2-)
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: GATEWAY_AUTH_TOKEN nicht in ~/.openclaw/.env gefunden"
  exit 1
fi

# System-Prompt zusammenbauen
SYSTEM_PROMPT=$(cat "$DESC_FILE")

if [[ -n "$WITH_DECISIONS" ]]; then
  DECISIONS_FILE="$COMP_DIR/decisions.md"
  if [[ -f "$DECISIONS_FILE" ]]; then
    SYSTEM_PROMPT="$SYSTEM_PROMPT

---

$(cat "$DECISIONS_FILE")"
  fi
fi

if [[ -n "$BRIEF" ]]; then
  SYSTEM_PROMPT="$SYSTEM_PROMPT

---

WICHTIG: Antworte kompakt in maximal 5-8 Saetzen. Nur das Wesentliche, keine Codebeispiele ausser wenn explizit gefragt."
fi

# --- Hilfsfunktion: Einzelnen Request senden ---
send_request() {
  local sys_prompt="$1"
  local user_msg="$2"

  local payload
  payload=$(jq -n \
    --arg model "openclaw/default" \
    --arg system "$sys_prompt" \
    --arg user "$user_msg" \
    '{
      model: $model,
      messages: [
        { role: "system", content: $system },
        { role: "user", content: $user }
      ]
    }')

  local response
  response=$(curl -s -m 90 -X POST http://localhost:18789/v1/chat/completions \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-OpenClaw-Scopes: operator.write" \
    -d "$payload")

  local ok
  ok=$(echo "$response" | jq -r '.ok // empty')
  if [[ "$ok" == "false" ]]; then
    echo "ERROR: Gateway-Fehler:" >&2
    echo "$response" | jq -r '.error' >&2
    return 1
  fi

  echo "$response" | jq -r '.choices[0].message.content // empty'
}

# --- Chunking-Logik ---
QUESTION_LEN=${#QUESTION}

if [[ -z "$NO_CHUNK" && "$QUESTION_LEN" -gt "$MAX_QUESTION_LEN" ]]; then
  # Frage in Chunks aufteilen (an Absatzgrenzen oder nach MAX_QUESTION_LEN Zeichen)
  echo "INFO: Frage ist $QUESTION_LEN Zeichen — wird in Chunks aufgeteilt" >&2

  CHUNKS=()
  remaining="$QUESTION"
  while [[ ${#remaining} -gt $MAX_QUESTION_LEN ]]; do
    # Letzten Absatz-Umbruch vor dem Limit finden
    chunk="${remaining:0:$MAX_QUESTION_LEN}"
    # Suche letzte Leerzeile (Absatzgrenze)
    last_break=$(echo "$chunk" | grep -n '^$' | tail -1 | cut -d: -f1)
    if [[ -n "$last_break" && "$last_break" -gt 5 ]]; then
      # An Absatzgrenze schneiden
      cut_pos=$(echo "$chunk" | head -n "$last_break" | wc -c)
    else
      # Kein Absatz gefunden — am letzten Zeilenumbruch schneiden
      cut_pos=$(echo "$chunk" | grep -n '.' | tail -1 | cut -d: -f1)
      cut_pos=$(echo "$chunk" | head -n "$cut_pos" | wc -c)
    fi
    CHUNKS+=("${remaining:0:$cut_pos}")
    remaining="${remaining:$cut_pos}"
  done
  [[ -n "$remaining" ]] && CHUNKS+=("$remaining")

  echo "INFO: ${#CHUNKS[@]} Chunks erstellt" >&2

  # Jeden Chunk einzeln senden
  PARTIAL_RESULTS=()
  for i in "${!CHUNKS[@]}"; do
    chunk_num=$((i + 1))
    echo "INFO: Sende Chunk $chunk_num/${#CHUNKS[@]}..." >&2
    prefix="Analysiere den folgenden Abschnitt ($chunk_num von ${#CHUNKS[@]}). Antworte kompakt mit den wichtigsten Erkenntnissen:"
    result=$(send_request "$SYSTEM_PROMPT" "$prefix

${CHUNKS[$i]}")
    if [[ -n "$result" ]]; then
      PARTIAL_RESULTS+=("$result")
    else
      echo "WARN: Chunk $chunk_num lieferte keine Antwort" >&2
    fi
  done

  if [[ ${#PARTIAL_RESULTS[@]} -eq 0 ]]; then
    echo "ERROR: Keine Teilergebnisse erhalten" >&2
    exit 1
  fi

  if [[ ${#PARTIAL_RESULTS[@]} -eq 1 ]]; then
    echo "${PARTIAL_RESULTS[0]}"
  else
    # Konsolidierungs-Request
    echo "INFO: Konsolidiere ${#PARTIAL_RESULTS[@]} Teilergebnisse..." >&2
    consolidated=""
    for i in "${!PARTIAL_RESULTS[@]}"; do
      consolidated="$consolidated
--- Teilergebnis $((i + 1)) ---
${PARTIAL_RESULTS[$i]}
"
    done
    send_request "$SYSTEM_PROMPT" "Fasse die folgenden Teilergebnisse zu einer kohaerenten Gesamtantwort zusammen. Entferne Redundanzen, behalte alle konkreten Empfehlungen:

$consolidated"
  fi
else
  # Einzelner Request (Frage ist kurz genug)
  CONTENT=$(send_request "$SYSTEM_PROMPT" "$QUESTION")
  if [[ -n "$CONTENT" ]]; then
    echo "$CONTENT"
  else
    echo "ERROR: Keine Antwort erhalten" >&2
    exit 1
  fi
fi
