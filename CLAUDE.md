# CLAUDE.md — OpenClaw Deploy

Dieses Repo enthält alles, um einen kompletten OpenClaw Smart-Home-Stack reproduzierbar aufzusetzen.
Claude Code ist der Setup-Assistent und langfristige Admin.

## Quick-Start

- **Neues System aufsetzen:** `/onboard`
- **Hilfe zum System:** `/helper`
- **Alle Commands:** Siehe Abschnitt "Slash-Commands" unten

## Architektur

```
Proxmox / Bare-Metal
├── GPU-Server: ${GPU_SERVER_IP}
│   ├── llama-server (Port 8080) — Qwen 3.5 9B Chat
│   ├── llama-server (Port 8081) — bge-m3 Embedding
│   └── NVIDIA GPU (min. 8 GB VRAM)
│
├── OpenClaw LXC: ${LXC_IP}
│   ├── OpenClaw Gateway (Port 18789) — systemd user service
│   ├── Qdrant (Port 6333) — Docker, Memory-Vektordatenbank
│   ├── llama-server (Port 8081) — bge-m3 CPU Fallback
│   ├── Memory Extractor — systemd user service
│   └── Claude Code — Setup + Admin
│
└── Home Assistant: ${HA_URL}
    └── home-llm Custom Component → OpenClaw chatCompletions
```

## Komponenten-Map

| Verzeichnis | Was | Laeuft wo |
|-------------|-----|-----------|
| `plugins/` | 4 OpenClaw Plugins (Source) | LXC: ~/.openclaw/extensions/ |
| `services/extractor/` | Memory-Extractor Service | LXC: ~/extractor/ |
| `services/home-llm/` | HA Custom Component | Home Assistant |
| `setup/lxc/` | LXC Setup-Scripts + systemd | LXC |
| `setup/gpu-server/` | GPU Setup-Scripts + systemd | GPU-Server |
| `agents/` | Agent-Workspace-Templates | LXC: ~/.openclaw/workspace-*/ |
| `config/` | Config-Templates + Versions | Generiert nach ~/.openclaw/ |

## Modell-Routing

| Aufgabe | Primaer | Fallback |
|---------|---------|----------|
| Chat (persoenlich) | MiniMax M2.7 (API) | Qwen 3.5 9B (GPU-Server) |
| HA Voice (Household) | Qwen 3.5 9B (GPU-Server) | MiniMax M2.7 |
| Embeddings | bge-m3 (GPU-Server:8081) | bge-m3 CPU (localhost:8081) |

## Netzwerk-Ports

| Port | Service | Host |
|------|---------|------|
| 18789 | OpenClaw Gateway | LXC |
| 6333 | Qdrant | LXC (Docker) |
| 8080 | llama.cpp Chat | GPU-Server |
| 8081 | llama.cpp Embedding | GPU-Server + LXC (Fallback) |

## Automatische Agent-Nutzung

Claude Code MUSS die spezialisierten Slash-Commands automatisch einsetzen:

- **Nach Code-Aenderungen:** Automatisch `/reviewer` ausfuehren bevor committet wird
- **Nach Review:** Automatisch `/tester` fuer Health-Checks ausfuehren
- **Nach nicht-trivialen Entscheidungen:** Automatisch `/docs` fuer DECISIONS.md-Update
- **Bei Plugin-Fragen:** `/openclaw-expert` oder `/openclaw-skill-creator` nutzen
- **Bei Docker/Qdrant-Problemen:** `/docker-admin` nutzen
- **Bei GPU-Server-Problemen:** `/gpu-server-admin` nutzen
- **Wenn der User Hilfe braucht:** `/helper` fuer Ueberblick

Der User muss die Agents nicht manuell aufrufen — Claude Code erkennt den Kontext und waehlt den passenden Agent.

## Workflow-Regeln

### Code-Aenderungen
1. **Plan erstellen** und mit User besprechen
2. **Freigabe** abwarten
3. **Baseline-Commit** vor Aenderungen
4. **Implementieren**
5. **Testen** — `/tester` automatisch ausfuehren
6. **Review** — `/reviewer` automatisch ausfuehren
7. **Dokumentieren** — `/docs` fuer DECISIONS.md-Update
8. **Commit**

### Mindestanforderungen
- Code muss gebaut werden koennen (`npm run build`)
- `openclaw plugins doctor` ohne Fehler
- Keine Secrets im Code (alles ueber ENV/Config)
- Version bumpen bei Plugin-Aenderungen
- DECISIONS.md bei nicht-trivialen Entscheidungen

### Feature-Entfernung
- **NIE** Features still entfernen
- Immer: Gefahrenbeurteilung + explizite User-Bestaetigung
- Dokumentieren was entfernt wurde und warum

## Admin-Policy

- **OpenClaw darf sich NICHT selbst administrieren** — Claude Code ist der einzige Config-Editor
- `openclaw.json` im Betrieb: `chmod 444` (Schreibschutz)
- Zum Aendern: `chmod 644` → Aenderung → Validierung → `chmod 444`
- Config immer syntaktisch validieren vor dem Schreiben (`jq . < openclaw.json`)
- Gateway nach Config-Aenderung neustarten: `systemctl --user restart openclaw-gateway`

## Kritische Lektionen (NICHT wiederholen!)

1. **Node 24 VOR OpenClaw installieren** — sonst PATH-Probleme
2. **openclaw.json nach Setup: chmod 444** — Agent hat Config zerschossen
3. **bge-m3 = 1024 Dimensionen** — NICHT 1536, sonst Memory kaputt
4. **Config validieren vor Speichern** — Ollama-Einbindung hat Config zerstoert
5. **Agent NICHT sich selbst reparieren lassen** — Claude Code ist externer Repair-Agent
6. **loginctl enable-linger** — Pflicht, sonst starten Services nicht nach Reboot
7. **tools.profile = "full"** — Andere Profile filtern Plugin-Tools still weg
8. **plugins.slots.memory = "none"** — Eigenes Memory-System (Qdrant + Extractor)

## Slash-Commands

| Command | Zweck | Empfohlenes Modell |
|---------|-------|--------------------|
| `/onboard` | Komplett-Setup | Sonnet |
| `/coder` | Code schreiben | Sonnet |
| `/helper` | Ueberblick + Hilfe | Haiku |
| `/openclaw-expert` | System-Fragen | Sonnet |
| `/openclaw-skill-creator` | Neue Skills | Sonnet |
| `/docker-admin` | Qdrant/Docker | Haiku |
| `/gpu-server-admin` | GPU-Server | Haiku |
| `/reviewer` | Code-Review | Sonnet |
| `/tester` | Tests + Checks | Haiku |
| `/docs` | Dokumentation | Haiku |

## ENV-Substitution

OpenClaw unterstuetzt `${VAR_NAME}` in openclaw.json:
- Secrets gehoeren in `~/.openclaw/.env`
- Nur Grossbuchstaben: `[A-Z_][A-Z0-9_]*`
- Fehlende Variable = Fehler beim Laden (kein stiller Fallback)

## Wichtige Pfade

```
~/.openclaw/openclaw.json          # Haupt-Config (chmod 444!)
~/.openclaw/.env                   # Secrets (von OpenClaw auto-gelesen)
~/.openclaw/extensions/            # Installierte Plugins
~/.openclaw/workspace-<name>/      # Agent-Workspaces
~/extractor/                       # Memory-Extractor Service
~/extractor/.env                   # Extractor-Secrets
~/models/                          # GGUF Modell-Dateien (lokal)
~/.config/systemd/user/            # systemd User-Services
```
