# Test-Anweisungen: Audit

## Voraussetzungen

- scripts/config-audit.py muss ausfuehrbar sein
- scripts/orchestrator-audit.py muss ausfuehrbar sein
- docs/audits/ Verzeichnis muss existieren

## Health-Check

```bash
# config-audit.py laeuft ohne Crash
python3 scripts/config-audit.py --json | jq .

# orchestrator-audit.py laeuft mit letzter Session
LATEST=$(ls -t ~/.claude/projects/-home-openclaw-openclaw-deploy/*.jsonl 2>/dev/null | head -1)
python3 scripts/orchestrator-audit.py "$LATEST" --json | jq .
```

## Funktions-Tests

### Test: Config-Audit Ergebnis-Format
```bash
python3 scripts/config-audit.py --json | jq '.[0] | keys'
# Erwartet: ["message", "status"]
```

### Test: Audit-Verzeichnis
```bash
ls docs/audits/
# Erwartet: Mindestens eine .md Datei
```

### Test: Audit-Datei Format
```bash
head -1 docs/audits/$(ls -t docs/audits/ | head -1)
# Erwartet: "# OpenClaw System-Audit — YYYY-MM-DD"
```

## Integrations-Tests

### Test: /audit infra
- Starte `/audit infra`
- Erwartet: Checkliste mit [OK]/[WARN]/[FAIL] fuer alle Services

### Test: /audit config
- Starte `/audit config`
- Erwartet: config-audit.py Output + DECISIONS.md Abgleich
