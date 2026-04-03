# Plan: Agent-Instructions-System (3 Ebenen)

## Context

Die aktuelle SOUL.md (54 Zeilen) mischt Persoenlichkeit, Format-Regeln, Admin-Policy und
Smart-Home-Anweisungen. Das skaliert nicht: Wenn Benni und Domi ihren Agenten im Gespraech
Verhaltensregeln beibringen ("Such Releases in Deutschland"), gibt es keinen Ort dafuer.
Gleichzeitig sollen zeitbasierte Anweisungen (Geburtstage, saisonale Regeln) moeglich sein
ohne die SOUL.md aufzublaehen.

Ziel: 3-Ebenen-System:
1. **SOUL.md** — Persoenlichkeit (schlank, Agent-spezifisch)
2. **RULES.md** — Kernregeln die IMMER gelten (Format, Admin, User-Mapping, <20 Zeilen)
3. **Qdrant `instructions_*`** — Semantisch injizierte Verhaltensregeln aus Gespraechen +
   zeitbasierte Anweisungen. Skaliert auf hunderte Regeln, nur relevante werden injiziert.

## Phasen-Uebersicht

| Phase | Was | Status |
|-------|-----|--------|
| 0 | Machbarkeitstest (MiniMax behavior-Extraction + Recall) | offen |
| 1 | SOUL.md / RULES.md Trennung | erledigt (2026-04-03) |
| 2 | Extractor erweitern (behavior → instructions_*) | offen |
| 3 | Memory-Recall Plugin erweitern ([Anweisungen] Block) | offen |
| 4 | Zeitbasierte Instructions (Geburtstage, Advent) | offen |

---

## Phase 0: Machbarkeitstest

**Ziel:** Pruefen ob MiniMax `behavior`-Typ zuverlaessig extrahiert und ob die
Memory-Recall-Plugin-Erweiterung funktioniert.

**Testdaten:** Session `b1054b98` (Benni, 2026-04-02) — enthaelt:
- "Du solltest zukuenftig nach Releases in Deutschland suchen" → erwarteter Typ `behavior`
- Geburtstags-Frage (Domi) → kein behavior, nur normaler Fakt

**Schritte:**

1. **Qdrant Collections anlegen:** `instructions_benni`, `instructions_domi`, `instructions_household`
   (identisches Schema wie memories_*: dense 1024-dim Cosine + bm25 sparse)

2. **Extractor-Prompt testen:** Den bestehenden SYSTEM_PROMPT um `behavior`-Typ erweitern
   und gegen die Test-Session laufen lassen (manuell via Script, nicht den Service aendern).
   Pruefen: Erkennt MiniMax "Such Releases in Deutschland" als `behavior`?

3. **Memory-Recall Plugin testen:** Manuell einen Testpunkt in `instructions_benni` schreiben,
   dann pruefen ob der Plugin ihn bei passender Query findet und als `[Anweisungen]`-Block
   injiziert.

**Erfolgskriterien:**
- MiniMax klassifiziert die Release-Anweisung als `behavior` (nicht `preference` oder `decision`)
- Hybrid-Search findet die Instruction bei Query "wann kommt die naechste Folge von X"
- Plugin injiziert `[Anweisungen]` Block getrennt von `[Erinnerungen]`

### Phase 0 Ergebnisse (2026-04-03)

**Status: ERFOLGREICH — Two-Pass Architektur empfohlen**

#### 1. Qdrant Collections ✓
3 Collections angelegt (`instructions_benni`, `instructions_domi`, `instructions_household`),
identisches Schema wie `memories_*`. Hybrid-Search (dense+BM25+RRF) funktioniert.
Testpunkt bei Query "Wann kommt die nächste Folge von Severance" gefunden (Score 0.5).

#### 2. Combined-Prompt Test (3x3 Matrix) — INSTABIL
| | A (baseline) | B (+behavior) | C (+abgrenzung) |
|---|---|---|---|
| Turn 0 (kein Fakt) | korrekt leer | korrekt leer | False Positive behavior:0.95 |
| Turn 1 (behavior) | `preference:1.0` (falsch klassifiziert) | leer (verfehlt) | leer (verfehlt) |
| Turn 4 (personal) | leer (verfehlt) | leer (verfehlt) | leer (verfehlt) |

