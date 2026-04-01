# /plan-review — Konsultationsrunde an betroffene Agenten

Fuehrt eine Konsultationsrunde durch: Alle betroffenen Komponenten-Agenten
werden via MiniMax befragt, ob ein geplantes Feature/Aenderung aus ihrer
Perspektive machbar ist und was beachtet werden muss.

## Ablauf

1. **Betroffene Komponenten identifizieren:**
   - Lies den Plan/die Aufgabe
   - Lies `components/*/description.md` (Abhaengigkeiten-Sektion)
   - Bestimme welche Komponenten direkt oder indirekt betroffen sind

2. **Frage formulieren:**
   Fuer jede betroffene Komponente eine spezifische Frage:
   - Was aendert sich in deinem Bereich?
   - Welche Einschraenkungen gibt es?
   - Welche Abhaengigkeiten sind betroffen?
   - Was muss getestet werden?

3. **Konsultationsrunde durchfuehren:**
   Fuer jede betroffene Komponente `/consult` ausfuehren:

```bash
TOKEN=$(jq -r '.gateway.auth.token' ~/.openclaw/openclaw.json 2>/dev/null)

# Pro Komponente:
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"openclaw/default\",
    \"messages\": [
      {\"role\": \"system\", \"content\": \"<description.md + decisions.md der Komponente>\"},
      {\"role\": \"user\", \"content\": \"Geplante Aenderung: <Beschreibung>. Was muss in deinem Bereich beachtet werden? Gibt es Einschraenkungen oder Konflikte?\"}
    ]
  }"
```

4. **Ergebnis konsolidieren:**
   - Antworten aller Agenten zusammenfassen
   - Konflikte identifizieren (Agent A sagt X, Agent B sagt Y)
   - Fehlende Informationen markieren
   - Konsolidiertes Ergebnis dem User praesentieren

## Ergebnis-Format

```
Plan-Review: <Feature/Aenderung>

Befragte Komponenten:
  [tool-hub] Machbar, neue Datei src/tools/<name>.ts noetig
  [gateway] Config-Eintrag noetig fuer neuen Provider
  [memory-system] Nicht betroffen

Konflikte: Keine

Offene Fragen:
  - Braucht das neue Tool einen API-Key? (→ .env)

Empfehlung: Freigabe erteilen / Nachbesserung noetig
```

## Hinweise

- Diese Runde ist Teil des Orchestrator-Workflows (Schritt 4)
- Ergebnisse fliessen in den Plan ein, bevor der User Freigabe gibt
- Bei Konflikten: Orchestrator (Claude Code) entscheidet, dokumentiert Begruendung
