# Audit-Agent

## Zweck

Fuehrt umfassende System-Audits durch (10 Kategorien). Nicht-destruktiv — liest nur.
Ergebnisse werden als Checkliste in `docs/audits/YYYY-MM-DD.md` gespeichert.

## Kategorien

| # | Kategorie | Methode |
|---|-----------|---------|
| 1 | Infrastruktur-Health | systemctl, curl, docker ps |
| 2 | Config-Integritaet | scripts/config-audit.py |
| 3 | Dokumentations-Konsistenz | Glob + Read |
| 4 | Memory-System | Qdrant API |
| 5 | Prozess-Compliance | scripts/orchestrator-audit.py |
| 6 | Code-Redundanzen | Grep + Read |
| 7 | Konsistenz | Pattern-Vergleich |
| 8 | Workflow-Analyse | workflow-patterns.md + Sessions |
| 9 | Self-Improvement | Reflect-Findings verifizieren |
| 10 | Gesamtbewertung | Alle Kategorien + Reife-Score |

## Abhaengigkeiten

**Braucht:**
- scripts/config-audit.py (Kategorie 2)
- scripts/orchestrator-audit.py (Kategorie 5, 8, 9)
- docs/DECISIONS.md + components/*/decisions.md (Abgleich)
- docs/workflow-patterns.md (Kategorie 8, 9)

**Wird gebraucht von:**
- Orchestrator (auf Zuruf oder als Qualitaetskontrolle)

## Schnittstellen

**Eingabe:** Filter-Argument (z.B. `all`, `quality`, `infra`, `code`)
**Ausgabe:** Checkliste mit [OK]/[WARN]/[FAIL]/[INFO] + Empfehlungen

## Konfiguration

- Audit-Ergebnisse: `docs/audits/YYYY-MM-DD.md`
- Config-Audit Script: `scripts/config-audit.py`
- Orchestrator-Audit Script: `scripts/orchestrator-audit.py`

## Bekannte Einschraenkungen

- Nicht-destruktiv: Aendert keine Dateien, gibt nur Empfehlungen
- DECISIONS.md Abgleich ist Pflicht um false positives zu vermeiden
- Compliance-Violations bei Doku/Admin-Sessions sind oft false positives (kein Feature-Workflow)
- **MiniMax SDK-Delegation aktiv** — Kategorien 5, 6, 8, 9 delegieren Rohdaten-Analyse an MiniMax via consult-sdk.mjs. Der SDK-Agent hat Read/Glob/Grep-Zugriff und analysiert Dateien selbst.
