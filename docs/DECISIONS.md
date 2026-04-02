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
