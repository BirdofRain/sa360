const US_STATE_NAME_TO_CODE: Record<string, string> = {
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

const US_CODES = new Set(Object.values(US_STATE_NAME_TO_CODE));

const US_STATE_NAME_COMPACT: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_NAME_TO_CODE).map(([name, code]) => [name.replace(/\s+/g, ""), code])
);
US_STATE_NAME_COMPACT.washingtondc = "DC";

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
  return US_CODES.has(code) ? code : null;
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
    return US_CODES.has(code) ? code : null;
  }
  if (matchWashingtonDc(trimmed)) return "DC";
  const dotted = matchDottedOrSpacedStateCode(trimmed);
  if (dotted) return dotted;
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

/** Extract a US state code from combined State/ZIP or full state name cells. */
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
    if (US_CODES.has(code)) return code;
  }

  const embedded = trimmed.toUpperCase().match(/\b([A-Z]{2})\b/);
  if (embedded && US_CODES.has(embedded[1]!)) return embedded[1]!;
  return null;
}

/**
 * Optional ZIP extraction from combined State/ZIP cells.
 * Never affects inventory eligibility — sales context only.
 * Typical historical forms: "NC 27513", "NC, 27513", "NC / 27513", "TX 75001-1234".
 * Also recovers concatenated allowlisted state+ZIP: "NC27513", "North Carolina27513".
 */
export function extractUsZipCode(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/\b(\d{5})(?:-(\d{4}))?\b/);
  if (match) return match[2] ? `${match[1]}-${match[2]}` : match[1]!;
  const withZip = splitKnownStateAndZip(trimmed);
  return withZip?.zip ?? null;
}
