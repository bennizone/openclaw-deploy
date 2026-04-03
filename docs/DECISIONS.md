# Zentrale Entscheidungen — OpenClaw Deploy

Systemweite und architekturuebergreifende Entscheidungen.
Komponentenspezifische Entscheidungen stehen in `components/<name>/decisions.md`.

## 2026-04-02 — System-Prompt Optimierung (home-llm)

**Kontext:** Baseline-Bench zeigte: OPENCLAW-Delegation 50%, Format-Compliance 0%,
Allgemeinwissen faelschlich delegiert.

**Entscheidung:** Prompt sektioniert (Format, Daten, Steuerung, Delegation),
1 ICL-Beispielpaar, Wetter nicht delegieren (Entitaeten im Kontext).

**Ergebnis:** Delegation 100%, Format 100%, Allgemeinwissen 100%. Edge-ambiguous offen.

**Details:** `components/ha-integration/decisions.md`

## 2026-04-02 — Benchmark Phase 3: Dataset-Fixes + Token-Zaehlung

**Kontext:** Test-Dataset inkonsistent nach mock_entities-Aenderung, Token-Verbrauch nicht gemessen.

**Entscheidung:** mock_entities Deckenlampe off, 3 Tests angepasst, ":" erlaubt,
run-bench.sh mit separatem Speed-Test (Prefill/Decode t/s), Helper-Refactoring,
jq Float-Division Fix. Memory-Bench geparkt.

**Details:** `components/ha-integration/decisions.md`

## 2026-04-02 — Tokenfresser-Migration: /audit + /reviewer

**Kontext:** Token-Waste-Analyse zeigte ~6950 Token/Session Verschwendung
durch direkte Analyse grosser Datenmengen in Claude-Kontext.

**Entscheidung:** Grosse Datenmengen (>6000 Zeichen) via `consult-agent.sh --input-file`
an MiniMax delegieren. Generische Funktion wird wiederverwendet, kein neuer Code.

- `/audit`: Kat. 5, 6, 8, 9 → MiniMax. Kat. 1-4, 7, 10 → Claude.
  Kat. 3 optional delegierbar (Stimmigkeits-Analyse 3c bei grossen Projekten).
- `/reviewer`: Diffs >6000 Zeichen → MiniMax-Erstanalyse.
  Pflicht-Checks (Secrets, Build, Plugin-Doctor) bleiben bei Claude.

**Alternativen:** Alles bei Claude lassen (teuer), eigenes Script pro Skill (Duplikation).

**Konsequenzen:** Schwellenwert 6000 konsistent mit `consult-agent.sh MAX_QUESTION_LEN`.
MiniMax-Findings sind Startpunkt, nicht Endergebnis (9B kann halluzinieren).

## 2026-04-03 — Logging-Konvention: 3 Mechanismen bewusst beibehalten

**Kontext:** Audit stellte 3 verschiedene Logging-Ansaetze fest.

**Entscheidung:** Kein Vereinheitlichungsbedarf — jeder Mechanismus passt zum Kontext:
- `process.stderr.write()` in MCP-Servern (openclaw-tools) — stdout ist fuer JSON-RPC reserviert
- Structured Logger in services/extractor/ — langlebiger Service braucht Level + Timestamps
- `console.log()` nur in Benchmark/Test-Dateien — akzeptabel fuer Entwickler-Tools

**Begruendung:** Vereinheitlichung wuerde keinen Mehrwert bringen und im MCP-Fall sogar brechen.

## 2026-04-03 — Plugin-Isolation: Bewusste Code-Trennung Plugin vs Service

**Kontext:** Audit fand Duplikation: Sonarr/Radarr-Clients existieren als Plugin
(openclaw-sonarr-radarr) und als Service-Clients (openclaw-tools/src/clients/).

**Entscheidung:** Arr-Client-Code bleibt bewusst getrennt. Plugins sind eigenstaendige
NPM-Pakete mit eigenen API-Abstraktionen; Services haben andere Anforderungen.
Shared Dependencies wuerden Plugin-Isolation brechen und Deployment verkomplizieren.

**Ausnahme:** Pure Utilities ohne externe Abhaengigkeiten (z.B. bm25-tokenizer)
koennen als shared Package extrahiert werden (siehe shared/bm25-tokenizer/).

## 2026-04-03 — autonomy-status.py: read aus Level-0 Approval entfernt

**Kontext:** Level-0 Check wurde 5x ignoriert (workflow-patterns.md). Ursache:
`read` war in APPROVAL_REQUIRED[0], aber jede User-Anfrage impliziert Leseerlaubnis.
Der Orchestrator MUSS lesen um zu arbeiten, hat die Freigabe-Anforderung also ignoriert.

**Entscheidung:** `read` aus Level 0 entfernt. Level 0 und Level 1 haben jetzt
identische Approval-Sets (`write, deploy, config, new`). Der konzeptuelle Unterschied
liegt im Track-Record (Progressions-Schwellen), nicht in den erlaubten Operationen.

## 2026-04-03 — Memory-Recall Resilience: Offline-Hinweis statt stiller Fehler

**Kontext:** Bei Qdrant/Embedding-Ausfall wurde leerer String/Array zurueckgegeben.
Das LLM wusste nicht, dass Memory nicht verfuegbar ist.

**Entscheidung:** Bei Fehler (Timeout, Connection refused, HTTP non-200) wird ein
separater System-Hinweis injiziert: `[Memory-System: offline]`. Keine Treffer
bei erfolgreicher Suche bleiben leer (kein Fehler-Hinweis). Hinweis als separater
Block, nicht als Memory-Eintrag (semantische Klarheit).

## 2026-04-03 — consult-agent.sh: Reduce-Phase Fehlertoleranz

**Kontext:** Chunking bei grossen Input-Dateien schlug mit Exit 1 fehl.
Ursache: `send_request` in der Reduce-Phase hatte kein `|| true`,
mit `set -euo pipefail` fuehrte ein Timeout zum Script-Abort.

**Entscheidung:** Reduce-Aufrufe (einstufig + zweistufig) fangen Fehler ab.
Bei Reduce-Fehler: Fallback auf Teilergebnisse statt Exit 1.

## 2026-04-03 — SKIP-DOCS Enforcement: Severity + Pre-Commit Gate

**Kontext:** DECISIONS.md in 40% der Sessions uebersprungen. Severity war NIEDRIG.

**Entscheidung:** Severity auf MITTEL erhoeht. Workflow Step 11 mit klaren Kriterien:
Pflicht bei bewussten Entscheidungen, optional nur bei mechanischen Changes.
Step 13 (Ship it) hat jetzt Pre-Commit Gate fuer DECISIONS.md.
