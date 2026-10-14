import {
  isCommerceAgeBucketKey,
  pplAgedBucketLabel,
  type CommerceAgeBucketKey,
} from "@sa360/shared";

import {
  buildPplOrderLineCreateData,
  readPplOrderLineMetadata,
  snapshotPricedPplFromOrderLines,
  type PplOrderLinePricingSnapshot,
} from "../ppl-fulfillment/ppl-order-pricing.js";

export const CLIENT_AGED_OPTIONS_MARKER = "sa360.portalAgedOptions.v1";

export const CLIENT_SHORTFALL_POLICIES = [
  "REFUND_UNFILLED",
  "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
] as const;

export type ClientAgedShortfallPolicy = (typeof CLIENT_SHORTFALL_POLICIES)[number];

const SHORTFALL_SET = new Set<string>(CLIENT_SHORTFALL_POLICIES);

export type ClientAgedCommerceOptions = {
  requestedAgeBucket: CommerceAgeBucketKey | null;
  shortfallPolicy: ClientAgedShortfallPolicy | null;
};

export type PresentedAgedCommerce = {
  requestedAgeBucket: CommerceAgeBucketKey;
  shortfallPolicy: ClientAgedShortfallPolicy;
  label: string;
};

export type PresentedPricedPpl = {
  commerceAgeBucketKey: CommerceAgeBucketKey;
  pricingVersion: string;
  unitPriceCents: number;
  lineTotalCents: number;
  requestedQuantity: number;
  label: string;
};

export function isClientAgedShortfallPolicy(
  value: unknown
): value is ClientAgedShortfallPolicy {
  return typeof value === "string" && SHORTFALL_SET.has(value);
}

export function readClientAgedCommerceOptions(
  notes: string | null | undefined
): ClientAgedCommerceOptions {
  const empty: ClientAgedCommerceOptions = {
    requestedAgeBucket: null,
    shortfallPolicy: null,
  };
  if (!notes) return empty;
  const markerIndex = notes.indexOf(CLIENT_AGED_OPTIONS_MARKER);
  if (markerIndex < 0) return empty;
  const jsonMatch = notes
    .slice(markerIndex + CLIENT_AGED_OPTIONS_MARKER.length)
    .match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return empty;
  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const raw = parsed as Record<string, unknown>;
    const bucket = typeof raw.requestedAgeBucket === "string" ? raw.requestedAgeBucket.trim() : "";
    const shortfall = typeof raw.shortfallPolicy === "string" ? raw.shortfallPolicy.trim() : "";
    return {
      requestedAgeBucket: isCommerceAgeBucketKey(bucket) ? bucket : null,
      shortfallPolicy: isClientAgedShortfallPolicy(shortfall) ? shortfall : null,
    };
  } catch {
    return empty;
  }
}

export function stripPortalAgedOptionsFromNotes(notes: string): string {
  if (!notes.includes(CLIENT_AGED_OPTIONS_MARKER)) return notes.trim();
  return notes
    .replace(/Aged order options[^\n]*\n---\nsa360\.portalAgedOptions\.v1\s*\{[\s\S]*?\}/, "")
    .replace(/sa360\.portalAgedOptions\.v1\s*\{[\s\S]*?\}/, "")
    .replace(/^---\s*$/gm, "")
    .trim();
}

export function presentAgedCommerceFromNotes(
  notes: string | null | undefined
): PresentedAgedCommerce | null {
  const aged = readClientAgedCommerceOptions(notes);
  if (!aged.requestedAgeBucket || !aged.shortfallPolicy) return null;
  return {
    requestedAgeBucket: aged.requestedAgeBucket,
    shortfallPolicy: aged.shortfallPolicy,
    label: pplAgedBucketLabel(aged.requestedAgeBucket),
  };
}

export function presentPricedPpl(
  snapshot: Omit<PplOrderLinePricingSnapshot, "lineId"> | PplOrderLinePricingSnapshot | null
): PresentedPricedPpl | null {
  if (!snapshot) return null;
  if (!isCommerceAgeBucketKey(snapshot.commerceAgeBucketKey)) return null;
  return {
    commerceAgeBucketKey: snapshot.commerceAgeBucketKey,
    pricingVersion: snapshot.pricingVersion,
    unitPriceCents: snapshot.unitPriceCents,
    lineTotalCents: snapshot.lineTotalCents,
    requestedQuantity: snapshot.requestedQuantity,
    label: snapshot.label,
  };
}

