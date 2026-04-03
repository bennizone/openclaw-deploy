# Agent-Routing

Konsolidierte Uebersicht aller Routing-Entscheidungen im OpenClaw-System.
Fuer Modell-Details (VRAM, Quantisierung, Throughput) siehe [model-routing.md](model-routing.md).

## 1. Agent-Auswahl (Wer antwortet?)

Der Gateway routet eingehende Nachrichten anhand von `bindings[]` in `openclaw.json`.
Trifft kein Binding → Default-Agent (`"default": true` in `agents.list[]`).

| Channel | Account | Agent | Workspace |
|---------|---------|-------|-----------|
| whatsapp | benni | benni | workspace-benni |
| whatsapp | domi | domi | workspace-domi |
| chatCompletions API | `X-OpenClaw-Scopes: agent:<id>` | per Header | workspace-\<id\> |
| (kein Match) | — | benni (default) | workspace-benni |

Der `household` Agent hat kein Channel-Binding — er wird nur via chatCompletions API
(z.B. durch Home Assistant home-llm) angesprochen.

### Agent-to-Agent

Agents koennen sich gegenseitig aufrufen (`tools.agentToAgent.enabled: true`).
Erlaubt: benni, domi, household.

## 2. Modell-Auswahl (Welches LLM?)

### Default-Routing

Konfiguriert in `agents.defaults.model`:

| Agent-Typ | Primary | Fallback | Warum |
|-----------|---------|----------|-------|
| Persoenlich (benni, domi) | MiniMax M2.7 (API) | Qwen 3.5 9B (GPU) | MiniMax: bessere Konversation, groesserer Context |
| Household (HA Voice) | Qwen 3.5 9B (GPU) | MiniMax M2.7 | Qwen: schneller, kostenlos, reicht fuer Smart Home |
| Embeddings | bge-m3 (GPU:8081) | bge-m3 (LXC:8081 CPU) | GPU primaer, CPU als Fallback |

### Smart-Home 3-Way-Routing

Das `openclaw-ha-voice` Plugin klassifiziert jede Nachricht im `before_model_resolve` Hook:

```
Nachricht → Classify (Qwen 3.5 9B)
  → "READ"    (Sensordaten)   → HA conversation.home_llm → Antwort
  → "CONTROL" (Geraete)       → HA conversation.home_llm → Antwort
  → "OTHER"   (alles andere)  → MiniMax M2.7 direkt
```

READ/CONTROL wird an Home Assistant delegiert, wo Qwen 3.5 9B mit Zugriff
auf HA-Entities antwortet. Bei OPENCLAW:-Prefix delegiert HA zurueck an
den `household` Agent via chatCompletions API.

## 3. Scope-Routing (Wer darf was?)

### Memory-Scopes (Qdrant)

| Agent | Durchsucht | Schreibt in |
|-------|-----------|-------------|
| benni | memories_benni + memories_household | memories_benni |
| domi | memories_domi + memories_household | memories_domi |
| household | NUR memories_household | memories_household |

Kein Agent kann auf persoenliche Erinnerungen anderer Agents zugreifen.

### PIM-Scopes (Kalender + Kontakte)

Definiert in `services/openclaw-tools/src/config/pim.json`:

| Agent | Kalender | Kontakte |
|-------|----------|----------|
| benni | Hetzner (rw), iCloud (rw) | Hetzner (rw) |
| domi | iCloud (rw), Benni-Hetzner (read) | iCloud (rw), Benni-Hetzner (read) |
| household | Benni-iCloud/Familie (read) | — |

`rw` = readwrite (Termine/Kontakte erstellen, aendern, loeschen).
`read` = nur lesen. `—` = kein Zugriff.

## 4. Hook-Pipeline (Wo passieren Routing-Entscheidungen?)

Hooks feuern in dieser Reihenfolge fuer jede eingehende Nachricht:

| # | Hook | Plugin | Was passiert |
|---|------|--------|-------------|
| 1 | `before_agent_start` | ha-voice | Fliesstext-Anweisung bei Voice-Sessions (TTS-ready Prompt) |
| 2 | `before_prompt_build` | memory-recall | Qdrant-Suche → Top-5 Erinnerungen in System-Prompt injizieren |
| 2 | `before_prompt_build` | ha-voice | CJK-Sanitizer History-Cleanup (MiniMax Language Bleeding) |
| 3 | `before_model_resolve` | ha-voice | Smart-Home 3-Way-Routing (READ/CONTROL → Qwen, OTHER → MiniMax) |
| 4 | `before_message_write` | ha-voice | CJK-Sanitizer Output + TTS-Generierung |

**Wichtig:** `before_dispatch` feuert NUR fuer chatCompletions, NICHT fuer WhatsApp.
`before_model_resolve` und `before_prompt_build` feuern fuer alle Channels.

## 5. Orchestrator-Routing (Claude Code)

Slash-Commands und Modell-Zuweisung fuer den Entwicklungs-Workflow
siehe [CLAUDE.md](../CLAUDE.md) → Abschnitte "Modell-Zuweisung" und "Slash-Commands".

| Aufgabe | Modell |
|---------|--------|
| Orchestrierung, Coding, Review | Claude (Pro/Max) |
| Leichtgewichtiges Coding (Edit, Write, Bash) | MiniMax M2.7 (via `/coder-light`) |
| Konsultation, Tests, Protokoll | MiniMax (via chatCompletions) |
| Analyse grosser Datenmengen | MiniMax (via `consult-sdk.mjs --input-file`, SDK-Agent mit Read/Glob/Grep-Zugriff) |
