# DECISIONS.md — OpenClaw Deploy

## 2026-04-02: Native Tool-Calling + LLM-Benchmark

### home-llm: Natives Tool-Calling statt Text-Parsing

- **Kontext:** HA's Intent-System versteht keine relativen deutschen Befehle ("mach es heller").
  Text-basiertes Tool-Calling (`<tool_call>` Tags) funktionierte nicht — Qwen ignorierte ICL-Beispiele.
- **Entscheidung:** Natives llama.cpp Tool-Calling ueber OpenAI-kompatible API + HA Assist API.
  Schema-Konvertierung via `voluptuous_openapi`. ~3s pro Tool-Call, korrekte Args.
- **Architektur:** Dreistufiges Routing:
  1. HA Intent (<1s) — Standard-Befehle
  2. LLM Tool-Calling (~3s) — Relative/komplexe Befehle
  3. OpenClaw (5-10s) — Externes Wissen
- Tool-Call-Fehler → Retry als HA Intent (agent_id=conversation.home_assistant)
- Tool-Call-Logging (TOOL_CALL_SUCCESS/FAIL) fuer spaetere Intent-System-Erweiterung

### GPU-Server: ctx-size 196608, Reasoning-Budget 3000

- **Kontext:** Budget war 1024→2048, ctx-size war 32768. llama.cpp Update brachte `--reasoning-budget-message`.
- **Entscheidung:**
  - `--ctx-size 196608` (192K) mit parallel=2 → 98304 pro Slot. VRAM: 7704/8192 MiB (488 MiB Puffer)
  - `--reasoning-budget 3000` (~60s bei 50 t/s) als Server-Cap gegen Endlos-Thinking
  - `--reasoning-budget-message "Okay, I have enough information to answer."` (englisch, Qwen-Training)
  - home-llm steuert eigenes Budget per Request (Default 256). OpenClaw-Fallback bekommt volles Budget.

### /bench LLM-Benchmark Slash-Command

- **Kontext:** Bei jedem neuen LLM das Rad neu erfinden vermeiden.
- **Entscheidung:** Interaktiver Benchmark-Wizard mit fixen Testdatensaetzen (HA 10, Memory 10, Fallback 7).
  Scripts fuer TTFT, t/s, Thinking-Budget-Tests. Claude bewertet Antwortqualitaet.

## 2026-03-31: Initiales Onboarding

### Setup-Uebersicht

- **GPU-Server:** 10.83.1.110 (badmin) — bereits eingerichtet, nur getestet
- **LXC:** 10.83.1.12 (openclaw) — Qdrant, OpenClaw Gateway, Embedding Fallback
- **HA:** haos.home.benni.zone — home-llm Component v2.1.0
- **Agents:** benni (default), domi, household

### Fixes waehrend Onboarding

1. **cmake fehlte** — `apt install cmake build-essential` war noetig fuer llama.cpp CPU-Build
2. **bge-m3 Download blockiert** — HuggingFace verlangt Auth fuer compilade/bge-m3-GGUF. Modell per SCP vom GPU-Server kopiert.
3. **Node-Pfad in systemd** — Node ist via fnm installiert (`~/.local/share/fnm/...`), nicht unter `/usr/bin/node`. Alle systemd Services angepasst.
4. **MiniMax API-Endpunkt** — Extractor nutzte `/chat/completions` (OpenAI-kompatibel), aber der sk-cp Key funktioniert nur mit `/text/chatcompletion_v2` (MiniMax-native). Alle Aufrufe in extractor.ts, index.ts, verifier.ts gepatcht.
5. **home-llm multi-agent** — Component von hardcoded `memories_household` + `openclaw/household` auf konfigurierbares `agent_id` umgebaut (v2.0.0 → v2.1.0). Drei Instanzen: household, benni, domi.

### Architektur-Entscheidungen

- **Alle 3 Agents nutzen Stage-2-Architektur in HA:** Qwen lokal (schnell, Smart Home) mit OpenClaw-Delegation (MiniMax M2.7) fuer Wissensfragen. Nicht nur household.
- **WhatsApp nachgeholt** — Erfolgreich verlinkt (s. Eintrag 2026-03-31 unten).
- **HA-Skill (ClaWHub) uebersprungen** — optional, spaeter nachinstallierbar.
- **Sonarr/Radarr Plugin aktiviert** — URLs: sonarr.home.benni.zone, radarr.home.benni.zone

### Konfiguration

