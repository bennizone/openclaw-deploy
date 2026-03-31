#!/usr/bin/env bash
# Deployt die home-llm HA Custom Component mit Backup
# Aufruf: ./deploy-home-llm.sh <HA_HOST> [HA_SSH_PORT] [HA_TOKEN]
#
# Beispiel:
#   ./deploy-home-llm.sh haos.home.example.com 22222
#   ./deploy-home-llm.sh haos.home.example.com 22222 "eyJ..."
set -euo pipefail

HA_HOST="${1:?Usage: $0 <HA_HOST> [HA_SSH_PORT] [HA_TOKEN]}"
HA_SSH_PORT="${2:-22222}"
HA_TOKEN="${3:-${HA_LONG_LIVED_TOKEN:-}}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPONENT_DIR="$REPO_DIR/services/home-llm/custom_components/home_llm"

echo "=== Home LLM Deploy ==="
echo "    Ziel: $HA_HOST (SSH Port $HA_SSH_PORT)"

# 1. Syntax-Check
echo "[...] Python Syntax-Check"
python3 -m py_compile "$COMPONENT_DIR/conversation.py"
python3 -m py_compile "$COMPONENT_DIR/config_flow.py"
python3 -m py_compile "$COMPONENT_DIR/__init__.py"
echo "[OK] Python-Syntax OK"

# 2. HA Backup erstellen (PFLICHT!)
echo "[...] HA Backup erstellen"
BACKUP_NAME="pre-deploy-$(date +%Y%m%d-%H%M)"
if ssh -p "$HA_SSH_PORT" -o ConnectTimeout=5 root@"$HA_HOST" \
    "ha backups new --name $BACKUP_NAME" 2>/dev/null; then
  echo "[OK] Backup '$BACKUP_NAME' erstellt (via SSH)"
elif [ -n "$HA_TOKEN" ]; then
  curl -sf -X POST "https://$HA_HOST/api/services/backup/create" \
    -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" || true
  echo "[OK] Backup via API angefordert (laeuft asynchron)"
  sleep 5
else
  echo "[WARN] Kein Backup moeglich (kein SSH/Token)."
  read -p "       Fortfahren ohne Backup? (j/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[jJyY]$ ]]; then
    echo "Abgebrochen."
    exit 1
  fi
fi

# 3. pycache loeschen (WICHTIG — sonst laedt HA gecachten alten Code!)
echo "[...] pycache loeschen"
find "$COMPONENT_DIR" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

# 4. Deploy via SCP
echo "[...] Deploy via SCP"
scp -P "$HA_SSH_PORT" -r "$COMPONENT_DIR" root@"$HA_HOST":/config/custom_components/
echo "[OK] Component deployed"

# 5. HA Core Restart
echo "[...] HA Core neustarten"
if ssh -p "$HA_SSH_PORT" -o ConnectTimeout=5 root@"$HA_HOST" \
    "ha core restart" 2>/dev/null; then
  echo "[OK] Restart ausgeloest via SSH (dauert 30-90s)"
elif [ -n "$HA_TOKEN" ]; then
  curl -sf -X POST "https://$HA_HOST/api/services/homeassistant/restart" \
    -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" || true
  echo "[OK] Restart via API ausgeloest (dauert 30-90s)"
else
  echo "[WARN] Konnte HA nicht neustarten. Bitte manuell: Settings > System > Restart"
fi

# 6. Warten + Health-Check
echo "[...] Warte 60s auf HA Restart"
sleep 60

if [ -n "$HA_TOKEN" ]; then
  if curl -sf "https://$HA_HOST/api/" -H "Authorization: Bearer $HA_TOKEN" > /dev/null 2>&1; then
    echo "[OK] HA erreichbar"
    # Integration testen
    RESULT=$(curl -sf "https://$HA_HOST/api/conversation/process" \
      -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
      -d '{"text":"Hallo","agent_id":"conversation.home_llm","language":"de"}' 2>/dev/null || echo "FAIL")
    if [ "$RESULT" != "FAIL" ]; then
      echo "[OK] Conversation Agent antwortet"
    else
      echo "[WARN] Conversation Agent antwortet nicht. Pruefe HA Logs."
    fi
  else
    echo "[WARN] HA antwortet noch nicht. Ggf. manuell pruefen."
  fi
else
  echo "[INFO] Kein HA_TOKEN — Health-Check uebersprungen"
fi

echo ""
echo "=== Deploy abgeschlossen ==="
