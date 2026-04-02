# /onboard — Interaktiver OpenClaw Setup-Wizard

Du bist der Setup-Assistent fuer eine komplette OpenClaw Smart-Home-Installation.
Du begleitest den User Schritt fuer Schritt durch alle Phasen.

## Wichtige Regeln

- Fuehre NICHTS aus ohne vorherige Erklaerung was passiert
- Pruefe nach jedem Schritt ob er erfolgreich war
- Bei Fehlern: Diagnose, Loesung vorschlagen, nicht einfach weitermachen
- Dokumentiere Entscheidungen in DECISIONS.md
- Sprache: Deutsch
- **Nach jeder abgeschlossenen Phase:** `~/.openclaw-deploy-state.json` aktualisieren

## Fortschritts-Datei

Lies zuerst `~/.openclaw-deploy-state.json`. Wenn sie existiert, zeige dem User
den Fortschritt und frage ob er dort weitermachen will wo er aufgehoert hat.

Nach jeder abgeschlossenen Phase: Datei aktualisieren mit `"done": true` und Timestamp.
Interview-Antworten in `config`-Sektion speichern (statt separate .env-Datei).

Format: Siehe CLAUDE.md Abschnitt "Onboarding-Erkennung".

Am Ende: `"onboarding_complete": true` setzen.

## Pre-Flight Checks (VOR Phase 0 ausfuehren!)

Bevor das Interview beginnt, pruefe auf dem LXC ob alle Abhaengigkeiten da sind:

```bash
echo "=== Pre-Flight ===" \
  && command -v cmake > /dev/null && echo "[OK] cmake" || echo "[FAIL] cmake fehlt" \
  && command -v g++ > /dev/null && echo "[OK] g++" || echo "[FAIL] g++ fehlt" \
  && command -v pip3 > /dev/null && echo "[OK] pip3" || echo "[FAIL] pip3 fehlt" \
  && command -v ffmpeg > /dev/null && echo "[OK] ffmpeg" || echo "[FAIL] ffmpeg fehlt" \
  && command -v git > /dev/null && echo "[OK] git" || echo "[FAIL] git fehlt" \
  && node --version 2>/dev/null && echo "[OK] node" || echo "[FAIL] node fehlt" \
  && command -v huggingface-cli > /dev/null && echo "[OK] huggingface-cli" || echo "[FAIL] huggingface-cli fehlt" \
  && loginctl show-user openclaw 2>/dev/null | grep -q "Linger=yes" && echo "[OK] linger" || echo "[FAIL] linger nicht aktiv"
```

Falls etwas fehlt: `sudo bash setup/lxc/bootstrap.sh` ausfuehren.
Falls alles OK: Weiter mit Phase 0.

## Phase 0: Interview

Begruessung und Datensammlung. Frage nacheinander:

1. **GPU-Server IP:** "Wie lautet die IP deines GPU-Servers?"
2. **GPU-Server SSH-User:** "Welcher User hat sudo-Rechte auf dem GPU-Server?"
3. **Home Assistant URL:** "Unter welcher URL ist dein Home Assistant erreichbar? (z.B. https://haos.local:8123)"
4. **MiniMax API-Key:** "Hast du einen MiniMax API-Key? (Pflicht fuer das primaere LLM)"
5. **Channels:** "Welche Channels moechtest du nutzen? (WhatsApp, Matrix, Telegram, ...)"
6. **HA-Skill:** "Moechtest du den openclaw-homeassistant ClaWHub-Skill installieren? (34 Tools fuer HA-Steuerung direkt ueber OpenClaw). Wenn du nur die HA-Voice-Integration nutzt, brauchst du ihn nicht."
7. **Sonarr/Radarr:** "Hast du Sonarr/Radarr fuer Medienverwaltung? (optional)"
8. **Agents:** "Wie viele persoenliche Agents moechtest du? (Standard: 1 persoenlicher + 1 household)"
   - Fuer jeden Agent: Name erfragen
   - **WICHTIG - erklaere dem User:**
     "Der erste Agent wird als 'default' markiert. Das bedeutet: Alle Nachrichten, die keinem anderen Agent explizit zugeordnet sind, landen bei diesem Agent. Der Household-Agent braucht kein 'default', weil er immer explizit ueber die HA-Integration angesprochen wird."
   - Channel-Zuordnung pro Agent

Nach dem Interview:
- Alle Antworten in `~/.openclaw-deploy-state.json` speichern (config-Sektion)
- SSH-Key generieren falls keiner existiert: `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""`
- One-Liner ausgeben:
  ```
  ssh-copy-id -i ~/.ssh/id_ed25519.pub <USER>@<GPU_IP>
  ```
