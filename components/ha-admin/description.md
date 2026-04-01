# HA-Admin

## Zweck

Administration von Home Assistant via REST API — Automationen erstellen/bearbeiten,
Entity- und Device-Management, Wartung, Troubleshooting und Optimierung.
Operiert von aussen (Claude Code auf dem LXC) ueber die HA REST API.

## Architektur

```
Kein eigener Code im Repo — rein API-basiert.

Claude Code (LXC)
  → curl / HA REST API
    → https://haos.home.benni.zone/api/...
      ├── /api/states                    # Entity-States lesen
      ├── /api/services/<domain>/<service>  # Services aufrufen
      ├── /api/config/automation/config   # Automationen CRUD
      ├── /api/template                  # Templates rendern
      ├── /api/history/period            # Entity-History
      ├── /api/logbook                   # Logbook
      ├── /api/error_log                 # Error-Log
      └── /api/services/backup/create    # Backup erstellen
```

- **Sprache:** Keine (API-Calls via curl/Bash)
- **Auth:** Long-Lived Access Token in `~/.openclaw/.env` → `HA_TOKEN`
- **Kein Build** — kein Code, nur API-Interaktion

## Abhaengigkeiten

- **Braucht:**
  - Home Assistant — Ziel-System, muss erreichbar sein
  - `HA_TOKEN` — Long-Lived Access Token in `~/.openclaw/.env`
- **Wird gebraucht von:**
  - Niemand direkt — ist ein Admin-Agent fuer manuelle/geplante HA-Verwaltung
- **Verwandt mit:**
  - **ha-integration** — Gleiche HA-Instanz, aber anderer Scope:
    ha-integration = home-llm Python Code INNERHALB HA,
    ha-admin = HA selbst via REST API VON AUSSEN

## Schnittstellen

- **Eingabe:** User-Anfragen an Claude Code (z.B. "Erstelle eine Automation fuer...")
- **Ausgabe:** HA REST API Calls (Automationen, Services, Config)
- **Auth:** `Authorization: Bearer $HA_TOKEN` Header

## Konfiguration

| Was | Wo |
|-----|-----|
| HA URL | `~/.openclaw-deploy-state.json` → `config.ha_url` |
| HA Token | `~/.openclaw/.env` → `HA_TOKEN` |

## Bekannte Einschraenkungen

- **Add-ons/Supervisor:** Nicht via REST API verwaltbar (braucht Supervisor API mit eigenem Token)
- **YAML-Automationen:** Via REST API nur lesbar, nicht editierbar (nur UI-Automationen sind CRUD-faehig)
- **HA-Restart noetig:** Manche Config-Aenderungen (z.B. neue Integrationen) brauchen HA-Restart
- **Rate-Limiting:** HA hat kein offizielles Rate-Limit, aber viele schnelle Calls koennen die Instanz belasten
- **Backup-Dauer:** HA Full Backup kann mehrere Minuten dauern (blockiert nicht die API)

## Neues Feature hinzufuegen

1. Neuen API-Endpoint identifizieren (HA REST API Docs)
2. In `.claude/commands/ha-admin.md` dokumentieren (curl-Beispiel)
3. In `testinstruct.md` Test-Case hinzufuegen
4. Wenn wiederkehrend: Script in `scripts/` erstellen
