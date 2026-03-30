# Bekannte Probleme

## Qdrant / Memory

| Problem | Ursache | Loesung |
|---------|---------|---------|
| Memory-Recall liefert leere Ergebnisse | Falsche Vektor-Dimension (1536 statt 1024) | Collection loeschen und mit 1024 neu anlegen |
| Qdrant JS-Client Fehler | Client 1.13.0 inkompatibel mit Qdrant >= 1.14 | Client-Version pruefen: `npm ls @qdrant/js-client-rest` |
| ETIMEDOUT bei mem0 Telemetry | mem0 versucht Telemetrie-Server zu erreichen | Nicht fatal, ignorieren |
| `dimension` wird ignoriert | Falsche Position in Config | Muss in `vectorStore.config` stehen, nicht auf `oss`-Ebene |

## OpenClaw Gateway

| Problem | Ursache | Loesung |
|---------|---------|---------|
| Gateway startet nicht nach Reboot | `loginctl enable-linger` fehlt | `loginctl enable-linger openclaw` als root |
| Config zerschossen | Agent hat openclaw.json veraendert | `chmod 444 ~/.openclaw/openclaw.json` setzen |
| Plugin-Tools nicht sichtbar | `tools.profile` ist nicht "full" | In openclaw.json: `"tools": { "profile": "full" }` |
| Plugins nicht geladen | `plugins.allow` gesetzt ohne alle Plugins | Entweder alle listen oder `plugins.allow` entfernen |
| Gateway Port belegt | Alter Prozess laeuft noch | `systemctl --user stop openclaw-gateway && sleep 2 && systemctl --user start openclaw-gateway` |

## LLM / Modelle

| Problem | Ursache | Loesung |
|---------|---------|---------|
| Chinesische Zeichen in Antwort | MiniMax M2.7 CJK Language Bleeding | openclaw-ha-voice Plugin mit CJK-Sanitizer nutzen |
| Qwen denkt endlos / langsam | Thinking-Mode aktiv | `enable_thinking: false` in chat_template_kwargs |
| GPU VRAM voll | Zu grosser Context oder zu viele parallele Slots | Context-Window oder --parallel reduzieren, KV-Cache Q4_0 nutzen |
| Embedding-Abfrage fehlschlaegt | GPU-Server nicht erreichbar | CPU-Fallback pruefen: `curl http://localhost:8081/health` |

## Hooks

| Problem | Ursache | Loesung |
|---------|---------|---------|
| before_dispatch feuert nicht | Hook feuert NUR fuer chatCompletions | Fuer WhatsApp: before_model_resolve oder before_prompt_build nutzen |
| Doppelte Memory-Injection | Hook feuert mehrmals | Idempotenz-Check im Hook implementieren |

## Node / npm

| Problem | Ursache | Loesung |
|---------|---------|---------|
| `openclaw: command not found` | PATH nicht korrekt | `export PATH="$HOME/.npm-global/bin:$PATH"` in .bashrc |
| Node-Version zu alt | fnm/nvm nicht richtig konfiguriert | `fnm install 24 && fnm default 24` |
