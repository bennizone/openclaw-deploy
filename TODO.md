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

### Web-Search: MiniMax MCP web_search Namenskonflikt
- MiniMax MCP `web_search` wird von OpenClaw uebersprungen (Namenskonflikt mit eingebautem DuckDuckGo `web_search`)
- OpenClaw hat kein Tool-Renaming fuer MCP-Tools
- **Optionen:** (1) DuckDuckGo behalten (aktuell), (2) `tools.deny: ["web_search"]` + MiniMax-MCP uebernimmt, (3) Auf OpenClaw-Update mit MCP-Prefix-Support warten
- Optional: Brave/Tavily API-Key fuer bessere Ergebnisse statt DuckDuckGo

## Erledigt (2026-03-31)

- [x] Matrix-Channel (Conduit) eingerichtet + dokumentiert
- [x] Agent-Identitaet gefixt (Bootstrap-Interview, THN lebt)
- [x] CJK-Filter auf message_sending (vor Channel-Send)
- [x] STT gefixt (m4a → ogg/opus via ffmpeg)
- [x] MiniMax MCP wieder eingebaut (uvx installiert, understand_image aktiv, web_search Namenskonflikt offen)
- [x] Image Understanding aktiviert (MiniMax Vision nativ + understand_image MCP als Qwen-Fallback)
- [x] Web-Search verifiziert (DuckDuckGo funktioniert, Bitcoin-Kurs-Test erfolgreich)
- [x] de_DE.UTF-8 Locale
- [x] ffmpeg installiert
- [x] Bootstrap-Doku + Session-Management-Doku
