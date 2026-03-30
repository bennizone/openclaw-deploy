# Neue Skills erstellen

## Schnellstart

Nutze `/openclaw-skill-creator` in Claude Code fuer eine gefuehrte Erstellung.

## Manuell

### 1. Verzeichnis erstellen

```bash
mkdir -p ~/.openclaw/extensions/mein-skill
cd ~/.openclaw/extensions/mein-skill
npm init -y
npm install -D typescript
```

### 2. Dateien

- `openclaw.plugin.json` — Manifest mit Tools und Config-Schema
- `src/index.ts` — Einstiegspunkt mit `definePluginEntry()`
- `tsconfig.json` — TypeScript-Config (target: ES2022, module: NodeNext)

### 3. Bauen + Testen

```bash
npm run build
openclaw plugins doctor
systemctl --user restart openclaw-gateway
```

### 4. Config eintragen

In `openclaw.json` unter `plugins.entries`:
```json
{
  "mein-skill": {
    "enabled": true,
    "config": { ... }
  }
}
```

## Referenz-Plugins

Die 4 Plugins im `plugins/` Verzeichnis dienen als Beispiele:

| Plugin | Besonderheit |
|--------|-------------|
| openclaw-ha-voice | Hooks (before_prompt_build, before_message_write) |
| openclaw-memory-recall | Qdrant-Integration, Embedding-Abfragen |
| openclaw-sonarr-radarr | REST-API Calls, mehrere Tools |
| openclaw-homeassistant | 34 Tools, grosses Skill, Safety Guards |

## SDK-Dokumentation

Offizielle Docs: `~/.npm-global/lib/node_modules/openclaw/docs/plugins/`

Wichtige Dateien:
- `building-plugins.md` — Getting Started
- `sdk-overview.md` — API-Uebersicht
- `sdk-entrypoints.md` — Entry Points
- `manifest.md` — openclaw.plugin.json Schema
