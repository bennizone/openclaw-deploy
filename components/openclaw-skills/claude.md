# Agent-Scope: OpenClaw-Skills

## Meine Dateien

```
plugins/openclaw-ha-voice/
├── src/                          # Plugin Source-Code
│   ├── index.ts                  # Entry, Hook-Registrierung
│   ├── config.ts                 # Config-Validierung
│   ├── ha-client.ts              # HA STT/TTS Client
│   ├── ha-context.ts             # Entity+Area Loader
│   ├── smart-home-router.ts      # 3-Way Routing
│   ├── ffmpeg.ts                 # Audio-Konvertierung
│   └── sanitize.ts               # CJK Sanitizer
├── openclaw.plugin.json          # Manifest + Schema
├── ASSIST.md                     # Plugin-Hilfe
├── DECISIONS.md
└── package.json

docs/creating-skills.md           # Anleitung: Neues Plugin erstellen
```

## Meine Verantwortung

- OpenClaw Plugin-Entwicklung (Hooks, Manifest, Config-Schema)
- STT/TTS Integration via Home Assistant Cloud
- Smart Home 3-Way Routing (READ/CONTROL/OTHER)
- CJK Sanitizer (MiniMax Language Bleeding)
- Audio-Konvertierung (ffmpeg, OGG/Opus)
- Plugin-Dokumentation und Erstellungs-Anleitung

### Kritische Regel
- **Bootstrap-Anweisungen IN SOUL.md** — MiniMax ignoriert spaeter injizierte Dateien;
  kritische Anweisungen muessen in SOUL.md im Agent-Workspace stehen

## Build & Deploy

```bash
cd ~/openclaw-deploy/plugins/openclaw-ha-voice/
npm run build
openclaw plugins doctor              # Muss fehlerfrei!
systemctl --user restart openclaw-gateway
curl -s http://localhost:18789/health
```

## Pflichten nach jeder Aenderung

- description.md aktuell halten bei neuen Hooks oder Features
- testinstruct.md aktualisieren bei neuen Test-Szenarien
- decisions.md fuehren bei Plugin-Architektur-Entscheidungen
- `openclaw plugins doctor` MUSS fehlerfrei sein
- Version bumpen in `openclaw.plugin.json` + `package.json`

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| Gateway-Config (plugins.entries) | **gateway** |
| MCP-Tools (web_search, arr_*, calendar_*) | **tool-hub** |
| Memory-Recall Plugin | **memory-system** |
| HA Custom Component (home-llm) | **ha-integration** |
| GPU-Server (Qwen fuer Routing) | **gpu-server** |
| Agent SOUL.md Inhalte | **gateway** (Workspace-Verwaltung) |
