/**
 * Customer "coming soon" interest for offerings that are visible but not
 * fulfillable as aged pay-per-lead orders.
 *
 * Stored with the same notes-metadata style as sa360.portalAgedOptions.v1.
 * Do not add a migration for this beta flag.
 */

export const AVAILABILITY_INTEREST_MARKER = "sa360.availabilityInterest.v1";

export const AVAILABILITY_INTEREST_OFFERINGS = ["fresh_leads", "live_transfer"] as const;

export type AvailabilityInterestOffering = (typeof AVAILABILITY_INTEREST_OFFERINGS)[number];

export type AvailabilityInterest = {
  requestedOffering: AvailabilityInterestOffering;
  notifyWhenAvailable: true;
  capturedAt: string;
};

const OFFERING_SET = new Set<string>(AVAILABILITY_INTEREST_OFFERINGS);

/** Public client catalog. Internal sentinels are not in this list. */
export const PUBLIC_CLIENT_CAMPAIGN_TYPES = ["Aged leads", "Fresh leads", "Live transfer"] as const;

export type PublicClientCampaignType = (typeof PUBLIC_CLIENT_CAMPAIGN_TYPES)[number];

/** Server-owned persisted campaign type for new Coming Soon requests. */
export const AVAILABILITY_INTEREST_CAMPAIGN_PREFIX = "availability_interest:";

const NOTES_LIMIT = 2000;

export function isAvailabilityInterestOffering(
  value: unknown
): value is AvailabilityInterestOffering {
  return typeof value === "string" && OFFERING_SET.has(value);
}

/**
 * Accept only the public catalog, after trim, case fold, and hyphen-to-space.
 * Underscores and unknown words stay rejected so ppl_aged, Fresh Lead, and
 * availability_interest:* cannot enter as a client campaign.
 */
export function normalizePublicClientCampaignType(
  value: unknown
): PublicClientCampaignType | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase().replace(/-+/g, " ").replace(/\s+/g, " ");
  if (token === "aged leads") return "Aged leads";
  if (token === "fresh leads") return "Fresh leads";
  if (token === "live transfer") return "Live transfer";
  return null;
}

export function availabilityInterestCampaignType(
  offering: AvailabilityInterestOffering
): string {
  return `${AVAILABILITY_INTEREST_CAMPAIGN_PREFIX}${offering}`;
}

/** Internal persisted sentinel only. Bare "Fresh leads" is not an interest campaign. */
export function availabilityInterestOfferingFromCampaignType(
  campaignType: string | null | undefined
): AvailabilityInterestOffering | null {
  const trimmed = campaignType?.trim() ?? "";
  if (!trimmed.startsWith(AVAILABILITY_INTEREST_CAMPAIGN_PREFIX)) return null;
  const offering = trimmed.slice(AVAILABILITY_INTEREST_CAMPAIGN_PREFIX.length);
  return isAvailabilityInterestOffering(offering) ? offering : null;
}

export function campaignTypeToAvailabilityOffering(
  campaignType: string | null | undefined
): AvailabilityInterestOffering | null {
  const normalized = normalizePublicClientCampaignType(campaignType);
  if (normalized === "Fresh leads") return "fresh_leads";
  if (normalized === "Live transfer") return "live_transfer";
  return availabilityInterestOfferingFromCampaignType(campaignType);
}

export function isComingSoonCampaignType(campaignType: string | null | undefined): boolean {
  const normalized = normalizePublicClientCampaignType(campaignType);
  return normalized === "Fresh leads" || normalized === "Live transfer";
}

export function availabilityInterestOfferingLabel(offering: AvailabilityInterestOffering): string {
  return offering === "fresh_leads" ? "Fresh Leads" : "Live Transfer";
}

export function parseAvailabilityInterestFromNotes(
  notes: string | null | undefined
): AvailabilityInterest | null {
  if (!notes) return null;
  const markerIndex = notes.indexOf(AVAILABILITY_INTEREST_MARKER);
  if (markerIndex < 0) return null;
  const afterMarker = notes.slice(markerIndex + AVAILABILITY_INTEREST_MARKER.length).trim();
  const jsonMatch = afterMarker.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return normalizeAvailabilityInterest(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function normalizeAvailabilityInterest(
  raw: Record<string, unknown>
): AvailabilityInterest | null {
  if (raw.notifyWhenAvailable !== true) return null;
  if (!isAvailabilityInterestOffering(raw.requestedOffering)) return null;
  const capturedAt = typeof raw.capturedAt === "string" ? raw.capturedAt.trim() : "";
  return {
    requestedOffering: raw.requestedOffering,
    notifyWhenAvailable: true,
    capturedAt,
  };
}

export function stripAvailabilityInterestFromNotes(notes: string): string {
  if (!notes.includes(AVAILABILITY_INTEREST_MARKER)) return notes.trim();
  return notes
    .replace(
      new RegExp(
        `(?:\\n---\\n)?${AVAILABILITY_INTEREST_MARKER.replace(/\./g, "\\.")}\\s*\\{[\\s\\S]*?\\}`,
        "g"
      ),
      ""
    )
    .replace(/^---\s*$/gm, "")
    .trim();
}

export function formatAvailabilityInterestAppendix(interest: AvailabilityInterest): string {
  return `${AVAILABILITY_INTEREST_MARKER} ${JSON.stringify({
    requestedOffering: interest.requestedOffering,
    notifyWhenAvailable: true,
    capturedAt: interest.capturedAt,
  })}`;
}

export function mergeAvailabilityInterestIntoNotes(
  customerNotes: string,
  interest: AvailabilityInterest
): string {
  const cleaned = stripAvailabilityInterestFromNotes(customerNotes).trim();
  const appendix = formatAvailabilityInterestAppendix(interest);
  if (!cleaned) return appendix.slice(0, NOTES_LIMIT);
  const separator = "\n---\n";
  const room = NOTES_LIMIT - appendix.length - separator.length;
  const customer = room > 0 ? cleaned.slice(0, room).trimEnd() : "";
  if (!customer) return appendix.slice(0, NOTES_LIMIT);
  return `${customer}${separator}${appendix}`;
}

/**
 * Hard stop for aged PPL approve / activate / select / reserve / export.
 * Blocks the server-owned availability_interest:* campaign type, or a valid
 * notes marker. A historical "Fresh leads" / "Live transfer" row is not blocked
 * by campaign type alone.
 */
export function agedPplFulfillmentBlocker(input: {
  campaignType?: string | null;
  notes?: string | null;
}): "availability_interest_only" | null {
  if (availabilityInterestOfferingFromCampaignType(input.campaignType)) {
    return "availability_interest_only";
  }
  if (parseAvailabilityInterestFromNotes(input.notes)) return "availability_interest_only";
  return null;
}
