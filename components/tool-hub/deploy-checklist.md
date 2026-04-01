# Deploy-Checkliste: Tool-Hub

## Build

1. `cd ~/openclaw-deploy/services/openclaw-tools && npm run build`
   - tsc + config copy (`rm -rf dist/config` vor `cp` — stale-config Bug vermeiden)
   - Bei Fehler: TypeScript-Fehler beheben, NICHT mit `--noEmit` umgehen
2. Build-Output liegt in `dist/` — wird vom Gateway via stdio gestartet

## Deploy (Gateway-Restart)

3. `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart openclaw-gateway`
   - ⚠ OHNE `XDG_RUNTIME_DIR` → DBUS-Fehler! (Bekannter Bug in Claude Code Sessions)
   - Tool-Hub ist Kindprozess des Gateways — kein eigener systemd-Service
4. `curl -s http://localhost:18789/health` → muss `{"ok":true}` liefern
5. Bei Fehler: `XDG_RUNTIME_DIR=/run/user/$(id -u) journalctl --user -u openclaw-gateway -n 30`

## E2E-Test

6. VOR dem Testen: `testinstruct.md` lesen fuer korrekten Scope + curl-Befehl
7. Scope muss `operator.write` enthalten (NICHT nur `agent:NAME`) — sonst werden Tools nicht verfuegbar
8. Token aus `~/.openclaw/.env` → `GATEWAY_AUTH_TOKEN` verwenden
