# systemd Linger

## Das Problem

Systemd User-Services (wie openclaw-gateway, openclaw-extractor, llama-embed-fallback) laufen nur, solange der User eingeloggt ist. Nach einem Reboot oder Logout stoppen alle Services.

## Die Loesung

```bash
# Als root:
loginctl enable-linger openclaw
```

## Pruefen

```bash
loginctl show-user openclaw | grep Linger
# Erwartete Ausgabe: Linger=yes
```

## Warum ist das kritisch?

Ohne Linger:
- Server-Reboot → Kein OpenClaw
- SSH-Session beenden → Kein OpenClaw
- User abmelden → Kein OpenClaw

Mit Linger:
- Services starten automatisch beim Boot
- Unabhaengig vom Login-Status
- Wie ein "normaler" systemd Service

## Wann setzen?

Im Bootstrap-Script (`setup/lxc/bootstrap.sh`) — VOR dem OpenClaw-Onboarding.
