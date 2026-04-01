# Onboard

## Zweck

Interaktiver Setup-Wizard fuer eine komplette OpenClaw Smart-Home-Installation.
Fuehrt den User Schritt fuer Schritt durch alle Phasen: Interview, GPU-Server,
LXC-Setup, Plugin-Installation, Agent-Konfiguration, Memory-System, Channels
und Verifikation.

## Architektur

```
Onboard-System:
├── .claude/commands/onboard.md           # Slash-Command Definition (Wizard-Logik)
├── ~/.openclaw-deploy-state.json         # Fortschritts-Datei (Phasen + Config)
│
├── setup/lxc/
│   ├── bootstrap.sh                      # LXC Bootstrap (User, Node, Pakete)
│   ├── install-openclaw.sh               # OpenClaw CLI installieren
│   ├── install-qdrant.sh                 # Qdrant Docker starten
│   ├── install-llama-embed.sh            # CPU Embedding Fallback
│   ├── deploy-home-llm.sh               # home-llm nach HA deployen
│   └── systemd/
│       ├── openclaw-gateway.service      # Gateway systemd Service
│       └── openclaw-extractor.service    # Extractor systemd Service
│
├── setup/gpu-server/
│   ├── build-llama-cpp.sh               # llama.cpp CUDA Build
│   ├── detect-nvidia.sh                  # GPU-Erkennung
│   ├── download-models.sh               # Modelle laden
│   └── systemd/                          # GPU systemd Services
│
└── config/
    ├── openclaw.template.json            # Config-Template
    ├── secrets.example.env               # ENV-Beispiel
    └── extractor.env.template            # Extractor-ENV-Beispiel
```

### Phasen

| Phase | Name | Beschreibung |
|-------|------|-------------|
| 0 | interview | User-Daten sammeln (IPs, Keys, Agents, Channels) |
| 1 | gpu_server | NVIDIA-Erkennung, llama.cpp Build, Modelle laden |
| 2 | lxc_setup | Bootstrap, OpenClaw CLI, Qdrant, Embedding Fallback |
| 3 | plugins | Plugins bauen + installieren |
| 4 | agents | Agent-Workspaces + SOUL.md + openclaw.json |
| 5 | memory | Qdrant Collections, Extractor-Config + Service |
| 6 | channels | WhatsApp/Matrix konfigurieren |
| 7 | ha_integration | home-llm deployen (optional, skippable) |
| 8 | verification | End-to-End Tests aller Komponenten |

## Abhaengigkeiten

- **Braucht:**
  - Frischen LXC oder Bare-Metal mit Debian/Ubuntu
  - SSH-Zugang zu GPU-Server
  - SSH-Zugang zu HA (optional, fuer home-llm Deploy)
  - MiniMax API-Key
- **Wird gebraucht von:**
  - Alle anderen Komponenten — Onboard richtet sie ein

## Schnittstellen

- **Eingabe:** User-Antworten im interaktiven Dialog
- **Ausgabe:**
  - `~/.openclaw-deploy-state.json` — Fortschrittsstatus + Config-Daten
  - Konfigurierte + laufende Services auf LXC + GPU-Server
  - `openclaw.json` fertig generiert

## Konfiguration

Die `~/.openclaw-deploy-state.json` speichert Interview-Antworten in der `config`-Sektion:
- `gpu_server_ip`, `gpu_ssh_user` — GPU-Server Zugang
- `ha_url` — Home Assistant URL
- `agent_names`, `default_agent` — Agent-Definitionen
- `channels` — Aktivierte Channels

## Bekannte Einschraenkungen

- **Node 24 VOR OpenClaw installieren** — sonst PATH-Probleme (fnm)
- **loginctl enable-linger PFLICHT** — sonst starten systemd User-Services nicht nach Reboot
- **Interaktive Befehle nie via `!` in Claude Code** — WhatsApp-Login etc. in separatem Terminal
- **WhatsApp Error 515 harmlos** — erscheint beim ersten Login, ist normal
- **SSH-Keys muessen vorher kopiert sein** — sonst scheitern GPU-Server-Befehle
- **HA-Phase kann uebersprungen werden** — `skipped: true` in State-Datei

## Neues Feature hinzufuegen

### Neue Onboard-Phase
1. Phase in `~/.openclaw-deploy-state.json` Schema hinzufuegen
2. Logik in `.claude/commands/onboard.md` beschreiben
3. Setup-Scripts in `setup/lxc/` oder `setup/gpu-server/` erstellen
4. Verifikation in Phase 8 ergaenzen
