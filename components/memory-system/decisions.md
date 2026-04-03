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

## 2026-04-03 — Unified MiniMax Client (@openclaw/minimax-client)

**Kontext:** MiniMax-API-Aufrufe waren 5x dupliziert (extractor, behavior-extractor, verifier 2x, openclaw-tools).
Jeder mit eigenem Error-Handling und Retry-Logik.

**Entscheidung:** Shared package `@openclaw/minimax-client` mit MiniMaxChatClient (Anthropic Messages API)
und MiniMaxPlatformClient (Search + VLM). Nutzt `/anthropic/v1/messages` statt OpenAI-kompatible API.
Vorteil: Thinking als separater Block, sauberes JSON-Parsing ohne stripThinkTags.

**Alternativen verworfen:**
- OpenAI-kompatible API beibehalten — `<think>` Tags im Content, 50% unparseable Verifier-Responses

## 2026-04-03 — Session-Joiner (Tages-Channel-Logs)

**Kontext:** OpenClaw erzeugt pro Konversation eine Session-JSONL (UUID). 89 von 145 Sessions
waren consult-agent.sh Calls, keine User-Konversationen. Meiste Sessions = 1 Turn, kein Kontext.

**Entscheidung:** Joiner aggregiert Sessions in Tages-Channel-Logs (`~/extractor/logs/YYYY-MM-DD_agent_channel.jsonl`).
Filtert consult-Calls raus. Erkennt Channel aus Message-Content (WhatsApp/Matrix/Direct).
Extractor arbeitet auf Tages-Logs → voller Tages-Kontext statt 1-Turn-Sessions.

**Alternativen verworfen:**
- Direkt auf Sessions arbeiten — kein Cross-Session-Kontext, Noise durch consult-Calls

## 2026-04-03 — Extraction-Prompts: Menschen statt Arbeit

**Kontext:** Alter Prompt extrahierte technische Details (Error-Counts, Datei-Pfade, Patch-Vorschlaege)
als Fakten. 35 von 50 geschriebenen Fakten waren Muell.

**Entscheidung:** Prompt-Testfrage: "Beschreibt das den MENSCHEN oder seine ARBEIT?"
Extractor ueberschiesst bewusst ~20%, Verifier filtert mit Beispielen (verified=true/false).
PII-Filter aktiv (Telefonnummern, Adressen → rejected). Ergebnis: 10/12 korrekte Verifier-Entscheidungen.

## 2026-04-03 — max_tokens grosszuegig (8192)

**Kontext:** Bei Anthropic API zaehlen Thinking-Tokens zum max_tokens Budget.
max_tokens=500 schnitt JSON-Responses mitten im Text ab → unparseable.

**Entscheidung:** max_tokens=8192 fuer alle MiniMax-Calls. MiniMax reguliert Thinking-Laenge selbst.

## 2026-04-03 — Remains-API zaehlt als Request

**Kontext:** `GET /v1/coding_plan/remains` zaehlt gegen das 5h-Fenster (1500 Requests Starter Plan).
Automatisches Pollen wuerde Budget verschwenden.

**Entscheidung:** `getRemains()` nur on-demand aufrufen (CLI-Command), nie in automatischen Loops.
