# Tokenfresser — MiniMax Chunked Map-Reduce

Generisches Tool um grosse Datenmengen durch MiniMax zu analysieren statt durch Claude.
Basiert auf `consult-agent.sh --input-file`.

## Wann nutzen?

- Daten > 6000 Zeichen die analysiert werden muessen
- Analyse-Aufgaben die keine Claude-Intelligenz brauchen (Pattern-Erkennung, Zusammenfassungen, Entwuerfe)
- Ueberall wo Claude aktuell grosse Dateien liest nur um sie zusammenzufassen

## Aufruf

```bash
scripts/consult-agent.sh <komponente> "<map-prompt>" \
  --input-file <daten.txt> \
  --reduce-prompt "<konsolidierungs-prompt>" \
  --delay 3 --overlap 5 \
  --usage-log <logfile>
```

### Parameter

| Parameter | Beschreibung | Default |
|-----------|-------------|---------|
| `<komponente>` | Komponente deren description.md als System-Prompt dient | (pflicht) |
| `<map-prompt>` | Prompt der pro Chunk ausgefuehrt wird | (pflicht) |
| `--input-file` | Datei mit den zu analysierenden Daten | - |
| `--reduce-prompt` | Prompt fuer die Konsolidierungs-Phase | Auto-generiert |
| `--delay` | Sekunden zwischen Chunk-Starts | 3 |
| `--overlap` | Zeilen-Overlap zwischen Chunks | 3 |
| `--usage-log` | Datei fuer Token-Tracking (append) | - |
| `--brief` | Kompakte Antworten (5-8 Saetze) | - |

### Wie es funktioniert

1. **Split**: Datei wird an Absatzgrenzen in Chunks a 6000 Zeichen aufgeteilt
2. **Overlap**: Letzte N Zeilen des vorherigen Chunks werden vorangestellt
3. **Map**: Chunks werden parallel an MiniMax gesendet (mit --delay Versatz)
4. **Reduce**: Teilergebnisse werden konsolidiert (zweistufig wenn >6000 Zeichen)
5. **Output**: Konsolidiertes Ergebnis auf stdout

### Beispiele

```bash
# Session auf Token-Waste analysieren
scripts/consult-agent.sh reviewer "Finde Token-Waste Patterns" \
  --input-file /tmp/calls.txt \
  --reduce-prompt "Konsolidiere und erstelle Patch-Tabelle"

# Code-Diff reviewen lassen
git diff HEAD~3 > /tmp/diff.txt
scripts/consult-agent.sh reviewer "Pruefe diesen Diff auf Probleme" \
  --input-file /tmp/diff.txt \
  --reduce-prompt "Liste alle Findings als Tabelle"

# Audit-Daten analysieren
scripts/consult-agent.sh audit "Bewerte diese Config auf Probleme" \
  --input-file /tmp/config-dump.txt
```

## Wer nutzt es?

- `/reflect` via `scripts/reflect-auto.sh` — Session-Analyse
- `/audit` — Kategorien 5, 6, 8, 9 (Compliance, Code, Workflow, Reflect)
- `/reviewer` — Grosse Git-Diffs (>6000 Zeichen) Erstanalyse
