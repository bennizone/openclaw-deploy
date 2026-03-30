# /openclaw-skill-creator — Neue OpenClaw Skills erstellen

Du hilfst beim Erstellen neuer OpenClaw Plugins/Skills.
Du kennst das Plugin-SDK, die API-Signaturen und die bestehenden Plugins als Referenz.

## Plugin-Grundstruktur

```
mein-plugin/
├── package.json
├── tsconfig.json
├── openclaw.plugin.json      # Manifest: Tools, Hooks, Config-Schema (PFLICHT)
├── src/
│   └── index.ts              # Einstieg: definePluginEntry()
├── SKILL.md                  # Beschreibung fuer den Agent
└── DECISIONS.md              # Architektur-Entscheidungen
```

## Schritt-fuer-Schritt Erstellung

### 1. package.json

```json
{
  "name": "openclaw-mein-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "openclaw": {
    "extensions": ["./src/index.ts"]
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### 2. openclaw.plugin.json (PFLICHT — auch bei leerer Config)

```json
{
  "id": "openclaw-mein-plugin",
  "name": "Mein Plugin",
  "version": "0.1.0",
  "description": "Beschreibung",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiUrl": {
        "type": "string",
        "description": "API-URL"
      }
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

### 3. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true
  },
  "include": ["src"]
}
```

### 4. src/index.ts — Entry Point

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "mein-plugin",
  name: "Mein Plugin",
  description: "Kurzbeschreibung",

  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      apiUrl: { type: "string" }
    },
    required: ["apiUrl"]
  },

  register(api) {
    const cfg = api.pluginConfig as { apiUrl: string };
    const log = api.logger;

    // Tool registrieren
    api.registerTool({
      name: "mein_tool",
      description: "Was das Tool macht",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Suchanfrage" }
        },
        required: ["query"]
      },
      async execute(_id, params) {
        log.info("Tool aufgerufen", { query: params.query });
        const result = await fetch(`${cfg.apiUrl}/search?q=${encodeURIComponent(params.query)}`);
        const data = await result.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        };
      }
    });
  }
});
```

## Hooks

Hooks ermoeglichen es, den Nachrichtenfluss zu beeinflussen OHNE eigene Tools.

```typescript
register(api) {
  // System-Prompt erweitern (z.B. Memory-Injection)
  api.registerHook(["before_prompt_build"], async (event) => {
    return { systemPromptAppend: "Zusaetzlicher Kontext..." };
  }, { priority: 100 });

  // Antwort nachbearbeiten (z.B. CJK-Sanitizer)
  api.registerHook(["before_message_write"], async (event) => {
    const text = (event as any).text || "";
    return { text: text.replace(/[\u4e00-\u9fff]/g, "") };
  });

  // Tool-Call abfangen
  api.registerHook(["before_tool_call"], (event) => {
    // { block: true } = Terminal, stoppt alle weiteren Handler
    // { block: false } = KEIN Override, wird als "keine Entscheidung" behandelt
    // Nur true-Werte sind terminal!
    if (isDangerous(event)) return { block: true };
  });
}
```

### Hook-Reihenfolge im Nachrichtenfluss

1. `before_dispatch` — NUR chatCompletions, NICHT WhatsApp
2. `before_model_resolve` — Modell-Auswahl beeinflussen
3. `before_prompt_build` — System-Prompt erweitern (Memory-Injection hier)
4. `before_tool_call` — Tool-Aufrufe abfangen/blockieren
5. `before_message_write` — Antwort nachbearbeiten (CJK-Sanitizer hier)
6. `message_sending` — `{ cancel: true }` = Terminal

**WICHTIG:** `{ cancel: false }` und `{ block: false }` sind KEIN Override — nur `true` ist terminal!

## API-Objekt (verfuegbar in register())

```typescript
api.id                      // Plugin-ID
api.pluginConfig            // Plugin-spezifische Config aus openclaw.json
api.config                  // Gesamte OpenClaw-Config
api.logger                  // Logger mit debug/info/warn/error
api.rootDir                 // Plugin-Verzeichnis
api.runtime                 // Runtime-Helpers (TTS, Search, Subagent, ...)
api.registrationMode        // "full" | "setup-only" | "setup-runtime"
api.resolvePath(input)      // Pfad relativ zum Plugin-Root aufloesen
```

## Was man alles registrieren kann

| Methode | Registriert |
|---------|------------|
| `api.registerTool(tool, opts?)` | Agent-Tool |
| `api.registerHook(events, handler, opts?)` | Event-Hook |
| `api.registerCommand(def)` | Custom Command (umgeht LLM) |
| `api.registerHttpRoute(params)` | Gateway HTTP-Endpoint |
| `api.registerService(service)` | Background Service |
| `api.registerProvider(...)` | LLM-Provider |
| `api.registerChannel(...)` | Messaging-Channel |
| `api.registerSpeechProvider(...)` | TTS/STT |

## Import-Konventionen (WICHTIG!)

IMMER fokussierte Subpaths verwenden, NIE den monolithischen Root-Import:

```typescript
// RICHTIG:
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

// FALSCH (wird vom Linter abgelehnt):
import { definePluginEntry } from "openclaw/plugin-sdk";
```

## Debugging

```bash
# Plugin pruefen
openclaw plugins list                    # Alle Plugins auflisten
openclaw plugins inspect <id>            # Details eines Plugins
openclaw plugins doctor                  # Gesundheitscheck aller Plugins

# Logs anschauen
journalctl --user -u openclaw-gateway -f  # Live Gateway Logs
# In Logs nach Plugin-ID filtern

# Haeufige Fehler:
# - "Tool not found" → tools.profile muss "full" sein
# - Plugin nicht geladen → openclaw plugins doctor
# - Config-Fehler → openclaw.plugin.json configSchema pruefen
```

## Testen

```typescript
import { describe, it, expect, vi } from "vitest";

describe("mein-plugin", () => {
  it("should execute tool", async () => {
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ results: [] })
    });

    const tool = myPlugin.tools.mein_tool;
    const result = await tool.execute("test-id", { query: "test" });

    expect(result.content[0].text).toContain("results");
  });
});
```

## Referenz-Plugins im Repo

| Plugin | Zeigt | Pfad |
|--------|-------|------|
| openclaw-ha-voice | Hooks (before_prompt_build, before_message_write), CJK-Sanitizer | `plugins/openclaw-ha-voice/` |
| openclaw-memory-recall | Qdrant-Integration, Embedding-Abfragen, Hybrid-Search | `plugins/openclaw-memory-recall/` |
| openclaw-sonarr-radarr | Mehrere Tools, REST-API Calls, Config-Validation | `plugins/openclaw-sonarr-radarr/` |

## SDK-Dokumentation (Offline-Referenz)

Offizielle Docs: `~/.npm-global/lib/node_modules/openclaw/docs/plugins/`
- `building-plugins.md` — Getting Started
- `sdk-overview.md` — API-Uebersicht
- `sdk-entrypoints.md` — Entry Points + Signaturen
- `sdk-testing.md` — Test-Utilities + Mocking
- `manifest.md` — openclaw.plugin.json Schema

## Workflow

1. User beschreibt gewuenschte Funktionalitaet
2. Plugin-Struktur erstellen (alle 4 Dateien)
3. Code implementieren
4. `npm run build` — muss fehlerfrei sein
5. Plugin nach `~/.openclaw/extensions/` kopieren
6. Config in openclaw.json eintragen (Backup vorher!)
7. `openclaw plugins doctor` — muss fehlerfrei sein
8. `systemctl --user restart openclaw-gateway`
9. Testen via WhatsApp oder chatCompletions
