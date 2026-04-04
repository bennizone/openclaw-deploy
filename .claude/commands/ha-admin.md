# /ha-admin — Home Assistant Verwaltung

Du verwaltest Home Assistant fuer das OpenClaw-System.
Verbindung via REST API. Die HA-URL liegt in `~/.openclaw-deploy-state.json` → `config.ha_url`
und in `~/.openclaw/.env` als `$HA_URL`.

## Vor dem Start: Komponenten-Wissen laden

**PFLICHT:** Lies ZUERST:
1. `components/ha-admin/description.md` — Architektur, Einschraenkungen
2. `components/ha-admin/claude.md` — Scope, Abgrenzung, Pflichten

## Verbindung

```bash
source ~/.openclaw/.env
HA_BASE="$HA_URL"
# Test:
curl -s "${HA_BASE}/api/" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | jq .message
```

Der Token kommt aus `~/.openclaw/.env` (Variable `HA_LONG_LIVED_TOKEN`).

## Haeufige API-Calls

### States & Entities

```bash
# Alle Entities
curl -s "${HA_BASE}/api/states" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | jq '.[].entity_id' | head -20

# Einzelne Entity
curl -s "${HA_BASE}/api/states/<entity_id>" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | jq .

# Template rendern
curl -s -X POST "${HA_BASE}/api/template" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" -H "Content-Type: application/json" \
  -d '{"template": "{{ states.sensor.example.state }}"}'
```

### Automationen

```bash
# Alle auflisten
curl -s "${HA_BASE}/api/states" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | \
  jq '[.[] | select(.entity_id | startswith("automation.")) | {entity_id, state, last_triggered: .attributes.last_triggered}]'

# Automation triggern
curl -s -X POST "${HA_BASE}/api/services/automation/trigger" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id": "automation.example"}'

# Automation ein/ausschalten
curl -s -X POST "${HA_BASE}/api/services/automation/turn_on" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id": "automation.example"}'
```

### Services

```bash
# Service aufrufen
curl -s -X POST "${HA_BASE}/api/services/<domain>/<service>" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id": "<entity_id>"}'

# Beispiel: Licht einschalten
curl -s -X POST "${HA_BASE}/api/services/light/turn_on" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" -H "Content-Type: application/json" \
  -d '{"entity_id": "light.wohnzimmer", "brightness": 255}'
```

### Areas & Devices

```bash
# Areas auflisten
curl -s -X POST "${HA_BASE}/api/config/area_registry/list" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | jq '.[].name'

# Device Registry
curl -s -X POST "${HA_BASE}/api/config/device_registry/list" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | jq '.[0]'

# Entity Registry
curl -s -X POST "${HA_BASE}/api/config/entity_registry/list" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | jq 'length'
```

### Backup & Restart

```bash
# WICHTIG: IMMER Backup VOR destruktiven Aenderungen!
curl -s -X POST "${HA_BASE}/api/services/backup/create" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "pre-change-backup"}'

# HA Restart (WARNUNG: Unterbricht laufende Automationen!)
curl -s -X POST "${HA_BASE}/api/services/homeassistant/restart" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" -H "Content-Type: application/json"

# HA Config Reload (weniger invasiv als Restart)
curl -s -X POST "${HA_BASE}/api/services/homeassistant/reload_all" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" -H "Content-Type: application/json"
```

### Logs & History

```bash
# Error-Log
curl -s "${HA_BASE}/api/error_log" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | tail -30

# Entity-History (letzte Stunde)
curl -s "${HA_BASE}/api/history/period?filter_entity_id=<entity_id>" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | jq '.[0] | length'

# Logbook
curl -s "${HA_BASE}/api/logbook" \
  -H "Authorization: Bearer $HA_LONG_LIVED_TOKEN" | jq '.[:5]'
```

## Troubleshooting

- **API nicht erreichbar:** HA laeuft? SSL-Zertifikat gueltig? Token korrekt?
- **Entity unavailable:** Integration-Problem, HA Error-Log pruefen
- **Automation feuert nicht:** Trigger pruefen, Conditions pruefen, last_triggered checken
- **Langsame Antworten:** HA Error-Log auf Warnungen pruefen, DB-Groesse checken
- **Nach HA-Update:** Deprecated Integrations pruefen, Breaking Changes lesen

## Verhalten

- **IMMER Backup vor destruktiven Ops** (Automationen loeschen, Config aendern)
- **Loeschungen nur mit User-Bestaetigung**
- **HA-Restart immer ankuendigen** (laufende Automationen werden unterbrochen)
- **Keine Secrets loggen** (Token, Passwoerter)
- Bei Unsicherheit: Error-Log lesen, dann entscheiden
