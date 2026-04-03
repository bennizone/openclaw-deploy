# Memory-System

## Zweck

Langzeit-Gedaechtnis fuer alle OpenClaw-Agents. Besteht aus 3 Sub-Komponenten:
dem Extractor (extrahiert Fakten aus Konversationen), Qdrant (speichert Vektoren),
und dem Memory-Recall Plugin (injiziert relevante Erinnerungen in Prompts).

## Architektur

```
Memory-System (3 Komponenten)

1. Extractor Service (~/extractor/, systemd user service)
   services/extractor/
   ├── src/
   │   ├── index.ts           # Service Entry Point (Joiner → Backfill → Watch)
   │   ├── config.ts          # ENV-Konfiguration
   │   ├── joiner.ts          # Session-Joiner: aggregiert Sessions in Tages-Channel-Logs
   │   ├── watcher.ts         # Tages-Log Watcher (chokidar, watcht ~/extractor/logs/)
   │   ├── parser.ts          # Session-Log + Day-Log Parser
   │   ├── window.ts          # Sliding Window (3 vor, 2 nach)
   │   ├── pipeline.ts        # Extraction Pipeline Orchestrierung
   │   ├── batch.ts           # Batch-Extraction + Batch-Verification (Multi-Turn)
   │   ├── extractor.ts       # LLM Fact Extraction via @openclaw/minimax-client
   │   ├── behavior-extractor.ts # LLM Behavior-Extraction via @openclaw/minimax-client
   │   ├── embedder.ts        # bge-m3 Embedding (GPU + CPU Fallback)
   │   ├── qdrant.ts          # Qdrant Upsert (Dense + BM25)
   │   ├── offset.ts          # SQLite Offset-Tracking
   │   └── bm25-tokenizer.ts  # FNV-1a Hashing (shared mit Recall)
   ├── package.json           # v1.0.0, Deps: @openclaw/minimax-client, @qdrant/js-client-rest, better-sqlite3, chokidar
   └── tsconfig.json

   Shared MiniMax Client:
   shared/minimax-client/       # @openclaw/minimax-client
   ├── client.ts               # MiniMaxChatClient (Anthropic Messages API)
   ├── platform-client.ts      # MiniMaxPlatformClient (Search + VLM)
   ├── response-parser.ts      # parseJsonArray, parseJsonObject, stripThinkTags
   ├── usage-logger.ts         # In-Process Request-Counter
   ├── types.ts                # Shared Types
   └── index.ts                # Re-Exports

2. Qdrant (Docker, Port 6333)
   Collections: memories_benni, memories_domi, memories_household
                instructions_benni, instructions_domi, instructions_household
   Vektoren: dense (bge-m3, 1024-dim, Cosine) + bm25 (sparse, idf)
   Payload: fact, type, confidence, agentId, scope, timestamp (memories_*)
            oder: instruction, criteria, confidence, agentId, scope, timestamp (instructions_*)

3. Memory-Recall Plugin (~/.openclaw/extensions/openclaw-memory-recall/)
   plugins/openclaw-memory-recall/
   ├── src/
   │   ├── index.ts           # Plugin Entry, before_prompt_build Hook
   │   └── bm25-tokenizer.ts  # FNV-1a Hashing (identisch mit Extractor)
   ├── openclaw.plugin.json   # Plugin-Manifest
   └── package.json
```

### Datenfluss

```
Konversation → JSONL-Session → Joiner → Tages-Channel-Log → Extractor
  → Joiner filtert consult-agent.sh Sessions, erkennt Channel (whatsapp/matrix/direct)
  → Tages-Logs: ~/extractor/logs/YYYY-MM-DD_agent_channel.jsonl
  → Sliding Window (3+2 Turns Kontext, jetzt ueber Session-Grenzen hinweg)
  → Stage 1: MiniMax M2.7 extrahiert Fakten (Anthropic API, nur User-Messages)
  → Stage 2: MiniMax M2.7 verifiziert (Confidence >= 0.5, PII-Filter)
  → Stage 3: MiniMax M2.7 extrahiert Behavior-Instructions (bereinigter Kontext)
  → Stage 4: MiniMax M2.7 verifiziert Behavior (Confidence >= 0.7, 4 Kriterien)
  → bge-m3 Embedding (1024-dim)
  → Dedup: Cosine > 0.92 → identisch zu Facts
  → Qdrant: memories_* Dense + BM25, instructions_* Dense + BM25 Sparse Vektoren

Neue Nachricht → Memory-Recall Plugin (before_prompt_build)
  → Query → bge-m3 Embedding
  → Qdrant Hybrid-Search (Dense + BM25 + RRF Fusion)
  → memories_*: Top-K=5, instructions_*: Top-K=3
  → Injection: [Regeln] → [Anweisungen] → [Erinnerungen]
```

## Abhaengigkeiten

