# /reflect — Session Self-Reflection

Analysiert eine Claude Code Session auf Token-Waste und schlaegt Patches fuer Checklisten vor.

## Input

$ARGUMENTS

Wenn leer: Frage nach dem JSONL-Pfad. Tipp: JSONL-Sessions liegen unter
`~/.claude/projects/-home-openclaw-openclaw-deploy/`.

## Workflow

### Schritt 1: Tool-Calls extrahieren

```bash
python3 scripts/extract-session-calls.py "$JSONL_PATH" --max-result-len 200
```

Speichere das Ergebnis in einer Variable. Zaehle: Total Calls, Errors, Tool-Verteilung.

### Schritt 2: MiniMax-Analyse

Sende die extrahierten Tool-Calls an MiniMax via consult-agent.sh.
Waehle die Komponente, deren Checklisten am staerksten betroffen sind.

Wenn nicht klar welche Komponente: Nutze `tool-hub` als Default (hat die meisten
operativen Checklisten).

**System-Prompt erweitern:** Haenge die extrahierten Tool-Calls als User-Message an:

```bash
scripts/consult-agent.sh <komponente> "Analysiere diese Session auf Token-Waste.
Finde: 1) Fehlgeschlagene Calls — wo haette die Info stehen muessen?
2) Wiederholte Reads gleicher Datei — warum nicht beim ersten Mal?
3) Exploratorische Ketten (ls, grep, head) — was fehlte?
4) Bekannte Fehler wiederholt — wo war es dokumentiert, warum nicht gelesen?

Gib konkrete Patch-Vorschlaege: 'In DATEI nach ZEILE ergaenzen: TEXT'
Keine Selbstbeweihraecherung, nur actionable Fixes.

--- Session Tool-Calls ---
$(python3 scripts/extract-session-calls.py "$JSONL_PATH" --max-result-len 200)"
```

**Hinweis:** Wenn die Session zu lang fuer einen consult-Call ist (> ~4000 Zeichen),
kuerze mit `--max-result-len 100` oder filtere auf Errors + die 10 Calls davor/danach.

### Schritt 3: Ergebnisse praesentieren

Zeige dem User:
1. **Statistik:** Total Calls, Errors, Waste-Rate
2. **Gefundene Patterns:** Was hat MiniMax identifiziert?
3. **Patch-Vorschlaege:** Pro Checkliste/Datei, was ergaenzt werden soll

Formatiere als Tabelle:

```
| # | Pattern | Betroffene Datei | Vorgeschlagener Patch |
|---|---------|-----------------|----------------------|
```

### Schritt 4: User-Review

Frage: "Welche Patches soll ich anwenden? (alle / nummern / skip)"

- **alle**: Alle Patches anwenden
- **nummern** (z.B. "1,3"): Nur ausgewaehlte Patches
- **skip**: Nichts aendern

### Schritt 5: Patches anwenden

Fuer jeden genehmigten Patch:
1. Ziel-Datei lesen (Checkliste, claude.md, etc.)
2. Patch an der richtigen Stelle einfuegen
3. Sicherstellen dass kein Duplikat entsteht

### Schritt 6: workflow-patterns.md aktualisieren

Trage die gefundenen Patterns in `docs/workflow-patterns.md` ein:

```markdown
| Datum | Feature | Pattern | Fix |
```

Wenn das Feature nicht klar ist, frage den User.

### Schritt 7: Zusammenfassung

Kurze Zusammenfassung: Was wurde gepatcht, welche Patterns gefunden.
Kein Commit — das macht der User oder der uebergeordnete Workflow.
