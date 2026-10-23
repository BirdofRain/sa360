import {
  COMMERCE_AGE_BUCKETS,
  computePplLineTotalCents,
  isCommerceAgeBucketKey,
  isCommerceAgeBucketRequestKey,
  listActivePplAgedPrices,
  portalCustomerAgeChoiceLabel,
  PORTAL_CUSTOMER_AGE_CHOICES,
  resolvePplAgedUnitPriceCents,
  type CommerceAgeBucketKey,
  type CommerceAgeBucketRequestKey,
  type PortalCustomerAgeChoice,
} from "@sa360/shared";

export const PORTAL_AGED_CAMPAIGN_TYPE = "Aged leads";

export const PORTAL_ORDER_SHORTFALL_POLICIES = [
  "REFUND_UNFILLED",
  "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
] as const;

export type PortalOrderShortfallPolicy = (typeof PORTAL_ORDER_SHORTFALL_POLICIES)[number];

export const PORTAL_PRICE_PENDING_COPY = "Price confirmed during review";

export const PORTAL_ORDER_ESTIMATE_DISCLAIMER =
  "Estimate only. Your SA360 team will confirm availability and final pricing before fulfillment.";

export const PORTAL_OLDER_LEAD_CONSENT_LABEL = "Allow older leads in my selected states";

export const PORTAL_OLDER_LEAD_CONSENT_DESCRIPTION =
  "By default, orders will be discounted or refunded if the selected age range cannot be fully filled. Select this option to allow older leads from the same states.";

export const PORTAL_OLDER_LEAD_MANUAL_NOTE =
  "Your SA360 team reviews any discount, refund, or older-lead substitution. This request does not change the price or pull older leads by itself.";

export const PORTAL_UNION_REVIEW_STALE_COPY =
  "This review no longer matches the order details or constituent rates. Record constituent price review again before CSV release.";

/** Operator explanation of the 6–12 charge. Rates are the reviewed constituent catalog rates. */
export function portalUnionDeliveredChargeExplanation(rates?: {
  COMMERCE_6_9_MO?: number | null;
  COMMERCE_9_12_MO?: number | null;
} | null): string {
  const six = rates?.COMMERCE_6_9_MO;
  const nine = rates?.COMMERCE_9_12_MO;
  const sixLabel =
    typeof six === "number" && six > 0 ? formatPortalUsdFromCents(six) : "the reviewed 6–9 rate";
  const nineLabel =
    typeof nine === "number" && nine > 0 ? formatPortalUsdFromCents(nine) : "the reviewed 9–12 rate";
  return `Final charge = (delivered 6–9 leads × ${sixLabel}) + (delivered 9–12 leads × ${nineLabel}). CSV release counts those delivered leads by inventory age and records the charge. No single unit price is stored. Applying that charge to payment, and any discount, refund, or older-lead substitution, stays manual.`;
}

export const PORTAL_AGED_OPTIONS_MARKER = "sa360.portalAgedOptions.v1";

const SHORTFALL_SET = new Set<string>(PORTAL_ORDER_SHORTFALL_POLICIES);

/** ITU-T E.164 after normalize — same pattern as API `phone-e164.service`. */
const E164_VERIFIED = /^\+[1-9]\d{1,14}$/;

export type PortalAgedOrderOptions = {
  requestedAgeBucket: CommerceAgeBucketRequestKey | null;
  shortfallPolicy: PortalOrderShortfallPolicy | null;
  readySmsOptIn: boolean;
  readySmsPhoneE164: string | null;
};

export type PortalAgedOrderEstimate =
  | {
      resolved: true;
      unitPriceCents: number;
      lineTotalCents: number;
      bucketLabel: string;
      pricingVersion: string;
    }
  | { resolved: false };

export function isAgedCampaignType(campaignType: string | null | undefined): boolean {
  return campaignType?.trim() === PORTAL_AGED_CAMPAIGN_TYPE;
}

export function isPortalOrderShortfallPolicy(value: unknown): value is PortalOrderShortfallPolicy {
  return typeof value === "string" && SHORTFALL_SET.has(value);
}

