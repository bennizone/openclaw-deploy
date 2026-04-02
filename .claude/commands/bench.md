# /bench — LLM Benchmark Wizard

Du bist der LLM-Benchmark-Assistent. Fuehre den User interaktiv durch einen
LLM-Benchmark-Lauf mit fixen Testdatensaetzen und automatischen Metriken.

## Ablauf

### 1. Modell-Auswahl
Frage den User:
- **Aktuelles Modell testen** (was gerade auf dem GPU-Server laeuft)
- **Neues GGUF laden** (Pfad auf GPU-Server oder HuggingFace-URL)
- **Manuell angeben** (Endpoint + Modellname)

Bei neuem GGUF:
- Download auf GPU-Server: `ssh badmin@10.83.1.110 "cd ~/models && wget <url>"`
- llama-server stoppen und mit neuem Modell starten
- Health-Check: `curl -sf http://10.83.1.110:8080/health`

### 2. Test-Auswahl
Frage den User welche Tests:
- **HA** — Home Assistant Konversationstests (10 Szenarien)
- **Memory** — Memory-Extraction Benchmark (10 synthetische Konversationen)
- **Fallback** — Fallback-Chat Qualitaetstests (7 Szenarien)
- **Alle** — Kompletter Durchlauf

### 3. Thinking-Budget
Frage den User:
- **Standard** — Nur Server-Default (kein Thinking bei HA, Thinking bei Fallback)
- **Mehrere testen** — Budgets 0, 512, 1024, 2048 durchlaufen
- **Custom** — User gibt Budgets vor

### 4. Wartungsmodus
- Pruefe ob Wartungsmodus aktiv: `bash scripts/maintenance.sh status`
- Wenn nicht aktiv und neues Modell geladen wird: Frage ob aktivieren
  (GPU-Server ist waehrend Modell-Wechsel nicht verfuegbar)
- Bei Parallel-Tests: Empfehle Wartungsmodus

### 5. Tests ausfuehren
Fuer jeden ausgewaehlten Test-Typ:

```bash
# Mechanische Metriken
benchmarks/scripts/run-bench.sh \
  --dataset <type> \
  --endpoint http://10.83.1.110:8080 \
  --thinking-budgets "0,512,1024,2048" \
  --parallel-test
```

### 6. Claude-Bewertung
Nach dem mechanischen Lauf: Lies die Ergebnis-JSON und bewerte JEDE Antwort:

**HA-Tests:**
- Stimmen die Fakten mit den mock_entities ueberein? (Halluzination?)
- Wird das SOUL.md Format eingehalten? (1-2 Saetze, kein Markdown, Einheiten ausgeschrieben)
- Wird korrekt an OpenClaw delegiert wenn noetig? (OPENCLAW: Prefix)

**Memory-Tests:**
- Werden erwartete Fakten korrekt extrahiert?
- Werden expectedRejects korrekt abgelehnt?

**Fallback-Tests:**
- Ist die Antwort natuerlich und auf Deutsch?
- Werden Tools korrekt aufgerufen?
- Halluziniert das Modell?

Bewerte mit Score 0-10 pro Test und schreibe die Bewertung in die Ergebnis-JSON.

### 7. Ergebnis speichern
- Datei: `benchmarks/results/YYYY-MM-DD_HH-MM_<modell>_<gpu>.json`
- Claude-Bewertungen in `quality_scores` Feld ergaenzen

### 8. Vergleich
Falls fruehere Ergebnisse existieren:
```bash
benchmarks/scripts/compare.sh benchmarks/results/*.json
```
Zeige die Vergleichstabelle und interpretiere die Ergebnisse.

### 9. Empfehlung
Gib eine klare Empfehlung:
- Ist das neue Modell besser/schlechter?
- Welches Thinking-Budget ist optimal?
- Lohnt sich der Wechsel?

## Wichtige Pfade

| Pfad | Beschreibung |
|------|-------------|
| `benchmarks/datasets/` | Fixe Testdatensaetze |
| `benchmarks/results/` | Ergebnisse pro Lauf |
| `benchmarks/scripts/run-bench.sh` | Mechanische Metriken |
| `benchmarks/scripts/compare.sh` | Vergleichs-Script |
| GPU-Server | `badmin@10.83.1.110`, Port 8080 |

## Hinweise

- HA-Tests simulieren den home-llm Pfad (System-Prompt mit Entity-Daten, kein Tool-Calling)
- Memory-Tests brauchen laufendes Qdrant + Embedding-Server
- Bei Modell-Wechsel: Altes Modell NICHT loeschen bevor Baseline gesichert
- Ergebnisse IMMER committen fuer Nachvollziehbarkeit
