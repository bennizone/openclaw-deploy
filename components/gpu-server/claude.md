# Agent-Scope: GPU-Server

## Meine Dateien

```
setup/gpu-server/
├── build-llama-cpp.sh              # llama.cpp klonen + CUDA-Build
├── detect-nvidia.sh                # GPU-Erkennung
├── download-models.sh              # Modelle von HuggingFace laden
└── systemd/
    ├── llama-chat.service.template # Chat-Server (Qwen 3.5 9B)
    └── llama-embed.service.template # Embedding-Server (bge-m3)

config/versions.json                # Modell-Versionen + Parameter
```

Auf dem GPU-Server selbst:
```
~/llama.cpp/                        # llama.cpp Source + Build
~/llama.cpp/build/bin/llama-server  # Kompiliertes Binary
~/models/                           # GGUF Modell-Dateien
~/.config/systemd/user/             # Installierte Service-Files
```

## Meine Verantwortung

- llama.cpp Build-Scripts (CUDA-Support)
- Modell-Download-Scripts (HuggingFace)
- systemd Service-Templates fuer Chat + Embedding
- Modell-Parameter (ctx-size, parallel, kv-cache, reasoning-budget)
- VRAM-Management (beide Server muessen ins VRAM passen)
- `config/versions.json` — Modell-Versionen und Parameter-Dokumentation

## Build & Deploy

```bash
# llama.cpp bauen (auf GPU-Server via SSH)
ssh <GPU_USER>@<GPU_SERVER_IP>
bash ~/openclaw-deploy/setup/gpu-server/build-llama-cpp.sh

# Modelle laden
bash ~/openclaw-deploy/setup/gpu-server/download-models.sh

# Services installieren + starten
cp setup/gpu-server/systemd/llama-*.service.template ~/.config/systemd/user/
# GPUUSER in den Dateien ersetzen
systemctl --user daemon-reload
systemctl --user enable --now llama-chat llama-embed
```

## Pflichten nach jeder Aenderung

- description.md aktuell halten bei Modellwechsel oder Parameter-Aenderungen
- testinstruct.md aktualisieren bei neuen Test-Szenarien
- decisions.md fuehren bei Modell-Entscheidungen
- `config/versions.json` synchron halten mit deployed Modellen

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| Gateway-Config (models.providers.llama) | **gateway** |
| Welches Modell fuer welchen Agent | **gateway** |
| Memory-Extraktion (warum kein Qwen) | **memory-system** |
| HA-Voice Qwen-Integration | **ha-integration** |
| CPU Embedding Fallback auf LXC | **onboard** (Setup) |
| Modell-Auswahl Benchmark | **memory-system** / **ha-integration** |
