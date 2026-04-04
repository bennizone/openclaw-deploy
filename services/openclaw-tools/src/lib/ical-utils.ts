/**
 * Shared RFC 5545 / RFC 6350 utilities for iCal and vCard parsing.
 *
 * Both iCalendar and vCard use the same line-folding convention
 * (CRLF + whitespace) and similar "FIELD;PARAMS:VALUE" syntax.
 */

/**
 * Unfold RFC-folded lines and extract the first matching field value.
 *
 * @param raw     - Raw iCal / vCard text (may contain folded lines)
 * @param field   - Field name to look for (e.g. "DTSTART", "FN", "TEL")
 * @param opts.ignoreCase  - Match field name case-insensitively (default: false)
 * @param opts.lastColon   - Use lastIndexOf(":") for param stripping (vCard style).
 *                           When false, uses indexOf(":") with an extra guard (iCal style).
 *                           Default: false.
 * @returns The extracted value string, or undefined if not found.
 */
export function unfoldField(
  raw: string,
  field: string,
  opts?: { ignoreCase?: boolean; lastColon?: boolean },
): string | undefined {
  const unfolded = raw.replace(/\r?\n[ \t]/g, "");
  const flags = opts?.ignoreCase ? "im" : "m";
  const re = new RegExp(`^${field}[;:](.*)$`, flags);
  const m = unfolded.match(re);
  if (!m) return undefined;

  const matched = m[1];

  if (opts?.lastColon) {
    // vCard style: value is after the *last* colon (handles TEL;TYPE=CELL:+49…)
    const colonIdx = matched.lastIndexOf(":");
    return colonIdx >= 0 ? matched.slice(colonIdx + 1).trim() : matched.trim();
  }

  // iCal style: strip params only when there is a colon AND the field matched at position 0
  const colonIdx = matched.indexOf(":");
  if (field === m[0].split(/[;:]/)[0] && matched.includes(":")) {
    return matched.slice(colonIdx + 1).trim();
  }
  return matched.trim();
}

/**
 * Unfold and extract *all* values for a repeating field (e.g. multiple TEL lines).
 */
export function unfoldFieldAll(
  raw: string,
  field: string,
  opts?: { ignoreCase?: boolean; lastColon?: boolean },
): string[] {
  const unfolded = raw.replace(/\r?\n[ \t]/g, "");
  const flags = opts?.ignoreCase ? "gim" : "gm";
  const re = new RegExp(`^${field}[;:](.*)$`, flags);
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(unfolded)) !== null) {
    const matched = m[1];
    let val: string;
    if (opts?.lastColon) {
      const colonIdx = matched.lastIndexOf(":");
      val = colonIdx >= 0 ? matched.slice(colonIdx + 1).trim() : matched.trim();
    } else {
      val = matched.trim();
    }
    if (val) results.push(val);
  }
  return results;
}
