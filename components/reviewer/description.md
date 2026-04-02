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

## Schnittstellen

- **Eingabe:**
  - Git-Diffs und Code-Dateien (alle Komponenten)
  - `components/*/description.md` fuer Komponenten-Kontext
  - Kontext-Regeln aus CLAUDE.md und `docs/workflow.md` (Schritt 10)
  - Workflow-Trigger: wird nach `/tester` aufgerufen (Schritt 10 im Workflow)
- **Ausgabe:**
  - Review-Findings: blockierend (Architektur, API-Bruch, Sicherheit) vs. nicht-blockierend
  - Mechanische Fixes (unused imports, Tippfehler, fehlende stderr) → delegiert an `/coder`
  - Design-Findings die User-Input brauchen → TODO-Liste oder direkt an User
  - Meta-Analyse von Patterns und Workflow-Problemen

## Bekannte Einschraenkungen

- **Kein eigener Code** — kann Findings nicht selbst fixen, delegiert immer an `/coder`
- **Keine Runtime-Abhaengigkeiten** — rein analytischer Agent, kein Service, kein Port
- **Keine eigenen Tests** — prueft Ergebnisse von `/tester`, fuehrt selbst keine aus
- **Autonomie-Level 0** — alle Aktionen brauchen User-Freigabe
- **Tokenfresser-Delegation aktiv** — Git-Diffs >6000 Zeichen werden via consult-agent.sh --input-file an MiniMax zur Erstanalyse delegiert. Claude prueft nur gemeldete Stellen gezielt.
