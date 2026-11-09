/**
 * Payee identity helpers. PayGuard NEVER fuzzy-matches a payee onto the allowlist:
 * the only normalisation is trim + ASCII lowercase. Anything else (homoglyphs,
 * plus-tags, look-alike domains, trailing dots) is a different payee and the
 * Guard rejects it with PAYEE_NOT_ALLOWED.
 */

/** Strict, ASCII-only email shape. Non-ASCII (e.g. Cyrillic "а") is not canonical. */
const STRICT_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export function canonicalPayee(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isStrictEmail(raw: string): boolean {
  return STRICT_EMAIL.test(canonicalPayee(raw));
}

/**
 * Pull the first email-like token out of free text WITHOUT truncating it.
 * A naive ASCII regex would turn "хtools@goalworld.fun" (Cyrillic х) into the
 * allowlisted "tools@goalworld.fun" — that is exactly the snap we refuse.
 * We take the whole whitespace-delimited token and only strip wrapping punctuation.
 */
export function extractPayeeToken(text: string): string | undefined {
  for (const token of text.split(/\s+/)) {
    if (!token.includes("@")) continue;
    const cleaned = token
      .replace(/^[<("'`\[]+/, "")
      .replace(/[>)"'`\],;:!?]+$/, "")
      // sentence-ending period, but keep "fun." style trailing dot visible if doubled
      .replace(/(?<=\.[A-Za-z]{2,})\.$/, "");
    if (cleaned.includes("@")) return cleaned.toLowerCase();
  }
  return undefined;
}

export function isAllowlisted(payee: string, allow: Iterable<string>): boolean {
  const p = canonicalPayee(payee);
  if (!isStrictEmail(p)) return false;
  for (const a of allow) if (canonicalPayee(a) === p) return true;
  return false;
}
