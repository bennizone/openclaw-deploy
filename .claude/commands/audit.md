# /audit — System-Audit

Fuehrt einen umfassenden Audit des OpenClaw-Systems durch.
Nur auf Zuruf, interaktiv. Prueft alle Schichten des Systems.

## Input

$ARGUMENTS

Wenn leer: Alle Kategorien pruefen. Optionale Filter:
- `infra` — Nur Infrastruktur-Health
- `config` — Nur Config-Integritaet
- `docs` — Nur Dokumentations-Konsistenz
- `memory` — Nur Memory-System
- `compliance` — Nur Prozess-Compliance (letzte Session)
- `code` — Nur Code-Redundanzen und -Qualitaet
- `consistency` — Nur Konsistenz und Einheitlichkeit
- `workflow` — Nur Workflow-Analyse und -Optimierung
- `reflect` — Nur Self-Improvement System bewerten
- `project` — Nur Gesamtbewertung mit Empfehlungen

Spezial-Filter:
- `all` — Alle Kategorien (identisch mit leerem Input)
- `quality` — Nur Qualitaets-Kategorien: code + consistency + workflow + reflect + project (ohne infra/config/memory)

## Audit-Kategorien

### 1. Infrastruktur-Health

Pruefe alle Services (wie /tester, aber kompakter):

```bash
# Gateway
systemctl --user is-active openclaw-gateway.service

# Qdrant
docker ps --filter name=qdrant --format "{{.Status}}"
curl -sf http://localhost:6333/ | jq .version

# Embedding Fallback (lokal)
curl -sf http://localhost:8081/health | jq .status

# GPU-Server (IP aus ~/.openclaw-deploy-state.json)
GPU_IP=$(jq -r '.config.gpu_server_ip' ~/.openclaw-deploy-state.json)
curl -sf "http://${GPU_IP}:8080/health" | jq .status
curl -sf "http://${GPU_IP}:8081/health" | jq .status

# Extractor
systemctl --user is-active openclaw-extractor.service

# Disk
df -h / | tail -1
```

### 2. Config-Integritaet

```bash
python3 scripts/config-audit.py
```

Das Script prueft:
- `~/.openclaw/openclaw.json` ist valides JSON
- `~/.openclaw/openclaw.json` Permissions (sollte 444 sein)
- `~/.openclaw/.env` existiert und hat erwartete Keys
- `~/extractor/.env` existiert
- Alle in Config referenzierten Plugins existieren in `~/.openclaw/extensions/`
- `tools.profile` ist "full"
- `plugins.slots.memory` ist "none"
- `agents.defaults.userTimezone` ist gesetzt
- Keine Klartext-Secrets in openclaw.json

### 3. Dokumentations-Konsistenz

Pruefe Existenz, Format, Inhalt und Stimmigkeit aller Komponenten-Dateien.

#### 3a. Vollstaendigkeit (Existenz)

- Alle `components/*/` haben description.md, claude.md, testinstruct.md
- Alle Slash-Commands in CLAUDE.md haben .md Dateien in `.claude/commands/`
- Alle `.claude/commands/*.md` haben ein `components/*/` Verzeichnis
- Alle Links in CLAUDE.md zeigen auf existierende Dateien
- Referenz: `templates/component/README.md` Pflicht-Checkliste

#### 3b. Template-Compliance (Format)

Pruefe ob alle Dateien die Pflicht-Sektionen aus den Templates enthalten:

**description.md** muss enthalten (Grep nach Headern):
- `## Zweck`
- `## Abhaengigkeiten` (mit "Braucht:" und "Wird gebraucht von:")
- `## Schnittstellen` (mit "Eingabe:" und "Ausgabe:")
- `## Bekannte Einschraenkungen`

**claude.md** muss enthalten:
- `## Meine Dateien`
- `## Meine Verantwortung`
- `## Abgrenzung`

**testinstruct.md** muss enthalten:
- `## Voraussetzungen`
- `## Health-Check`
- Mindestens ein `### Test:` Abschnitt

