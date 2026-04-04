# Entscheidungen: GPU-Server

## 2026-04-04 — Ministral-3 3B statt Qwen 3.5 9B Opus-Distilled

**Kontext:** Benchmark-Marathon ueber 19 Modelle (Dense + Thinking, 7-9B und kleiner).
Qwen3.5-9B Opus-Distilled war 2629ms pro Request. Ziel: schnelleres HA-Modell mit
zuverlaessigem Tool-Calling.

**Entscheidung:** Ministral-3 3B Instruct (Q4_K_M, 2 GB) als neues HA-Primary-Modell.
- 9x schneller: 300ms vs 2629ms
- 60% weniger VRAM: 2 GB vs 5.3 GB
- 100% Tool-Calls (mit Prompt-Anpassung: "Nutze IMMER die verfuegbaren Tools")
- parallel=2 moeglich mit f16 KV-Cache (6.2 GB total mit Embedding)
- Kein Thinking-Overhead (Ministral hat kein Thinking)

**Setup:** parallel=2, f16 KV-Cache, ctx 32768 (2x16k), --no-mmap, -b 4096

**System-Prompt angepasst:** "Nutze IMMER die verfuegbaren Tools um Geraete zu steuern."
hinzugefuegt — ohne diesen Hinweis antwortet Ministral mit Text statt Tool-Calls.

**Thinking-Budget:** DEFAULT_THINKING_BUDGET 256→0 (Ministral hat kein Thinking)

**Alternativen getestet:**
- Qwen3-8B: 448ms, 100% Tools, aber 5 GB VRAM und Thinking-Budget nicht steuerbar
- Qwen3-4B: 238ms, nur 1/4 Tools ohne Thinking (braucht Thinking fuer Tool-Calls)
- Qwen3.5-9B/4B vanilla: 0% Tool-Calls (kein Tool-Calling ohne Opus-Distilling)
- DeepSeek-R1-0528-Qwen3-8B: 5068ms, zu langsam
- Ministral-8B-2410 (alt): 0% Tools (kein Tool-Template im GGUF)
- Ministral-3 8B: 1/4 Tools, fragt zu oft nach
- Alle anderen Dense (Hermes, Dolphin, Granite, Llama, Mistral-7B): 0% Tools (fehlendes Template)

**Qwen-Fallback aus OpenClaw entfernt** — lokales LLM als OpenClaw-Fallback ist nicht sinnvoll,
MiniMax M2.7 ist zuverlässiger. Lokales LLM fokussiert sich auf HA-Steuerung.

## 2026-03-30 — Qwen 3.5 9B Opus-Distilled v2 statt Original

**Kontext:** Modellwahl fuer lokalen Chat-Server. Original Qwen 3.5 9B vs.
Claude-Opus-Distilled Variante (Jackrong/Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-v2).

**Entscheidung:** Opus-Distilled v2 in Q4_K_M Quantisierung.
HA-Benchmark: 10/10 Sensoren, 10/10 Tool Calls, 5/5 Konversation, 40.4 t/s.

**Alternativen verworfen:**
- Original Qwen 3.5 9B — gleiches VRAM, aber weniger effizientes Reasoning

## 2026-04-02 — ctx-size 196608, reasoning-budget 3000 + budget-message

**Kontext:** ctx-size war 32768 (Onboarding-Default), Budget 1024→2048.
VRAM-Tests zeigten: 196608 ctx + bge-m3 Embed passt mit 488 MiB Puffer auf RTX 2070 SUPER.
llama.cpp Update brachte `--reasoning-budget-message`.

**Entscheidung:**
- `--ctx-size 196608` mit parallel=2 → 98304 pro Slot
- `--reasoning-budget 3000` (~60s bei 50 t/s) als Server-Cap
- `--reasoning-budget-message "Okay, I have enough information to answer."` (englisch, Qwen-Training)
- home-llm steuert eigenes Budget per Request (Default 256)
- OpenClaw-Fallback bekommt volles Server-Budget (3000) fuer maximale Qualitaet

**Alternativen verworfen:**
- Unlimitiertes Budget (-1) — Risiko von Endlos-Thinking
- 2048 beibehalten — OpenClaw-Fallback profitiert von mehr Thinking-Raum
- Deutsche Budget-Message — Qwen auf englischen Think-Tokens trainiert

## 2026-04-02 — GPU-Erkenntnisse ins Onboarding

**Kontext:** GPU-Wechsel 1080 Ti → 2070 SUPER zeigte: CUDA_ARCHITECTURES muss zur
GPU passen (Pascal-Build crasht auf Turing), ctx-size ist VRAM-abhaengig, Ollama
kollidiert mit llama.cpp.

**Entscheidung:**
- `build-llama-cpp.sh` erkennt GPU-Arch automatisch via `nvidia-smi --query-gpu=compute_cap` (Fallback: sm_80)
- `detect-nvidia.sh` warnt bei Ollama, deaktiviert aber NICHT automatisch
- Onboarding Phase 1 fragt User nach parallel=1/2 und ctx-size Strategie
- User-Entscheidungen in `deploy-state.json` gespeichert (`gpu_parallel`, `gpu_ctx_size`)

**Alternativen verworfen:**
- Ollama automatisch deaktivieren — User koennte es parallel nutzen wollen
- ctx-size hardcoden — verschiedene GPUs brauchen verschiedene Werte

## 2026-03-30 — KV-Cache q4_0 + parallel: 2

**Kontext:** 196608 ctx-size braucht viel VRAM. Zwei parallele Slots fuer gleichzeitige Requests.

**Entscheidung:** `--cache-type-k q4_0 --cache-type-v q4_0` spart ~60% KV-Cache VRAM.
`--parallel 2` ergibt 98304 Tokens pro Slot. Flash-Attention auto.
Seit 2026-04-02: parallel und ctx-size im Onboarding mit User abstimmbar.

**Alternativen verworfen:**
- FP16 KV-Cache — passt nicht ins VRAM mit 2 Slots
- parallel: 1 — blockiert bei gleichzeitigen Requests (jetzt aber als Option angeboten)

## 2026-03-28 — bge-m3 Q8_0 fuer Embeddings

**Kontext:** Embedding-Modell fuer Memory-System (Dense + BM25 Hybrid Search).

**Entscheidung:** bge-m3 Q8_0, 1024-dim, cls-Pooling. ~600 MB VRAM.
Separater llama-server auf Port 8081. CPU-Fallback auf LXC.

**Alternativen verworfen:**
- 1536-dim Modelle — nicht kompatibel mit Qdrant-Collection-Schema
- GPU-shared mit Chat — separate Prozesse sind stabiler

## 2026-03-30 — Dynamische threads-batch Berechnung

**Kontext:** Verschiedene GPU-Server haben unterschiedliche CPU-Konfigurationen.

**Entscheidung:** `THREADS_BATCH = nproc - 2` (dynamisch berechnet via ExecStartPre).
1 Thread fuer Inference, 1 Reserve fuer OS, Rest fuer Batch-Processing. Minimum: 2.

**Alternativen verworfen:**
- Hardcoded Thread-Count — nicht portabel zwischen Systemen