export function portalAgedBucketOptions(): Array<{ value: PortalCustomerAgeChoice; label: string }> {
  const prices = new Map(listActivePplAgedPrices().map((row) => [row.key, row.unitPriceCents]));
  return PORTAL_CUSTOMER_AGE_CHOICES.map((choice) => {
    const cents = prices.get(choice.key);
    const price =
      typeof cents === "number" ? ` (${formatPortalUsdFromCents(cents)}/lead)` : "";
    return {
      value: choice.key,
      label: `${choice.label}${price}`,
    };
  });
}

export function portalAgedBucketLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  const customer = portalCustomerAgeChoiceLabel(key);
  if (customer) return customer;
  if (!isCommerceAgeBucketKey(key)) return null;
  return listActivePplAgedPrices().find((bucket) => bucket.key === key)?.label ?? key;
}

export function formatPortalUsdFromCents(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return PORTAL_PRICE_PENDING_COPY;
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function estimatePortalAgedOrder(input: {
  campaignType: string;
  requestedAgeBucket: string | null;
  leadVolume: number;
  nicheKey?: string;
}): PortalAgedOrderEstimate {
  if (!isAgedCampaignType(input.campaignType)) {
    return { resolved: false };
  }
  const bucket = input.requestedAgeBucket?.trim() ?? "";
  if (!bucket || !isCommerceAgeBucketKey(bucket)) {
    return { resolved: false };
  }
  if (!Number.isInteger(input.leadVolume) || input.leadVolume < 1) {
    return { resolved: false };
  }
  const priced = resolvePplAgedUnitPriceCents({
    commerceAgeBucketKey: bucket,
    nicheKey: input.nicheKey,
  });
  if (!priced.ok || priced.unitPriceCents <= 0) {
    return { resolved: false };
  }
  return {
    resolved: true,
    unitPriceCents: priced.unitPriceCents,
    lineTotalCents: computePplLineTotalCents(input.leadVolume, priced.unitPriceCents),
    bucketLabel: priced.label,
    pricingVersion: priced.pricingVersion,
  };
}

export function isVerifiedE164(normalized: string): boolean {
  return E164_VERIFIED.test(normalized);
}

/**
 * Best-effort E.164-style normalization without an extra lib.
 * Matches API `normalizeToE164` (US 10/11-digit inputs and leading +).
 */
export function normalizeToE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return hadPlus ? "+" : trimmed;
  }

  if (hadPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return trimmed;
}

export function tryNormalizeToVerifiedE164(
  raw: string
): { ok: true; e164: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty_raw_phone" };
  const candidate = normalizeToE164(trimmed);
  if (!candidate || !isVerifiedE164(candidate)) {
    return { ok: false, reason: "not_valid_e164_after_normalize" };
  }
  return { ok: true, e164: candidate };
}

export function portalShortfallPolicyLabel(policy: PortalOrderShortfallPolicy): string {
  switch (policy) {
    case "REFUND_UNFILLED":
      return "No — discount or refund unfilled leads in this age range";
    case "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT":
      return "Yes — allow older leads in the selected states";
  }
}

export function portalOlderLeadOperatorNote(policy: PortalOrderShortfallPolicy): string {
  switch (policy) {
    case "REFUND_UNFILLED":
      return "No consent for older leads. Do not substitute older or younger leads, and do not add states. Any discount or refund is a manual team action.";
    case "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT":
      return "Customer consented to older leads in the selected states only. Do not add states or substitute younger leads. Substitution and any price change are manual; selection does not add older leads on its own.";
  }
}

export function emptyPortalAgedOrderOptions(): PortalAgedOrderOptions {
  return {
    requestedAgeBucket: null,
    shortfallPolicy: null,
    readySmsOptIn: false,
    readySmsPhoneE164: null,
  };
}

export function parsePortalAgedOrderOptionsFromNotes(
  notes: string | null | undefined
): PortalAgedOrderOptions {
  const fallback = emptyPortalAgedOrderOptions();
  if (!notes) return fallback;
  const markerIndex = notes.indexOf(PORTAL_AGED_OPTIONS_MARKER);
  if (markerIndex < 0) return fallback;
  const afterMarker = notes.slice(markerIndex + PORTAL_AGED_OPTIONS_MARKER.length).trim();
  const jsonMatch = afterMarker.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return fallback;
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return normalizePortalAgedOrderOptions(parsed as Record<string, unknown>);
  } catch {
    return fallback;
  }
}

