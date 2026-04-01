# Neues Plugin/Skill erstellen: OpenClaw-Skills

## Vorbereitung

1. Bestehende Plugins als Vorlage lesen:
   - `plugins/openclaw-ha-voice/` (vollstaendiges Beispiel mit Hooks)
   - `docs/creating-skills.md` (Anleitung)
   - `/openclaw-skill-creator` Slash-Command fuer gefuehrte Erstellung
2. Verfuegbare Hooks kennen:
   - `before_prompt_build` — Prompt modifizieren (z.B. Context injizieren)
   - `before_model_resolve` — Modell-Routing aendern
   - `before_message_write` — Antwort modifizieren (z.B. Sanitizer)
   - `before_agent_start` — Session-Setup
   - `MediaUnderstandingProvider` — Audio/Bild-Verarbeitung

## Plugin-Struktur anlegen

3. `mkdir -p plugins/mein-plugin/src/`
4. `openclaw.plugin.json` erstellen:
   - Manifest mit `id`, `name`, `version`, `entry`
   - Config-Schema (TypeBox/JSON Schema) fuer Plugin-Einstellungen
5. `src/index.ts` mit `definePluginEntry()` + Hooks
6. `package.json` mit Dependencies

## Kritische Regel

7. **Bootstrap-Anweisungen MUESSEN in SOUL.md** — MiniMax ignoriert spaeter injizierte Dateien.
   Wenn das Plugin das Agent-Verhalten aendert, muss die Anweisung in SOUL.md stehen.

## Build & Validierung

8. `cd ~/openclaw-deploy/plugins/mein-plugin && npm run build`
9. `openclaw plugins doctor` — MUSS fehlerfrei sein!
   - Prueft Manifest, Entry, Config-Schema
   - Bei Fehler: Manifest und Pfade pruefen

## Aktivierung

10. In `openclaw.json` → `plugins.entries` aktivieren (mit Config)
    → Config-Aenderung: siehe `components/gateway/config-change-checklist.md`
11. Gateway neustarten (Plugin wird beim Start geladen)

## Dokumentation

12. `components/openclaw-skills/description.md` — Plugin in Architektur eintragen
13. `components/openclaw-skills/testinstruct.md` — Test-Cases hinzufuegen
14. `components/openclaw-skills/decisions.md` — Entscheidung dokumentieren
15. Version bumpen in `openclaw.plugin.json` + `package.json` bei jeder Aenderung

## Deploy

16. `XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart openclaw-gateway`
17. `curl -s http://localhost:18789/health`
18. Plugin-Loading pruefen: `XDG_RUNTIME_DIR=/run/user/$(id -u) journalctl --user -u openclaw-gateway -n 30 | grep -i plugin`
