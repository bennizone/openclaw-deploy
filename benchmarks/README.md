# LLM Benchmark

Wiederverwendbares Benchmark-System für LLM-Evaluierung im OpenClaw-Stack.

## Datasets

| Datei | Tests | Beschreibung |
|-------|-------|--------------|
| `datasets/ha-conversations.json` | 10 | HA Voice Agent: Entity-Abfragen, Delegation, Format-Compliance |
| `datasets/memory-synthetic.json` | 10 | Memory-Extraction: Ground-Truth Fakten aus synthetischen Konversationen |
| `datasets/fallback-chat.json` | 7 | Fallback-Agent: Smalltalk, Wissen, Tool-Calls, Multi-Turn |

## Scripts

### run-bench.sh

Mechanische Metriken (TTFT, t/s, JSON-Validierung):

```bash
# Standard-Lauf
./scripts/run-bench.sh --dataset ha --endpoint http://10.83.1.110:8080

# Mit Thinking-Budget-Tests
./scripts/run-bench.sh --dataset ha --endpoint http://10.83.1.110:8080 --thinking-budgets "0,512,1024,2048"

# Mit Parallel-Throughput-Test
./scripts/run-bench.sh --dataset ha --endpoint http://10.83.1.110:8080 --parallel-test
```

### compare.sh

Ergebnis-Vergleich:

```bash
./scripts/compare.sh results/run1.json results/run2.json
```

## Ergebnis-Format

Ergebnisse landen in `results/` als `YYYY-MM-DD_HH-MM_<modell>_<gpu>.json`.
Metadaten (Datum, Modell, GPU, VRAM) werden automatisch gesammelt.

## Workflow via /bench

Der `/bench` Slash-Command steuert den kompletten Ablauf interaktiv:
1. Modell-Auswahl
2. Test-Auswahl (HA / Memory / Fallback / Alle)
3. Thinking-Budget-Konfiguration
4. Wartungsmodus-Abfrage
5. Tests + automatische Metriken
6. Claude-Bewertung der Antwortqualität
7. Ergebnis-Speicherung + Vergleich
