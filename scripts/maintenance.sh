#!/usr/bin/env bash
# maintenance.sh — Sauberes Hoch-/Herunterfahren aller OpenClaw Services
#
# Usage:
#   maintenance.sh on  [--with-gpu]   # Alle Services stoppen
#   maintenance.sh off [--with-gpu]   # Alle Services starten
#   maintenance.sh status [--with-gpu] # Status anzeigen
#
# Optionen:
#   --with-gpu    GPU-Server Services via SSH mit-verwalten
#
# Flag-Datei: ~/.openclaw-maintenance (existiert waehrend Maintenance)

set -uo pipefail

# --- Farben ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

# --- XDG_RUNTIME_DIR (systemctl --user braucht das) ---
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

# --- Konstanten ---
FLAG_FILE="$HOME/.openclaw-maintenance"
STATE_FILE="$HOME/.openclaw-deploy-state.json"

# --- Hilfsfunktionen ---

ok()   { echo -e "  ${GREEN}[OK]${NC}   $1"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
info() { echo -e "  ${BOLD}[....]${NC} $1"; }

# Health-Check mit Timeout
# Usage: wait_for_health <url> <timeout_seconds> <service_name>
wait_for_health() {
    local url="$1"
    local timeout="$2"
    local name="$3"
    local elapsed=0

    info "Warte auf $name ..."
    while [ "$elapsed" -lt "$timeout" ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            ok "$name erreichbar (${elapsed}s)"
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    fail "$name nicht erreichbar nach ${timeout}s"
    return 1
}

# GPU-Server Daten aus State-Datei lesen
read_gpu_config() {
    if [ ! -f "$STATE_FILE" ]; then
        fail "State-Datei nicht gefunden: $STATE_FILE"
        return 1
    fi
    GPU_IP=$(jq -r '.config.gpu_server_ip // empty' "$STATE_FILE")
    GPU_USER=$(jq -r '.config.gpu_ssh_user // empty' "$STATE_FILE")
    if [ -z "$GPU_IP" ] || [ -z "$GPU_USER" ]; then
        fail "GPU-Server Daten nicht in State-Datei gefunden"
        return 1
    fi
}

# Service stoppen (Fehler = Warnung, nicht Abbruch)
stop_service() {
    local name="$1"
    if systemctl --user is-active "$name" > /dev/null 2>&1; then
        systemctl --user stop "$name" 2>/dev/null && ok "$name gestoppt" || warn "$name Stop fehlgeschlagen"
    else
        warn "$name war bereits gestoppt"
    fi
}

# Service starten
start_service() {
    local name="$1"
    if systemctl --user is-active "$name" > /dev/null 2>&1; then
        warn "$name laeuft bereits"
    else
        systemctl --user start "$name" 2>/dev/null && ok "$name gestartet" || fail "$name Start fehlgeschlagen"
    fi
}

# Service-Status anzeigen
check_service() {
    local name="$1"
    if systemctl --user is-active "$name" > /dev/null 2>&1; then
        ok "$name: active"
    else
        fail "$name: inactive"
    fi
}

# --- Subcommands ---

do_on() {
    local with_gpu="$1"

    echo -e "${BOLD}=== Maintenance Mode: ON ===${NC}"
    echo ""

    # Concurrent-Run pruefen
    if [ -f "$FLAG_FILE" ]; then
        local old_pid
        old_pid=$(grep -oP 'pid=\K\d+' "$FLAG_FILE" 2>/dev/null || echo "")
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            fail "Maintenance laeuft bereits (PID $old_pid)"
            exit 1
        fi
        warn "Alte Flag-Datei gefunden (Prozess nicht mehr aktiv), ueberschreibe"
    fi

    # Flag setzen
    echo "timestamp=$(date -Iseconds)" > "$FLAG_FILE"
    echo "pid=$$" >> "$FLAG_FILE"
    ok "Flag-Datei gesetzt"

    echo ""
    echo -e "${BOLD}Services stoppen...${NC}"

    # 1. Gateway (stoppt Traffic-Annahme)
    stop_service "openclaw-gateway"

    # 2. Orphaned MCP-Prozesse
    if pgrep -f "openclaw-tools" > /dev/null 2>&1; then
        pkill -f "openclaw-tools" 2>/dev/null && ok "Orphaned MCP-Prozesse beendet" || warn "MCP-Prozesse konnten nicht beendet werden"
    fi

    # 3. Extractor
    stop_service "openclaw-extractor"

    # 4. Embed-Fallback
    stop_service "llama-embed-fallback"

    # 5. Qdrant
    if docker ps -q --filter name=qdrant 2>/dev/null | grep -q .; then
        docker stop qdrant > /dev/null 2>&1 && ok "Qdrant gestoppt" || warn "Qdrant Stop fehlgeschlagen"
    else
        warn "Qdrant war bereits gestoppt"
    fi

    # 6. GPU-Server (optional)
    if [ "$with_gpu" = "true" ]; then
        echo ""
        echo -e "${BOLD}GPU-Server stoppen...${NC}"
        if read_gpu_config; then
            ssh "$GPU_USER@$GPU_IP" "export XDG_RUNTIME_DIR=/run/user/\$(id -u); systemctl --user stop llama-chat llama-embed" 2>/dev/null \
                && ok "GPU-Server Services gestoppt ($GPU_IP)" \
                || warn "GPU-Server Stop fehlgeschlagen (SSH-Verbindung?)"
        fi
    fi

    echo ""
    echo -e "${GREEN}${BOLD}Maintenance Mode aktiv.${NC} Alle Services gestoppt."
    local gpu_hint=""
    [ "$with_gpu" = "true" ] && gpu_hint=" --with-gpu"
    echo "Zum Wiederherstellen: $0 off${gpu_hint}"
}

do_off() {
    local with_gpu="$1"

    echo -e "${BOLD}=== Maintenance Mode: OFF ===${NC}"
    echo ""

    if [ ! -f "$FLAG_FILE" ]; then
        warn "Keine Flag-Datei gefunden — System war nicht im Maintenance Mode"
    fi

    # 1. GPU-Server (optional, zuerst weil Gateway ihn als Fallback braucht)
    if [ "$with_gpu" = "true" ]; then
        echo -e "${BOLD}GPU-Server starten...${NC}"
        if read_gpu_config; then
            ssh "$GPU_USER@$GPU_IP" "export XDG_RUNTIME_DIR=/run/user/\$(id -u); systemctl --user start llama-embed llama-chat" 2>/dev/null \
                && ok "GPU-Server Services gestartet ($GPU_IP)" \
                || fail "GPU-Server Start fehlgeschlagen"

            wait_for_health "http://$GPU_IP:8081/health" 60 "GPU Embedding ($GPU_IP:8081)"
            wait_for_health "http://$GPU_IP:8080/health" 60 "GPU Chat ($GPU_IP:8080)"
        fi
        echo ""
    fi

    echo -e "${BOLD}Lokale Services starten...${NC}"

    # 2. Qdrant
    if docker ps -q --filter name=qdrant 2>/dev/null | grep -q .; then
        warn "Qdrant laeuft bereits"
    else
        docker start qdrant > /dev/null 2>&1 && ok "Qdrant gestartet" || fail "Qdrant Start fehlgeschlagen"
    fi
    wait_for_health "http://localhost:6333/healthz" 30 "Qdrant (localhost:6333)"

    # 3. Embed-Fallback
    start_service "llama-embed-fallback"
    wait_for_health "http://localhost:8081/health" 90 "Embed-Fallback (localhost:8081)"

    # 4. Gateway
    start_service "openclaw-gateway"
    wait_for_health "http://localhost:18789/health" 30 "Gateway (localhost:18789)"

    # 5. Extractor
    start_service "openclaw-extractor"
    ok "Extractor gestartet (kein Health-Endpoint)"

    # Flag entfernen
    rm -f "$FLAG_FILE"
    ok "Flag-Datei entfernt"

    echo ""
    echo -e "${GREEN}${BOLD}Alle Services gestartet.${NC} Maintenance Mode beendet."
}

do_status() {
    local with_gpu="$1"

    echo -e "${BOLD}=== OpenClaw Service Status ===${NC}"
    echo ""

    # Maintenance-Flag
    if [ -f "$FLAG_FILE" ]; then
        local ts
        ts=$(grep -oP 'timestamp=\K.*' "$FLAG_FILE" 2>/dev/null || echo "unbekannt")
        warn "Maintenance Mode AKTIV seit $ts"
    else
        ok "Kein Maintenance Mode"
    fi
    echo ""

    # Lokale Services
    echo -e "${BOLD}Lokale Services:${NC}"
    check_service "openclaw-gateway"
    check_service "openclaw-extractor"
    check_service "llama-embed-fallback"

    # Qdrant
    if docker ps -q --filter name=qdrant 2>/dev/null | grep -q .; then
        ok "Qdrant (Docker): running"
    else
        fail "Qdrant (Docker): stopped"
    fi
    echo ""

    # Health-Endpoints
    echo -e "${BOLD}Health-Endpoints:${NC}"
    curl -sf http://localhost:18789/health > /dev/null 2>&1 && ok "Gateway :18789" || fail "Gateway :18789"
    curl -sf http://localhost:6333/healthz > /dev/null 2>&1 && ok "Qdrant :6333" || fail "Qdrant :6333"
    curl -sf http://localhost:8081/health > /dev/null 2>&1 && ok "Embed-Fallback :8081" || fail "Embed-Fallback :8081"

    # GPU-Server (optional)
    if [ "$with_gpu" = "true" ]; then
        echo ""
        echo -e "${BOLD}GPU-Server:${NC}"
        if read_gpu_config; then
            ssh "$GPU_USER@$GPU_IP" "export XDG_RUNTIME_DIR=/run/user/\$(id -u); systemctl --user is-active llama-chat" > /dev/null 2>&1 \
                && ok "llama-chat ($GPU_IP): active" || fail "llama-chat ($GPU_IP): inactive"
            ssh "$GPU_USER@$GPU_IP" "export XDG_RUNTIME_DIR=/run/user/\$(id -u); systemctl --user is-active llama-embed" > /dev/null 2>&1 \
                && ok "llama-embed ($GPU_IP): active" || fail "llama-embed ($GPU_IP): inactive"

            curl -sf "http://$GPU_IP:8080/health" > /dev/null 2>&1 && ok "GPU Chat :8080" || fail "GPU Chat :8080"
            curl -sf "http://$GPU_IP:8081/health" > /dev/null 2>&1 && ok "GPU Embed :8081" || fail "GPU Embed :8081"
        fi
    fi
}

# --- Main ---

usage() {
    echo "Usage: $0 {on|off|status} [--with-gpu]"
    echo ""
    echo "  on     Alle Services stoppen (Maintenance starten)"
    echo "  off    Alle Services starten (Maintenance beenden)"
    echo "  status Aktuellen Status anzeigen"
    echo ""
    echo "Optionen:"
    echo "  --with-gpu  GPU-Server Services via SSH mit-verwalten"
    exit 1
}

if [ $# -lt 1 ]; then
    usage
fi

CMD="$1"
shift

WITH_GPU="false"
for arg in "$@"; do
    case "$arg" in
        --with-gpu) WITH_GPU="true" ;;
        *) echo "Unbekannte Option: $arg"; usage ;;
    esac
done

case "$CMD" in
    on)     do_on "$WITH_GPU" ;;
    off)    do_off "$WITH_GPU" ;;
    status) do_status "$WITH_GPU" ;;
    *)      usage ;;
esac
