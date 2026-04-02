# Workflow-Patterns

Trend-Tracking aus `/reflect` Sessions. Wenn ein Pattern >2x auftaucht → strukturelles Problem.

| Datum | Feature | Pattern | Fix | Status | Anzahl |
|-------|---------|---------|-----|--------|--------|
| 2026-04-01 | Weather-Tool | XDG_RUNTIME_DIR vergessen bei systemctl | deploy-checklist.md Schritt 3 | geloest | 1 |
| 2026-04-01 | Weather-Tool | testinstruct.md nicht gelesen vor E2E-Test → Scope unbekannt | deploy-checklist.md Schritt 6 | geloest | 1 |
| 2026-04-01 | Weather-Tool | CLAUDE.md Einfuegestelle fuer neues Tool unklar → Grep noetig | new-tool-checklist.md Schritt 12 | geloest | 1 |
| 2026-04-01 | Weather-Tool | Edit ohne vorheriges Read → tool_use_error (2x) | Allgemeines Claude-Verhalten, kein Checklisten-Fix | geloest | 1 |
| 2026-04-01 | Self-Reflection | consult-agent.sh 3x Timeout (45s zu knapp) | consult-agent.sh Timeout 45→90s | geloest | 1 |
| 2026-04-01 | Self-Reflection | Read auf grosse JSONL ohne limit → Token-Limit | /reflect Command: Hinweis zu JSONL-Groesse | geloest | 1 |
| 2026-04-01 | Self-Reflection | 26% Task-Management-Overhead (21/80 Calls) | Kein Checklisten-Fix, Claude-Verhalten | geloest | 1 |
| 2026-04-01 | Stuetzraeder+Audit | ORCH-EDIT: Orchestrator editiert Code statt /coder | CLAUDE.md Orchestrator-Protokoll verstaerkt | geloest | 1 |
| 2026-04-01 | Stuetzraeder+Audit | ORCH-FIX: Nach Reviewer selbst gefixt statt /coder | CLAUDE.md Schritt 10a verstaerkt | geloest | 1 |
| 2026-04-01 | Stuetzraeder+Audit | SKIP-CONSULT: Keine Konsultation vor Implementierung | CLAUDE.md Schritt 4 verstaerkt | geloest | 1 |
| 2026-04-01 | Stuetzraeder+Audit | SKIP-TESTER: Kein /tester nach Implementierung | CLAUDE.md Schritt 9 verstaerkt | geloest | 1 |
| 2026-04-01 | Stuetzraeder+Audit | SKIP-DESCRIPTION: description.md nicht gelesen | CLAUDE.md Schritt 2 verstaerkt | geloest | 1 |
| 2026-04-02 | Nachtschicht | ORCH-EDIT: Nachtschicht-Doku direkt editiert | Doku-Dateien sind auch Code → /coder | offen | 2 |
| 2026-04-02 | Nachtschicht | ORCH-FIX: Reviewer-Fixes (maintenance.sh, README) selbst gemacht | Wiederholt! CLAUDE.md Warnung existiert aber wird ignoriert | offen | 2 |
| 2026-04-02 | Nachtschicht | git add dist/ versuchte .gitignore-Datei hinzuzufuegen | Vor git add pruefen ob Pfade in .gitignore stehen | offen | 1 |
| 2026-04-02 | GPU-Onboarding | Sleep-Polling auf consult-agent Background-Task (3x sleep+cat) | run_in_background nutzen statt manuelles Polling | offen | 1 |
| 2026-04-02 | GPU-Onboarding | docs/DECISIONS.md nicht gefunden (existiert nicht) | docs.md: Hinweis zur Existenzpruefung ergaenzt | geloest | 1 |
