# Workflow-Patterns

Trend-Tracking aus `/reflect` Sessions. Wenn ein Pattern >2x auftaucht → strukturelles Problem.

| Datum | Feature | Pattern | Fix | Status | Anzahl |
|-------|---------|---------|-----|--------|--------|
| 2026-04-01 | Weather-Tool | XDG_RUNTIME_DIR vergessen bei systemctl | CLAUDE.md Kritische Lektionen #6 + feedback_xdg_runtime.md | geloest | 1 |
| 2026-04-01 | Weather-Tool | testinstruct.md nicht gelesen vor E2E-Test → Scope unbekannt | docs/workflow.md Schritt 2 (description.md lesen) | geloest | 1 |
| 2026-04-01 | Weather-Tool | CLAUDE.md Einfuegestelle fuer neues Tool unklar → Grep noetig | CLAUDE.md Komponenten-Map als Referenz | geloest | 1 |
| 2026-04-01 | Weather-Tool | Edit ohne vorheriges Read → tool_use_error (2x) | Allgemeines Claude-Verhalten, kein Checklisten-Fix | geloest | 1 |
| 2026-04-01 | Self-Reflection | consult-agent.sh 3x Timeout (45s zu knapp) | Obsolet: consult-sdk.mjs ersetzt consult-agent.sh | geloest | 1 |
| 2026-04-01 | Self-Reflection | Read auf grosse JSONL ohne limit → Token-Limit | .claude/commands/reflect.md: JSONL-Groessen-Hinweis | geloest | 1 |
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
| 2026-04-02 | Prompt-Opt | consult-agent.sh Timeout bei langer Session-Analyse | Obsolet: consult-sdk.mjs ersetzt consult-agent.sh (SDK-Agents lesen Dateien selbst) | geloest | 1 |
| 2026-04-02 | cleanup: exports | Konsultation an falsche Komponente (ha-integration statt openclaw-skills fuer Plugin-Fragen) | Vor Konsultation pruefen ob Agent den Datei-Scope hat | offen | 1 |
| 2026-04-02 | cleanup: exports | orchestrator-audit.py erkennt Agent-basierte /reviewer und /tester nicht (nur Skill-Calls) | Script: Agent-Calls mit passender Description als Workflow-Schritt werten + Segment-Handling | offen | 1 |
| 2026-04-02 | cleanup: exports | config-audit.py + orchestrator-audit.py exit 1 bricht parallel calls ab | Exit-Codes gefixt: 0 bei WARNs/Violations, nur Script-Fehler=non-zero | geloest | 1 |
| 2026-04-02 | reviewer-doku | Agent(Explore) statt Direkt-Read fuer bekannte Referenz-Datei (gateway/description.md) | Lerneffekt: Gateway ist Referenz fuer Sektions-Format | geloest | 1 |
| 2026-04-02 | reviewer-doku | MiniMax-Konsultation liefert Wetter statt Reviewer-Kontext (9B-Halluzination) | Bekanntes 9B-Problem, kein Fix moeglich | offen | 1 |
| 2026-04-02 | dead-code-cleanup | /reviewer git diff ohne '--' Separator → ambiguous argument | reviewer.md: '--' Separator Pflicht dokumentiert | geloest | 1 |
| 2026-04-02 | dead-code-cleanup | Agent(Explore) statt Grep fuer Export-Suche (Ergebnis unzuverlaessig) | Grep bevorzugen fuer gezielte Symbol-Suchen | geloest | 1 |
| 2026-04-02 | Token-Waste | autonomy-status.py Level-0 write-Check mehrfach ignoriert (Chunks 8,9,10,11,16) | Fix: read aus Level-0 Approval entfernt, Check-Output mit Handlungsanweisung | geloest | 5 |
| 2026-04-02 | Token-Waste | consult-agent.sh liefert falschen Agent-Kontext (Chunk 3) | Obsolet: consult-sdk.mjs liest description.md direkt | geloest | 1 |
| 2026-04-02 | Token-Waste | Skill-Launch verliert Parent-Kontext (Chunks 3,9,13) | Architektonische Limitierung von Claude Code Skills — kein Fix moeglich | offen | 3 |
| 2026-04-02 | Token-Waste | TaskCreate-Kaskaden statt Batch (Chunks 7,14) | docs/workflow.md: max 3 Tasks fuer triviale Jobs, Batch wenn moeglich | offen | 2 |
| 2026-04-02 | Token-Waste | Working-Directory nicht initialisiert vor git ops (Chunk 11) | Claude-Verhalten: Kein separater Fix moeglich, Awareness reicht | geloest | 1 |
| 2026-04-02 | Token-Waste | Glob+Read statt direkt Edit (Chunks 3,7) | Claude-Verhalten: Read vor Edit ist Pflicht (Tool-Policy) | geloest | 2 |
| 2026-04-02 | Token-Waste | Busy-Wait auf Background-Task (3x sleep+cat, Chunk 5) | feedback_background_tasks.md: Auf Notifications warten | geloest | 1 |
| 2026-04-02 | Token-Waste | consult-agent.sh fuer triviale "ist X unbenutzt?" (Chunks 6,8) | Obsolet: SDK-Agents haben Grep-Zugriff, koennen selbst pruefen | geloest | 2 |
| 2026-04-02 | Token-Waste | Grep-Retry bei "No matches found" (= gueltiges Ergebnis, Chunk 12) | Claude-Verhalten: Awareness reicht, kein separater Fix | geloest | 1 |
| 2026-04-02 | Token-Waste | tsc --noEmit "no output" nicht diagnostisch (Chunk 10) | build.sh: && echo "BUILD_OK" || echo "BUILD_FAILED:$?" | offen | 1 |
| 2026-04-02 | Token-Waste | Doppelt-Bestaetigung nach Konsultation (Task 18+19, Chunk 8) | docs/workflow.md: Nach Konsultation direkt zur Implementierung | geloest | 1 |
| 2026-04-02 | Token-Waste | Read vor full-overwrite Write ohne Praeservation (Chunk 17) | Claude-Verhalten: Write-Tool Pflicht laut System-Prompt | geloest | 1 |
| 2026-04-02 | Token-Waste | exploratorische ls+head+grep Ketten (Chunks 4,12) | Claude-Verhalten: Awareness reicht, Glob/Grep bevorzugen | geloest | 2 |
| 2026-04-02 | Token-Waste | Read von unveränderter Datei (Chunks 3,9,13) | Claude-Verhalten: Read vor Edit ist Pflicht, Duplikate minimieren | geloest | 3 |
| 2026-04-02 | Token-Waste | Script-Output via Zwischendatei+Read statt inline (Chunk 12) | Claude-Verhalten: Bash-Output direkt nutzen | geloest | 1 |
| 2026-04-02 | Token-Waste | Kein Pre-Check ob Tasks bereits existieren (Chunk 14) | Claude-Verhalten: Awareness reicht | geloest | 1 |
| 2026-04-02 | Token-Waste | read-after-skill-launch | Architektonische Limitierung: Skill hat eigenen Kontext | offen | 1 |
| 2026-04-02 | Token-Waste | redundant-grep | Claude-Verhalten: Awareness reicht | geloest | 1 |
| 2026-04-02 | Token-Waste | glob-fuer-unused | Claude-Verhalten: Awareness reicht | geloest | 1 |
| 2026-04-02 | Token-Waste | read-after-edit | Claude-Verhalten: Awareness reicht | geloest | 1 |
| 2026-04-02 | Token-Waste | shell-ohne-doku | Claude-Verhalten: Awareness reicht | geloest | 1 |
| 2026-04-02 | Token-Waste | task-bewertung-fehlt | docs/workflow.md: Stufen-Klassifikation (Minimal/Standard/Komplex) | geloest | 1 |
| 2026-04-02 | Token-Waste | chained-commands-no-isolation | Claude-Verhalten: Awareness reicht | geloest | 1 |
| 2026-04-02 | Token-Waste | reflect-filename-confusion | Obsolet: reflect-auto.sh ueberarbeitet | geloest | 1 |
| 2026-04-02 | Token-Waste | wc-head-chain | Claude-Verhalten: Awareness reicht | geloest | 1 |
| 2026-04-02 | Token-Waste | skill-fragmentation | Architektonische Limitierung von Claude Code Skills | offen | 1 |
| 2026-04-02 | Token-Waste | consult-without-preflight | Obsolet: consult-sdk.mjs liest description.md als Kontext | geloest | 1 |
| 2026-04-02 | Token-Waste | exploratory-ls-cd-chain | Claude-Verhalten: Glob/Read bevorzugen | geloest | 1 |
| 2026-04-03 | Tokenfresser-Migration | ORCH-FIX nach Review (Kat.3-Hinweis selbst editiert) | Auch nicht-blockierende Findings an /coder delegieren | offen | 1 |
| 2026-04-03 | Tokenfresser-Migration | Write+Read-Redundanz nach Datei-Erstellung | Claude-Verhalten: Awareness reicht | geloest | 1 |
| 2026-04-03 | Tokenfresser-Migration | Batch-Read statt sequentielle Einzel-Reads | Claude-Verhalten: Parallele Tool-Calls nutzen | geloest | 1 |
| 2026-04-04 | consult-sdk | Read-Edit ist das zuverlaessigste Pattern fuer MiniMax SDK | Default fuer /coder-light nutzen | offen | 1 |
| 2026-04-04 | consult-sdk | Triviale Fragen (Bestaetigung, OK) nicht ueber SDK-Agent | Verbraucht 22k Cache-Tokens fuer nichts | offen | 1 |
