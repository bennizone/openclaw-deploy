# openclaw-extractor — Entscheidungen & Features

## Feature

### Passive Fact Extraction
**Status:** Aktiv seit 2026-03-28
- Liest OpenClaw JSONL-Session-Logs passiv im Hintergrund
- Extrahiert Facts via MiniMax M2.7 (LLM-basiert)
- Schreibt nach Qdrant mit Dense + BM25 Vektoren
- Idempotent via SQLite Offset-Tracking

## Architektur

```
src/
├── index.ts           — Service Entry Point
├── config.ts          — Env-Variablen Konfiguration
├── watcher.ts         — JSONL File Watcher
├── parser.ts          — Session-Log Parser
├── window.ts          — Sliding Window (Before/After Kontext)
├── pipeline.ts        — Extraction Pipeline Orchestrierung
├── extractor.ts       — LLM Fact Extraction (MiniMax API)
├── embedder.ts        — bge-m3 Embedding (GPU + Fallback)
├── qdrant.ts          — Qdrant Upsert (Dense + BM25)
├── offset.ts          — SQLite Offset-Tracking
└── bm25-tokenizer.ts  — FNV-1a Hashing (shared mit memory-recall)
```

**Entscheidung:** Passiver Extractor statt Live-Extraction
**Warum:** Keine Latenz-Auswirkung auf Konversation. Kann im Hintergrund
laufen ohne den Gateway zu belasten. Resilient bei Ausfaellen.

**Entscheidung:** MiniMax fuer Extraction, KEIN Qwen-Fallback
**Warum:** Qualitaetsvergleich (2026-03-30, 74 Turns, alle Sessions):
- MiniMax M2.7: 17 Facts, korrekte Scope-Zuordnung
- Qwen 3.5 no-think: 1 Fact (unbrauchbar)
- Qwen 3.5 think: 13 Facts, aber halluziniert Recall-Context als neue Fakten
- Qwen think 28x langsamer (1731s vs 62s)
Bei MiniMax-Ausfall: Turns werden uebersprungen (Offset nicht gespeichert),
beim naechsten Backfill automatisch nachgeholt. Ergebnisse: `~/extractor/test-results.json`

**Entscheidung:** Sliding Window statt ganze Session
**Warum:** Kontext-Fenster begrenzt. Window von 3 Nachrichten vor + 2 nach
dem aktuellen Turn gibt genuegend Kontext fuer Korrektur-Erkennung.
Beide Werte config-gesteuert via SLIDING_WINDOW_BEFORE/AFTER in .env.

**Entscheidung:** LLM entscheidet Scope (persoenlich vs. household)
**Warum:** "Wir haben Pizza bestellt" → household. "Ich mag Pizza" → persoenlich.
Regelbasiert nicht zuverlaessig, LLM versteht den Kontext.

**Entscheidung:** Household-Facts nur in memories_household (kein Duplikat)
**Warum:** Frueherer Ansatz schrieb household-Facts in BEIDE Collections
(Agent + household). Da Recall immer Agent+Household durchsucht, war das
doppelt gemoppelt. Fix 2026-03-30: Exklusives Routing nach Scope.

## Config (~/extractor/.env)

```
MINIMAX_API_KEY=...
EXTRACTION_MODEL=MiniMax-M2.7
EMBED_GPU_URL=http://<GPU_SERVER_IP>:8081
EMBED_LOCAL_URL=http://localhost:8081
QDRANT_URL=http://localhost:6333
EMBEDDING_MODEL=bge-m3
SLIDING_WINDOW_BEFORE=3
SLIDING_WINDOW_AFTER=2
TURN_WAIT_TIMEOUT_MS=30000
LOG_LEVEL=info
```

## Service
- Systemd User Service: `systemctl --user status openclaw-extractor`
- State DB: `~/extractor/state.db` (SQLite, Offset pro JSONL-Datei)
- Agents: benni, domi, household

## Qdrant-Schema
- Collections: `memories_benni`, `memories_domi`, `memories_household`
- Named Vectors: `dense` (bge-m3, 1024-dim) + `bm25` (sparse, idf)
- Payload: `fact`, `type`, `confidence`, `agentId`, `scope`, `timestamp`

