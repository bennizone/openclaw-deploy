/**
 * Sanitize LLM output by replacing Chinese numerals with Arabic digits
 * and stripping remaining CJK characters.
 *
 * Fixes MiniMax language bleeding (GitHub MiniMax-AI/MiniMax-01#28).
 */

const CN_DIGITS: Record<string, string> = {
  "零": "0", "〇": "0",
  "一": "1", "壹": "1",
  "二": "2", "贰": "2", "两": "2",
  "三": "3", "叁": "3",
  "四": "4", "肆": "4",
  "五": "5", "伍": "5",
  "六": "6", "陆": "6",
  "七": "7", "柒": "7",
  "八": "8", "捌": "8",
  "九": "9", "玖": "9",
  "十": "10", "百": "100", "千": "1000",
};

// CJK Unified Ideographs + CJK Compatibility + Fullwidth Forms
const CJK_RE = /[\u2e80-\u2eff\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uff60]/g;

/**
 * Replace Chinese digit characters with Arabic numerals,
 * then strip any remaining CJK characters.
 */
export function sanitizeCjk(text: string): string {
  if (!text) return text;

  // First pass: replace known Chinese digit characters
  let result = text;
  for (const [cn, ar] of Object.entries(CN_DIGITS)) {
    if (result.includes(cn)) {
      result = result.split(cn).join(ar);
    }
  }

  // Second pass: strip any remaining CJK characters
  result = result.replace(CJK_RE, "");

  // Clean up double spaces left by removals
  result = result.replace(/  +/g, " ").trim();

  return result;
}

/** Quick check if text contains any CJK characters. */
export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}
