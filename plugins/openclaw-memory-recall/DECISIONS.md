# openclaw-memory-recall — Entscheidungen & Features

## Feature

### Hybrid Memory Recall
**Status:** Aktiv seit 2026-03-28
- `before_prompt_build` Hook — laeuft vor jedem LLM-Call
- Hybrid Search: Dense (bge-m3) + BM25 (sparse) + RRF Fusion
- topK=5, Dedup nach Fact-Text
- Ergebnis wird als `prependContext` injiziert

## Architektur

```
src/
├── index.ts           — Plugin Entry, before_prompt_build Hook
└── bm25-tokenizer.ts  — FNV-1a Hashing, deutsche/englische Stop-Words
```

### Agent → Collection Mapping
```
benni     → memories_benni + memories_household
domi      → memories_domi + memories_household
household → memories_household
```

**Entscheidung:** Eigenes Plugin statt OpenClaw Built-in Memory
**Warum:** Built-in mem0 hat Probleme (1536-dim hardcoded, kein BM25, kein household scope).
Eigene Loesung gibt volle Kontrolle ueber Suche, Scoring und Scope-Logik.

**Entscheidung:** Hybrid Search (Dense + BM25) statt nur Dense
**Warum:** BM25 faengt exakte Keyword-Matches ab (Namen, Orte), Dense faengt
semantische Aehnlichkeit. RRF Fusion kombiniert beide Rankings.

**Entscheidung:** Household als geteilter Scope
**Warum:** Haushaltsinformationen ("Wir haben einen Staubsaugerroboter") sind
fuer alle Agenten relevant. Persoenliches bleibt getrennt.

## Config

```json
{
  "plugins.entries.openclaw-memory-recall": {
    "enabled": true,
    "config": {
      "qdrantUrl": "http://localhost:6333",
      "embedUrl": "http://<GPU_SERVER_IP>:8081",
      "embedFallbackUrl": "http://localhost:8081",
      "embeddingModel": "bge-m3",
      "topK": 5
    }
  }
}
```

## Embeddings
- GPU: bge-m3 Q8_0 via llama-server (<GPU_SERVER_IP>:8081, OpenAI `/v1/embeddings`)
- Fallback: bge-m3 Q8_0 via llama-server CPU (localhost:8081)
- API-Format: OpenAI-kompatibel (`data[0].embedding`, 1024-dim)

## BM25 Tokenizer Details
- FNV-1a Hashing fuer Term-IDs (Qdrant sparse vectors)
- Deutsche + englische Stop-Words gefiltert
- Umlaut-Normalisierung (ae→a, oe→o, ue→u, ss→s)
- IDF Modifier auf Qdrant Collection-Ebene

## Qdrant Collections
- Named Vectors: `dense` (1024-dim Cosine) + `bm25` (sparse, idf modifier)
- Collections: `memories_benni`, `memories_domi`, `memories_household`
- Collections: `instructions_benni`, `instructions_domi`, `instructions_household`

## Zeitbasierte Instructions (Phase 4, 2026-04-03)

**Entscheidung:** JSON-Datei statt Qdrant Payload-Filter
**Warum:** Zeitbasierte Instructions sind deterministisch (immer injizieren wenn Datum passt),
nicht semantisch. Qdrant-Payload-Filter fuer Datumsbereiche erzeugt Komplexitaet ohne Mehrwert.
JSON-Datei passt zum bestehenden Filesystem-Pattern (RULES.md).

**Dateipfad:** `~/.openclaw/workspace-<agentId>/timed-instructions.json`
(analog zu RULES.md im selben Verzeichnis)

**Schema:**
```json
[
  {
    "label": "Domis Geburtstag",
    "month": 5,
    "day": 15,
    "daysWindow": 7,
    "instruction": "Domis Geburtstag naht (15. Mai)"
  },
  {
    "label": "Adventszeit",
    "activeFrom": "2026-12-01",
    "activeTo": "2026-12-24",
    "instruction": "Wir sind in der Adventszeit"
  }
]
```
- Wiederkehrend (jaehrlich): `month` + `day` + `daysWindow` (Tage vorher aktiv)
- Einmalig/Saisonal: `activeFrom` + `activeTo` (ISO-Datum)
- Injection als `[Zeitbasierte Hinweise]` Block VOR `[Anweisungen]`
