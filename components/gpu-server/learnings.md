# GPU-Server Learnings

## 2026-04-04: CPU-Bottleneck-Analyse & Optimierung

### Problem
Ein CPU-Kern lief bei 100% während GPU-Inference, GPU throttelte auf 80-90% trotz Thermal Headroom.

### Ursachen
1. **llama-server Single-Thread Bug (#13197):** llama-server kann Prompt-Processing nicht
   multi-threaded ausführen (im Gegensatz zu llama-cli). CPU kann GPU nicht schnell genug füttern.
2. **Qwen 3.5 Cache-Reuse Bug (#20225, #19858):** Jeder Turn verarbeitet den kompletten Prompt neu
   wegen Hybrid-Architektur (Attention + Mamba2/SSM). KV-Cache-Reuse funktioniert nicht.

### Optimierungen (alle angewendet)
| Flag | Impact | Details |
|------|--------|---------|
| `--no-mmap` | **Hoch** | Cold TTFT -81% (626ms → 119ms). Eliminiert Page-Fault-Serialisierung. |
| `-b 4096 -ub 512` | Mittel | Weniger CPU-GPU-Syncs bei Prefill. Default war -b 2048. |
| `--parallel 1` | Mittel | 31% schneller als parallel=2 bei Single-User. Voller 65K Context. |
| `--threads 2` | Niedrig | Hilft bei CPU-seitigem Scheduling auch bei Full GPU Offload. |

### Ergebnisse
- Cold Prefill: 7 t/s → 39 t/s
- Generation: unverändert ~54 t/s (war schon GPU-bound)
- GPU-Auslastung: 80-90% → 94-95%

### TurboQuant Evaluation
- TurboQuant (KV-Cache-Kompression) ist bei Single-User/normalem Kontext **langsamer** als q4_0
- Ggerganov hat die Rotation aus TurboQuant am 01.04.2026 in Mainline gemerged (PR #21038)
- Unser llama.cpp Build (post-merge) hat den Kern-Benefit bereits
- TurboQuant lohnt sich erst bei >100K Kontext oder Multi-User

### NVFP4
- NVIDIA FP4 braucht Blackwell-Architektur (Compute Cap 10.0+)
- RTX 2070 Super (Turing, 7.5) kann das NICHT

### Benchmark-Setup
- Zweites llama.cpp in ~/llama-bench.cpp/ für Tests neben Produktion
- Embedding-Server muss gestoppt werden für VRAM-intensive Modelle
- ctx-size 32768 für Benchmarks (spart VRAM, reicht für HA-Tests)
- 19 Modelle als GGUF in ~/models/bench/ heruntergeladen

### Wichtig für zukünftige Änderungen
- Immer Baseline-Speed-Test VOR Änderungen (`--speed-only`)
- Embedding-Server belegt ~500MB VRAM — bei OOM zuerst stoppen
- `--flash-attn auto` kann bei manchen Modellen crashen → `--flash-attn` explizit oder weglassen testen
