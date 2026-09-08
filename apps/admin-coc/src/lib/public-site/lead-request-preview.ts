import {
  PORTAL_ORDER_REQUEST_STATE_OPTIONS,
  type PortalOrderRequestOption,
} from "@/lib/client-portal/portal-order-request";

/** Existing client order `campaignType` values — do not invent a new API enum. */
export const PUBLIC_VETERAN_FRESHNESS_OPTIONS = [
  {
    id: "fresh",
    campaignType: "Fresh leads",
    label: "Fresh",
    ageLabel: "Recent inquiries",
    description: "New Veteran inquiries, typically within the last few days.",
  },
  {
    id: "aged-30-90",
    campaignType: "Aged leads",
    label: "Aged · 30–90 days",
    ageLabel: "30–90 day bucket",
    description: "Veteran leads with time to cool — often the best conversations per dollar.",
  },
  {
    id: "aged-90-plus",
    campaignType: "Aged leads",
    label: "Aged · 90+ days",
    ageLabel: "90+ day bucket",
    description: "Deeper-aged Veteran inventory. Your account team confirms the exact age window.",
  },
] as const;

export type PublicVeteranFreshnessId = (typeof PUBLIC_VETERAN_FRESHNESS_OPTIONS)[number]["id"];

export const PUBLIC_LEAD_QUANTITY_PRESETS = [50, 100, 250, 500] as const;

export const PUBLIC_FEATURED_STATE_CODES = [
  "TX",
  "FL",
  "CA",
  "OH",
  "PA",
  "GA",
  "NC",
  "IL",
  "NY",
  "AZ",
  "MI",
  "VA",
] as const;

export const PUBLIC_PORTAL_SIGN_IN_HREF = "/portal/login";
export const PUBLIC_PORTAL_INVITE_HREF = "/portal/invite";
export const PUBLIC_PORTAL_PLACE_ORDER_NEXT = "/portal/orders/new";

export type PublicLeadPreviewDraft = {
  states: string[];
  quantity: number;
  freshnessId: PublicVeteranFreshnessId;
};

export function publicStateOptions(): PortalOrderRequestOption[] {
  return PORTAL_ORDER_REQUEST_STATE_OPTIONS;
}

export function createEmptyPublicLeadPreviewDraft(): PublicLeadPreviewDraft {
  return {
    states: ["TX", "FL"],
    quantity: 100,
    freshnessId: "aged-30-90",
  };
}

export function togglePublicPreviewState(
  states: string[],
  code: string
): string[] {
  const next = new Set(states);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  return publicStateOptions()
    .map((option) => option.value)
    .filter((value) => next.has(value));
}

export function resolvePublicFreshness(id: string): (typeof PUBLIC_VETERAN_FRESHNESS_OPTIONS)[number] {
  return (
    PUBLIC_VETERAN_FRESHNESS_OPTIONS.find((option) => option.id === id) ??
    PUBLIC_VETERAN_FRESHNESS_OPTIONS[1]
  );
}

export function clampPublicLeadQuantity(raw: number): number {
  if (!Number.isFinite(raw)) return 100;
  return Math.min(1_000_000, Math.max(1, Math.round(raw)));
}

export function publicPreviewContinueHref(): string {
  return `${PUBLIC_PORTAL_SIGN_IN_HREF}?next=${encodeURIComponent(PUBLIC_PORTAL_PLACE_ORDER_NEXT)}`;
}

export function formatPublicPreviewStates(states: string[]): string {
  if (states.length === 0) return "Choose at least one state";
  const labels = publicStateOptions();
  return states
    .map((code) => labels.find((option) => option.value === code)?.label ?? code)
    .join(", ");
}

export function publicPreviewSummary(draft: PublicLeadPreviewDraft): {
  niche: string;
  quantity: number;
  freshness: string;
  campaignType: string;
  states: string;
  chargeCopy: string;
} {
  const freshness = resolvePublicFreshness(draft.freshnessId);
  return {
    niche: "Veteran",
    quantity: clampPublicLeadQuantity(draft.quantity),
    freshness: freshness.label,
    campaignType: freshness.campaignType,
    states: formatPublicPreviewStates(draft.states),
    chargeCopy: "This is a request preview, not a charge. No card is collected here.",
  };
}
