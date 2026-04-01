# Plan: Agenten-Architektur + Orchestrator-System

## Context

Das OpenClaw-Entwicklungssystem wird von "Claude Code macht alles selbst" auf ein
Orchestrator-Modell umgestellt: Claude Code koordiniert spezialisierte Komponenten-Agenten.
Jeder Agent kennt nur seinen Bereich, hat strukturiertes Wissen, und wird bei Planung
und Umsetzung konsultiert. Ziel: bessere Qualitaet, Wissenserhalt, schrittweise Autonomie,
und spaeter WhatsApp-Steuerung.

### Spaetere Erweiterungen (NICHT in diesem Plan, aber vorbereitet)

- **Self-Reflection:** Nach Aufgabenabschluss bekommt der Agent einen zweiten Call:
  "Was hast du gelernt? Was wuerdest du anders machen?" Ergebnis wird in decisions.md
  geschrieben. Voraussetzung: Agent muss das vollstaendige Protokoll seiner Session
  sehen koennen (alle Tool-Aufrufe, Ergebnisse, Fehler). Wird nachgeruestet wenn
  Basis-Workflow stabil laeuft.
- **WhatsApp-Bridge:** Claude CLI headless als Backend, `/admin` Session-Switch,
  PIN/HA-Push Freigabe. Wird implementiert wenn Agenten-System funktioniert.
- **Stuetzraeder-Protokoll:** Autonomie-Levels 0-3 mit automatischer Progression.
  Wird implementiert wenn genug Erfahrungsdaten vorliegen.

---

## Vorbedingung: MiniMax-Agent-Test

Bevor irgendwas gebaut wird: Validieren ob MiniMax als Konsultations-Agent
brauchbare Antworten liefert.

### Test-Durchfuehrung

```bash
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [
      {
        "role": "system",
        "content": "Du bist der Tool-Hub-Agent. Du kennst nur den MCP-Server in services/openclaw-tools/. Darin sind Tools: web_search, understand_image, calendar_events, contacts_search, arr_search. Neue Tools werden als src/tools/<name>.ts angelegt, mit TypeBox Schema, und in index.ts registriert. Build: npm run build. Deploy: Gateway-Restart. Node 24 hat nativen fetch."
      },
      {
        "role": "user",
        "content": "Ich will ein Wetter-Tool als MCP-Tool einbauen. Open-Meteo API, kein API-Key. Ist das in deinem Bereich machbar? Was muss beachtet werden?"
      }
    ]
  }'
```

### Erwartung

MiniMax sollte mindestens liefern:
- Ja, machbar
- Neue Datei noetig (src/tools/weather.ts)
- Registrierung in index.ts
- Open-Meteo braucht Geocoding (Stadtname → Koordinaten)
- Kein .env noetig (kein API-Key)
- Build + Gateway-Restart

### Go/No-Go

- **Brauchbar:** MiniMax liefert strukturierte, korrekte Antwort → weiter mit Plan
- **Teilweise:** Antwort ist ok aber unvollstaendig → description.md muss detaillierter werden
- **Unbrauchbar:** Halluziniert oder ignoriert System-Prompt → Alternative: Qwen 3.5 9B
  auf GPU-Server testen, oder nur Claude fuer Konsultation (teurer)

---

## Ausfuehrungsphase A: Struktur + Schema anlegen

### A.1: Verzeichnisse erstellen

```
components/
├── tool-hub/
├── gateway/
├── ha-integration/
├── memory-system/
├── gpu-server/
├── openclaw-skills/
├── onboard/
├── reviewer/
├── tester/
└── protokollant/
```

### A.2: Einheitliches Schema pro Komponente

Jede Komponente (tool-hub bis onboard) bekommt 4 Dateien:

