# openclaw-ha-voice — Entscheidungen & Features

## Feature-Liste

### 1. STT (Speech-to-Text)
**Status:** Aktiv seit 2026-03-27
- WhatsApp Voice (.ogg) → HA Cloud STT → Text
- Provider: `stt.home_assistant_cloud`, Endpoint: `POST /api/stt/stt.home_assistant_cloud`
- OGG/Opus direkt akzeptiert, keine Konvertierung noetig
- Registriert als `MediaUnderstandingProvider` (id: `ha-cloud-stt`)

**Entscheidung:** HA Cloud statt lokalem Whisper
**Warum:** Schneller, genauer, keine GPU noetig. Whisper auf CPU zu langsam.

### 2. TTS (Text-to-Speech)
**Status:** Aktiv seit 2026-03-27
- Text → HA Cloud TTS → MP3 → ffmpeg → OGG/Opus → WhatsApp Voice Note
- Stimme: KatjaNeural (de-DE)
- Nur bei Antworten auf Sprachnachrichten
- Media-Speicherung via `api.runtime.channel.media.saveMediaBuffer()`

**Entscheidung:** HA Cloud TTS statt Piper lokal
**Warum:** KatjaNeural klingt natuerlicher als Piper-Stimmen.

**Entscheidung:** `/tmp/` nicht nutzen, nur `saveMediaBuffer()`
**Warum:** OpenClaw Media Path Security verhindert `/tmp/` Zugriff.

### 3. TTS-ready Prompt
**Status:** Aktiv seit 2026-03-27
- Bei Voice-Sessions: Fliesstext ohne Emojis/Markdown injiziert
- Hook: `before_agent_start`

### 4. CJK Sanitizer
**Status:** Aktiv seit 2026-03-27
- Hooks: `before_message_write` (SYNC!) + `before_prompt_build`
- Chinesische Ziffern → arabisch, restliche CJK gestripped
- Betrifft ALLE Agenten (benni, domi, household)

**Entscheidung:** Post-Processing statt nur Prompt-Anweisung
**Warum:** MiniMax ignoriert Prompt-Anweisungen teilweise. Doppelte Absicherung.

### 5. Smart Home 3-Way Routing
**Status:** Aktiv seit 2026-03-27
- READ/CONTROL → HA Home LLM (conversation.home_llm, Qwen 3.5 9B)
- OTHER → MiniMax M2.7
- Routing-Modell: Qwen 3.5 9B (gleicher llama-server)
- conversation_id Tracking fuer Kontexterhalt

**Entscheidung:** `before_model_resolve` Hook statt `before_dispatch`
**Warum:** `before_dispatch` feuert NICHT fuer chatCompletions (HA Assist Pfad).

## Architektur

```
src/
├── index.ts              — Plugin Entry, Hooks registrieren
├── config.ts             — Config-Validation
├── ha-client.ts          — HA STT/TTS API Client
├── ha-context.ts         — Entity+Area Loader (Jinja2 Template)
├── smart-home-router.ts  — Classify + HA Conversation API
├── ffmpeg.ts             — MP3→OGG/Opus Konvertierung
└── sanitize.ts           — CJK Sanitizer
```

## Config in openclaw.json

- `models.providers.ha-cloud-stt` — Dummy-Provider fuer `requireApiKey()`
- `tools.media.audio` — STT-Konfiguration
- `plugins.entries.openclaw-ha-voice` — URL, Token, Routing-Config

## Performance

| Pfad | Latenz | Details |
|------|--------|---------|
| Smart Home via Routing | ~7-8s | ~3.5-5.5s OpenClaw-Overhead + Classify + HA |
| HA nativ direkt | ~2.2s | Ohne OpenClaw |
| Smalltalk (MiniMax) | ~6s | OpenClaw-Overhead + MiniMax |

## Bekannte Einschraenkungen
- `before_dispatch` feuert NICHT fuer chatCompletions
- `message_sent` feuert NICHT fuer WhatsApp
- ~3.5-5.5s OpenClaw-Overhead nicht beeinflussbar
- OOM moeglich bei ffmpeg auf kleinem LXC
- HA Cloud TTS deprecated voice warning — Plugin nutzt bereits neues API-Format
