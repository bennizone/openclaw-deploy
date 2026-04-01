# Entscheidungen: HA-Admin

## 2026-04-01 — Eigener Agent statt ha-integration erweitern

**Kontext:** Bedarf an HA-Administration (Automationen, Wartung, Troubleshooting)
aus Claude Code heraus.

**Entscheidung:** Eigener Komponenten-Agent `ha-admin`, getrennt von `ha-integration`.

**Begruendung:**
- ha-integration = home-llm Python Code, der INNERHALB HA laeuft (Conversation Agent)
- ha-admin = HA selbst administrieren VON AUSSEN via REST API
- Komplett unterschiedlicher Scope, andere Tools, andere Risiken
- Scope-Vermischung wuerde beide Agenten unuebersichtlich machen

**Alternativen:**
- ha-integration erweitern → Abgelehnt: Scope-Vermischung, ha-integration ist Python-fokussiert
- Kein eigener Agent, nur Ad-hoc-Befehle → Abgelehnt: Kein Wissens-Aufbau, keine Checklisten
