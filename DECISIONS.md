# DECISIONS.md — OpenClaw Deploy

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
- **WhatsApp uebersprungen** — Handy erst abends verfuegbar, wird nachgeholt.
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
