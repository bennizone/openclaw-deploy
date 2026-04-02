# Wartungsmodus — Anleitung fuer Claude Code

Wenn der User den Wartungsmodus aktivieren oder deaktivieren will.

## Aktivieren

```bash
# Ohne GPU-Server:
bash ~/openclaw-deploy/scripts/maintenance.sh on

# Mit GPU-Server:
bash ~/openclaw-deploy/scripts/maintenance.sh on --with-gpu
```

**Reihenfolge:** Gateway → MCP-Cleanup → Extractor → Embed-Fallback → Qdrant → (GPU)

## Deaktivieren

```bash
# Ohne GPU-Server:
bash ~/openclaw-deploy/scripts/maintenance.sh off

# Mit GPU-Server:
bash ~/openclaw-deploy/scripts/maintenance.sh off --with-gpu
```

**Reihenfolge:** (GPU) → Qdrant → Embed-Fallback → Gateway → Extractor
Health-Checks laufen automatisch. Embed-Fallback braucht bis zu 90s (Modell laden).

## Status pruefen

```bash
bash ~/openclaw-deploy/scripts/maintenance.sh status --with-gpu
```

## Wann --with-gpu?

- **Ja:** GPU-Server Wartung, Hardware-Wechsel, Modell-Update, komplett alles aus
- **Nein:** Nur LXC-Wartung, OpenClaw-Updates, Qdrant-Wartung

## Nach Wartung pruefen

Nach `off` kurz testen ob alles laeuft:
```bash
curl -s http://localhost:18789/health | jq .
curl -s http://localhost:6333/healthz
```

## Wichtig

- Script setzt/entfernt Flag-Datei `~/.openclaw-maintenance` automatisch
- Bei Fehler: Script gibt Warnungen aus, bricht aber nicht ab
- Embed-Fallback ist der langsamste Service beim Starten (~30-90s)
- WhatsApp/Matrix reconnecten automatisch nach Gateway-Start
