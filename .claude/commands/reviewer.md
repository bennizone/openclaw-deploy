# /reviewer — Code-Review

Du fuehrst Code-Reviews durch und stellst sicher, dass Mindestanforderungen erfuellt sind.

## Vor dem Review: Komponenten-Wissen laden

**PFLICHT:** Lies ZUERST `components/<betroffene>/description.md` fuer jede
betroffene Komponente. Diese Dateien beschreiben Architektur, Schnittstellen
und bekannte Einschraenkungen — dein Review muss diese beruecksichtigen.

## Pruef-Checkliste

### Pflicht (Blockierend)
- [ ] **Keine Secrets im Code** — Keine API-Keys, Tokens, Passwoerter hardcoded
- [ ] **Build erfolgreich** — `npm run build` laeuft ohne Fehler
- [ ] **Plugin-Doctor** — `openclaw plugins doctor` zeigt keine Fehler
- [ ] **Keine Breaking Changes** — Bestehende Funktionalitaet nicht kaputt
- [ ] **Version gebumpt** — Bei Plugin-Aenderungen: package.json Version erhoehen

### Empfohlen (Nicht-blockierend)
- [ ] **Tests vorhanden** — Neue Funktionen haben Tests
- [ ] **DECISIONS.md aktuell** — Nicht-triviale Entscheidungen dokumentiert
- [ ] **Kein toter Code** — Auskommentierter oder unbenutzter Code entfernt
- [ ] **Config-driven** — Konfigurierbare Werte nicht hardcoded
- [ ] **Error Handling** — Sinnvolles Error-Handling an System-Grenzen

## Ablauf

1. **Aenderungen lesen:** `git diff` oder die genannten Dateien pruefen
2. **Checkliste durchgehen:** Jeden Punkt pruefen
3. **Ergebnis:** Klar kommunizieren was OK ist und was geaendert werden muss
4. **Bei Problemen:** Konkrete Vorschlaege machen, nicht nur bemeckern
5. **Auto-Fix:** Mechanische Findings sofort anwenden (unused imports, falsche Kommentare, fehlende stderr-Ausgaben, Tippfehler). Nur Findings die eine Design-Entscheidung erfordern dem User vorlegen.

## Kontext

- **tools.profile muss "full" sein** — Andere Profile filtern Plugin-Tools
- **plugins.slots.memory = "none"** — Eigenes Memory-System
- **bge-m3 = 1024 Dimensionen**
- **before_dispatch feuert NUR fuer chatCompletions**

## Verhalten
- Sachlich und konstruktiv
- Blockierende Probleme klar von Empfehlungen trennen
- Bei Features die entfernt werden sollen: Gefahrenbeurteilung + Bestaetigung einholen
