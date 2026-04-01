# Modell-Routing

> Fuer die Gesamt-Uebersicht aller Routing-Entscheidungen (Agent-Auswahl, Scopes, Hooks)
> siehe [agent-routing.md](agent-routing.md). Diese Datei dokumentiert Modell-Details.

## Uebersicht

| Agent-Typ | Primaer | Fallback | Warum |
|-----------|---------|----------|-------|
| Persoenlich (WhatsApp) | MiniMax M2.7 (API) | Qwen 3.5 9B (GPU) | MiniMax: bessere Konversation, groesserer Context |
| Household (HA Voice) | Qwen 3.5 9B (GPU) | MiniMax M2.7 | Qwen: schneller, kostenlos, reicht fuer Smart Home |
| Embeddings | bge-m3 (GPU:8081) | bge-m3 (LXC:8081 CPU) | GPU primaer, CPU als Fallback |

## Smart-Home-Routing (openclaw-ha-voice Plugin)

Das HA-Voice Plugin routet basierend auf dem Nachrichtentyp:

- **READ/CONTROL** (Smart-Home-Anfragen) → Qwen 3.5 9B (schnell, lokal)
- **EVERYTHING ELSE** → MiniMax M2.7 (besser fuer Konversation)

Dies passiert im `before_model_resolve` Hook.

## Modell-Parameter

### MiniMax M2.7
- Context: 204.800 Tokens
- Max Output: 131.072 Tokens
- Kosten: $0.30 / $1.20 pro 1M Tokens (Input/Output)
- API: Anthropic Messages Format
- Besonderheit: CJK Language Bleeding → Sanitizer aktiv

### Qwen 3.5 9B Opus-Distilled v2 (Q4_K_M)
- Context: 196.608 Tokens gesamt (2 Slots à 98.304)
- Max Output: 8.192 Tokens
- KV-Cache: Q4_0 (spart ~1.5 GB VRAM vs F16)
- Parallel: 2 Slots
- Reasoning-Budget: 1024
- `enable_thinking: false` via `chat_template_kwargs` (IMMER!)
- Throughput: ~37 t/s auf GTX 1080 Ti
- VRAM: ~5.700 MB

### bge-m3 (Q8_0)
- Dimension: 1024 (NICHT 1536!)
- Pooling: CLS
- Context: 2048
- VRAM: ~600 MB
- CPU-Fallback: 4 Threads, langsamer aber funktional
