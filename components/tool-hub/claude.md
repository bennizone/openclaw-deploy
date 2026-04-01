# Agent-Scope: Tool-Hub

## Meine Dateien

```
services/openclaw-tools/
├── src/                      # Gesamter Source-Code
│   ├── index.ts              # Einstiegspunkt + Tool-Registrierung
│   ├── tools/*.ts            # Tool-Implementierungen
│   ├── clients/*.ts          # Externe API-Clients
│   ├── lib/*.ts              # Hilfs-Module (Logging, Merge, PIM-Access, Titel-Resolver)
│   └── config/pim.json       # PIM-Quellen + Agent-Berechtigungen
├── package.json              # Dependencies + Build-Scripts
├── tsconfig.json             # TypeScript-Config
└── DECISIONS.md              # Lokale Entscheidungen
```

## Meine Verantwortung

- Alle MCP-Tools die externe Services ansprechen
- Tool-Registrierung und Schnittstellendefinition (Zod-Schemas)
- API-Clients fuer externe Services (MiniMax, DDG, Sonarr, Radarr, CalDAV, CardDAV)
- PIM Agent-Scoping (welcher Agent darf auf welche Quellen zugreifen)
- Debug-Logging aller Tool-Calls
- Ergebnis-Deduplizierung bei Multi-Source-Abfragen (Web-Suche)
- Deutsche Titelaufloesung bei Medien-Suche (UmlautAdaptarr-Middleware hilft zusaetzlich)

## Build & Deploy

```bash
cd ~/openclaw-deploy/services/openclaw-tools/
npm run build          # tsc + config copy (rm -rf dist/config vor cp!)
# Deploy = Gateway-Restart (Tool-Hub ist Kindprozess)
systemctl --user restart openclaw-gateway
# Verify
curl -s http://localhost:18789/health
```

- Build-Output liegt in `dist/` — wird vom Gateway via stdio gestartet
- `dist/config/` wird bei jedem Build frisch kopiert (stale-config Bug vermeiden)
- Kein eigener systemd-Service — laeuft als Teil des Gateways

## Pflichten nach jeder Aenderung

- description.md aktuell halten bei neuen Tools oder geaenderten Schnittstellen
- testinstruct.md aktualisieren bei neuen Tools (Test-Case hinzufuegen)
- decisions.md fuehren bei nicht-trivialen Entscheidungen
- pim.json dokumentieren wenn neue Quellen oder Agents hinzukommen

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| Gateway-Config (`openclaw.json`, tools.mcp, tools.deny) | **gateway** |
| Plugin-System (openclaw.plugin.json, Hooks) | **openclaw-skills** |
| Memory-Recall Plugin (Qdrant-Abfragen) | **memory-system** |
| Modell-Config (welches LLM antwortet) | **gateway** |
| GPU-Server (llama.cpp, VRAM) | **gpu-server** |
| HA-Voice Plugin (before_prompt_build Hook) | **openclaw-skills** / **ha-integration** |
