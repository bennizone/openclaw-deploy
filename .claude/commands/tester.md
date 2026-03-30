# /tester — Tests & Health-Checks

Du fuehrst Tests und Health-Checks fuer das OpenClaw-System durch.

## Health-Checks

### Alle Services pruefen
```bash
# OpenClaw Gateway
systemctl --user status openclaw-gateway.service
curl -s http://localhost:18789/health | jq . 2>/dev/null || echo "Gateway nicht erreichbar"

# Qdrant
curl -s http://localhost:6333/ | jq .version 2>/dev/null || echo "Qdrant nicht erreichbar"

# Embedding Fallback (lokal)
curl -s http://localhost:8081/health | jq . 2>/dev/null || echo "Embedding-Fallback nicht erreichbar"

# GPU-Server Chat
curl -s http://<GPU_IP>:8080/health | jq . 2>/dev/null || echo "GPU Chat nicht erreichbar"

# GPU-Server Embedding
curl -s http://<GPU_IP>:8081/health | jq . 2>/dev/null || echo "GPU Embedding nicht erreichbar"

# Extractor
systemctl --user status openclaw-extractor.service

# Qdrant Docker
docker ps --filter name=qdrant --format "{{.Status}}"
```

## Memory-Tests

### Embedding-Test
```bash
# GPU-Server Embedding testen
curl -s http://<GPU_IP>:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": "Test-Text fuer Embedding", "model": "bge-m3"}' | jq '.data[0].embedding | length'
# Erwartetes Ergebnis: 1024
```

### Qdrant Write/Read Test
```bash
# Collection pruefen
curl -s http://localhost:6333/collections | jq '.result.collections[].name'

# Punkt zaehlen
curl -s http://localhost:6333/collections/memories_household/points/count | jq .
```

## Plugin-Tests

```bash
# Alle Plugins pruefen
openclaw plugins list
openclaw plugins doctor

# Einzelnes Plugin inspizieren
openclaw plugins inspect openclaw-ha-voice
openclaw plugins inspect openclaw-memory-recall
openclaw plugins inspect openclaw-sonarr-radarr
```

## Unit-Tests (wenn vorhanden)

```bash
# Pro Plugin
cd ~/.openclaw/extensions/openclaw-ha-voice && npm test
cd ~/.openclaw/extensions/openclaw-memory-recall && npm test
cd ~/.openclaw/extensions/openclaw-sonarr-radarr && npm test
```

## Integrations-Tests

### Agent-Isolation
- Nachricht an Agent A senden → nur Agent A antwortet
- Nachricht an Household → nur Household antwortet
- Memory von Agent A nicht in Agent B sichtbar

### End-to-End
1. WhatsApp-Nachricht senden
2. Agent antwortet
3. Memory-Extractor verarbeitet Conversation
4. Qdrant enthaelt neuen Eintrag
5. Naechste Nachricht: Memory-Recall injected relevanten Kontext

## Verhalten
- Tests systematisch durchfuehren
- Ergebnisse klar dokumentieren (OK/FAIL)
- Bei Fehlern: Ursache diagnostizieren
- GPU-Server IP aus Config oder Setup-Daten lesen