export function normalizePortalAgedOrderOptions(raw: Record<string, unknown>): PortalAgedOrderOptions {
  const bucketRaw = typeof raw.requestedAgeBucket === "string" ? raw.requestedAgeBucket.trim() : "";
  const requestedAgeBucket = isCommerceAgeBucketRequestKey(bucketRaw) ? bucketRaw : null;
  const shortfallRaw = typeof raw.shortfallPolicy === "string" ? raw.shortfallPolicy.trim() : "";
  const shortfallPolicy = isPortalOrderShortfallPolicy(shortfallRaw) ? shortfallRaw : null;
  const readySmsOptIn = raw.readySmsOptIn === true;
  let readySmsPhoneE164: string | null = null;
  if (readySmsOptIn) {
    const phoneRaw =
      (typeof raw.readySmsPhoneE164 === "string" && raw.readySmsPhoneE164) ||
      (typeof raw.readySmsPhone === "string" && raw.readySmsPhone) ||
      "";
    const normalized = tryNormalizeToVerifiedE164(phoneRaw);
    readySmsPhoneE164 = normalized.ok ? normalized.e164 : null;
  }
  return {
    requestedAgeBucket,
    shortfallPolicy,
    readySmsOptIn,
    readySmsPhoneE164,
  };
}

export function stripPortalAgedOrderOptionsFromNotes(notes: string): string {
  if (!notes.includes(PORTAL_AGED_OPTIONS_MARKER)) return notes.trim();
  return notes
    .replace(/Aged order options[^\n]*\n---\nsa360\.portalAgedOptions\.v1\s*\{[\s\S]*?\}/, "")
    .replace(/sa360\.portalAgedOptions\.v1\s*\{[\s\S]*?\}/, "")
    .replace(/^---\s*$/gm, "")
    .trim();
}

export function formatPortalAgedOrderOptionsAppendix(options: PortalAgedOrderOptions): string {
  const payload = {
    requestedAgeBucket: options.requestedAgeBucket,
    shortfallPolicy: options.shortfallPolicy,
    readySmsOptIn: options.readySmsOptIn,
    readySmsPhoneE164: options.readySmsOptIn ? options.readySmsPhoneE164 : null,
  };
  const human: string[] = ["Aged order options"];
  if (options.requestedAgeBucket) {
    human.push(`Age bucket: ${portalAgedBucketLabel(options.requestedAgeBucket)}`);
  }
  if (options.shortfallPolicy) {
    human.push(`Shortfall: ${portalShortfallPolicyLabel(options.shortfallPolicy)}`);
  }
  human.push(
    options.readySmsOptIn && options.readySmsPhoneE164
      ? `Ready text: Yes — ${options.readySmsPhoneE164}`
      : "Ready text: No"
  );
  return `${human.join(" · ")}\n---\n${PORTAL_AGED_OPTIONS_MARKER} ${JSON.stringify(payload)}`;
}

export function mergePortalAgedOptionsIntoNotes(
  customerNotes: string,
  options: PortalAgedOrderOptions
): string | undefined {
  const hasOptions =
    options.requestedAgeBucket != null ||
    options.shortfallPolicy != null ||
    options.readySmsOptIn;
  const cleaned = stripPortalAgedOrderOptionsFromNotes(customerNotes);
  if (!hasOptions) return cleaned || undefined;
  const appendix = formatPortalAgedOrderOptionsAppendix(options);
  const merged = cleaned ? `${appendix}\n\n${cleaned}` : appendix;
  return merged.slice(0, 2000);
}

export function portalAgedOptionsHavePayload(options: PortalAgedOrderOptions): boolean {
  return (
    options.requestedAgeBucket != null ||
    options.shortfallPolicy != null ||
    options.readySmsOptIn
  );
}

export function canonicalCommerceBucketKeys(): CommerceAgeBucketKey[] {
  return COMMERCE_AGE_BUCKETS.map((bucket) => bucket.key);
}
