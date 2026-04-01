# Agent-Scope: Memory-System

## Meine Dateien

```
services/extractor/
├── src/                       # Extractor Source-Code
│   ├── index.ts               # Entry Point
│   ├── config.ts              # ENV-Konfiguration
│   ├── watcher.ts             # JSONL File Watcher
│   ├── parser.ts              # Session-Log Parser
│   ├── window.ts              # Sliding Window
│   ├── pipeline.ts            # Extraction Pipeline
│   ├── extractor.ts           # LLM Fact Extraction
│   ├── embedder.ts            # bge-m3 Embedding
│   ├── qdrant.ts              # Qdrant Upsert
│   ├── offset.ts              # SQLite Offset-Tracking
│   └── bm25-tokenizer.ts      # FNV-1a Hashing
├── package.json               # Deps: @qdrant/js-client-rest, better-sqlite3, chokidar
└── DECISIONS.md

plugins/openclaw-memory-recall/
├── src/
│   ├── index.ts               # Plugin Entry, before_prompt_build Hook
│   └── bm25-tokenizer.ts      # FNV-1a Hashing (identisch mit Extractor!)
├── openclaw.plugin.json       # Plugin-Manifest
├── package.json
└── DECISIONS.md
```

## Meine Verantwortung

- Fakten-Extraktion aus Konversations-Logs (Extractor)
- Embedding-Generierung mit bge-m3 (GPU primaer, CPU Fallback)
- Qdrant Collection-Management (Dense + BM25 Vektoren)
- Semantische Deduplizierung (Cosine > 0.92)
- Scope-Routing (persoenlich vs. household)
- Memory-Recall via before_prompt_build Hook
- BM25 Tokenizer Konsistenz zwischen Extractor und Recall

### Kritische Regeln (NICHT verletzen!)

1. **bge-m3 = 1024 Dimensionen** — NIEMALS 1536, zerstoert alle Collections
2. **Sessions NIE im Betrieb loeschen** — JSONL-Sessions sind Extractor-Input
3. **MiniMax ist einziger Extractor** — Kein Qwen-Fallback (halluziniert)
4. **plugins.slots.memory = "none"** — Eigenes System, nicht builtin
5. **BM25 Tokenizer identisch halten** — Extractor und Recall muessen gleichen Code verwenden

## Build & Deploy

```bash
# Extractor
cd ~/openclaw-deploy/services/extractor/
npm run build
systemctl --user restart openclaw-extractor

# Memory-Recall Plugin
cd ~/openclaw-deploy/plugins/openclaw-memory-recall/
npm run build
# Plugin wird via Gateway deployed:
systemctl --user restart openclaw-gateway

# Qdrant (Docker)
docker restart qdrant
```

## Pflichten nach jeder Aenderung

- description.md aktuell halten bei Pipeline-Aenderungen
- testinstruct.md aktualisieren bei neuen Test-Szenarien
- decisions.md fuehren bei Aenderungen an Extraction/Recall-Logik
- BM25 Tokenizer in BEIDEN Projekten synchron halten!

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| Gateway-Config (plugins.entries, plugins.slots) | **gateway** |
| GPU Embedding-Server (llama.cpp, bge-m3 Modell) | **gpu-server** |
| Docker/Qdrant Container-Management | **onboard** (initial) |
| Plugin-System allgemein (Hooks, Manifest) | **openclaw-skills** |
| JSONL-Log-Format, Session-Management | **gateway** |
| Tool-Hub MCP-Tools | **tool-hub** |
