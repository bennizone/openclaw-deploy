# Gateway

## Zweck

Zentrales Nervensystem des OpenClaw-Systems. Der Gateway (Port 18789) verwaltet die
Haupt-Konfiguration (`openclaw.json`), routet Nachrichten an Agents, startet MCP-Server
als Kindprozesse, laedt Plugins, und stellt die chatCompletions API bereit.

## Architektur

```
openclaw-gateway (systemd user service, Port 18789)
├── openclaw.json                  # Haupt-Config (chmod 444)
├── .env                           # Secrets (auto-gelesen)
├── Agent-Routing
│   ├── bindings[] → Channel+Account → Agent-ID
│   └── agents.defaults → Fallback-Agent
├── Modell-Routing
│   ├── agents.defaults.model.primary → MiniMax M2.7
│   └── agents.defaults.model.fallbacks → Qwen 3.5 9B
├── Plugin-System
│   ├── plugins.entries → Aktivierte Plugins
│   │   ├── openclaw-ha-voice
│   │   └── openclaw-memory-recall
│   ├── plugins.slots.memory = "none" (eigenes Memory-System)
│   └── Hooks: before_prompt_build, before_model_resolve, before_message_write
├── MCP-Server
│   └── mcp.servers.openclaw-tools → Tool-Hub als Kindprozess via stdio
├── Channels
│   ├── whatsapp → DM + Gruppen-Policy
│   └── matrix (optional) → dm:{} Schema, peer-Binding
├── chatCompletions API
│   └── /v1/chat/completions → OpenAI-kompatibel
│       └── X-OpenClaw-Scopes Header fuer Agent-Routing
└── Tools
    ├── tools.profile = "full" (PFLICHT)
    ├── tools.deny = ["web_search"] (builtin deaktiviert)
    └── tools.agentToAgent → Inter-Agent-Kommunikation
```

- **Runtime:** OpenClaw Node.js Binary (`openclaw` CLI)
- **Config:** `~/.openclaw/openclaw.json` (chmod 444, nur Claude Code aendert)
- **Secrets:** `~/.openclaw/.env` (ENV-Substitution: `${VAR_NAME}`)
- **Service:** `~/.config/systemd/user/openclaw-gateway.service`

## Abhaengigkeiten

- **Braucht:**
  - **tool-hub** — wird als MCP-Kindprozess gestartet (`mcp.servers.openclaw-tools`)
  - **gpu-server** — Qwen 3.5 9B als Fallback-LLM (`models.providers.llama`)
  - **openclaw-skills** — Plugins werden beim Start geladen (`plugins.entries`)
  - **memory-system** — Memory-Recall Plugin (`plugins.entries.openclaw-memory-recall`)
  - Externe APIs: MiniMax (primaeres LLM), WhatsApp Cloud, optional Matrix
- **Wird gebraucht von:**
  - **ha-integration** — Home-LLM nutzt chatCompletions API fuer Delegation
  - **memory-system** — Extractor liest Gateway-JSONL-Logs
  - **tool-hub** — wird vom Gateway als Kindprozess verwaltet
  - **openclaw-skills** — Plugins laufen im Gateway-Prozess
  - Alle Agents und Channels kommunizieren ueber den Gateway

## Schnittstellen

- **Eingabe:**
  - WhatsApp/Matrix-Nachrichten (Channel-Layer)
  - HTTP: `POST /v1/chat/completions` (OpenAI-kompatibel, Auth: Bearer Token)
  - HTTP: `GET /health` (Health-Check)
  - Header: `X-OpenClaw-Scopes: agent:<id>` fuer Agent-Routing via API
- **Ausgabe:**
  - LLM-Antworten an Channel oder als HTTP Response
  - JSONL Conversation Logs (pro Agent-Workspace)
  - Plugin-Hook-Aufrufe (before_prompt_build, before_model_resolve, before_message_write)

## Konfiguration