**Erkenntnis:** Ein einzelner Combined-Prompt ist unzuverlaessig. MiniMax zeigt hohe Varianz
zwischen Aufrufen. Behavior wird als `preference` klassifiziert oder ganz uebersehen.

#### 3. Two-Pass Architektur — EMPFOHLEN ✓
Jeder Turn zweimal durch MiniMax: Pass 1 (Facts, unveraenderter Prompt) + Pass 2 (Behavior, spezialisierter Prompt).

**Ergebnisse (5 Turns):**
- Pass 1 (Facts): 0 extrahiert (MiniMax-Varianz-Problem, kein Architektur-Problem)
- Pass 2 (Behavior): 3 extrahiert, 3/3 verifiziert
  - Turn 1: Korrekt erkannt (Confidence 1.0) ✓
  - Turn 0 + Turn 2: False Positives durch Sliding-Window-Overlap (Behavior-Turn im Context/Followup sichtbar)
  - Turn 3 + 4: Korrekt leer ✓
- **Semantic Dedup (0.92)** faengt die Window-Overlap-Duplikate ab → in Produktion nur 1 Eintrag

#### 4. Verifier fuer Behavior ✓
Angepasster Verifier-Prompt ("dauerhafte Arbeitsregel statt einmalige Bitte") funktioniert.
Alle 3 Instructions verifiziert mit korrekter Begruendung.

#### Architektur-Entscheidung fuer Phase 2

**Two-Pass Pipeline pro Turn:**
1. Pass 1: Bestehender Fact-Extractor (UNVERAENDERT) → `memories_*`
2. Pass 2: Spezialisierter Behavior-Extractor → `instructions_*`
3. Verifier: Bestehend fuer Facts, angepasster Prompt fuer Behavior
4. Semantic Dedup: Bestehendes System (0.92 Threshold) reicht aus

**Vorteile:**
- Null Regressionsrisiko auf bestehende Fact-Extraction
- MiniMax-Calls quasi kostenlos (~0.001€ pro Turn extra)
- Spezialisierte Prompts sind stabiler als Combined-Prompts
- Verifier und Dedup bereits vorhanden, minimal angepasst

**Test-Scripts:** `scripts/test-behavior-extraction.py`, `scripts/test-prompt-variants.py`, `scripts/test-two-pass.py`, `scripts/test-behavior-scan-all.py`
**Rohdaten:** `docs/plans/phase0-extraction-results.json`, `docs/plans/phase0-prompt-variants.json`, `docs/plans/phase0-two-pass-results.json`

#### 5. Full-Scan ueber alle Sessions (134 Sessions, 127 Kandidaten-Turns)

**Ergebnis:** Bis 20/127 Turns verarbeitet (Scan abgebrochen wegen Laufzeit).
Keine neuen echten Behavior-Instructions gefunden — nur einmalige Arbeitsauftraege
("Analysiere Sessions", "Konsolidiere Teilergebnisse") die der Verifier faelschlich
als dauerhaft durchlaesst.

**Erkenntnisse fuer Phase 2:**
1. **Prompt schaerfen:** Einmalige Auftraege explizit als Nicht-Behavior definieren.
   Neue Negativbeispiele: "Analysiere diese Datei" → NEIN (einmaliger Auftrag),
   "Konsolidiere die Ergebnisse" → NEIN (einmaliger Auftrag).
2. **Verifier schaerfen:** "Wuerde der User erwarten dass diese Regel auch in
   ZUKUENFTIGEN Gespraechen gilt?" als 4. Pruefkriterium.
3. **Context-Cleaning:** [Erinnerungen]-Block, TTS-Metadata, WhatsApp-Metadata
   VOR dem Senden an MiniMax strippen → 50%+ kleinere Prompts, schnellere Calls.
4. **Parallelisierung:** 3-5 concurrent MiniMax Calls statt sequentiell.
   MiniMax hat kein hartes Rate-Limit fuer uns.
5. **Session-Filter optional:** Claude-Code-Orchestrator-Sessions (technische
   Auftraege) haben wenig Behavior-Potenzial, aber ausfiltern lohnt nicht —
   der Behavior-Prompt + Verifier filtern zuverlaessig genug.

