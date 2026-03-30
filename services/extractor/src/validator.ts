import type { ExtractedFact } from './extractor.js';
import { config } from './config.js';

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateFact(fact: ExtractedFact): ValidationResult {
  if (!fact.fact || fact.fact.trim().length < 10) {
    return { valid: false, reason: 'too_short' };
  }

  if (fact.confidence < config.confidenceFloor) {
    return { valid: false, reason: `confidence_${fact.confidence}_below_${config.confidenceFloor}` };
  }

  return { valid: true };
}
