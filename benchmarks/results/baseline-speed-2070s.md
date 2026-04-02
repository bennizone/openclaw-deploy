# Speed Baseline: RTX 2070 SUPER

**Datum:** 2026-04-02
**Modell:** Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf (Q4_K_M, ~5.6 GB)
**GPU:** NVIDIA GeForce RTX 2070 SUPER (8192 MiB, ~6249 MiB belegt)
**Server:** llama.cpp (rebuild CUDA_ARCHITECTURES=75), --parallel 2, --ctx-size 32768, --reasoning-budget 2048, --flash-attn auto, --cache-type-k q4_0 --cache-type-v q4_0

## Single Request (no thinking, max_tokens=64)

| Metrik | Wert | vs 1080 Ti |
|--------|------|-----------|
| TTFT (= Antwortzeit, non-streaming) | 1248 ms | 1794 ms (-30%) |
| Completion Tokens | 64 | 64 |
| t/s | 51.3 | 35.7 (+44%) |

## Parallel (2 concurrent, no thinking, max_tokens=64)

| Metrik | Wert | vs 1080 Ti |
|--------|------|-----------|
| Wall Time | 1695 ms | 2212 ms (-23%) |
| Combined Tokens | 125 | 128 |
| Combined t/s | 73.7 | 57.9 (+27%) |
| Speedup vs Single | 1.4x | 1.6x |

## Vergleich 1080 Ti → 2070s

| Metrik | 1080 Ti | 2070s | Delta |
|--------|---------|-------|-------|
| Single t/s | 35.7 | 51.3 | **+44%** |
| Parallel t/s | 57.9 | 73.7 | **+27%** |
| TTFT | 1794 ms | 1248 ms | **-30%** |
| VRAM total | 11264 MiB | 8192 MiB | -27% |
| VRAM belegt | 7812 MiB | 6249 MiB | -20% |
| ctx-size | 196608 | 32768 | -83% (VRAM-Limit) |

## Notizen

- 2070s (Turing, Compute 7.5) braucht llama.cpp mit `-DGGML_CUDA_ARCHITECTURES=75`
- Pascal-Build (ARCHS=610) crashed mit CUDA abort auf Turing
- ctx-size 32768 statt 196608 wegen 3 GB weniger VRAM — reicht fuer HA (typisch <4K tokens)
- Ollama war nach Boot aktiv und musste deaktiviert werden (VRAM-Konflikt)
- flash-attn und KV-Cache q4_0 sind aktiv
