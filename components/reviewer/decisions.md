# Reviewer — Entscheidungen

## 2026-04-03: Learnings in eigene learnings.md, nicht claude.md

**Kontext:** /reflect soll Agent-spezifische Learnings in Komponenten-Docs schreiben.
Drei Optionen evaluiert: claude.md, testinstruct.md, eigene learnings.md.

**Entscheidung:** Eigene `components/*/learnings.md` pro Komponente.

**Alternativen:**
- claude.md: Verworfen — wird vollgemuellt, claude.md soll kompakt bleiben
- testinstruct.md: Verworfen — Tester warnte vor Verwechslung mit Test-Anweisungen
- HTML-Kommentare in claude.md: Verworfen — versteckt Inhalte, schwer wartbar

**Konsequenzen:**
- Reviewer kann learnings.md bei Reviews mitlesen
- Format: HTML-Kommentar mit strukturierten Feldern (component, type, trigger, validated)
- `validated: false` als Default — Reviewer oder User bestaetigt
- orchestrator-audit.py erlaubt Writes auf learnings.md (ALLOWED_ORCHESTRATOR_PATTERNS)

## 2026-04-03: MiniMax als Default-Reviewer (Delegation)

**Kontext:** Reviews werden seit SDK-Migration komplett an MiniMax delegiert.
Claude prueft nur noch das kompakte Ergebnis.

**Entscheidung:** Alle Diffs > 0 Zeilen via `consult-sdk.mjs --component reviewer`
an MiniMax. Findings-Tabelle mit [mechanisch]/[BLOCKIEREND]/[TODO] Kategorien.

**Konsequenzen:** Token-sparend. MiniMax-Findings als Startpunkt, nicht Endergebnis.