**description.md** — WAS macht die Komponente?
```markdown
# <Komponenten-Name>

## Zweck
Was macht diese Komponente? (2-3 Saetze)

## Architektur
Dateien, Verzeichnisse, Einstiegspunkte, Sprache, Build-System

## Abhaengigkeiten
- Braucht: [andere Komponenten, Services, Ports]
- Wird gebraucht von: [wer nutzt mich]

## Schnittstellen
- Eingabe: Was bekomme ich? (API-Calls, Dateien, Events)
- Ausgabe: Was liefere ich? (Format, Felder, Beispiel)

## Konfiguration
Wo konfiguriert, welche ENV-Variablen, welche Config-Sections

## Bekannte Einschraenkungen
Was geht nicht, Workarounds

## Neues Feature hinzufuegen
Schritt-fuer-Schritt wie man diese Komponente erweitert
```

**testinstruct.md** — WIE wird getestet? (Nur vom Tester gelesen)
```markdown
# Test-Anweisungen: <Komponenten-Name>

## Voraussetzungen
Was muss laufen, bevor getestet werden kann?

## Health-Check
Schnellster Weg zu pruefen ob die Komponente lebt

## Funktions-Tests
### Test: <Name>
- Befehl: `curl/command...`
- Erwartetes Ergebnis: ...
- Bei Fehler: Moegliche Ursachen

## Integrations-Tests
Tests die Zusammenspiel mit anderen Komponenten pruefen
```

**claude.md** — SCOPE des Agenten
```markdown
# Agent-Scope: <Komponenten-Name>

## Meine Dateien
Welche Pfade gehoeren zu mir (src/, config/, etc.)

## Meine Verantwortung
Was muss ich bei Aenderungen beachten?

## Build & Deploy
Wie wird gebaut, wo deployed, was muss neugestartet werden?

## Pflichten nach jeder Aenderung
- description.md aktuell halten bei Schnittstellenaenderungen
- testinstruct.md aktualisieren bei neuen Features
- decisions.md fuehren bei nicht-trivialen Entscheidungen

## Abgrenzung
Was gehoert NICHT zu mir (→ welcher andere Agent ist zustaendig)
```

**decisions.md** — WARUM wurde so entschieden? (lokal pro Komponente)
```markdown
# Entscheidungen: <Komponenten-Name>

## <Datum> — <Titel>
**Kontext:** Was war die Situation?
**Entscheidung:** Was wurde entschieden?
**Begruendung:** Warum?
**Alternativen:** Was wurde verworfen?
```

Sonder-Agenten (reviewer, tester, protokollant) bekommen nur `claude.md`
— sie haben keinen eigenen Code, sondern arbeiten uebergreifend.

### A.3: Komponenten-Liste

| # | Agent | Verzeichnis | Beschreibt | Code-Pfade |
|---|-------|-------------|------------|-----------|
| 1 | tool-hub | `components/tool-hub/` | MCP-Server, externe Tools | `services/openclaw-tools/` |
| 2 | gateway | `components/gateway/` | Config, Routing, Plugin-System | `config/`, `~/.openclaw/openclaw.json` |
| 3 | ha-integration | `components/ha-integration/` | Home-LLM, HA-Deployment | `services/home-llm/` |
| 4 | memory-system | `components/memory-system/` | Extractor, Qdrant, Recall-Plugin | `services/extractor/`, `plugins/openclaw-memory-recall/` |
| 5 | gpu-server | `components/gpu-server/` | llama.cpp, Modelle, VRAM | `setup/gpu-server/` |
| 6 | openclaw-skills | `components/openclaw-skills/` | Plugins mit Hooks | `plugins/openclaw-ha-voice/` (+ kuenftige) |
| 7 | onboard | `components/onboard/` | Setup, Prerequisites | `setup/lxc/`, `.claude/commands/onboard.md` |
| 8 | reviewer | `components/reviewer/` | Code-Review Checkliste | — (uebergreifend) |
| 9 | tester | `components/tester/` | Liest testinstruct.md aller Komponenten | — (uebergreifend) |
| 10 | protokollant | `components/protokollant/` | Zentrale + lokale DECISIONS.md, Docs | `docs/` |

### Handoff-Prompt fuer Phase A

