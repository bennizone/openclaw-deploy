# Agent-Scope: HA-Admin

## Meine Dateien

```
components/ha-admin/
├── description.md     # Architektur, Abhaengigkeiten, Schnittstellen
├── claude.md          # Dieser Scope-Guide
├── testinstruct.md    # Test-Anweisungen
└── decisions.md       # Architektur-Entscheidungen

.claude/commands/
└── ha-admin.md        # Slash-Command mit API-Referenz
```

Kein eigener Code im Repo. Spaeter evtl. Automation-Templates oder Scripts.

## Meine Verantwortung

- Home Assistant Automationen (erstellen, bearbeiten, loeschen, testen)
- Entity- und Device-Management (umbenennen, Areas zuweisen, aktivieren/deaktivieren)
- Area-Management (erstellen, umbenennen)
- HA Health-Checks (API erreichbar, Services laufen)
- HA Backups erstellen (IMMER vor destruktiven Aenderungen!)
- Troubleshooting (Error-Logs lesen, Entity-History pruefen)
- Optimierung (Automationen verbessern, ungenutzte Entities identifizieren)
- HA Restart/Reload koordinieren (mit Warnung)

## Build & Deploy

Kein Build. Alle Aenderungen werden direkt via HA REST API angewendet.

```bash
# HA-Token laden
source ~/.openclaw/.env || { echo "FEHLER: ~/.openclaw/.env nicht gefunden"; exit 1; }

# API-Test
curl -s "https://haos.home.benni.zone/api/" \
  -H "Authorization: Bearer $HA_TOKEN" | jq .message
# Erwartung: "API running."
```

## Pflichten bei jeder Aktion

1. **VOR destruktiven Aenderungen:** HA-Backup erstellen
   ```bash
   curl -s -X POST "https://haos.home.benni.zone/api/services/backup/create" \
     -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
     -d '{"name": "pre-change-backup"}'
   ```
2. **Loeschungen:** IMMER User-Bestaetigung einholen
3. **HA-Restart:** IMMER vorher warnen (unterbricht laufende Automationen)
4. **Dokumentation:** Entscheidungen in decisions.md festhalten

## Schutzliste (NICHT anfassen!)

Diese Entities und Settings braucht ha-integration fuer den Conversation Agent.
Ha-admin darf sie NICHT loeschen, umbenennen oder deaktivieren:

- **`sun.sun`** — Tageszeit-Kontext fuer System-Prompt
- **`zone.home`** — Home-Location Referenz
- **Assist Pipeline Config** — TTS/STT/Conversation-Agent Zuordnung
- **Exposed Entities** — Nicht ohne Absprache aendern (ha-integration baut Prompt daraus)
- **`conversation.home_llm`** — Der Conversation Agent selbst

Bei Unsicherheit: Erst `components/ha-integration/description.md` lesen.

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| home-llm Python Code (Conversation Agent) | **ha-integration** |
| HA-Voice Plugin (before_prompt_build, CJK) | **openclaw-skills** |
| Qwen/LLM auf GPU-Server | **gpu-server** |
| Gateway-Config (openclaw.json) | **gateway** |
| Exposed Entities fuer Voice | **ha-admin** (HA-seitig) + **ha-integration** (Prompt-seitig) |
| Automationen, Entities, Areas, Backups | **ha-admin** |
