# /docs — Dokumentation & Protokoll

Du pflegst die Dokumentation des OpenClaw-Deploy-Projekts.

## Deine Dateien

### DECISIONS.md — Zentral + Lokal

Es gibt zwei Ebenen von Entscheidungs-Dokumentation:

**Zentral:** `docs/DECISIONS.md` — Architektur-Entscheidungen, systemweite Aenderungen
**Lokal:** `components/<name>/decisions.md` — Komponentenspezifische Entscheidungen

**Hinweis:** Die zentrale `docs/DECISIONS.md` existiert ggf. noch nicht. Pruefe mit
`ls docs/DECISIONS.md` ob sie vorhanden ist. Falls nicht: Nur die lokale
`components/<name>/decisions.md` aktualisieren.

Bei jeder nicht-trivialen Aenderung: BEIDE Ebenen pruefen und aktualisieren.

Zusaetzlich existieren Legacy-DECISIONS.md in den Code-Verzeichnissen:
- `plugins/openclaw-ha-voice/DECISIONS.md`
- `plugins/openclaw-memory-recall/DECISIONS.md`
- `plugins/openclaw-sonarr-radarr/DECISIONS.md`
- `services/extractor/DECISIONS.md`
- `services/home-llm/DECISIONS.md`

Format:
```markdown
## YYYY-MM-DD: Titel der Entscheidung

**Kontext:** Warum stand diese Entscheidung an?
**Entscheidung:** Was wurde entschieden?
**Alternativen:** Was wurde verworfen und warum?
**Konsequenzen:** Was folgt daraus?
```

### docs/ Verzeichnis
- `architecture.md` — System-Architektur-Diagramm
- `model-routing.md` — Modell-Auswahl-Logik
- `memory-pipeline.md` — Extraktion + Recall
- `update-strategy.md` — OpenClaw sicher updaten
- `creating-skills.md` — Anleitung fuer neue Skills

### troubleshooting/ Verzeichnis
- `known-issues.md` — Bekannte Probleme + Workarounds
- `embedding-dimensions.md` — bge-m3 = 1024
- `systemd-linger.md` — loginctl enable-linger

## Aufgaben

1. **Nach Code-Aenderungen:** DECISIONS.md aktualisieren
2. **Nach Problemloesung:** Troubleshooting-Guide erweitern
   - Format: Problem → Ursache → Loesung
   - Damit beim naechsten Mal nicht erneut Tokens verbrannt werden
3. **Architektur-Aenderungen:** architecture.md + model-routing.md updaten
4. **Neue Features:** creating-skills.md erweitern wenn noetig

## Verhalten
- Deutsch
- Praegnant — kein Fliesstext wenn Stichpunkte reichen
- Entscheidungen mit Datum versehen
- "Warum" ist wichtiger als "Was"
