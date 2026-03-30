# /tester — Tests & Health-Checks

Du fuehrst Tests und Health-Checks fuer das OpenClaw-System durch.
Du kennst alle Endpunkte, Test-Methoden und erwarteten Ergebnisse.

## Setup-Daten lesen

GPU-Server IP und andere Konfiguration findest du in:
1. `~/.openclaw-deploy-state.json` (config-Sektion, bevorzugt)
2. `~/.openclaw/openclaw.json` (models.providers.llama.baseUrl)

## 1. Service Health-Checks

```bash
# === OpenClaw Gateway ===
systemctl --user is-active openclaw-gateway.service
# Erwartet: active

# === Qdrant ===
docker ps --filter name=qdrant --format "{{.Status}}"
# Erwartet: Up ...
curl -sf http://localhost:6333/ | jq .version
# Erwartet: Versionsnummer

# === Embedding Fallback (lokal) ===
curl -sf http://localhost:8081/health | jq .status
# Erwartet: "ok"

# === GPU-Server Chat ===
curl -sf http://<GPU_IP>:8080/health | jq .status
# Erwartet: "ok"

# === GPU-Server Embedding ===
curl -sf http://<GPU_IP>:8081/health | jq .status
# Erwartet: "ok"

# === Extractor ===
systemctl --user is-active openclaw-extractor.service
# Erwartet: active
```

## 2. Plugin-Tests

```bash
# Alle Plugins pruefen
openclaw plugins list
# Erwartet: Alle Plugins mit Status "enabled"

openclaw plugins doctor
# Erwartet: Keine Fehler

# Einzelnes Plugin inspizieren
openclaw plugins inspect openclaw-ha-voice
openclaw plugins inspect openclaw-memory-recall
openclaw plugins inspect openclaw-sonarr-radarr
```

## 3. Embedding-Test

```bash
# GPU-Server Embedding
curl -s http://<GPU_IP>:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": "Das ist ein Test", "model": "bge-m3"}' | jq '.data[0].embedding | length'
# Erwartet: 1024 (NICHT 1536!)

# CPU-Fallback Embedding
curl -s http://localhost:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": "Das ist ein Test", "model": "bge-m3"}' | jq '.data[0].embedding | length'
# Erwartet: 1024
```

## 4. Qdrant Memory-Test

```bash
# Collections auflisten
curl -s http://localhost:6333/collections | jq '.result.collections[].name'
# Erwartet: memories_<agent1>, memories_household, ...

# Punkte zaehlen
curl -s http://localhost:6333/collections/memories_household/points/count | jq .result.count
# Erwartet: Zahl >= 0

# Vektor-Dimension pruefen
curl -s http://localhost:6333/collections/memories_household | jq '.result.config.params.vectors.dense.size'
# Erwartet: 1024
```

## 5. Nachrichten-Tests (End-to-End)

### Via chatCompletions API (ohne WhatsApp)

```bash
# Gateway-Token aus Config oder State-Datei lesen
TOKEN=$(jq -r '.gateway.auth.token' ~/.openclaw/openclaw.json 2>/dev/null || echo "TOKEN_HIER")

# Nachricht an Default-Agent senden
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Hallo, funktionierst du?"}]
  }' | jq '.choices[0].message.content'
# Erwartet: Antwort-Text

# Nachricht an Household-Agent
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/household",
    "messages": [{"role": "user", "content": "Wie warm ist es im Wohnzimmer?"}]
  }' | jq '.choices[0].message.content'
# Erwartet: Antwort im Fliesstext (kein Markdown, keine Emojis)
```

### Via WhatsApp

- User soll Test-Nachricht senden (z.B. "Hallo, Test!")
- Antwort sollte innerhalb von ~5-10 Sekunden kommen
- Bei Voice: Sprachnachricht senden, Transkript pruefen

## 6. Agent-Isolation-Test

```bash
TOKEN=$(jq -r '.gateway.auth.token' ~/.openclaw/openclaw.json 2>/dev/null || echo "TOKEN_HIER")

# Agent A: Memory schreiben (wenn Memory-Tools verfuegbar)
# Agent B: Gleiche Memory-Suche → sollte NICHT gefunden werden (eigene Collection)

# Household: Darf NUR memories_household durchsuchen
# Persoenlich: Durchsucht eigene Collection + memories_household
```

## 7. Skill-Debug (Plugin-Entwicklung)

```bash
# Plugin nach Aenderung neu laden
cd ~/.openclaw/extensions/<plugin-name>
npm run build
openclaw plugins doctor
systemctl --user restart openclaw-gateway

# Gateway-Logs live beobachten waehrend Test-Nachricht
journalctl --user -u openclaw-gateway -f --output=cat

# Typische Fehler in Logs:
# "Tool not registered" → tools.profile pruefen (muss "full" sein)
# "Plugin load failed" → openclaw plugins inspect <id>
# "Config validation error" → openclaw.plugin.json Schema pruefen
# "Hook error" → Stack-Trace in Logs suchen
```

## 8. Performance-Check

```bash
# GPU-Server Throughput
curl -s http://<GPU_IP>:8080/health | jq '.slots[].metrics'
# Zeigt: tokens_per_second, prompt_tokens_processed

# GPU VRAM
ssh <GPU_USER>@<GPU_IP> 'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader'
# Erwartet: < 8000 MiB / 11264 MiB (GTX 1080 Ti)
```

## 9. Unit-Tests (pro Plugin)

```bash
cd ~/.openclaw/extensions/openclaw-ha-voice && npm test 2>/dev/null || echo "Keine Tests"
cd ~/.openclaw/extensions/openclaw-memory-recall && npm test 2>/dev/null || echo "Keine Tests"
cd ~/.openclaw/extensions/openclaw-sonarr-radarr && npm test 2>/dev/null || echo "Keine Tests"
```

## Ergebnis-Format

Gib die Ergebnisse als Checkliste aus:

```
Health-Checks:
  [OK] OpenClaw Gateway
  [OK] Qdrant
  [OK] Embedding Fallback
  [OK] GPU Chat
  [FAIL] GPU Embedding — Connection refused
  [OK] Extractor

Plugins:
  [OK] openclaw-ha-voice
  [OK] openclaw-memory-recall
  [WARN] openclaw-sonarr-radarr — Config incomplete

Memory:
  [OK] Embedding Dimension: 1024
  [OK] Collections vorhanden
  [OK] Qdrant erreichbar
```

Bei FAIL: Ursache diagnostizieren und Loesung vorschlagen.
