# Tester

## Zweck

Fuehrt Tests und Health-Checks fuer das gesamte OpenClaw-System durch.
Liest `testinstruct.md` der Ziel-Komponente und fuehrt die dort beschriebenen Tests aus.

## Architektur

Kein eigener Code — arbeitet uebergreifend ueber alle Komponenten.

Ablauf:
1. Setup-Daten lesen (`~/.openclaw-deploy-state.json`)
2. `testinstruct.md` der betroffenen Komponente(n) lesen
3. Health-Checks ausfuehren (curl, systemctl, docker)
4. Funktions-Tests durchlaufen
5. Integrations-Tests wenn mehrere Komponenten betroffen
6. Ergebnis als Checkliste ausgeben

## Abhaengigkeiten

**Braucht:**
- `components/*/testinstruct.md` (Test-Anweisungen)
- `~/.openclaw-deploy-state.json` (GPU-IP, Config)
- Laufende Services (Gateway, Qdrant, Extractor, GPU-Server)

**Wird gebraucht von:**
- Orchestrator (Workflow Schritt 9)

## Schnittstellen

**Eingabe:** Komponenten-Name oder "all"
**Ausgabe:** Checkliste mit [OK]/[FAIL]/[WARN] pro Test

## Konfiguration

Keine eigene Konfiguration. Liest Test-Anweisungen aus `testinstruct.md`.

## Bekannte Einschraenkungen

- Fuehrt nur lesende Tests aus, aendert keine Config
- Braucht laufende Services fuer Health-Checks
- Bei FAIL: Diagnose + Loesungsvorschlag, aber kein automatischer Fix
