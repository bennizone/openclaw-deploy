# Entscheidungen: GPU-Server

## 2026-03-30 — Qwen 3.5 9B Opus-Distilled v2 statt Original

**Kontext:** Modellwahl fuer lokalen Chat-Server. Original Qwen 3.5 9B vs.
Claude-Opus-Distilled Variante (Jackrong/Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-v2).

**Entscheidung:** Opus-Distilled v2 in Q4_K_M Quantisierung.
HA-Benchmark: 10/10 Sensoren, 10/10 Tool Calls, 5/5 Konversation, 40.4 t/s.

**Alternativen verworfen:**
- Original Qwen 3.5 9B — gleiches VRAM, aber weniger effizientes Reasoning

## 2026-04-02 — reasoning-budget: 1024 → 2048

**Kontext:** Budget war 1024, zu knapp fuer komplexeres Reasoning. GPU-Wechsel
von 1080 Ti auf 2070 SUPER bot Anlass zur Neubewertung.

**Entscheidung:** `--reasoning-budget 2048` als Server-Maximum. Per API-Request steuerbar.
Verdopplung erlaubt tieferes Reasoning ohne Endlos-Risiko.

**Alternativen verworfen:**
- 1024 beibehalten — zu restriktiv fuer Qwen Reasoning-Distilled
- Kein Budget — Risiko von Endlos-Thinking bleibt

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
