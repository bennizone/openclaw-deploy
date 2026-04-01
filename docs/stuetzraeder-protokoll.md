# Stuetzraeder-Protokoll — Graduierte Autonomie

## Philosophie

Neue Komponenten starten mit maximaler Begleitung. Mit jeder fehlerfreien Session
waechst das Vertrauen — und damit die Autonomie. Fehler fuehren zu Regression,
kritische Fehler zum Reset. So entsteht ein datengetriebener Vertrauens-Aufbau
statt blindem "das hat bisher funktioniert".

## Autonomie-Levels

| Level | Name | Freigabe noetig fuer |
|-------|------|----------------------|
| 0 | Vollstaendig begleitet | Alles (read, write, deploy, config, new) |
| 1 | Begleitet mit Vertrauen | Schreibende Aktionen (write, deploy, config, new) |
| 2 | Ueberwacht | Neue/unbekannte Ops + Deploy (deploy, config, new) |
| 3 | Autonom | Nur Deploy + Config-Aenderungen (deploy, config) |

### Operations-Typen

- **read** — Lesende Aktionen (Dateien lesen, Status pruefen)
- **write** — Dateien schreiben, Code aendern
- **deploy** — Service neustarten, Commit + Push
- **config** — openclaw.json, systemd Units, .env aendern
- **new** — Neue/unbekannte Operation die noch nie fuer diese Komponente lief

## Progression

Eine Komponente steigt auf, wenn sie genuegend fehlerfreie Sessions **in Folge** hat:

| Uebergang | Fehlerfreie Sessions noetig |
|-----------|---------------------------|
| 0 → 1 | 3 |
| 1 → 2 | 5 |
| 2 → 3 | 10 |

Promotions werden **vorgeschlagen**, nicht automatisch angewendet.
Der User entscheidet ueber jede Promotion.

```bash
python3 scripts/autonomy-status.py suggest-promotions
```

## Regression

| Ereignis | Wirkung |
|----------|---------|
| Fehler (nicht-kritisch) | Level sinkt um 1, Fehlerfrei-Zaehler wird auf 0 gesetzt |
| Kritischer Fehler | Reset auf Level 0, Fehlerfrei-Zaehler wird auf 0 gesetzt |

### Was ist ein kritischer Fehler?

- Config-Zerstoerung (openclaw.json kaputt)
- Datenverlust (Sessions geloescht, Memory korrumpiert)
- Service-Ausfall > 5 Minuten durch eigenen Fehler
- Sicherheitsrelevanter Fehler

## Daten

Alle Metriken liegen in `config/autonomy.json`:

```json
{
  "levels": {
    "<component>": {
      "current": 0,
      "since": "YYYY-MM-DD",
      "metrics": {
        "sessions_total": 0,
        "sessions_error_free": 0,
        "last_error": null
      }
    }
  }
}
```

## CLI-Nutzung

```bash
# Status aller Komponenten
python3 scripts/autonomy-status.py status

# Braucht eine Operation Freigabe?
python3 scripts/autonomy-status.py check gateway deploy

# Session-Ergebnis eintragen
python3 scripts/autonomy-status.py record tool-hub              # Erfolg
python3 scripts/autonomy-status.py record tool-hub --error       # Fehler
python3 scripts/autonomy-status.py record tool-hub --error --critical  # Kritisch

# Promotions pruefen
python3 scripts/autonomy-status.py suggest-promotions
```

## Integration

- **`/reflect` Schritt 8:** Nach Pattern-Eintrag auch `autonomy-status.py record <comp>` aufrufen
- **Workflow Schritt 6:** Bei Level 2+ Standard-Ops (read, write) ohne extra Freigabe
- **Promotions:** Regelmaessig via `suggest-promotions` pruefen, User entscheidet