Methode: Grep nach den Pflicht-Headern in jeder Datei. Fehlende Header = WARN.

#### 3c. Inhaltliche Stimmigkeit (Widerspruecke)

Pruefe ob sich Dateien innerhalb einer Komponente und uebergreifend widersprechen:

1. **description.md vs claude.md** (pro Komponente):
   - Stimmen die gelisteten Dateien ueberein?
   - Widerspricht die Abgrenzung in claude.md der Beschreibung in description.md?
   - Nennt description.md Abhaengigkeiten die in claude.md nicht erwaehnt werden?

2. **testinstruct.md vs description.md** (pro Komponente):
   - Testet testinstruct.md die in description.md genannten Schnittstellen?
   - Gibt es Health-Checks fuer die genannten Abhaengigkeiten?

3. **Abgrenzung zwischen Komponenten**:
   - Lies alle `claude.md` Abgrenzungs-Tabellen
   - Gibt es Ueberschneidungen? (Zwei Agenten beanspruchen die gleiche Zustaendigkeit)
   - Gibt es Luecken? (Zustaendigkeit die kein Agent abdeckt)
   - Widersprechen sich Abgrenzungen? (A sagt "B ist zustaendig", B sagt "A ist zustaendig")

4. **CLAUDE.md vs Komponenten**:
   - Stimmt die Slash-Commands Tabelle mit den tatsaechlichen Command-Beschreibungen ueberein?
   - Stimmt die Komponenten-Map mit den tatsaechlichen Verzeichnissen ueberein?

5. **Routing-Dokumente**:
   - `docs/agent-routing.md` und `docs/model-routing.md` — gibt es Widersprueche?
   - Stimmen die dort genannten Agenten mit den tatsaechlichen `components/*/` ueberein?

#### 3d. Sinn-Pruefung (Qualitaet)

