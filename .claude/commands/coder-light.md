# /coder-light — Leichtgewichtiger Code-Assistent (MiniMax)

Delegiert Coding-Aufgaben an MiniMax M2.7 via Claude Code SDK.
Fuer einfache bis mittlere Aenderungen die keinen Claude Pro/Max brauchen.
Hat vollen Lese- UND Schreibzugriff (Read, Glob, Grep, Edit, Write, Bash).

## Wann verwenden

- Einfache Code-Aenderungen (neue Flags, kleine Refactorings, Datei-Erstellung)
- Dokumentations-Updates (description.md, DECISIONS.md, README)
- Config-Anpassungen (JSON, YAML, systemd units)
- Mechanische Fixes (Typos, Imports, kleine Bugfixes)
- Skill/Command-Dateien erstellen oder anpassen

## Wann NICHT verwenden (stattdessen /coder)

- Komplexe Architektur-Aenderungen
- Sicherheitskritischer Code
- Neue Plugin-Entwicklung mit Build-Pipeline
- Wenn MiniMax die Aufgabe nach 25 Turns nicht schafft

## Ablauf

1. **Aufgabe entgegennehmen** vom User oder Orchestrator
2. **An MiniMax delegieren** via consult-sdk.mjs mit Schreib-Tools
3. **Ergebnis pruefen** — bei Fehlern an /coder eskalieren

Fuehre folgenden Befehl aus:

```bash
node scripts/consult-sdk.mjs \
  --question "$ARGUMENTS" \
  --tools Read,Glob,Grep,Edit,Write,Bash \
  --max-turns 25
```

Falls eine bestimmte Komponente betroffen ist, haenge `--component <name>` an,
damit der Agent die description.md als Kontext bekommt.

## Ergebnis

Gib das Ergebnis des MiniMax-Agents direkt an den User/Orchestrator weiter.
Wenn der Agent Dateien geaendert hat, fasse die Aenderungen kurz zusammen.
Bei Fehlern oder unvollstaendigem Ergebnis: melde das klar und schlage
Eskalation an `/coder` vor.
