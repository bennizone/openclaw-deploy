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
