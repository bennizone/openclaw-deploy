# DECISIONS — OpenClaw Tool-Hub MCP

## 2026-03-31: PIM-Modul (Kalender + Kontakte) via CalDAV/CardDAV

**Kontext:** Agents sollen Kalender lesen/schreiben und Kontakte durchsuchen koennen — userspezifisch.
Benni nutzt Hetzner (CalDAV/CardDAV), Domi nutzt iCloud. Geteilter Familienkalender in iCloud.

**Entscheidung:**
- 9 neue Tools im bestehenden Tool-Hub: 5 Calendar + 4 Contacts
- `tsdav` als CalDAV/CardDAV-Client (TypeScript-nativ, iCloud-Discovery eingebaut)
- Config-driven Scoping via `pim.json`: Quellen definieren, pro Agent zuweisen mit `read`/`readwrite`
- Agent-Identifikation: Hybrid — `extra._meta.agentId` (zukunftssicher) + `agent_id` Parameter (funktioniert heute)
- Minimaler iCal/vCard-Parser statt voller Library — reicht fuer VEVENT/VCARD Standardfelder

**Alternativen verworfen:**
- Separate MCP-Instanzen pro Agent — mehr Prozesse, schwerer wartbar
- Full iCal-Parser (ical.js) — Overkill, eigener Lightweight-Parser genügt fuer unsere Felder
- Per-Agent ENV-Vars — Gateway startet nur einen MCP-Prozess, nicht konfigurierbar pro Agent

**Konsequenzen:**
- Agents koennen Termine und Kontakte verwalten, jeweils nur innerhalb ihrer Berechtigungen
- Household hat nur Lesezugriff auf Familienkalender, keine Kontakte
- Domi kann Bennis Kalender/Kontakte lesen (nicht schreiben) — und umgekehrt konfigurierbar
- Neue User/Quellen: nur `pim.json` + ENV-Vars erweitern, kein Code noetig
- iCloud-Quellen vorbereitet aber noch ohne Credentials (App-spezifische Passwoerter fehlen)
