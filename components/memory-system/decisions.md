# Entscheidungen: Memory-System

## 2026-03-28 — Eigenes Memory-System statt OpenClaw Builtin

**Kontext:** OpenClaw hat ein eingebautes mem0-basiertes Memory-System.
Es nutzt 1536-dim Vektoren (hardcoded), kein BM25, kein Multi-Agent-Scoping.

**Entscheidung:** Eigenes System aus Extractor + Qdrant + Recall-Plugin.
Builtin-Memory deaktiviert via `plugins.slots.memory = "none"`.

**Alternativen verworfen:**
- Builtin nutzen — kein bge-m3 (1024-dim), kein BM25 Hybrid-Search, kein Household-Scope

## 2026-03-28 — Hybrid Search (Dense + BM25 + RRF Fusion)

**Kontext:** Rein semantische Suche (Dense) verpasst exakte Keyword-Matches.

**Entscheidung:** Dense (bge-m3, 1024-dim) + BM25 (sparse, FNV-1a) + RRF Fusion.
BM25 Tokenizer mit deutschen + englischen Stop-Words und Umlaut-Normalisierung.

**Alternativen verworfen:**
- Nur Dense — verpasst exakte Namen/Orte
- Nur BM25 — verpasst semantische Aehnlichkeit

## 2026-03-28 — Passiver Extractor statt Live-Extraction

**Kontext:** Fakten koennten direkt waehrend der Konversation extrahiert werden.

**Entscheidung:** Separater Service der JSONL-Logs im Hintergrund verarbeitet.
Keine Latenz-Auswirkung auf Konversation, resilient bei Ausfaellen.

**Alternativen verworfen:**
- Live-Extraction im Gateway — wuerde Antwortzeit erhoehen

## 2026-03-30 — MiniMax als einziger Extractor (kein Qwen-Fallback)

**Kontext:** Benchmark mit 74 Turns, alle Sessions:
- MiniMax M2.7: 17 Facts, korrekte Scope-Zuordnung
- Qwen 3.5 no-think: 1 Fact (unbrauchbar)
- Qwen 3.5 think: 13 Facts, aber halluziniert Recall-Context als neue Fakten
- Qwen think 28x langsamer (1731s vs 62s)

**Entscheidung:** Nur MiniMax fuer Extraktion + Verifizierung.
Bei MiniMax-Ausfall: Turns uebersprungen, Offset nicht gespeichert, spaeter nachgeholt.

**Alternativen verworfen:**
- Qwen-Fallback — halluziniert, zu langsam, unbrauchbare Qualitaet

## 2026-03-30 — Two-Stage Pipeline (Extract + Verify)

**Kontext:** Einstufige Extraktion produzierte zu viele falsche Fakten (11/17 Muell).

**Entscheidung:**
- Stage 1: MiniMax extrahiert konservativ (nur User-Messages, Known-Facts-aware)
- Stage 2: MiniMax verifiziert jeden Kandidaten ("Ist das SICHER ableitbar?")
- Ergebnis: 0 falsche Facts aus 74 Turns

**Alternativen verworfen:**
- Einstufig — zu viele False Positives

## 2026-03-30 — Household-Facts exklusiv in memories_household

**Kontext:** Frueher wurden Household-Facts in Agent-Collection UND memories_household
geschrieben. Da Recall immer Agent+Household durchsucht, waren das Duplikate.

**Entscheidung:** Exklusives Routing nach Scope. Household → nur memories_household.

**Alternativen verworfen:**
- Dual-Write — doppelt gemoppelt, verschwendet Speicher

## 2026-03-30 — Nur User-Messages als Extraktionsquelle

**Kontext:** Assistenten-Antworten enthalten Geraetezustaende, Entity-Listen, Sensorwerte
die faelschlicherweise als Fakten extrahiert wurden.

**Entscheidung:** Assistent-Nachrichten = Kontext, User-Nachrichten = Quelle.

**Alternativen verworfen:**
- Alle Messages — zu viel Noise aus HA-Statusmeldungen
