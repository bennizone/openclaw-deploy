# Config-Aenderungs-Checkliste: Gateway

## Bei Fehler nach jedem Schritt: sofortiger Rollback!
```bash
cp ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart openclaw-gateway
```

## Protokoll (IMMER einhalten!)

1. **Backup:**
   ```bash
   cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
   ```

2. **Aendern** — Config editieren
   - NUR Claude Code aendert `openclaw.json` — Agent hat Config mal zerschossen
   - ENV-Substitution: `${VAR_NAME}` — nur Grossbuchstaben `[A-Z_][A-Z0-9_]*`
   - Fehlende Variable = Fehler beim Laden (kein stiller Fallback)

3. **Validieren:**
   ```bash
   jq . < ~/.openclaw/openclaw.json > /dev/null
   ```
   Muss fehlerfrei sein. Bei Fehler: Rollback (siehe oben).

4. **Diff pruefen:**
   ```bash
   diff ~/.openclaw/openclaw.json.bak ~/.openclaw/openclaw.json
   ```

5. **Gateway neustarten:**
   ```bash
   XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart openclaw-gateway
   ```
   ⚠ OHNE `XDG_RUNTIME_DIR` → DBUS-Fehler!

6. **Health-Check:**
   ```bash
   curl -s http://localhost:18789/health
   ```

7. **Git:** Aenderung committen (Config ist versioniert → jede Aenderung nachvollziehbar)

## Kritische Config-Regeln

- `tools.profile` MUSS `"full"` sein — andere Profile filtern Plugin-Tools still weg
- `plugins.slots.memory` MUSS `"none"` sein — eigenes Memory-System
- `agents.defaults.userTimezone` MUSS gesetzt sein — ohne kein Datum/Uhrzeit im System-Prompt

## Channel-spezifische Gotchas

### Matrix
- `dm: {}` statt `dmPolicy` — verschachteltes Schema, WhatsApp-Style Keys crashen
- Binding: `peer: { kind: "direct", id: "@user:server" }` — NICHT `from`
- Conduit Join braucht `{"reason":""}` — leeres `{}` = M_BAD_JSON

### WhatsApp
- DM + Gruppen-Policy separat konfiguriert

## Template synchron halten

8. Bei strukturellen Aenderungen: `config/openclaw.template.json` im Repo aktualisieren
9. Bei Version-Updates: `config/versions.json` aktualisieren