```
Lies die Datei /home/openclaw/openclaw-deploy/PLAN-agenten-architektur.md
und fuehre "Ausfuehrungsphase A: Struktur + Schema anlegen" aus.

Erstelle alle Verzeichnisse und Dateien mit dem Schema aus dem Plan.
Fuelle die Dateien noch NICHT mit Inhalten — nur die Ueberschriften
und Platzhalter gemaess Schema. Committe das Ergebnis.
```

---

## Ausfuehrungsphase B: Befuellung der Komponenten-Agenten

Jede description.md, testinstruct.md, claude.md und decisions.md wird
mit echtem Wissen aus dem bestehenden Repo befuellt.

### Quellen-Mapping

| Komponente | Primaer-Quellen |
|------------|----------------|
| tool-hub | `services/openclaw-tools/DECISIONS.md`, `services/openclaw-tools/src/index.ts`, `docs/creating-skills.md` |
| gateway | `CLAUDE.md` (Config-Protokoll, Ports, Plugin-Hooks), `config/openclaw.template.json`, `docs/architecture.md` |
| ha-integration | `services/home-llm/DECISIONS.md`, `services/home-llm/custom_components/home_llm/conversation.py` |
| memory-system | `services/extractor/DECISIONS.md`, `plugins/openclaw-memory-recall/DECISIONS.md`, `docs/memory-pipeline.md` |
| gpu-server | `setup/gpu-server/`, `config/versions.json`, `.claude/commands/gpu-server-admin.md` |
| openclaw-skills | `plugins/openclaw-ha-voice/DECISIONS.md`, `.claude/commands/openclaw-skill-creator.md`, `docs/creating-skills.md` |
| onboard | `.claude/commands/onboard.md`, `setup/lxc/bootstrap.sh`, `~/.openclaw-deploy-state.json` |
| reviewer | `.claude/commands/reviewer.md` |
| tester | `.claude/commands/tester.md` |
| protokollant | `.claude/commands/docs.md`, bestehende DECISIONS.md-Dateien als Vorlage |

### Befuellungs-Reihenfolge

1. **tool-hub** (am besten dokumentiert, guter Startpunkt)
2. **gateway** (zentral, viele Abhaengigkeiten)
3. **memory-system** (komplex, 3 Sub-Komponenten)
4. **ha-integration**
5. **gpu-server**
6. **openclaw-skills**
7. **onboard**
8. **reviewer, tester, protokollant** (lesen die anderen → zum Schluss)

Jede Komponente: Quellen lesen → description.md befuellen → testinstruct.md
befuellen → claude.md befuellen → decisions.md migrieren. Commit pro Komponente.

### Kritische Lektionen verteilen

Die 14 Lektionen aus CLAUDE.md werden auf die zustaendigen Komponenten verteilt:

| Lektion | Gehoert zu |
|---------|-----------|
| Node 24 VOR OpenClaw | onboard |
| Config nur ueber Claude Code | gateway |
| bge-m3 = 1024 Dimensionen | memory-system |
| Config validieren vor Speichern | gateway |
| Agent NICHT sich selbst reparieren | gateway |
| loginctl enable-linger | onboard |
| tools.profile = "full" | gateway |
| plugins.slots.memory = "none" | memory-system |
| Matrix dm:{} statt dmPolicy | gateway |
| Matrix peer statt from | gateway |
| Conduit Join braucht reason | gateway |
| Bootstrap in SOUL.md | openclaw-skills |
| Sessions NIE loeschen | memory-system |
| userTimezone setzen | gateway |

### Handoff-Prompt fuer Phase B

```
Lies die Datei /home/openclaw/openclaw-deploy/PLAN-agenten-architektur.md
und fuehre "Ausfuehrungsphase B: Befuellung der Komponenten-Agenten" aus.

Befuelle alle components/*/description.md, testinstruct.md, claude.md
und decisions.md mit echtem Wissen aus den im Plan genannten Quellen.
Arbeite in der angegebenen Reihenfolge (tool-hub zuerst).
Lies IMMER zuerst die Quell-Dateien, bevor du schreibst.
Stelle sicher, dass Abhaengigkeiten bidirektional dokumentiert sind
(A sagt "braucht B" ↔ B sagt "wird gebraucht von A").
Committe nach jeder Komponente (oder in sinnvollen Gruppen).
```