export function presentPricedPplFromOrderLines(
  lines: unknown
): PresentedPricedPpl | null {
  if (!Array.isArray(lines)) return null;
  return presentPricedPpl(snapshotPricedPplFromOrderLines(lines));
}

export function buildPortalAgedPplOrderLine(input: {
  nicheKey: string;
  states: string[];
  requestedQuantity: number;
  commerceAgeBucketKey: string;
}) {
  return buildPplOrderLineCreateData(input);
}

export type PortalAgedOrderLineRepairEvidence = {
  orderNumber?: string | null;
  clientAccountId: string;
  nicheKey: string;
  states: string[];
  leadVolume: number;
  campaignType?: string | null;
  notes?: string | null;
  paymentConfirmationStatus?: string | null;
  status?: string | null;
  existingLines?: unknown;
  reservedQuantity?: number;
  fulfilledQuantity?: number;
  proposedQuantity?: number;
  committedAllocationCount?: number;
  exportPackageCount?: number;
  deliveryReceiptCount?: number;
  expected?: {
    clientAccountId?: string;
    nicheKey?: string;
    states?: string[];
    leadVolume?: number;
    paymentConfirmationStatus?: string;
  };
  expectedUnitPriceCents?: number;
};

export type PortalAgedOrderLineRepairDecision =
  | {
      eligible: true;
      alreadyRepaired: boolean;
      commerceAgeBucketKey: CommerceAgeBucketKey;
      shortfallPolicy: ClientAgedShortfallPolicy;
      line: ReturnType<typeof buildPplOrderLineCreateData> & { ok: true };
      reasons: string[];
    }
  | {
      eligible: false;
      alreadyRepaired: boolean;
      code: string;
      reasons: string[];
    };