- Sind description.md Dateien substanziell? (Nicht nur Platzhalter, mindestens 20 Zeilen)
- Sind testinstruct.md Tests ausfuehrbar? (Enthalten ```bash Bloecke mit echten Commands)
- Haben decisions.md aktuelle Eintraege? (Letzter Eintrag nicht aelter als 30 Tage — INFO wenn aelter)
- Gibt es leere oder fast-leere Dateien? (Unter 5 Zeilen = WARN)

Methode: Glob + Read + Grep. Fuer die Abgrenzungs-Pruefung alle claude.md lesen und Tabellen vergleichen.

### 4. Memory-System

```bash
# Qdrant Collections
curl -s http://localhost:6333/collections | jq '.result.collections[].name'

# Vektor-Dimension pruefen (MUSS 1024 sein)
for col in $(curl -s http://localhost:6333/collections | jq -r '.result.collections[].name'); do
  dim=$(curl -s "http://localhost:6333/collections/$col" | jq '.result.config.params.vectors.dense.size')
  echo "$col: $dim"
done

# Extractor: Letzte Verarbeitung
journalctl --user -u openclaw-extractor.service --since "24h ago" --no-pager | tail -5
```

### 5. Prozess-Compliance

Wenn eine JSONL-Session angegeben wird oder die letzte Session:

```bash
# Letzte Session finden
LATEST=$(ls -t ~/.claude/projects/-home-openclaw-openclaw-deploy/*.jsonl 2>/dev/null | head -1)

# Orchestrator-Audit
python3 scripts/orchestrator-audit.py "$LATEST"
```

### 6. Code-Audit

Suche nach Code- und Funktions-Redundanzen:

- **Plugin-Redundanzen**: Gemeinsame Utility-Funktionen ueber Plugins hinweg (z.B. JSON-Parsing, Error-Handling, API-Calls). Lies `plugins/*/src/**/*.ts` und vergleiche Patterns.
- **Service-Redundanzen**: Gleiche Logik in verschiedenen Services (z.B. HTTP-Client-Code in tool-hub vs extractor)
- **Copy-Paste-Code**: Aehnliche Codebloecke die abstrahiert werden koennten
- **Tote Code-Pfade**: Unreferenzierte Exports, unused imports
- **Vorschlaege**: Konkrete Empfehlungen welche Abstraktionen sinnvoll waeren (shared utils, common types)

Methode: Grep + Read ueber alle Source-Dateien. Keine externen Tools noetig.

Vorgehen:
1. Alle TypeScript-Quelldateien in `plugins/*/src/` und `services/*/src/` finden
2. Haeufige Patterns suchen: `fetch(`, `try {`, `console.error`, `JSON.parse`, `new Error`
3. Aehnliche Funktionssignaturen vergleichen
4. Unreferenzierte `export` Statements suchen (Export vorhanden aber kein Import in anderen Dateien)
5. Ergebnis: Liste der Redundanzen mit Dateien und Zeilennummern
6. DECISIONS.md abgleichen: Wurden Redundanzen bewusst beibehalten? (z.B. Plugin-Isolation)

### 7. Konsistenz-Audit

Pruefe Einheitlichkeit ueber alle Komponenten:

- **Naming**: Sind Variablen/Funktionen einheitlich benannt? (camelCase vs snake_case, deutsche vs englische Namen)
- **Error-Handling**: Gleiche Fehlerbehandlungs-Patterns ueberall? (try/catch vs .catch, error logging)
- **Logging**: Einheitliches Logging-Format? (console.log vs stderr vs structured)
- **Config-Zugriff**: Wie greifen verschiedene Komponenten auf Config zu? Einheitlich?
- **TypeScript-Patterns**: Einheitliche Nutzung von Types, Interfaces, Enums
- **Python-Patterns**: Einheitlicher Style in Python-Scripts

Methode: Grep ueber alle Quellcode-Dateien, Pattern-Vergleich.

Vorgehen:
1. Naming-Konventionen: Grep nach `function ` und `const ` in TS-Dateien, nach `def ` in PY-Dateien
   - camelCase vs snake_case Verhaeltnis zaehlen
   - Deutsche vs englische Bezeichner identifizieren
2. Error-Handling: Grep nach `try {`, `.catch(`, `console.error`, `process.stderr`
   - Welche Patterns werden wo verwendet?
   - Gibt es inkonsistente Fehlerbehandlung?
3. Logging: Grep nach `console.log`, `console.error`, `console.warn`, `process.stderr.write`
   - Einheitliches Format? Strukturierte Ausgabe?
4. Config-Zugriff: Grep nach `process.env`, `config.`, `getConfig`, `.env`
   - Gleicher Zugriffsmechanismus ueberall?
5. TypeScript: Grep nach `interface `, `type `, `enum `
   - Werden Types konsistent definiert? (TypeBox vs native TS)
6. Python: Grep nach `import `, `logging.`, `print(`
   - Konsistenter Import-Style? Logging vs print?
7. DECISIONS.md abgleichen: Wurden Inkonsistenzen bewusst entschieden? (z.B. verschiedene Logging-Strategien je nach Kontext)

### 8. Workflow-Audit

Analysiere das Workflow-Verhalten des Orchestrators:

- Lies `docs/workflow-patterns.md` — welche Patterns sind erfasst? Welche sind "offen" vs "geloest"?
- Gibt es Patterns die >2x vorkommen? (= strukturelles Problem laut Definition)
- Vergleiche die Workflow-Schritte in `docs/workflow.md` mit der tatsaechlichen Praxis (letzte 3-5 Sessions via orchestrator-audit.py)
- Identifiziere haeufig uebersprungene Schritte
- Vorschlaege zur Workflow-Optimierung: Welche Schritte koennten automatisiert oder vereinfacht werden?

Methode: workflow-patterns.md lesen, letzte JSONL Sessions mit orchestrator-audit.py analysieren.

Vorgehen:
1. `docs/workflow-patterns.md` lesen — Tabelle parsen
2. Zaehle "offen" vs "geloest" Eintraege
3. Identifiziere Patterns mit Anzahl > 2 (strukturelle Probleme)
4. Letzte 3-5 JSONL Sessions finden:
   ```bash
   ls -t ~/.claude/projects/-home-openclaw-openclaw-deploy/*.jsonl | head -5
   ```
5. Jede Session durch orchestrator-audit.py analysieren:
   ```bash
   python3 scripts/orchestrator-audit.py "$SESSION" --json
   ```
6. Violations aggregieren: Welche Violation-Typen kommen am haeufigsten vor?
7. Compliance-Rate berechnen: Wie viel Prozent der Sessions sind violation-frei?
8. Vorschlaege: Welche Schritte werden regelmaeessig uebersprungen und koennten automatisiert werden?
9. DECISIONS.md abgleichen: Wurden Workflow-Abweichungen bewusst akzeptiert?

### 9. Reflect/Self-Improvement Audit

Bewerte das Selbstverbesserungssystem:

- Lies `docs/workflow-patterns.md` — sind die "geloest" markierten Patterns wirklich geloest? (Grep nach den Patches in den referenzierten Dateien)
- Pruefe ob /reflect-Findings tatsaechlich umgesetzt wurden (Patches in CLAUDE.md, Checklisten etc.)
- Bewerte die Wirksamkeit: Kommen gleiche Violations nach dem Fix noch vor?
- Gibt es Findings die nie umgesetzt wurden? Warum nicht?
- Meta-Analyse: Verbessert sich das System ueber Zeit? (Violations pro Session trending down?)

Methode: workflow-patterns.md lesen, JSONL Sessions analysieren, Patches verifizieren.

Vorgehen:
1. `docs/workflow-patterns.md` lesen — alle Eintraege mit Status "geloest" sammeln
2. Fuer jeden geloesten Eintrag: Den referenzierten Fix verifizieren
   - Wenn Fix auf eine Datei verweist (z.B. "deploy-checklist.md Schritt 3"): Pruefen ob die Datei existiert und den Fix enthaelt
   - Wenn Fix auf CLAUDE.md verweist: Grep nach dem Patch-Text
3. Fuer jeden "offenen" Eintrag: Seit wann offen? Gibt es einen Grund fuer die Verzoegerung?
4. Wirksamkeits-Analyse:
   - Sammle alle Violation-Typen aus den letzten 5 Sessions (via orchestrator-audit.py --json)
   - Vergleiche: Kommt ein "geloest" markiertes Pattern in neueren Sessions noch vor?
   - Wenn ja: Fix war unwirksam → melden
5. Trend-Analyse:
   - Sessions chronologisch sortieren
   - Violations pro Session zaehlen
   - Steigt oder sinkt die Zahl? → Trend melden
6. Zusammenfassung:
   - Umsetzungsrate: X von Y Findings umgesetzt
   - Wirksamkeitsrate: X von Y Fixes haben Violation eliminiert
   - Trend: Verbesserung / Stagnation / Verschlechterung
7. DECISIONS.md abgleichen: Wurden bestimmte Findings bewusst nicht umgesetzt?

### 10. Gesamtbewertung

Konstruktive Gesamtbewertung des Projekts:

- **Architektur-Fitness**: Passt die aktuelle Architektur noch zum Einsatzzweck? Gibt es Drift?
- **Technische Schulden**: Was wurde aufgeschoben? (TODO-Liste in Memory vs tatsaechlicher Stand)
- **Staerken**: Was funktioniert besonders gut? Was sollte beibehalten werden?
- **Schwaechen**: Wo sind die groessten Risiken? Was koennte als naechstes brechen?
- **Empfehlungen**: Top-3 Verbesserungen mit hoechstem Impact/Aufwand-Verhaeltnis
- **Reife-Score**: Subjektive Einschaetzung der Projekt-Reife (0-10) mit Begruendung

Methode: Ergebnisse aller anderen Kategorien zusammenfassen + eigene Analyse.

Vorgehen:
1. Ergebnisse der Kategorien 1-9 zusammentragen (sofern ausgefuehrt)
2. Architektur-Fitness:
   - Lies CLAUDE.md Architektur-Diagramm
   - Vergleiche mit tatsaechlicher Service-Landschaft (systemctl, docker ps, etc.)
   - Gibt es Services die im Diagramm fehlen oder umgekehrt?
3. Technische Schulden:
   - Lies die Master-TODO aus Memory (`project_master_todo.md`)
   - Zaehle offene vs erledigte Punkte
   - Aelteste offene Punkte identifizieren
4. Staerken identifizieren:
   - Was hat in den Audits gut abgeschnitten?
   - Welche Patterns funktionieren zuverlaessig?
5. Schwaechen identifizieren:
   - Wo gab es FAIL/WARN Ergebnisse?
   - Was sind die groessten Einzelrisiken?
6. Top-3 Empfehlungen formulieren:
   - Hoechster Impact bei geringstem Aufwand zuerst
   - Konkrete naechste Schritte angeben
7. Reife-Score vergeben:
   - 0-3: Prototyp (grundlegende Funktionen fehlen)
   - 4-6: Beta (funktioniert, aber Luecken in Doku/Tests/Monitoring)
   - 7-8: Produktiv (stabil, gut dokumentiert, getestet)
   - 9-10: Mature (Self-Healing, umfassende Automatisierung)
   - Score mit 2-3 Saetzen begruenden
8. DECISIONS.md abgleichen: Technische Schulden die bewusst akzeptiert wurden aus der Schwaechen-Liste entfernen und separat als "Akzeptierte Trade-offs" listen

## DECISIONS.md Abgleich (PFLICHT)

Bevor ein Finding als WARN oder FAIL gemeldet wird:

1. Lies `docs/DECISIONS.md` (zentrale Entscheidungen)
2. Lies `components/*/decisions.md` (komponentenspezifische Entscheidungen)
3. Pruefe ob das Finding durch eine dokumentierte Entscheidung erklaert wird

Wenn eine Entscheidung das Finding erklaert:
- Stufe von WARN/FAIL auf INFO herunterstufen
- Markierung: `[INFO] <Finding> — Bewusste Entscheidung (siehe DECISIONS.md: "<Titel>")`

Beispiele:
- Finding: "plugins.slots.memory = none" → DECISIONS.md sagt "Eigenes Memory-System"
  → `[INFO] plugins.slots.memory = "none" — Bewusste Entscheidung (Eigenes Qdrant-Memory)`
- Finding: "Kein Ollama installiert" → DECISIONS.md sagt "Ollama deaktiviert wg. VRAM"
  → `[INFO] Ollama nicht vorhanden — Bewusste Entscheidung (VRAM-Konflikt)`
- Finding: "3 Komponenten ohne testinstruct.md" → Keine Entscheidung dokumentiert
  → Bleibt `[WARN]`

Dies gilt fuer ALLE Kategorien (1-10). Der Abgleich verhindert false positives
und stellt sicher, dass nur echte Probleme als WARN/FAIL gemeldet werden.

## Ergebnis-Format

Gib die Ergebnisse als Checkliste aus:

```
=== OpenClaw System-Audit ===

Infrastruktur:
  [OK] Gateway (active)
  [OK] Qdrant (v1.x.x)
  [OK] Embedding Fallback
  [OK] GPU Chat
  [FAIL] GPU Embedding — Connection refused
  [OK] Extractor
  [OK] Disk: 45% belegt

Config:
  [OK] openclaw.json valide
  [OK] Permissions 444
  [OK] .env vorhanden
  [WARN] tools.profile = "default" (sollte "full" sein)
  [OK] Keine Klartext-Secrets

Dokumentation:
  [OK] 11/11 Komponenten mit description.md
  [WARN] 3 Komponenten ohne testinstruct.md
  [OK] Alle CLAUDE.md Links valide

Memory:
  [OK] 3 Collections (memories_benni, memories_domi, memories_household)
  [OK] Alle Dimensionen = 1024
  [OK] Extractor aktiv (letzte Verarbeitung vor 2h)

Compliance:
  [OK] Letzte Session: Keine Violations
```

Bei FAIL oder WARN: Ursache und empfohlene Aktion angeben.

Fuer die Qualitaets-Kategorien (6-10):

```
Code-Audit:
  [INFO] 3 potenzielle Redundanzen gefunden
  [WARN] HTTP-Client-Code in 3 Services dupliziert
  [OK] Keine toten Code-Pfade

  Vorschlaege:
    1. Shared HTTP-Client als eigenes Modul extrahieren (3 Services betroffen)
    2. Error-Formatting in ha-voice und memory-recall identisch → shared util

Konsistenz:
  [OK] Naming: 95% camelCase in TS, 100% snake_case in PY
  [WARN] Logging: 3 verschiedene Formate (console.log, stderr, structured)
  [OK] Config-Zugriff: Einheitlich ueber process.env

  Vorschlaege:
    1. Logging-Format standardisieren (stderr fuer Services, structured fuer Plugins)

Workflow:
  [OK] 18/20 Patterns geloest
  [WARN] 2 offene Patterns mit Anzahl > 2 (ORCH-EDIT, ORCH-FIX)
  [INFO] Haeufigster Skip: /docs (3 von 5 Sessions)

  Vorschlaege:
    1. /docs automatisch bei Commit triggern (Hook)
    2. ORCH-EDIT/ORCH-FIX: Staerkere Warnung in CLAUDE.md oder Pre-Edit-Hook

Reflect/Self-Improvement:
  [OK] Umsetzungsrate: 15/18 Findings umgesetzt
  [OK] Wirksamkeitsrate: 12/15 Fixes haben Violation eliminiert
  [WARN] 3 Fixes unwirksam — gleiche Violation tritt weiterhin auf
  [INFO] Trend: Violations pro Session sinken (5 → 3 → 1)

  Vorschlaege:
    1. Unwirksame Fixes ueberarbeiten (ORCH-EDIT braucht staerkeren Mechanismus)

Gesamtbewertung:
  Reife-Score: 6.5/10 (Solide Beta — Kernfunktionen stabil, Luecken in
    Doku-Vollstaendigkeit und Workflow-Automatisierung)

  Staerken:
    - Config-Management robust (Backup → Validate → Commit)
    - Memory-Pipeline funktioniert zuverlaessig
    - Orchestrator-Protokoll gut definiert

  Schwaechen:
    - 3 Komponenten ohne testinstruct.md
    - Workflow-Steps werden regelmaessig uebersprungen
    - Kein automatisches Monitoring/Alerting

  Top-3 Empfehlungen:
    1. Fehlende testinstruct.md erstellen (30min, schliesst groesste Doku-Luecke)
    2. Pre-Commit Hook fuer Workflow-Compliance (2h, verhindert ORCH-EDIT)
    3. Heartbeat/Cron einrichten (4h, erkennt Ausfaelle proaktiv)
```

## Ergebnisse speichern (PFLICHT)

Nach Abschluss des Audits:

1. Speichere den vollstaendigen Bericht als `docs/audits/YYYY-MM-DD.md`
   - Dateiname = Datum des Audits
   - Bei mehreren Audits am selben Tag: `YYYY-MM-DD-2.md`
2. Die Gesamtbewertung + Empfehlungen als abarbeitbare Checkliste (Markdown `- [ ]`)
3. Empfehlungen mit Prioritaet: P1 (sofort), P2 (diese Woche), P3 (spaeter)

Fruehere Audits koennen jederzeit gelesen werden:
```bash
ls docs/audits/
cat docs/audits/2026-04-02.md
```

Bei Folge-Audits: Vergleiche mit dem letzten Audit und zeige Fortschritt:
- Welche Empfehlungen wurden abgearbeitet? (Checkliste pruefen)
- Hat sich der Reife-Score veraendert?
- Neue Findings vs wiederkehrende Findings

## Wichtig

- Dieser Audit ist NICHT-destruktiv — er liest nur, aendert nichts
- Bei Config-Problemen: Empfehlung ausgeben, NICHT automatisch fixen
- Ergebnis kann als Grundlage fuer Wartungsarbeiten dienen
