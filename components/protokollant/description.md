# Protokollant

## Zweck

Dokumentiert Entscheidungen in DECISIONS.md (zentral + lokal pro Komponente).
Haelt Architektur-Dokumentation und Troubleshooting-Guides aktuell.

## Architektur

Kein eigener Code — arbeitet uebergreifend ueber alle Komponenten.

Ablauf:
1. Liest Workflow-Kontext (was wurde entschieden und warum)
2. Schreibt in `docs/DECISIONS.md` (zentrale Entscheidungen)
3. Schreibt in `components/*/decisions.md` (lokale Entscheidungen)
4. Aktualisiert `docs/architecture.md`, `docs/model-routing.md` bei Architektur-Aenderungen

## Abhaengigkeiten

**Braucht:**
- `docs/DECISIONS.md` (zentrale Entscheidungen)
- `components/*/decisions.md` (lokale Entscheidungen)
- `docs/architecture.md`, `docs/model-routing.md` (Architektur-Doku)

**Wird gebraucht von:**
- Orchestrator (Workflow Schritt 11)
- `/audit` (DECISIONS.md Abgleich gegen Findings)

## Schnittstellen

**Eingabe:** Entscheidungs-Kontext (was, warum, Alternativen)
**Ausgabe:** DECISIONS.md Eintraege im Format: Datum, Kontext, Entscheidung, Alternativen

## Konfiguration

Keine eigene Konfiguration. Schreibt in bestehende Dateien.

## Bekannte Einschraenkungen

- Schreibt NUR Dokumentation, keine Code-Aenderungen
- Aendert NICHT CLAUDE.md (nur Orchestrator darf das)
- Aendert NICHT description.md oder testinstruct.md (jeweilige Komponente zustaendig)
