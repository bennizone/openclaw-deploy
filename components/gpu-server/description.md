# GPU-Server

## Zweck

Dedizierter Server mit NVIDIA GPU fuer lokale LLM-Inferenz. Betreibt zwei llama.cpp
Instanzen: Qwen 3.5 9B fuer Chat (Port 8080) und bge-m3 fuer Embeddings (Port 8081).
Bietet OpenAI-kompatible APIs fuer alle Komponenten im LAN.

## Architektur

```
GPU-Server (${GPU_SERVER_IP})
├── llama-server :8080 — Qwen 3.5 9B Opus-Distilled v2 (Chat, CUDA)
│   ├── Modell: Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf (5.63 GB)
│   ├── ctx-size: 196608, parallel: 2 → 98304 pro Slot
│   ├── kv-cache: q4_0 (Quantisierung spart VRAM)
│   ├── flash-attn: auto
│   ├── reasoning-budget: 1024 (verhindert Endlos-Thinking)
│   ├── threads: 1 (Inference), threads-batch: nproc-2 (dynamisch)
│   └── jinja: Template-Support fuer Chat-Formate
│
├── llama-server :8081 — bge-m3 Q8_0 (Embedding, CUDA)
│   ├── Modell: bge-m3-q8_0.gguf (634 MB)
│   ├── ctx-size: 2048, pooling: cls
│   ├── Dimension: 1024 (NICHT 1536!)
│   └── VRAM: ~600 MB
│
├── ~/llama.cpp/                # llama.cpp Source + Build
│   └── build/bin/llama-server  # Kompiliert mit CUDA
│
└── ~/models/                   # GGUF Modell-Dateien
    ├── Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M.gguf
    └── bge-m3-q8_0.gguf

Setup-Scripts (im Repo):
setup/gpu-server/
├── build-llama-cpp.sh          # llama.cpp klonen + CUDA-Build
├── detect-nvidia.sh            # GPU-Erkennung
├── download-models.sh          # Modelle von HuggingFace laden
└── systemd/
    ├── llama-chat.service.template    # Chat-Server Service
    └── llama-embed.service.template   # Embedding-Server Service
```

## Abhaengigkeiten

- **Braucht:**
  - NVIDIA GPU mit min. 8 GB VRAM
  - NVIDIA Treiber + CUDA Toolkit
  - cmake, g++, git, make (Build-Tools)
  - python3 + pip (fuer huggingface-cli)
- **Wird gebraucht von:**
  - **gateway** — Qwen 3.5 9B als Fallback-LLM
  - **ha-integration** — Qwen 3.5 9B als primaeres LLM fuer HA-Voice
  - **memory-system** — bge-m3 als primaerer Embedding-Server
  - **openclaw-skills** — Qwen 3.5 9B fuer Smart Home Routing-Klassifikation
  - **tool-hub** — indirekt (ueber Gateway/Agents die Tools nutzen)

## Schnittstellen

- **Chat API (Port 8080):**
  - OpenAI-kompatibel: `POST /v1/chat/completions`
  - Modelle: `Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M`
  - Streaming: unterstuetzt
  - Health: `GET /health`
- **Embedding API (Port 8081):**
  - OpenAI-kompatibel: `POST /v1/embeddings`
  - Modelle: `bge-m3`
  - Output: 1024-dimensionaler Vektor
  - Health: `GET /health`

## Konfiguration

| Was | Wo |
|-----|-----|
| Chat-Server Parameter | systemd Service-File (ExecStart) |
| Embedding-Server Parameter | systemd Service-File (ExecStart) |
| Modell-Dateien | `~/models/` auf GPU-Server |
| Modell-Versionen | `config/versions.json` im Repo |
| GPU-Server IP | `~/.openclaw/.env` → `GPU_SERVER_IP` |

## Bekannte Einschraenkungen

- **Kein Hot-Reload** — Modellwechsel erfordert Service-Restart
- **VRAM-Limit** — Qwen 3.5 9B + bge-m3 muessen zusammen in GPU-VRAM passen
- **reasoning-budget: 1024** — Verhindert Endlos-Thinking, begrenzt aber Reasoning-Tiefe
- **parallel: 2** — Nur 2 gleichzeitige Chat-Requests (98304 Tokens pro Slot)
- **CPU Embedding Fallback auf LXC** — Wenn GPU-Server ausfaellt, localhost:8081 auf LXC
- **Kein Qwen-Fallback fuer Extraction** — Qwen halluziniert bei Memory-Extraktion (siehe memory-system)

## Neues Feature hinzufuegen

### Neues Modell deployen
1. Modell herunterladen: `huggingface-cli download <repo> <file> --local-dir ~/models`
2. `config/versions.json` im Repo aktualisieren
3. systemd Service-File anpassen (Modell-Pfad, Parameter)
4. Service neustarten: `systemctl --user restart llama-chat` / `llama-embed`
5. Gateway-Config anpassen wenn Modell-ID sich aendert (`openclaw.json` → `models.providers.llama`)

### llama.cpp updaten
1. SSH auf GPU-Server
2. `cd ~/llama.cpp && git pull`
3. `rm -rf build && bash ~/openclaw-deploy/setup/gpu-server/build-llama-cpp.sh`
4. Services neustarten
