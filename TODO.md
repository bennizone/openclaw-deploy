# TODO — OpenClaw Deploy

Offene Punkte, nach Prioritaet sortiert.

## Offen

### TTS ueber Matrix
- TTS-Reply ist nur fuer WhatsApp implementiert (`channelId !== "whatsapp"` in ha-voice Plugin)
- Matrix braucht eigenen Pfad: Audio generieren → als Matrix-Media-Event hochladen
- Betrifft: `plugins/openclaw-ha-voice/src/index.ts` Abschnitt 6 (agent_end Hook)

### Sonarr/Radarr Tools verbessern
- `arr_search` liefert nur Basis-Infos, keine Episoden-Details
- THN musste sich fuer Scrubs-Anfrage durch 7 curl-Calls kaempfen um Episoden-Status zu bekommen
- Entweder: Plugin um `arr_series_detail` / `arr_episode_list` Tool erweitern
- Oder: API-Key-Pfad + Sonarr-URL in TOOLS.md dokumentieren damit Agent direkt curlen kann
- Betrifft: `plugins/openclaw-sonarr-radarr/`

### WhatsApp-Channel einrichten
- Uebersprungen beim Onboarding (Handy nicht verfuegbar)
- Kann jederzeit nachgeholt werden: `openclaw channels login --channel whatsapp`
- Bindings fuer benni + domi sind schon in openclaw.json vorbereitet

### Bootstrap-Interview Domi
- Agent "domi" hat Bootstrap noch nicht durchlaufen
- BOOTSTRAP.md + SOUL.md sind vorbereitet, startet automatisch bei erster Nachricht

### Web-Search Provider
- Aktuell: DuckDuckGo (key-free Fallback) — funktioniert, aber limitiert
- Optional: Brave/Tavily API-Key fuer bessere Ergebnisse konfigurieren
- Config: `tools.web.search.provider` in openclaw.json oder API-Key in .env

## Erledigt (2026-03-31)

- [x] Matrix-Channel (Conduit) eingerichtet + dokumentiert
- [x] Agent-Identitaet gefixt (Bootstrap-Interview, THN lebt)
- [x] CJK-Filter auf message_sending (vor Channel-Send)
- [x] STT gefixt (m4a → ogg/opus via ffmpeg)
- [x] MiniMax MCP entfernt (redundant)
- [x] de_DE.UTF-8 Locale
- [x] ffmpeg installiert
- [x] Bootstrap-Doku + Session-Management-Doku
