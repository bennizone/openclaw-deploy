# Workflow-Patterns

Trend-Tracking aus `/reflect` Sessions. Wenn ein Pattern >2x auftaucht → strukturelles Problem.

| Datum | Feature | Pattern | Fix |
|-------|---------|---------|-----|
| 2026-04-01 | Weather-Tool | XDG_RUNTIME_DIR vergessen bei systemctl | deploy-checklist.md Schritt 3 |
| 2026-04-01 | Weather-Tool | testinstruct.md nicht gelesen vor E2E-Test → Scope unbekannt | deploy-checklist.md Schritt 6 |
| 2026-04-01 | Weather-Tool | CLAUDE.md Einfuegestelle fuer neues Tool unklar → Grep noetig | new-tool-checklist.md Schritt 12 |
| 2026-04-01 | Weather-Tool | Edit ohne vorheriges Read → tool_use_error (2x) | Allgemeines Claude-Verhalten, kein Checklisten-Fix |
| 2026-04-01 | Self-Reflection | consult-agent.sh 3x Timeout (45s zu knapp) | consult-agent.sh Timeout 45→90s |
| 2026-04-01 | Self-Reflection | Read auf grosse JSONL ohne limit → Token-Limit | /reflect Command: Hinweis zu JSONL-Groesse |
| 2026-04-01 | Self-Reflection | 26% Task-Management-Overhead (21/80 Calls) | Kein Checklisten-Fix, Claude-Verhalten |
