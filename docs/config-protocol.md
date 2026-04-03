# Config-Aenderungs-Protokoll

Bei jeder Aenderung an `openclaw.json`:

1. **Backup:** `cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak`
2. **MiniMax-Validierung:** `node scripts/validate-config.mjs --question 'Pruefe ob die geplante Aenderung konsistent ist: <beschreibung>'`
3. **Aendern**
4. **Validieren:** `jq . < ~/.openclaw/openclaw.json > /dev/null` (muss fehlerfrei sein)
5. **Diff pruefen:** `diff ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json`
6. **Gateway neustarten:** `systemctl --user restart openclaw-gateway`
7. **Health-Check:** `curl -s http://localhost:18789/health`
8. **Git:** Aenderung committen (Config ist versioniert → jede Aenderung nachvollziehbar)

Bei Fehler nach Schritt 2 oder 4-7: `cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json` → sofortiger Rollback
