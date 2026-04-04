# Dream v2 — Nächtliche Lernschleife

## Ziel

Der Dream-Prozess wird von einer einfachen Tages-Zusammenfassung zu einer
vollständigen nächtlichen Lernschleife erweitert. Der Agent soll aus seinen
Fehlern lernen, Fakten aktualisieren, und Verhaltensregeln ableiten —
automatisch, jede Nacht.

## Ist-Zustand

- `scripts/dream.mjs` (~660 Zeilen): Findet gestrige Sessions, fasst via
  MiniMax zusammen, injiziert in neue Session, extrahiert Behaviors
- `scripts/consult-sdk.mjs`: Claude Agent SDK auf MiniMax M2.7 (via
  `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`)
- `scripts/reflect-auto.sh`: Token-Waste-Analyse für Claude-Code-Sessions
- Memory-Recall-Plugin: Injiziert `[Erinnerungen]` und `[Anweisungen]` ohne
  Confidence-Angabe. Collections: `memories_{agent}`, `instructions_{agent}`
- Extractor-Joiner: Schneidet Tages-Logs nach UTC-Mitternacht
  (`dateFromTimestamp()` = `ts.slice(0, 10)`)

## Architektur-Entscheidungen

### SDK-Agents statt statische Prompts

Die Analyse-Phasen laufen als SDK-Agents auf MiniMax M2.7 (via consult-sdk.mjs
Pattern). Vorteile:
- Agent kann selbst Dateien lesen und entscheiden was relevant ist
- Chunking bei langen Sessions wird vom SDK/Agent selbst gehandhabt
- MiniMax kostet pro Request, nicht pro Token → mehr Calls = kein Problem

### Hybrid: Script orchestriert, SDK analysiert

- dream.mjs bleibt Orchestrator (Sessions finden, Qdrant-Ops, Report)
- SDK-Agents übernehmen die Denkarbeit (Analyse, Bewertung, Entscheidungen)
- Qdrant-Writes bleiben deterministisch im Script

### Supersede statt Confidence-Inflation

Facts werden nicht durch höhere Confidence überschrieben, sondern per
Update-Mechanismus: SDK-Agent erkennt veralteten Fakt → Script findet den
alten Punkt per Vektor-Suche → updated den Payload direkt. Ein Punkt pro Fakt.

### Relevanz-Vorfilterung statt Full-Scan

Bei der Prüfung gegen bestehende Facts werden nur relevante Einträge aus
Qdrant geladen (Vektor-Suche pro Themenblock, Top-10, Score > 0.65).
Skaliert auf 10.000+ Facts.

### Globale Reflect-Learnings

Neue Collection `reflect_learnings` — agenten-übergreifend. Ein Agent macht
einen Fehler, alle profitieren vom Hint.

---

## Phasen-Übersicht

```
┌─────────────────────────────────────────────────────────────┐
│  dream.mjs (Orchestrator, Cron 04:01)                       │
│                                                             │
│  Vorbereitung:                                              │
│  ├── Extractor-Logs laden (04:00-04:00 Fenster)             │
│  ├── Raw-Sessions laden (für Reflect)                       │
│  └── Bestehende Facts/Behaviors/Learnings aus Qdrant holen  │
│       (Vektor-Suche, relevante Subset pro Themenblock)      │
│                                                             │
│  Pro User/Channel:                                          │
│  ├── SDK-Call 1: Memory-Review                              │
│  │   Input: Gejointe Unterhaltung + relevante Facts         │
│  │   Output: JSON [{action, text, confidence, ...}]         │
│  │                                                          │
│  ├── SDK-Call 2: Behavior-Review                            │
│  │   Input: Gejointe Unterhaltung + bestehende Behaviors    │
│  │   Output: JSON [{action, text, confidence, ...}]         │
│  │                                                          │
│  └── Zusammenfassung (einfacher API-Call, kein SDK nötig)   │
│                                                             │
│  Global (alle Agents):                                      │
│  └── SDK-Call 3: Reflect/Learnings                          │
│      Input: Alle Raw-Sessions (inkl. Tool-Calls)            │
│      Output: JSON [{text, confidence, tools, ...}]          │
│                                                             │
│  Nachbearbeitung (deterministisch):                         │
│  ├── Qdrant-Writes (new/supersede/lower Actions ausführen)  │
│  ├── Session-Injection (Zusammenfassung + Lern-Summary)     │
│  └── Report → /tmp/dream-report-YYYY-MM-DD.md              │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementierungs-Schritte

### Phase 1: Extractor 04:00-Schnitt

**Datei:** `services/extractor/src/joiner.ts`

**Änderung:** `dateFromTimestamp()` bekommt einen Offset von -4 Stunden,
damit der "Dream-Tag" von 04:00 bis 04:00 geht statt Mitternacht bis
Mitternacht.

```typescript
// Vorher:
function dateFromTimestamp(ts: string): string {
  return ts.slice(0, 10);
}

