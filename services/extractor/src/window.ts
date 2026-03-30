import type { Turn } from './parser.js';
import { config } from './config.js';

export interface TurnSummary {
  userText: string;
  assistantText: string;
  turnIndex: number;
}

export interface ExtractionWindow {
  context: TurnSummary[];
  current: TurnSummary;
  followup: TurnSummary[];
  knownFacts: string[];
  agentId: string;
  agentDisplayName: string;
  sessionId: string;
  timestamp: string;
  turnIndex: number;
}

/**
 * Build a sliding window around the turn at `index` in the turns array.
 */
export function buildWindow(turns: Turn[], index: number): ExtractionWindow {
  const current = turns[index];

  // Context: up to N previous turns
  const contextStart = Math.max(0, index - config.slidingWindowBefore);
  const context: TurnSummary[] = turns.slice(contextStart, index).map(t => ({
    userText: t.userText,
    assistantText: t.assistantText,
    turnIndex: t.turnIndex,
  }));

  // Followup: next N turns for correction detection (config-driven)
  const followupEnd = Math.min(turns.length, index + 1 + config.slidingWindowAfter);
  const followup: TurnSummary[] = turns.slice(index + 1, followupEnd).map(t => ({
    userText: t.userText,
    assistantText: t.assistantText,
    turnIndex: t.turnIndex,
  }));

  return {
    context,
    current: {
      userText: current.userText,
      assistantText: current.assistantText,
      turnIndex: current.turnIndex,
    },
    followup,
    knownFacts: [],
    agentId: current.agentId,
    agentDisplayName: current.agentId,
    sessionId: current.sessionId,
    timestamp: current.timestamp,
    turnIndex: current.turnIndex,
  };
}

/**
 * Format a window into the prompt text for the extraction LLM.
 * 4-section format: known_facts, context, current, followup — each with role hints.
 */
export function formatWindowPrompt(window: ExtractionWindow): string {
  let prompt = '';

  // Known facts first — so the LLM knows what's already stored
  if (window.knownFacts.length > 0) {
    prompt += '<known_facts hint="Bereits gespeicherte Fakten zu diesem Thema. Nutze diese um Duplikate zu vermeiden und Widersprueche zu erkennen.">\n';
    for (const f of window.knownFacts) {
      prompt += `- ${f}\n`;
    }
    prompt += '</known_facts>\n\n';
  } else {
    prompt += '<known_facts hint="Bereits gespeicherte Fakten zu diesem Thema.">\nKeine bekannten Fakten zu diesem Thema.\n</known_facts>\n\n';
  }

  const userName = window.agentDisplayName;

  // Context turns — for understanding only
  if (window.context.length > 0) {
    prompt += '<context hint="Vorherige Turns — NUR als Kontext. Hier NICHT extrahieren, diese wurden bereits verarbeitet.">\n';
    for (const t of window.context) {
      prompt += `${userName}: ${t.userText}\nAssistent: ${t.assistantText}\n\n`;
    }
    prompt += '</context>\n\n';
  }

  // Current turn — extraction source
  prompt += `<current hint="AKTUELLER Turn — extrahiere NUR aus der Nachricht von ${userName}. Die Assistenten-Antwort ist nur Kontext.">\n`;
  prompt += `${userName}: ${window.current.userText}\n`;
  prompt += `Assistent: ${window.current.assistantText}\n`;
  prompt += '</current>\n';

  // Followup turns — check for self-corrections
  if (window.followup.length > 0) {
    prompt += '\n<followup hint="Folge-Turns — pruefen ob der User sich selbst korrigiert oder revidiert hat.">\n';
    for (const t of window.followup) {
      prompt += `${userName}: ${t.userText}\nAssistent: ${t.assistantText}\n\n`;
    }
    prompt += '</followup>\n';
  }

  return prompt;
}
