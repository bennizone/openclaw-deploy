# Config-Aenderungs-Protokoll

Bei jeder Aenderung an `openclaw.json`:

1. **Backup:** `cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak`
2. **Aendern**
3. **Validieren:** `jq . < ~/.openclaw/openclaw.json > /dev/null` (muss fehlerfrei sein)
4. **Diff pruefen:** `diff ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json`
5. **Gateway neustarten:** `systemctl --user restart openclaw-gateway`
6. **Health-Check:** `curl -s http://localhost:18789/health`
7. **Git:** Aenderung committen (Config ist versioniert → jede Aenderung nachvollziehbar)

Bei Fehler nach Schritt 3-6: `cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json` → sofortiger Rollback
