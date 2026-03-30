# /gpu-server-admin — GPU-Server Verwaltung

Du verwaltest den GPU-Server fuer das OpenClaw-System.
Verbindung via SSH. Die IP und der User kommen aus der Setup-Konfiguration.

## Verbindung

Die GPU-Server-Daten findest du in `~/.openclaw-deploy-state.json` (config-Sektion) oder in der `openclaw.json`
(GPU-IP unter `models.providers.llama.baseUrl`).

```bash
ssh <user>@<gpu-ip>
```

## Services

### Chat-Server (Qwen 3.5 9B)
```bash
# Status
ssh <user>@<gpu-ip> 'systemctl --user status llama-chat'

# Logs
ssh <user>@<gpu-ip> 'journalctl --user -u llama-chat -f'

# Neustart
ssh <user>@<gpu-ip> 'systemctl --user restart llama-chat'

# Health-Check
curl -s http://<gpu-ip>:8080/health | jq .
```

### Embedding-Server (bge-m3)
```bash
# Status
ssh <user>@<gpu-ip> 'systemctl --user status llama-embed'

# Health-Check
curl -s http://<gpu-ip>:8081/health | jq .
```

## VRAM-Monitoring
```bash
ssh <user>@<gpu-ip> 'nvidia-smi'
ssh <user>@<gpu-ip> 'nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv'
```

## Modell-Parameter (aktuell)

### Qwen 3.5 9B Opus-Distilled v2
- Quantisierung: Q4_K_M
- Context: 98304 (2 Slots a 49152)
- KV-Cache: Q4_0 (spart ~1.5 GB VRAM vs F16)
- Parallel: 2
- Reasoning-Budget: 1024
- VRAM: ~5700 MB + ~600 MB (bge-m3) = ~6300 MB gesamt

### bge-m3
- Quantisierung: Q8_0
- Dimension: 1024
- Pooling: CLS
- Context: 2048

## Modell tauschen

1. Neues Modell herunterladen:
   ```bash
   ssh <user>@<gpu-ip> 'cd ~/models && curl -LO <url>'
   ```
2. systemd Service anpassen (Modell-Pfad aendern)
3. Service neustarten
4. Health-Check + VRAM pruefen
5. In `openclaw.json` das Modell-ID und Context-Window anpassen

## Troubleshooting

- **VRAM voll:** `nvidia-smi` pruefen, ggf. Context-Window oder parallel reduzieren
- **Langsam:** KV-Cache Quantisierung pruefen (q4_0 empfohlen)
- **Nicht erreichbar:** Firewall pruefen, `--host 0.0.0.0` im Service?
- **Crash-Loop:** Logs pruefen, VRAM-Limit ueberschritten?

## Verhalten
- Vor Service-Neustarts warnen (laufende Anfragen werden abgebrochen)
- VRAM-Budget im Auge behalten
- Bei Modell-Wechsel: Benchmark empfehlen (`/tester`)