---

## Ausfuehrungsphase C: Orchestrator + Slash-Commands

### C.1: CLAUDE.md Orchestrator-Protokoll

Neuer Abschnitt in CLAUDE.md:

```markdown
## Orchestrator-Protokoll

Claude Code ist der Orchestrator. Er schreibt keinen Code selbst,
sondern koordiniert spezialisierte Komponenten-Agenten.

### Agenten-Uebersicht
Lies `components/*/description.md` fuer eine aktuelle Uebersicht
aller Komponenten, ihrer Faehigkeiten und Abhaengigkeiten.

### Modell-Zuweisung
- Claude (Pro/Max): Orchestrierung, Coding (/coder), Review (/reviewer)
- MiniMax (via chatCompletions): Konsultation, Tests, Protokoll, Routine
- Konsultation via: curl -X POST http://localhost:18789/v1/chat/completions
  mit description.md + decisions.md als System-Prompt

### Workflow bei neuen Features / Aenderungen
1. Ziel klaeren mit User
2. Betroffene Komponenten identifizieren (description.md lesen)
3. Plan-Entwurf mit Checkliste:
   - [ ] Ziel definiert
   - [ ] Nutzer/Zielgruppe
   - [ ] Sicherheit
   - [ ] Laufzeitumgebung
   - [ ] Abhaengigkeiten
   - [ ] Testbarkeit
4. Konsultationsrunde: Betroffene Agenten via MiniMax befragen
5. Plan konsolidieren, Konflikte aufloesen
6. User-Freigabe
7. Coding via /coder (Claude) — liest vorher claude.md der Komponente
8. Tester liest testinstruct.md, fuehrt Tests aus
9. Reviewer prueft
10. Protokollant: DECISIONS.md zentral + lokal
11. Betroffene Agenten aktualisieren ihre MDs (description, testinstruct)
12. Ship it: Commit + Deploy
```

### C.2: Slash-Commands anpassen

| Command | Aenderung |
|---------|-----------|
| `/coder` | + "Lies zuerst components/<betroffene>/description.md + claude.md" |
| `/reviewer` | + "Lies description.md der betroffenen Komponenten" |
| `/tester` | + "Lies testinstruct.md der zu testenden Komponente" |
| `/docs` | Erweitern: schreibt zentrale + lokale decisions.md |
| `/helper` | + "Lies alle components/*/description.md fuer Ueberblick" |

Neue Commands:
| Command | Zweck |
|---------|-------|
| `/consult` | Einzelnen Agent via MiniMax befragen |
| `/plan-review` | Konsultationsrunde an alle betroffenen Agenten |

### C.3: Bestehende Routing-Tabelle ersetzen

Die statische Agent-Auswahl-Tabelle in CLAUDE.md wird durch eine
Referenz auf die Komponenten ersetzt:

"Lies `components/*/description.md` um zu entscheiden, welche
Komponenten betroffen sind. Nutze den jeweiligen Agenten fuer
Konsultation (MiniMax) und Implementierung (Claude/coder)."

### Handoff-Prompt fuer Phase C

```
Lies die Datei /home/openclaw/openclaw-deploy/PLAN-agenten-architektur.md
und fuehre "Ausfuehrungsphase C: Orchestrator + Slash-Commands" aus.

Aktualisiere CLAUDE.md mit dem Orchestrator-Protokoll (ersetze die
bestehende statische Routing-Tabelle und Pipeline-Beschreibung).
Passe die Slash-Commands an (.claude/commands/).
Erstelle die neuen Commands /consult und /plan-review.
Committe das Ergebnis.
```

---

## Ausfuehrungsphase D: MiniMax-Validierung + Wetter-MCP Durchlauf

