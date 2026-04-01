# OpenClaw-Skills

## Zweck

OpenClaw Plugins mit Hook-System: Erweitern den Gateway um STT/TTS, Smart-Home-Routing,
CJK-Sanitizer und weitere Funktionen. Aktuell ein Haupt-Plugin (ha-voice),
Memory-Recall ist separat unter memory-system dokumentiert.

## Architektur

```
Aktive Plugins:

1. openclaw-ha-voice (Voice + Smart Home Routing)
   plugins/openclaw-ha-voice/
   ├── src/
   │   ├── index.ts              # Plugin Entry, Hook-Registrierung
   │   ├── config.ts             # Config-Validierung
   │   ├── ha-client.ts          # HA STT/TTS API Client
   │   ├── ha-context.ts         # Entity+Area Loader
   │   ├── smart-home-router.ts  # 3-Way Routing (READ/CONTROL/OTHER)
   │   ├── ffmpeg.ts             # MP3→OGG/Opus Konvertierung
   │   └── sanitize.ts           # CJK Sanitizer (MiniMax Language Bleeding)
   ├── openclaw.plugin.json      # Plugin-Manifest + Config-Schema
   ├── package.json              # v0.1.0
   └── DECISIONS.md

2. openclaw-memory-recall → siehe memory-system Komponente

3. openclaw-sonarr-radarr → durch Tool-Hub MCP ersetzt (deprecated)

Plugin-System:
~/.openclaw/extensions/          # Installierte Plugins
openclaw.json → plugins.entries  # Plugin-Aktivierung + Config
openclaw.json → plugins.slots    # Slot-Overrides
```

### Features des ha-voice Plugins

| Feature | Hook | Beschreibung |
|---------|------|-------------|
| STT | MediaUnderstandingProvider | WhatsApp Voice → HA Cloud STT → Text |
| TTS | before_message_write | Text → HA Cloud TTS → OGG/Opus → WhatsApp Voice |
| TTS-ready Prompt | before_agent_start | Fliesstext-Anweisung bei Voice-Sessions |
| CJK Sanitizer | before_message_write (SYNC) + before_prompt_build | MiniMax Language Bleeding fixen |
| Smart Home Routing | before_model_resolve | READ/CONTROL → Qwen via HA, OTHER → MiniMax |

### Smart Home 3-Way Routing

```
Nachricht → Classify (Qwen 3.5 9B via llama-server)
  → "READ" (Sensordaten)  → HA conversation.home_llm → Antwort
  → "CONTROL" (Geraete)   → HA conversation.home_llm → Antwort
  → "OTHER" (alles andere) → MiniMax M2.7 direkt
```

## Abhaengigkeiten

- **Braucht:**
  - **gateway** — Plugin-Host, Hook-System
  - **ha-integration** — HA API fuer STT/TTS/Routing (conversation.home_llm)
  - **gpu-server** — Qwen 3.5 9B fuer Routing-Klassifikation
  - Home Assistant Cloud — STT + TTS Provider
  - ffmpeg — MP3→OGG Konvertierung fuer WhatsApp
- **Wird gebraucht von:**
  - **gateway** — Plugins laufen im Gateway-Prozess
  - **ha-integration** — Smart Home Routing leitet an HA weiter

## Schnittstellen

- **Eingabe:**
  - Gateway Hook-Events (before_prompt_build, before_model_resolve, before_message_write, before_agent_start)
  - WhatsApp Voice Messages (OGG/Opus)
  - HA API (STT/TTS/Conversation)
- **Ausgabe:**
  - Modifizierte Prompts (TTS-ready, sanitized)
  - Voice Notes (OGG/Opus via WhatsApp)
  - Routing-Entscheidung (welches LLM)

## Konfiguration

In `openclaw.json` → `plugins.entries.openclaw-ha-voice`:
```json
{
  "url": "${HA_URL}",
  "token": "${HA_LONG_LIVED_TOKEN}",
  "sttProvider": "stt.home_assistant_cloud",
  "ttsEngine": "tts.home_assistant_cloud",
  "language": "de-DE",
  "ttsVoice": "KatjaNeural"
}
```

Zusaetzlich:
- `models.providers.ha-cloud-stt` — Dummy-Provider fuer requireApiKey()
- `tools.media.audio` — STT-Konfiguration (enabled, language, echoTranscript)

## Bekannte Einschraenkungen

- **Bootstrap-Anweisungen MUESSEN in SOUL.md** — MiniMax ignoriert spaeter injizierte Dateien
- **before_dispatch feuert NICHT fuer chatCompletions** — Routing muss via before_model_resolve
- **message_sent feuert NICHT fuer WhatsApp** — TTS via before_message_write
- **~3.5-5.5s OpenClaw-Overhead** bei Smart Home Routing — nicht beeinflussbar
- **OOM moeglich** bei ffmpeg auf kleinem LXC — MP3→OGG Konvertierung

## Neues Feature hinzufuegen

### Neues Plugin erstellen
1. `mkdir -p plugins/mein-plugin/src/`
2. `openclaw.plugin.json` mit Manifest + Config-Schema
3. `src/index.ts` mit `definePluginEntry()` + Hooks
4. `npm run build`
5. In `openclaw.json` → `plugins.entries` aktivieren
6. `openclaw plugins doctor` — muss fehlerfrei
7. `systemctl --user restart openclaw-gateway`

### Neuen Hook im ha-voice Plugin
1. Hook in `src/index.ts` registrieren
2. Implementierung in separater Datei
3. `npm run build`
4. `systemctl --user restart openclaw-gateway`
5. Test via WhatsApp oder chatCompletions API

Siehe auch: `docs/creating-skills.md` und `/openclaw-skill-creator` Slash-Command.
