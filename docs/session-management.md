# Session-Management

OpenClaw speichert Konversations-Sessions pro Agent. Jeder Agent hat seinen
eigenen Session-Store unter `~/.openclaw/agents/<agent-id>/sessions/`.

## Sessions auflisten

```bash
# Alle Sessions des Default-Agents:
openclaw sessions

# Sessions eines bestimmten Agents:
openclaw sessions --agent benni

# Alle Agents:
openclaw sessions --all-agents

# Nur aktive Sessions (letzte N Minuten):
openclaw sessions --active 30

# Als JSON:
openclaw sessions --agent benni --json
```

Beispiel-Ausgabe:
```
Session store: ~/.openclaw/agents/benni/sessions/sessions.json
Sessions listed: 2
Kind   Key                        Age       Model          Tokens (ctx %)       Flags
direct agent:benni:matr...i.zone  2m ago    MiniMax-M2.7   16k/205k (8%)        system
direct agent:benni:main           2m ago    MiniMax-M2.7   12k/205k (6%)        system
```

## Session-Dateien

```
~/.openclaw/agents/<agent>/sessions/
├── sessions.json           # Index aller Sessions (Metadaten)
├── <uuid-1>.jsonl          # Transcript Session 1 (JSONL)
└── <uuid-2>.jsonl          # Transcript Session 2 (JSONL)
```

- `sessions.json` — Index mit Session-Keys, Modell, Token-Verbrauch, Timestamps
- `*.jsonl` — Die eigentlichen Konversationen (ein JSON-Objekt pro Zeile/Turn)

## Session-Keys

Jede Session hat einen deterministischen Key basierend auf Channel + Peer:

| Channel | Key-Format | Beispiel |
|---------|------------|----------|
| Matrix DM | `agent:<id>:matrix:direct:@user:server` | `agent:benni:matrix:direct:@benni:matrix.benni.zone` |
| WhatsApp DM | `agent:<id>:whatsapp:direct:+49...` | `agent:benni:whatsapp:direct:+491797388189` |
| CLI/Main | `agent:<id>:main` | `agent:benni:main` |

Konfiguriert ueber `session.dmScope` in `openclaw.json` (Standard: `per-channel-peer`).

## Sessions loeschen

Es gibt kein `openclaw sessions delete` Command. Sessions manuell loeschen:

```bash
# Alle Sessions eines Agents loeschen:
rm ~/.openclaw/agents/<agent>/sessions/*.jsonl
rm ~/.openclaw/agents/<agent>/sessions/sessions.json

# Danach Gateway neustarten:
systemctl --user restart openclaw-gateway
```

**Wann Sessions loeschen?**
- Nach Bootstrap-Interview-Reset (damit Agent frisch startet)
- Bei kaputtem Session-State
- Zum Debugging (Agent verhaelt sich komisch wegen alter History)

## Session Cleanup (automatisch)

```bash
# Maintenance manuell ausfuehren:
openclaw sessions cleanup --agent benni

# Vorschau ohne Aenderungen:
openclaw sessions cleanup --agent benni --dry-run

# Alle Agents:
openclaw sessions cleanup --all-agents

# Fehlende Transcript-Dateien aufraumen:
openclaw sessions cleanup --fix-missing
```

Cleanup entfernt Sessions nach konfigurierbaren Regeln (Alter, Anzahl, Budget).
Es loescht NICHT aktive Sessions.

## Session-Scope

Die `session.dmScope` Einstellung in `openclaw.json` bestimmt, wie Sessions
getrennt werden:

- `per-channel-peer` (Standard) — Jeder Channel + Peer bekommt eine eigene Session.
  D.h. Matrix-DM und WhatsApp-DM mit dem gleichen User sind zwei getrennte Sessions.
- Andere Modi: Siehe OpenClaw-Doku unter `/concepts/session-tool`
