# Workflow bei neuen Features / Aenderungen

**Triviale Aufgaben (1-2 Dateien, kein Architektur-Impact):** Maximal 3 Tasks anlegen. Die 14 Schritte sind ein Leitfaden, kein Dogma — bei Ein-Datei-Fixes reichen: 1) Implementieren 2) Review 3) Commit.

**Preflight (optional, bei komplexen Aufgaben):** Statt selbst viele Dateien zu lesen, einen SDK-Agent den Kontext zusammenfassen lassen:
```bash
node scripts/consult-sdk.mjs \
  --question "Fasse zusammen was ich wissen muss um <aufgabe> umzusetzen. Lies relevante Dateien und gib mir: 1) Betroffene Komponenten 2) Relevante Architektur-Details 3) Bekannte Einschraenkungen" \
  --tools Read,Glob,Grep --max-turns 10
```

1. Ziel klaeren mit User
2. Betroffene Komponenten identifizieren — `node scripts/identify-components.mjs --question "<user-anfrage>"` statt alle description.md selbst lesen (spart Kontext):
   ```bash
   node scripts/identify-components.mjs --question "User wants to add wake-word detection"
   ```
   Das Script liest description.md der Reihe nach und gibt betroffene Komponenten zurueck. Danach nur die relevanten description.md selbst lesen.
3. Plan-Entwurf mit Checkliste:
   - [ ] Ziel definiert
   - [ ] Nutzer/Zielgruppe
   - [ ] Sicherheit
   - [ ] Laufzeitumgebung
   - [ ] Abhaengigkeiten
   - [ ] Testbarkeit
4. Konsultationsrunde: Betroffene Agenten via MiniMax befragen (`/consult`) — NICHT ueberspringen, kostet fast nichts
5. Plan konsolidieren, Konflikte aufloesen
6. User-Freigabe — bei Level 2+ Standard-Ops (read, write) ohne extra Freigabe
   (Autonomie-Level pruefen: `python3 scripts/autonomy-status.py check <comp> <op>`)
7. Coding via `/coder` (Claude) — liest vorher `claude.md` der Komponente
8. Build: `npm run build` / `openclaw plugins doctor`
9. `/tester` liest `testinstruct.md`, fuehrt Tests aus — mindestens Health-Checks + Plugin-Doctor
10. `/reviewer` prueft — listet Findings (mechanisch + Design)
10a. Mechanische Findings (unused imports, Tippfehler, fehlende stderr) → SOFORT an `/coder` delegieren, nicht User fragen (NIE selbst fixen!)
    Ausnahme: Tracking-Dateien (TODO.md, Plan-Status in docs/plans/) darf der Orchestrator direkt editieren — diese sind kein Code.
10b. Design-Findings die den Workflow BLOCKIEREN (Architektur, API-Bruch, Sicherheit) → SOFORT User-Input holen
10c. Nicht-blockierende Design-Findings die keine User-Entscheidung brauchen → SOFORT an `/coder` delegieren
10d. Nicht-blockierende Design-Findings die User-Input brauchen → auf TODO-Liste parken, in Zusammenfassung (Schritt 13) anzeigen
11. Protokollant (`/docs`): DECISIONS.md zentral + lokal
    - **Pflicht** bei bewussten Entscheidungen (Design, Architektur, API, neue Patterns, Trade-offs)
    - **Optional** nur bei mechanischen Changes (Typos, Formatting, Refactoring ohne Verhaltenssaenderung)
    - Im Zweifel: DECISIONS.md schreiben — kostet wenig, verhindert Wissensverlust
12. Betroffene Agenten aktualisieren ihre MDs (description, testinstruct)
13. Ship it: Commit + Deploy — Zusammenfassung zeigt geparkte Design-Findings aus 10c
    - **Pre-Commit Gate:** Enthielt diese Aenderung eine bewusste Entscheidung? → DECISIONS.md pruefen
14. Reflection (optional): `/reflect` — MiniMax analysiert Session auf Token-Waste,
    Orchestrator ergaenzt, `/reviewer` prueft, User gibt frei. Skip mit "skip"
