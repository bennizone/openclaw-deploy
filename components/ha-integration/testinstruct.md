# Test-Anweisungen: HA-Integration

## Voraussetzungen

- Home Assistant erreichbar: `curl -s https://<HA_URL>/api/ -H "Authorization: Bearer $HA_TOKEN"`
- home-llm Component installiert in `/config/custom_components/home_llm/`
- GPU-Server laeuft: llama-server :8080 (Chat) + :8081 (Embedding)
- Qdrant erreichbar: `curl -s http://localhost:6333/collections`
- OpenClaw Gateway erreichbar: `curl -s http://localhost:18789/health`

## Health-Check

```bash
# HA API erreichbar
curl -s "https://<HA_URL>/api/" \
  -H "Authorization: Bearer $HA_TOKEN" | jq .message
# Erwartung: "API running."

# Conversation Agent vorhanden
curl -s "https://<HA_URL>/api/states/conversation.home_llm" \
  -H "Authorization: Bearer $HA_TOKEN" | jq .state
# Erwartung: nicht "unavailable"
```

## Funktions-Tests

### Test: Einfache Konversation
```bash
curl -s "https://<HA_URL>/api/conversation/process" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hallo, wie geht es dir?", "agent_id": "conversation.home_llm", "language": "de"}'
```
- Erwartetes Ergebnis: Natuerliche Antwort auf Deutsch, ohne Markdown
- Bei Fehler: llama-server :8080 pruefen, `llm_url` in HA Config pruefen

### Test: Entity-Abfrage
```bash
curl -s "https://<HA_URL>/api/conversation/process" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Wie warm ist es im Wohnzimmer?", "agent_id": "conversation.home_llm", "language": "de"}'
```
- Erwartetes Ergebnis: Temperaturwert aus HA-Sensor (kein halluzinierter Wert)
- Bei Fehler: Entity muss in HA unter Voice Assistants > Expose freigegeben sein

### Test: OpenClaw-Delegation
```bash
curl -s "https://<HA_URL>/api/conversation/process" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Suche nach einem guten Pizza-Restaurant in der Naehe", "agent_id": "conversation.home_llm", "language": "de"}'
```
- Erwartetes Ergebnis: Qwen generiert "OPENCLAW:" Prefix, Delegation an OpenClaw, Web-Suche-Ergebnis
- Bei Fehler: `openclaw_url` + `openclaw_api_key` in HA Config pruefen, Gateway Health-Check

### Test: Memory Recall
```bash
# Voraussetzung: Fakt in memories_household vorhanden
curl -s "https://<HA_URL>/api/conversation/process" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Was weisst du ueber unseren Haushalt?", "agent_id": "conversation.home_llm", "language": "de"}'
```
- Erwartetes Ergebnis: Agent erinnert sich an gespeicherte Haushaltsfakten
- Bei Fehler: Qdrant pruefen, Embedding-Server pruefen, `qdrant_url` in HA Config

## Integrations-Tests

### Test: Tageszeit-Kontext
- Tagsüber fragen: "Soll ich das Licht anmachen?" → Agent beruecksichtigt Tageszeit
- Pruefen: `sun.sun` Entity muss verfuegbar sein

### Test: Conversation Buffer
1. Nachricht senden: "Mein Name ist Test"
2. Zweite Nachricht: "Wie heisse ich?"
3. Erwartung: Agent erinnert sich (aus Buffer, nicht aus Qdrant)
4. 16 Minuten warten → Buffer abgelaufen, Agent erinnert sich nicht mehr

### Test: Anti-Halluzination
- Frage nach nicht-exponiertem Sensor: "Wie ist der Luftdruck im Keller?"
- Erwartung: Agent sagt ehrlich, dass kein Zugriff auf diese Daten besteht
- NICHT: Erfindet einen Wert