- **Braucht:**
  - **gateway** — JSONL-Logs als Input fuer Extractor, Plugin-Host fuer Recall
  - **gpu-server** — bge-m3 Embedding-Server (Port 8081), Primaer
  - LXC localhost:8081 — bge-m3 CPU-Fallback
  - Qdrant (Docker, Port 6333) — Vektor-Datenbank
  - MiniMax API via `@openclaw/minimax-client` — Anthropic Messages API fuer Extraction + Verification
- **Wird gebraucht von:**
  - **gateway** — Memory-Recall Plugin laeuft als Gateway-Plugin
  - **ha-integration** — HA-Voice Household-Agent nutzt memories_household
  - **tool-hub** — indirekt (Extractor verarbeitet Tool-Ergebnisse in Sessions)

## Schnittstellen

- **Eingabe (Joiner):**
  - JSONL-Session-Logs aus `~/.openclaw/agents/*/sessions/` (via chokidar File Watcher)
  - Filtert consult-agent.sh Calls automatisch raus
  - Output: Tages-Channel-Logs in `~/extractor/logs/`
- **Eingabe (Extractor):**
  - Tages-Channel-Logs aus `~/extractor/logs/` (via chokidar File Watcher)
  - SQLite State-DB (`~/extractor/state.db`) fuer Offset-Tracking
- **Eingabe (Recall):**
  - User-Nachricht (via before_prompt_build Hook)
  - Agent-ID fuer Scope-Routing
- **Ausgabe (Recall):**
  - `prependContext` mit Top-K relevanten Erinnerungen im System-Prompt

### Scope-Routing

| Agent | Durchsucht | Warum |
|-------|-----------|-------|
| benni | memories_benni + memories_household + instructions_benni + instructions_household | Eigene + geteilte Fakten + Anweisungen |
| domi | memories_domi + memories_household + instructions_domi + instructions_household | Eigene + geteilte Fakten + Anweisungen |
| household | NUR memories_household + instructions_household | Kein Zugriff auf persoenliche Erinnerungen |

## Konfiguration

### Extractor (`~/extractor/.env`)
```
MINIMAX_API_KEY=...
EXTRACTION_MODEL=MiniMax-M2.7
EMBED_GPU_URL=http://<GPU_SERVER_IP>:8081
EMBED_LOCAL_URL=http://localhost:8081
QDRANT_URL=http://localhost:6333
EMBEDDING_MODEL=bge-m3
SLIDING_WINDOW_BEFORE=3
SLIDING_WINDOW_AFTER=2
TURN_WAIT_TIMEOUT_MS=30000
LOG_LEVEL=info
```

### Memory-Recall (in `openclaw.json` → `plugins.entries`)
```json
{
  "qdrantUrl": "http://localhost:6333",
  "embedUrl": "http://<GPU_SERVER_IP>:8081",
  "embedFallbackUrl": "http://localhost:8081",
  "embeddingModel": "bge-m3",
  "topK": 5,
  "instructionsTopK": 3
}
```

### Gateway-Voraussetzung
- `plugins.slots.memory = "none"` — Builtin-Memory deaktiviert

## Bekannte Einschraenkungen

- **bge-m3 = 1024 Dimensionen** — NICHT 1536! Falsche Dimension zerstoert Memory
- **Sessions NIE im Betrieb loeschen** — JSONL-Sessions sind Input fuer den Extractor und produktive Konversationsdaten
- **MiniMax ist einziger Extractor** — Qwen 3.5 halluziniert bei Extraktion (1/74 Facts ohne Thinking, Recall-Context wird als neue Fakten interpretiert)
- **plugins.slots.memory = "none" ist PFLICHT** — Sonst kollidiert Builtin-Memory mit eigenem System
- **Kein Qwen-Fallback fuer Extraktion** — Bei MiniMax-Ausfall werden Turns uebersprungen und spaeter nachgeholt
- **BM25 Tokenizer muss identisch sein** — Extractor und Recall muessen gleichen Hashing-Algorithmus verwenden (FNV-1a)

## Neues Feature hinzufuegen

### Neuen Agent zum Memory-System hinzufuegen
1. Qdrant Collection erstellen: `memories_<agentId>` (1024-dim dense + bm25 sparse)
2. Extractor kennt den Agent automatisch (liest Workspace-Verzeichnisse)
3. Recall-Plugin: Scope-Routing in `index.ts` erweitern (Agent → Collections)
4. Rebuild: `npm run build` in beiden Projekten
5. Services neustarten: `systemctl --user restart openclaw-extractor openclaw-gateway`

### Extraction-Logik aendern
1. `services/extractor/src/extractor.ts` — Prompt/Parsing fuer Fakten aendern
2. `services/extractor/src/behavior-extractor.ts` — Prompt/Parsing fuer Behavior-Instructions aendern
3. `services/extractor/src/pipeline.ts` — Pipeline-Flow aendern
4. Build: `npm run build` im Extractor
5. Deps sync pruefen: `for pkg in ~/extractor/node_modules/@openclaw/*; do readlink -f "$pkg" && test -d "$pkg" || echo "MISSING: $pkg"; done`
6. Restart: `systemctl --user restart openclaw-extractor`
7. Test: Nachricht senden, Log pruefen, Qdrant-Collections pruefen
