# Speed Baseline: GTX 1080 Ti

**Datum:** 2026-04-02
**Modell:** Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf (Q4_K_M, ~5.6 GB)
**GPU:** NVIDIA GeForce GTX 1080 Ti (11264 MiB, ~7812 MiB belegt)
**Server:** llama.cpp, --parallel 2, --ctx-size 196608, --reasoning-budget 2048

## Single Request (no thinking, max_tokens=64)

| Metrik | Wert |
|--------|------|
| TTFT (= Antwortzeit, non-streaming) | 1794 ms |
| Completion Tokens | 64 |
| t/s | 35.7 |

## Parallel (2 concurrent, no thinking, max_tokens=64)

| Metrik | Wert |
|--------|------|
| Wall Time | 2212 ms |
| Combined Tokens | 128 |
| Combined t/s | 57.9 |
| Speedup vs Single | 1.6x |

## HA-typische Anfragen (no thinking, max_tokens=2048, system prompt)

| Typ | Avg. Antwortzeit |
|-----|-----------------|
| Entity-Abfrage | 2.4 - 3.5s |
| Tool-Call | 2.1 - 4.6s |
| OPENCLAW-Delegation | 2.1 - 6.7s |
| Edge Cases | 3.8 - 5.9s |

## Notizen

- Non-streaming: TTFT = Total Time (Server sendet alles auf einmal)
- Parallel: 2 Slots konfiguriert, ~1.6x Throughput bei 2 Requests
- VRAM: ~7.8 GB von 11 GB belegt (Modell + Embedding-Server)
