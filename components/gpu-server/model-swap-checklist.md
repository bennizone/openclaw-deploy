# Modell-Swap-Checkliste: GPU-Server

## Vorbereitung

1. VRAM-Budget pruefen — beide Server muessen zusammen ins VRAM passen:
   ```bash
   ssh <GPU_USER>@<GPU_SERVER_IP> nvidia-smi --query-gpu=memory.total,memory.used --format=csv,noheader
   ```
   - Qwen 3.5 9B Q4_K_M: ~5.63 GB
   - bge-m3 Q8_0: ~600 MB
   - Overhead: ~500 MB
   - → Min. 8 GB VRAM noetig

2. Aktuelles Setup in `config/versions.json` lesen

## Modell herunterladen

3. SSH auf GPU-Server:
   ```bash
   ssh <GPU_USER>@<GPU_SERVER_IP>
   ```

4. Modell laden:
   ```bash
   huggingface-cli download <repo> <file> --local-dir ~/models
   ```

5. Download pruefen:
   ```bash
   ls -lh ~/models/<neues-modell>.gguf
   ```

## Service anpassen

6. systemd Service-File editieren:
   ```bash
   # Chat-Modell:
   nano ~/.config/systemd/user/llama-chat.service
   # Embedding-Modell:
   nano ~/.config/systemd/user/llama-embed.service
   ```
   Anpassen: Modell-Pfad, ctx-size, parallel, kv-cache, reasoning-budget

7. Wichtige Parameter:
   - `--ctx-size`: Kontext-Fenster (Qwen: 196608, bge-m3: 2048)
   - `--parallel`: Gleichzeitige Slots (Qwen: 2 → 98304 pro Slot)
   - `--flash-attn`: Auto (CUDA)
   - `--reasoning-budget 1024`: Verhindert Endlos-Thinking (nur Chat)
   - `--pooling cls`: Nur fuer Embedding
   - ⚠ bge-m3 Dimension ist 1024 — NICHT 1536!

## Neustart

8. Service neuladen + starten:
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart llama-chat    # oder llama-embed
   ```

9. Health-Check:
   ```bash
   curl -s http://localhost:8080/health | jq .status   # Chat
   curl -s http://localhost:8081/health | jq .status   # Embed
   ```

10. VRAM nach Start pruefen:
    ```bash
    nvidia-smi
    ```

## Gateway-Config (falls Modell-ID sich aendert)

11. `openclaw.json` → `models.providers.llama` anpassen
    → Config-Aenderung: siehe `components/gateway/config-change-checklist.md`

## Dokumentation

12. `config/versions.json` im Repo aktualisieren (Modell-Name, Version, Parameter)
13. `components/gpu-server/description.md` — Architektur aktualisieren
14. `components/gpu-server/decisions.md` — Modell-Entscheidung dokumentieren

## llama.cpp selbst updaten

```bash
ssh <GPU_USER>@<GPU_SERVER_IP>
cd ~/llama.cpp && git pull
rm -rf build && bash ~/openclaw-deploy/setup/gpu-server/build-llama-cpp.sh
systemctl --user restart llama-chat llama-embed
```