- User ausfuehren lassen, dann SSH-Verbindung testen
- **SSH-Patterns fuer spaeter merken:**
  - GPU-Server: `ssh <USER>@<GPU_IP>` (Standard-Port 22)
  - Home Assistant (HAOS): `ssh root@<HA_HOST> -p 22222` (SSH & Web Terminal Add-on noetig!)
  - Falls HA-Integration gewuenscht: SSH-Key auch auf HA kopieren:
    `ssh-copy-id -i ~/.ssh/id_ed25519.pub -p 22222 root@<HA_HOST>`
- Phase "interview" als done markieren

## Phase 1: GPU-Server Setup

Ueber SSH auf dem GPU-Server:
1. `setup/gpu-server/detect-nvidia.sh` — NVIDIA erkennen + Treiber
   - Das Script zeigt jetzt auch VRAM, Compute Capability und empfohlene ctx-size an.
   - **Ollama-Check:** Falls Ollama laeuft, wird eine Warnung angezeigt.
     Frage den User ob Ollama deaktiviert werden soll (belegt VRAM, kollidiert mit llama.cpp).
2. `setup/gpu-server/build-llama-cpp.sh` — llama.cpp mit CUDA bauen
   - Das Script erkennt automatisch die GPU-Architektur (Compute Capability)
     und setzt `GGML_CUDA_ARCHITECTURES` korrekt (z.B. 75 fuer Turing, 61 fuer Pascal).
   - **WICHTIG:** Ein Build fuer die falsche Architektur crasht! Pascal-Build (61) laeuft
     NICHT auf Turing (75) und umgekehrt.
3. `setup/gpu-server/download-models.sh` — Modelle laden
   - Das Script nutzt `huggingface-cli` fuer grosse Downloads.
   - Falls `huggingface-cli` auf dem GPU-Server nicht installiert ist:
     `ssh <USER>@<GPU_IP> "pip3 install huggingface_hub[cli]"`

4. **GPU-Konfiguration mit User abstimmen** (VOR dem Service-Deploy!):
   a) **VRAM ermitteln:**
      `ssh <USER>@<GPU_IP> "nvidia-smi --query-gpu=memory.total,memory.free --format=csv,noheader"`
      Zeige dem User die verfuegbaren Werte.
   b) **Parallel-Modus:**
      Frage den User: "Soll der Chat-Server mit parallel=2 (2 gleichzeitige Anfragen,
      halber Context pro Slot) oder parallel=1 (maximaler Context, nur eine Anfrage
      gleichzeitig) laufen? parallel=2 ist empfohlen wenn mehrere Agents gleichzeitig
      anfragen koennten (z.B. HA + WhatsApp)."
   c) **Context-Size:**
      Frage den User: "Soll die maximale ctx-size ausgelotet werden oder der konservative
      Wert genutzt werden? Konservative Empfehlung: 32768 bei <=8GB VRAM, 196608 bei >8GB.
      Groesserer Context = mehr VRAM fuer den KV-Cache. KV-Cache q4_0 spart ~1.5GB vs F16
      und ist bereits aktiviert."
      Bei VRAM-knappen GPUs (<=8GB): Hinweis dass bei parallel=2 der Context pro Slot
      halbiert wird. Bei parallel=1 steht der volle Context zur Verfuegung.
   d) **Embedding-Entscheidung bei knappem VRAM:**
      Falls VRAM knapp (Modell + ctx + Embedding > verfuegbares VRAM): Empfehle dem User
      das Embedding auf den CPU-Fallback (LXC) auszulagern statt auf dem GPU-Server zu laufen.
   e) Passe die Werte in `llama-chat.service` basierend auf den User-Entscheidungen an
      BEVOR der Service deployed wird.

5. systemd Services deployen aus `setup/gpu-server/systemd/`
   - Pfade in den Templates an den tatsaechlichen User anpassen (GPUUSER ersetzen)
   - **Chat-Template:** Die Service-Unit nutzt `--jinja`, d.h. llama-server liest
     das Chat-Template direkt aus der GGUF-Datei. Kein separates Template-File noetig.
   - **threads-batch** wird dynamisch berechnet: `nproc - 2` (min. 2).
     threads=1 reicht fuer Inference (GPU), threads-batch fuer Prompt-Processing (CPU-parallel).
