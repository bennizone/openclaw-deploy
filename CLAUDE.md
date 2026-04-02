# CLAUDE.md — OpenClaw Deploy

Dieses Repo enthält alles, um einen kompletten OpenClaw Smart-Home-Stack reproduzierbar aufzusetzen.
Claude Code ist der Setup-Assistent und langfristige Admin.

## Onboarding-Erkennung (WICHTIG — bei jedem Start pruefen!)

Beim Start: Lies die Datei `~/.openclaw-deploy-state.json` (KEINE Runtime-Checks noetig).

**Datei existiert und `"onboarding_complete": true`:** System ist eingerichtet. Normal arbeiten.

**Datei existiert aber `"onboarding_complete": false`:**
- Begruesse den User auf Deutsch
- Zeige den aktuellen Fortschritt: "Onboarding ist bei Phase X. Soll ich weitermachen?"
- Die Checkliste in der Datei zeigt welche Phasen erledigt sind

**Datei existiert NICHT:**
- Begruesse den User: "Willkommen! Das OpenClaw-System ist noch nicht eingerichtet."
- "Starte mit `/onboard` um das Setup zu beginnen."

Fuehre KEINE anderen Aufgaben aus bis das Onboarding abgeschlossen ist (ausser `/helper` fuer Fragen).

Dateiformat: Siehe [docs/onboarding.md](docs/onboarding.md)

## Quick-Start

- **Neues System aufsetzen:** `/onboard`
- **Hilfe zum System:** `/helper`
- **Wartungsmodus:** Siehe `docs/maintenance-mode.md`
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
| `plugins/` | 2 OpenClaw Plugins (ha-voice, memory-recall) | LXC: ~/.openclaw/extensions/ |
| `services/openclaw-tools/` | Tool-Hub MCP Server (Search, Vision, Sonarr/Radarr, Kalender, Kontakte) | LXC: MCP via Gateway |
| `services/extractor/` | Memory-Extractor Service | LXC: ~/extractor/ |
| `services/home-llm/` | HA Custom Component | Home Assistant |
| `setup/lxc/` | LXC Setup-Scripts + systemd | LXC |
| `setup/gpu-server/` | GPU Setup-Scripts + systemd | GPU-Server |
| `agents/` | Agent-Workspace-Templates | LXC: ~/.openclaw/workspace-*/ |
| `config/` | Config-Templates + Versions | Generiert nach ~/.openclaw/ |
| `scripts/` | consult-agent (MiniMax + Chunking), reflect-auto, orchestrator-audit, autonomy-status | LXC: Repo |

## Modell-Routing

> Konsolidierte Routing-Referenz (Agent-Auswahl, Scopes, Hooks): [docs/agent-routing.md](docs/agent-routing.md)

Tool-Hub MCP: Zentraler MCP-Server fuer alle externen Tools. Tool-Referenz: Siehe [docs/tool-hub.md](docs/tool-hub.md)

## Netzwerk-Ports

| Port | Service | Host |
|------|---------|------|
| 18789 | OpenClaw Gateway | LXC |
| 6333 | Qdrant | LXC (Docker) |
| 8080 | llama.cpp Chat | GPU-Server |
| 8081 | llama.cpp Embedding | GPU-Server + LXC (Fallback) |

## Orchestrator-Protokoll

Claude Code ist der Orchestrator. Er schreibt keinen Code selbst,
sondern koordiniert spezialisierte Komponenten-Agenten.
**WARNUNG:** Orchestrator schreibt KEINEN Code. Auch nicht "nur kurz" oder
"nur eine Datei". IMMER `/coder` delegieren — auch fuer neue Dateien.

### Agenten-Uebersicht

Lies `components/*/description.md` fuer eine aktuelle Uebersicht
aller Komponenten, ihrer Faehigkeiten und Abhaengigkeiten.

Lies `components/*/description.md` um zu entscheiden, welche
Komponenten betroffen sind. Nutze den jeweiligen Agenten fuer
Konsultation (MiniMax) und Implementierung (Claude/coder).

### Modell-Zuweisung

| Aufgabe | Modell |
|---------|--------|
| Orchestrierung, Coding (`/coder`), Review (`/reviewer`) | Claude (Pro/Max) |
| Konsultation, Tests, Protokoll, Routine | MiniMax (via chatCompletions) |

Konsultation via Helper-Script:
```bash
scripts/consult-agent.sh <komponente> "<frage>"
scripts/consult-agent.sh <komponente> "<frage>" --with-decisions
```

Das Script liest Token, description.md und Scopes-Header automatisch.

Chunked Map-Reduce fuer grosse Datenmengen:
```bash
scripts/consult-agent.sh <komponente> "<map-prompt>" \
  --input-file <daten.txt> \
  --reduce-prompt "<konsolidierungs-prompt>" \
  --delay 3 --overlap 5
```

Das Script chunkt die Datei automatisch, sendet Chunks parallel an MiniMax,
und konsolidiert die Ergebnisse. Nutzen statt Claude fuer Analyse-Aufgaben.

