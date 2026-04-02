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

### Format von `~/.openclaw-deploy-state.json`

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

## Modell-Routing

> Konsolidierte Routing-Referenz (Agent-Auswahl, Scopes, Hooks): [docs/agent-routing.md](docs/agent-routing.md)

| Aufgabe | Primaer | Fallback |
|---------|---------|----------|
| Chat (persoenlich) | MiniMax M2.7 (API) | Qwen 3.5 9B (GPU-Server) |
| HA Voice (Household) | Qwen 3.5 9B (GPU-Server) | MiniMax M2.7 |
| Embeddings | bge-m3 (GPU-Server:8081) | bge-m3 CPU (localhost:8081) |
| Vision/Bilder | MiniMax M2.7 nativ (inline) | understand_image Tool-Hub → MiniMax VLM API |
| Web-Suche | web_search Tool-Hub (DDG + MiniMax merged) | web_fetch (URL-Abruf) |

### OpenClaw Tool-Hub MCP (`services/openclaw-tools/`)

Zentraler MCP-Server fuer alle externen Tools. Eingebautes `web_search` ist via
`tools.deny` deaktiviert, der Tool-Hub uebernimmt.

- **`web_search`** — fragt DuckDuckGo + MiniMax Search parallel ab, merged + dedupliziert
- **`understand_image`** — Bildanalyse ueber MiniMax VLM API (Qwen-Fallback fuer Vision)
- **`arr_search`** — Suche in Sonarr/Radarr mit 3-stufiger deutscher Titelaufloesung
- **`arr_add_movie`** / **`arr_add_series`** — Medien zur Bibliothek hinzufuegen
- **`arr_series_detail`** — Staffel-Uebersicht mit Download-Status
- **`arr_episode_list`** — Episoden einer Staffel mit Details
- **`arr_calendar`** — Naechste Episoden/Filme + Download-Queue
- **`arr_add_collection`** — Komplette Film-Collection hinzufuegen
- **`calendar_events`** — Termine abrufen (Zeitraum, pro Agent gefiltert)
- **`calendar_create`** / **`calendar_update`** / **`calendar_delete`** — Termine verwalten (braucht `readwrite`)
- **`calendar_search`** — Freitext-Suche ueber Termine
- **`contacts_search`** — Kontakte nach Name/Email/Telefon suchen
- **`contacts_create`** / **`contacts_update`** — Kontakte verwalten (braucht `readwrite`)
- **`contacts_birthdays`** — Anstehende Geburtstage (Kontakte + Kalender, dedupliziert)
- **`weather`** — Aktuelles Wetter + Vorhersage via Open-Meteo (Geocoding + Forecast, kein API-Key)

PIM-Tools sind **agentspezifisch**: `pim.json` definiert welcher Agent auf welche
CalDAV/CardDAV-Quellen zugreifen darf (`read` oder `readwrite`).

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

### Workflow bei neuen Features / Aenderungen

1. Ziel klaeren mit User
2. Betroffene Komponenten identifizieren (`components/*/description.md` lesen — PFLICHT, nicht ueberspringen!)
3. Plan-Entwurf mit Checkliste:
   - [ ] Ziel definiert
   - [ ] Nutzer/Zielgruppe
   - [ ] Sicherheit
   - [ ] Laufzeitumgebung
   - [ ] Abhaengigkeiten
   - [ ] Testbarkeit
4. Konsultationsrunde: Betroffene Agenten via MiniMax befragen (`/consult`) — NICHT ueberspringen, kostet fast nichts
5. Plan konsolidieren, Konflikte aufloesen
6. User-Freigabe — bei Level 2+ Standard-Ops (read, write) ohne extra Freigabe
   (Autonomie-Level pruefen: `python3 scripts/autonomy-status.py check <comp> <op>`)
7. Coding via `/coder` (Claude) — liest vorher `claude.md` der Komponente
8. Build: `npm run build` / `openclaw plugins doctor`
9. `/tester` liest `testinstruct.md`, fuehrt Tests aus — mindestens Health-Checks + Plugin-Doctor
10. `/reviewer` prueft — listet Findings (mechanisch + Design)
10a. Mechanische Findings (unused imports, Tippfehler, fehlende stderr) → Orchestrator delegiert an `/coder` (NIE selbst fixen!)
10b. Design-Findings die den Workflow BLOCKIEREN (Architektur, API-Bruch, Sicherheit) → SOFORT User-Input holen
10c. Nicht-blockierende Design-Findings → auf TODO-Liste parken, in Zusammenfassung (Schritt 13) anzeigen
11. Protokollant (`/docs`): DECISIONS.md zentral + lokal
12. Betroffene Agenten aktualisieren ihre MDs (description, testinstruct)
13. Ship it: Commit + Deploy — Zusammenfassung zeigt geparkte Design-Findings aus 10c
14. Reflection (optional): `/reflect` — MiniMax analysiert Session auf Token-Waste,
    Orchestrator ergaenzt, `/reviewer` prueft, User gibt frei. Skip mit "skip"

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

Bei jeder Aenderung an `openclaw.json`:
1. **Backup:** `cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak`
2. **Aendern**
3. **Validieren:** `jq . < ~/.openclaw/openclaw.json > /dev/null` (muss fehlerfrei sein)
4. **Diff pruefen:** `diff ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json`
5. **Gateway neustarten:** `systemctl --user restart openclaw-gateway`
6. **Health-Check:** `curl -s http://localhost:18789/health`
7. **Git:** Aenderung committen (Config ist versioniert → jede Aenderung nachvollziehbar)

Bei Fehler nach Schritt 3-6: `cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json` → sofortiger Rollback

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
```
