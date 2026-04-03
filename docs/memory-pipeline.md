# Memory-Pipeline

## Komponenten

1. **Extractor Service** (`services/extractor/`) — Liest Conversation-Logs, extrahiert Fakten
2. **Qdrant** (Docker) — Vektor-Datenbank fuer langfristiges Gedaechtnis
3. **Memory Recall Plugin** (`plugins/openclaw-memory-recall/`) — Injiziert Erinnerungen in Prompts

## Extraktions-Pipeline

### Schritt 0: Session-Joiner (neu)
- Joiner watcht `~/.openclaw/agents/*/sessions/*.jsonl`
- Filtert consult-agent.sh Sessions raus (kein `[Erinnerungen]`/`[Regeln]` Prefix)
- Erkennt Channel: WhatsApp, Matrix, Direct (aus Message-Content)
- Aggregiert in Tages-Channel-Logs: `~/extractor/logs/YYYY-MM-DD_agent_channel.jsonl`
- State: `~/extractor/logs/.joined-sessions` (bereits verarbeitete Session-IDs)

### Schritt 1: Log-Monitoring
- Extractor beobachtet `~/extractor/logs/*.jsonl` (Tages-Channel-Logs)
- Sliding Window: 3 Turns davor, 2 danach fuer Kontext
- Kontext geht jetzt ueber Session-Grenzen (weil Turns in einem Tages-Log)
- Nur User-Nachrichten werden extrahiert (nicht Assistant-Antworten)

### Schritt 2: Fakten-Extraktion
- LLM: MiniMax M2.7 via `@openclaw/minimax-client` (Anthropic Messages API)
- Prompt-Fokus: Menschen-Fakten, nicht technische Arbeit. PII-Filter aktiv.
- Output: Liste von Fakten mit Scope (personal/household)

### Schritt 3: Verifizierung
- Jeder Kandidat wird von MiniMax verifiziert (Anthropic API, sauberes JSON)
- Beispiel-basierter Verifier-Prompt (verified=true/false mit Begruendung)
- Confidence-Schwelle: >= 0.5
- PII (Telefonnummern, Adressen) → automatisch rejected

### Schritt 4: Embedding + Speicherung
- Embedding: bge-m3 (1024 Dimensionen)
- Semantische Deduplizierung: Cosine-Similarity > 0.92 → Update statt Insert
- Qdrant: Dense-Vektor + BM25 Sparse-Vektor

## Recall-Pipeline

### Bei jeder neuen Nachricht (before_prompt_build Hook):
1. User-Nachricht → bge-m3 Embedding
2. Qdrant Hybrid-Search: Dense + BM25 + RRF Fusion
3. Top-K = 5 relevanteste Erinnerungen
4. Ergebnisse werden in den System-Prompt injiziert

### Scope-Routing
| Agent | Durchsucht | Warum |
|-------|-----------|-------|
| Persoenlich (z.B. benni) | memories_benni + memories_household | Eigene + geteilte Fakten |
| Household | NUR memories_household | Kein Zugriff auf persoenliche Erinnerungen |

## Collections in Qdrant

Pro Agent eine Collection:
```
memories_<agentId>     # z.B. memories_benni, memories_domi
memories_household     # Geteilte Haushaltsfakten
```

Vektor-Schema:
```json
{
  "vectors": {
    "dense": { "size": 1024, "distance": "Cosine" }
  },
  "sparse_vectors": {
    "bm25": { "modifier": "idf" }
  }
}
```

**WICHTIG:** Dimension ist 1024 (bge-m3), NICHT 1536!

## Konfiguration

### Extractor (.env)
```
EXTRACTION_MODEL=MiniMax-M2.7
SLIDING_WINDOW_BEFORE=3
SLIDING_WINDOW_AFTER=2
TURN_WAIT_TIMEOUT_MS=30000
```

### Memory Recall (openclaw.json plugins.entries)
```json
{
  "qdrantUrl": "http://localhost:6333",
  "embedUrl": "http://${GPU_SERVER_IP}:8081",
  "embedFallbackUrl": "http://localhost:8081",
  "embeddingModel": "bge-m3",
  "topK": 5
}
```