### Workflow-Tracking (PFLICHT)

Bei jedem nicht-trivialen Workflow: ALLE Schritte (1-14 inkl. /reflect) als Tasks
anlegen (TaskCreate) BEVOR mit der Arbeit begonnen wird. Keine nachtraeglichen
Ergaenzungen — die vollstaendige Task-Liste muss ab Schritt 1 stehen.
Tasks in der Statusleiste zeigen dem User und dem Orchestrator den Fortschritt.
Status laufend aktualisieren (pending → in_progress → completed).
Abhaengigkeiten setzen (addBlockedBy). Tasks die aufgrund der Anfrage
uebersprungen werden: Status auf completed mit Begruendung im Description-Feld.

Vollstaendiger Workflow (Schritte 1-14): Siehe [docs/workflow.md](docs/workflow.md)

### Stuetzraeder-Protokoll (Graduierte Autonomie)

Jede Komponente hat ein Autonomie-Level (0-3). Siehe `docs/stuetzraeder-protokoll.md`.
Daten in `config/autonomy.json`. CLI: `python3 scripts/autonomy-status.py status|check|record|suggest-promotions|promote`.

### Manuelle Aufrufe

Der User kann jeden Agent auch direkt aufrufen — das ueberschreibt die automatische Auswahl.

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
- **OpenClaw-Agents haben kein Tool zum Config-Schreiben** — das ist die primaere Absicherung
- Claude Code ist der einzige Prozess der `openclaw.json` aendern darf

### Config-Aenderungs-Protokoll (IMMER einhalten!)

Schritte: Siehe [docs/config-protocol.md](docs/config-protocol.md)

## CLAUDE.md Pflege

Diese Datei soll eine knappe Referenz bleiben. Details (Ablaeufe, Testdaten,
Architektur-Erklaerungen) gehoeren in eigene Dateien (`docs/`, `benchmarks/README.md`,
`components/*/`). Hier nur Einzeiler, Tabellen-Eintraege und Verweise.

## Kritische Lektionen (NICHT wiederholen!)

1. **Node 24 VOR OpenClaw installieren** — sonst PATH-Probleme
2. **Config nur ueber Claude Code aendern** — Agent hat Config zerschossen, deshalb: Backup → Aendern → Validieren → Commit
3. **bge-m3 = 1024 Dimensionen** — NICHT 1536, sonst Memory kaputt
4. **Config validieren vor Speichern** — Ollama-Einbindung hat Config zerstoert
5. **Agent NICHT sich selbst reparieren lassen** — Claude Code ist externer Repair-Agent
6. **loginctl enable-linger** — Pflicht, sonst starten Services nicht nach Reboot
7. **tools.profile = "full"** — Andere Profile filtern Plugin-Tools still weg
8. **plugins.slots.memory = "none"** — Eigenes Memory-System (Qdrant + Extractor)
9. **Matrix-Channel: `dm: {}` statt `dmPolicy`** — Matrix nutzt verschachteltes Schema, WhatsApp-Style Keys crashen den Gateway
10. **Matrix-Binding: `peer` statt `from`** — `"peer": { "kind": "direct", "id": "@user:server" }`, nicht `"from"`
11. **Conduit Join braucht `{"reason":""}`** — Leeres `{}` wird mit M_BAD_JSON abgewiesen
12. **Bootstrap-Anweisung IN SOUL.md** — MiniMax ignoriert spaeter injizierte Dateien; kritische Anweisungen muessen in SOUL.md stehen
13. **Sessions loeschen NUR bei Bootstrap-Reset** — JSONL-Sessions sind produktive Konversationsdaten und Quelle fuer den Memory-Extractor. NIEMALS im laufenden Betrieb loeschen! Nur bei Erst-Einrichtung (Bootstrap) eines neuen Agents.
14. **agents.defaults.userTimezone setzen** — Ohne `"userTimezone": "Europe/Berlin"` injiziert OpenClaw KEIN Datum/Uhrzeit in den System-Prompt. Agent kennt dann weder Datum noch Tageszeit.

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
| `/ha-admin` | HA-Verwaltung | Sonnet |
| `/reviewer` | Code-Review | Sonnet |
| `/tester` | Tests + Checks | Haiku |
| `/docs` | Dokumentation | Haiku |
| `/consult` | Einzelnen Komponenten-Agent via MiniMax befragen | — |
| `/plan-review` | Konsultationsrunde an betroffene Agenten | — |
| `/reflect` | Session Self-Reflection (Token-Waste Analyse) | — |
| `/bench` | LLM-Benchmark (interaktiv, Ergebnisse in `benchmarks/`) | Sonnet |
| `/audit` | System-Audit (10 Kategorien, Ergebnisse in `docs/audits/`) | Haiku |

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
~/.claude/projects/.../*.jsonl     # Claude Code Session-JSONLs (fuer /reflect)
docs/audits/                       # Audit-Ergebnisse (Checklisten, Reife-Score)
```