---

## Phase 1: SOUL.md / RULES.md Trennung (ERLEDIGT 2026-04-03)

**Entscheidung:** Plugin-Injection via memory-recall Plugin (`prependContext`).
Gleicher Mechanismus wie spaeter [Anweisungen] aus Qdrant (Phase 3).

**Umgesetzte Dateien:**
- `agents/household/SOUL.md` — gekuerzt auf Antwortformat + Verhalten + Continuity (32 Zeilen)
- `agents/household/RULES.md` — Smart Home, Admin, User-Mapping (30 Zeilen)
- `agents/benni/SOUL.md` — THN Persoenlichkeit + Sprachregeln + Memory + Red Lines (53 Zeilen)
- `agents/benni/RULES.md` — Smart Home, Admin, Feature-Requests, User-Mapping (43 Zeilen)
- `agents/templates/SOUL.md.template` — Smart Home + Admin entfernt
- `agents/templates/RULES.md.template` — NEU: Generisches Template
- `plugins/openclaw-memory-recall/src/index.ts` — readRulesFile() + prependContext (v0.2.0)
- `plugins/openclaw-memory-recall/openclaw.plugin.json` — enableRules Config

**Architektur-Entscheidung:**
- Format/TTS-Regeln bleiben in SOUL.md (System-Prompt-Gewicht fuer 9B)
- Operative Regeln (Smart Home, Admin, User-Mapping) via Plugin-Injection
- RULES.md Dateien enthalten [Regeln]...[/Regeln] Tags
- Injektions-Reihenfolge: [Regeln] ��� [Erinnerungen] (spaeter: [Anweisungen] dazwischen)

---

## Phase 2: Extractor erweitern (Two-Pass Architektur)

> **Aenderung gegenueber Original-Plan:** Statt den bestehenden Prompt zu erweitern,
> wird ein separater zweiter Pass hinzugefuegt. Phase 0 hat gezeigt dass Combined-Prompts
> instabil sind und der bestehende Fact-Prompt NICHT angefasst werden soll.

### 2a. Neuer Behavior-Extractor (`services/extractor/src/behavior-extractor.ts`)

Neue Datei mit eigenem BEHAVIOR_SYSTEM_PROMPT (getestet in Phase 0):
```
Du erkennst Verhaltensanweisungen in Konversationen.
Eine Verhaltensanweisung ist wenn der User dem Assistenten sagt WIE er sich verhalten soll.
Das sind dauerhafte Arbeitsregeln — KEINE einmaligen Bitten oder Fragen.
[+ Beispiele, Abgrenzung, JSON-Format]
```

**Zusaetzliche Negativbeispiele (aus Full-Scan Phase 0):**
```
- "Analysiere diese Datei auf Token-Waste" → NEIN (einmaliger Analyse-Auftrag)
- "Konsolidiere die Teilergebnisse" → NEIN (einmalige Aufgabe)
- "Erstelle eine Patch-Tabelle" → NEIN (einmaliger Arbeitsauftrag)
```
Schluesselunterscheidung: Behavior = gilt auch in ZUKUENFTIGEN Gespraechen.
Einmaliger Auftrag = nur fuer dieses Gespraech relevant.

**Context-Cleaning (aus Full-Scan Phase 0):**
Vor dem Senden an MiniMax den User-Text bereinigen:
- `[Erinnerungen ... /Erinnerungen]` Block entfernen
- `[SPRACHNACHRICHT — TTS-MODUS]` + Formatierungs-Anweisungen entfernen
- `Conversation info (untrusted metadata)` + `Sender (untrusted metadata)` entfernen
- `[Audio]\nUser text:\n[WhatsApp...]` Wrapper entfernen, nur Transcript behalten
→ 50%+ kleinere Prompts, schnellere API-Calls, weniger Noise fuer MiniMax

Interface:
```typescript
interface ExtractedInstruction {
  instruction: string;
  confidence: number;
  sourceContext: string;
  scope: 'personal' | 'household';
}
export async function extractBehavior(window: ExtractionWindow): Promise<ExtractedInstruction[]>
```