- Gateway-Token: in `~/.openclaw/.env` (GATEWAY_AUTH_TOKEN)
- MiniMax Key: sk-cp Typ (Chatbot Pro), nutzt native API, nicht OpenAI-kompatibel
- Qdrant Collections: memories_benni, memories_domi, memories_household (1024d, Cosine + bm25/idf)
- Plugins: ha-voice, memory-recall, sonarr-radarr (alle in plugins.allow)

## 2026-03-31: Matrix-Channel (Conduit) eingebunden

### Kontext
WhatsApp-Zugang nicht verfuegbar, Matrix als alternativer Channel eingerichtet.
Bestehender Conduit-Server (nicht Synapse) auf matrix.benni.zone.

### Entscheidungen
- **Bot-User `@openclaw:matrix.benni.zone`** auf Conduit angelegt (Registration kurz geoeffnet)
- **DM-Policy: allowlist** — nur `@benni:matrix.benni.zone` darf DMs senden
- **Binding: peer-basiert** — DMs von benni → Agent "benni"
- **Doku erstellt** (`docs/matrix-conduit-setup.md`) — Komplettanleitung fuer Conduit + OpenClaw, da sich das Vorgehen deutlich von Synapse unterscheidet und mehrere nicht-offensichtliche Fallstricke existieren

### Gelernte Lektionen (in CLAUDE.md als #9-#11 aufgenommen)
- Matrix nutzt verschachteltes `dm: { policy, allowFrom }`, nicht top-level `dmPolicy` wie WhatsApp
- Bindings brauchen `peer: { kind, id }`, nicht `from`
- Conduit akzeptiert kein leeres `{}` beim Room-Join (braucht `{"reason":""}`)
- Conduit auto-join funktioniert nicht zuverlaessig — Invites manuell akzeptieren

### Offener Punkt
- ~~Agent "benni" identifiziert sich als "Benni"~~ → Gefixt, siehe naechsten Eintrag

## 2026-03-31: Agent-Identitaet: Agent-ID ≠ Agent-Name

### Problem
Agent "benni" stellte sich als "Hallo, ich bin Benni" vor — verwechselte sich mit dem User.
Ursache: Beim Onboarding wurde `{{AGENT_NAME}}` mit dem User-Namen befuellt.
SOUL.md sagte "Ich bin Benni", IDENTITY.md hatte "Name: Benni".

### Fix
- **Templates** (`agents/templates/`): SOUL.md.template klargestellt — Agent beschreibt sich als
  "Assistent von {{USER_NAME}}", eigener Name kommt erst im Bootstrap-Interview.
  IDENTITY.md.template: Name-Feld als Platzhalter statt vorbelegt.
- **Live-Workspaces** (`workspace-benni/`, `workspace-domi/`): SOUL.md und IDENTITY.md gefixt,
  expliziter Hinweis "Ich bin NICHT <User>. <User> ist mein Mensch."
- **Onboarding-Anleitung** (Phase 4): Warnung eingefuegt, dass Agent-ID ≠ Agent-Name ist.

### Zusaetzliches Problem: Bootstrap-Interview wurde nicht gestartet

Agent antwortete nur "Hi" statt das Interview zu starten, obwohl BOOTSTRAP.md existierte.

**Ursache 1:** MiniMax M2.7 priorisiert SOUL.md ueber spaeter injizierte Dateien (BOOTSTRAP.md).
Die Bootstrap-Anweisung in BOOTSTRAP.md allein reichte nicht.

**Ursache 2:** Alte Session-History — der Agent hatte bereits Turns in der Session und
startete nicht "frisch".

**Fix:**
1. Bootstrap-Anweisung direkt in SOUL.md als ersten Abschnitt ("BOOTSTRAP-MODUS") eingefuegt,
   nicht nur in BOOTSTRAP.md. SOUL.md wird von allen Modellen am staerksten respektiert.
2. AGENTS.md: "First Run" Abschnitt durch harte Bootstrap-Erkennung ersetzt
   (gleiche Logik wie Onboarding-Erkennung in CLAUDE.md: "mach NICHTS anderes").
3. Sessions geloescht fuer frischen Start.
4. BOOTSTRAP.md komplett auf Deutsch umgeschrieben mit klaren Prioritaets-Anweisungen.

**Lektion:** Bei Workspace-Dateien zaehlt die Position im System-Prompt.
SOUL.md wird als erstes gelesen und am staerksten gewichtet.
Kritische Anweisungen gehoeren IN SOUL.md, nicht in spaetere Dateien.

