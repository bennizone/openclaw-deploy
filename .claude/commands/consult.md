# /consult — Komponenten-Agent befragen

Befrage einen einzelnen Komponenten-Agent via MiniMax (chatCompletions API).
Der Agent bekommt sein Wissen (description.md + decisions.md) als System-Prompt
und beantwortet deine Frage aus seiner Perspektive.

## Ablauf

1. **Komponente identifizieren:** Welcher Agent soll befragt werden?
   Verfuegbare Komponenten: `components/*/description.md`
2. **Anfrage senden** via Helper-Script:

```bash
# Nur description.md als Kontext:
scripts/consult-agent.sh <komponente> "<frage>"

# Mit decisions.md als zusaetzlichem Kontext:
scripts/consult-agent.sh <komponente> "<frage>" --with-decisions
```

Das Script (`scripts/consult-agent.sh`) uebernimmt automatisch:
- Token aus `~/.openclaw/.env` lesen
- `description.md` (+ optional `decisions.md`) als System-Prompt laden
- `X-OpenClaw-Scopes: operator.write` Header setzen
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
