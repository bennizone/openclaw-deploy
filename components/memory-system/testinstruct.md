# Test-Anweisungen: Memory-System

## Voraussetzungen

- Qdrant laeuft: `docker ps | grep qdrant`
- Extractor laeuft: `systemctl --user status openclaw-extractor`
- Gateway laeuft (fuer Recall-Plugin): `systemctl --user status openclaw-gateway`
- bge-m3 Embedding erreichbar (GPU oder CPU Fallback)
- MiniMax API Key gesetzt in `~/extractor/.env`

## Health-Check

```bash
# Qdrant
curl -s http://localhost:6333/collections | jq '.result.collections[].name'
# Erwartung: memories_benni, memories_domi, memories_household

# Extractor Service
systemctl --user status openclaw-extractor
# Erwartung: active (running)

# Embedding (GPU)
curl -s http://<GPU_SERVER_IP>:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "bge-m3", "input": "test"}' | jq '.data[0].embedding | length'
# Erwartung: 1024

# Embedding (CPU Fallback)
curl -s http://localhost:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "bge-m3", "input": "test"}' | jq '.data[0].embedding | length'
# Erwartung: 1024
```

## Funktions-Tests

### Test: Qdrant Collection Schema
```bash
curl -s http://localhost:6333/collections/memories_benni | jq '.result.config.params'
```
- Erwartetes Ergebnis: `vectors.dense.size = 1024`, `vectors.dense.distance = "Cosine"`, `sparse_vectors.bm25`
- Bei Fehler: Collection mit falschem Schema → loeschen + neu erstellen mit 1024 Dimensionen

### Test: Extractor Offset-Tracking
```bash
sqlite3 ~/extractor/state.db "SELECT * FROM offsets LIMIT 5;"
```
- Erwartetes Ergebnis: Eintraege mit Dateiname + Byte-Offset
- Bei Fehler: state.db fehlt → Extractor neu starten, erstellt automatisch

### Test: Fakten-Extraktion (End-to-End)
1. Nachricht an Agent senden (z.B. "Ich mag italienisches Essen")
2. 30-60 Sekunden warten (TURN_WAIT_TIMEOUT_MS + Processing)
3. Qdrant pruefen:
```bash
curl -s http://localhost:6333/collections/memories_benni/points/scroll \
  -H "Content-Type: application/json" \
  -d '{"limit": 5, "with_payload": true}' | jq '.result.points[-1].payload'
```
- Erwartetes Ergebnis: Fakt mit `fact: "Benni mag italienisches Essen"`, `scope: "personal"`
- Bei Fehler: Extractor-Logs pruefen (`journalctl --user -u openclaw-extractor`)

### Test: Memory Recall
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-OpenClaw-Scopes: agent:benni" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Was weisst du ueber mein Lieblingsessen?"}]
  }'
```
- Erwartetes Ergebnis: Agent erinnert sich an "italienisches Essen" (aus Recall)
- Bei Fehler: Recall-Plugin pruefen, Embedding-Server pruefen

### Test: Deduplizierung
1. Gleichen Fakt nochmal ausloesen ("Ich liebe italienisches Essen")
2. Qdrant pruefen: Kein neuer Punkt, bestehender wurde geupdated (Cosine > 0.92)
```bash
curl -s http://localhost:6333/collections/memories_benni/points/count | jq .result.count
```

## Integrations-Tests

### Test: Scope-Routing
1. Household-Fakt ausloesen: "Wir haben einen Staubsaugerroboter"
2. Pruefen: Fakt ist in `memories_household`, NICHT in `memories_benni`
3. Recall als household: Fakt gefunden
4. Recall als benni: Fakt auch gefunden (sucht benni + household)

### Test: Embedding-Fallback
1. GPU Embedding-Server stoppen
2. Nachricht senden → Recall muss ueber CPU-Fallback (localhost:8081) funktionieren
3. GPU Embedding-Server wieder starten

### Test: Extractor-Resilience
Bei MiniMax-Ausfall:
- Offset wird NICHT gespeichert
- Turn bleibt im Backlog
- Nach Recovery: automatisches Nachholen
