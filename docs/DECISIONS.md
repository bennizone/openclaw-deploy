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
