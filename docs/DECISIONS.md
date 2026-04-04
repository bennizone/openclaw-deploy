# Zentrale Entscheidungen — OpenClaw Deploy

Systemweite und architekturuebergreifende Entscheidungen.
Komponentenspezifische Entscheidungen stehen in `components/<name>/decisions.md`.

## 2026-04-04: Wetter-Vorhersage als HA Template-Sensoren

**Kontext:** Qwen konnte nur aktuelles Wetter beantworten (weather.forecast_home Entity).
Vorhersage-Fragen ("Wie wird das Wetter morgen?") wurden faelschlich an OpenClaw delegiert
oder mit fehlenden Daten beantwortet.

**Entscheidung:** 3 Template-Trigger-Sensoren in HA configuration.yaml statt Code-Aenderung
in conversation.py. Sensoren: `sensor.wetter_morgen`, `sensor.wetter_ubermorgen`,
`sensor.wetter_in_3_tagen`. Stuendlich aktualisiert via `weather.get_forecasts` Service.
Als Conversation-Entitaeten verfuegbar gemacht.

**Alternativen:** Forecast-Daten in conversation.py per API holen und in Prompt injecten
(verworfen — Code-Abhaengigkeit, HA-seitige Loesung ist sauberer und schneller).

**Konsequenzen:** Qwen sieht Vorhersage direkt im Entity-Kontext. Keine Code-Aenderung noetig.
Sensoren muessen in HA als Conversation-Entitaeten exposed bleiben.

## 2026-04-04: orchestrator-audit.py Session-Klassifikation

**Kontext:** Compliance-Metriken (consult, reviewer, docs, tester) waren bei Admin-Sessions
immer 0%, obwohl der volle Workflow dort nicht anwendbar ist. Fuehrte zu irreführenden
Audit-Ergebnissen.

**Entscheidung:** Neue Funktion `classify_session()` unterscheidet "admin" vs "feature".
Admin: <=5 Calls ODER keine Projekt-Edits und kein /coder. Feature: Projekt-Edits oder /coder.
SKIP-Violations nur bei Feature-Sessions. Admin-Compliance wird als `null` ausgegeben.

**Konsequenzen:** Audit-Berichte differenzieren jetzt nach Session-Typ. Keine false-positive
SKIP-Violations mehr bei Admin/Routing/Config-Sessions.

## 2026-04-04: Code-Refactoring Batch (Audit-Findings)

**Kontext:** Audit 2026-04-04 fand 4 MEDIUM Code-Duplikationen.

**Entscheidung:** Drei Refactorings in einem Batch:
- `getMiniMax()` Singleton: 4x im Extractor → 1x `lib/minimax.ts`
- `unfoldField()` Utility: `icalField` + `vcardField` vereinheitlicht in `lib/ical-utils.ts`
- CalDavSource/CardDavSource Pool: Zentralisiert in `lib/pim-access.ts`

**Alternativen:** Einzeln in separaten Sessions (verworfen — zusammenhaengend, gleicher Scope).

**Konsequenzen:** ~60 Zeilen Code-Duplikation eliminiert. Plugin-Isolation bleibt gewahrt
(Sonarr/Radarr bewusst getrennt, siehe DECISIONS.md 2026-04-03).

## 2026-04-04: workflow-patterns.md Bereinigung

**Kontext:** 79% der "geloesten" Fixes verwiesen auf nicht-existierende Dateien.
38 von 62 Patterns waren offen, viele davon obsolet durch SDK-Umstellung.

**Entscheidung:** 20 Patterns als geloest markiert:
- consult-agent.sh Patterns → obsolet durch consult-sdk.mjs
- Claude-Verhalten-Patterns (redundant-grep, read-after-edit etc.) → Awareness reicht
- Fix-Referenzen korrigiert auf tatsaechliche Dateien (CLAUDE.md, workflow.md, feedback_*.md)

**Konsequenzen:** Umsetzungsrate steigt von 39% auf ~65%. Verbleibende offene Patterns
sind echte strukturelle Probleme (ORCH-FIX, Skill-Isolation).

## 2026-04-04: System-Prompt Externalisierung (home-llm)

**Kontext:** System-Prompt war als mehrzeiliger String in `conversation.py` hardcodiert.
Unuebersichtlich bei Platzhalter-Substitution, keine Trennung zwischen Prompt-Logik und
Prompt-Inhalt.

