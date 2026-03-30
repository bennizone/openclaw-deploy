# openclaw-ha-voice — Architektur & Entscheidungsdokumentation

## Überblick

Globales OpenClaw-Plugin für:
1. **Voice Messages** — STT/TTS für WhatsApp Sprachnachrichten
2. **CJK Sanitizer** — Chinesische Zeichen aus MiniMax-Antworten entfernen
3. **Smart Home Routing** — Tier-2/3-System für HA Assist

---

## 1. Voice Messages (STT/TTS)

### STT (Sprache → Text)
- **Provider:** HA Cloud (`stt.home_assistant_cloud`)
- **API:** `POST /api/stt/stt.home_assistant_cloud` mit `X-Speech-Content` Header
- **Format:** WhatsApp sendet OGG/Opus → HA akzeptiert das direkt, keine Konvertierung nötig
- **Integration:** Registriert als `MediaUnderstandingProvider` (id: `ha-cloud-stt`)
- **Workaround:** Dummy `models.providers.ha-cloud-stt` mit `apiKey: "ha-voice-internal"` nötig, weil OpenClaw `requireApiKey()` aufruft bevor der Provider angesprochen wird

### TTS (Text → Sprache)
- **Provider:** HA Cloud (`tts.home_assistant_cloud`), Stimme: `KatjaNeural`, Sprache: `de-DE`
- **API:** `POST /api/tts_get_url` → bekommt URL → `GET /api/tts_proxy/{token}.mp3`
- **Konvertierung:** ffmpeg MP3 → OGG/Opus (WhatsApp braucht OGG/Opus mit `ptt: true` für Voice Notes)
- **Speicherung:** `api.runtime.channel.media.saveMediaBuffer()` — MUSS verwendet werden, `/tmp/` ist nicht erlaubt (media path security)

### Voice-Flow
```
WhatsApp Voice → OGG/Opus → HA Cloud STT → Transcript
  → Agent verarbeitet als Text
  → Text-Antwort an User
  → TTS: Text → HA Cloud → MP3 → ffmpeg → OGG/Opus → WhatsApp Voice Note
```

### Hooks für Voice
- `before_dispatch` — trackt Voice-Sessions (nur WhatsApp, feuert NICHT für chatCompletions)
- `before_agent_start` — injiziert TTS-ready Prompt bei Voice-Sessions (Fließtext, keine Emojis)
- `agent_end` — generiert TTS und sendet Voice Note zurück

---

## 2. CJK Sanitizer

### Problem
MiniMax (chinesisches LLM) hat "Language Bleeding" — mischt chinesische Zeichen in deutsche Antworten.
Dokumentiert: https://github.com/MiniMax-AI/MiniMax-01/issues/28

### Lösung (2 Ebenen)
1. **Prompt:** `before_prompt_build` hängt an: "Niemals chinesische Zeichen"
2. **Post-Processing:** `before_message_write` (SYNC!) ersetzt chinesische Ziffern → arabisch, strippt restliche CJK

### Sanitize-Logik (`src/sanitize.ts`)
- Chinesische Ziffern (零一二三四五六七八九十百千) → 0-9
- CJK Unicode Ranges: U+2E80-U+2EFF, U+3000-U+303F, U+3400-U+4DBF, U+4E00-U+9FFF, U+F900-U+FAFF, U+FF01-U+FF60

---

## 3. Smart Home Routing (Tier 2/3)

### Architektur (aktueller Stand)
```
HA Assist → OpenClaw chatCompletions → before_model_resolve Hook
  ↓
Classify via Ollama (~250ms, num_predict: 5)
  ├── READ    → HA Conversation API (conversation.ministral_3_3b) → Antwort → Ollama Echo
  ├── CONTROL → HA Conversation API (mit conversation_id Kontext) → Antwort → Ollama Echo
  └── OTHER   → MiniMax direkt (Tier 3)
```

### Performance-Messungen (2026-03-27)

| Ansatz | Dauer | Details |
|--------|-------|---------|
| Unser Routing READ | ~7.9s | Classify 350ms + HA 3s + Overhead 3.5s + Echo 0.3s |
| Unser Routing CONTROL | ~6.6s | Classify 300ms + HA 2s + Overhead 3.5s + Echo 0.3s |
| MiniMax + Entity-Kontext | ~7.5s | Overhead 5.5s + MiniMax 2s |
| MiniMax OHNE Kontext (Tool-Calls) | **58.7s** | 54 Tool-Calls, falsche Areas |
| MiniMax OTHER (Smalltalk) | ~6.0s | Overhead 5.5s + MiniMax 0.5s |
| HA native Ministral direkt | ~2.2s | Kein OpenClaw-Overhead |

### Konstanter OpenClaw-Overhead (~3.5-5.5s)
- Plugin 8x registrieren: ~1.2s (einmal pro Agent, nicht gecacht für workspace plugins)
- MCP minimax-search init: ~0.8s (bei jedem Request)
- Tool profile loading: ~0.1s
- Prompt build: ~0.1s
- **Nicht beeinflussbar** — OpenClaw-Architektur

