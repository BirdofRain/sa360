/**
 * Deterministic LeadCapture funnel/form-name niche parser.
 *
 * Used only after explicit trusted niche fields are absent. Does not treat
 * agent/client names as identity. Does not guess when no listed pattern matches.
 */

export const LEADCAPTURE_INVENTORY_NICHE_KEYS = [
  "vet_fex",
  "nurse_life",
  "health_insurance",
  "trucker_life",
  "mortgage_protection",
  "final_expense",
] as const;

export type LeadCaptureInventoryNicheKey = (typeof LEADCAPTURE_INVENTORY_NICHE_KEYS)[number];

export type ParsedLeadCaptureNameNiche = {
  inventoryNicheKey: LeadCaptureInventoryNicheKey;
  recognizedNicheKey: "VET" | "NURSE" | "HEALTH" | "TRUCKER" | "MORTGAGE" | undefined;
};

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAME_PATTERNS: ReadonlyArray<{
  re: RegExp;
  parsed: ParsedLeadCaptureNameNiche;
}> = [
  {
    re: /\blife insurance for veterans?\b/,
    parsed: { inventoryNicheKey: "vet_fex", recognizedNicheKey: "VET" },
  },
  {
    re: /\bveterans?\b.*\b(life insurance|final expense)\b/,
    parsed: { inventoryNicheKey: "vet_fex", recognizedNicheKey: "VET" },
  },
  {
    re: /\blife insurance for nurses?\b/,
    parsed: { inventoryNicheKey: "nurse_life", recognizedNicheKey: "NURSE" },
  },
  {
    re: /\bnurses?\b.*\blife insurance\b/,
    parsed: { inventoryNicheKey: "nurse_life", recognizedNicheKey: "NURSE" },
  },
  {
    re: /\bself\s+employed health\b/,
    parsed: { inventoryNicheKey: "health_insurance", recognizedNicheKey: "HEALTH" },
  },
  {
    re: /\btruck(?:ers?| drivers?)\b/,
    parsed: { inventoryNicheKey: "trucker_life", recognizedNicheKey: "TRUCKER" },
  },
  {
    re: /\bmortgage protection\b/,
    parsed: { inventoryNicheKey: "mortgage_protection", recognizedNicheKey: "MORTGAGE" },
  },
  {
    re: /\bfinal expense\b/,
    parsed: { inventoryNicheKey: "final_expense", recognizedNicheKey: undefined },
  },
];

export function parseLeadCaptureFunnelNameNiche(
  label: unknown
): ParsedLeadCaptureNameNiche | undefined {
  if (typeof label !== "string") return undefined;
  const normalized = normalizeLabel(label);
  if (!normalized) return undefined;
  for (const pattern of NAME_PATTERNS) {
    if (pattern.re.test(normalized)) return pattern.parsed;
  }
  return undefined;
}

export function firstParsedLeadCaptureNameNiche(
  labels: readonly unknown[]
): ParsedLeadCaptureNameNiche | undefined {
  for (const label of labels) {
    const parsed = parseLeadCaptureFunnelNameNiche(label);
    if (parsed) return parsed;
  }
  return undefined;
}
