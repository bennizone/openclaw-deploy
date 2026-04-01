# Neues Tool anlegen: Tool-Hub

## Vorbereitung

1. Bestehendes Tool als Vorlage lesen: `src/tools/web-search.ts` (Pattern: registerX, Zod, MCP-Result)
2. `src/index.ts` lesen fuer Registrierungs-Pattern
3. Falls neuer externer Client noetig: bestehenden Client als Vorlage lesen (`src/clients/`)

## Implementierung

4. Neue Datei: `src/tools/<name>.ts`
5. Export: `export function register<Name>(server: McpServer, ...clients): void`
6. Schema: Zod fuer Input-Validierung
7. Return: MCP-konformes Result-Objekt (`{ content: [{ type: "text", text: "..." }] }`)
8. Node 24 hat nativen `fetch` — kein extra HTTP-Client noetig

## Registrierung

9. `src/index.ts`: Import hinzufuegen + `register<Name>(server, ...)` aufrufen

## Falls ENV-Variablen noetig

10. In `~/.openclaw/.env` eintragen
11. In `openclaw.json` → `mcp.servers.openclaw-tools.env` durchreichen

## Dokumentation (NICHT vergessen!)

12. `CLAUDE.md` (Root) — Tool in Liste einfuegen
    → Abschnitt "OpenClaw Tool-Hub MCP", alphabetisch nach letztem Tool-Eintrag
13. `components/tool-hub/description.md` — Architektur (Dateibaum) + Abhaengigkeiten aktualisieren
14. `components/tool-hub/testinstruct.md` — Test-Case hinzufuegen (curl-Befehl + Erwartung)
15. `components/tool-hub/decisions.md` — Entscheidung dokumentieren falls nicht-trivial

## PIM-Tools (nur falls Agent-Scoping noetig)

16. `src/config/pim.json` — Neue Quelle + Agent-Berechtigungen eintragen
17. `pim-access.ts` nutzen fuer Scoping (Agent-ID aus Request)
18. pim.json nicht hot-reloadable — Aenderung braucht Gateway-Restart

## Deploy

19. Weiter mit `deploy-checklist.md`