// Nachher:
const DAY_BOUNDARY_HOUR = 4; // Dream-Tag beginnt um 04:00

function dateFromTimestamp(ts: string): string {
  const d = new Date(ts);
  d.setHours(d.getHours() - DAY_BOUNDARY_HOUR);
  return d.toISOString().slice(0, 10);
}
```

**Auswirkung:** Nachrichten von 00:00-03:59 werden dem Vortag zugeordnet.
Session-Reset (04:00) und Extractor-Tagesschnitt sind synchron.

**Test:** Extractor neustarten, prüfen ob bestehende Logs korrekt bleiben.
Neue Logs ab nächstem Tag mit neuem Schnitt. Backfill-Option erwägen.

**Risiko:** Bestehende Tages-Logs haben den alten Schnitt. Für den Dream
ist das unkritisch — er arbeitet immer mit dem aktuellsten Log.

---

### Phase 2: reflect_learnings Collection + Qdrant-Helpers

**Datei:** `scripts/dream.mjs`

Neue Qdrant-Helper-Funktionen:

```javascript
// Bestehende relevante Facts aus Qdrant laden (Vorfilterung)
async function fetchRelevantFacts(collection, queryTexts, limit = 10, threshold = 0.65)

// Supersede: Alten Punkt per Vektor-Suche finden und Payload updaten
async function supersedeFact(collection, searchQuery, newPayload)

// Confidence eines bestehenden Punkts senken
async function lowerConfidence(collection, searchQuery, newConfidence)
```

Collection `reflect_learnings` mit Schema:
```json
{
  "fact": "Bei Sonarr: Deutsche Titel erst ins Englische übersetzen",
  "type": "reflect",
  "confidence": 0.85,
  "tools": ["sonarr_search", "sonarr_get"],
  "scope": "global",
  "source": "THN hat 6x mit deutschem Titel gesucht, 2026-04-03",
  "agentId": "thn",
  "timestamp": "2026-04-04T04:01:00Z"
}
```

---

### Phase 3: SDK-Wrapper für Dream

**Neue Datei:** `scripts/dream-sdk.mjs`

Generischer Wrapper der `consult-sdk.mjs` Pattern wiederverwendet aber
für Dream optimiert ist:

```bash
node scripts/dream-sdk.mjs \
  --prompt "Analysiere die Unterhaltung..." \
  --input-file /path/to/extractor-log.jsonl \
  --context-file /tmp/existing-facts.json \
  --output-format json \
  --max-turns 20
```

Alternativ: `consult-sdk.mjs` um `--context-file` und `--output-format`
erweitern. Entscheidung bei Implementierung.

**ENV-Setup** (wie consult-sdk.mjs):
```
ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic
ANTHROPIC_AUTH_TOKEN=$MINIMAX_API_KEY
ANTHROPIC_MODEL=MiniMax-M2.7
```

**Tools für den SDK-Agent:** Read, Glob, Grep (kann selbst in Sessions lesen)

---

### Phase 4: Dream v2 — Memory-Review

**SDK-Prompt (Kern):**
```
Du bist der nächtliche Memory-Review-Agent. Analysiere die heutige
Unterhaltung und vergleiche sie mit den bekannten Fakten.

