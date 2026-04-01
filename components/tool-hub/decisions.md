# Entscheidungen: Tool-Hub

## 2026-03-31 — PIM-Modul (Kalender + Kontakte) via CalDAV/CardDAV

**Kontext:** Agents sollen Kalender lesen/schreiben und Kontakte durchsuchen koennen — userspezifisch.
Benni nutzt Hetzner (CalDAV/CardDAV), Domi nutzt iCloud. Geteilter Familienkalender in iCloud.

**Entscheidung:**
- 9 neue Tools im bestehenden Tool-Hub: 5 Calendar + 4 Contacts
- `tsdav` als CalDAV/CardDAV-Client (TypeScript-nativ, iCloud-Discovery eingebaut)
- Config-driven Scoping via `pim.json`: Quellen definieren, pro Agent zuweisen mit `read`/`readwrite`
- Agent-Identifikation: Hybrid — `extra._meta.agentId` (zukunftssicher) + `agent_id` Parameter (funktioniert heute)
- Minimaler iCal/vCard-Parser statt voller Library — reicht fuer VEVENT/VCARD Standardfelder

**Alternativen verworfen:**
- Separate MCP-Instanzen pro Agent — mehr Prozesse, schwerer wartbar
- Full iCal-Parser (ical.js) — Overkill, eigener Lightweight-Parser genuegt fuer unsere Felder
- Per-Agent ENV-Vars — Gateway startet nur einen MCP-Prozess, nicht konfigurierbar pro Agent

## 2026-04-01 — CalDAV Recurring Events + Placeholder-Erkennung + Debug-Logging

**Kontext:** Wiederkehrende Termine zeigten Originaldatum statt aktuellem Vorkommen.
Unkonfigurierte iCloud-Quellen mit Platzhalter-Credentials verursachten Fehler.
Tool-Aufrufe schwer zu debuggen ohne Logs.

**Entscheidung:**
- `expand: true` bei `fetchCalendarObjects` — Server expandiert Recurrence, DTSTART zeigt korrektes Datum
- `isPlaceholder()` erkennt `HIER_*`, `TODO*`, `PLACEHOLDER*`, `xxx*` als ungueltige Credentials
- `serverUrl` auf `/rpc/` geaendert — tsdav braucht Server-Root fuer Account-Discovery
- Build-Script: `rm -rf dist/config` vor `cp` — verhindert stale Config im dist/
- Debug-Logging: Alle Tool-Calls automatisch in `~/.openclaw/logs/tools/YYYY-MM-DD.log` (7 Tage Retention)

**Alternativen verworfen:**
- Client-seitige RRULE-Expansion — unnoetig komplex, CalDAV-Server kann das nativ
- Per-Tool manuelles Logging — fehleranfaellig, Logging-Wrapper in index.ts ist DRY

## 2026-04-01 — Weather-Tool via Open-Meteo

**Kontext:** Agents sollen Wetter abfragen koennen ohne web_search nutzen zu muessen.
Erster Feature-Durchlauf nach neuem Orchestrator-Protokoll (D.2).

**Entscheidung:**
- Open-Meteo Geocoding API (Stadtname → Koordinaten) + Forecast API (Wetter + 7-Tage-Vorhersage)
- Kein API-Key, keine .env-Aenderung, kein neuer Client-File (alles in weather.ts)
- WMO-Code-Mapping auf deutsche Beschreibungen inline im Tool
- Output als strukturierter Text (nicht JSON) — LLM kann direkt daraus formulieren
- `language=de` fuer Geocoding, `timezone=auto` fuer lokale Zeiten

**Alternativen verworfen:**
- OpenWeatherMap — braucht API-Key, Free-Tier limitiert
- Separater Client in `src/clients/openmeteo.ts` — Overkill, nur ein Tool nutzt die API
- JSON-Output statt Text — LLM braucht kein strukturiertes JSON, Text ist natuerlicher