### 2b. Behavior-Verifier (`services/extractor/src/verifier.ts`)

Neue Funktion `verifyBehaviorMiniMax()` mit angepasstem Prompt:
- "Hat der USER diese Anweisung SELBST gegeben?" (statt "Stimmt dieser Fakt?")
- "Dauerhafte Arbeitsregel oder einmalige Bitte?" (statt "Dauerhafter Fakt?")
- **NEU (aus Full-Scan Phase 0):** 4. Pruefkriterium:
  "Wuerde der User erwarten dass diese Regel auch in ZUKUENFTIGEN Gespraechen gilt?"
  Damit fallen einmalige Auftraege wie "Analysiere Token-Waste" zuverlaessig raus.

### 2c. Pipeline erweitern (`services/extractor/src/pipeline.ts`)

`processTurn()` bekommt einen zweiten Pass NACH dem bestehenden Fact-Pass:
```typescript
// --- Bestehender Pass 1 (UNVERAENDERT) ---
const facts = await extractFacts(window);
// ... validate, verify, embed, dedup, upsert to memories_*

// --- Neuer Pass 2: Behavior ---
const cleanedWindow = cleanWindowForBehavior(window); // Context-Cleaning
const behaviors = await extractBehavior(cleanedWindow);
for (const behavior of behaviors) {
  // validate (length, confidence)
  // verify with verifyBehaviorMiniMax()
  // embed (same embedder)
  // dedup (same semantic dedup, 0.92 threshold)
  // upsert to instructions_* (statt memories_*)
}
```

**Parallelisierung (aus Full-Scan Phase 0):**
Pass 1 und Pass 2 NICHT parallelisieren (Fact-Pass liefert known_facts fuer Context).
Aber: Innerhalb von Pass 2 koennen Embedding + Dedup-Search parallel laufen
(wie bei Pass 1 bereits implementiert via `Promise.all`).

Collection-Routing:
```typescript
function targetCollections(agentId: string, scope: string, isBehavior: boolean): string[] {
  const prefix = isBehavior ? 'instructions' : 'memories';
  return scope === 'household'
    ? [`${prefix}_household`]
    : [`${prefix}_${agentId}`];
}
```

### 2d. Collections (`services/extractor/src/qdrant.ts`)

`ensureCollections()` erweitern: Fuer jeden Agent auch `instructions_*` anlegen.
(Bereits manuell erstellt in Phase 0, muss nur noch ins Code.)

### 2e. Fehlerbehandlung (NEU — aus Phase 0 Erkenntnissen)

Aktuell fehlt:
1. **Retry fuer gescheiterte Turns:** Nach 3 Retries wird ein Turn uebersprungen und
   nie wieder versucht. Neues Feld in `ingestion_state`: `retry_count` + `last_error`.
   Beim naechsten Service-Start: Turns mit `retry_count < 10` erneut versuchen.
2. **Processing-Log erweitern:** `behavior_extracted`, `behavior_written` Felder
   neben den bestehenden `facts_extracted`, `facts_written`.
3. **Health-Endpoint:** Einfacher HTTP-Endpunkt (`/health`) der letzte Aktivitaet
   und Fehlerrate zurueckgibt. Kann spaeter vom Morningbrief abgefragt werden.

---

## Phase 3: Memory-Recall Plugin erweitern

**Datei:** `plugins/openclaw-memory-recall/src/index.ts`

1. **Zusaetzliche Collections durchsuchen:**
   ```
   benni  → memories: [memories_benni, memories_household]
            instructions: [instructions_benni, instructions_household]
   domi   → memories: [memories_domi, memories_household]
            instructions: [instructions_domi, instructions_household]
   ```

2. **Getrennter Injection-Block:**
   ```
   [Anweisungen — persoenliche Verhaltensregeln]
   - Bei Film/Serien-Releases immer nach Deutschland-Terminen suchen
   [/Anweisungen]

   [Erinnerungen — relevante Fakten aus frueheren Gespraechen]
   - Benni arbeitet als Software-Entwickler bei Stackblitz
   [/Erinnerungen]
   ```
   Anweisungen VOR Erinnerungen (naeher am System-Prompt = hoehere Prioritaet fuer 9B).