### Erkenntnisse
1. `before_dispatch` feuert NICHT für chatCompletions (HA Assist Pfad)
2. `before_model_resolve` + `before_prompt_build` feuern für ALLES
3. `before_model_resolve` kann NICHT short-circuiten (`handled: true` gibt es nicht)
4. HA Conversation API (`/api/conversation/process`) unterstützt `conversation_id` für Kontexterhalt
5. HA Session-Keys von HA Assist: UUID ohne Agent-Name → `channelId === "webchat"` als Erkennung
6. Bei curl-Tests: jeder Request neue Session → kein Kontext. Über HA Assist: gleiche Session → Kontext bleibt

### Offene Optimierungsmöglichkeit
**Ansatz "Fake Ollama":** Benni hat gute Erfahrungen mit einer Fake-Ollama-Schnittstelle gemacht — in HA Ollama eingebunden, zeigt auf einen eigenen Endpunkt der Tier-2→Tier-3 regelt. Vorteil: umgeht den OpenClaw-Overhead komplett für Tier 2, da HA direkt mit dem Fake-Ollama spricht. Nur Tier 3 (Nicht-Smart-Home) geht durch OpenClaw.

---

## 4. Konfiguration

### openclaw.json Änderungen
```json
{
  "models.providers.ha-cloud-stt": {
    "baseUrl": "https://<HA_URL>",
    "apiKey": "ha-voice-internal",  // Dummy für requireApiKey()
    "models": []
  },
  "tools.media.audio": {
    "enabled": true,
    "language": "de-DE",
    "echoTranscript": true,
    "echoFormat": "🎤 \"{transcript}\"",
    "models": [{ "provider": "ha-cloud-stt" }]
  },
  "plugins.entries.openclaw-ha-voice": {
    "enabled": true,
    "config": {
      "url": "https://<HA_URL>",
      "token": "<HA_LONG_LIVED_TOKEN>",
      "sttProvider": "stt.home_assistant_cloud",
      "ttsEngine": "tts.home_assistant_cloud",
      "language": "de-DE",
      "ttsVoice": "KatjaNeural",
      "routingEnabled": true,
      "routingModel": "ministral-3-32k:3b",
      "ollamaUrl": "http://<GPU_SERVER_IP>:11434",
      "haConversationAgent": "conversation.ministral_3_3b"
    }
  }
}
```

### HA Einstellungen
- `select.openclaw_assistant_active_model` muss auf `openclaw/household` stehen
- HA Conversation Agents verfügbar: `conversation.ministral_3_3b`, `conversation.minimax_m2_5`, `conversation.lfm2`
- Ollama Server: `http://<GPU_SERVER_IP>:11434` mit `ministral-3-32k:3b` (3.8B Q4_K_M) + `bge-m3` (Embeddings)

### Plugin-Dateien
```
~/.openclaw/extensions/openclaw-ha-voice/
├── src/
│   ├── index.ts          — Plugin Entry, alle Hooks
│   ├── config.ts         — Config-Validation
│   ├── ha-client.ts      — HA STT/TTS API Client
│   ├── ha-context.ts     — Entity+Area Loader (Jinja2 Template)
│   ├── smart-home-router.ts — Classify + HA Conversation API
│   ├── ffmpeg.ts         — MP3→OGG/Opus Konvertierung
│   └── sanitize.ts       — CJK Sanitizer
├── openclaw.plugin.json  — Plugin Manifest + Config Schema
├── package.json
└── tsconfig.json
```

### Git
```
~/.openclaw/.git/  (4 Commits)
- Baseline: ha-voice plugin before routing
- Tier-2 routing via before_model_resolve
- 3-way routing: READ/CONTROL/OTHER
- Fix webchat channel matching
```

---

## 5. Reproduktion für andere (z.B. Kumpel)

### Voraussetzungen
- OpenClaw v2026.3.24+ auf Debian/Ubuntu LXC
- Home Assistant mit Nabucasa Cloud (STT/TTS)
- Ollama Server mit ministral-3-32k:3b + bge-m3
- ffmpeg installiert
- WhatsApp verbunden in OpenClaw

### Schritte
1. Plugin-Verzeichnis anlegen: `~/.openclaw/extensions/openclaw-ha-voice/`
2. Source-Dateien kopieren, `npm install`, `npx tsc`
3. `openclaw.json` erweitern (models.providers, tools.media.audio, plugins.entries)
4. Gateway restarten: `systemctl --user restart openclaw-gateway.service`
5. HA: `select.openclaw_assistant_active_model` auf `openclaw/household` setzen
6. Testen: Sprachnachricht an WhatsApp, "Wie warm ist es im Wohnzimmer?" über HA Assist

### Anpassbare Parameter
- `routingModel` — Ollama-Modell wechseln (z.B. `qwen3.5:4b`)
- `ttsVoice` — Azure Neural Voice (z.B. `ConradNeural` für männlich)
- `haConversationAgent` — anderer HA Conversation Agent
- `language` — Sprache für STT/TTS
