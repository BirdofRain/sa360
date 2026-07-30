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

/** Extract a US state code from combined State/ZIP or full state name cells. */
export function extractUsStateCode(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    return US_CODES.has(code) ? code : null;
  }
  const byName = US_STATE_NAME_TO_CODE[trimmed.toLowerCase()];
  if (byName) return byName;

  const twoLetterPlusZip = trimmed.match(/^([A-Za-z]{2})[\s/,\-]+/);
  if (twoLetterPlusZip) {
    const code = twoLetterPlusZip[1]!.toUpperCase();
    if (US_CODES.has(code)) return code;
  }

  const embedded = trimmed.toUpperCase().match(/\b([A-Z]{2})\b/);
  if (embedded && US_CODES.has(embedded[1]!)) return embedded[1]!;
  return null;
}
