# Test-Anweisungen: Gateway

## Voraussetzungen

- `openclaw.json` existiert und ist valide: `jq . < ~/.openclaw/openclaw.json > /dev/null`
- `.env` mit Secrets: `~/.openclaw/.env`
- systemd User-Service konfiguriert: `~/.config/systemd/user/openclaw-gateway.service`
- `loginctl enable-linger` ist aktiv (sonst starten Services nicht nach Reboot)

## Health-Check

```bash
# Service-Status
systemctl --user status openclaw-gateway

# HTTP Health
curl -s http://localhost:18789/health | jq .
```

Erwartung: Service active, Health-Endpoint antwortet mit Status-JSON.

## Funktions-Tests

### Test: chatCompletions API
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Hallo, kurze Antwort bitte."}]
  }' | jq .choices[0].message.content
```
- Erwartetes Ergebnis: LLM-Antwort (MiniMax primaer)
- Bei Fehler: `GATEWAY_AUTH_TOKEN` pruefen, `MINIMAX_API_KEY` pruefen

### Test: Agent-Routing via Scopes
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-OpenClaw-Scopes: agent:household" \
  -d '{
    "model": "openclaw/default",
    "messages": [{"role": "user", "content": "Wer bist du?"}]
  }' | jq .choices[0].message.content
```
- Erwartetes Ergebnis: Household-Agent antwortet (Qwen als primaeres Modell wenn so konfiguriert)
- Bei Fehler: Agent "household" muss in `agents.list[]` existieren

### Test: Config-Validierung
```bash
jq . < ~/.openclaw/openclaw.json > /dev/null && echo "OK" || echo "INVALID"
```
- Erwartetes Ergebnis: "OK"
- Bei Fehler: Config-Syntax pruefen, Backup wiederherstellen

### Test: Auth-Absicherung
```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "openclaw/default", "messages": [{"role": "user", "content": "test"}]}'
```
- Erwartetes Ergebnis: 401 Unauthorized (kein Token)
- Bei Fehler: `gateway.auth.mode` muss "token" sein

### Test: Fallback-Modell
```bash
# MiniMax kurzfristig unerreichbar machen (ENV leeren) und Request senden
# Erwartung: Qwen 3.5 9B auf GPU-Server antwortet als Fallback
```
- Bei Fehler: `GPU_SERVER_IP` pruefen, llama-server :8080 muss laufen

## Integrations-Tests

### Test: Plugin-Loading
```bash
systemctl --user restart openclaw-gateway
journalctl --user -u openclaw-gateway --no-pager -n 30 | grep -i plugin
```
Erwartung: Plugins "openclaw-ha-voice" und "openclaw-memory-recall" geladen.

### Test: MCP Tool-Hub gestartet
```bash
journalctl --user -u openclaw-gateway --no-pager -n 30 | grep -i "openclaw-tools"
```
Erwartung: MCP-Server "openclaw-tools" connected.

### Test: ENV-Substitution
```bash
# Fehlende Variable in Config referenzieren → Gateway darf NICHT starten
# (sicherstellen dass ${UNDEFINED_VAR} zu einem Fehler fuehrt, nicht leerem String)
```

### Test: tools.profile
```bash
# Pruefen dass tools.profile = "full" ist
jq '.tools.profile' < ~/.openclaw/openclaw.json
```
Erwartung: `"full"` — bei anderem Wert werden Plugin-Tools still gefiltert.
