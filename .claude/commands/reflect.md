# /reflect — Session Self-Reflection

Analysiert eine Claude Code Session auf Token-Waste und schlaegt Patches fuer Checklisten vor.
Die schwere Analyse laeuft via MiniMax (chunked), Claude reviewt nur das kompakte Ergebnis.

## Input

$ARGUMENTS

Wenn leer: Frage nach dem JSONL-Pfad. Tipp: JSONL-Sessions liegen unter
`~/.claude/projects/-home-openclaw-openclaw-deploy/`.

## Rollenverteilung

| Rolle | Wer | Aufgabe |
|-------|-----|---------|
| Extraktion + Audit | Python-Scripts (lokal) | JSONL → Tool-Calls, Orchestrator-Audit |
| Analyse + Patches | MiniMax (chunked via consult-agent.sh) | Patterns finden, Patches vorschlagen, konsolidieren |
| Autonomie-Updates | Python-Script (lokal) | Metriken mechanisch aktualisieren |
| Review + Luecken | Claude (Orchestrator) | Kompaktes Ergebnis bewerten, KEIN-FIX Patterns ergaenzen |
| Freigabe | User | Finale Entscheidung was angewendet wird |

## Workflow

### Schritt 1: reflect-auto.sh ausfuehren

```bash
scripts/reflect-auto.sh "$JSONL_PATH" --output-dir /tmp/reflect-current
```

Das Script macht automatisch:
1. Tool-Calls extrahieren (`extract-session-calls.py`)
2. Orchestrator Self-Audit (`orchestrator-audit.py`)
3. MiniMax-Analyse mit Chunking (`consult-agent.sh --input-file --reduce-prompt`)
4. Autonomie-Metriken aktualisieren
5. Ergebnis-Datei schreiben: `/tmp/reflect-current/reflect-result.md`

**Warte bis das Script fertig ist.** Es dauert je nach Session-Groesse 1-5 Minuten.

### Schritt 2: Ergebnis lesen und bewerten

Lies `/tmp/reflect-current/reflect-result.md` und pruefe:
- Gibt es Patterns mit "KEIN FIX"? → Mit breiterem Projektueberblick ergaenzen
- Hat MiniMax offensichtliche Patterns uebersehen?
- Sind vorgeschlagene Dateipfade korrekt?
- Self-Audit Violations: Patches korrekt?

### Schritt 3: User-Freigabe

Zeige dem User:
1. **Statistik** (aus Ergebnis-Datei)
2. **Patch-Tabelle** (aus MiniMax-Analyse)
3. **Token-Bilanz** (MiniMax vs. Claude Verbrauch)

Frage: "Welche Patches soll ich anwenden? (alle / nummern / skip)"

### Schritt 4: Patches anwenden

Fuer jeden genehmigten Patch via `/coder`:
1. Ziel-Datei lesen
2. Patch einfuegen (kein Duplikat)
3. Self-Audit-Patches betreffen oft `CLAUDE.md` oder `.claude/commands/*.md`

### Schritt 5: workflow-patterns.md aktualisieren

Trage gefundene Patterns in `docs/workflow-patterns.md` ein:
```markdown
| Datum | Feature | Pattern | Fix | Status | Anzahl |
```
Wenn ein Pattern schon existiert: `Anzahl` hochzaehlen statt Duplikat anlegen.

### Schritt 6: Zusammenfassung

Kurze Zusammenfassung: Was wurde gepatcht, welche Patterns gefunden, Token-Bilanz.
Kein Commit — das macht der User oder der uebergeordnete Workflow.

### Schritt 7: Multi-Session-Aggregation (optional)

Wenn >= 3 Sessions seit der letzten Aggregation unanalysiert sind:
```bash
scripts/aggregate-sessions.sh
```