### D.0: Konsultations-Script (ERLEDIGT)

`scripts/consult-agent.sh` erstellt — liest Token automatisch aus ~/.openclaw/.env,
laedt description.md (+ optional decisions.md) als System-Prompt, setzt
X-OpenClaw-Scopes Header. Angepasste Dateien:
- `CLAUDE.md` (Orchestrator-Protokoll)
- `.claude/commands/consult.md`
- `.claude/commands/plan-review.md`

### D.1: MiniMax-Agent-Test (ERLEDIGT — GO)

Test durchgefuehrt via `scripts/consult-agent.sh tool-hub "<Wetter-Frage>"`.
MiniMax lieferte strukturierte, korrekte Antwort: Geocoding, weather.ts,
Registrierung, kein API-Key. Keine Halluzinationen. Bewertung: Go.

### D.2: Wetter-MCP nach neuem Workflow (ERLEDIGT)

Kompletter Durchlauf nach Orchestrator-Protokoll (13 Schritte).
Session-Protokoll: `docs/session-logs/2026-04-01-phase-d2-weather-tool.md`

Ergebnis:
- weather-Tool live (Open-Meteo, kein API-Key)
- 3 Konsultationen (tool-hub, gateway, ha-integration) — keine Konflikte
- Build + Deploy + E2E-Test erfolgreich
- Commits: f167087 (Feature), 3b3c521 (Script-Verbesserung)
- Bekannter Bug: Hourly-Index 0 statt aktuelle Stunde (TODO)

### D.3: consult-agent.sh Verbesserungen (ERLEDIGT)

- `--brief` Flag (kompakte Antworten, 5-8 Saetze)
- `curl -m 45` Timeout
- Commit: 3b3c521

---

## Phase A-E: Abgeschlossen

| Session | Phase | Status | Ergebnis |
|---------|-------|--------|----------|
| 1 | A: Struktur anlegen | ERLEDIGT | 10 Verzeichnisse, ~34 Dateien mit Schema-Skelett |
| 2 | B: Befuellung | ERLEDIGT | Alle MDs mit echtem Wissen befuellt |
| 3 | C: Orchestrator + Commands | ERLEDIGT | CLAUDE.md + Slash-Commands angepasst |
| 4 | D: Validierung + Wetter-MCP | ERLEDIGT | MiniMax getestet, Wetter-Tool live, Script verbessert |
| 5 | E.1: Checklisten-Struktur | ERLEDIGT | claude.md entschlackt, operative Details in Checklisten |
| 6 | E.2: Self-Reflection | ERLEDIGT | /reflect Command, Python-Extractor, workflow-patterns.md |

---

## Ausfuehrungsphase E: Checklisten-Struktur + Self-Reflection (ERLEDIGT)

### Ziel

Zwei Teilphasen:
- **E.1:** claude.md-Dateien entschlacken → Routing-Tabellen. Operative Details
  in separate Checklisten-Dateien auslagern. Damit Reflection spaeter in die
  richtigen Dateien schreiben kann.
- **E.2:** Self-Reflection implementieren. MiniMax analysiert rohe Session-JSONLs
  auf Token-Waste, Claude patcht die betroffenen Checklisten.

### Entschiedene Fragen

| Frage | Antwort | Begruendung |
|-------|---------|-------------|
| Wer reflektiert? | MiniMax analysiert, Claude patcht | MiniMax: guenstige Tokens + frische Augen. Claude: Schreibrechte + User-Dialog |
| Welche Daten? | Rohes JSONL (via Python-Script aufbereitet) | Aufbereitete Protokolle verstecken genau den Waste den wir finden wollen |
| Output-Format? | Konkrete Patch-Vorschlaege pro Checkliste | Keine Selbstbeweihraecherung, nur actionable Fixes |
| Wo persistieren? | In die Checkliste wo die Info gefehlt hat | Nicht in eigene Reflection-Docs, sondern direkt ins Wissen |
| Wann? | Semi-automatisch (Default nach Feature, skippbar) | `/reflect` als Schritt 13 im Workflow |

