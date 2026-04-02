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

## 2026-04-02 — Natives Tool-Calling via Assist API

**Kontext:** HA Intent-System versteht keine relativen Befehle ("mach es heller").
Text-basiertes Tool-Calling (`<tool_call>` Tags) scheiterte — Qwen ignorierte ICL-Beispiele
und antwortete auf Englisch mit "I cannot control devices".

**Entscheidung:** Natives llama.cpp Tool-Calling ueber OpenAI-kompatible API.
Assist API Tools via `llm.async_get_api("assist", ...)` holen,
Schemas via `voluptuous_openapi.convert()` konvertieren,
als `tools` Parameter im Chat-Completion-Request mitschicken.
~3s pro Tool-Call, korrekte Args (getestet: HassTurnOn, HassLightSet).

**Alternativen verworfen:**
- Text-basiertes `<tool_call>` Parsing — Modell nicht dafuer trainiert, unzuverlaessig
- HA `openai_compatible_conversation` — haette funktioniert, aber kein Memory/OPENCLAW
- Custom Sentences — nur fuer haeufige Muster, nicht fuer beliebige Befehle

## 2026-04-02 — Thinking-Budget konfigurierbar (Default 256)

**Kontext:** Bisher `enable_thinking: false` Pflicht. Tests zeigen: Tool-Calls
funktionieren mit und ohne Thinking identisch (~0.2s Unterschied).

**Entscheidung:** Thinking-Budget als Config-Option (Default 256, 0=deaktiviert).
Benchmark via `/bench` soll optimalen Wert ermitteln.

**Alternativen verworfen:**
- Immer aus — verliert Option fuer komplexere Berechnungen
- Immer an mit hohem Budget — unnoetige Latenz bei einfachen Befehlen

## 2026-03-29 — enable_thinking: false PFLICHT (VERALTET)

**Status:** Durch konfiguriertes Thinking-Budget ersetzt (siehe 2026-04-02).

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

## 2026-04-02 — System-Prompt Optimierung: Sektionen, OPENCLAW, Format

**Kontext:** Baseline-Bench zeigte 3 Schwaechen: OPENCLAW-Delegation nur 50% korrekt
(Websuche nicht delegiert, Paris faelschlich delegiert), Format-Regeln ignoriert
(°C, Markdown-Listen), kein Nachfragen bei mehrdeutigem Raum.

**Entscheidung:**
1. Prompt in Sektionen strukturiert (Format, Daten, Geraetesteuerung, OPENCLAW-Delegation)
   statt flacher Regelliste — besser parsebar fuer 9B-Modell
2. OPENCLAW: Antwort MUSS nur `OPENCLAW: <Anfrage>` sein, kein Text davor/danach.
   Explizite Delegationsfaelle: Oeffnungszeiten, Restaurants, Produktsuche, Nachrichten,
   Rezepte, Kalender, Medien-Bibliothek
3. Allgemeinwissen (Geografie, Geschichte, Mathe) explizit als "selbst beantworten"
4. Wetter NICHT in Delegationsliste — Wetter-Entitaeten im HA-Kontext verfuegbar
5. 1 ICL-Beispielpaar (Burgerking→delegieren, Paris→selbst). Bewusst nur eins:
   9B-Modelle fixieren sich bei mehreren Beispielen zu stark auf ICL-Pattern
6. Format verschaerft: Fliesstext, max 1-2 Saetze, "Grad" statt "°C", "Prozent" statt "%"
7. Nachfrage bei fehlender Raumangabe bei Geraetesteuerung

**Bench-Ergebnis:** Delegation 50%→100%, Format 0%→100%, Allgemeinwissen 0%→100%.
Edge-ambiguous bleibt 25% (Qwen delegiert Nachfrage faelschlich an OPENCLAW bei Budget 0+512).

**Alternativen verworfen:**
- Mehr ICL-Beispiele — Risiko dass 9B-Modell andere Kategorien verschlechtert
- Wetter als Delegationsfall — Entitaeten bereits im Kontext, unnoetige Latenz
- Drittes ICL-Beispiel fuer Mehrdeutigkeit — geparkt als TODO, erst beobachten

**Konsequenzen:** Benchmark-Template (ha-conversations.json) synchronisiert.
Edge-ambiguous bleibt offener TODO-Punkt.
