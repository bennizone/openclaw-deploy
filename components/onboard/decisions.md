# Entscheidungen: Onboard

## 2026-03-27 — Node 24 via fnm vor OpenClaw

**Kontext:** OpenClaw braucht Node.js >= 24. Reihenfolge der Installation ist kritisch.

**Entscheidung:** fnm (Fast Node Manager) installieren, Node 24 aktivieren, erst DANN
OpenClaw via npm installieren. Sonst findet npm kein Node oder nutzt falsche Version.

**Alternativen verworfen:**
- nvm — langsamer, fnm ist Rust-basiert
- System-Node via apt — veraltet, nicht Node 24

## 2026-03-27 — loginctl enable-linger als Pflicht

**Kontext:** systemd User-Services (Gateway, Extractor) muessen nach Reboot
automatisch starten, auch ohne Login.

**Entscheidung:** `loginctl enable-linger openclaw` im Bootstrap-Script.
Ohne Linger starten User-Services erst bei SSH-Login.

**Alternativen verworfen:**
- System-Services statt User-Services — braucht root, weniger isoliert

## 2026-03-30 — State-Datei statt .env fuer Interview-Daten

**Kontext:** Interview-Antworten muessen persistent gespeichert werden fuer
Wiederaufnahme nach Unterbrechung.

**Entscheidung:** `~/.openclaw-deploy-state.json` mit phases + config Sektionen.
JSON statt .env, weil strukturierte Daten (Listen, verschachtelte Objekte).

**Alternativen verworfen:**
- Separate .env-Datei — kann keine Listen/Objekte
- Nur in-memory — geht verloren bei Session-Ende

## 2026-03-30 — Interaktiver Wizard statt automatisches Script

**Kontext:** Setup erfordert viele User-spezifische Entscheidungen (IPs, Agents, Channels).

**Entscheidung:** Interaktiver Wizard via `/onboard` Slash-Command.
Erklaert jeden Schritt, wartet auf Bestaetigung, diagnostiziert Fehler.

**Alternativen verworfen:**
- Vollautomatisches Script — zu viele User-spezifische Parameter
- Config-File vorab ausfuellen — User muss System verstehen bevor er Config schreibt
