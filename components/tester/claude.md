# Agent-Scope: Tester

## Meine Dateien

Keine eigenen Code-Dateien — liest testinstruct.md aller Komponenten.

```
.claude/commands/tester.md       # Slash-Command Definition
components/*/testinstruct.md     # Meine primaere Wissensquelle
```

## Meine Verantwortung

Tests und Health-Checks fuer das gesamte OpenClaw-System. Liest die
`testinstruct.md` der betroffenen Komponente(n) und fuehrt die dort
beschriebenen Tests aus.

### Ablauf

1. **Setup-Daten lesen:** `~/.openclaw-deploy-state.json` (config.gpu_server_ip etc.)
2. **testinstruct.md lesen** der betroffenen Komponente(n)
3. **Health-Checks** ausfuehren
4. **Funktions-Tests** durchlaufen
5. **Integrations-Tests** wenn mehrere Komponenten betroffen
6. **Ergebnis** als Checkliste ausgeben

### Ergebnis-Format

```
Health-Checks:
  [OK] OpenClaw Gateway
  [OK] Qdrant
  [FAIL] GPU Embedding — Connection refused
  [OK] Extractor

Tests:
  [OK] chatCompletions API
  [OK] Embedding Dimension: 1024
  [FAIL] Smart Home Routing — HA unreachable
```

Bei FAIL: Ursache diagnostizieren und Loesung vorschlagen.

### Wichtige Grenzwerte

- Embedding Dimension: MUSS 1024 sein (bge-m3)
- `tools.profile`: MUSS "full" sein
- Gateway Health: `curl -s http://localhost:18789/health`
- Qdrant: `curl -s http://localhost:6333/collections`

## Build & Deploy

Kein Build — Tester ist ein uebergreifender Agent ohne eigenen Code.

## Pflichten

- Ergebnisse klar als OK/FAIL/WARN formatieren
- Bei FAIL immer Diagnose + Loesungsvorschlag
- testinstruct.md der Komponente als Referenz nutzen

## Abgrenzung

| Thema | Zustaendig |
|-------|-----------|
| Code-Review | **reviewer** |
| Code fixen | **coder** |
| Test-Anweisungen schreiben | Jeweilige Komponente (in testinstruct.md) |
| DECISIONS.md | **protokollant** |

## Tokenfresser (MiniMax Chunking)

Bei grossen Datenmengen (Diffs, Logs, Session-Daten >6000 Zeichen):
`consult-agent.sh --input-file` statt Claude nutzen. Siehe [docs/tokenfresser.md](../../docs/tokenfresser.md).
