# Embedding-Dimensionen

## Das Problem

Das bge-m3 Embedding-Modell erzeugt Vektoren mit **1024 Dimensionen**.
Viele Tutorials und Default-Configs gehen von 1536 aus (OpenAI text-embedding-ada-002).

Wenn die Qdrant-Collection mit falscher Dimension angelegt wird, schlaegt jeder Insert fehl.
Das Fatale: Es gibt keinen einfachen Rollback — die Collection muss geloescht und neu angelegt werden.

## Korrekte Werte

| Modell | Dimension | Pooling |
|--------|-----------|---------|
| bge-m3 (Q8_0) | **1024** | CLS |
| text-embedding-ada-002 | 1536 | — |
| text-embedding-3-small | 1536 | — |

## Qdrant Collection korrekt anlegen

```bash
curl -X PUT "http://localhost:6333/collections/memories_household" \
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

## Pruefen ob korrekt

```bash
curl -s http://localhost:6333/collections/memories_household | jq '.result.config.params.vectors'
# Muss zeigen: "size": 1024
```
