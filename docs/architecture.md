# Architektur

## System-Uebersicht

```
Internet
  │
  ├── MiniMax API (https://api.minimax.io)
  │     └── MiniMax M2.7 — Primaeres LLM fuer persoenliche Agents
  │
  └── WhatsApp Cloud / Matrix / Telegram
        └── Eingehende Nachrichten

LAN
├── GPU-Server (${GPU_SERVER_IP})
│   ├── llama-server :8080 — Qwen 3.5 9B (Chat, CUDA)
│   │     Params: ctx=196608, parallel=2 (98304/Slot), kv-cache=q4_0, flash-attn, reasoning-budget=1024
│   │     Threads: 1 inference, nproc-2 batch (dynamisch)
│   └── llama-server :8081 — bge-m3 Q8_0 (Embedding, CUDA)
│         Params: ctx=2048, pooling=cls
│         VRAM: ~600 MB
│
├── OpenClaw LXC (${LXC_IP})
│   ├── openclaw-gateway :18789 (systemd user service)
│   │   ├── Agent: <default> (WhatsApp, MiniMax primaer)
│   │   ├── Agent: ... (weitere persoenliche)
│   │   └── Agent: household (chatCompletions, Qwen primaer)
│   │
│   ├── Qdrant :6333 (Docker)
│   │   ├── memories_<agent1>  (1024-dim dense + bm25 sparse)
│   │   ├── memories_<agent2>
│   │   └── memories_household
│   │
│   ├── openclaw-extractor (systemd user service)
│   │     └── Liest JSONL Logs → Extrahiert Fakten → Qdrant
│   │
│   └── llama-server :8081 (CPU Fallback fuer Embeddings)
│
└── Home Assistant (${HA_URL})
    └── home-llm Custom Component
          ├── Conversation Agent fuer Assist Pipeline
          ├── LLM: Qwen 3.5 9B via GPU-Server
          ├── Memory: Qdrant via OpenClaw LXC
          └── Delegation: OPENCLAW: Prefix → household Agent
```

## Datenfluss: Nachricht → Antwort

```
User (WhatsApp) → OpenClaw Gateway
  → Agent-Routing (bindings / default)
  → before_prompt_build Hook
    → openclaw-memory-recall: Qdrant-Suche → Kontext injizieren
  → before_model_resolve Hook
    → openclaw-ha-voice: Smart-Home-Routing (READ/CONTROL → Qwen, REST → MiniMax)
  → LLM Call (MiniMax oder Qwen)
  → before_message_write Hook
    → openclaw-ha-voice: CJK-Sanitizer (MiniMax Language Bleeding)
  → Antwort an User
  → Conversation Log (JSONL)
  → Extractor Service
    → MiniMax: Fakten extrahieren
    → MiniMax: Fakten verifizieren
    → bge-m3: Embedding generieren
    → Qdrant: Speichern (mit Deduplizierung)
```

## Memory-Pipeline

```
Conversation JSONL
  → Extractor (sliding window: 3 vor, 2 nach)
  → Stage 1: MiniMax M2.7 — Fakten extrahieren (nur aus User-Nachrichten)
  → Stage 2: MiniMax M2.7 — Jede Fakt verifizieren (Confidence >= 0.5)
  → Embedding: bge-m3 (1024-dim)
  → Deduplizierung: Cosine > 0.92 → Update statt Insert
  → Qdrant: Dense + BM25 Sparse Vektoren

Recall (bei neuer Nachricht):
  → Query-Embedding via bge-m3
  → Qdrant Hybrid-Search (Dense + BM25 + RRF Fusion)
  → Top-K=5 Ergebnisse
  → In System-Prompt injiziert (before_prompt_build)

Scope-Routing:
  → Agent "benni": Sucht in memories_benni + memories_household
  → Agent "household": Sucht NUR in memories_household
```
