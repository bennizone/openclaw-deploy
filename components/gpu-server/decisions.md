# Entscheidungen: GPU-Server

## 2026-03-30 — Qwen 3.5 9B Opus-Distilled v2 statt Original

**Kontext:** Modellwahl fuer lokalen Chat-Server. Original Qwen 3.5 9B vs.
Claude-Opus-Distilled Variante (Jackrong/Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-v2).

**Entscheidung:** Opus-Distilled v2 in Q4_K_M Quantisierung.
HA-Benchmark: 10/10 Sensoren, 10/10 Tool Calls, 5/5 Konversation, 40.4 t/s.

**Alternativen verworfen:**
- Original Qwen 3.5 9B — gleiches VRAM, aber weniger effizientes Reasoning

## 2026-03-30 — reasoning-budget: 1024

**Kontext:** Qwen 3.5 kann endlos "denken" (Thinking-Tokens), was bei einfachen
Anfragen unnoetig Latenz erzeugt.

**Entscheidung:** `--reasoning-budget 1024` als Sicherheit. Begrenzt Thinking-Tokens,
verhindert Endlos-Schleifen. Fuer HA-Voice reicht das bei weitem.

**Alternativen verworfen:**
- Kein Budget — Risiko von 7000+ Thinking-Tokens bei trivialen Fragen
- Thinking komplett deaktivieren — verliert Reasoning-Faehigkeit

## 2026-03-30 — KV-Cache q4_0 + parallel: 2

**Kontext:** 196608 ctx-size braucht viel VRAM. Zwei parallele Slots fuer gleichzeitige Requests.

**Entscheidung:** `--cache-type-k q4_0 --cache-type-v q4_0` spart ~60% KV-Cache VRAM.
`--parallel 2` ergibt 98304 Tokens pro Slot. Flash-Attention auto.

**Alternativen verworfen:**
- FP16 KV-Cache — passt nicht ins VRAM mit 2 Slots
- parallel: 1 — blockiert bei gleichzeitigen Requests

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
