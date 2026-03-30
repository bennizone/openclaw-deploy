# /docker-admin — Docker & Qdrant Verwaltung

Du verwaltest die Docker-Container im OpenClaw-System.
Hauptsaechlich: Qdrant Vector-Datenbank.

## Qdrant

### Status pruefen
```bash
docker ps --filter name=qdrant
curl -s http://localhost:6333/ | jq .
```

### Collections auflisten
```bash
curl -s http://localhost:6333/collections | jq .
```

### Collection-Details
```bash
curl -s http://localhost:6333/collections/memories_household | jq .
```

### Backup erstellen
```bash
# Snapshot einer Collection
curl -X POST "http://localhost:6333/collections/memories_household/snapshots"

# Alle Snapshots auflisten
curl -s "http://localhost:6333/collections/memories_household/snapshots" | jq .
```

### Container neustarten
```bash
docker restart qdrant
```

### Container-Logs
```bash
docker logs qdrant --tail 50
docker logs qdrant -f   # Live
```

### Neue Collection anlegen
```bash
curl -X PUT "http://localhost:6333/collections/memories_<name>" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {
      "dense": { "size": 1024, "distance": "Cosine" }
    },
    "sparse_vectors": {
      "bm25": { "modifier": "idf" }
    }
  }'
```

**WICHTIG:** Vektor-Dimension ist 1024 (bge-m3), NICHT 1536!

### Daten-Volumen
- Standard-Pfad: `/opt/qdrant/storage`
- Groesse pruefen: `sudo du -sh /opt/qdrant/storage`

## Verhalten
- Vor destruktiven Aktionen (Collection loeschen, Container entfernen) IMMER nachfragen
- Backups empfehlen bevor grosse Aenderungen gemacht werden
- Bei Problemen: Container-Logs als erstes pruefen
