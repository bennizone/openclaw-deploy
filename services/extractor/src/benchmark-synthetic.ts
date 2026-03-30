/**
 * Synthetic benchmark: realistic conversations with known facts.
 * Tests extraction + verification with ground truth.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { config, log } from './config.js';

// Resolve agent display name
function agentDisplayName(agentId: string): string {
  return config.agentNames[agentId] ?? agentId;
}
import { initQdrant, ensureCollections, searchSimilar, collectionName } from './qdrant.js';
import { buildWindow, formatWindowPrompt, type ExtractionWindow, type TurnSummary } from './window.js';
import { extractFacts, type ExtractedFact } from './extractor.js';
import { embed } from './embedder.js';
import { verifyFact, verifyFactMiniMax, verifyFactQwenThink } from './verifier.js';
import { validateFact } from './validator.js';
import type { Turn } from './parser.js';

// ── Synthetic conversations with ground truth ──

interface SyntheticConversation {
  name: string;
  agentId: string;
  turns: Array<{ user: string; assistant: string }>;
  expectedFacts: string[];    // Facts that SHOULD be extracted
  expectedRejects: string[];  // Things that should NOT be extracted
}

const CONVERSATIONS: SyntheticConversation[] = [
  {
    name: 'Licht-Praeferenzen',
    agentId: 'benni',
    turns: [
      {
        user: 'Mach mal das Licht im Wohnzimmer an',
        assistant: 'Das Licht im Wohnzimmer ist jetzt an. Soll ich eine bestimmte Helligkeit oder Farbtemperatur einstellen?',
      },
      {
        user: 'Ja, abends mag ich es gerne warmweiß, so 2700K oder wärmer. Nicht so kalt.',
        assistant: 'Verstanden! Ich habe das Wohnzimmer-Licht auf 2700K eingestellt. Gemütlich warm!',
      },
      {
        user: 'Perfekt, genau so.',
        assistant: 'Schön! Ich merke mir, dass du abends warmweißes Licht bevorzugst.',
      },
    ],
    expectedFacts: ['Benni bevorzugt abends warmweißes Licht (2700K oder wärmer)'],
    expectedRejects: ['Wohnzimmer-Licht ist an', 'Licht auf 2700K eingestellt'],
  },
  {
    name: 'Pizza-Praeferenz mit Korrektur',
    agentId: 'benni',
    turns: [
      {
        user: 'Bestell uns mal Pizza heute Abend',
        assistant: 'Klar! Was für Pizza möchtet ihr?',
      },
      {
        user: 'Ich mag am liebsten Margherita mit extra Käse. Domi will immer Hawaii.',
        assistant: 'Also eine Margherita mit extra Käse für dich und eine Hawaii für Domi. Soll ich bestellen?',
      },
      {
        user: 'Moment, Domi hat gesagt sie will diesmal Salami statt Hawaii.',
        assistant: 'Ok, dann Margherita mit extra Käse für dich und Salami für Domi!',
      },
    ],
    expectedFacts: [
      'Benni mag am liebsten Pizza Margherita mit extra Käse',
      'Domi will Salami-Pizza (korrigiert von Hawaii)',
    ],
    expectedRejects: ['Pizza bestellt', 'heute Abend Pizza'],
  },
  {
    name: 'Serien-Praeferenzen',
    agentId: 'benni',
    turns: [
      {
        user: 'Haben wir Scrubs in der Bibliothek?',
        assistant: 'Ja, Scrubs ist vorhanden! Alle 9 Staffeln.',
      },
      {
        user: 'Super, das ist meine Lieblingsserie. Und schau mal ob Breaking Bad auch da ist.',
        assistant: 'Breaking Bad ist auch verfügbar, alle 5 Staffeln plus El Camino.',
      },
      {
        user: 'Nice. Wir schauen gerade die zweite Staffel Breaking Bad zusammen.',
        assistant: 'Viel Spaß! Breaking Bad wird ab Staffel 3 richtig intensiv.',
      },
    ],
    expectedFacts: [
      'Scrubs ist Bennis Lieblingsserie',
      'Benni und Domi schauen gerade Breaking Bad Staffel 2',
    ],
    expectedRejects: ['Scrubs hat 9 Staffeln', 'Breaking Bad hat 5 Staffeln'],
  },
  {
    name: 'Schlafzimmer-Einstellungen',
    agentId: 'benni',
    turns: [
      {
        user: 'Wie warm ist es im Schlafzimmer?',
        assistant: 'Im Schlafzimmer sind es aktuell 21.3°C bei 45% Luftfeuchtigkeit.',
      },
      {
        user: 'Das ist zu warm zum Schlafen. Wir schlafen am liebsten bei 18 Grad.',
        assistant: 'Verstanden! Soll ich die Heizung im Schlafzimmer auf 18°C stellen?',
      },
      {
        user: 'Ja bitte. Und ab 22 Uhr sollte die Heizung immer automatisch auf 18 Grad runterregeln.',
        assistant: 'Erledigt! Die Heizung im Schlafzimmer regelt jetzt ab 22 Uhr auf 18°C herunter.',
      },
    ],
    expectedFacts: [
      'Bevorzugte Schlaftemperatur ist 18 Grad',
      'Heizung Schlafzimmer soll ab 22 Uhr auf 18 Grad runterregeln',
    ],
    expectedRejects: ['Schlafzimmer 21.3°C', '45% Luftfeuchtigkeit'],
  },
  {
    name: 'Rein technisch — keine Facts',
    agentId: 'household',
    turns: [
      {
        user: 'Welche Lichter gibt es?',
        assistant: 'Es gibt 12 Light-Entities: Ambiente, Deckenlampe Wohnzimmer, Sternenhimmel...',
      },
      {
        user: 'Zeig mir die area_id für jede Entity',
        assistant: 'Die State-API gibt leider keine area_id zurück. Die steckt im Entity Registry.',
      },
    ],
    expectedFacts: [],
    expectedRejects: ['12 Light-Entities', 'area_id nicht verfügbar'],
  },
  {
    name: 'Implizite Bestaetigung',
    agentId: 'benni',
    turns: [
      {
        user: 'Erzähl mir was über Katzen',
        assistant: 'Katzen sind faszinierende Tiere! Habt ihr eine Katze?',
      },
      {
        user: 'Ja, wir haben zwei Katzen. Luna und Milo.',
        assistant: 'Oh wie süß! Luna und Milo, schöne Namen!',
      },
    ],
    expectedFacts: [
      'Im Haushalt gibt es zwei Katzen: Luna und Milo',
    ],
    expectedRejects: ['Katzen sind faszinierende Tiere'],
  },
  {
    name: 'Sensorwerte ohne Praeferenz',
    agentId: 'benni',
    turns: [
      {
        user: 'Wie ist das Klima im Wohnzimmer?',
        assistant: 'Wohnzimmer: 22.1°C, 42% Luftfeuchtigkeit, CO2 bei 650ppm.',
      },
      {
        user: 'Ok danke',
        assistant: 'Gerne! Sag Bescheid wenn du was ändern möchtest.',
      },
    ],
    expectedFacts: [],
    expectedRejects: ['22.1°C', '42% Luftfeuchtigkeit', '650ppm CO2'],
  },
  {
    name: 'Medien-Wunsch',
    agentId: 'benni',
    turns: [
      {
        user: 'Kannst du Severance zur Watchlist hinzufügen? Das will ich unbedingt schauen.',
        assistant: 'Severance wurde zur Watchlist hinzugefügt!',
      },
    ],
    expectedFacts: ['Benni will Severance schauen'],
    expectedRejects: [],
  },
  {
    name: 'Familieninfo',
    agentId: 'benni',
    turns: [
      {
        user: 'Nächsten Samstag kommen meine Eltern zu Besuch, die wohnen in Stuttgart.',
        assistant: 'Notiert! Soll ich dich am Freitag daran erinnern?',
      },
      {
        user: 'Ja, gute Idee.',
        assistant: 'Erinnerung für Freitag ist gesetzt!',
      },
    ],
    expectedFacts: [
      'Bennis Eltern wohnen in Stuttgart',
    ],
    expectedRejects: ['Besuch nächsten Samstag'],
  },
  {
    name: 'Assistent behauptet — User ignoriert',
    agentId: 'benni',
    turns: [
      {
        user: 'Mach das Licht aus',
        assistant: 'Alles klar! Du scheinst ein Nachtmensch zu sein, um diese Uhrzeit noch wach!',
      },
      {
        user: 'Danke',
        assistant: 'Gute Nacht!',
      },
    ],
    expectedFacts: [],
    expectedRejects: ['Nachtmensch', 'Licht ist aus'],
  },
];

interface CandidateResult {
  conversation: string;
  fact: string;
  type: string;
  confidence: number;
  scope: string;
  sourceContext: string;
  validation: { valid: boolean; reason?: string };
  verification: {
    qwen: { verified: boolean; reason: string };
    qwenThink: { verified: boolean; reason: string };
    minimax: { verified: boolean; reason: string };
  };
}

async function main(): Promise<void> {
  log('info', 'benchmark', '═══════════════════════════════════════════');
  log('info', 'benchmark', 'Synthetic Benchmark — Ground Truth Test');
  log('info', 'benchmark', '═══════════════════════════════════════════');

  initQdrant();
  await ensureCollections();

  const allCandidates: CandidateResult[] = [];
  let totalExpected = 0;
  let totalExpectedRejects = 0;

  for (const conv of CONVERSATIONS) {
    console.log(`\n━━━ ${conv.name} (${conv.turns.length} turns) ━━━`);
    totalExpected += conv.expectedFacts.length;
    totalExpectedRejects += conv.expectedRejects.length;

    // Build Turn objects
    const turns: Turn[] = conv.turns.map((t, i) => ({
      turnIndex: i,
      userText: t.user,
      assistantText: t.assistant,
      timestamp: new Date().toISOString(),
      sessionId: `synthetic-${conv.name}`,
      agentId: conv.agentId,
    }));

    // Process each turn
    for (let i = 0; i < turns.length; i++) {
      const window = buildWindow(turns, i);
      window.agentDisplayName = agentDisplayName(conv.agentId);

      // Get known facts from Qdrant
      const turnText = `${turns[i].userText} ${turns[i].assistantText}`.slice(0, 500);
      try {
        const embResult = await embed(turnText);
        const collections = conv.agentId === 'household'
          ? [collectionName('household')]
          : [collectionName(conv.agentId), collectionName('household')];

        for (const coll of collections) {
          try {
            const similar = await searchSimilar(coll, embResult.vector, config.knownFactsLimit, config.knownFactsScoreThreshold);
            for (const s of similar) {
              if (!window.knownFacts.includes(s.fact)) {
                window.knownFacts.push(s.fact);
              }
            }
          } catch { /* empty collection */ }
        }
      } catch { /* embedding fail */ }

      // Extract
      const facts = await extractFacts(window);

      if (facts.length === 0) {
        console.log(`  Turn ${i}: (no candidates)`);
        continue;
      }

      for (const fact of facts) {
        console.log(`  Turn ${i}: [${fact.scope}/${fact.type}] "${fact.fact}"`);

        const validation = validateFact(fact);

        // Verify with all three (Qwen no-think runs parallel with MiniMax, then Qwen think sequential to avoid GPU contention)
        const [qwen, minimax] = await Promise.all([
          verifyFact(fact.fact, window),
          verifyFactMiniMax(fact.fact, window),
        ]);
        const qwenThink = await verifyFactQwenThink(fact.fact, window);

        const qMark = qwen.verified ? '✓' : '✗';
        const qtMark = qwenThink.verified ? '✓' : '✗';
        const mMark = minimax.verified ? '✓' : '✗';
        const vMark = validation.valid ? '✓' : '✗';
        console.log(`    Valid: ${vMark} | Qwen: ${qMark} | Qwen-Think: ${qtMark} | MiniMax: ${mMark}`);
        console.log(`      Qwen: ${qwen.reason}`);
        console.log(`      Qwen-Think: ${qwenThink.reason}`);
        console.log(`      MiniMax: ${minimax.reason}`);

        allCandidates.push({
          conversation: conv.name,
          fact: fact.fact,
          type: fact.type,
          confidence: fact.confidence,
          scope: fact.scope ?? 'personal',
          sourceContext: fact.sourceContext,
          validation,
          verification: { qwen, qwenThink, minimax },
        });
      }
    }

    // Check expected vs actual
    console.log(`  Expected facts: ${conv.expectedFacts.length}`);
    for (const ef of conv.expectedFacts) {
      console.log(`    → ${ef}`);
    }
    if (conv.expectedRejects.length > 0) {
      console.log(`  Should NOT extract: ${conv.expectedRejects.length}`);
      for (const er of conv.expectedRejects) {
        console.log(`    ✗ ${er}`);
      }
    }
  }

  // Summary
  const validAccepted = allCandidates.filter(c => c.validation.valid).length;
  const qwenAccepted = allCandidates.filter(c => c.verification.qwen.verified).length;
  const qwenThinkAccepted = allCandidates.filter(c => c.verification.qwenThink.verified).length;
  const minimaxAccepted = allCandidates.filter(c => c.verification.minimax.verified).length;
  const allThreeAccepted = allCandidates.filter(c => c.verification.qwen.verified && c.verification.qwenThink.verified && c.verification.minimax.verified).length;
  const allThreeRejected = allCandidates.filter(c => !c.verification.qwen.verified && !c.verification.qwenThink.verified && !c.verification.minimax.verified).length;
  const majorityAccepted = allCandidates.filter(c => [c.verification.qwen.verified, c.verification.qwenThink.verified, c.verification.minimax.verified].filter(Boolean).length >= 2).length;

  console.log('\n═══════════════════════════════════════════');
  console.log('SYNTHETIC BENCHMARK RESULTS');
  console.log('═══════════════════════════════════════════');
  console.log(`Conversations: ${CONVERSATIONS.length}`);
  console.log(`Expected facts total: ${totalExpected}`);
  console.log(`Expected rejects total: ${totalExpectedRejects}`);
  console.log(`Candidates extracted: ${allCandidates.length}`);
  console.log('');
  console.log(`Validator:     ${validAccepted} accepted / ${allCandidates.length - validAccepted} rejected`);
  console.log(`Qwen no-think: ${qwenAccepted} accepted / ${allCandidates.length - qwenAccepted} rejected`);
  console.log(`Qwen think:    ${qwenThinkAccepted} accepted / ${allCandidates.length - qwenThinkAccepted} rejected`);
  console.log(`MiniMax:       ${minimaxAccepted} accepted / ${allCandidates.length - minimaxAccepted} rejected`);
  console.log('');
  console.log(`All 3 agree:   ${allThreeAccepted} accepted, ${allThreeRejected} rejected`);
  console.log(`Majority (2/3): ${majorityAccepted} accepted`);

  console.log('\n─── ALL candidates detail ───');
  for (const c of allCandidates) {
    const q = c.verification.qwen.verified ? '✓' : '✗';
    const qt = c.verification.qwenThink.verified ? '✓' : '✗';
    const m = c.verification.minimax.verified ? '✓' : '✗';
    console.log(`[${c.conversation}] ${c.fact}`);
    console.log(`  type=${c.type} scope=${c.scope} conf=${c.confidence} qwen=${q} qwen-think=${qt} minimax=${m}`);
  }

  // Separate hard facts (majority accepted) from soft facts
  const hardFacts = allCandidates.filter(c => {
    const votes = [c.verification.qwen.verified, c.verification.qwenThink.verified, c.verification.minimax.verified].filter(Boolean).length;
    return c.validation.valid && votes >= 2;
  });
  const softFacts = allCandidates.filter(c => {
    const votes = [c.verification.qwen.verified, c.verification.qwenThink.verified, c.verification.minimax.verified].filter(Boolean).length;
    return c.validation.valid && votes < 2 && votes > 0;
  });
  const rejected = allCandidates.filter(c => {
    const votes = [c.verification.qwen.verified, c.verification.qwenThink.verified, c.verification.minimax.verified].filter(Boolean).length;
    return votes === 0;
  });

  console.log(`\n─── HARD FACTS (2/3 verifiers agree) → store immediately ───`);
  for (const c of hardFacts) {
    console.log(`  ✓ [${c.scope}/${c.type}] ${c.fact}`);
  }

  console.log(`\n─── SOFT FACTS (1/3 verifiers) → dream process queue ───`);
  for (const c of softFacts) {
    const q = c.verification.qwen.verified ? '✓' : '✗';
    const qt = c.verification.qwenThink.verified ? '✓' : '✗';
    const m = c.verification.minimax.verified ? '✓' : '✗';
    console.log(`  ? [${c.scope}/${c.type}] ${c.fact}  (qwen=${q} think=${qt} minimax=${m})`);
  }

  console.log(`\n─── REJECTED (0/3 verifiers) → discard ───`);
  for (const c of rejected) {
    console.log(`  ✗ [${c.scope}/${c.type}] ${c.fact}`);
  }

  // Save results
  const outPath = resolve(import.meta.dirname, '..', 'benchmark', 'synthetic-results.json');
  writeFileSync(outPath, JSON.stringify({
    meta: { date: new Date().toISOString(), conversations: CONVERSATIONS.length, expectedFacts: totalExpected },
    candidates: allCandidates,
    hardFacts: hardFacts.map(c => ({ fact: c.fact, type: c.type, scope: c.scope, confidence: c.confidence, conversation: c.conversation })),
    softFacts: softFacts.map(c => ({ fact: c.fact, type: c.type, scope: c.scope, confidence: c.confidence, conversation: c.conversation, qwen: c.verification.qwen, minimax: c.verification.minimax })),
    summary: { totalCandidates: allCandidates.length, hardFacts: hardFacts.length, softFacts: softFacts.length, rejected: rejected.length, validAccepted, qwenAccepted, qwenThinkAccepted, minimaxAccepted, allThreeAccepted, allThreeRejected, majorityAccepted },
  }, null, 2));
  console.log(`\nResults saved to: ${outPath}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
