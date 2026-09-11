import {
  COMMERCE_AGE_BUCKETS,
  computePplLineTotalCents,
  isCommerceAgeBucketKey,
  listActivePplAgedPrices,
  resolvePplAgedUnitPriceCents,
  type CommerceAgeBucketKey,
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

export const PORTAL_ORDER_SHORTFALL_DISCLAIMER =
  "Inventory varies by state, quantity, and lead age. If your requested bucket cannot be fully filled, we'll follow your selection above. If older inventory is substituted at a lower rate, your order total will be adjusted down. Any remaining unfilled quantity will be refunded or credited.";

export const PORTAL_AGED_OPTIONS_MARKER = "sa360.portalAgedOptions.v1";

const SHORTFALL_SET = new Set<string>(PORTAL_ORDER_SHORTFALL_POLICIES);

/** ITU-T E.164 after normalize — same pattern as API `phone-e164.service`. */
const E164_VERIFIED = /^\+[1-9]\d{1,14}$/;

export type PortalAgedOrderOptions = {
  requestedAgeBucket: CommerceAgeBucketKey | null;
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

export function portalAgedBucketOptions(): Array<{ value: CommerceAgeBucketKey; label: string }> {
  return listActivePplAgedPrices().map((bucket) => ({
    value: bucket.key,
    label: bucket.label,
  }));
}

export function portalAgedBucketLabel(key: string | null | undefined): string | null {
  if (!key || !isCommerceAgeBucketKey(key)) return null;
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
      return "Refund or credit any unfilled leads";
    case "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT":
      return "Allow older leads at the applicable lower rate; refund or credit any remaining shortage";
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
  const requestedAgeBucket = isCommerceAgeBucketKey(bucketRaw) ? bucketRaw : null;
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
