# Nachtschicht 2026-04-01 — Zusammenfassung

Benni hat 12 Aufgaben uebergeben. Alle wurden analysiert, hier der Status.

---

## Uebersicht

| # | Aufgabe | Status | Braucht Benni? |
|---|---------|--------|----------------|
| 1 | Cron "pairing required" (WS 1008) | ERLEDIGT | Nein |
| 2 | Feature-Request-System | ERLEDIGT | Nein |
| 3 | SOUL.md Admin-Hinweis | ERLEDIGT (mit #2) | Nein |
| 4 | Fallback-Modell Praefix | TODO — Plugin noetig | JA — braucht /coder |
| 5 | Entwicklungsprozess optimieren | War bereits erledigt (F.1-F.3) | Nein |
| 6 | HA-Admin Agent | ERLEDIGT | Nein |
| 7 | THN Wetter-Antwort Tuning | ERLEDIGT | Nein |
| 8 | Weather-Tool Hourly-Index Bug | ERLEDIGT | Nein |
| 9 | Audit-Agent | TODO — Design steht | Nein (on-demand, interaktiv) |
| 10 | Onboarding re-run | TODO — schrittweise | Nein |
| 11 | Maintenance-Mode | ERLEDIGT | Nein |
| 12 | README aktualisieren | ERLEDIGT | Nein |
| 13 | LLM-Bench Tool | TODO — neu | Nein |

---

## 1. Cron "pairing required" (WS 1008)

**Problem:** Device `4a193188...` in `~/.openclaw/devices/paired.json` hat nur
`operator.read` Scopes. Gateway-interner Tools-Cron braucht `operator.admin`,
wird mit Code 1008 abgewiesen. Fehler tritt intermittierend auf (7x in 2 Tagen).

**Fix-Optionen:**
- A) `openclaw devices approve <hash> --scopes operator.admin,operator.read,operator.write`
- B) `paired.json` manuell editieren (Scopes erweitern)
- C) `paired.json` loeschen, komplett neu pairen

**Warum Benni:** Sicherheitsrelevant — Scope-Erweiterung eines Devices.

**Nebenbefund:** WhatsApp-Provider hat separates stale-socket Problem
(Health-Monitor restartet alle ~35min). Eigenes Ticket.

---

## 2+3. Feature-Request-System + SOUL.md Admin-Hinweis

**Was:** Neue "Administration" Sektion in allen SOUL.md Dateien:
- Agents duerfen KEINE Config/Tools/Features aendern
- Feature-Request Interview-Protokoll (Was? Wofuer? Wie wichtig?)
- Requests landen in `feature-requests/YYYY-MM-DD-<titel>.md`
- Household-Agent bekommt gekuerzte Voice-Variante

**Betroffene Dateien:**
- `~/.openclaw/workspace-benni/SOUL.md` — Admin + Feature-Request Sektion
- `~/.openclaw/workspace-domi/SOUL.md` — Admin + Feature-Request Sektion
- `~/.openclaw/workspace-household/SOUL.md` — Gekuerzte Voice-Variante
- `agents/templates/SOUL.md.template` — Template fuer neue Agents
- `agents/household/SOUL.md` — Household-Template

**Status:** Umgesetzt via /coder.

---

## 4. Fallback-Modell Praefix

**Problem:** Wenn Qwen (Fallback) statt MiniMax antwortet, sieht der User keinen Unterschied.

**Optionen:**
- A) `responsePrefix: "[{provider}]"` in openclaw.json — einfach, aber auf JEDER Nachricht
- B) Model-Aliases ("M2.7" vs "Qwen-Fallback") + `{model}` Prefix — klarer
- C) Plugin mit `message_sending` Hook — nur bei Fallback, aber Code noetig
- D) SOUL.md Instruktion — unzuverlaessig

**Empfehlung:** Option A+B (Config-only). Prefix auf jeder Nachricht als Trade-off.

**Warum Benni:**
- Soll der Prefix auf JEDER Nachricht stehen oder nur bei Fallback?
- Wenn nur Fallback: Plugin noetig (mehr Aufwand, Hook-Payload unklar)
- Welches Format? `[M2.7]`, `[minimax]`, Emoji-Indikator?

---

## 5. Entwicklungsprozess optimieren

**Status: ERLEDIGT.** F.1 (Aggregation), F.2 (Learnings→Docs), F.3 (Stuetzraeder)
sind komplett implementiert und committed. Autonomy-Daten sind noch leer (0 Sessions
recorded) — fuellt sich automatisch bei konsequenter Nutzung.

---

## 6. HA-Admin Agent

**Was:** Neuer Komponenten-Agent fuer Home Assistant Administration.
Separater Scope von ha-integration (home-llm Code):
- HA Automationen CRUD via REST API
- Entity/Device/Area Management
- Health-Checks, Backups, Troubleshooting
- HA Log-Analyse, Optimierungen

