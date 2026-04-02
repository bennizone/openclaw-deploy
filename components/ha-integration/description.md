# HA-Integration

## Zweck

Verbindet Home Assistant mit dem OpenClaw-System ueber eine Custom Component ("home-llm").
Stellt einen Conversation Agent fuer die HA Assist Pipeline bereit, der Qwen 3.5 9B
als LLM nutzt, Memory-Recall aus Qdrant hat, und komplexe Anfragen an den OpenClaw
Gateway delegiert.

## Architektur

```
services/home-llm/
└── custom_components/home_llm/
    ├── __init__.py          # HA Component Setup
    ├── conversation.py      # Conversation Agent (Hauptlogik)
    ├── config_flow.py       # HA Config Flow (UI-Konfiguration)
    ├── const.py             # Konstanten
    ├── manifest.json        # HA Component Manifest
    └── strings.json         # UI Strings

Datenfluss:
User (Voice/Text) → HA Assist Pipeline → home_llm conversation.py
  → Qdrant Memory Recall (memories_household, top_k=3)
  → System-Prompt bauen:
    ├── Tageszeit (sun.sun Entity → Tag/Daemmerung/Nacht)
    ├── Exposed Entities + Areas (HA API)
    ├── Memory-Facts (Qdrant)
    ├── Persona
    └── Regeln (Format, Daten, Geraetesteuerung, OPENCLAW-Delegation)
  → Qwen 3.5 9B via llama-server (GPU:8080)
  → Response-Check: "OPENCLAW:" Prefix?
    → Ja: HTTP POST an OpenClaw chatCompletions → Antwort zurueck
    → Nein: Direkte Antwort
  → Conversation Buffer (20 Messages, 15min Retention)
  → IntentResponse → TTS → User
```

- **Sprache:** Python (HA Custom Component)
- **LLM:** Qwen 3.5 9B via llama-server (OpenAI-kompatible API)
- **Kein Build-System** — Python wird direkt von HA geladen
- **Deployment:** scp nach HA `/config/custom_components/`

## Abhaengigkeiten

- **Braucht:**
  - **gpu-server** — Qwen 3.5 9B (Port 8080) als LLM, bge-m3 (Port 8081) fuer Embeddings
  - **gateway** — chatCompletions API fuer OpenClaw-Delegation (Port 18789)
  - **memory-system** — Qdrant (Port 6333) fuer Memory Recall (memories_household)
  - Home Assistant — Runtime-Umgebung, Assist Pipeline, Entity Registry
- **Wird gebraucht von:**
  - **gateway** — indirekt (HA-Voice Plugin in Gateway ergaenzt Routing)
  - **openclaw-skills** — HA-Voice Plugin nutzt HA-Daten

## Schnittstellen

- **Eingabe:**
  - HA Assist Pipeline: Text/Voice → `async_process(user_input)`
  - HA Entity Registry: Exposed Entities fuer System-Prompt
  - HA `sun.sun` Entity: Tageszeit-Kontext
- **Ausgabe:**
  - `IntentResponse` an HA (Speech-Text fuer TTS)
  - HTTP POST an OpenClaw bei "OPENCLAW:" Delegation
- **Config (HA UI):**

| Parameter | Default | Beschreibung |
|-----------|---------|-------------|
| llm_url | http://GPU_SERVER_IP:8080 | llama-server Endpoint |
| llm_model | Qwen3.5-9B-Q4_K_M | Model-Name |
| persona | (leer) | Zusaetzliche Persona-Anweisung |
| qdrant_url | http://LXC_IP:6333 | Qdrant Vector DB |
| embed_url | http://GPU_SERVER_IP:8081 | Embedding-Server |
| retention_minutes | 15 | Conversation Buffer Retention |
| top_k | 3 | Anzahl Memory-Facts |
| openclaw_url | http://LXC_IP:18789 | OpenClaw Gateway |
| openclaw_api_key | (Gateway-Token) | Auth fuer OpenClaw |

## Konfiguration

- **HA UI:** Settings > Devices & Services > Home LLM > Configure
- **Component-Manifest:** `manifest.json` (Version, Dependencies)
- **Gateway-Seitig:** `openclaw.json` → `plugins.entries.openclaw-ha-voice` fuer HA-Voice Plugin

## Bekannte Einschraenkungen

- **Kein Streaming** — Antworten komplett generiert vor TTS
- **Tool-Calling (~3s)** — Natives llama.cpp Tool-Calling via Assist API fuer Geraetesteuerung
- **max_tokens = 512** — Begrenzt Antwortlaenge (inkl. Tool-Call-Overhead)
- **OpenClaw-Delegation dauert ~7-13s** — MiniMax API + OpenClaw Overhead
- **Zwischenmeldung fehlt** — "Moment, ich schaue nach..." noch nicht implementiert
- **Thinking-Budget konfigurierbar** — Default 256 Tokens, 0 = deaktiviert. Bei Geraetesteuerung hilft Thinking bei relativen Befehlen
- **ZigBee-Delay nach HA-Restart** — Sensoren temporaer `unknown`

## Neues Feature hinzufuegen

1. `conversation.py` bearbeiten (Hauptlogik)
2. Syntax-Check: `python3 -m py_compile custom_components/home_llm/conversation.py`
3. Falls neue Config-Option: `config_flow.py` + `const.py` + `strings.json` anpassen
4. Deploy: `scp -r custom_components/home_llm root@<HA_URL>:/config/custom_components/`
5. **WICHTIG: HA-Backup VOR Restart erstellen!**
6. HA Restart ueber API oder UI
7. Test: HA Conversation API oder Voice Pipeline
