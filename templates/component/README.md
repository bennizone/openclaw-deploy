# Component Templates

Jeder Slash-Command braucht diese Dateien:

## Pflicht-Checkliste

- [ ] `.claude/commands/<name>.md` — Slash-Command Definition
- [ ] `components/<name>/description.md` — Architektur, Abhaengigkeiten, Schnittstellen
- [ ] `components/<name>/claude.md` — Scope, Regeln, Abgrenzung
- [ ] `components/<name>/testinstruct.md` — Health-Checks, Funktions-Tests
- [ ] Eintrag in `CLAUDE.md` Slash-Commands Tabelle
- [ ] Eintrag in `CLAUDE.md` Komponenten-Map (falls eigene Dateien/Services)

## Optionale Dateien

- `components/<name>/decisions.md` — Komponentenspezifische Entscheidungen
- `components/<name>/new-tool-checklist.md` — Checklist fuer neue Sub-Features

## Templates nutzen

1. Kopiere die `.template` Dateien nach `components/<name>/`
2. Entferne die `.template` Endung
3. Ersetze alle `{{PLATZHALTER}}` mit echten Inhalten
4. Entferne nicht benoetigte Sektionen (z.B. "Neues Feature" bei Meta-Agenten)

## Format-Regeln

- Keine Umlaute in Dateinamen (ae, oe, ue stattdessen)
- Keine Emojis
- description.md: Fakten, keine Prosa
- claude.md: Imperative Regeln, kurz
- testinstruct.md: Copy-paste-faehige bash-Commands
