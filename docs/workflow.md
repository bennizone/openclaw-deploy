# Workflow bei neuen Features / Aenderungen

1. Ziel klaeren mit User
2. Betroffene Komponenten identifizieren (`components/*/description.md` lesen — PFLICHT, nicht ueberspringen!)
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
10b. Design-Findings die den Workflow BLOCKIEREN (Architektur, API-Bruch, Sicherheit) → SOFORT User-Input holen
10c. Nicht-blockierende Design-Findings die keine User-Entscheidung brauchen → SOFORT an `/coder` delegieren
10d. Nicht-blockierende Design-Findings die User-Input brauchen → auf TODO-Liste parken, in Zusammenfassung (Schritt 13) anzeigen
11. Protokollant (`/docs`): DECISIONS.md zentral + lokal
12. Betroffene Agenten aktualisieren ihre MDs (description, testinstruct)
13. Ship it: Commit + Deploy — Zusammenfassung zeigt geparkte Design-Findings aus 10c
14. Reflection (optional): `/reflect` — MiniMax analysiert Session auf Token-Waste,
    Orchestrator ergaenzt, `/reviewer` prueft, User gibt frei. Skip mit "skip"
