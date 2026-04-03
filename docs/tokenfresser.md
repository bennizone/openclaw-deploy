# MiniMax SDK-Delegation

Generisches Pattern um Analyse-Aufgaben an MiniMax M2.7 zu delegieren statt Claude-Tokens zu verbrauchen.
Basiert auf `scripts/consult-sdk.mjs` (Claude Code SDK Agent).

## Wann nutzen?

- Analyse-Aufgaben die keine Claude-Intelligenz brauchen (Pattern-Erkennung, Zusammenfassungen, Entwuerfe)
- Grosse Dateien die gelesen und analysiert werden muessen
- Ueberall wo Claude aktuell Dateien liest nur um sie zusammenzufassen

## Aufruf

```bash
node scripts/consult-sdk.mjs \
  --component <komponente> \
  --question "<analyse-prompt>" \
  [--input-file <datei>] \
  [--with-decisions] \
  [--brief] \
  [--usage-log <logfile>] \
  [--max-turns <n>]
```

### Parameter

| Parameter | Beschreibung | Default |
|-----------|-------------|---------|
| `--component` | Komponente deren description.md als System-Prompt dient | (pflicht) |
| `--question` | Analyse-Prompt | (pflicht) |
| `--input-file` | Datei die der Agent selbst liest (via Read-Tool) | - |
| `--with-decisions` | decisions.md an System-Prompt anhaengen | - |
| `--brief` | Kompakte Antworten (5-8 Saetze) | - |
| `--usage-log` | Datei fuer Token-Tracking (append) | - |
| `--max-turns` | Max agentic turns (Safety-Limit) | 15 |

### Wie es funktioniert

Der SDK-Agent laeuft auf MiniMax M2.7 als Backend und hat **Read/Glob/Grep-Zugriff**.
Er kann Dateien selbst lesen und durchsuchen — kein manuelles Chunking oder Map-Reduce noetig.

1. System-Prompt wird aus `components/<komponente>/description.md` geladen
2. SDK spawnt einen Claude Code Prozess mit MiniMax-ENV
3. Agent liest die angegebene Datei selbst (bei --input-file)
4. Agent kann bei Bedarf weitere Dateien lesen (description.md, decisions.md, Code)
5. Ergebnis auf stdout

### Beispiele

```bash
# Session auf Token-Waste analysieren
node scripts/consult-sdk.mjs --component reviewer \
  --question "Analysiere diese Session-Daten auf Token-Waste. Erstelle Patch-Tabelle." \
  --input-file /tmp/calls.txt

# Code-Diff reviewen lassen
git diff HEAD~3 > /tmp/diff.txt
node scripts/consult-sdk.mjs --component reviewer \
  --question "Pruefe diesen Diff auf Secrets, Breaking Changes, toter Code." \
  --input-file /tmp/diff.txt

# Audit-Daten analysieren
node scripts/consult-sdk.mjs --component audit \
  --question "Bewerte diese Config auf Probleme" \
  --input-file /tmp/config-dump.txt --brief
```

## Wer nutzt es?

- `/reflect` via `scripts/reflect-auto.sh` — Session-Analyse
- `/audit` — Kategorien 5, 6, 8, 9 (Compliance, Code, Workflow, Reflect)
- `/reviewer` — Grosse Git-Diffs Erstanalyse
- `/plan-review` — Komponenten-Konsultation
- `/consult` — Direkte Komponenten-Befragung

## Vorteile gegenueber dem alten consult-agent.sh

| Alt (consult-agent.sh) | Neu (consult-sdk.mjs) |
|------------------------|----------------------|
| Gateway muss laufen | Direkt via MiniMax API |
| Kein Tool-Zugriff | Read/Glob/Grep verfuegbar |
| Manuelles Chunking (6000 Zeichen) | Agent liest Dateien nativ |
| Map-Reduce in Bash | Agent konsolidiert selbst |
| Nur Text-in/Text-out | Agent kann Dateien durchsuchen |