### Neue Dokumentation
- `docs/agent-bootstrap.md` — Bootstrap-Prozess, Wiederholung, Fallstricke
- `docs/session-management.md` — Sessions auflisten, loeschen, Cleanup

## 2026-03-31: CJK-Filter auf message_sending umgestellt

### Problem
Chinesische Zeichen kamen trotz CJK-Filter beim User an. Der Filter sass auf
`before_message_write` — das feuert erst NACH dem Channel-Send. Die Nachricht
geht also unsanitized ueber Matrix/WhatsApp raus, nur die gespeicherte
Session-History wird bereinigt.

### Fix
CJK-Sanitizer zusaetzlich auf `message_sending` Hook registriert (priority 100).
Dieser feuert BEVOR die Nachricht an den Channel geht. Der `before_message_write`
Hook bleibt als Backup fuer die Session-History.

### Locale
`de_DE.UTF-8` Locale generiert und als System-Default gesetzt. War vorher nur
`en_US.UTF-8`. Kein direkter Einfluss auf Umlaute (UTF-8 war schon korrekt),
aber sauberer fuer ein deutsches System.

## 2026-03-31: STT-Fix + MCP-Cleanup

### STT kaputt bei Matrix-Sprachnachrichten
Matrix sendet Audio als `audio/x-m4a`. Das ha-voice Plugin schickte die rohen
m4a-Bytes als "ogg/opus" getarnt an HA Cloud STT → HA gab `result: success`
aber leeren Text zurueck.

**Fix:** Vor dem STT-Call wird nicht-ogg/wav Audio per `ffmpeg` zu ogg/opus
konvertiert. Neue Funktion `audioToOggOpus()` in ffmpeg.ts. Unterstuetzte
Formate: m4a, aac, mp3, webm, 3gp.

**Vorbedingung:** `ffmpeg` muss installiert sein (ist im bootstrap.sh, fehlte
aber auf dem LXC weil es vor dem Bootstrap-Fix eingerichtet wurde).

### MiniMax MCP → OpenClaw Tool-Hub

Separater `minimax-search` MCP-Server (Python via uvx) wurde durch eigenen
**OpenClaw Tool-Hub** (`services/openclaw-tools/`) ersetzt. Node.js MCP-Server,
der alle externen Tools buendelt.

**Architektur-Entscheidung:** Statt vieler kleiner MCP-Server oder OpenClaw-Plugins
fuer reine Tool-Logik: ein zentraler MCP-Server. Plugins bleiben nur fuer
Hook-basierte Funktionalitaet (ha-voice, memory-recall). Reine Tools (Suche,
Vision, spaeter Sonarr/Radarr) laufen im Tool-Hub.

**Web-Search Namenskonflikt geloest:**
- `tools.deny: ["web_search"]` deaktiviert eingebautes DuckDuckGo-Tool
- Tool-Hub liefert eigenes `web_search`, das intern DDG + MiniMax parallel abfragt
- Ergebnisse werden dedupliziert und gemerged (MiniMax priorisiert)
- Graceful Degradation: wenn eine Quelle ausfaellt, liefert die andere

**Image Understanding — zweistufig (unveraendert):**
- MiniMax M2.7 (primaer): Vision nativ — Bilder inline als Image-Content-Block
- Qwen 3.5 9B (Fallback): Text-only — nutzt `understand_image` Tool (→ MiniMax VLM API)
- `understand_image` jetzt im Tool-Hub statt im Python-MCP

**Vorteil:** Kein Python/uvx mehr noetig, alles Node.js. Erweiterbar fuer
zukuenftige Tools (Sonarr/Radarr Migration geplant).

### TTS nur WhatsApp (offen)
TTS-Reply ist nur fuer WhatsApp implementiert (`channelId !== "whatsapp"` → return).
Matrix-TTS braucht eigenen Pfad fuer Audio-Upload als Matrix-Media-Event.
Wird spaeter umgebaut.

## 2026-03-31: Sonarr/Radarr Plugin → Tool-Hub MCP migriert

### Kontext
Das Plugin `openclaw-sonarr-radarr` nutzte keine Hooks — reine Tool-Logik. Damit
war es ideal fuer die Migration in den bestehenden Tool-Hub MCP Server
(`services/openclaw-tools/`). Gleichzeitig drei bekannte Schwaechen behoben:

1. **Deutsche Titel** — Suche nach "Die Simpsons" schlug fehl weil Sonarr/Radarr
   Lookup-Endpoints nur den primaeren (englischen) Titel durchsuchen
