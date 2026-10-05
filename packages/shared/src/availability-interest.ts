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

const CAMPAIGN_TO_OFFERING: Record<string, AvailabilityInterestOffering> = {
  "fresh leads": "fresh_leads",
  fresh_leads: "fresh_leads",
  "live transfer": "live_transfer",
  live_transfer: "live_transfer",
};

export function isAvailabilityInterestOffering(
  value: unknown
): value is AvailabilityInterestOffering {
  return typeof value === "string" && OFFERING_SET.has(value);
}

export function campaignTypeToAvailabilityOffering(
  campaignType: string | null | undefined
): AvailabilityInterestOffering | null {
  const key = campaignType?.trim().toLowerCase() ?? "";
  return CAMPAIGN_TO_OFFERING[key] ?? null;
}

export function isComingSoonCampaignType(campaignType: string | null | undefined): boolean {
  return campaignTypeToAvailabilityOffering(campaignType) != null;
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
  const cleaned = stripAvailabilityInterestFromNotes(customerNotes);
  const appendix = formatAvailabilityInterestAppendix(interest);
  const merged = cleaned ? `${cleaned}\n---\n${appendix}` : appendix;
  return merged.slice(0, 2000);
}

/**
 * Hard stop for aged PPL approve / activate / select / reserve / export.
 * Fresh leads and live transfer are not fulfillable even if the marker is removed.
 */
export function agedPplFulfillmentBlocker(input: {
  campaignType?: string | null;
  notes?: string | null;
}): "availability_interest_only" | null {
  if (isComingSoonCampaignType(input.campaignType)) return "availability_interest_only";
  if (parseAvailabilityInterestFromNotes(input.notes)) return "availability_interest_only";
  return null;
}
