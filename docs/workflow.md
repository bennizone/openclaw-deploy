# Workflow bei neuen Features / Aenderungen

## Stufen

Der Orchestrator klassifiziert jede Aufgabe in eine von drei Stufen.
Die Stufe bestimmt, welche Schritte durchlaufen werden.

| Stufe | Wann | Schritte |
|-------|------|----------|
| **Minimal** | Einzeiler, Typo, Config-Tweak, 1-2 Dateien ohne Architektur-Impact | 5 → 6 → 12 |
| **Standard** | Feature, Bugfix, eine Komponente | Alle 1-13 |
| **Komplex** | Multi-Komponente, Architektur-Aenderung | Alle 1-13 + Preflight + erweiterte Konsultation |

**Preflight (nur Komplex):** Statt selbst viele Dateien zu lesen, einen SDK-Agent den Kontext zusammenfassen lassen:
```bash
node scripts/consult-sdk.mjs \
  --question "Fasse zusammen was ich wissen muss um <aufgabe> umzusetzen. Lies relevante Dateien und gib mir: 1) Betroffene Komponenten 2) Relevante Architektur-Details 3) Bekannte Einschraenkungen" \
  --tools Read,Glob,Grep --max-turns 10
```

## Die 13 Schritte

| # | Schritt | Wer | Details |
|---|---------|-----|---------|
| 1 | Ziel klaeren | User + Orchestrator | Stufe klassifizieren |
| 2 | Komponenten identifizieren | `identify-components.mjs` | `node scripts/identify-components.mjs --question "<anfrage>"` |
| 3 | Konsultationsrunde | MiniMax (alle betroffenen Agenten) | Konflikte, Abhaengigkeiten, Bedenken — lieber zu viel als zu wenig |
| 4 | Plan + User-Freigabe | Orchestrator | Autonomie-Level pruefen (`autonomy-status.py check`), bei Level 2+ Standard-Ops direkt weiter |
| 5 | Coding | `/coder-light` (Default), `/coder` bei Architektur/Multi-Komponente | Liest vorher `claude.md` der Komponente |
| 6 | Build | `npm run build` / `openclaw plugins doctor` | |
| 7 | Review | `/reviewer` | Findet mechanische + Design-Findings |
| 8 | Fixes | `/coder-light` oder `/coder` | **Alles sofort fixen** — nur parken wenn: Plan-Abweichung oder User-Entscheidung noetig |
| 9 | Re-Review | `/reviewer` | Prueft ob Fixes sauber sind (max 2 Review-Loops: 7→8→9→8→9) |
| 10 | Docs | `/docs` | DECISIONS.md, description.md, **testinstruct.md** — nach finalem Code |
| 11 | Test | `/tester` | Gegen **aktuelle** testinstruct.md |
| 12 | Ship it | Commit + Deploy | Zusammenfassung mit geparkten Findings |
| 13 | Record + Reflect + TODO | `autonomy record` + `/reflect` + TODO aktualisieren | Immer. MiniMax analysiert alle Sessions, Learnings → Agent-MDs. TODO-Eintrag als erledigt markieren falls vorhanden |

## Loops

### Review-Loop (Schritte 7-9)

```
7 (Review) → 8 (Fixes) → 9 (Re-Review)
                              ↓ sauber? → weiter zu 10
                              ↓ nicht sauber? → zurueck zu 8 (max 2 Durchlaeufe)
                              ↓ nach 2 Loops nicht sauber → User einschalten
```

### Test-Loop (Schritt 11)

```
11 (Test) → Fehler gefunden?
              ↓ nein → weiter zu 12
              ↓ ja → zurueck zum Orchestrator
                       ↓ Bug im Code → Schritt 5 (Coding)
                       ↓ Design-Problem → Schritt 4 (Plan)
                       (max 2 Test-Loops, danach User einschalten)
```

## Regeln

- **Orchestrator schreibt KEINEN Code** — auch nicht "nur kurz". Immer `/coder` oder `/coder-light` delegieren
- **`/coder-light` ist Default** — MiniMax fuer Einzel-Datei-Aenderungen, mechanische Fixes, bekannte Patterns. `/coder` (Claude) nur bei Architektur, Multi-Komponenten, komplexer Logik
- **Reviewer parkt minimal** — Nur bei Plan-Abweichung oder User-Entscheidung. Alles andere sofort fixen
- **Reflect ist Pflicht** — MiniMax analysiert Orchestrator- UND Agent-Sessions. Learnings werden in betroffene Agent-MDs geschrieben
- **Docs NACH Review** — testinstruct.md wird erst aktualisiert wenn der Code final ist, damit der Tester gegen aktuelle Instruktionen testet
- **Loop-Limits einhalten** — Max 2 Review-Loops, max 2 Test-Loops. Danach User einschalten

## Stufen-Matrix

Welche Schritte bei welcher Stufe:

| Schritt | Minimal | Standard | Komplex |
|---------|:-------:|:--------:|:-------:|
| 1 Ziel klaeren | — | x | x |
| 2 Komponenten identifizieren | — | x | x |
| 3 Konsultationsrunde | — | x | x (erweitert) |
| 4 Plan + Freigabe | — | x | x |
| 5 Coding | x | x | x |
| 6 Build | x | x | x |
| 7 Review | — | x | x |
| 8 Fixes | — | x | x |
| 9 Re-Review | — | x | x |
| 10 Docs | — | x | x |
| 11 Test | — | x | x |
| 12 Ship it | x | x | x |
| 13 Record + Reflect + TODO | — | x | x |