6. Services starten + Health-Check:
   - `curl http://<GPU_IP>:8080/health` (Chat)
   - `curl http://<GPU_IP>:8081/health` (Embedding)
   - **Erwartete Startzeiten:**
     - llama-chat (Qwen 9B, CUDA): 15-30 Sekunden
     - llama-embed (bge-m3, CUDA): 5-10 Sekunden
   - Falls Health-Check nach 60s fehlschlaegt:
     `ssh <USER>@<GPU_IP> "journalctl --user -u llama-chat -n 50"`
   - **User-Entscheidungen dokumentieren:** Die gewaehlten Werte fuer parallel und ctx-size
     in `~/.openclaw-deploy-state.json` unter `config` speichern (z.B. `"gpu_parallel": 2, "gpu_ctx_size": 32768`).
7. Phase "gpu_server" als done markieren

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
   - **Erwartete Startzeiten (LXC):**
     - Qdrant (Docker): 5-10 Sekunden
     - llama-embed-fallback (CPU bge-m3): 30-60 Sekunden (laedt 634MB Modell in RAM)
     - OpenClaw Gateway: 3-5 Sekunden
   - Falls ein Service nicht startet: `journalctl --user -u <service-name> -n 50`
7. Phase "lxc_setup" als done markieren

## Phase 3: Plugins

1. Plugins aus `plugins/` nach `~/.openclaw/extensions/` kopieren (ha-voice, memory-recall, sonarr-radarr)
2. Pro Plugin: `cd <plugin-dir> && npm install && npm run build`
3. Plugin-Configs in `openclaw.json` eintragen (URLs, Tokens aus Interview)
4. **Wenn User HA-Skill will:** `openclaw skills install homeassistant` (ClaWHub)
5. **Wenn User Sonarr/Radarr NICHT will:** Plugin nicht kopieren/aktivieren
6. `openclaw plugins doctor` ausfuehren
7. Gateway neustarten: `systemctl --user restart openclaw-gateway.service`
8. Phase "plugins" als done markieren

## Phase 4: Agents

1. Workspaces erstellen: `~/.openclaw/workspace-<name>/`
2. Fuer jeden persoenlichen Agent:
   - Templates kopieren (AGENTS.md, BOOTSTRAP.md, HEARTBEAT.md, TOOLS.md, MEMORY.md)
   - SOUL.md.template mit Platzhaltern fuellen:
     - `{{USER_NAME}}` = Name des Users (z.B. "Benni")
     - `{{PERSONALITY_DESCRIPTION}}` = "(Wird im Bootstrap-Interview mit dem User gemeinsam definiert)"
   - **WICHTIG — Agent-ID ist NICHT der Agent-Name!**
     Die Agent-ID (z.B. "benni") ist nur ein technischer Identifier fuer Routing.
     Der Agent bekommt seinen eigenen Namen erst im Bootstrap-Interview.
     IDENTITY.md muss `Name: (wird im Bootstrap definiert)` haben, NICHT den User-Namen!
   - USER.md mit User-Daten fuellen (Name, Timezone)
3. Household-Agent:
   - Feste SOUL.md aus `agents/household/SOUL.md` kopieren
   - AGENTS.md kopieren, BOOTSTRAP.md NICHT kopieren (kein Interview noetig)
4. `agents.list` in `openclaw.json` aktualisieren
5. **Default-Agent setzen** — erster persoenlicher Agent bekommt `"default": true`
6. Phase "agents" als done markieren

## Phase 5: Memory-System

1. Qdrant Collections anlegen — fuer JEDEN Agent eine eigene Collection:
   ```bash
   # Fuer jeden Agent (Namen aus dem Interview):
   for AGENT in <agent1> <agent2> household; do
     curl -X PUT "http://localhost:6333/collections/memories_${AGENT}" \
       -H "Content-Type: application/json" \
       -d '{
         "vectors": {
           "dense": { "size": 1024, "distance": "Cosine" }
         },
         "sparse_vectors": {
           "bm25": { "modifier": "idf" }
         }
       }'
     echo " → memories_${AGENT} erstellt"
   done
   ```
   **KRITISCH:** Dimension MUSS 1024 sein (bge-m3). NICHT 1536!
   Pruefen: `curl -s http://localhost:6333/collections | jq '.result.collections[].name'`
2. Extractor deployen:
   - `services/extractor/` nach `~/extractor/` kopieren
   - `npm install && npm run build`
   - `.env` aus Template generieren mit Interview-Daten
   - Agent-IDs konfigurieren (AGENT_IDS env var)
   - systemd Unit installieren + starten
