# OpenClaw Tool-Hub MCP

Zentraler MCP-Server fuer alle externen Tools (`services/openclaw-tools/`).
Eingebautes `web_search` ist via `tools.deny` deaktiviert, der Tool-Hub uebernimmt.

## Tools

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

## PIM-Zugriffskontrolle

PIM-Tools sind **agentspezifisch**: `pim.json` definiert welcher Agent auf welche
CalDAV/CardDAV-Quellen zugreifen darf (`read` oder `readwrite`).