### Detaillierter Plan

Siehe: `/home/openclaw/.claude/plans/curried-plotting-marble.md`

### Echte Daten fuer Entwicklung

Session-Log D.2: `docs/session-logs/2026-04-01-phase-d2-weather-tool.md`
Roh-JSONL: `~/.claude/projects/-home-openclaw-openclaw-deploy/5c9f4bc3-ab0d-4093-a8dd-97f47436c045.jsonl`

### E.2 Ergebnisse

- **Extractor-Script:** `scripts/extract-session-calls.py` — 68 Calls extrahiert, 3 Errors gefunden
- **MiniMax-Analyse:** 3 Patch-Vorschlaege geliefert (XDG, testinstruct, Edit-before-Read)
- **Alle 4 D.2-Patterns bestaetigt:** In E.1-Checklisten bereits gefixt
- **workflow-patterns.md:** 4 Eintraege aus D.2
- **CLAUDE.md:** Schritt 14 (Reflection) + JSONL-Pfad + /reflect in Slash-Commands
- **/reflect Command:** Vollstaendiger 7-Schritt-Workflow

### Handoff-Prompt fuer Phase E.1

```
Lies die Datei /home/openclaw/openclaw-deploy/PLAN-agenten-architektur.md
(Phase E) und den detaillierten Plan in
/home/openclaw/.claude/plans/curried-plotting-marble.md (Phase E.1).

Fuehre "Phase E.1: Checklisten-Struktur" aus:

1. Lies ALLE betroffenen claude.md Dateien (tool-hub, gateway, openclaw-skills,
   memory-system, gpu-server) um den aktuellen Inhalt zu verstehen.
2. Lies die zugehoerigen description.md und testinstruct.md als Wissensquelle.
3. Erstelle die Checklisten-Dateien pro Komponente gemaess Plan:
   - tool-hub: deploy-checklist.md, new-tool-checklist.md
   - gateway: config-change-checklist.md
   - openclaw-skills: new-skill-checklist.md
   - memory-system: troubleshoot-checklist.md
   - gpu-server: model-swap-checklist.md
4. Baue die claude.md Dateien um: Operative Details raus, Routing-Tabelle rein.
   Behalte: Meine Dateien, Meine Verantwortung, Abgrenzung, Kritische Regeln (gateway).
   Entferne: Build & Deploy, Pflichten nach Aenderung (leben jetzt in Checklisten).
5. Stelle sicher dass KEIN operativer Hinweis verloren geht — alles was in claude.md
   stand muss in einer Checkliste wiederzufinden sein.
6. Committe das Ergebnis.
```

### Handoff-Prompt fuer Phase E.2

```
Lies die Datei /home/openclaw/openclaw-deploy/PLAN-agenten-architektur.md
(Phase E) und den detaillierten Plan in
/home/openclaw/.claude/plans/curried-plotting-marble.md (Phase E.2).

Fuehre "Phase E.2: Self-Reflection" aus:

Echte Session-Daten: ~/.claude/projects/-home-openclaw-openclaw-deploy/5c9f4bc3-ab0d-4093-a8dd-97f47436c045.jsonl

1. Erstelle das Python-Extractor-Script (scripts/extract-session-calls.py):
   Liest JSONL, extrahiert Tool-Calls mit Name/Input/Result/Error.
2. Erstelle /reflect Slash-Command (.claude/commands/reflect.md):
   Workflow: Script → MiniMax-Analyse → Claude-Patches → User-Review.
3. Teste auf D.2-JSONL: Script ausfuehren, MiniMax via consult-agent.sh befragen,
   pruefen ob die 4 bekannten Waste-Patterns gefunden werden.
4. Erstelle docs/workflow-patterns.md mit D.2-Patterns.
5. Erweitere CLAUDE.md: Workflow Schritt 13 (Reflection) + JSONL-Pfad.
6. Aktualisiere PLAN-agenten-architektur.md: Phase E als erledigt.
7. Committe das Ergebnis.
```
