# Test-Anweisungen: Tool-Hub

## Voraussetzungen

- OpenClaw Gateway laeuft: `systemctl --user status openclaw-gateway`
- Tool-Hub ist als MCP konfiguriert in `openclaw.json` → `tools.mcp`
- ENV-Variablen gesetzt in `~/.openclaw/.env` (mindestens `MINIMAX_API_KEY`)
- Fuer Arr-Tests: Sonarr/Radarr erreichbar mit gueltigem API-Key
- Fuer PIM-Tests: CalDAV-Server erreichbar mit gueltigen Credentials

## Health-Check

```bash
# Gateway muss laufen (Tool-Hub ist Kindprozess)
curl -s http://localhost:18789/health | jq .

# Pruefen ob Tool-Hub-Tools registriert sind
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Welche Tools hast du?"}]
  }' | jq .choices[0].message
```

Erwartung: Agent listet web_search, understand_image, arr_*, calendar_*, contacts_* auf.

## Funktions-Tests

### Test: Web-Suche
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Suche nach dem Wetter in Nuernberg"}]
  }'
```
- Erwartetes Ergebnis: Agent nutzt web_search, liefert aktuelle Suchergebnisse
- Bei Fehler: `MINIMAX_API_KEY` pruefen, DDG-Scraper kann rate-limited sein

### Test: Arr-Suche
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Suche nach der Serie Breaking Bad"}]
  }'
```
- Erwartetes Ergebnis: Agent nutzt arr_search, findet Serie mit Sonarr-ID
- Bei Fehler: `SONARR_URL` und `SONARR_API_KEY` pruefen

### Test: Kalender (PIM)
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-OpenClaw-Scopes: agent:benni" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Was steht diese Woche in meinem Kalender?"}]
  }'
```
- Erwartetes Ergebnis: Agent nutzt calendar_events, zeigt Termine der Woche
- Bei Fehler: CalDAV-Credentials pruefen, pim.json Agent-Zuordnung pruefen

### Test: Kontakte
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-OpenClaw-Scopes: agent:benni" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Suche den Kontakt Mueller"}]
  }'
```
- Erwartetes Ergebnis: Agent nutzt contacts_search, findet Kontakte mit Name Mueller
- Bei Fehler: CardDAV-Credentials pruefen, pim.json pruefen

### Test: Wetter
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-OpenClaw-Scopes: operator.write" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Wie ist das Wetter in Nuernberg?"}]
  }'
```
- Erwartetes Ergebnis: Agent nutzt weather-Tool, liefert Temperatur, Wetterlage, Vorhersage
- Daten kommen von Open-Meteo (kein API-Key noetig)
- Bei Fehler: Open-Meteo Geocoding API pruefen (geocoding-api.open-meteo.com), Internet-Zugang

### Test: Bildanalyse
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Analysiere dieses Bild: https://example.com/test.jpg"}]
  }'
```
- Erwartetes Ergebnis: Agent nutzt understand_image, beschreibt Bildinhalt
- Bei Fehler: MiniMax VLM API pruefen

## Integrations-Tests

### Test: PIM Agent-Scoping
Gleichen Kalender-Request mit verschiedenen Agent-IDs senden.
`household` sollte nur Lesezugriff auf Familienkalender haben, keine Kontakte.
`benni` sollte readwrite auf eigene Quellen haben.

### Test: Debug-Logging
Nach einem Tool-Call pruefen:
```bash
cat ~/.openclaw/logs/tools/$(date +%Y-%m-%d).log | tail -5
```
Erwartung: Eintrag mit Tool-Name, Input-Zusammenfassung, Dauer, Result-Snippet.

### Test: Placeholder-Erkennung
Quelle mit `HIER_BENUTZERNAME` als Credential konfigurieren — darf keinen Fehler werfen,
wird still uebersprungen. Im Log: Hinweis dass Quelle uebersprungen wurde.

### Test: Recurring Events
Kalender-Abfrage fuer Zeitraum mit wiederkehrendem Termin (z.B. Geburtstag).
Erwartung: Termin zeigt Datum im angefragten Zeitraum, nicht Originaldatum.
