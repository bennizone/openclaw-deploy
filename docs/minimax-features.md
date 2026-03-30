# MiniMax Features: Web Search + Image Understanding

Diese Features sind KEIN separates Plugin — sie kommen mit MiniMax bzw. OpenClaw Core.

## Web Search (MiniMax MCP Server)

### Was es ist
Ein MCP-Server der MiniMax's Coding-Plan-API fuer Web-Suche nutzt.
Gibt dem Agent ein `web_search` Tool.

### Einrichtung

1. **uvx installieren** (falls nicht vorhanden):
   ```bash
   pip install uvx
   # oder: pipx install uvx
   ```

2. **In openclaw.json unter `mcp.servers`:**
   ```json
   {
     "mcp": {
       "servers": {
         "minimax-search": {
           "command": "/home/openclaw/.local/bin/uvx",
           "args": ["minimax-coding-plan-mcp"],
           "env": {
             "MINIMAX_API_KEY": "${MINIMAX_API_KEY}",
             "MINIMAX_API_HOST": "https://api.minimax.io"
           }
         }
       }
     }
   }
   ```

3. **Gateway neustarten**

### Haeufige Probleme

| Problem | Ursache | Loesung |
|---------|---------|---------|
| `web_search` Tool nicht verfuegbar | uvx nicht installiert oder Pfad falsch | `which uvx` pruefen, vollen Pfad in Config |
| MCP-Server startet nicht | MINIMAX_API_KEY fehlt oder ungueltig | Key in `~/.openclaw/.env` pruefen |
| Timeout bei Suche | MiniMax API langsam oder Rate-Limited | Retry, ggf. Coding-Plan-Limits pruefen |
| `command not found: uvx` | uvx nicht im PATH des systemd-Services | Vollen Pfad verwenden: `/home/openclaw/.local/bin/uvx` |

### Wichtig
- Der MCP-Server nutzt den **gleichen** MiniMax API-Key wie das LLM
- Braucht einen MiniMax Coding Plan (nicht nur API-Key)
- `uvx` muss mit vollem Pfad angegeben werden (systemd hat reduzierten PATH)
- **Offizielle MCP-Anleitung:** https://platform.minimax.io/docs/token-plan/mcp-guide

## Image Understanding (Built-in)

### Was es ist
OpenClaw kann eingehende Bilder (WhatsApp-Fotos, etc.) vor dem LLM-Call
zusammenfassen. Das ist Core-Funktionalitaet, kein Plugin.

### Einrichtung

Ist bereits in der Config aktiviert wenn `tools.media` konfiguriert ist:

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "language": "de-DE",
        "echoTranscript": true,
        "echoFormat": "🎤 \"{transcript}\"",
        "models": [
          { "provider": "ha-cloud-stt" }
        ]
      }
    }
  }
}
```

### Wie es funktioniert

1. User schickt Bild via WhatsApp
2. OpenClaw erkennt den Medientyp
3. Falls das aktive Modell Vision unterstuetzt (MiniMax M2.7 tut das):
   - Bild wird direkt ans Modell weitergegeben
4. Falls nicht: Fallback auf Media-Understanding-Provider (falls konfiguriert)
5. Antwort basiert auf Bild-Inhalt

### MiniMax M2.7 Vision-Support

MiniMax M2.7 versteht Bilder nativ — es braucht keinen separaten
Image-Understanding-Provider. Einfach ein Bild senden und der Agent
kann es beschreiben/analysieren.

### Haeufige Probleme

| Problem | Ursache | Loesung |
|---------|---------|---------|
| Bild wird ignoriert | `tools.media` nicht konfiguriert | media-Block in openclaw.json pruefen |
| "Ich kann keine Bilder sehen" | Modell hat kein Vision-Support | MiniMax M2.7 nutzen (hat Vision) |
| Bild zu gross | mediaMaxMb ueberschritten | `channels.whatsapp.mediaMaxMb` erhoehen (Default: 50) |
| Audio-Transkript falsch | Falscher STT-Provider | `sttProvider` in ha-voice Config pruefen |

## Config-Template Referenz

Beide Features sind im `config/openclaw.template.json` bereits vorkonfiguriert:
- Web Search: `mcp.servers.minimax-search`
- Media/Audio: `tools.media.audio`

Beim Onboarding werden sie automatisch mit eingerichtet wenn der User
einen MiniMax API-Key angibt.
