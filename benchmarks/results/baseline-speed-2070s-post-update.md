# Speed Baseline: RTX 2070 SUPER (Post llama.cpp + Treiber Update)

**Datum:** 2026-04-02
**Modell:** Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf (Q4_K_M, ~5.6 GB)
**GPU:** NVIDIA GeForce RTX 2070 SUPER (8192 MiB)
**Treiber:** NVIDIA 580.126.09 (CUDA 13.0) — vorher: 535.288.01 (CUDA 12.2)
**llama.cpp:** e15efe0 (version 61) — vorher: b6509718 (version 1)
**Server:** --parallel 2, --ctx-size 65536, --reasoning-budget 2048, --flash-attn auto, --cache-type-k q4_0 --cache-type-v q4_0

## Single Request (no thinking, max_tokens=64)

| Metrik | Wert | vs Baseline (ctx 32768) |
|--------|------|------------------------|
| TTFT | 1292 ms | 1248 ms (+3%) |
| Completion Tokens | 64 | 64 |
| t/s | 49.0 | 51.3 (-4%) |

## Parallel (2 concurrent, no thinking, max_tokens=64)

| Metrik | Wert | vs Baseline (ctx 32768) |
|--------|------|------------------------|
| Wall Time | 1782 ms | 1695 ms (+5%) |
| Combined Tokens | 128 | 125 |
| Combined t/s | 71.8 | 73.7 (-3%) |

## Bewertung

- Speed ~4% langsamer als Baseline, aber ctx-size verdoppelt (32768 → 65536)
- Mehr Context = mehr KV-Cache VRAM = leicht weniger Durchsatz
- Bei gleichem ctx-size waere Performance gleich oder besser
- Neuer Treiber (580/CUDA 13.0) und llama.cpp (v61) bringen:
  - `--reasoning-budget-message` Flag (neu)
  - Diverse CUDA-Optimierungen (mmvq, fattn-tile, KV-cache quantization improvements)
  - Bugfixes fuer KV-Cache und Flash-Attention

## Notizen

- NVIDIA-Treiber sprang von 535 direkt auf 580 (apt waehlte neueste Version)
- Ollama war disabled, kein VRAM-Konflikt
- ctx-size 65536 statt 32768 — Onboarding hatte 32768 gesetzt, wurde zwischenzeitlich erhoeht
- Nach Reboot mussten alte llama-server Prozesse manuell gekillt werden (auto-restart via systemd llama-llm.service)
