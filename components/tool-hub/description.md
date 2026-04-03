# Tool-Hub

## Zweck

Zentraler MCP-Server (Model Context Protocol) fuer alle externen Tools des OpenClaw-Systems.
Stellt Web-Suche, Bildanalyse, Medien-Verwaltung (Sonarr/Radarr), Kalender und Kontakte
als einheitliche Tool-Schnittstelle bereit. Laeuft als Kindprozess des Gateways via stdio.

## Architektur

```
services/openclaw-tools/
├── src/
│   ├── index.ts              # Einstiegspunkt, Tool-Registrierung, Debug-Logging-Wrapper
│   ├── tools/
│   │   ├── web-search.ts     # web_search (DDG + MiniMax merged)
│   │   ├── understand-image.ts # understand_image (MiniMax VLM)
│   │   ├── arr.ts            # arr_search, arr_add_movie, arr_add_series, arr_series_detail,
│   │   │                     #   arr_episode_list, arr_calendar, arr_add_collection
│   │   ├── calendar.ts       # calendar_events, calendar_create, calendar_update,
│   │   │                     #   calendar_delete, calendar_search
│   │   ├── contacts.ts       # contacts_search, contacts_create, contacts_update,
│   │   │                     #   contacts_birthdays
│   │   └── weather.ts        # weather (Open-Meteo: Geocoding + Forecast)
│   ├── clients/
│   │   ├── minimax.ts        # MiniMax Client (re-export von @openclaw/minimax-client MiniMaxPlatformClient)
│   │   ├── duckduckgo.ts     # DuckDuckGo Scraper
│   │   ├── sonarr.ts         # Sonarr REST Client
│   │   ├── radarr.ts         # Radarr REST Client
│   │   ├── caldav.ts         # CalDAV Client (tsdav)
│   │   └── carddav.ts        # CardDAV Client (tsdav)
│   ├── lib/
│   │   ├── debug-log.ts      # Tool-Call Logging (~/.openclaw/logs/tools/)
│   │   ├── merge.ts          # Ergebnis-Deduplizierung (Web-Suche)
│   │   ├── pim-access.ts     # Agent-Scoping fuer PIM (liest pim.json)
│   │   ├── title-resolver.ts # Deutsche Titelaufloesung (Arr)
│   │   └── types.ts          # Gemeinsame TypeScript-Typen
│   └── config/
│       └── pim.json          # PIM-Quellen + Agent-Berechtigungen
├── package.json              # v1.2.0, Dependencies: @openclaw/minimax-client, @modelcontextprotocol/sdk, tsdav, duck-duck-scrape, zod
├── tsconfig.json
└── dist/                     # Build-Output (wird von Gateway gestartet)
```

- **Sprache:** TypeScript (ES2022, NodeNext)
- **Build:** `npm run build` (tsc + config copy)
- **Runtime:** Node 24 (nativer fetch)
- **Protokoll:** MCP via stdio (kein eigener Port)

## Abhaengigkeiten

- **Braucht:**
  - **gateway** — startet Tool-Hub als MCP-Kindprozess, leitet Tool-Calls weiter
  - **gpu-server** — nicht direkt, aber MiniMax API fuer web_search + understand_image
  - Externe APIs: DuckDuckGo, MiniMax Search/VLM, Sonarr, Radarr, CalDAV/CardDAV-Server, Open-Meteo (Wetter)
- **Wird gebraucht von:**
  - **gateway** — stellt Tools fuer alle Agents bereit
  - **ha-integration** — HA-Voice nutzt Tools (Kalender, Medien) via Gateway
  - **openclaw-skills** — Skills koennen Tool-Hub-Tools aufrufen
  - **memory-system** — indirekt (Extractor verarbeitet Tool-Ergebnisse aus Sessions)

## Schnittstellen

- **Eingabe:** MCP Tool-Calls via stdio (JSON-RPC). Jeder Call enthaelt Tool-Name + Parameter.
  PIM-Tools erhalten `agent_id` als Parameter fuer Scoping.
- **Ausgabe:** MCP Tool-Results (JSON-RPC). Format: `{ content: [{ type: "text", text: "..." }] }`
- **Logging:** Alle Calls werden automatisch nach `~/.openclaw/logs/tools/YYYY-MM-DD.log` geschrieben (7 Tage Retention).

## Konfiguration

| Was | Wo |
|-----|-----|
| MiniMax API Key | `~/.openclaw/.env` → `MINIMAX_API_KEY` |
| Sonarr URL + Key | `~/.openclaw/.env` → `SONARR_URL`, `SONARR_API_KEY` |
| Radarr URL + Key | `~/.openclaw/.env` → `RADARR_URL`, `RADARR_API_KEY` |
| CalDAV/CardDAV Credentials | `~/.openclaw/.env` → `CALDAV_*_USERNAME`, `CALDAV_*_PASSWORD`, `CARDDAV_*_USERNAME`, `CARDDAV_*_PASSWORD` |
| PIM-Quellen + Agent-Zugriff | `services/openclaw-tools/src/config/pim.json` |
| MCP-Eintrag in Gateway | `openclaw.json` → `tools.mcp` |
| Tool-Deny-Liste | `openclaw.json` → `tools.deny` (builtin web_search deaktiviert) |

## Bekannte Einschraenkungen

- **Kein eigener Port** — laeuft nur via Gateway-stdio, nicht standalone testbar via HTTP
- **PIM-Config nicht hot-reloadable** — pim.json wird beim Start gelesen, Aenderungen brauchen Gateway-Restart
- **iCloud-Quellen vorbereitet aber inaktiv** — App-spezifische Passwoerter fehlen noch
- **Placeholder-Credentials werden still uebersprungen** — Quellen mit `HIER_*`, `TODO*`, `PLACEHOLDER*`, `xxx*` werden ignoriert
- **MiniMax Search hat kein SLA** — bei API-Ausfall liefert web_search nur DDG-Ergebnisse

## Neues Feature hinzufuegen

1. Neue Datei `src/tools/<name>.ts` erstellen
2. Tool-Funktion exportieren: `export function register<Name>(server: McpServer, ...clients): void`
3. Tool registrieren mit `server.registerTool()` — Zod-Schema fuer Input
4. Falls neuer externer Client noetig: `src/clients/<name>.ts` anlegen
5. In `src/index.ts` importieren und `register<Name>(server, ...)` aufrufen
6. Falls ENV-Variablen noetig: in `~/.openclaw/.env` eintragen
7. Build: `npm run build` (im Verzeichnis `services/openclaw-tools/`)
8. Deploy: `systemctl --user restart openclaw-gateway`
9. Test: Tool via Agent aufrufen oder direkt via chatCompletions API
10. `testinstruct.md` aktualisieren mit neuem Test-Case
