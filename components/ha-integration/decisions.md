# Entscheidungen: HA-Integration

## 2026-03-29 — Text-Prefix-Delegation statt Tool-Calling

**Kontext:** HA-Voice soll komplexe Anfragen (Web-Suche, Medien) an OpenClaw delegieren koennen.

**Entscheidung:** Qwen generiert "OPENCLAW: <query>" als Response-Prefix.
`async_process()` erkennt den Prefix und ruft OpenClaw chatCompletions auf.

**Alternativen verworfen:**
- Tool-Calling — wuerde Latenz erhoehen, Qwen bleibt simpler Chat-Agent ohne Tool-Loop

## 2026-03-29 — HA Exposed Entities API statt hardcoded Sensor-Liste

**Kontext:** System-Prompt braucht aktuelle Geraete- und Sensordaten.

**Entscheidung:** `async_should_expose("conversation", entity_id)` API nutzen.
Entities werden in HA UI unter Voice Assistants > Expose verwaltet.
Aenderungen wirken sofort ohne Code-Aenderung.

**Alternativen verworfen:**
- Hardcoded Liste — bricht bei Umbenennung/Entfernung von Entities

## 2026-03-29 — Anti-Halluzinations-Prompt

**Kontext:** Qwen 3.5 9B erfindet ueberzeugend falsche Sensorwerte wenn Daten fehlen.

**Entscheidung:** Explizite System-Prompt-Anweisung: "Sage ehrlich, dass du keinen
Zugriff hast" bei fehlenden Daten. Verbietet Erfinden von Werten.

**Alternativen verworfen:**
- Nur Kontext-Injection — reicht nicht, Qwen halluziniert trotzdem

## 2026-03-29 — enable_thinking: false PFLICHT

**Kontext:** Qwen 3.5 denkt standardmaessig sichtbar nach. In der Sprachausgabe
werden dann Thinking-Tokens vorgelesen.

**Entscheidung:** `enable_thinking: false` bei JEDEM LLM-Call mitsenden.

**Alternativen verworfen:**
- Thinking-Tokens nachtraeglich filtern — fragil, besser an der Quelle unterbinden

## 2026-03-29 — Rolling Conversation Buffer

**Kontext:** Multi-Turn-Gespraeche brauchen Kontext, aber HA hat kein Session-Management.

**Entscheidung:** In-Memory Buffer per conversation_id, max 20 Messages, 15min Retention.

**Alternativen verworfen:**
- Unbegrenzter Buffer — Memory-Leak bei vielen Konversationen
- Kein Buffer — kein Kontext in Folge-Fragen

## 2026-04-01 — X-OpenClaw-Scopes Header fuer Agent-Routing

**Kontext:** home-llm delegiert an OpenClaw, muss den Household-Agent adressieren.

**Entscheidung:** `X-OpenClaw-Scopes: agent:household` Header bei chatCompletions.
Model-String: `openclaw/household` (NICHT `current`).

**Alternativen verworfen:**
- Agent-ID im Model-String allein — kollidiert mit Model-Routing