| Section | Zweck |
|---------|-------|
| `auth.profiles` | API-Authentifizierung (MiniMax API Key) |
| `models.providers` | LLM-Provider (MiniMax, llama, ha-cloud-stt) |
| `agents.defaults` | Standard-Modell, Timezone, Memory-Search, Workspace |
| `agents.list[]` | Definierte Agents mit ID, Name, Workspace |
| `tools` | Tool-Profile, Deny-Liste, Agent-to-Agent, Media |
| `bindings[]` | Channel+Account → Agent-Zuordnung |
| `channels` | WhatsApp/Matrix-Config (Policy, Allowlists) |
| `gateway` | Port, Auth, HTTP-Endpoints, Node-Restrictions |
| `mcp.servers` | MCP-Server (Tool-Hub) mit Command + ENV |
| `plugins.entries` | Aktivierte Plugins + Plugin-Config |
| `plugins.slots` | Slot-Overrides (memory = "none") |
| `commands` | Native Commands + Skills |
| `session` | DM-Scope (per-channel-peer) |

ENV-Variablen in `~/.openclaw/.env`:
- `MINIMAX_API_KEY` — MiniMax LLM + Search
- `GATEWAY_AUTH_TOKEN` — API-Authentifizierung
- `GPU_SERVER_IP` — IP des GPU-Servers
- `HA_URL`, `HA_LONG_LIVED_TOKEN` — Home Assistant
- CalDAV/CardDAV-Credentials (an Tool-Hub durchgereicht)
- Sonarr/Radarr URLs + Keys (an Tool-Hub durchgereicht)

## Bekannte Einschraenkungen

- **Config nur ueber Claude Code aendern** — Agent hat Config mal zerschossen; deshalb: Backup → Aendern → Validieren → Commit
- **Config validieren vor Speichern** — Ollama-Einbindung hat Config zerstoert, immer `jq .` pruefen
- **Agent darf sich NICHT selbst reparieren** — Claude Code ist externer Repair-Agent
- **tools.profile MUSS "full" sein** — Andere Profile filtern Plugin-Tools still weg
- **plugins.slots.memory = "none"** — Eigenes Memory-System (Qdrant + Extractor), kein builtin
- **Matrix: `dm: {}` statt `dmPolicy`** — Matrix nutzt verschachteltes Schema, WhatsApp-Style Keys crashen
- **Matrix: `peer` statt `from`** — `"peer": { "kind": "direct", "id": "@user:server" }`
- **Conduit Join braucht `{"reason":""}`** — Leeres `{}` wird mit M_BAD_JSON abgewiesen
- **userTimezone MUSS gesetzt sein** — Ohne `"userTimezone": "Europe/Berlin"` injiziert OpenClaw kein Datum/Uhrzeit
- **ENV-Substitution nur Grossbuchstaben** — `[A-Z_][A-Z0-9_]*`, fehlende Variable = Fehler beim Laden

## Neues Feature hinzufuegen

### Neuen Agent anlegen
1. In `agents.list[]` neuen Eintrag mit `id`, `name`, `workspace`
2. Workspace-Verzeichnis anlegen: `mkdir -p ~/.openclaw/workspace-<name>/`
3. SOUL.md im Workspace erstellen (kritische Anweisungen gehoeren hierhin)
4. Optional: Binding fuer Channel-Zuordnung in `bindings[]`
5. Gateway neustarten

### Neuen Channel aktivieren
1. In `channels` neuen Eintrag (WhatsApp/Matrix)
2. Fuer Matrix: `dm: { policy: "allowlist", allowFrom: [...] }` (NICHT `dmPolicy`)
3. Fuer Matrix-Binding: `peer: { kind: "direct", id: "@user:server" }` (NICHT `from`)
4. Gateway neustarten

### Config-Aenderungs-Protokoll (IMMER einhalten!)
1. `cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak`
2. Aendern
3. `jq . < ~/.openclaw/openclaw.json > /dev/null` (muss fehlerfrei)
4. `diff ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json`
5. `systemctl --user restart openclaw-gateway`
6. `curl -s http://localhost:18789/health`
7. Aenderung committen
8. Bei Fehler: `cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json` → Rollback
