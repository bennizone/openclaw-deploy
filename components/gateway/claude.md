# Agent-Scope: Gateway

## Meine Dateien

```
config/
├── openclaw.template.json     # Config-Template (versioniert im Repo)
├── versions.json              # Versionspinning aller Komponenten
├── secrets.example.env        # ENV-Beispiel
└── extractor.env.template     # Extractor-ENV-Beispiel

~/.openclaw/
├── openclaw.json              # Produktive Config (chmod 444, NUR Claude Code aendert!)
├── .env                       # Secrets (wird von OpenClaw auto-gelesen)
└── workspace-*/               # Agent-Workspaces (SOUL.md, Conversation JSONL)

~/.config/systemd/user/
└── openclaw-gateway.service   # systemd User-Service
```

## Meine Verantwortung

- Die zentrale Config `openclaw.json` — Struktur, Validierung, Versionierung
- Modell-Routing: Welches LLM fuer welchen Agent/Zweck
- Agent-Definitionen: ID, Name, Workspace, Bindings
- Channel-Config: WhatsApp, Matrix (mit deren spezifischen Schema-Eigenheiten)
- Plugin-Registrierung: Welche Plugins aktiv, welche Config sie bekommen
- MCP-Server-Registrierung: Tool-Hub Startkommando + ENV
- Tool-Profile und Deny-Listen
- Gateway-spezifische Settings: Port, Auth, HTTP-Endpoints

### Kritische Regeln (NICHT verletzen!)

1. **Config nur ueber Claude Code** — Agent darf openclaw.json NICHT schreiben
2. **Config validieren vor Speichern** — `jq .` MUSS fehlerfrei sein
3. **tools.profile = "full"** — Andere Profile filtern Plugin-Tools still weg
4. **plugins.slots.memory = "none"** — Eigenes Memory-System, nicht builtin
5. **Matrix: `dm: {}` statt `dmPolicy`** — Verschachteltes Schema
6. **Matrix: `peer` statt `from`** — `"peer": { "kind": "direct", "id": "..." }`
7. **Conduit: `{"reason":""}` bei Join** — Leeres `{}` = M_BAD_JSON
8. **userTimezone setzen** — Ohne kein Datum/Uhrzeit im System-Prompt

## Build & Deploy

```bash
# Config-Aenderungs-Protokoll (IMMER!)
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
# ... Aenderung vornehmen ...
jq . < ~/.openclaw/openclaw.json > /dev/null   # Validieren
diff ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
systemctl --user restart openclaw-gateway
curl -s http://localhost:18789/health           # Health-Check
# Bei Fehler: cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
```

Kein Build-Schritt noetig — Gateway ist eine fertige Binary.
Config-Template im Repo (`config/openclaw.template.json`) bei strukturellen Aenderungen aktualisieren.

## Pflichten nach jeder Aenderung

- description.md aktuell halten bei neuen Config-Sections oder Schnittstellen
- testinstruct.md aktualisieren bei neuen Test-Szenarien
- decisions.md fuehren bei Config-Entscheidungen
- `config/openclaw.template.json` synchron halten mit produktiver Config
- `config/versions.json` aktualisieren bei Version-Updates

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| MCP Tool-Code (web_search, arr_*, calendar_*, contacts_*) | **tool-hub** |
| Plugin-Code (Hooks, Tool-Implementierung) | **openclaw-skills** |
| Memory-Pipeline (Extractor, Qdrant) | **memory-system** |
| GPU-Server (llama.cpp, Modell-Dateien) | **gpu-server** |
| HA Custom Component (home-llm) | **ha-integration** |
| LXC Setup (Bootstrap, Pakete) | **onboard** |
