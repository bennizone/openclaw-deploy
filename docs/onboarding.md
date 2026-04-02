# Onboarding State-Datei

## Format von `~/.openclaw-deploy-state.json`

```json
{
  "onboarding_complete": false,
  "phases": {
    "interview": { "done": true, "timestamp": "2026-03-30T14:00:00Z" },
    "gpu_server": { "done": true, "timestamp": "2026-03-30T14:30:00Z" },
    "lxc_setup": { "done": false },
    "plugins": { "done": false },
    "agents": { "done": false },
    "memory": { "done": false },
    "channels": { "done": false },
    "ha_integration": { "done": false, "skipped": true },
    "verification": { "done": false }
  },
  "config": {
    "gpu_server_ip": "192.168.1.100",
    "gpu_ssh_user": "admin",
    "ha_url": "https://homeassistant.local:8123",
    "agent_names": ["benni", "household"],
    "default_agent": "benni",
    "gpu_parallel": 2,
    "gpu_ctx_size": 32768,
    "channels": ["whatsapp"]
  }
}
```

Diese Datei wird vom `/onboard` Agent bei jeder abgeschlossenen Phase aktualisiert.
Die `config`-Sektion speichert Interview-Antworten fuer spaetere Referenz.
