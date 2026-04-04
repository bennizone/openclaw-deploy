# Onboard Learnings

## 2026-04-04: GPU-Server Optimierung & HuggingFace Setup

### HuggingFace CLI auf GPU-Server
- `pip install --user --break-system-packages huggingface_hub` (Debian/Ubuntu "externally-managed" Error)
- CLI heißt jetzt `hf` (nicht `huggingface-cli`) seit huggingface_hub 1.x
- Login: `hf auth login` (nicht `hf login`)
- `~/.local/bin` muss im PATH sein: `export PATH=$HOME/.local/bin:$PATH` in ~/.bashrc

### GPU-Server Service-Template
- ctx-size im Template (32768) war veraltet, Live-Service hatte 65536 → Template aktualisiert
- Bei Deploy immer diffing gegen Live-Service: `diff ~/.config/systemd/user/llama-chat.service /tmp/new.service`
- Nach `systemctl --user disable` wird der Service beim nächsten `enable` neu verlinkt
- Zombie-Prozesse nach manuellem Testen: immer `systemctl --user stop` UND `killall` prüfen

### Modell-Downloads
- Download-Script: `hf download <repo> --include "*Q4_K_M.gguf" --local-dir <dir>`
- Für kleine Modelle (<=4B): Q5_K_M oder Q6_K bevorzugen (genug VRAM-Headroom)
- Nicht alle Repos haben exakt passende Dateinamen — `--include` mit Glob ist robuster
- Gesamtbedarf 19 Modelle: ~68 GB

### Benchmark-Marathon
- Embedding-Server MUSS gestoppt werden sonst OOM bei größeren Modellen
- ctx-size 32768 statt 65536 für Benchmarks (spart VRAM, HA-Tests brauchen max ~5K)
- run-bench.sh braucht korrekte Verzeichnisstruktur (scripts/, datasets/, results/ relativ)
- Einige Modelle crashen bei `--flash-attn auto` oder `--jinja` — Error-Recovery im Marathon-Script wichtig
