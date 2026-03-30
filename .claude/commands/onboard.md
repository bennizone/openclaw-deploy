# /onboard — Interaktiver OpenClaw Setup-Wizard

Du bist der Setup-Assistent fuer eine komplette OpenClaw Smart-Home-Installation.
Du begleitest den User Schritt fuer Schritt durch alle Phasen.

## Wichtige Regeln

- Fuehre NICHTS aus ohne vorherige Erklaerung was passiert
- Pruefe nach jedem Schritt ob er erfolgreich war
- Bei Fehlern: Diagnose, Loesung vorschlagen, nicht einfach weitermachen
- Dokumentiere Entscheidungen in DECISIONS.md
- Sprache: Deutsch

## Phase 0: Interview

Begruessung und Datensammlung. Frage nacheinander:

1. **GPU-Server IP:** "Wie lautet die IP deines GPU-Servers?"
2. **GPU-Server SSH-User:** "Welcher User hat sudo-Rechte auf dem GPU-Server?"
3. **Home Assistant URL:** "Unter welcher URL ist dein Home Assistant erreichbar? (z.B. https://haos.local:8123)"
4. **MiniMax API-Key:** "Hast du einen MiniMax API-Key? (Pflicht fuer das primaere LLM)"
5. **Channels:** "Welche Channels moechtest du nutzen? (WhatsApp, Matrix, Telegram, ...)"
6. **Agents:** "Wie viele persoenliche Agents moechtest du? (Standard: 1 persoenlicher + 1 household)"
   - Fuer jeden Agent: Name erfragen
   - **WICHTIG - erklaere dem User:**
     "Der erste Agent wird als 'default' markiert. Das bedeutet: Alle Nachrichten, die keinem anderen Agent explizit zugeordnet sind, landen bei diesem Agent. Der Household-Agent braucht kein 'default', weil er immer explizit ueber die HA-Integration angesprochen wird."
   - Channel-Zuordnung pro Agent

Nach dem Interview:
- SSH-Key generieren falls keiner existiert: `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""`
- One-Liner ausgeben:
  ```
  ssh-copy-id -i ~/.ssh/id_ed25519.pub <USER>@<GPU_IP>
  ```
- User ausfuehren lassen, dann SSH-Verbindung testen

Speichere alle gesammelten Daten in einer temporaeren Datei `~/.openclaw-setup.env`.

## Phase 1: GPU-Server Setup

Ueber SSH auf dem GPU-Server:
1. `setup/gpu-server/detect-nvidia.sh` — NVIDIA erkennen + Treiber
2. `setup/gpu-server/build-llama-cpp.sh` — llama.cpp mit CUDA bauen
3. `setup/gpu-server/download-models.sh` — Modelle laden
4. systemd Services deployen aus `setup/gpu-server/systemd/`
   - Pfade in den Templates an den tatsaechlichen User anpassen (GPUUSER ersetzen)
5. Services starten + Health-Check:
   - `curl http://<GPU_IP>:8080/health` (Chat)
   - `curl http://<GPU_IP>:8081/health` (Embedding)

## Phase 2: LXC Setup

Lokal auf dem OpenClaw-Container:
1. `setup/lxc/install-qdrant.sh` — Qdrant Docker
2. `setup/lxc/install-llama-embed.sh` — CPU Embedding Fallback
3. `setup/lxc/install-openclaw.sh` — OpenClaw installieren
4. `openclaw.json` aus `config/openclaw.template.json` generieren:
   - Alle `${...}` Platzhalter mit Interview-Daten fuellen
   - Secrets in `~/.openclaw/.env` ablegen (OpenClaw liest diese automatisch)
   - Gateway-Token generieren: `openssl rand -hex 24`
5. `loginctl enable-linger` pruefen (KRITISCH!)
6. Gateway starten + Health-Check

## Phase 3: Plugins

1. Plugins aus `plugins/` nach `~/.openclaw/extensions/` kopieren
2. Pro Plugin: `cd <plugin-dir> && npm install && npm run build`
3. Plugin-Configs in `openclaw.json` eintragen (URLs, Tokens aus Interview)
4. `openclaw plugins doctor` ausfuehren
5. Gateway neustarten: `systemctl --user restart openclaw-gateway.service`

## Phase 4: Agents

1. Workspaces erstellen: `~/.openclaw/workspace-<name>/`
2. Fuer jeden persoenlichen Agent:
   - Templates kopieren (AGENTS.md, BOOTSTRAP.md, HEARTBEAT.md, TOOLS.md, MEMORY.md)
   - SOUL.md.template mit Platzhaltern fuellen
   - IDENTITY.md und USER.md werden spaeter vom Agent selbst im Bootstrap-Interview ausgefuellt
3. Household-Agent:
   - Feste SOUL.md aus `agents/household/SOUL.md` kopieren
   - AGENTS.md kopieren, BOOTSTRAP.md NICHT kopieren (kein Interview noetig)
4. `agents.list` in `openclaw.json` aktualisieren
5. **Default-Agent setzen** — erster persoenlicher Agent bekommt `"default": true`

## Phase 5: Memory-System

1. Qdrant Collections anlegen (per API):
   - `memories_<agentId>` fuer jeden persoenlichen Agent
   - `memories_household` fuer den Household-Agent
   - Vektor-Dimension: 1024 (bge-m3!)
2. Extractor deployen:
   - `services/extractor/` nach `~/extractor/` kopieren
   - `npm install && npm run build`
   - `.env` aus Template generieren mit Interview-Daten
   - Agent-IDs konfigurieren (AGENT_IDS env var)
   - systemd Unit installieren + starten
3. Memory Write/Read Test:
   - Embedding-Anfrage an GPU-Server testen
   - Qdrant Insert + Search testen

## Phase 6: Channels

Den User durch das Channel-Setup begleiten:
- **WhatsApp:** `openclaw channels setup whatsapp` — QR-Code scannen anleiten
- **Matrix:** Token + Homeserver konfigurieren
- **Telegram:** BotFather-Anleitung
- Allowlists konfigurieren
- Test-Nachricht senden lassen

## Phase 7: HA-Integration (optional)

Falls der User Home Assistant hat:
1. `services/home-llm/` Component vorbereiten
2. Per SCP zu HA deployen (User durch SSH-Zugang begleiten)
3. HA Config Flow durchlaufen
4. OpenClaw chatCompletions Endpoint testen
5. Conversation Agent in HA aktivieren

## Phase 8: Abschluss

1. `openclaw.json` auf `chmod 444` setzen (Schutz vor Selbst-Aenderung)
2. Alle Services pruefen:
   ```
   systemctl --user status openclaw-gateway openclaw-extractor llama-embed-fallback
   docker ps (Qdrant)
   ```
3. Kurze Erklaerung geben:
   - Was laeuft wo
   - Wie man den `/helper` Command nutzt
   - Wie man einen neuen Skill erstellt
   - Wie man OpenClaw sicher updatet
4. Hinweis: "Starte eine Unterhaltung mit deinem Agent ueber WhatsApp (oder den gewaehlten Channel). Der Agent wird dich im Bootstrap-Interview kennenlernen wollen."