3. Memory Write/Read Test:
   - Embedding-Anfrage an GPU-Server testen
   - Qdrant Insert + Search testen
4. Phase "memory" als done markieren

## Phase 6: Channels

Den User durch das Channel-Setup begleiten:
- **WhatsApp:** `openclaw channels setup whatsapp` — QR-Code scannen anleiten
- **Matrix (Conduit):** Komplette Anleitung in `docs/matrix-conduit-setup.md`. Kurzfassung:
  1. SSH auf Matrix-Server, Bot-User auf Conduit anlegen (Registration kurz oeffnen)
  2. `openclaw channels add --channel matrix --homeserver <URL> --access-token <TOKEN>`
  3. In `openclaw.json` manuell ergaenzen: `autoJoin`, `dm.policy`, `dm.allowFrom`
     (Achtung: Matrix nutzt verschachteltes `dm: {}`, NICHT top-level `dmPolicy`!)
  4. Binding mit `peer: { kind: "direct", id: "@user:server" }` hinzufuegen
  5. Gateway neustarten, DM starten, Invite manuell akzeptieren (Conduit auto-join bug)
- **Matrix (Synapse):** Gleiche OpenClaw-Config, aber User ueber Synapse Admin-API anlegen
- **Telegram:** BotFather-Anleitung
- Allowlists konfigurieren
- Test-Nachricht senden lassen
- Phase "channels" als done markieren

## Phase 7: HA-Integration (optional)

Falls der User Home Assistant hat:

1. **SSH-Zugang zu HA pruefen:**
   - HAOS nutzt SSH auf Port **22222** (nicht 22!) — braucht das "SSH & Web Terminal" Add-on
   - Test: `ssh -p 22222 root@<HA_HOST> "ha core info"`
   - Falls kein SSH: HA REST API mit Long-Lived Token als Fallback

2. **HA Backup erstellen (PFLICHT vor jedem Deploy!):**
   ```bash
   # Via SSH (bevorzugt):
   ssh -p 22222 root@<HA_HOST> "ha backups new --name pre-openclaw-$(date +%Y%m%d)"
   # Pruefen:
   ssh -p 22222 root@<HA_HOST> "ha backups list" | tail -5

   # Via REST API (Alternative):
   curl -X POST "https://<HA_URL>/api/services/backup/create" \
     -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json"
   ```

3. **Component vorbereiten:**
   - `services/home-llm/` Dateien pruefen
   - Python Syntax-Check: `python3 -m py_compile services/home-llm/custom_components/home_llm/conversation.py`

4. **Deploy (pycache loeschen ist WICHTIG!):**
   ```bash
   # pycache loeschen (sonst laedt HA gecachten alten Code!)
   find services/home-llm/custom_components/home_llm -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

   # Kopieren via SCP
   scp -P 22222 -r services/home-llm/custom_components/home_llm root@<HA_HOST>:/config/custom_components/
   ```
   **Alternativ:** Das Script `setup/lxc/deploy-home-llm.sh` macht Backup + Deploy + Restart automatisch:
   ```bash
   bash setup/lxc/deploy-home-llm.sh <HA_HOST> 22222 "$HA_TOKEN"
   ```

5. **HA Core neustarten:**
   ```bash
   # Via SSH:
   ssh -p 22222 root@<HA_HOST> "ha core restart"
   # Via API:
   curl -X POST "https://<HA_URL>/api/services/homeassistant/restart" \
     -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json"
   ```
   **Erwartete Dauer:** HA Core Restart dauert 30-90 Sekunden.

6. **Config Flow in HA UI durchlaufen:**
   Settings > Devices & Services > Add Integration > "Home LLM"
   Parameter:
   - LLM URL: `http://<GPU_IP>:8080`
   - Embed URL: `http://<GPU_IP>:8081`
   - Qdrant URL: `http://<LXC_IP>:6333`
   - OpenClaw URL: `http://<LXC_IP>:18789`
   - Agent ID: `household`
   - OpenClaw API Key: Gateway-Token aus `~/.openclaw/.env`

7. **Test:**
   ```bash
   curl -s "https://<HA_URL>/api/conversation/process" \
     -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
     -d '{"text":"Hallo","agent_id":"conversation.home_llm","language":"de"}'
   ```

8. Phase "ha_integration" als done markieren (oder `"skipped": true` wenn nicht gewuenscht)

## Phase 8: Abschluss

1. `openclaw.json` in Git committen (Config ist ab jetzt versioniert)
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
5. `"onboarding_complete": true` und Phase "verification" als done markieren
