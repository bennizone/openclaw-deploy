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
#   --input-file <path> Liest Daten aus Datei; <frage> wird Map-Prompt pro Chunk
#   --reduce-prompt <t> Eigener Konsolidierungs-Prompt fuer Reduce-Phase
#   --usage-log <path>  Schreibt Token-Usage pro Request (append)
#   --overlap <n>       Zeilen-Overlap zwischen Chunks (Default: 3)
#   --delay <n>         Sekunden zwischen Chunk-Starts (Default: 3)
#
# Beispiele:
#   consult-agent.sh tool-hub "Ist ein Wetter-Tool machbar?"
#   consult-agent.sh gateway "Brauche ich einen neuen Port?" --with-decisions
#   consult-agent.sh ha-integration "Aenderungen noetig?" --brief
#   consult-agent.sh reviewer "Analysiere auf Waste" --input-file calls.txt --overlap 5
#
# Das Script:
#   - Liest GATEWAY_AUTH_TOKEN aus ~/.openclaw/.env
#   - Laedt description.md der Komponente als System-Prompt
#   - Optional: haengt decisions.md an (--with-decisions)
#   - Sendet an chatCompletions mit korrektem Scopes-Header
#   - Timeout: 90 Sekunden (curl -m)
#   - Bei langen Fragen (>3000 Zeichen): Automatisches Chunking
#   - --input-file: Map-Reduce Modus (Datei chunken, pro Chunk analysieren, konsolidieren)

set -euo pipefail

COMPONENT="${1:-}"
QUESTION="${2:-}"
shift 2 2>/dev/null || true

WITH_DECISIONS=""
BRIEF=""
NO_CHUNK=""
INPUT_FILE=""
REDUCE_PROMPT=""
USAGE_LOG=""
OVERLAP=3
CHUNK_DELAY=3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-decisions) WITH_DECISIONS="1"; shift ;;
    --brief) BRIEF="1"; shift ;;
    --no-chunk) NO_CHUNK="1"; shift ;;
    --input-file) INPUT_FILE="$2"; shift 2 ;;
    --reduce-prompt) REDUCE_PROMPT="$2"; shift 2 ;;
    --usage-log) USAGE_LOG="$2"; shift 2 ;;
    --overlap) OVERLAP="$2"; shift 2 ;;
    --delay) CHUNK_DELAY="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Chunking-Schwellwert (Zeichen)
MAX_QUESTION_LEN=6000

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

