# Test-Anweisungen: GPU-Server

## Voraussetzungen

- SSH-Zugang zum GPU-Server: `ssh <GPU_USER>@<GPU_SERVER_IP>`
- NVIDIA GPU verfuegbar: `nvidia-smi`
- llama.cpp gebaut: `~/llama.cpp/build/bin/llama-server --version`
- Modelle vorhanden: `ls ~/models/*.gguf`
- systemd Services aktiv

## Health-Check

```bash
# GPU-Status
ssh <GPU_USER>@<GPU_SERVER_IP> nvidia-smi

# Chat-Server
curl -s http://<GPU_SERVER_IP>:8080/health | jq .status
# Erwartung: "ok"

# Embedding-Server
curl -s http://<GPU_SERVER_IP>:8081/health | jq .status
# Erwartung: "ok"
```

## Funktions-Tests

### Test: Chat-Completion
```bash
curl -s http://<GPU_SERVER_IP>:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M",
    "messages": [{"role": "user", "content": "Sage nur: Hallo Welt"}],
    "max_tokens": 50,
    "enable_thinking": false
  }' | jq .choices[0].message.content
```
- Erwartetes Ergebnis: "Hallo Welt" oder aehnlich
- Bei Fehler: Service-Status pruefen, VRAM pruefen (`nvidia-smi`)

### Test: Embedding
```bash
curl -s http://<GPU_SERVER_IP>:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "bge-m3", "input": "Testtext fuer Embedding"}' | jq '.data[0].embedding | length'
```
- Erwartetes Ergebnis: `1024`
- Bei Fehler: **NICHT 1536!** Wenn 1536, falsches Modell geladen

### Test: Throughput
```bash
curl -s http://<GPU_SERVER_IP>:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M",
    "messages": [{"role": "user", "content": "Zaehle von 1 bis 20"}],
    "max_tokens": 200,
    "enable_thinking": false
  }' | jq '.usage'
```
- Erwartung: ~40 t/s (tokens per second) bei HA-typischen Requests

### Test: CPU Embedding Fallback (LXC)
```bash
curl -s http://localhost:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "bge-m3", "input": "Fallback-Test"}' | jq '.data[0].embedding | length'
```
- Erwartetes Ergebnis: `1024` (identisch zum GPU-Server)
- Bei Fehler: llama-server CPU auf LXC pruefen

## Integrations-Tests

### Test: VRAM-Nutzung
```bash
ssh <GPU_USER>@<GPU_SERVER_IP> nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
```
Erwartung: Chat + Embed muessen zusammen ins VRAM passen.

### Test: Parallele Requests
Zwei gleichzeitige Chat-Requests senden (parallel: 2 konfiguriert).
Beide sollten antworten (evtl. langsamer). Dritter Request wird gequeued.

### Test: reasoning-budget
```bash
curl -s http://<GPU_SERVER_IP>:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M",
    "messages": [{"role": "user", "content": "Erklaere die Relativitaetstheorie detailliert"}],
    "max_tokens": 2000,
    "enable_thinking": true
  }' | jq '.usage.completion_tokens'
```
Erwartung: Reasoning begrenzt auf ~1024 Tokens, danach direkte Antwort.