Bekannte Fakten:
{existing_facts_json}

Heutige Unterhaltung:
Lies die Datei {extractor_log_path}

Aufgabe:
1. Welche neuen Fakten sind hinzugekommen?
2. Welche bestehenden Fakten müssen aktualisiert werden?
3. Welche bestehenden Fakten sind möglicherweise veraltet?

Antwort NUR als JSON-Array:
[
  {"action": "new", "text": "...", "confidence": 0.9},
  {"action": "supersede", "search": "alter Fakt Suchbegriff",
   "text": "aktualisierter Fakt", "confidence": 0.9},
  {"action": "lower", "search": "veralteter Fakt Suchbegriff",
   "confidence": 0.4, "reason": "..."}
]

Regeln:
- Nur Fakten über den User, nicht über den Agenten
- "supersede" nur wenn sich ein Fakt GEÄNDERT hat (Staffel 14→22)
- "lower" nur wenn ein Fakt WIDERLEGT oder VERALTET ist
- Confidence: 0.7-1.0. Höher = sicherer.
- Keine Duplikate zu bestehenden Fakten
- Bei Unsicherheit: lieber nicht aufnehmen
```

**Vorfilterung im Script:**
1. Extractor-Log lesen, User-Nachrichten extrahieren
2. Pro Nachricht: Embedding → Top-10 aus Qdrant (Score > 0.65)
3. Deduplizieren → 20-50 relevante Facts
4. Als JSON an SDK-Agent übergeben

---

### Phase 5: Dream v2 — Behavior-Review

**SDK-Prompt (Kern):**
```
Du bist der nächtliche Behavior-Review-Agent. Analysiere die heutige
Unterhaltung auf Verhaltenswünsche und Präferenzen des Users.

Bekannte Behaviors:
{existing_behaviors_json}

Heutige Unterhaltung:
Lies die Datei {extractor_log_path}

Aufgabe:
1. Hat der User Wünsche geäußert, wie der Agent sich verhalten soll?
2. Gibt es implizite Präferenzen (z.B. Sprache, Format, Stil)?
3. Müssen bestehende Behaviors angepasst werden?

Antwort NUR als JSON-Array:
[
  {"action": "new", "text": "...", "confidence": 0.85,
   "scope": "personal|household"},
  {"action": "supersede", "search": "...",
   "text": "aktualisierte Regel", "confidence": 0.85},
  {"action": "lower", "search": "...",
   "confidence": 0.4, "reason": "..."}
]

Beispiele guter Behaviors:
- "Serien- und Film-Releases beziehen sich auf Deutschland, nicht USA"
- "Bei Sonarr/Radarr: Titel sind englisch, User sucht auf Deutsch —
   erst den englischen Titel recherchieren"
- "Kurze Antworten bevorzugt, keine langen Erklärungen"
- "Wetter immer für den Heimatort, nicht allgemein"
```

---

### Phase 6: Dream v2 — Reflect/Learnings

**SDK-Prompt (Kern):**
```
Du bist der nächtliche Reflect-Agent. Analysiere alle Agent-Sessions
auf Fehler, Ineffizienzen und Optimierungspotential.

Bekannte Learnings:
{existing_learnings_json}

Aufgabe:
Lies alle Session-Dateien in {sessions_dir} und analysiere:

1. Tool-Call-Loops: Gleicher Tool mehrfach mit ähnlichen Parametern
   ohne Lerneffekt zwischen den Aufrufen
2. Fehlgeschlagene Aufrufe: Warum? Was wäre besser gewesen?
3. Unnötige Retries: Nach Fehler nochmal dasselbe versucht
4. Zeitverschwendung: Lange Ketten die mit besserem Ansatz kürzer wären
5. Erfolgreiche Patterns: Was hat gut funktioniert? (auch positiv lernen)