2. **Fehlende Details** — Fuer Episoden-Status brauchte THN 7 curl-Calls
3. **Collection-Handling** — Funktionierte, war aber nicht proaktiv genug

### Architektur-Entscheidung

**Ein Tool-Hub statt separater MCP-Server.** Alle externen Tools (Web-Search,
Vision, Sonarr/Radarr) laufen in einem MCP-Server. Plugins bleiben nur fuer
Hook-basierte Funktionalitaet (ha-voice, memory-recall).

### Neue/verbesserte Tools (7 Stueck, vorher 5)

| Tool | Neu/Portiert | Aenderung |
|------|--------------|-----------|
| `arr_search` | Portiert | 3-stufige Suche: Direkt → Library-Alt-Titles → Web-Search TMDB-Aufloesung |
| `arr_add_movie` | Portiert | Unveraendert |
| `arr_add_series` | Portiert | Unveraendert |
| `arr_series_detail` | **Neu** | Staffel-Uebersicht mit Downloaded/Missing/Monitored pro Staffel |
| `arr_episode_list` | **Neu** | Episoden einer Staffel mit Download-Status |
| `arr_calendar` | Portiert | Erweitert um Download-Queue Status |
| `arr_add_collection` | Portiert | Unveraendert |

### Deutsche-Titel-Aufloesung (3-stufig)

1. **Direkt-Suche** bei Sonarr/Radarr (schneller Pfad fuer englische Titel)
2. **Library-Alternative-Titles** — Sonarr/Radarr liefern `alternativeTitles` in
   der Library-Response. Case-insensitive Match findet deutsche Titel fuer Serien/Filme
   die schon in der Bibliothek sind
3. **Web-Search → TMDB** — DDG+MiniMax suchen nach `"query site:themoviedb.org"`,
   extrahieren den englischen Titel aus dem TMDB-Seitentitel, suchen erneut

Stufe 2 ist schnell und kostenlos (lokaler API-Call). Stufe 3 nutzt den bestehenden
Web-Search-Proxy (DDG+MiniMax parallel, volle Redundanz).

### Config-Migration

- MCP env vars: `SONARR_URL`, `SONARR_API_KEY`, `RADARR_URL`, `RADARR_API_KEY`,
  `SONARR_QUALITY_PROFILE`, `RADARR_QUALITY_PROFILE`
- Plugin `openclaw-sonarr-radarr` aus `plugins.allow` und `plugins.entries` entfernt
- Plugin-Code bleibt im Repo als Rollback-Referenz

### Gelernte Lektionen

