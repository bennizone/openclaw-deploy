# CLAUDE.md — OpenClaw Deploy

Dieses Repo enthält alles, um einen kompletten OpenClaw Smart-Home-Stack reproduzierbar aufzusetzen.
Claude Code ist der Setup-Assistent und langfristige Admin.

## Onboarding-Erkennung (WICHTIG — bei jedem Start pruefen!)

Beim Start IMMER pruefen ob das Onboarding abgeschlossen ist:

1. Pruefe ob `~/.openclaw/openclaw.json` existiert UND `chmod 444` hat
2. Pruefe ob `systemctl --user is-active openclaw-gateway` aktiv ist
3. Pruefe ob Qdrant laeuft: `docker ps --filter name=qdrant`

**Wenn ALLE drei OK:** System ist eingerichtet. Normal arbeiten.

**Wenn NICHT alle OK:** Onboarding ist unvollstaendig oder noch nicht gestartet.
- Begruesse den User auf Deutsch
- Erklaere kurz: "Das OpenClaw-System ist noch nicht vollstaendig eingerichtet."
- Wenn `~/.openclaw-setup.env` existiert: "Das Onboarding wurde bereits begonnen. Soll ich dort weitermachen wo wir aufgehoert haben?"
- Wenn nicht: "Starte mit `/onboard` um das Setup zu beginnen."
- Fuehre KEINE anderen Aufgaben aus bis das Onboarding abgeschlossen ist (ausser `/helper` fuer Fragen).

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

## Automatische Agent-Nutzung (PFLICHT)

Claude Code waehlt automatisch den richtigen spezialisierten Agent basierend auf der Aufgabe.
Der User muss die Agents NICHT manuell aufrufen.

### Agent-Auswahl nach Kontext

| Situation | Agent | Modell |
|-----------|-------|--------|
| User will Code schreiben/aendern | `/coder` | Sonnet |
| User fragt nach OpenClaw Config/Architektur | `/openclaw-expert` | Sonnet |
| User will neuen Skill erstellen | `/openclaw-skill-creator` | Sonnet |
| User hat Docker/Qdrant-Problem | `/docker-admin` | Haiku |
| User hat GPU-Server-Problem | `/gpu-server-admin` | Haiku |
| User fragt "was ist...", "wie geht...", "wo finde ich..." | `/helper` | Haiku |
| Onboarding laeuft | `/onboard` | Sonnet |

### Automatische Pipeline nach Code-Aenderungen (IMMER!)

Nach JEDER Code-Aenderung wird automatisch diese Pipeline durchlaufen:

```
Code-Aenderung abgeschlossen
  │
  ├── 1. Build: `npm run build` (wenn Plugin/Service)
  │
  ├── 2. `/reviewer` (Sonnet) — Code-Review gegen Checkliste
  │     └── Bei Problemen: Fix → zurueck zu 1.
  │
  ├── 3. `/tester` (Haiku) — Health-Checks + Tests
  │     └── Bei Fehlern: Diagnose → Fix → zurueck zu 1.
  │
  ├── 4. Commit — Aenderungen committen mit aussagekraeftiger Message
  │
  └── 5. `/docs` (Haiku) — DECISIONS.md aktualisieren (wenn nicht-trivial)
```

Diese Pipeline ist NICHT optional. Claude Code fuehrt sie automatisch aus.
Der User wird nur informiert, nicht gefragt (ausser bei Review-Problemen).

### Manuelle Aufrufe

Der User kann jeden Agent auch direkt aufrufen — das ueberschreibt die automatische Auswahl.

## Workflow-Regeln

### Code-Aenderungen
1. **Plan erstellen** und mit User besprechen
2. **Freigabe** abwarten
3. **Baseline-Commit** vor Aenderungen
4. **Implementieren** — `/coder` (Sonnet)
5. **Build** — `npm run build` / `openclaw plugins doctor`
6. **Review** — `/reviewer` (Sonnet) automatisch
7. **Test** — `/tester` (Haiku) automatisch
8. **Commit** — automatisch
9. **Dokumentieren** — `/docs` (Haiku) automatisch bei nicht-trivialen Aenderungen

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
