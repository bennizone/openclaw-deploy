#!/usr/bin/env bash
# Installiert Qdrant als Docker Container
set -euo pipefail

QDRANT_STORAGE="${QDRANT_STORAGE:-/opt/qdrant/storage}"

echo "=== Qdrant Installation ==="

if docker ps --format '{{.Names}}' | grep -q '^qdrant$'; then
  echo "[OK] Qdrant laeuft bereits"
  docker ps --filter name=qdrant --format "  Container: {{.Names}} | Status: {{.Status}} | Ports: {{.Ports}}"
  exit 0
fi

# Gestoppten Container pruefen
if docker ps -a --format '{{.Names}}' | grep -q '^qdrant$'; then
  echo "[...] Qdrant Container existiert, wird gestartet"
  docker start qdrant
else
  echo "[...] Erstelle Qdrant Container"
  sudo mkdir -p "$QDRANT_STORAGE"
  sudo chown "$(id -u):$(id -g)" "$QDRANT_STORAGE"

  docker run -d --name qdrant --restart unless-stopped \
    -p 6333:6333 -p 6334:6334 \
    -v "$QDRANT_STORAGE":/qdrant/storage \
    qdrant/qdrant:latest
fi

# Warten + Pruefen
echo "[...] Warte auf Qdrant..."
for i in $(seq 1 10); do
  if curl -sf http://localhost:6333/ > /dev/null 2>&1; then
    echo "[OK] Qdrant laeuft auf Port 6333"
    exit 0
  fi
  sleep 1
done

echo "[FAIL] Qdrant antwortet nicht nach 10 Sekunden"
docker logs qdrant --tail 20
exit 1
