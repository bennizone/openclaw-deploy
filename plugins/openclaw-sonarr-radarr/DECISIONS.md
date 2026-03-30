# openclaw-sonarr-radarr — Entscheidungen & Features

## Feature-Liste

### 5 Tools
**Status:** Alle aktiv seit 2026-03-28

| Tool | Funktion |
|------|----------|
| `arr_search` | Suche Film/Serie, zeigt ob in Bibliothek |
| `arr_add_movie` | Film hinzufuegen (1080p), Download starten, Collection-Info |
| `arr_add_series` | Serie hinzufuegen (720p), Download starten |
| `arr_calendar` | Naechste Episoden/Releases |
| `arr_add_collection` | Ganze Radarr-Collection monitoren |

## Architektur

```
src/
├── index.ts           — Plugin Entry, registerTool() fuer alle 5 Tools
├── config.ts          — Config-Validation
├── sonarr-client.ts   — Sonarr v3 API Client
├── radarr-client.ts   — Radarr v3 API Client
├── tools.ts           — Tool-Definitionen (TypeBox Schemas + execute)
└── types.ts           — Shared TypeScript Types
```

**Entscheidung:** Eigene API-Clients statt npm-Pakete
**Warum:** Sonarr/Radarr APIs sind simpel (REST+JSON). Eigene Clients sind leichter,
keine Dependency-Probleme, volle Kontrolle ueber Error Handling.

**Entscheidung:** Plugin (extensions/) statt Skill (marketplace)
**Warum:** Volle Kontrolle, keine Marketplace-Abhaengigkeit, lokale Entwicklung.

## Config

```json
{
  "plugins.entries.openclaw-sonarr-radarr": {
    "enabled": true,
    "config": {
      "sonarrUrl": "https://sonarr.home.benni.zone",
      "sonarrApiKey": "...",
      "radarrUrl": "https://radarr.home.benni.zone",
      "radarrApiKey": "...",
      "seriesQualityProfile": "Up to 720p",
      "movieQualityProfile": "Up to 1080p"
    }
  }
}
```

## Erkenntnisse
- `tools.profile: "full"` PFLICHT — "coding" filtert Plugin-Tools still raus
- `openclaw.extensions` in package.json fuer Discovery noetig
- `/reset` per WhatsApp nach Aenderungen (nicht `/new` — loescht Memory!)
- TypeBox Schemas generieren JSON Schema — kann auch direkt JSON Schema verwenden
- `execute()` Return-Format: `{ content: [{ type: "text", text: "..." }] }`

## Offene Punkte (TODO)
1. **Deutsche Release-Termine:** `arr_calendar` muss beruecksichtigen, dass Serien/Filme
   in Deutschland oft spaeter erscheinen als im Original (z.B. US-Start vs. DE-Start).
   Aktuell zeigt Sonarr nur den Original-Release.
2. **Titelsuche Deutsch → Original:** Wenn ein User auf Deutsch sucht ("Die Verurteilten"),
   muss ggf. erst der englische/Original-Titel ermittelt werden ("The Shawshank Redemption"),
   da Sonarr/Radarr primaer mit Original-Titeln arbeiten. Ansatz: TMDB-Lookup oder
   LLM-basierte Titel-Uebersetzung vor der API-Suche.

## SOUL.md Ergaenzungen
- workspace-benni und workspace-domi haben Media-Instruktionen
- Deutsch, keine technischen Details in Antworten
