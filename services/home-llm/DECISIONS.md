# Home LLM — Architektur-Entscheidungen & Feature-Dokumentation

## Feature-Liste

### 1. Conversation Agent (Basis)
**Status:** Aktiv seit 2026-03-29
- Qwen 3.5 9B (Q4_K_M) via llama-server auf GPU (10.83.1.110:8080)
- Deutsch, kurze natuerliche Antworten (Sprachausgabe, kein Markdown)
- `enable_thinking: false` — IMMER mitsenden (sonst denkt Qwen sichtbar nach)

### 2. Memory Recall (Qdrant)
**Status:** Aktiv seit 2026-03-29
- Semantic Search auf `memories_household` Collection
- bge-m3 Embeddings via GPU (10.83.1.110:8081)
- top_k=3, score_threshold=0.3
- Wird als "Bekannte Fakten ueber den Haushalt" in System-Prompt injiziert

### 3. Rolling Conversation Buffer
**Status:** Aktiv seit 2026-03-29
- Per conversation_id, max 20 Messages, 15min Retention
- Ermoeglicht Kontext-Erhalt in Multi-Turn-Gespraechen

### 4. Tageszeit-Kontext
**Status:** Aktiv seit 2026-03-29
- `sun.sun` Entity liefert Elevation
- Drei Stufen: Tag (>10°), Daemmerung (-6° bis 10°), Nacht (<-6°)
- Beeinflusst Licht-Empfehlungen im System-Prompt

### 5. OpenClaw-Intent-Delegation
**Status:** Aktiv seit 2026-03-29
- Qwen erkennt Anfragen jenseits Smart Home via System-Prompt
- Generiert `OPENCLAW: <query>` als Response-Prefix
- `async_process()` erkennt Prefix, ruft OpenClaw chatCompletions auf
- Endpoint: `http://10.83.1.13:18789/v1/chat/completions`
- Model: `openclaw/household` (NICHT `current` — OpenClaw erfordert dieses Format)
- Auth: Bearer Token (Gateway-Auth aus openclaw.json)
- Timeout: 60s (OpenClaw + MiniMax brauchen Zeit)

**Entscheidung:** Kein Tool-Calling, sondern Text-Prefix-Erkennung.
**Warum:** Qwen bleibt ein simpler Chat-Agent ohne Tool-Loop, kein zusaetzlicher
Overhead fuer Smart-Home-Anfragen. Tool-Calling wuerde Latenz erhoehen.

### 6. Exposed Entities Context
**Status:** Aktiv seit 2026-03-29
- Nutzt HA offizielle `async_should_expose("conversation", entity_id)` API
- Liest alle Entities die in HA unter Settings > Voice Assistants > Expose freigegeben sind
- Inkl. Area-Zuordnung (Entity → Device → Area Registry)
- Weather-Entities: Spezialbehandlung (Condition + Temperatur + Humidity aus Attributes)
- Wird als "Aktuelle Geraete- und Sensordaten" in System-Prompt injiziert

**Entscheidung:** HA exposed entities API statt hardcoded Sensor-Liste.
**Warum:** Benni verwaltet exponierte Entities in der HA UI. Aenderungen wirken sofort
ohne Code-Aenderung. Hardcoded Listen brechen wenn Entities umbenannt/entfernt werden.

### 7. Anti-Halluzinations-Prompt
**Status:** Aktiv seit 2026-03-29
- System-Prompt verbietet explizit das Erfinden von Sensorwerten
- "sage ehrlich, dass du darauf keinen Zugriff hast" bei fehlenden Daten

**Entscheidung:** Explizite Prompt-Anweisung statt nur Kontext-Injection.
**Warum:** Qwen 3.5 9B halluziniert sonst ueberzeugend falsche Sensordaten.
Ohne diese Anweisung erfindet es Temperaturen, Wetter und Geraete.

## Architektur

```
User (Voice PE) → HA Assist Pipeline → home_llm (conversation.py)
  → Qdrant Memory Recall (async)
  → System-Prompt bauen (Tageszeit + Entities + Memory + Persona + Regeln)
  → Qwen 3.5 9B via llama-server
  → Response-Check: Starts with "OPENCLAW:" ?
    → Ja: HTTP POST an OpenClaw → Antwort zurueck
    → Nein: Direkte Antwort
  → In Buffer speichern
  → IntentResponse → TTS → User
```

## Config (HA UI: Settings > Devices & Services > Home LLM > Configure)

| Parameter | Default | Beschreibung |
|-----------|---------|-------------|
| llm_url | http://10.83.1.110:8080 | llama-server Endpoint |
| llm_model | Qwen3.5-9B-Q4_K_M | Model-Name fuer llama-server |
| persona | (leer) | Zusaetzliche Persona-Anweisung |
| qdrant_url | http://10.83.1.13:6333 | Qdrant Vector DB |
| embed_url | http://10.83.1.110:8081 | Embedding-Server |
| retention_minutes | 15 | Conversation Buffer Retention |
| top_k | 3 | Anzahl Memory-Facts |
| openclaw_url | http://10.83.1.13:18789 | OpenClaw Gateway |
| openclaw_api_key | (Gateway-Token) | Auth fuer OpenClaw |

## Bekannte Einschraenkungen

1. **Kein Streaming**: Antworten werden komplett generiert bevor TTS startet
2. **ZigBee-Delay**: Nach HA-Restart sind ZigBee-Sensoren eine Weile `unknown`
3. **Kein Tool-Calling**: Qwen kann keine HA-Services aufrufen (Lichter schalten etc.)
   — das uebernimmt HA's eigenes Intent-System
4. **max_tokens=256**: Begrenzt Antwortlaenge, reicht fuer Sprachausgabe
5. **OpenClaw-Latenz**: Delegation dauert ~7-13s (MiniMax API + OpenClaw Overhead)
6. **Zwischenmeldung**: Noch nicht implementiert ("Moment, ich schaue nach...")

## Deployment

```bash
# Syntax-Check
cd ~/home_llm && python3 -m py_compile custom_components/home_llm/conversation.py

# Deploy
scp -r ~/home_llm/custom_components/home_llm root@haos.home.benni.zone:/config/custom_components/

# HA Restart (Backup vorher!)
curl -s -X POST "https://haos.home.benni.zone/api/services/homeassistant/restart" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json"

# Test
curl -s "https://haos.home.benni.zone/api/conversation/process" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Test","agent_id":"conversation.home_llm","language":"de"}'
```
