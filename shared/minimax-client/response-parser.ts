/** Strip <think>...</think> tags from model output. */
export function stripThinkTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

/**
 * Parse JSON array from potentially messy LLM output.
 * Handles: code fences, think tags, trailing text, empty responses.
 */
export function parseJsonArray<T>(raw: string): T[] {
  const cleaned = stripThinkTags(raw);
  let jsonStr = cleaned;

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const arrStart = jsonStr.indexOf('[');
  const arrEnd = jsonStr.lastIndexOf(']');
  if (arrStart === -1 || arrEnd === -1 || arrEnd <= arrStart) return [];

  jsonStr = jsonStr.slice(arrStart, arrEnd + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed as T[];
  } catch {
    return [];
  }
}

/** Parse JSON object from potentially messy LLM output. */
export function parseJsonObject<T>(raw: string): T | null {
  const cleaned = stripThinkTags(raw);
  let jsonStr = cleaned;

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(jsonStr.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
