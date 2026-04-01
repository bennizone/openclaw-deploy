# Test-Anweisungen: HA-Admin

## Voraussetzungen

- Home Assistant erreichbar: `curl -s https://haos.home.benni.zone/api/ -H "Authorization: Bearer $HA_TOKEN"`
- `HA_TOKEN` gesetzt in `~/.openclaw/.env`
- Token laden: `source ~/.openclaw/.env || { echo "FEHLER: ~/.openclaw/.env nicht gefunden"; exit 1; }`

## Health-Check

```bash
# HA API erreichbar
source ~/.openclaw/.env || { echo "FEHLER: ~/.openclaw/.env nicht gefunden"; exit 1; }
curl -s "https://haos.home.benni.zone/api/" \
  -H "Authorization: Bearer $HA_TOKEN" | jq .message
# Erwartung: "API running."

# HA Config pruefen
curl -s "https://haos.home.benni.zone/api/config" \
  -H "Authorization: Bearer $HA_TOKEN" | jq '{version, location_name, state}'
# Erwartung: HA-Version, Location-Name, state: "RUNNING"
```

## Funktions-Tests

### Test: Automationen auflisten
```bash
curl -s "https://haos.home.benni.zone/api/states" \
  -H "Authorization: Bearer $HA_TOKEN" | \
  jq '[.[] | select(.entity_id | startswith("automation.")) | {entity_id, state}]'
```
- Erwartung: Liste aller Automationen mit Status (on/off)

### Test: Entity-States lesen
```bash
curl -s "https://haos.home.benni.zone/api/states/sun.sun" \
  -H "Authorization: Bearer $HA_TOKEN" | jq '{state, attributes: {elevation, rising}}'
```
- Erwartung: sun.sun Entity mit aktuellem State

### Test: Template rendern
```bash
curl -s -X POST "https://haos.home.benni.zone/api/template" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  -d '{"template": "{{ states.sun.sun.state }}"}'
```
- Erwartung: "above_horizon" oder "below_horizon"

### Test: Areas auflisten
```bash
curl -s "https://haos.home.benni.zone/api/config/area_registry/list" \
  -H "Authorization: Bearer $HA_TOKEN" -X POST | jq '.[].name'
```
- Erwartung: Liste aller definierten Bereiche

### Test: Backup erstellen
```bash
curl -s -X POST "https://haos.home.benni.zone/api/services/backup/create" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "test-backup"}'
```
- Erwartung: HTTP 200, Backup wird erstellt (dauert ggf. 1-2 Minuten)

## Integrations-Tests

### Test: Automation erstellen + loeschen
1. Test-Automation erstellen (POST /api/config/automation/config)
2. Pruefen dass sie in der Liste erscheint
3. Test-Automation loeschen
4. Pruefen dass sie weg ist

### Test: Error-Log lesen
```bash
curl -s "https://haos.home.benni.zone/api/error_log" \
  -H "Authorization: Bearer $HA_TOKEN" | tail -20
```
- Erwartung: Letzte Fehler-Eintraege (oder leer wenn alles OK)

### Test: Entity-History
```bash
curl -s "https://haos.home.benni.zone/api/history/period?filter_entity_id=sun.sun" \
  -H "Authorization: Bearer $HA_TOKEN" | jq '.[0] | length'
```
- Erwartung: Anzahl der History-Eintraege (> 0)
