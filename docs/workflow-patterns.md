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
| 2026-04-02 | Prompt-Opt | Komponenten-Mapping: home-llm statt ha-integration gesucht | claude.md: Alias-Hinweis ergaenzt | geloest | 1 |
| 2026-04-02 | Prompt-Opt | HA Credentials: 5 Calls um Token/SSH zu finden | claude.md: Credentials-Sektion ergaenzt | geloest | 1 |
| 2026-04-02 | Prompt-Opt | HA Entity-Name geraten (3 Calls) | claude.md: Entity-IDs dokumentiert | geloest | 1 |
| 2026-04-02 | Prompt-Opt | HA Backup-API Endpoint falsch (2 Calls) | claude.md: Korrekte API-Endpoints dokumentiert | geloest | 1 |
| 2026-04-02 | Prompt-Opt | Workflow-Tasks erst nach User-Ermahnung vollstaendig | CLAUDE.md: Alle 14 Schritte SOFORT als Tasks, keine Nachtraege | geloest | 1 |
| 2026-04-02 | Prompt-Opt | Reviewer-Findings nicht auto-gefixt, User musste "alle fixen" sagen | CLAUDE.md 10a-10d: Mechanisch+eigene Entscheidungen sofort fixen | geloest | 1 |
| 2026-04-02 | Prompt-Opt | orchestrator-audit.py erkennt consult-agent.sh nicht | Script: Bash-Calls mit consult-agent.sh als Konsultation erkennen | geloest | 1 |
| 2026-04-02 | Prompt-Opt | consult-agent.sh Timeout bei langer Session-Analyse | TODO: Chunking oder kompaktere Zusammenfassung | offen | 1 |
| 2026-04-02 | cleanup: exports | Konsultation an falsche Komponente (ha-integration statt openclaw-skills fuer Plugin-Fragen) | Vor Konsultation pruefen ob Agent den Datei-Scope hat | offen | 1 |
| 2026-04-02 | cleanup: exports | orchestrator-audit.py erkennt Agent-basierte /reviewer und /tester nicht (nur Skill-Calls) | Script: Agent-Calls mit passender Description als Workflow-Schritt werten + Segment-Handling | offen | 1 |
| 2026-04-02 | cleanup: exports | config-audit.py + orchestrator-audit.py exit 1 bricht parallel calls ab | Exit-Codes gefixt: 0 bei WARNs/Violations, nur Script-Fehler=non-zero | geloest | 1 |