### Two-Stage Extraction Pipeline
**Status:** Aktiv seit 2026-03-30
- Stufe 1: MiniMax extrahiert konservativ (nur User-Messages, Known-Facts-aware)
- Stufe 2: MiniMax verifiziert jeden Kandidaten kritisch ("Ist das SICHER ableitbar?")
- Validator: Mindestlaenge + Confidence Floor als Safety Net
- Semantic Dedup: Cosine > 0.92 vor dem Schreiben

**Entscheidung:** Nur User-Messages als Extraktionsquelle
**Warum:** Assistenten-Antworten enthalten Geraetezustaende, Entity-Listen, Sensorwerte.
Diese wurden faelschlicherweise als Facts extrahiert. Jetzt: Assistent = Kontext, User = Quelle.
Ergebnis: 0 falsche Facts aus 74 Turns (vorher 11/17 Muell).

**Entscheidung:** MiniMax als einziger Verifier (kein Qwen)
**Warum:** Benchmark (2026-03-30, 10 synthetische Konversationen):
- MiniMax Verifier: 94% Akzeptanz korrekt
- Qwen no-think: 75% (zu streng, lehnt valide Facts ab)
- Qwen think: 75% (kein Vorteil gegenueber no-think)
Qwen erkennt Agent-Namen nicht zuverlaessig und ist bei Praeferenzen ueberkritisch.

**Entscheidung:** Known Facts im Extraktions-Prompt
**Warum:** MiniMax sieht vor der Extraktion was schon gespeichert ist. Kann Duplikate
erkennen ("schon bekannt"), Widersprueche finden, und Ergaenzungen formulieren.
Kosten: +1 Embedding + 1-2 Qdrant-Queries pro Turn (minimal).

**Entscheidung:** Agent-Namen statt "User:" im Prompt
**Warum:** "Benni:" statt "User:" loest das Problem dass Verifier nicht wissen
wer der User ist. Beide Stufen (Extraktion + Verifikation) nutzen den Display-Namen.
Namen werden aus openclaw.json geladen.

### GPU-Modell: Qwen 3.5 9B Opus-Distilled v2
**Status:** Deployed seit 2026-03-30
- Modell: Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-v2 (Q4_K_M)
- Quelle: HuggingFace Jackrong
- Server: --reasoning-budget 1024 (verhindert Endlos-Thinking)
- HA-Benchmark: 10/10 Sensoren, 10/10 Tool Calls, 5/5 Konversation, 40.4 t/s

**Entscheidung:** Opus-Distilled statt Original Qwen 3.5 9B
**Warum:** Gleiche Groesse, gleiche Geschwindigkeit, besseres Reasoning.
HA-Benchmark bestanden (alle Tests). Claude-Opus-Stil Reasoning effizienter
als natives Qwen-Thinking. reasoning-budget 1024 als Sicherheit.

## Erkenntnisse
- JSONL-Format: Nachrichten mit Timestamp, Role, Content
- Offset-Tracking verhindert doppelte Verarbeitung
- bge-m3 API-Format: OpenAI-kompatibel (`/v1/embeddings`, `data[0].embedding`)
- BM25 Tokenizer identisch mit memory-recall Plugin (shared Code)
- MiniMax-Fehler: Offset wird NICHT gespeichert → Turn bleibt im Backlog
- Qwen 3.5 9B ungeeignet als Extractor-Fallback (Halluzination, 1/74 Facts ohne Thinking)
- Qwen Thinking-Mode braucht max_tokens ≥8192 (Reasoning allein 1000-7000 Tokens)
- Household-Facts exklusiv in memories_household (nicht zusaetzlich in Agent-Collection)

## 2026-04-03: Phase 2 — Two-Pass Behavior-Extraction

### Two-Pass statt Combined-Prompt
**Status:** Geplant für Phase 2
**Entscheidung:** Separate Extraktions-Passes für Facts (Pass 1) und Behavior (Pass 2)
**Warum:** Phase 0 hat gezeigt dass ein kombinierter Fact+Behavior Prompt bei MiniMax
instabil ist (hohe Varianz zwischen Runs). Two-Pass-Strategie:
- Pass 1: Facts (unverändert, bestehender Pipeline)
- Pass 2: Behavior-Rules mit eigenem Prompt + Verifier
Vorteil: Null Regressionsrisiko auf bestehende Fact-Extraktion. Behavior läuft
orthogonal auf separatem Code-Pfad.

