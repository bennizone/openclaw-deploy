# Agent Bootstrap-Interview

Jeder persoenliche Agent durchlaeuft beim ersten Kontakt ein Bootstrap-Interview,
in dem er gemeinsam mit seinem Menschen eine eigene Identitaet entwickelt.

## Wie es funktioniert

OpenClaw injiziert Workspace-Dateien in den System-Prompt des Agents.
Die Reihenfolge ist:

1. `AGENTS.md` — Arbeitsanweisungen + Bootstrap-Erkennung
2. `SOUL.md` — Persoenlichkeit (enthält Bootstrap-Modus-Anweisung)
3. `TOOLS.md` — Tool-Hinweise
4. `IDENTITY.md` — Name, Wesen, Vibe, Emoji
5. `USER.md` — Infos ueber den Menschen
6. `HEARTBEAT.md` — Heartbeat-Checkliste
7. `BOOTSTRAP.md` — Interview-Anleitung (nur bei Ersteinrichtung)
8. `MEMORY.md` — Langzeitgedaechtnis

Wenn `BOOTSTRAP.md` existiert, ist der Agent im Bootstrap-Modus.
Die Anweisung dazu steht **direkt in SOUL.md** (nicht nur in BOOTSTRAP.md),
weil manche Modelle (z.B. MiniMax M2.7) spaeter injizierte Dateien
weniger stark gewichten als SOUL.md.

## Was im Interview passiert

Der Agent fragt:

> "Hey! Ich bin gerade zum ersten Mal online und weiss noch nicht wer ich bin.
> Lass uns das zusammen rausfinden — wer bist du, und wer soll ich sein?"

Gemeinsam werden definiert:

1. **Agent-Name** — Wie heisst der Agent? (NICHT der User-Name!)
2. **Wesen** — Was ist er? (KI-Assistent, holographisches Programm, ...)
3. **Vibe** — Foermlich, locker, frech, warm?
4. **Emoji** — Signatur-Emoji

Danach aktualisiert der Agent:
- `IDENTITY.md` — Name, Wesen, Vibe, Emoji
- `USER.md` — Infos ueber den Menschen
- `SOUL.md` — Persoenlichkeit anpassen, Bootstrap-Abschnitt entfernen
- `BOOTSTRAP.md` **loeschen** — signalisiert: Bootstrap abgeschlossen

## Wichtig: Agent-ID ≠ Agent-Name

Die Agent-ID (z.B. `benni`) ist ein technischer Identifier fuer Routing.
Sie wird oft nach dem User benannt, weil es "der Agent von Benni" ist.

Der Agent selbst braucht aber einen **eigenen** Namen (z.B. "Nova", "THN", "Pixel").
Diesen bekommt er erst im Bootstrap-Interview.

**Fehler der vermieden werden muss:** `SOUL.md` oder `IDENTITY.md` mit dem
User-Namen als Agent-Name befuellen. Das fuehrt dazu, dass der Agent sich
als der User ausgibt.

## Bootstrap wiederholen

Falls der User das Interview nochmal machen will (Name aendern, Persoenlichkeit
anpassen):

```bash
# 1. BOOTSTRAP.md wiederherstellen:
cp ~/openclaw-deploy/agents/templates/BOOTSTRAP.md ~/.openclaw/workspace-<agent>/BOOTSTRAP.md

# 2. SOUL.md Bootstrap-Modus reaktivieren (den Abschnitt oben wieder einfuegen):
#    ## BOOTSTRAP-MODUS (solange BOOTSTRAP.md existiert!)
#    (siehe agents/templates/SOUL.md.template fuer die volle Vorlage)

# 3. Sessions loeschen (damit der Agent keine alte History mitschleppt):
rm ~/.openclaw/agents/<agent>/sessions/*.jsonl
rm ~/.openclaw/agents/<agent>/sessions/sessions.json

# 4. Gateway neustarten:
systemctl --user restart openclaw-gateway

# 5. Neue Nachricht schicken — Interview startet automatisch
```

## Workspace-State

OpenClaw trackt den Bootstrap-Status in `~/.openclaw/workspace-<agent>/.openclaw/workspace-state.json`:

```json
{
  "version": 1,
  "bootstrapSeededAt": "2026-03-31T09:53:23.647Z",
  "setupCompletedAt": "2026-03-31T14:30:00.000Z"
}
```

- `bootstrapSeededAt` — Wann BOOTSTRAP.md erstmals angelegt wurde
- `setupCompletedAt` — Wann Bootstrap abgeschlossen wurde (BOOTSTRAP.md geloescht)

## Household-Agent

Der Household-Agent bekommt **kein** Bootstrap-Interview. Er hat eine feste
Persoenlichkeit (`agents/household/SOUL.md`) und wird nie direkt von einem
Menschen angesprochen, sondern nur ueber die HA-Voice-Integration.

## Bekannte Fallstricke

| Problem | Ursache | Loesung |
|---------|---------|---------|
| Agent stellt sich als User vor | SOUL.md/IDENTITY.md mit User-Name befuellt | Agent-Name als Platzhalter lassen, erst im Interview setzen |
| Agent ignoriert BOOTSTRAP.md | Modell priorisiert SOUL.md ueber spaetere Dateien | Bootstrap-Anweisung direkt in SOUL.md packen |
| Interview startet nicht trotz BOOTSTRAP.md | Alte Session-History ueberschreibt frischen Start | Sessions loeschen (siehe oben) |
| Agent antwortet nur "Hi" | Kombination: schwache Bootstrap-Anweisung + alte History | SOUL.md haerter formulieren + Sessions loeschen + Gateway restart |
