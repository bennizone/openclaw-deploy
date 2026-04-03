# Test-Anweisungen: Reviewer

## Voraussetzungen

- Zu reviewender Code muss als Diff oder Dateiliste vorliegen
- components/*/claude.md fuer Kontext-Regeln verfuegbar

## Health-Check

```bash
# Reviewer-relevante Dateien
test -f docs/DECISIONS.md && echo "OK: DECISIONS.md" || echo "FAIL"
ls components/*/claude.md | wc -l
# Erwartet: >= 8
```

## Funktions-Tests

### Test: Review-Kategorien
- Gib dem Reviewer eine kleine Code-Aenderung
- Erwartet: Findings in zwei Kategorien:
  1. Mechanische Findings (Tippfehler, unused imports, fehlende stderr)
  2. Design-Findings (Architektur, API, Sicherheit)

### Test: Finding-Format
- Erwartet pro Finding: Datei, Zeile, Beschreibung, Empfehlung, Kategorie (mechanisch/design)

## Integrations-Tests

### Test: Mechanische Findings → /coder
- Reviewer meldet mechanisches Finding
- Erwartet: Orchestrator delegiert sofort an /coder (nicht User fragen)

### Test: Blockierende Design-Findings → User
- Reviewer meldet Architektur-Problem
- Erwartet: Orchestrator holt User-Input

### Test: SDK-Delegation
```bash
# consult-sdk.mjs mit --input-file funktioniert fuer Reviewer
echo "Test-Diff fuer Review" > /tmp/test-reviewer-tokenfresser.txt
node scripts/consult-sdk.mjs --component reviewer --question "Pruefe auf Probleme" --input-file /tmp/test-reviewer-tokenfresser.txt --brief
# Erwartet: MiniMax-Antwort (Pipeline-Test, Inhalt sekundaer)
```
