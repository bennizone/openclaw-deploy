#!/usr/bin/env bash
# consult-agent.sh — MiniMax-Konsultation via OpenClaw Gateway
#
# Usage:
#   consult-agent.sh <component> "<frage>"
#   consult-agent.sh <component> "<frage>" --with-decisions
#
# Beispiele:
#   consult-agent.sh tool-hub "Ist ein Wetter-Tool machbar?"
#   consult-agent.sh gateway "Brauche ich einen neuen Port?" --with-decisions
#
# Das Script:
#   - Liest GATEWAY_AUTH_TOKEN aus ~/.openclaw/.env
#   - Laedt description.md der Komponente als System-Prompt
#   - Optional: haengt decisions.md an (--with-decisions)
#   - Sendet an chatCompletions mit korrektem Scopes-Header

set -euo pipefail

COMPONENT="${1:-}"
QUESTION="${2:-}"
WITH_DECISIONS="${3:-}"

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

if [[ "$WITH_DECISIONS" == "--with-decisions" ]]; then
  DECISIONS_FILE="$COMP_DIR/decisions.md"
  if [[ -f "$DECISIONS_FILE" ]]; then
    SYSTEM_PROMPT="$SYSTEM_PROMPT

---

$(cat "$DECISIONS_FILE")"
  fi
fi

# JSON-safe escapen (jq macht das zuverlaessig)
JSON_PAYLOAD=$(jq -n \
  --arg model "openclaw/default" \
  --arg system "$SYSTEM_PROMPT" \
  --arg user "$QUESTION" \
  '{
    model: $model,
    messages: [
      { role: "system", content: $system },
      { role: "user", content: $user }
    ]
  }')

# Request
RESPONSE=$(curl -s -X POST http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-OpenClaw-Scopes: operator.write" \
  -d "$JSON_PAYLOAD")

# Ergebnis extrahieren
OK=$(echo "$RESPONSE" | jq -r '.ok // empty')
if [[ "$OK" == "false" ]]; then
  echo "ERROR: Gateway-Fehler:"
  echo "$RESPONSE" | jq -r '.error'
  exit 1
fi

# Antwort-Text ausgeben
CONTENT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty')
if [[ -n "$CONTENT" ]]; then
  echo "$CONTENT"
else
  # Fallback: ganzes JSON zeigen
  echo "$RESPONSE" | jq .
fi
