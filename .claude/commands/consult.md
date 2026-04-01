# /consult — Komponenten-Agent befragen

Befrage einen einzelnen Komponenten-Agent via MiniMax (chatCompletions API).
Der Agent bekommt sein Wissen (description.md + decisions.md) als System-Prompt
und beantwortet deine Frage aus seiner Perspektive.

## Ablauf

1. **Komponente identifizieren:** Welcher Agent soll befragt werden?
   Verfuegbare Komponenten: `components/*/description.md`
2. **Wissen laden:** Lies `components/<name>/description.md` und `components/<name>/decisions.md`
3. **System-Prompt bauen:** Kombiniere description.md + decisions.md zu einem System-Prompt
4. **Anfrage senden:**

```bash
TOKEN=$(jq -r '.gateway.auth.token' ~/.openclaw/openclaw.json 2>/dev/null)

curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"openclaw/default\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"<description.md + decisions.md Inhalt>\"},
      {\"role\": \"user\", \"content\": \"<Die Frage>\"}
    ]
  }"
```

5. **Antwort auswerten:** Ergebnis dem User oder Orchestrator zurueckgeben

## Verwendung

- Wird vom Orchestrator automatisch aufgerufen bei Planungs-Konsultationen
- Kann vom User direkt aufgerufen werden: `/consult`
- Der User gibt an welche Komponente befragt werden soll und was die Frage ist

## Hinweise

- Die Qualitaet der Antwort haengt von der Qualitaet der description.md ab
- Bei unklaren Antworten: description.md ueberpruefen und ggf. verbessern
- Konsultation ersetzt NICHT die Implementierung — sie informiert den Plan