**Entscheidung:** Prompt aus `conversation.py` in `system_prompt.txt` ausgelagert.
Platzhalter: `TIME`, `DAYLIGHT`, `ENTITIES`, `MEMORY_BLOCK`, `PERSONA`.
Datei wird bei jedem Request gelesen (kein Caching — Aenderungen sofort wirksam).
Fallback auf hardcoded Default wenn Datei fehlt.

**Alternativen:** Caching implementieren (verworfen — Aenderungen muessten Cache
invalidieren, Mehr Complexity fuer wenig Mehrwert), INI/YAML-Format (verworfen —
Plain-Text ist einfacher zu debuggen).

**Konsequenzen:** Prompt-Pflege ohne Code-Aenderungen moeglich. Logging/Tracing
einfacher da Platzhalter direkt in Datei sichtbar. Fallback schuetzt vor Dateifehlern.

**Details:** `components/ha-integration/decisions.md`

## 2026-04-03: Workflow v2 — 13 Schritte + 3 Stufen

**Kontext:** 14-Schritte-Workflow hatte falsche Reihenfolge (Test vor Review vor Docs),
war zu starr fuer kleine Aufgaben, und nutzte /coder-light nicht als Default.

**Entscheidung:** Neuer 13-Schritte-Workflow mit:
- Reihenfolge korrigiert: Review (7) → Fixes (8) → Re-Review (9) → Docs (10) → Test (11)
- 3 Stufen: Minimal (Code→Build→Ship), Standard (alle 13), Komplex (+ Preflight)
- Review-Loop (max 2x) und Test-Loop (max 2x, Orchestrator entscheidet Bug vs Design)
- /coder-light als Default-Coder, /coder nur bei Architektur
- Reviewer parkt nur bei Plan-Abweichung oder User-Entscheidung
- Reflect + autonomy record immer Pflicht (Schritt 13)
- TODO-Eintrag erledigt markieren in Schritt 13

**Alternativen:** Alten 14-Schritte-Workflow beibehalten (zu starr), komplett
auf ad-hoc wechseln (zu chaotisch).

**Konsequenzen:** orchestrator-audit.py Step-Nummern angepasst. CLAUDE.md Verweise
aktualisiert. Orchestrator klassifiziert Stufe bei Schritt 1.

## 2026-04-03: Reflect-Erweiterung — Agent-Sessions + Learnings

**Kontext:** /reflect analysierte nur Orchestrator-JSONL. MiniMax-Agent-Sessions
(SDK-Calls) wurden nicht reflektiert. Kein Lernmechanismus fuer Agenten.

**Entscheidung:**
- consult-sdk.mjs: Neues `--session-log` Flag, schreibt JSONL nach `~/.openclaw/sdk-sessions/`
- reflect-auto.sh: Neuer Schritt 3b analysiert SDK-Sessions via MiniMax
- Learnings werden in `components/*/learnings.md` geschrieben (eigene Datei pro Komponente)
- Meta-Loop-Schutz: reflect-eigene Sessions werden uebersprungen

**Alternativen:** Learnings in claude.md (verworfen — wird vollgemuellt),
in decisions.md (verworfen — andere Semantik), gar keine Learnings (verworfen — Agenten
lernen nicht aus eigenen Fehlern).

**Konsequenzen:** orchestrator-audit.py erlaubt jetzt Writes auf learnings.md.
reflect.md Command hat neue Schritte (5: Learnings, 6: workflow-patterns, 7: Summary, 8: Aggregation).
Session-Logging ist opt-in (--session-log Flag oder Default-Verzeichnis).

## 2026-04-03: consult-agent.sh → consult-sdk.mjs (SDK Agents auf MiniMax)

**Kontext:** consult-agent.sh war ein 388-Zeilen Bash-Script das MiniMax ueber den OpenClaw Gateway aufrief. Probleme: Gateway musste laufen, kein Tool-Zugriff, manuelles Chunking.

**Entscheidung:** Ersetzt durch `scripts/consult-sdk.mjs` — ein Node.js Wrapper um die Claude Code SDK (`@anthropic-ai/claude-agent-sdk`). Der SDK-Agent laeuft direkt auf MiniMax M2.7 als Backend, hat Read/Glob/Grep-Zugriff und braucht kein manuelles Chunking.

**Konsequenzen:**
- Gateway muss NICHT mehr laufen fuer Konsultationen
- Kein Chunking/Map-Reduce mehr noetig (Agent liest Dateien selbst)
- consult-agent.sh bleibt als Fallback, ist aber deprecated
- Betroffene Skills: /consult, /plan-review, /reviewer, /audit, /reflect

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