Antwort NUR als JSON-Array:
[
  {"text": "Konkreter, actionable Hint als Imperativ",
   "confidence": 0.85,
   "tools": ["tool_name1", "tool_name2"],
   "scope": "global",
   "source": "Kurze Beschreibung was schiefging (max 100 Zeichen)"}
]

Regeln:
- KEINE generischen Tipps ("sei effizienter")
- NUR konkrete, toolspezifische Hinweise
- Auch positive Learnings (was hat funktioniert)
- Maximal 3 Retries pro Tool, dann anderer Ansatz
- Confidence ≥ 0.7
```

**Input:** Alle Raw-Sessions (nicht Extractor-Logs, die sind bereinigt).
Der SDK-Agent liest die JSONLs selbst und sieht Tool-Calls, Errors, alles.

**Output geht in:** `reflect_learnings` Collection (global, alle Agents)

---

### Phase 7: Memory-Recall-Plugin — Confidence + Learnings

**Datei:** `plugins/openclaw-memory-recall/src/index.ts`

**Änderung 1:** Confidence im Injection-Format mitliefern

```typescript
// Vorher (Zeile 360):
const factLines = topFacts.map(f => `- ${f.fact}`).join('\n');

// Nachher:
const factLines = topFacts.map(f => {
  const conf = f.confidence != null ? ` [${Math.round(f.confidence * 100)}%]` : '';
  const age = f.updatedAt ? ` (${f.updatedAt.slice(0, 10)})` : '';
  return `- ${f.fact}${conf}${age}`;
}).join('\n');
```

Ergebnis:
```
[Erinnerungen — relevante Fakten aus früheren Gesprächen]
- User schaut NCIS, aktuell Staffel 22 [90%] (2026-04-04)
- User schaut gerne Serien auf Deutsch [85%]
- User mochte früher italienisches Essen [40%] (2026-03-15)
[/Erinnerungen]
```

**Änderung 2:** `reflect_learnings` Collection abfragen

Zusätzliche Query auf `reflect_learnings`, gefiltert nach Tools die der
Agent hat. Injection als neuer Block:

```
[Hinweise — aus vergangenen Fehlern gelernt]
- Bei Sonarr-Suche: Deutsche Titel erst ins Englische übersetzen [85%]
- Maximal 3 Versuche pro Tool, dann dem User sagen [90%]
[/Hinweise]
```

**Änderung 3:** Confidence-basiertes Ranking

```typescript
// Vorher: Sortierung nur nach Qdrant-Score (Vektor-Similarity)
// Nachher: final_score = similarity * confidence
```

Damit werden Facts mit niedriger Confidence nach unten sortiert und
bei knappem Token-Budget zuerst weggelassen.

---

### Phase 8: Dream v2 — Zusammenbau + Report

**Datei:** `scripts/dream.mjs` — Komplett-Überarbeitung

Neuer Flow in `processAgent()`:

```
1. Extractor-Log laden (04:00-04:00 Fenster)
2. Raw-Sessions laden (für Reflect)
3. Relevante Facts aus Qdrant vorfiltern (Vektor-Suche)
4. Relevante Behaviors aus Qdrant vorfiltern
5. Bestehende Learnings aus reflect_learnings laden
6. SDK-Call: Memory-Review → JSON Actions
7. SDK-Call: Behavior-Review → JSON Actions
8. SDK-Call: Reflect/Learnings → JSON Actions
9. Alle Actions ausführen (new/supersede/lower)
10. Zusammenfassung erstellen (einfacher MiniMax-Call)
11. Session-Injection (Summary + "Gestern gelernt: ...")
12. Report schreiben
```

**Report-Format** (`/tmp/dream-report-YYYY-MM-DD.md`):
```markdown
# Dream Report — 2026-04-04

## Agents verarbeitet
- thn (WhatsApp): 45 Nachrichten, 23 Tool-Calls

## Memory-Updates
- NEW: User schaut NCIS Staffel 22 (0.9)
- SUPERSEDE: "Staffel 14" → "Staffel 22"
- LOWER: "User mag italienisch" → 0.4

