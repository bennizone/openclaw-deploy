# /reflect — Session Self-Reflection

Analysiert eine Claude Code Session auf Token-Waste und schlaegt Patches fuer Checklisten vor.

## Input

$ARGUMENTS

Wenn leer: Frage nach dem JSONL-Pfad. Tipp: JSONL-Sessions liegen unter
`~/.claude/projects/-home-openclaw-openclaw-deploy/`.

## Rollenverteilung

| Rolle | Wer | Aufgabe |
|-------|-----|---------|
| Extraktion | Python-Script (lokal) | JSONL → Tool-Call-Liste, deterministisch |
| Analyse + Fix-Vorschlaege | MiniMax (via consult-agent.sh) | Patterns finden, konkrete Patches vorschlagen |
| Luecken fuellen | Orchestrator (Claude) | Wenn MiniMax keinen Fix hat → mit breiterem Ueberblick ergaenzen |
| Review | `/reviewer` | Patches auf Seiteneffekte und Qualitaet pruefen |
| Freigabe | User | Finale Entscheidung was angewendet wird |

## Workflow

### Schritt 1: Tool-Calls extrahieren

```bash
python3 scripts/extract-session-calls.py "$JSONL_PATH" --max-result-len 200
```

Speichere das Ergebnis. Zaehle: Total Calls, Errors, Tool-Verteilung.

### Schritt 2: MiniMax-Analyse

Sende eine kompakte Zusammenfassung an MiniMax via consult-agent.sh.
Waehle die Komponente, deren Checklisten am staerksten betroffen sind.
Wenn nicht klar: `tool-hub` als Default.

MiniMax soll fuer jedes Pattern:
- Das Problem beschreiben
- Einen konkreten Fix vorschlagen: "In DATEI nach STELLE ergaenzen: TEXT"
- Wenn kein Fix moeglich: Pattern trotzdem melden mit "KEIN FIX — braucht Orchestrator"

```bash
scripts/consult-agent.sh <komponente> "Analysiere diese Session auf Token-Waste.

Finde:
1) Fehlgeschlagene Calls — wo haette die Info stehen muessen?
2) Wiederholte Reads gleicher Datei — warum nicht beim ersten Mal?
3) Exploratorische Ketten (ls, grep, head) — was fehlte?
4) Bekannte Fehler wiederholt — wo war es dokumentiert, warum nicht gelesen?

Fuer jedes Pattern: Schlage einen konkreten Patch vor.
Falls du keinen Fix hast: Melde das Pattern trotzdem mit 'KEIN FIX'.
Format: 'In DATEI nach STELLE ergaenzen: TEXT'

--- Kompakte Session-Zusammenfassung ---
<hier die Zusammenfassung einfuegen>"
```

**Hinweis:** Sende NICHT die volle Tool-Call-Liste — MiniMax hat 45s Timeout.
Stattdessen: Kompakte Zusammenfassung mit Statistik, Errors + Kontext (3 Calls davor/danach),
und auffaellige Muster (wiederholte Reads, Grep-Ketten). Max ~3000 Zeichen.

### Schritt 3: Orchestrator ergaenzt

Pruefe MiniMax-Ergebnisse:
- Gibt es Patterns mit "KEIN FIX"? → Mit breiterem Projektueberblick ergaenzen
- Fehlen offensichtliche Patterns die MiniMax uebersehen hat?
- Sind die vorgeschlagenen Dateipfade korrekt? (Checklisten existieren?)

Ergaenze eigene Patch-Vorschlaege wo noetig.

### Schritt 4: Alle Patches sammeln und praesentieren

Zeige dem User:
1. **Statistik:** Total Calls, Errors, Waste-Rate
2. **Gefundene Patterns:** Von MiniMax + Orchestrator
3. **Patch-Vorschlaege:** Pro Checkliste/Datei

Formatiere als Tabelle:

```
| # | Quelle | Pattern | Betroffene Datei | Vorgeschlagener Patch |
|---|--------|---------|-----------------|----------------------|
| 1 | MiniMax | ...     | ...             | ...                  |
| 2 | Orchestrator | ... | ...            | ...                  |
```

### Schritt 5: Review

Rufe `/reviewer` auf mit den gesammelten Patches:
- Sind Patches korrekt und sinnvoll?
- Seiteneffekte? Duplikate?
- Passt der Patch zur bestehenden Struktur der Ziel-Datei?

### Schritt 6: User-Freigabe

Zeige Review-Ergebnis und frage:
"Welche Patches soll ich anwenden? (alle / nummern / skip)"

- **alle**: Alle Patches anwenden
- **nummern** (z.B. "1,3"): Nur ausgewaehlte Patches
- **skip**: Nichts aendern

### Schritt 7: Patches anwenden

Fuer jeden genehmigten Patch:
1. Ziel-Datei lesen (Checkliste, claude.md, etc.)
2. Patch an der richtigen Stelle einfuegen
3. Sicherstellen dass kein Duplikat entsteht

### Schritt 8: workflow-patterns.md aktualisieren

Trage die gefundenen Patterns in `docs/workflow-patterns.md` ein:

```markdown
| Datum | Feature | Pattern | Fix |
```

Wenn das Feature nicht klar ist, frage den User.

### Schritt 9: Zusammenfassung

Kurze Zusammenfassung: Was wurde gepatcht, welche Patterns gefunden.
Kein Commit — das macht der User oder der uebergeordnete Workflow.