function sameStringSet(left: string[], right: string[]): boolean {
  const a = [...left].map((s) => s.trim().toUpperCase()).filter(Boolean).sort();
  const b = [...right].map((s) => s.trim().toUpperCase()).filter(Boolean).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function countOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function existingPricedLineCount(lines: unknown): {
  pricedCount: number;
  buckets: string[];
  unitPrices: number[];
} {
  if (!Array.isArray(lines)) return { pricedCount: 0, buckets: [], unitPrices: [] };
  const buckets: string[] = [];
  const unitPrices: number[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object" || Array.isArray(line)) continue;
    const row = line as Record<string, unknown>;
    const meta = readPplOrderLineMetadata(row.metadataJson);
    const snapshot = snapshotPricedPplFromOrderLines([row]);
    if (!meta && !snapshot) continue;
    const bucket = meta?.commerceAgeBucketKey ?? snapshot?.commerceAgeBucketKey;
    if (!bucket) continue;
    buckets.push(bucket);
    if (typeof row.unitPriceCents === "number") unitPrices.push(row.unitPriceCents);
    else if (snapshot) unitPrices.push(snapshot.unitPriceCents);
  }
  return { pricedCount: buckets.length, buckets, unitPrices };
}

/**
 * Idempotent eligibility for reconstructing a missing portal aged PPL line.
 * Never writes. Callers must obtain a separate production authorization.
 */
export function evaluatePortalAgedOrderLineRepair(
  evidence: PortalAgedOrderLineRepairEvidence
): PortalAgedOrderLineRepairDecision {
  const reasons: string[] = [];
  const aged = readClientAgedCommerceOptions(evidence.notes);
  if (!aged.requestedAgeBucket) {
    reasons.push("notes_age_bucket_missing_or_ambiguous");
  }
  if (!aged.shortfallPolicy) {
    reasons.push("notes_shortfall_policy_missing");
  }

  const expected = evidence.expected;
  if (expected?.clientAccountId && expected.clientAccountId !== evidence.clientAccountId) {
    reasons.push("buyer_changed");
  }
  if (expected?.nicheKey && expected.nicheKey !== evidence.nicheKey) {
    reasons.push("niche_changed");
  }
  if (expected?.leadVolume != null && expected.leadVolume !== evidence.leadVolume) {
    reasons.push("quantity_changed");
  }
  if (expected?.states && !sameStringSet(expected.states, evidence.states)) {
    reasons.push("states_changed");
  }
  if (
    expected?.paymentConfirmationStatus &&
    expected.paymentConfirmationStatus !== evidence.paymentConfirmationStatus
  ) {
    reasons.push("payment_decision_changed");
  }

  const reserved = countOrZero(evidence.reservedQuantity);
  const fulfilled = countOrZero(evidence.fulfilledQuantity);
  const proposed = countOrZero(evidence.proposedQuantity);
  const committed = countOrZero(evidence.committedAllocationCount);
  const exported = countOrZero(evidence.exportPackageCount);
  const receipts = countOrZero(evidence.deliveryReceiptCount);
  if (reserved > 0) reasons.push("inventory_reserved");
  if (fulfilled > 0) reasons.push("inventory_fulfilled");
  if (proposed > 0) reasons.push("inventory_proposed");
  if (committed > 0) reasons.push("inventory_committed");
  if (exported > 0) reasons.push("export_exists");
  if (receipts > 0) reasons.push("delivery_receipt_exists");

  const existing = existingPricedLineCount(evidence.existingLines);
  if (existing.pricedCount > 1) {
    reasons.push("conflicting_priced_order_lines");
  } else if (existing.pricedCount === 1) {
    const existingBucket = existing.buckets[0];
    if (aged.requestedAgeBucket && existingBucket !== aged.requestedAgeBucket) {
      reasons.push("conflicting_priced_order_line");
    }
  }

  if (reasons.length > 0 || !aged.requestedAgeBucket || !aged.shortfallPolicy) {
    return {
      eligible: false,
      alreadyRepaired: existing.pricedCount === 1 && reasons.length === 0,
      code: reasons.includes("conflicting_priced_order_line")
        ? "conflicting_priced_order_line"
        : reasons.some((reason) => reason.startsWith("inventory_") || reason === "export_exists")
          ? "fulfillment_already_started"
          : reasons.some((reason) => reason.endsWith("_changed"))
            ? "original_request_changed"
            : "notes_request_incomplete",
      reasons: reasons.length ? reasons : ["notes_request_incomplete"],
    };
  }

  const line = buildPplOrderLineCreateData({
    nicheKey: evidence.nicheKey,
    states: evidence.states,
    requestedQuantity: evidence.leadVolume,
    commerceAgeBucketKey: aged.requestedAgeBucket,
  });
  if (!line.ok) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "priced_line_unavailable",
      reasons: [line.code],
    };
  }

  if (
    evidence.expectedUnitPriceCents != null &&
    evidence.expectedUnitPriceCents !== line.snapshot.unitPriceCents
  ) {
    return {
      eligible: false,
      alreadyRepaired: false,
      code: "original_price_unrecoverable",
      reasons: [
        "catalog_unit_price_does_not_match_expected",
        `expected_unit_price_cents:${evidence.expectedUnitPriceCents}`,
        `catalog_unit_price_cents:${line.snapshot.unitPriceCents}`,
      ],
    };
  }

  if (existing.pricedCount === 1 && existing.buckets[0] === aged.requestedAgeBucket) {
    const existingPrice = existing.unitPrices[0];
    if (existingPrice != null && existingPrice !== line.snapshot.unitPriceCents) {
      return {
        eligible: false,
        alreadyRepaired: false,
        code: "conflicting_priced_order_line",
        reasons: ["existing_line_price_mismatch"],
      };
    }
    return {
      eligible: true,
      alreadyRepaired: true,
      commerceAgeBucketKey: aged.requestedAgeBucket,
      shortfallPolicy: aged.shortfallPolicy,
      line,
      reasons: ["already_has_matching_priced_line"],
    };
  }

  return {
    eligible: true,
    alreadyRepaired: false,
    commerceAgeBucketKey: aged.requestedAgeBucket,
    shortfallPolicy: aged.shortfallPolicy,
    line,
    reasons: ["reconstruct_from_verified_notes_and_current_catalog"],
  };
}
