# Plan: Entwicklungsprozess optimieren — Phasen F.1, F.2, F.3

## Context

Der Entwicklungsprozess hat solide Grundlagen (7 Komponenten-Agenten, `/reflect`, `workflow-patterns.md`, Memory-System), aber der Feedback-Loop ist offen: Learnings werden gesammelt, aber nie aggregiert, validiert oder zurueck in Docs geschrieben. Das Stuetzraeder-Protokoll (graduierte Autonomie) ist geplant aber nicht implementiert.

Ziel: Drei aufeinander aufbauende Phasen, die jeweils eigenstaendig Mehrwert liefern.

---

## Phase F.1: Multi-Session-Aggregation ✅

**Ziel:** Patterns ueber mehrere Sessions erkennen statt nur einzelne zu analysieren.
**Status:** Abgeschlossen (2026-04-01). Bonus: Reviewer Auto-Fix im Workflow verankert, /reflect bezieht Reviewer-Findings ein.

### F.1.1 — workflow-patterns.md erweitern

Zwei neue Spalten: `Status` (offen/geloest) und `Anzahl` (Haeufigkeit).

**Datei:** `docs/workflow-patterns.md`
```
| Datum | Feature | Pattern | Fix | Status | Anzahl |
```
Bestehende 7 Eintraege: Status=geloest (alle haben Fixes), Anzahl=1.

### F.1.2 — `scripts/aggregate-sessions.py` erstellen

Python-Script das `extract_tool_calls()` aus `extract-session-calls.py` importiert und ueber mehrere Sessions laufen laesst.

**Kernlogik:**
1. Alle `*.jsonl` aus einem Verzeichnis (Default: `~/.claude/projects/-home-openclaw-openclaw-deploy/`) einlesen
2. Pro Session: Tool-Calls extrahieren, Error-Rate berechnen, Tool-Verteilung
3. Cross-Session: Errors nach Fingerprint gruppieren (Tool-Name + Error-Typ)
4. Patterns mit >= 3 Vorkommen als "strukturell" markieren
5. Output: JSON oder Kompakt-Text fuer MiniMax (max 3000 Zeichen)

**CLI:**
```bash
python3 scripts/aggregate-sessions.py [--dir DIR] [--since YYYY-MM-DD] [--json] [--minimax]
```

**Voraussetzung:** `extract-session-calls.py` muss importierbar sein — `extract_tool_calls()` ist bereits eine saubere Funktion, `scripts/` Verzeichnis in `sys.path` ergaenzen.

### F.1.3 — `scripts/aggregate-sessions.sh` erstellen

Bash-Wrapper der:
1. `aggregate-sessions.py --minimax` ausfuehrt
2. Ergebnis via `consult-agent.sh protokollant` an MiniMax schickt
3. MiniMax-Antwort (Meta-Analyse, strukturelle Probleme) ausgibt

### F.1.4 — `/reflect` Hinweis ergaenzen

In `.claude/commands/reflect.md` nach Schritt 9: Hinweis dass bei >= 3 unanalysierten Sessions `aggregate-sessions.sh` empfohlen wird.

### Verifikation F.1
- `aggregate-sessions.py` gegen bestehende Session-JSONLs laufen lassen
- Pruefen dass `--minimax` Output < 3000 Zeichen
- `aggregate-sessions.sh` End-to-End testen (inkl. MiniMax-Antwort)

---

## Phase F.2: Learnings → Docs Flow ✅

**Ziel:** Patterns aus `workflow-patterns.md` fliessen zurueck in Komponenten-Docs und Checklisten.
**Status:** Abgeschlossen (2026-04-01). Script, Resolution-Tracking, MiniMax-Fallback, Verifikation gegen 7 Patterns.

### F.2.1 — `scripts/learnings-to-docs.py` erstellen

**Kernlogik:**
1. `workflow-patterns.md` parsen (Markdown-Tabelle)
2. Fuer jeden `offen`-Eintrag: Betroffene Komponente bestimmen
   - Fix-Spalte enthaelt oft Dateinamen (z.B. `deploy-checklist.md` → tool-hub)
   - Keyword-Matching gegen Komponenten-Namen
   - Fallback: MiniMax-Konsultation via `consult-agent.sh`
3. Patch-Vorschlaege generieren:
   - `description.md` → "Bekannte Einschraenkungen" Abschnitt
   - Checklisten → Fehlenden Schritt ergaenzen
4. Diff-Style Output zur User-Review

