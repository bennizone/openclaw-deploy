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

## Checklisten (VOR der Aktion lesen!)

| Wenn du...                       | Lies zuerst...              |
|----------------------------------|-----------------------------|
| ein neues Tool baust             | `new-tool-checklist.md`     |
| deployst / Gateway neustartest   | `deploy-checklist.md`       |
| E2E-Tests durchfuehrst          | `testinstruct.md`           |
| die Architektur verstehen willst | `description.md`            |

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| Gateway-Config (`openclaw.json`, tools.mcp, tools.deny) | **gateway** |
| Plugin-System (openclaw.plugin.json, Hooks) | **openclaw-skills** |
| Memory-Recall Plugin (Qdrant-Abfragen) | **memory-system** |
| Modell-Config (welches LLM antwortet) | **gateway** |
| GPU-Server (llama.cpp, VRAM) | **gpu-server** |
| HA-Voice Plugin (before_prompt_build Hook) | **openclaw-skills** / **ha-integration** |
