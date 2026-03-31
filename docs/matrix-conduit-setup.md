# Matrix-Channel mit Conduit einrichten

Anleitung fuer die Anbindung von OpenClaw an einen bestehenden Conduit-Matrix-Server.
Conduit ist ein leichtgewichtiger Matrix-Homeserver (Rust, single binary) — NICHT Synapse.

## Voraussetzungen

- Laufender Conduit-Server (z.B. als Docker-Container)
- DNS + Reverse-Proxy konfiguriert (`.well-known/matrix/server` + `/client`)
- SSH-Zugang zum Matrix-Server (Root oder Docker-Zugriff)

## Schritt 1: Bot-User auf Conduit anlegen

Conduit hat **keine Admin-API** fuer User-Registrierung. Der Weg:
Registration kurz aktivieren, User anlegen, wieder deaktivieren.

### 1a. Registration temporaer aktivieren

```bash
# Auf dem Matrix-Server:
sed -i 's/allow_registration = false/allow_registration = true/' /opt/matrix/conduit.toml
docker restart conduit
sleep 2
```

### 1b. Bot-User registrieren

Conduit hat kein `curl`/`wget` im Container — Zugriff ueber die Container-IP vom Host:

```bash
# Container-IP ermitteln:
CONDUIT_IP=$(docker inspect conduit --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')

# Sicheres Passwort generieren:
BOT_PASSWORD=$(openssl rand -base64 24)
echo "Bot-Passwort: $BOT_PASSWORD"  # Merken!

# User registrieren:
curl -s -X POST "http://${CONDUIT_IP}:6167/_matrix/client/v3/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"openclaw\",
    \"password\": \"${BOT_PASSWORD}\",
    \"auth\": {\"type\": \"m.login.dummy\"},
    \"device_id\": \"OPENCLAW_GW\",
    \"initial_device_display_name\": \"OpenClaw Gateway\"
  }"
```

Antwort enthaelt `access_token`, `user_id`, `device_id` — **Token sichern!**

### 1c. Registration sofort wieder deaktivieren

```bash
sed -i 's/allow_registration = true/allow_registration = false/' /opt/matrix/conduit.toml
docker restart conduit
```

**Zeitfenster:** Nur wenige Sekunden offen. Trotzdem: nicht vergessen!

## Schritt 2: OpenClaw Matrix-Channel konfigurieren

### 2a. Channel hinzufuegen (CLI)

```bash
openclaw channels add \
  --channel matrix \
  --homeserver "https://matrix.example.org" \
  --access-token "<TOKEN_AUS_SCHRITT_1>" \
  --device-name "OpenClaw Gateway"
```

Das traegt den Channel automatisch in `openclaw.json` ein.

### 2b. DM-Policy und Auto-Join manuell ergaenzen

Die CLI setzt nur die Basis-Config. Folgendes muss in `openclaw.json` unter
`channels.matrix` ergaenzt werden:

```json
{
  "channels": {
    "matrix": {
      "enabled": true,
      "homeserver": "https://matrix.example.org",
      "accessToken": "<TOKEN>",
      "deviceName": "OpenClaw Gateway",
      "autoJoin": "allowlist",
      "dm": {
        "policy": "allowlist",
        "allowFrom": [
          "@dein-user:matrix.example.org"
        ]
      }
    }
  }
}
```

**Wichtig — Matrix nutzt ein anderes Schema als WhatsApp:**
- WhatsApp: `"dmPolicy"` und `"allowFrom"` als Top-Level-Keys
- Matrix: `"dm": { "policy": "...", "allowFrom": [...] }` (verschachtelt!)

### 2c. Agent-Binding fuer Matrix hinzufuegen

Damit eingehende DMs dem richtigen Agent zugeordnet werden,
muss ein Binding in der `bindings`-Liste stehen:

```json
{
  "bindings": [
    {
      "agentId": "dein-agent",
      "match": {
        "channel": "matrix",
        "peer": { "kind": "direct", "id": "@dein-user:matrix.example.org" }
      }
    }
  ]
}
```

**Achtung — Binding-Format:**
- NICHT `"from": "@user:server"` (schlaegt fehl mit "Invalid input")
- RICHTIG: `"peer": { "kind": "direct", "id": "@user:server" }`

## Schritt 3: Gateway neustarten + testen

