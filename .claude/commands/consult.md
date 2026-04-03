# /consult — Komponenten-Agent befragen

Befrage einen einzelnen Komponenten-Agent via Claude Code SDK (MiniMax M2.7).
Der Agent bekommt sein Wissen (description.md + decisions.md) als System-Prompt
und beantwortet deine Frage aus seiner Perspektive.

## Ablauf

1. **Komponente identifizieren:** Welcher Agent soll befragt werden?
   Verfuegbare Komponenten: `components/*/description.md`
2. **Anfrage senden** via Helper-Script:

```bash
# Nur description.md als Kontext:
node scripts/consult-sdk.mjs --component <komponente> --question "<frage>"

# Mit decisions.md als zusaetzlichem Kontext:
node scripts/consult-sdk.mjs --component <komponente> --question "<frage>" --with-decisions
```

Das Script (`scripts/consult-sdk.mjs`) uebernimmt automatisch:
- MINIMAX_API_KEY aus `~/.openclaw/.env` lesen
- `description.md` (+ optional `decisions.md`) als System-Prompt laden
- Antwort-Text extrahieren

3. **Antwort auswerten:** Ergebnis dem User oder Orchestrator zurueckgeben

## Verwendung

- Wird vom Orchestrator automatisch aufgerufen bei Planungs-Konsultationen
- Kann vom User direkt aufgerufen werden: `/consult`
- Der User gibt an welche Komponente befragt werden soll und was die Frage ist

## Hinweise

- Die Qualitaet der Antwort haengt von der Qualitaet der description.md ab
- Bei unklaren Antworten: description.md ueberpruefen und ggf. verbessern
- Konsultation ersetzt NICHT die Implementierung — sie informiert den Plan
