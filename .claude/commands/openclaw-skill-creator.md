# /openclaw-skill-creator — Neue OpenClaw Skills erstellen

Du hilfst beim Erstellen neuer OpenClaw Plugins/Skills.
Du kennst das Plugin-SDK und die bestehenden Plugins als Referenz.

## Plugin-Grundstruktur

```
mein-plugin/
├── package.json
├── tsconfig.json
├── openclaw.plugin.json      # Manifest: Tools, Hooks, Config-Schema
├── src/
│   └── index.ts              # Einstieg: definePluginEntry()
├── SKILL.md                  # Beschreibung fuer den Agent
└── DECISIONS.md              # Architektur-Entscheidungen
```

## Minimales Beispiel

### package.json
```json
{
  "name": "openclaw-mein-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "jest"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### openclaw.plugin.json
```json
{
  "id": "openclaw-mein-plugin",
  "name": "Mein Plugin",
  "version": "0.1.0",
  "description": "Beschreibung",
  "entrypoint": "dist/index.js",
  "configSchema": {
    "type": "object",
    "properties": {
      "apiUrl": { "type": "string", "description": "API-URL" }
    },
    "required": ["apiUrl"]
  },
  "tools": [
    {
      "name": "mein_tool",
      "description": "Was das Tool macht",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Suchanfrage" }
        },
        "required": ["query"]
      }
    }
  ]
}
```

### src/index.ts
```typescript
import { definePluginEntry } from "openclaw/sdk";

export default definePluginEntry(({ config, logger }) => ({
  tools: {
    mein_tool: {
      execute: async ({ query }) => {
        logger.info("Tool aufgerufen", { query });
        const result = await fetch(`${config.apiUrl}/search?q=${query}`);
        const data = await result.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data) }]
        };
      }
    }
  }
}));
```

## Hooks (optional)

```typescript
hooks: {
  before_prompt_build: async ({ messages, agentId }) => {
    // System-Prompt erweitern
    return { systemPromptAppend: "Zusaetzlicher Kontext..." };
  },
  before_message_write: async ({ text }) => {
    // Antwort nachbearbeiten
    return { text: text.replace(/bad/g, "good") };
  }
}
```

## Wichtige Regeln

1. **TypeBox fuer Schemas** — Nicht manuell JSON-Schema schreiben
2. **Return-Format:** Immer `{ content: [{ type: "text", text: "..." }] }`
3. **Config aus openclaw.json:** Keine Hardcoded Werte im Code
4. **tools.profile MUSS "full" sein** — Andere Profile filtern Plugin-Tools
5. **plugins.allow:** Wenn gesetzt, muessen ALLE Plugins gelistet sein
6. **Testen:** `openclaw plugins doctor` nach jeder Aenderung

## Referenz-Plugins im Repo

- `plugins/openclaw-ha-voice/` — Hooks (before_prompt_build, before_message_write)
- `plugins/openclaw-memory-recall/` — Qdrant-Integration, Embedding
- `plugins/openclaw-sonarr-radarr/` — Mehrere Tools, REST-API
- `plugins/openclaw-homeassistant/` — 34 Tools, grosses Skill

## Workflow

1. User beschreibt gewuenschte Funktionalitaet
2. Plugin-Struktur erstellen
3. openclaw.plugin.json mit Tools/Hooks definieren
4. Code implementieren
5. `npm run build`
6. Plugin nach `~/.openclaw/extensions/` kopieren
7. Config in openclaw.json eintragen
8. `openclaw plugins doctor`
9. Gateway neustarten
10. Testen