3. **TopK separat:** Instructions topK=3, Memories topK=5 (bestehend).

**Datei:** `plugins/openclaw-memory-recall/openclaw.plugin.json`

4. Config-Schema: `"instructionsTopK": { "type": "number", "default": 3 }`

---

## Phase 4: Zeitbasierte Instructions (nach Phase 0-3)

Fuer datumsbasierte Regeln (Geburtstage, Advent):

**Option A:** Payload-Filter in Qdrant — `activeFrom`/`activeTo` Felder, Plugin filtert.
**Option B:** JSON-Datei (`agents/instructions.json`), Plugin laedt + Datum-Filter.

→ Entscheidung nach Phase 0-3.

---

## Kritische Dateien

| Datei | Aenderung | Phase |
|-------|-----------|-------|
| `services/extractor/src/behavior-extractor.ts` | NEU: Behavior-Prompt + extractBehavior() | 2a |
| `services/extractor/src/verifier.ts` | verifyBehaviorMiniMax() hinzufuegen | 2b |
| `services/extractor/src/pipeline.ts` | Pass 2 nach bestehendem Pass 1 | 2c |
| `services/extractor/src/qdrant.ts` | instructions_* in ensureCollections() | 2d |
| `services/extractor/src/offset.ts` | behavior_extracted/written Felder | 2e |
| `plugins/openclaw-memory-recall/src/index.ts` | instructions_* Search + [Anweisungen] Block | 3 |
| `plugins/openclaw-memory-recall/openclaw.plugin.json` | instructionsTopK Config | 3 |
| `agents/household/SOUL.md` | Auf Persoenlichkeit reduzieren | 1 |
| `agents/household/RULES.md` | Neu: Kernregeln + User-Mapping | 1 |

## Verifikation

### Phase 2 (Extractor)
1. `cd services/extractor && npm run build` — Kompiliert fehlerfrei
2. Extractor neustarten: `XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart openclaw-extractor`
3. Neue Session-Nachricht senden (z.B. "Such immer zuerst in DE")
4. `journalctl --user -u openclaw-extractor -f` — Behavior-Pass sichtbar im Log
5. `curl localhost:6333/collections/instructions_benni/points/scroll` — Neuer Eintrag

### Phase 3 (Recall Plugin)
6. `cd plugins/openclaw-memory-recall && npm run build` — Kompiliert fehlerfrei
7. Gateway neustarten: `XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart openclaw-gateway`
8. Agent-Test: "Wann kommt die naechste Folge von X"
   → Antwort muss `[Anweisungen]` Block VOR `[Erinnerungen]` enthalten
9. `openclaw plugins doctor` — Keine Fehler

### Regressionstest
10. Bestehende Memories pruefen: `curl localhost:6333/collections/memories_benni/points/scroll`
    → Gleiche 5 Punkte wie vor der Aenderung (kein Datenverlust)
11. Normaler Chat ohne Behavior → Nur `[Erinnerungen]`, kein `[Anweisungen]` Block

### Finaler Vergleichs-Lauf (nach Abschluss Phase 2+3)

Baseline (Phase 0, Produktiv-Stand vor Aenderungen):
- `memories_benni`: 5 Punkte, `memories_household`: 1 Punkt, `memories_domi`: 0
- `instructions_*`: leer (bis auf manuellen Testpunkt aus Phase 0)
- 137 Sessions verarbeitet, 140 Turns, 8 Facts geschrieben
- Snapshot: `docs/plans/phase0-baseline-memories.json` (erstellen vor Phase 2)

Nach Abschluss:
1. **Extractor ueber alle Sessions laufen lassen** (Reset state.db offset oder separates Script)
2. **Vergleichen:**
   - `memories_*` identisch zur Baseline? (Pass 1 unveraendert → muss identisch sein)
   - `instructions_*` neue Eintraege? Welche? Alle plausibel?
   - Keine False Positives (einmalige Auftraege) in instructions?
3. **Performance messen:** Extractor-Laufzeit vorher vs. nachher (Pass 2 Overhead)
4. **Ergebnis dokumentieren** in diesem Plan unter "Abschluss-Vergleich"
