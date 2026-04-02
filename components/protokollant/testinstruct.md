# Test-Anweisungen: Protokollant

## Voraussetzungen

- docs/DECISIONS.md muss existieren
- Mindestens eine components/*/decisions.md muss existieren

## Health-Check

```bash
# Zentrale DECISIONS.md existiert
test -f docs/DECISIONS.md && echo "OK" || echo "FAIL"

# Mindestens eine lokale decisions.md
ls components/*/decisions.md | wc -l
# Erwartet: >= 1
```

## Funktions-Tests

### Test: DECISIONS.md Format
```bash
head -3 docs/DECISIONS.md
# Erwartet: "# Zentrale Entscheidungen"
```

### Test: Lokale decisions.md Format
```bash
for f in components/*/decisions.md; do
  echo "=== $f ==="
  head -1 "$f"
done
# Erwartet: Jede Datei beginnt mit "# " Titel
```

## Integrations-Tests

### Test: Neuer Eintrag
- Gib dem Protokollanten eine Entscheidung zum Dokumentieren
- Pruefe ob der Eintrag in docs/DECISIONS.md UND der relevanten components/*/decisions.md erscheint
- Format: Datum, Kontext, Entscheidung, Ergebnis
