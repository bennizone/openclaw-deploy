# Reviewer — Komponenten-Beschreibung

## Zweck

Uebergreifender Code-Review-Agent fuer alle OpenClaw-Komponenten. Prueft Aenderungen auf Qualitaet, Sicherheit und Konsistenz.

## Verantwortung

- Code-Reviews nach jeder Aenderung
- Mindestanforderungen durchsetzen (keine Secrets, Build OK, Plugin-Doctor OK, keine Breaking Changes)
- Blockierende Probleme vs. Empfehlungen klar trennen
- Meta-Analyse von Patterns und Workflow-Problemen

## Abhaengigkeiten

- Liest `components/*/description.md` fuer Kontext
- Arbeitet nach Review mit `coder` zusammen (Fixes)
- Arbeitet mit `tester` zusammen (Tests ausfuehren)
- Arbeitet mit `protokollant` zusammen (DECISIONS.md)

## Kontext-Regeln

- `tools.profile = "full"` — andere Profile filtern Plugin-Tools
- `plugins.slots.memory = "none"` — eigenes Memory-System (Qdrant)
- `bge-m3 = 1024 Dimensionen` — NICHT 1536
- `before_dispatch` feuert NICHT fuer chatCompletions
- Keine PII in Git-Commits

## Dateien

Keine eigenen Code-Dateien — arbeitet uebergreifend.
