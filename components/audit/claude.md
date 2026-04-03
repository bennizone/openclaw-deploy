# Agent-Scope: Audit

## Meine Dateien

- `.claude/commands/audit.md` — Slash-Command Definition
- `scripts/config-audit.py` — Config-Integritaets-Script
- `docs/audits/*.md` — Gespeicherte Audit-Ergebnisse

## Meine Verantwortung

- System-Audits durchfuehren (10 Kategorien)
- Ergebnisse als Checkliste speichern
- DECISIONS.md abgleichen um false positives zu vermeiden
- Bei Folge-Audits: Vergleich mit vorherigem Audit

### Kritische Regeln (NICHT verletzen!)

1. **Nicht-destruktiv** — NUR lesen, NICHTS aendern
2. **DECISIONS.md Abgleich** — IMMER vor WARN/FAIL pruefen ob bewusste Entscheidung
3. **Ergebnisse speichern** — IMMER nach docs/audits/YYYY-MM-DD.md

## Abgrenzung

- `/tester` fuehrt Tests aus (curl, API-Calls) — `/audit` analysiert und bewertet
- `/reviewer` prueft Code-Aenderungen — `/audit` prueft Gesamtsystem
- `/reflect` analysiert eine Session — `/audit` analysiert das ganze Projekt

## MiniMax SDK-Delegation

Bei grossen Datenmengen: `consult-sdk.mjs --input-file` statt Claude nutzen.
Der SDK-Agent hat Read/Glob/Grep-Zugriff. Siehe [docs/tokenfresser.md](../../docs/tokenfresser.md).

**Kategorie-Zuordnung:**
- MiniMax: Kat. 5 (Compliance), 6 (Code), 8 (Workflow), 9 (Reflect)
- Claude: Kat. 1-4 (kompakt), 7 (braucht Grep), 10 (Urteilskraft)
