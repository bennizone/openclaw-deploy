# Agent-Scope: Onboard

## Meine Dateien

```
.claude/commands/onboard.md            # Wizard-Logik (Slash-Command)
~/.openclaw-deploy-state.json          # Fortschritts-Tracking

setup/lxc/
├── bootstrap.sh                       # LXC Bootstrap
├── install-openclaw.sh                # OpenClaw CLI
├── install-qdrant.sh                  # Qdrant Docker
├── install-llama-embed.sh            # CPU Embedding Fallback
├── deploy-home-llm.sh                # HA Deploy
└── systemd/                          # Service-Dateien

setup/gpu-server/
├── build-llama-cpp.sh                # CUDA Build
├── detect-nvidia.sh                   # GPU-Erkennung
├── download-models.sh                 # Modell-Download
└── systemd/                          # GPU Service-Dateien

config/
├── openclaw.template.json            # Config-Template
├── secrets.example.env
└── extractor.env.template
```

## Meine Verantwortung

- Alle Setup-Scripts (LXC + GPU-Server)
- Interaktiver Onboard-Wizard (Slash-Command)
- State-Management (`~/.openclaw-deploy-state.json`)
- Initiale Config-Generierung aus Template
- systemd Service-Installation (Gateway + Extractor)

### Kritische Regeln (NICHT verletzen!)

1. **Node 24 VOR OpenClaw installieren** — fnm PATH muss gesetzt sein bevor npm install
2. **loginctl enable-linger** — PFLICHT fuer systemd User-Services nach Reboot
3. **Interaktive Befehle nie via `!`** — WhatsApp-Login immer in separatem Terminal
4. **Sessions NIE produktiv loeschen** — Nur bei Bootstrap eines NEUEN Agents erlaubt

## Build & Deploy

Kein Build — Setup-Scripts werden direkt ausgefuehrt.

```bash
# Neues System: Onboard-Wizard starten
# → /onboard in Claude Code

# Bootstrap einzeln ausfuehren
sudo bash setup/lxc/bootstrap.sh

# GPU-Server einzeln
ssh <GPU_USER>@<GPU_IP> bash ~/openclaw-deploy/setup/gpu-server/build-llama-cpp.sh
```

## Pflichten nach jeder Aenderung

- description.md aktuell halten bei neuen Phasen oder Abhaengigkeiten
- testinstruct.md aktualisieren bei neuen Pre-Flight-Checks
- decisions.md fuehren bei Setup-Entscheidungen
- Scripts idempotent halten (mehrfach ausfuehrbar ohne Schaden)

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| openclaw.json Aenderungen nach Setup | **gateway** |
| Plugin-Entwicklung | **openclaw-skills** |
| GPU-Modell-Parameter | **gpu-server** |
| Qdrant Collections + Schema | **memory-system** |
| HA Custom Component Code | **ha-integration** |
| Agent SOUL.md Inhalte | **gateway** |
