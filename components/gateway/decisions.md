# Entscheidungen: Gateway

## 2026-03-30 — Config nur ueber Claude Code

**Kontext:** Agent hat durch fehlerhaften Config-Write die openclaw.json zerstoert.
Gateway startete nicht mehr, manueller Rollback noetig.

**Entscheidung:** OpenClaw darf sich NICHT selbst administrieren. Claude Code ist der
einzige Prozess der openclaw.json aendern darf. Agents haben kein Config-Write-Tool.

**Alternativen verworfen:**
- Config-Validierung im Agent — zu fragil, Agent kann beliebige Fehler machen
- Read-only Config-Sections — zu komplex, schwer abzugrenzen

## 2026-03-30 — tools.profile = "full"

**Kontext:** Plugin-Tools waren nach Config-Aenderung verschwunden. Ursache: tools.profile
war nicht auf "full" gesetzt, was Plugin-Tools still filtert.

**Entscheidung:** tools.profile MUSS immer "full" sein. Andere Profile nicht verwenden.

**Alternativen verworfen:**
- Feingranulare Profile — OpenClaw hat nur wenige Tools, "full" ist sicher genug

## 2026-03-31 — Memory: plugins.slots.memory = "none"

**Kontext:** OpenClaw hat ein builtin Memory-System. Wir nutzen stattdessen Qdrant + Extractor
fuer bessere Kontrolle ueber Embedding-Modell, Deduplizierung und Multi-Agent-Scoping.

**Entscheidung:** Builtin-Memory deaktivieren via `plugins.slots.memory = "none"`.
Memory-Recall Plugin und Extractor uebernehmen.

**Alternativen verworfen:**
- Builtin-Memory nutzen — kein Multi-Agent-Scoping, kein bge-m3, keine Deduplizierung

## 2026-03-31 — Matrix-Channel Schema-Eigenheiten

**Kontext:** Matrix-Channel-Config nach WhatsApp-Muster angelegt, Gateway crashte.
Matrix nutzt anderes Schema als WhatsApp.

**Entscheidung:**
- `dm: { policy: "allowlist", allowFrom: [...] }` statt `dmPolicy` (verschachtelt)
- `peer: { kind: "direct", id: "@user:server" }` statt `from` in Bindings
- Conduit (nicht Synapse): Join braucht `{"reason":""}`, nicht `{}`

**Alternativen verworfen:**
- Keine — Schema ist durch OpenClaw vorgegeben, muss eingehalten werden

## 2026-04-01 — userTimezone in agents.defaults

**Kontext:** Agent kannte weder Datum noch Uhrzeit. Ohne `userTimezone` injiziert OpenClaw
kein Datum/Uhrzeit in den System-Prompt.

**Entscheidung:** `agents.defaults.userTimezone = "Europe/Berlin"` setzen.

**Alternativen verworfen:**
- Datum manuell in SOUL.md — veraltet sofort, nicht dynamisch

## 2026-04-01 — X-OpenClaw-Scopes Header fuer chatCompletions

**Kontext:** home-llm und externe Clients brauchen eine Moeglichkeit, den Ziel-Agent
ueber die chatCompletions API auszuwaehlen.

**Entscheidung:** `X-OpenClaw-Scopes: agent:<id>` Header. Gateway routet an den
angegebenen Agent statt an den Default.

**Alternativen verworfen:**
- Agent-ID im Model-String — kollidiert mit Model-Routing
- Separater Endpoint pro Agent — zu viele Endpoints, nicht skalierbar
