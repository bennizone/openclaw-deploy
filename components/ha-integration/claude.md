# Agent-Scope: HA-Integration

## Meine Dateien

```
services/home-llm/
└── custom_components/home_llm/
    ├── __init__.py          # HA Component Setup
    ├── conversation.py      # Conversation Agent (Hauptlogik)
    ├── config_flow.py       # HA Config Flow (UI)
    ├── const.py             # Konstanten
    ├── manifest.json        # HA Component Manifest
    └── strings.json         # UI Strings

services/home-llm/
└── DECISIONS.md             # Lokale Entscheidungen
```

## Meine Verantwortung

- Python Custom Component fuer Home Assistant
- Conversation Agent Logik (System-Prompt, LLM-Call, Response-Handling)
- Memory-Recall Integration (Qdrant, bge-m3 Embeddings)
- OpenClaw-Delegation via "OPENCLAW:" Prefix
- Conversation Buffer Management
- Exposed Entities + Area-Context im Prompt
- Tageszeit-Kontext (sun.sun Entity)
- Anti-Halluzinations-Prompt

## Build & Deploy

```bash
# Syntax-Check (IMMER vor Deploy!)
cd ~/openclaw-deploy/services/home-llm/
python3 -m py_compile custom_components/home_llm/conversation.py

# WICHTIG: HA-Backup VOR Restart!
# Deploy nach HA
scp -r custom_components/home_llm root@<HA_URL>:/config/custom_components/

# HA Restart
curl -s -X POST "https://<HA_URL>/api/services/homeassistant/restart" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json"

# Test
curl -s "https://<HA_URL>/api/conversation/process" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  -d '{"text": "Test", "agent_id": "conversation.home_llm", "language": "de"}'
```

Kein npm build — Python wird direkt von HA geladen.

## Pflichten nach jeder Aenderung

- description.md aktuell halten bei neuen Features oder Config-Optionen
- testinstruct.md aktualisieren bei neuen Test-Szenarien
- decisions.md fuehren bei Architekturentscheidungen
- **IMMER HA-Backup vor Restart** — Feedback-Lektion, nie ueberspringen

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| HA-Voice Plugin (before_prompt_build, CJK-Sanitizer) | **openclaw-skills** |
| Gateway-Config (chatCompletions API) | **gateway** |
| Qwen 3.5 9B Modell, llama-server | **gpu-server** |
| Qdrant Container + Collections | **memory-system** |
| Memory-Recall Plugin (Gateway-seitig) | **memory-system** |
| Tool-Hub MCP-Server | **tool-hub** |