# --- Hilfsfunktion: Einzelnen Request senden (mit Retry) ---
send_request() {
  local sys_prompt="$1"
  local user_msg="$2"
  local chunk_label="${3:-single}"
  local max_retries=2
  local retry=0

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

  local response content
  while [[ $retry -le $max_retries ]]; do
    response=$(printf '%s' "$payload" | curl -s -m 90 -X POST http://localhost:18789/v1/chat/completions \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -H "X-OpenClaw-Scopes: operator.write" \
      -d @- 2>/dev/null) || true

    local ok
    ok=$(echo "$response" | jq -r '.ok // empty' 2>/dev/null)
    if [[ "$ok" == "false" ]]; then
      echo "WARN: Gateway-Fehler (Versuch $((retry+1))/$((max_retries+1))):" >&2
      echo "$response" | jq -r '.error' >&2
      retry=$((retry + 1))
      [[ $retry -le $max_retries ]] && sleep 5
      continue
    fi

    content=$(echo "$response" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
    if [[ -n "$content" ]]; then
      # Usage-Logging
      if [[ -n "$USAGE_LOG" ]]; then
        local ts prompt_tok compl_tok
        ts=$(date -Iseconds)
        prompt_tok=$(echo "$response" | jq -r '.usage.prompt_tokens // 0')
        compl_tok=$(echo "$response" | jq -r '.usage.completion_tokens // 0')
        echo "$ts $COMPONENT $chunk_label prompt=$prompt_tok completion=$compl_tok" >> "$USAGE_LOG"
      fi
      echo "$content"
      return 0
    fi

    echo "WARN: Leere Antwort (Versuch $((retry+1))/$((max_retries+1)))" >&2
    retry=$((retry + 1))
    [[ $retry -le $max_retries ]] && sleep 5
  done

  echo "ERROR: Keine Antwort nach $((max_retries+1)) Versuchen" >&2
  return 1
}

# --- Input bestimmen ---
if [[ -n "$INPUT_FILE" ]]; then
  if [[ ! -f "$INPUT_FILE" ]]; then
    echo "ERROR: Input-Datei '$INPUT_FILE' nicht gefunden" >&2
    exit 1
  fi
  DATA=$(cat "$INPUT_FILE")
  MAP_PROMPT="$QUESTION"
else
  DATA="$QUESTION"
  MAP_PROMPT=""
fi

# --- Chunking-Logik ---
DATA_LEN=${#DATA}

if [[ -z "$NO_CHUNK" && "$DATA_LEN" -gt "$MAX_QUESTION_LEN" ]]; then
  echo "INFO: Input ist $DATA_LEN Zeichen — wird in Chunks aufgeteilt" >&2

  # Daten in Chunks splitten (an Absatzgrenzen)
  CHUNKS=()
  remaining="$DATA"
  while [[ ${#remaining} -gt $MAX_QUESTION_LEN ]]; do
    chunk="${remaining:0:$MAX_QUESTION_LEN}"
    last_break=$(echo "$chunk" | grep -n '^$' | tail -1 | cut -d: -f1 || true)
    if [[ -n "$last_break" && "$last_break" -gt 5 ]]; then
      cut_pos=$(echo "$chunk" | head -n "$last_break" | wc -c)
    else
      last_line=$(echo "$chunk" | grep -n '.' | tail -1 | cut -d: -f1 || true)
      if [[ -n "$last_line" ]]; then
        cut_pos=$(echo "$chunk" | head -n "$last_line" | wc -c)
      else
        cut_pos=${#chunk}
      fi
    fi
    CHUNKS+=("${remaining:0:$cut_pos}")
    remaining="${remaining:$cut_pos}"
  done
  [[ -n "$remaining" ]] && CHUNKS+=("$remaining")

  CHUNK_TOTAL=${#CHUNKS[@]}

  # Overlap anwenden (ab Chunk 2: letzte N Zeilen des Vorgaengers voranstellen)
  if [[ "$OVERLAP" -gt 0 && "$CHUNK_TOTAL" -gt 1 ]]; then
    OVERLAPPED_CHUNKS=("${CHUNKS[0]}")
    for i in $(seq 1 $((CHUNK_TOTAL - 1))); do
      prev_tail=$(echo "${CHUNKS[$((i - 1))]}" | tail -n "$OVERLAP")
      OVERLAPPED_CHUNKS+=("[...Overlap...]
$prev_tail
[...Ende Overlap...]

${CHUNKS[$i]}")
    done
    CHUNKS=("${OVERLAPPED_CHUNKS[@]}")
  fi

  echo "INFO: $CHUNK_TOTAL Chunks erstellt (Overlap: $OVERLAP Zeilen)" >&2

  # Jeden Chunk parallel senden (10s Versatz)
  CHUNK_TMP_DIR=$(mktemp -d)
  trap "rm -rf $CHUNK_TMP_DIR" EXIT

  for i in "${!CHUNKS[@]}"; do
    chunk_num=$((i + 1))
    echo "INFO: Sende Chunk $chunk_num/$CHUNK_TOTAL..." >&2

    if [[ -n "$MAP_PROMPT" ]]; then
      user_msg="$MAP_PROMPT

--- Daten (Teil $chunk_num von $CHUNK_TOTAL) ---
${CHUNKS[$i]}"
    else
      user_msg="Analysiere den folgenden Abschnitt ($chunk_num von $CHUNK_TOTAL). Antworte kompakt mit den wichtigsten Erkenntnissen:

${CHUNKS[$i]}"
    fi

    # Background: Ergebnis in nummerierte Datei schreiben
    (
      result=$(send_request "$SYSTEM_PROMPT" "$user_msg" "$chunk_num/$CHUNK_TOTAL") || true
      if [[ -n "$result" ]]; then
        echo "$result" > "$CHUNK_TMP_DIR/$chunk_num.txt"
      else
        echo "WARN: Chunk $chunk_num lieferte keine Antwort" >&2
        touch "$CHUNK_TMP_DIR/$chunk_num.empty"
      fi
    ) &

    # 10s Versatz zwischen Chunk-Starts (nicht nach dem letzten)
    if [[ $chunk_num -lt $CHUNK_TOTAL ]]; then
      sleep $CHUNK_DELAY
    fi
  done

  echo "INFO: Warte auf ${CHUNK_TOTAL} Chunks..." >&2
  wait

  # Ergebnisse in Reihenfolge einlesen
  PARTIAL_RESULTS=()
  for i in $(seq 1 $CHUNK_TOTAL); do
    if [[ -f "$CHUNK_TMP_DIR/$i.txt" ]]; then
      PARTIAL_RESULTS+=("$(cat "$CHUNK_TMP_DIR/$i.txt")")
    else
      echo "WARN: Chunk $i hat keine Antwort geliefert" >&2
    fi
  done

  rm -rf "$CHUNK_TMP_DIR"
  trap - EXIT

  if [[ ${#PARTIAL_RESULTS[@]} -eq 0 ]]; then
    echo "ERROR: Keine Teilergebnisse erhalten" >&2
    exit 1
  fi

  if [[ ${#PARTIAL_RESULTS[@]} -eq 1 ]]; then
    echo "${PARTIAL_RESULTS[0]}"
  else
    # Konsolidierungs-Request (Reduce)
    echo "INFO: Konsolidiere ${#PARTIAL_RESULTS[@]} Teilergebnisse..." >&2
    consolidated=""
    for i in "${!PARTIAL_RESULTS[@]}"; do
      consolidated="$consolidated
--- Teilergebnis $((i + 1)) ---
${PARTIAL_RESULTS[$i]}
"
    done

    local_reduce="${REDUCE_PROMPT:-Fasse die folgenden Teilergebnisse zu einer kohaerenten Gesamtantwort zusammen. Entferne Redundanzen, behalte alle konkreten Empfehlungen:}"

    consolidated_len=${#consolidated}
    if [[ "$consolidated_len" -gt "$MAX_QUESTION_LEN" ]]; then
      # Zweistufige Reduktion: zu viele Teilergebnisse fuer einen Request
      echo "INFO: Reduce-Input zu gross ($consolidated_len Zeichen) — zweistufige Reduktion" >&2
      half=$(( ${#PARTIAL_RESULTS[@]} / 2 ))

      first_half=""
      for i in $(seq 0 $((half - 1))); do
        first_half="$first_half
--- Teilergebnis $((i + 1)) ---
${PARTIAL_RESULTS[$i]}
"
      done

      second_half=""
      for i in $(seq $half $((${#PARTIAL_RESULTS[@]} - 1))); do
        second_half="$second_half
--- Teilergebnis $((i + 1)) ---
${PARTIAL_RESULTS[$i]}
"
      done

      echo "INFO: Reduce Stufe 1a (Teilergebnisse 1-$half)..." >&2
      sub1=$(send_request "$SYSTEM_PROMPT" "$local_reduce

$first_half" "reduce-1a") || true
      sleep 3

      echo "INFO: Reduce Stufe 1b (Teilergebnisse $((half+1))-${#PARTIAL_RESULTS[@]})..." >&2
      sub2=$(send_request "$SYSTEM_PROMPT" "$local_reduce

$second_half" "reduce-1b") || true
      sleep 3

      echo "INFO: Reduce Stufe 2 (finale Konsolidierung)..." >&2
      send_request "$SYSTEM_PROMPT" "$local_reduce

--- Zwischenergebnis A ---
$sub1

--- Zwischenergebnis B ---
$sub2" "reduce-final"
    else
      send_request "$SYSTEM_PROMPT" "$local_reduce

$consolidated" "reduce"
    fi
  fi
else
  # Einzelner Request (Input ist kurz genug)
  if [[ -n "$MAP_PROMPT" ]]; then
    user_msg="$MAP_PROMPT

--- Daten ---
$DATA"
  else
    user_msg="$DATA"
  fi
  CONTENT=$(send_request "$SYSTEM_PROMPT" "$user_msg" "single")
  if [[ -n "$CONTENT" ]]; then
    echo "$CONTENT"
  else
    echo "ERROR: Keine Antwort erhalten" >&2
    exit 1
  fi
fi
