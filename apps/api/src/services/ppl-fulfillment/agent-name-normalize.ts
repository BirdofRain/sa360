const SIMPLE_PUNCTUATION_RE = /[.,'"`()[\]{}:;!?/\\|@#$%^&*+=~<>\u2010-\u2015-]+/g;

/**
 * Normalize agent display names for stable exclusion matching.
 */
export function normalizeAgentName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(SIMPLE_PUNCTUATION_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
