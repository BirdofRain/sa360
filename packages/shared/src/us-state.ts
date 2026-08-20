/** Contiguous US states + AK/HI + DC (51). Canonical inventory state allowlist. */
export const CANONICAL_US_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
] as const;

export type CanonicalUsStateCode = (typeof CANONICAL_US_STATE_CODES)[number];

export const CANONICAL_US_STATE_SET: ReadonlySet<string> = new Set(CANONICAL_US_STATE_CODES);

const US_STATE_NAME_TO_CODE: Record<string, CanonicalUsStateCode> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const US_STATE_NAME_COMPACT: Record<string, CanonicalUsStateCode> = Object.fromEntries(
  Object.entries(US_STATE_NAME_TO_CODE).map(([name, code]) => [name.replace(/\s+/g, ""), code])
) as Record<string, CanonicalUsStateCode>;
US_STATE_NAME_COMPACT.washingtondc = "DC";

const STATE_NAMES_LONGEST_FIRST = Object.keys(US_STATE_NAME_TO_CODE).sort(
  (a, b) => b.length - a.length
);

export function isCanonicalUsStateCode(value: string | null | undefined): value is CanonicalUsStateCode {
  return typeof value === "string" && CANONICAL_US_STATE_SET.has(value);
}

/** Keep only allowlisted two-letter codes, uppercased and de-duplicated. */
export function sanitizeCanonicalUsStates(values: readonly string[]): CanonicalUsStateCode[] {
  const out: CanonicalUsStateCode[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const code = value.trim().toUpperCase();
    if (!isCanonicalUsStateCode(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function collapseStateText(value: string): string {
  return value.trim().toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

function matchWashingtonDc(token: string): boolean {
  const n = collapseStateText(token);
  return n === "washington dc" || n === "washington d c";
}

/** Allowlisted two-letter codes with dots/spaces: N.C., S.C., N C, S C. */
function matchDottedOrSpacedStateCode(token: string): string | null {
  const m = token.trim().match(/^([A-Za-z])(?:\s*\.\s*|\s+)([A-Za-z])\s*\.?$/);
  if (!m) return null;
  const code = `${m[1]}${m[2]}`.toUpperCase();
  return CANONICAL_US_STATE_SET.has(code) ? code : null;
}

/** Two-letter code with a trailing period only: Tn., Ma. */
function matchTrailingPeriodStateCode(token: string): string | null {
  const m = token.trim().match(/^([A-Za-z]{2})\.$/);
  if (!m) return null;
  const code = m[1]!.toUpperCase();
  return CANONICAL_US_STATE_SET.has(code) ? code : null;
}

function lookupCompactStateName(token: string): string | null {
  const compact = token.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!compact) return null;
  return US_STATE_NAME_COMPACT[compact] ?? null;
}

/** Conservative allowlist lookup: code, dotted/spaced code, DC variants, or full name. */
function lookupStateToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    return CANONICAL_US_STATE_SET.has(code) ? code : null;
  }
  if (matchWashingtonDc(trimmed)) return "DC";
  const dotted = matchDottedOrSpacedStateCode(trimmed);
  if (dotted) return dotted;
  const trailing = matchTrailingPeriodStateCode(trimmed);
  if (trailing) return trailing;
  return US_STATE_NAME_TO_CODE[collapseStateText(trimmed)] ?? lookupCompactStateName(trimmed);
}

const TRAILING_ZIP = /^(.+?)[\s/,\-]*(\d{5})(?:-(\d{4}))?$/;

function splitKnownStateAndZip(trimmed: string): { state: string; zip: string } | null {
  const match = trimmed.match(TRAILING_ZIP);
  if (!match) return null;
  const prefix = match[1]!.trim();
  if (!prefix) return null;
  const state = lookupStateToken(prefix);
  if (!state) return null;
  const zip = match[3] ? `${match[2]}-${match[3]}` : match[2]!;
  return { state, zip };
}

function extractEmbeddedOfficialNames(trimmed: string): Set<string> {
  const resolved = new Set<string>();
  const lower = trimmed.toLowerCase();
  const consumed: Array<{ start: number; end: number }> = [];
  for (const name of STATE_NAMES_LONGEST_FIRST) {
    const re = new RegExp(`(^|[^a-z])(${name.replace(/ /g, "\\s+")})([^a-z]|$)`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(lower))) {
      const token = match[2]!;
      const start = match.index + match[1]!.length;
      const end = start + token.length;
      const overlaps = consumed.some((span) => start < span.end && end > span.start);
      if (overlaps) continue;
      consumed.push({ start, end });
      const code = US_STATE_NAME_TO_CODE[name];
      if (code) resolved.add(code);
    }
  }
  return resolved;
}

function extractEmbeddedStateCodes(trimmed: string): Set<string> {
  const resolved = new Set<string>();
  for (const match of trimmed.toUpperCase().matchAll(/\b([A-Z]{2})\b/g)) {
    const code = match[1]!;
    if (CANONICAL_US_STATE_SET.has(code)) resolved.add(code);
  }
  return resolved;
}

/**
 * Extract a US state code from combined State/ZIP, dotted abbreviations,
 * official names, or an explicit embedded two-letter code.
 * Never guesses from a city name alone or misspellings.
 */
export function extractUsStateCode(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();

  const direct = lookupStateToken(trimmed);
  if (direct) return direct;

  const withZip = splitKnownStateAndZip(trimmed);
  if (withZip) return withZip.state;

  const twoLetterPlusZip = trimmed.match(/^([A-Za-z]{2})[\s/,\-]+/);
  if (twoLetterPlusZip) {
    const code = twoLetterPlusZip[1]!.toUpperCase();
    if (CANONICAL_US_STATE_SET.has(code)) return code;
  }

  const names = extractEmbeddedOfficialNames(trimmed);
  const codes = extractEmbeddedStateCodes(trimmed);
  if (names.size === 1 && (codes.size === 0 || (codes.size === 1 && names.has([...codes][0]!)))) {
    return [...names][0]!;
  }
  if (names.size === 0 && codes.size === 1) {
    return [...codes][0]!;
  }
  return null;
}

/**
 * Optional ZIP extraction from combined State/ZIP cells.
 * Never affects inventory eligibility — sales context only.
 */
export function extractUsZipCode(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/\b(\d{5})(?:-(\d{4}))?\b/);
  if (match) return match[2] ? `${match[1]}-${match[2]}` : match[1]!;
  const withZip = splitKnownStateAndZip(trimmed);
  return withZip?.zip ?? null;
}