- Sonarr/Radarr Lookup-Endpoints durchsuchen alternative Titel NICHT (bekannte
  Limitation: Radarr #3346, Sonarr #8070)
- UmlautAdaptarr hilft beim Download-Matching, nicht bei der API-Suche
- Library-Alternative-Titles sind der schnellste Weg fuer deutsche Titel (kein
  externer Call noetig)

## 2026-03-31: WhatsApp-Channel verlinkt

### Kontext
WhatsApp war beim initialen Onboarding uebersprungen worden (Handy nicht verfuegbar).
Jetzt nachgeholt — alle Channels (Matrix + WhatsApp) sind aktiv.

### Setup
- `openclaw channels login --channel whatsapp` in separatem Terminal ausgefuehrt
- Plugin-Quelle: "Use local plugin path" (mitgelieferte Version)
- QR-Code gescannt, Pairing erfolgreich
- DM-Policy: allowlist (Benni + Domi Nummern aus Config)

### Gelernte Lektionen
- **Interaktive Befehle nicht via Claude Code** — Pfeiltasten werden als History-
  Navigation abgefangen, interaktive Menues sind nicht bedienbar. Immer separates
  Terminal verwenden.
- **Error 515 ist harmlos** — WhatsApp verlangt nach QR-Pairing einen Restart
  (Code 515). Die Credentials werden trotzdem gespeichert. `openclaw channels status`
  zeigt "linked, running, connected" wenn es geklappt hat.
- **Onboarding-Phase "channels" abgeschlossen** — deploy-state.json aktualisiert

## 2026-04-01: Phase F.3 — Stuetzraeder-Protokoll (Graduierte Autonomie)

**Kontext:** Der Entwicklungsprozess hatte keine datengetriebene Basis fuer die
Entscheidung, wann eine Komponente weniger Begleitung braucht. Alles wurde immer
mit voller Freigabe behandelt — auch Routine-Operationen an stabilen Komponenten.

**Entscheidung:** 4-stufiges Autonomie-Modell (Level 0–3) pro Komponente,
gesteuert durch fehlerfreie Sessions in Folge. Progression wird vorgeschlagen,
nie automatisch angewendet — der User entscheidet.

**Alternativen:**
- Zeitbasiert (z.B. "nach 2 Wochen Level hoch") — verworfen, weil Stabilitaet
  nicht mit Alter korreliert
- Binär (begleitet/autonom) — zu grob, keine Zwischenstufen

**Konsequenzen:**
- Alle 10 Komponenten starten bei Level 0 (vollstaendig begleitet)
- `/reflect` traegt nach jeder Session Metriken ein (Schritt 8b)
- Workflow Schritt 6 prueft Autonomie-Level vor Freigabe-Anfrage
- Regression bei Fehlern verhindert falsches Sicherheitsgefuehl
- Neue Dateien: `config/autonomy.json`, `scripts/autonomy-status.py`, `docs/stuetzraeder-protokoll.md`

## 2026-04-01: Orchestrator Self-Audit in /reflect

**Kontext:** Der Orchestrator hat in Sessions Code selbst editiert statt an `/coder`
zu delegieren, und mechanische Reviewer-Findings selbst gefixt. Das wurde erst durch
manuelles Review bemerkt — kein automatischer Check existierte.

**Entscheidung:** Deterministisches Python-Script (`orchestrator-audit.py`) das
JSONL-Sessions auf Workflow-Verletzungen prueft. Integriert in `/reflect` als
Schritt 2b. Violations werden wie Reviewer-Autofix behandelt: mechanische Patches
sofort an `/coder`, Pattern-History in `workflow-patterns.md`.

**Alternativen:**
- MiniMax-basierte Analyse — verworfen, Regeln sind klar genug fuer deterministische
  Pruefung, spart Tokens und braucht keinen API-Call
- Manuelle Review — verworfen, skaliert nicht und wird vergessen

**Konsequenzen:**
- 7 Violation-Typen (ORCH-EDIT, ORCH-FIX, SKIP-CONSULT/REVIEWER/TESTER/DOCS/DESCRIPTION)
- Patch-Vorschlaege sind deterministisch — Script liefert Zieldatei + Text
- Self-Audit Violations in workflow-patterns.md fuer Cross-Session-Erkennung
- Orchestrator-Instruktionen (CLAUDE.md, .claude/commands/*.md) verbessern sich ueber Zeit

## 2026-04-01: Nachtschicht — Weather-Fix, Feature-Request-System, HA-Admin

### Weather-Tool Bug Fix

**Kontext:** `humidity` und `feels_like` im Weather-Tool lasen hardcoded
Index `[0]` (Mitternacht) statt die aktuelle Stunde.

**Entscheidung:** `current_weather.time` gegen `hourly.time[]` matchen.
Fallback auf Index 0 bei keinem Match.

**Begruendung:** Open-Meteo liefert beide Zeitstempel im gleichen lokalen
Timezone-Format (`timezone=auto`), daher funktioniert direkter String-Vergleich.

### Feature-Request-System + SOUL.md Admin-Hinweis

**Kontext:** Agents (MiniMax) haben keine Beschraenkung Config zu aendern
oder Features selbst zu bauen. User-Wuensche gehen verloren.

**Entscheidung:** Drei neue SOUL.md Sektionen fuer alle Agents:
1. **Antwortfokus** — Nur die gestellte Frage beantworten
2. **Administration** — Kein Config-Zugriff, nur Claude Code darf
3. **Feature-Requests** — Interview-Protokoll, Ablage in `feature-requests/`

Household-Agent bekommt gekuerzte Voice-Variante (kein Interview,
nur Redirect an Benni).

**Alternativen:**
- AGENTS.md statt SOUL.md — verworfen: MiniMax ignoriert spaeter injizierte
  Dateien (Lektion #12)
- Plugin-basierte Beschraenkung — verworfen: Prompt-Level reicht, kein
  technischer Enforcement noetig

### HA-Admin Komponenten-Agent

**Kontext:** Bedarf an HA-Administration (Automationen, Wartung, Troubleshooting)
aus Claude Code. Bestehender ha-integration Agent deckt nur home-llm Code ab.

**Entscheidung:** Eigener Agent `ha-admin`, getrennt von `ha-integration`.
Schutzliste fuer Entities die ha-integration braucht (sun.sun, zone.home,
Assist Pipeline, conversation.home_llm).

**Begruendung:** Komplett anderer Scope (HA von aussen via REST API vs.
home-llm Python Code innerhalb HA). Scope-Vermischung vermieden.