## Behavior-Updates
- NEW: "Serien-Releases beziehen sich auf Deutschland" (0.85)

## Reflect-Learnings
- NEW: "Sonarr: Deutsche Titel → englisch übersetzen" (0.85)
  Source: THN suchte 6x mit deutschem Titel

## Statistik
- SDK-Calls: 3 (Memory, Behavior, Reflect)
- Qdrant-Writes: 4 (2 new, 1 supersede, 1 lower)
- Dauer: 45s
```

---

### Phase 9: Backfill + Validierung

Nach Implementierung:

1. `node scripts/dream.mjs --backfill --dry-run` — Letzte 7 Tage durchgehen
2. Report prüfen: Sind die extrahierten Facts/Behaviors sinnvoll?
3. Reflect-Learnings prüfen: Sind die Hints konkret und actionable?
4. Wenn OK: `--backfill` ohne dry-run → Qdrant befüllen
5. Nächsten Morgen: Prüfen ob Injection funktioniert (Agent kennt gestrige Learnings)

---

### Phase 10: Wöchentlicher Meta-Reflect (Sonntag-Cron)

**Neues Script:** `scripts/dream-weekly.mjs` oder Phase im Dream
(nur sonntags aktiv).

SDK-Agent bekommt alle Learnings der Woche und prüft:
- Widersprüche zwischen Facts
- Redundante Einträge (Merge)
- Veraltete Hints (Agent macht den Fehler nicht mehr)
- Hints die spezifischer sein könnten (basierend auf neuen Beispielen)

Output: Consolidation-Actions (merge, delete, update, specify)

Cron: `0 4 * * 0` (Sonntag 04:00, vor dem täglichen Dream)

---

## Abhängigkeiten zwischen Phasen

```
Phase 1 (Extractor-Schnitt) ──→ Phase 4-6 (brauchen korrekte Tages-Logs)
Phase 2 (Qdrant-Helpers)    ──→ Phase 4-6, 8 (brauchen supersede/lower)
Phase 3 (SDK-Wrapper)       ──→ Phase 4-6 (brauchen SDK-Aufrufe)
Phase 4-6 (Reviews)         ──→ Phase 8 (Dream-Zusammenbau)
Phase 7 (Plugin-Update)     ──→ unabhängig, kann parallel
Phase 8 (Dream v2)          ──→ Phase 9 (Backfill braucht fertiges Script)
Phase 9 (Backfill)          ──→ Phase 10 (Weekly braucht Daten)
```

**Empfohlene Reihenfolge für heute:**
1. Phase 1 (Extractor) — schnell, eigenständig
2. Phase 2 (Qdrant-Helpers) — Grundlage für alles
3. Phase 3 (SDK-Wrapper) — Grundlage für Reviews
4. Phase 4-6 parallel entwickeln (Prompts + Integration)
5. Phase 7 (Plugin) — kann parallel zu 4-6
6. Phase 8 (Zusammenbau)
7. Phase 9 (Backfill + Test)
8. Phase 10 (Weekly) — kann auch nächste Session sein

---

## Offene Fragen / Entscheidungen

1. **SDK-Wrapper:** Neues `dream-sdk.mjs` oder `consult-sdk.mjs` erweitern?
   → Bei Implementierung entscheiden je nach Umfang der Änderungen

2. **Reflect: Pro Agent oder einmal global?**
   → Einmal global über alle Sessions. Output in `reflect_learnings`.

3. **Memory-Review: Auch household-übergreifend?**
   → Ja, `memories_household` + `memories_{agent}` beide prüfen.

4. **Report-Persistenz:** `/tmp/` (flüchtig) oder `docs/dream-reports/`?
   → /tmp/ erstmal, bei Bedarf persistent machen.

5. **Extractor-Backfill nach 04:00-Umstellung:**
   → Bestehende Logs bleiben. Neue Logs ab nächstem Tag korrekt.
   → Für Backfill unkritisch (Dream nutzt immer neueste Logs).
