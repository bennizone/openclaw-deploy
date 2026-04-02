# Test-Anweisungen: Tester

## Voraussetzungen

- Alle Services muessen laufen (Gateway, Qdrant, Extractor)
- testinstruct.md der Ziel-Komponente muss existieren

## Health-Check

```bash
# Tester-relevante Dateien
ls components/*/testinstruct.md | wc -l
# Erwartet: >= 8

# Gateway erreichbar (Basis fuer viele Tests)
curl -sf http://localhost:18789/health | jq .status
# Erwartet: "ok" oder aehnlich
```

## Funktions-Tests

### Test: testinstruct.md Konsistenz
```bash
for f in components/*/testinstruct.md; do
  echo "=== $(dirname $f | xargs basename) ==="
  grep -c "## Health-Check" "$f"
done
# Erwartet: Jede Datei hat mindestens einen Health-Check Abschnitt
```

### Test: Service-Erreichbarkeit
```bash
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
systemctl --user is-active openclaw-gateway.service
systemctl --user is-active openclaw-extractor.service
docker ps --filter name=qdrant --format "{{.Status}}"
# Erwartet: active, active, Up
```

## Integrations-Tests

### Test: Voller Test-Durchlauf
- Starte `/tester` mit einer Komponente (z.B. gateway)
- Erwartet: Liest testinstruct.md, fuehrt Tests aus, gibt Checkliste zurueck
