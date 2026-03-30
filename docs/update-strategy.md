# Update-Strategie

## Vor jedem Update

1. **Git Commit** — Alle lokalen Aenderungen committen
2. **Config sichern:** `cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak`
3. **Qdrant Snapshot:**
   ```bash
   curl -X POST "http://localhost:6333/collections/memories_household/snapshots"
   # Fuer jede Collection wiederholen
   ```
4. **Aktuelle Version notieren:** `openclaw --version`

## OpenClaw Update

```bash
# Update
npm update -g openclaw

# Pruefen
openclaw --version
openclaw doctor
openclaw plugins list
openclaw plugins doctor
```

## Nach dem Update

1. **Gateway neustarten:** `systemctl --user restart openclaw-gateway`
2. **Plugins testen:** Jedes Plugin muss laden
3. **Memory testen:** Recall-Anfrage senden
4. **End-to-End:** WhatsApp-Nachricht senden

## Rollback

```bash
npm install -g openclaw@<vorherige-version>
systemctl --user restart openclaw-gateway
```

## Plugin-Updates

Plugins sind vom OpenClaw-Core entkoppelt:
- Nutzen nur die oeffentliche SDK-API
- Dependencies in package.json gepinnt
- Bei Breaking Changes: DECISIONS.md dokumentieren

## Was kann kaputtgehen?

| Risiko | Symptom | Loesung |
|--------|---------|---------|
| Config-Format aendert sich | Gateway startet nicht | openclaw doctor, Config anpassen |
| Plugin-API aendert sich | Plugin laedt nicht | Plugin-Code anpassen, neu builden |
| Hook-Signatur aendert sich | Hooks feuern nicht | OpenClaw Changelog pruefen, anpassen |
| Memory-Schema aendert sich | Memory-Recall leer | Qdrant Collections pruefen |
