# Test-Anweisungen: OpenClaw-Skills

## Voraussetzungen

- Gateway laeuft: `systemctl --user status openclaw-gateway`
- HA erreichbar: `curl -s https://<HA_URL>/api/ -H "Authorization: Bearer $HA_TOKEN"`
- Plugins geladen: `journalctl --user -u openclaw-gateway -n 30 | grep plugin`
- ffmpeg installiert: `which ffmpeg`
- GPU-Server laeuft (fuer Routing-Klassifikation): Port 8080

## Health-Check

```bash
# Plugin-Doctor
openclaw plugins doctor
# Erwartung: Alle Plugins OK, keine Fehler

# Gateway-Logs: Plugins geladen
journalctl --user -u openclaw-gateway --no-pager -n 30 | grep -i "ha-voice\|memory-recall"
# Erwartung: Beide Plugins initialisiert
```

## Funktions-Tests

### Test: CJK Sanitizer
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Zaehle von 1 bis 5 auf Chinesisch und dann auf Deutsch"}]
  }' | jq .choices[0].message.content
```
- Erwartetes Ergebnis: Antwort ohne chinesische Ziffern (umgewandelt in arabische)
- Bei Fehler: Plugin geladen? before_message_write Hook aktiv?

### Test: Smart Home Routing
```bash
# Smart Home Request (sollte an HA geroutet werden)
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Wie warm ist es im Wohnzimmer?"}]
  }'
```
- Erwartetes Ergebnis: Sensorwert aus HA (via Qwen/conversation.home_llm)
- Bei Fehler: HA-URL + Token pruefen, GPU-Server :8080 fuer Klassifikation pruefen

### Test: STT (Voice-to-Text)
- WhatsApp Voice-Nachricht an Agent senden
- Erwartung: Transkript erscheint als Text-Nachricht (echoFormat: "Mikrofon ...")
- Bei Fehler: HA Cloud STT Provider pruefen, Audio-Format (OGG/Opus)

### Test: TTS (Text-to-Voice)
- WhatsApp Voice-Nachricht senden → Agent antwortet mit Voice Note
- Erwartung: Deutsch, KatjaNeural Stimme, OGG/Opus Format
- Bei Fehler: ffmpeg pruefen, HA Cloud TTS Provider pruefen

## Integrations-Tests

### Test: Plugin + MCP Koexistenz
- Request der sowohl Plugin-Hooks als auch MCP-Tools nutzt:
  "Suche nach dem Wetter und sag mir wie warm es drinnen ist"
- Erwartung: web_search (Tool-Hub) + HA-Routing (Plugin) funktionieren zusammen

### Test: tools.profile = "full"
```bash
jq '.tools.profile' < ~/.openclaw/openclaw.json
```
- Erwartung: `"full"` — bei anderem Wert werden Plugin-Tools still gefiltert

### Test: Plugin nach Gateway-Restart
```bash
systemctl --user restart openclaw-gateway
sleep 3
journalctl --user -u openclaw-gateway --no-pager -n 10 | grep -i plugin
```
- Erwartung: Plugins werden nach Restart erneut geladen