```bash
# Config validieren:
jq . < ~/.openclaw/openclaw.json > /dev/null

# Gateway neustarten:
systemctl --user restart openclaw-gateway

# Health-Check:
curl -s http://localhost:18789/health

# Channel-Status pruefen:
openclaw channels status
# Erwartete Ausgabe: "Matrix default: enabled, configured, running"
```

## Schritt 4: Ersten DM-Raum aufsetzen

### Das Invite-Problem bei Conduit

Der Bot-User tritt DM-Raeumen **nicht automatisch bei**, auch wenn `autoJoin`
konfiguriert ist (Stand: OpenClaw 2026.3.28 + Conduit latest).

**Loesung:** Invite manuell akzeptieren.

1. Vom Matrix-Client (z.B. FluffyChat): Neuen Chat mit `@openclaw:matrix.example.org` starten
2. Der Client zeigt "eingeladen" — der Bot tritt aber nicht automatisch bei
3. Invite manuell akzeptieren (vom Matrix-Server aus):

```bash
CONDUIT_IP=$(docker inspect conduit --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
BOT_TOKEN="<ACCESS_TOKEN>"

# Pending Invites pruefen:
curl -s -H "Authorization: Bearer $BOT_TOKEN" \
  "http://${CONDUIT_IP}:6167/_matrix/client/v3/sync?timeout=0" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for room_id in d.get('rooms',{}).get('invite',{}):
    print(f'Invite: {room_id}')
"

# Raum beitreten (ROOM_ID aus dem vorherigen Befehl):
curl -s -X POST \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":""}' \
  "http://${CONDUIT_IP}:6167/_matrix/client/v3/rooms/<ROOM_ID>/join"
```

**Conduit-Eigenheit:** Der Join-Endpoint braucht zwingend ein JSON-Objekt
mit mindestens einem Feld (z.B. `{"reason":""}`). Ein leeres `{}` wird mit
`M_BAD_JSON` abgewiesen.

### Pruefen ob der Bot im Raum ist

```bash
curl -s -H "Authorization: Bearer $BOT_TOKEN" \
  "http://${CONDUIT_IP}:6167/_matrix/client/v3/joined_rooms"
```

Sobald der Raum in `joined_rooms` auftaucht, kann der Bot Nachrichten empfangen.
Ab dann funktioniert der Raum dauerhaft — diesen Schritt braucht man nur einmal pro DM.

## Schritt 5: User-Suche auf Conduit

Conduit listet Bot-User nicht automatisch im User-Directory.
Deshalb findet man `@openclaw:matrix.example.org` nicht ueber die Suche im Client.

**Workaround:** Im Client direkt die volle Matrix-ID eingeben
(`@openclaw:matrix.example.org`) statt die Suchfunktion zu nutzen.

## Bekannte Fallstricke

| Problem | Ursache | Loesung |
|---------|---------|---------|
| `bindings.X: Invalid input` | Falsches Binding-Format (`from` statt `peer`) | `"peer": { "kind": "direct", "id": "@user:server" }` |
| `channels.matrix: must NOT have additional properties` | WhatsApp-Style Keys (`dmPolicy`, `allowFrom`) | Matrix nutzt `"dm": { "policy": "...", "allowFrom": [...] }` |
| Bot antwortet nicht auf DM | Bot ist dem Raum nicht beigetreten | Invite manuell akzeptieren (siehe Schritt 4) |
| User nicht findbar im Client | Conduit listet Bot nicht im Directory | Volle Matrix-ID direkt eingeben |
| `M_BAD_JSON` beim Join | Conduit akzeptiert kein leeres `{}` | `{"reason":""}` als Body senden |
| `M_FORBIDDEN: Registration disabled` | Registration ist aus | Temporaer aktivieren (Schritt 1a) |
| `curl` nicht im Container | Conduit-Image ist minimal (kein curl/wget) | Vom Host ueber Container-IP zugreifen |

## Zusammenfassung: Was in openclaw.json geaendert wird

Gegenueber einer reinen WhatsApp-Installation kommen hinzu:

1. **`channels.matrix`** — Homeserver, Token, DM-Policy (verschachtelt!)
2. **`bindings[]`** — Neues Binding mit `peer`-Objekt
3. **`plugins.allow[]`** — `"matrix"` hinzufuegen (wird von `openclaw channels add` gemacht)