**CLI:**
```bash
python3 scripts/learnings-to-docs.py                  # Vorschlaege zeigen
python3 scripts/learnings-to-docs.py --apply           # Schreiben (User committet)
python3 scripts/learnings-to-docs.py --component NAME  # Nur eine Komponente
```

### F.2.2 — Resolution-Tracking

Wenn ein Fix angewendet wurde: Script prueft ob Fix-Text in Zieldatei existiert → setzt `Status` auf `geloest`. Automatische Validierung statt manueller Pflege.

### Verifikation F.2
- Gegen die 7 bestehenden Patterns laufen lassen
- Pruefen dass korrekte Komponenten erkannt werden
- Pruefen dass keine Duplikate vorgeschlagen werden (XDG ist schon in deploy-checklist)

---

## Phase F.3: Stuetzraeder-Protokoll ✅

**Ziel:** Graduierte Autonomie per Komponente, basierend auf Stabilitaetsdaten.
**Status:** Abgeschlossen (2026-04-01). Config, Script, Doku, Integration in /reflect + CLAUDE.md.

### F.3.1 — Autonomie-Levels definieren

| Level | Name | Was braucht Freigabe? |
|-------|------|-----------------------|
| 0 | Vollstaendig begleitet | Alles |
| 1 | Begleitet mit Vertrauen | Schreibende Aktionen |
| 2 | Ueberwacht | Neue/unbekannte Ops + Deploy |
| 3 | Autonom | Nur Deploy + Config-Aenderungen |

### F.3.2 — `config/autonomy.json` erstellen

```json
{
  "version": 1,
  "levels": {
    "<component>": {
      "current": 0,
      "since": "YYYY-MM-DD",
      "metrics": {
        "sessions_total": 0,
        "sessions_error_free": 0,
        "last_error": null
      }
    }
  },
  "progression": { "0→1": 3, "1→2": 5, "2→3": 10 },
  "regression": { "error": "drop_one", "critical": "reset_to_0" }
}
```

Alle 10 Komponenten starten bei Level 0.

### F.3.3 — `scripts/autonomy-status.py` erstellen

**Subcommands:**
- `status` — Aktuelle Levels aller Komponenten
- `check <comp> <operation>` — Braucht diese Op Freigabe?
- `record <comp> [--error]` — Session-Ergebnis eintragen, Metriken updaten
- `suggest-promotions` — Welche Komponenten koennten aufsteigen?

### F.3.4 — `docs/stuetzraeder-protokoll.md` erstellen

Level-Definitionen, Progressions-/Regressions-Regeln, Philosophie.

### F.3.5 — Integration

- `/reflect` Schritt 8: Nach Pattern-Eintrag auch `autonomy-status.py record` aufrufen
- CLAUDE.md Workflow Schritt 6: Autonomie-Level pruefen, bei Level 2+ Standard-Ops ohne Freigabe

### Verifikation F.3
- `autonomy.json` mit allen Komponenten bei Level 0 initialisieren
- Einige Sessions manuell eintragen, Promotion-Vorschlaege pruefen
- `check` bei verschiedenen Levels testen

---

## Abhaengigkeiten

```
F.1 Multi-Session-Aggregation
 ├──→ F.2 Learnings → Docs (braucht aggregierte Patterns)
 └──→ F.3 Stuetzraeder (braucht Session-Metriken aus Aggregation)
```

F.1 zuerst, dann F.2 (schliesst Feedback-Loop), dann F.3 (Autonomie).

## Dateien

| Phase | Datei | Aktion |
|-------|-------|--------|
| F.1 | `scripts/aggregate-sessions.py` | Neu |
| F.1 | `scripts/aggregate-sessions.sh` | Neu |
| F.1 | `docs/workflow-patterns.md` | Erweitern (2 Spalten) |
| F.1 | `.claude/commands/reflect.md` | Kleiner Nachtrag |
| F.2 | `scripts/learnings-to-docs.py` | Neu |
| F.3 | `config/autonomy.json` | Neu |
| F.3 | `scripts/autonomy-status.py` | Neu |
| F.3 | `docs/stuetzraeder-protokoll.md` | Neu |
| F.3 | `CLAUDE.md` | Kleiner Nachtrag (Autonomie-Referenz) |

## Bestehender Code zum Wiederverwenden

- `scripts/extract-session-calls.py:32` — `extract_tool_calls()` Funktion (importieren in F.1)
- `scripts/consult-agent.sh` — MiniMax-Bridge (nutzen in F.1 + F.2 Fallback)
- `docs/workflow-patterns.md` — Schema erweitern, nicht ersetzen
- `.claude/commands/reflect.md` — Workflow ergaenzen, nicht umbauen
