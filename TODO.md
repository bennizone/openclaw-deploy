# TODO — OpenClaw Deploy

Offene Punkte, nach Prioritaet sortiert.

## Offen

### TTS ueber Matrix
- TTS-Reply ist nur fuer WhatsApp implementiert (`channelId !== "whatsapp"` in ha-voice Plugin)
- Matrix braucht eigenen Pfad: Audio generieren → als Matrix-Media-Event hochladen
- Betrifft: `plugins/openclaw-ha-voice/src/index.ts` Abschnitt 6 (agent_end Hook)

### ~~Sonarr/Radarr Tools verbessern + in Tool-Hub migrieren~~ → Erledigt (2026-03-31)

### WhatsApp-Channel einrichten
- Uebersprungen beim Onboarding (Handy nicht verfuegbar)
- Kann jederzeit nachgeholt werden: `openclaw channels login --channel whatsapp`
- Bindings fuer benni + domi sind schon in openclaw.json vorbereitet

### Bootstrap-Interview Domi
- Agent "domi" hat Bootstrap noch nicht durchlaufen
- BOOTSTRAP.md + SOUL.md sind vorbereitet, startet automatisch bei erster Nachricht

### Claude Code: Agenten besser nutzen
- Claude Code hat spezialisierte Agents (`/coder`, `/reviewer`, `/tester`, `/docs`, etc.)
- Diese werden aktuell zu wenig eingesetzt bei Administration und Entwicklung
- Ziel: Workflow optimieren, Agents automatischer und haeufiger einsetzen
- Betrifft: CLAUDE.md Agent-Auswahl, Pipeline-Regeln

### Dream-Prozess: Effizienz-Selbstanalyse
- Agent soll im Dream-Prozess eigene Sessions analysieren: wo wurden Tokens verschwendet?
- Beispiel: Sonarr-Infos per 7 curl-Calls statt einem passenden Tool geholt
- Erkannte Ineffizienzen → Notiz im Morgenbrief an Main-User (benni)
- Vorschlag: "Effizienz steigern durch neues Tool/Skill X"
- **Nur Main-User bekommt Vorschlaege** (nicht der Agent-User selbst)
- Betrifft: Dream-System, Morgenbrief-Template, Agent-Workspace-Config

### Agent Feature-Requests (Wunschliste)
- Wenn ein Agent etwas nicht kann oder umstaendlich loesen muss:
  → Agent fragt User: "Soll ich das auf die Wunschliste setzen?"
- Requests landen in einer zentralen Liste (z.B. `REQUESTS.md` oder aehnlich)
- Admin (Benni) kann in Claude Code die Liste einsehen und entscheiden:
  → Auf TODO setzen? → Direkt implementieren? → Ablehnen?
- Betrifft: Agent-Workspace (SOUL.md Anweisung), neue Datei fuer Request-Liste


### ~~Reviewer Tokenfresser-Delegation verbessern~~ (ERLEDIGT — SDK-Migration 2026-04-03)
- Geloest durch Migration auf `consult-sdk.mjs`: SDK-Agent hat Read/Glob/Grep-Zugriff, kein manuelles Chunking mehr noetig. Agent liest Dateien nativ und sieht vollen Kontext.

### Workflow pruefen: Tester-Reihenfolge
- Im 14-Schritte-Workflow (Schritt 9) laeuft `/tester` BEVOR Tests definiert sind
- Frage: Soll der Tester anhand der Session/Aenderungen die Tests selbst definieren und fuer sich dokumentieren?
- Oder muessen Tests vorab in `testinstruct.md` stehen?
- Betrifft: `docs/workflow.md` Schritt 9, `components/*/testinstruct.md`

### Plugin `openclaw-sonarr-radarr` entfernen
- Plugin-Code liegt noch im Repo unter `plugins/openclaw-sonarr-radarr/` als Rollback-Referenz
- Ab 2026-04-07 loeschen, wenn MCP-Migration stabil laeuft

## Erledigt (2026-03-31)

- [x] Matrix-Channel (Conduit) eingerichtet + dokumentiert
- [x] Agent-Identitaet gefixt (Bootstrap-Interview, THN lebt)
- [x] CJK-Filter auf message_sending (vor Channel-Send)
- [x] STT gefixt (m4a → ogg/opus via ffmpeg)
- [x] MiniMax MCP wieder eingebaut (uvx installiert, understand_image aktiv, web_search Namenskonflikt offen)
- [x] Image Understanding aktiviert (MiniMax Vision nativ + understand_image MCP als Qwen-Fallback)
- [x] Web-Search verifiziert (DuckDuckGo funktioniert, Bitcoin-Kurs-Test erfolgreich)
- [x] Tool-Hub MCP Server (`services/openclaw-tools/`) — ersetzt separaten minimax-search MCP
- [x] Web-Search Namenskonflikt geloest: Tool-Hub liefert `web_search` (DDG + MiniMax merged), built-in via `tools.deny` deaktiviert
- [x] `understand_image` in Tool-Hub integriert (MiniMax VLM API, kein Python/uvx mehr noetig)
- [x] Sonarr/Radarr: Plugin → Tool-Hub MCP migriert (7 Tools, 3-stufige deutsche Titelsuche, `arr_series_detail` + `arr_episode_list` neu)
- [x] de_DE.UTF-8 Locale
- [x] ffmpeg installiert
- [x] Bootstrap-Doku + Session-Management-Doku
