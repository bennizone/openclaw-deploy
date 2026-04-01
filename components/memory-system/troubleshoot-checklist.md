# Troubleshoot-Checkliste: Memory-System

## Schnell-Diagnose

1. Alle 3 Komponenten laufen?
   ```bash
   docker ps | grep qdrant
   XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user status openclaw-extractor
   XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user status openclaw-gateway
   ```

2. Embedding-Server erreichbar?
   ```bash
   # GPU (primaer)
   curl -s http://<GPU_SERVER_IP>:8081/v1/embeddings \
     -H "Content-Type: application/json" \
     -d '{"model": "bge-m3", "input": "test"}' | jq '.data[0].embedding | length'
   # Erwartung: 1024 — NICHT 1536!

   # CPU Fallback (LXC)
   curl -s http://localhost:8081/v1/embeddings \
     -H "Content-Type: application/json" \
     -d '{"model": "bge-m3", "input": "test"}' | jq '.data[0].embedding | length'
   ```

## Problem: Dimensionen-Bug (bge-m3)

**Symptom:** Memory-Recall liefert keine Ergebnisse, Qdrant-Fehler in Logs.

**Ursache:** bge-m3 hat 1024 Dimensionen, NICHT 1536. Falsche Dimension zerstoert Collections.

**Fix:**
```bash
# Collection-Schema pruefen
curl -s http://localhost:6333/collections/memories_benni | jq '.result.config.params.vectors'
# Muss: dense.size = 1024, distance = "Cosine"

# Falls falsch: Collection loeschen + neu erstellen
curl -X DELETE http://localhost:6333/collections/memories_benni
# Dann Extractor neu starten — erstellt Collection automatisch
```

## Problem: Extractor extrahiert nichts

**Pruefen:**
```bash
# Logs
XDG_RUNTIME_DIR=/run/user/$(id -u) journalctl --user -u openclaw-extractor -n 50

# Offset-Tracking
sqlite3 ~/extractor/state.db "SELECT * FROM offsets ORDER BY rowid DESC LIMIT 5;"

# MiniMax erreichbar?
# → Extractor nutzt NUR MiniMax fuer Extraktion (kein Qwen-Fallback!)
# Bei MiniMax-Ausfall: Turns werden uebersprungen, spaeter nachgeholt
```

**Haeufige Ursachen:**
- `MINIMAX_API_KEY` in `~/extractor/.env` falsch oder abgelaufen
- Keine neuen JSONL-Sessions in `~/.openclaw/completions/`
- Offset zeigt auf Ende der Datei (alles verarbeitet)

## Problem: Memory-Recall findet nichts

**Pruefen:**
```bash
# Fakten vorhanden?
curl -s http://localhost:6333/collections/memories_benni/points/count | jq .result.count

# Plugin geladen?
XDG_RUNTIME_DIR=/run/user/$(id -u) journalctl --user -u openclaw-gateway -n 30 | grep memory-recall
```

**Haeufige Ursachen:**
- `plugins.slots.memory` ist NICHT `"none"` — Builtin-Memory kollidiert
- Embedding-Server nicht erreichbar (GPU + CPU Fallback pruefen)
- BM25 Tokenizer nicht synchron zwischen Extractor und Recall (gleicher Code!)

## Problem: Deduplizierung funktioniert nicht

**Pruefen:**
```bash
# Punkt-Anzahl vor und nach gleichem Fakt vergleichen
curl -s http://localhost:6333/collections/memories_benni/points/count | jq .result.count
# Fakt ausloesen, 60s warten
curl -s http://localhost:6333/collections/memories_benni/points/count | jq .result.count
# Sollte gleich bleiben (Cosine > 0.92 → Update statt Insert)
```

## Kritische Regeln

- **Sessions NIE im Betrieb loeschen** — JSONL-Sessions sind Extractor-Input und produktive Konversationsdaten
- **MiniMax ist einziger Extractor** — Qwen halluziniert (1/74 Facts ohne Thinking, Recall als neue Fakten)
- **BM25 Tokenizer identisch halten** — `bm25-tokenizer.ts` in Extractor und Recall MUSS gleicher Code sein

## Build & Deploy

### Extractor
```bash
cd ~/openclaw-deploy/services/extractor && npm run build
XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart openclaw-extractor
```

### Memory-Recall Plugin
```bash
cd ~/openclaw-deploy/plugins/openclaw-memory-recall && npm run build
XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart openclaw-gateway
```

### Qdrant
```bash
docker restart qdrant
```