### Getrennte targetInstructionCollections()
**Entscheidung:** Eigene Funktion statt isBehavior-Parameter in targetCollections()
**Warum:** Konsultations-Empfehlung aus Phase 0. Domains sind disjoint:
- Facts: memories_benni, memories_household, memories_domi
- Behavior: instructions_benni, instructions_household, instructions_domi
Getrennte Funktionen sind expliziter und reduzieren Fehler bei Collection-Naming.

### Confidence 0.7 für Behavior-Regeln
**Entscheidung:** Behavior-Schwelle höher als bei Facts (0.5 → 0.7)
**Warum:** Phase 0 Full-Scan zeigte dass niedrige Schwellen einmalige Aufträge
durchlassen ("Analysiere Token-Waste" sieht aus wie generelle Regel). Höhere
Schwelle filtert Lärm raus und erhöht Präzision bei Rules, die den Agent
konfigurieren sollen.

### Verifier-Kriterium für Behavior
**Entscheidung:** Standard-Verifier-Frage: "Würde der User erwarten dass diese Regel
auch in ZUKÜNFTIGEN Gesprächen gilt?"
**Warum:** Filtert einmalige Aufträge zuverlässig raus. Echte Verhaltens-Regeln
("Nutze Emojis nicht", "Antworte auf Deutsch") müssen generaliserbar sein.
Konversations-Kontext für Verifier wird aus cleanWindowForBehavior() gewonnen.

## 2026-04-05: Phase 3 — SDK-Redesign (Phase 1+2)

### Extractor auf Claude Agent SDK umgestellt
**Status:** Implementiert, Feature-Flag `EXTRACTOR_ENGINE=sdk` (default: `legacy`)

**Entscheidung:** SDK-Agent ersetzt Custom MiniMax Chat-Client im Extractor

**Kontext:** Custom MiniMax Client mit bis zu 11 API-Calls pro Turn (Extract + je Verify),
JSON-Parse-Fehler im Verifier bei unparseable_response, Behaviors zu vage formuliert.

**Lösung:**
- `query()` aus `@anthropic-ai/claude-agent-sdk` mit MiniMax M2.7 Backend via `ANTHROPIC_BASE_URL`
- `outputFormat: { type: 'json_schema', schema: ... }` → kein JSON-Parse-Fehler mehr
- Kombinierter System-Prompt: Facts + Behaviors + Inline-Verifikation in 1 Call
- Feature-Flag `EXTRACTOR_ENGINE=sdk|legacy` für sicheren Rollout
- Fallback auf Legacy-Pipeline bei SDK-Fehler (nach 3 Retries mit Exponential Backoff)
- PII-Filter (Telefon/E-Mail Regex) nach dem Parsen in TypeScript
- Confidence-Schwelle: 0.7 (strenger als Legacy 0.5 — Inline-Verifikation übernimmt)
- SDK-Mode deaktiviert Batch-Verarbeitung in watcher.ts (1 Call/Turn = bereits optimal)

**Alternativen verworfen:**
- Batch-Optimierung: Architektur bleibt komplex, JSON-Parse-Fehler bleiben
- Lokales Qwen: Nicht mehr vorhanden nach GPU-Umbau

**Konsequenzen:**
- Phase 3 (Legacy-Cleanup: batch.ts, verifier.ts, lib/minimax.ts löschen) in separater
  Session nach Validierung des SDK-Modes im Produktivbetrieb

### Context-Cleaning vor Behavior-Pass
**Entscheidung:** cleanWindowForBehavior() entfernt [Erinnerungen], [Regeln],
TTS-Metadata, WhatsApp-Wrapper vor Behavior-Extraktion
**Warum:** Reduziert Prompt-Größe ~50%, verhindert False Positives aus injiziertem
Kontext. Beispiel: [Regel: "Nutze stets Emojis"] würde sonst selbst als zu
extrahierende Regel erkannt. Reine User-Nachrichten + Assistant-Replies bleiben
für Kontext-Fenster erhalten.