**Neue Dateien:**
- `components/ha-admin/description.md`
- `components/ha-admin/claude.md`
- `components/ha-admin/testinstruct.md`
- `components/ha-admin/decisions.md`
- `.claude/commands/ha-admin.md` (Slash-Command)
- `config/autonomy.json` Update (Level 0)
- `CLAUDE.md` Update (Slash-Commands Tabelle)

**Status:** Umgesetzt via /coder.

---

## 7. THN Wetter-Antwort Tuning

**Problem:** THN gibt ungefragt Heute-Info wenn nach Morgen gefragt wird.

**Fix:** Neue "Antwortfokus" Sektion in SOUL.md:
"Beantworte genau die gestellte Frage — nicht mehr."

**Betroffene Dateien:**
- `~/.openclaw/workspace-benni/SOUL.md`
- `agents/templates/SOUL.md.template` (fuer neue Agents)

**Status:** Umgesetzt zusammen mit #2+3 (gleiche Dateien).

---

## 8. Weather-Tool Hourly-Index Bug

**Problem:** `humidity` und `feels_like` lesen Index `[0]` (Mitternacht)
statt aktuelle Stunde.

**Datei:** `services/openclaw-tools/src/tools/weather.ts`, Zeilen 146-148

**Fix:** `current_weather.time` gegen `hourly.time[]` matchen,
korrekten Index fuer aktuelle Stunde berechnen.

**Status:** Umgesetzt via /coder + Build + Test.

---

## 9. Audit-Agent

**Empfehlung:** `/audit` Slash-Command (wie `/reflect`), kein eigener Komponenten-Agent.

**Prueft:**
- Infrastructure Health (Services, Ports, Disk)
- Config-Integritaet (openclaw.json, .env, Secrets in Git)
- Architektur-Drift (Running vs Documented)
- Memory-System Health (Qdrant, Extractor, Dimensionen)
- Prozess-Compliance (Autonomy, Patterns, DECISIONS.md)

**Unterstuetzung:** `scripts/config-audit.py` fuer deterministische Checks.

**Warum Benni — Design-Entscheidungen:**
- Scope: Schmal (nur Infra+Config) oder breit (inkl. Prozess/Governance)?
- Frequenz: Nur on-demand oder scheduled (wöchentlich)?
- Auto-Fix: Nur Report oder darf der Audit einfache Probleme fixen (z.B. Service restart)?
- MiniMax: Fuer Drift-Analyse nutzen oder rein deterministisch?

---

## 10. Onboarding Re-Run

**Problem:** Phasen koennen aktuell nicht einzeln wiederholt werden.

**Vorgeschlagener Ansatz:** `/onboard <phase>` Syntax.
- State-Datei: Phase auf `done: false` setzen, durchfuehren, wieder `done: true`
- Config-Daten aus Interview wiederverwenden
- Sub-Tasks pro Phase (z.B. "Neuer Agent" statt ganzes Agent-Setup)

**Warum Benni — Sicherheitsaspekte:**
- Setup-Scripts sind NICHT idempotent (Qdrant, Workspaces)
- `lxc_setup` Re-Run koennte Config ueberschreiben
- Agent-Workspaces: SOUL.md darf NICHT ueberschrieben werden
- Braucht Idempotenz-Review aller Setup-Scripts vor Implementierung

**Empfehlung:** Phase `verification` und `gpu_server` sind safe fuer Re-Run.
Andere Phasen brauchen Guards. Schrittweise implementieren.

---

## 11. Maintenance-Mode

**Was:** `scripts/maintenance.sh on|off|status` — sauberes Hoch-/Herunterfahren.

**Services (Reihenfolge beim Stoppen):**
1. openclaw-gateway (stoppt Traffic-Annahme)
2. openclaw-extractor
3. llama-embed-fallback
4. Qdrant (Docker)
5. Optional: GPU-Server Services (--with-gpu Flag)

**Features:**
- Health-Checks beim Hochfahren (curl auf alle Endpoints)
- Flag-Datei `~/.openclaw-maintenance` als Status-Indikator
- GPU-Server IP/User aus State-Datei lesen
- XDG_RUNTIME_DIR Prefix beachten

**Status:** Umgesetzt via /coder.

---

## Naechste Schritte fuer Benni

### Sofort entscheiden:
1. **WS 1008:** Welche Fix-Option? (A empfohlen — `openclaw devices approve`)
2. **Fallback-Prefix:** Auf jeder Nachricht OK oder nur bei Fallback?
3. **Audit-Agent:** Scope, Frequenz, Auto-Fix — siehe Fragen oben

### Spaeter angehen:
4. **Onboarding Re-Run:** Setup-Scripts auf Idempotenz pruefen (aufwaendig)
5. **WhatsApp stale-socket:** Separates Problem, eigenes Ticket

### Nichts zu tun:
6. **Entwicklungsprozess:** Erledigt, fuellt sich durch Nutzung
