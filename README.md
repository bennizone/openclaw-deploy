# OpenClaw Deploy

Reproduzierbares Setup fuer einen kompletten OpenClaw Smart-Home-Stack mit Claude Code als interaktivem Setup-Assistenten.

## Was wird aufgesetzt?

- **OpenClaw Gateway** — Multi-Agent Smart-Home-Assistent (WhatsApp, Matrix, HA Voice)
- **GPU-Server** — Lokales LLM (Qwen 3.5 9B) + Embeddings (bge-m3) via llama.cpp
- **Memory-System** — Qdrant Vektordatenbank + automatische Fakten-Extraktion
- **Home Assistant Integration** — Sprachassistent als HA Conversation Agent
- **3 Plugins** — HA Voice, Memory Recall, Sonarr/Radarr (HA-Skill optional via ClaWHub)

## Voraussetzungen

- **Proxmox-Server** (oder anderer Hypervisor fuer LXC/VM)
- **GPU-Server** — Ubuntu >= 24.04 LTS, NVIDIA GPU mit min. 8 GB VRAM
- **Home Assistant** — Optional, fuer Sprachassistent-Integration
- **MiniMax API-Key** — Fuer das primaere LLM ([minimax.io](https://www.minimax.io))
- **Anthropic Account** — Fuer Claude Code Auth (Pro/Max)
- **Auf dem LXC** werden ausserdem benoetigt: `python3-pip`, `ffmpeg`, `build-essential`, `cmake` (das `bootstrap.sh` Script installiert alles automatisch)

## Installation

### 1. LXC erstellen

Auf dem Proxmox-Host ausfuehren (Werte anpassen!):

```bash
mode=generated \
  var_cpu="3" \
  var_ram="8192" \
  var_disk="16" \
  var_hostname="openclaw" \
  var_net="static" \
  var_gateway="192.168.1.1" \
  var_net="192.168.1.99/24" \
  var_ssh="yes" \
  var_nesting="1" \
  var_pw="CHANGEME" \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/docker.sh)"
```

> Generator: https://community-scripts.org/generator?script=docker

### 2. User einrichten

Als `root` im LXC:

```bash
# User anlegen
adduser openclaw
usermod -aG sudo,docker openclaw

# Passwordless sudo
echo "openclaw ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/openclaw
chmod 440 /etc/sudoers.d/openclaw

# WICHTIG: Damit systemd Services ohne Login starten
loginctl enable-linger openclaw
```

### 3. Claude Code + Git installieren

Als `openclaw` User:

```bash
su - openclaw

# Node.js 24
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 24
fnm default 24

# npm global prefix (fuer OpenClaw, nicht fuer Claude Code)
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Claude Code (NICHT per npm — native Installer verwenden!)
curl -fsSL https://claude.ai/install.sh | bash

# Git
sudo apt install -y git
```

> **Wichtig:** Claude Code NICHT per `npm install -g @anthropic-ai/claude-code` installieren!
> Der npm-Install wird automatisch zum Native-Installer migriert, was zu Problemen fuehrt.
> Immer den offiziellen Installer verwenden.

### 4. Claude Code authentifizieren

```bash
claude
# Auth-Prozess im Browser durchfuehren
# Danach: /exit
```

> **Tipp fuer das Onboarding:** Claude Code kann mit `claude --dangerously-skip-permissions`
> gestartet werden, um Bestaetigungsdialoge zu ueberspringen. Das spart erheblich Zeit,
> da das Setup viele Dateisystem- und Netzwerk-Operationen ausfuehrt.
> **Achtung:** Nur verwenden wenn das Repo aus einer vertrauenswuerdigen Quelle stammt.
> Nach dem Setup normal ohne dieses Flag arbeiten.

### 5. Repo klonen

```bash
git clone https://github.com/<dein-user>/openclaw-deploy.git
cd openclaw-deploy
```

### 6. Setup starten

```bash
claude
```

Dann im Claude Code:

```
/onboard
```

Claude Code fuehrt dich durch das komplette Setup:
- Interview (GPU-Server IP, API-Keys, Channels, Agent-Namen)
- GPU-Server einrichten (NVIDIA, llama.cpp, Modelle)
- OpenClaw + Plugins installieren
- Memory-System aufsetzen
- Channels einrichten (WhatsApp, Matrix, ...)
- Home Assistant Integration (optional)

## Nach dem Setup

### Hilfe

```
/helper    # Ueberblick, was wo laeuft
```

### Services pruefen

```bash
systemctl --user status openclaw-gateway
systemctl --user status openclaw-extractor
systemctl --user status llama-embed-fallback
docker ps  # Qdrant
```

### Logs

```bash
journalctl --user -u openclaw-gateway.service -f
```

### Verfuegbare Claude Code Commands

| Command | Beschreibung |
|---------|-------------|
| `/onboard` | Komplett-Setup |
| `/helper` | System-Ueberblick + Hilfe |
| `/coder` | Code schreiben/aendern |
| `/openclaw-expert` | Tiefes OpenClaw-Wissen |
| `/openclaw-skill-creator` | Neue Skills erstellen |
| `/docker-admin` | Docker/Qdrant verwalten |
| `/gpu-server-admin` | GPU-Server verwalten |
| `/reviewer` | Code-Review |
| `/tester` | Tests + Health-Checks |
| `/docs` | Dokumentation pflegen |

## Projektstruktur

```
openclaw-deploy/
├── CLAUDE.md              # Claude Code Systemwissen
├── README.md              # Diese Datei
├── .claude/commands/      # 10 Slash-Commands (Agenten)
├── config/                # Config-Templates + Versions
├── plugins/               # 3 OpenClaw Plugins (Source)
├── services/              # Extractor + Home LLM
├── setup/                 # Setup-Scripts + systemd
├── agents/                # Agent-Workspace-Templates
├── troubleshooting/       # Bekannte Probleme + Loesungen
└── docs/                  # Architektur + Anleitungen
```

## Sicherheit

- Secrets werden NIE in Git gespeichert
- `openclaw.json` ist im Betrieb schreibgeschuetzt (chmod 444)
- OpenClaw kann sich nicht selbst administrieren
- Claude Code ist der einzige Config-Editor
- API-Keys liegen in `~/.openclaw/.env` (von OpenClaw auto-gelesen)
