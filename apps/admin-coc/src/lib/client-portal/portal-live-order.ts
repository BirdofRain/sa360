import { isPurchasablePplAgedBucket, type CommerceAgeBucketKey } from "@sa360/shared";

import {
  estimatePortalAgedOrder,
  formatPortalUsdFromCents,
  portalAgedBucketLabel,
  portalAgedBucketOptions,
  PORTAL_AGED_CAMPAIGN_TYPE,
} from "./portal-aged-order-options.ts";

export const PORTAL_ORDER_DRAFT_STORAGE_KEY = "sa360.portal.orderDraft.v2";
export const PORTAL_ORDER_QUANTITY_MAX = 1_000_000;

export type PortalBuyerEstimateDisplay = "estimate" | "at_least" | "unknown" | "unavailable";

export type PortalBuyerBucketEstimate = {
  commerceAgeBucketKey: string;
  eligible: number | null;
  display: PortalBuyerEstimateDisplay;
};

export type PortalOrderLineDraft = {
  commerceAgeBucketKey: CommerceAgeBucketKey;
  requestedQuantity: number;
};

export type PortalOrderDraftPersistence = {
  lineQuantities: Record<string, number>;
  inspectAgeBucket: string | null;
  idempotencyKey: string;
  commercialSignature: string;
};

export function newPortalOrderIdempotencyKey(): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `portal-order-${id}`;
}

export function parsePortalBuyerEstimateDisplay(value: unknown): PortalBuyerEstimateDisplay {
  if (value === "estimate" || value === "at_least" || value === "unknown" || value === "unavailable") {
    return value;
  }
  return "unknown";
}

export function buyerEstimatesFromAvailabilityPayload(
  payload: unknown,
  bucketKeys: readonly string[]
): {
  nicheKey: string | null;
  states: string[];
  evaluatedAt: string | null;
  estimates: PortalBuyerBucketEstimate[];
} | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as {
    evaluatedAt?: unknown;
    criteria?: { nicheKey?: unknown; states?: unknown };
    buckets?: unknown;
  };
  const buckets = Array.isArray(row.buckets) ? row.buckets : [];
  const estimates = bucketKeys.map((commerceAgeBucketKey) => {
    const match = buckets.find(
      (bucket) =>
        bucket &&
        typeof bucket === "object" &&
        (bucket as { commerceAgeBucketKey?: unknown }).commerceAgeBucketKey === commerceAgeBucketKey
    ) as { eligible?: unknown; display?: unknown } | undefined;
    const eligible = typeof match?.eligible === "number" && Number.isFinite(match.eligible) ? match.eligible : null;
    return {
      commerceAgeBucketKey,
      eligible,
      display: parsePortalBuyerEstimateDisplay(match?.display),
    };
  });
  const states = Array.isArray(row.criteria?.states)
    ? row.criteria.states.filter((state): state is string => typeof state === "string")
    : [];
  return {
    nicheKey: typeof row.criteria?.nicheKey === "string" ? row.criteria.nicheKey : null,
    states,
    evaluatedAt: typeof row.evaluatedAt === "string" ? row.evaluatedAt : null,
    estimates,
  };
}

export function formatPortalBuyerEstimate(
  bucket: PortalBuyerBucketEstimate | undefined
): string {
  if (!bucket || bucket.display === "unavailable") return "Unavailable";
  if (bucket.display === "unknown" || bucket.eligible == null) return "Unknown";
  if (bucket.display === "at_least") return `At least ${bucket.eligible.toLocaleString()}`;
  return `About ${bucket.eligible.toLocaleString()}`;
}

export function buyerEstimateSignature(buckets: readonly PortalBuyerBucketEstimate[]): string {
  return [...buckets]
    .sort((left, right) => left.commerceAgeBucketKey.localeCompare(right.commerceAgeBucketKey))
    .map((bucket) => `${bucket.commerceAgeBucketKey}:${bucket.display}:${bucket.eligible ?? ""}`)
    .join("|");
}

export function changedBuyerBucketLabels(
  previous: readonly PortalBuyerBucketEstimate[],
  next: readonly PortalBuyerBucketEstimate[]
): string[] {
  const prior = new Map(previous.map((bucket) => [bucket.commerceAgeBucketKey, buyerEstimateSignature([bucket])]));
  return next
    .filter((bucket) => {
      const before = prior.get(bucket.commerceAgeBucketKey);
      return before != null && before !== buyerEstimateSignature([bucket]);
    })
    .map((bucket) => portalAgedBucketLabel(bucket.commerceAgeBucketKey) ?? bucket.commerceAgeBucketKey);
}

export function portalLinesFromQuantities(
  quantities: Record<string, number> | undefined
): PortalOrderLineDraft[] {
  const order = new Map(portalAgedBucketOptions().map((option, index) => [option.value, index]));
  return Object.entries(quantities ?? {})
    .filter(
      (entry): entry is [CommerceAgeBucketKey, number] =>
        isPurchasablePplAgedBucket(entry[0]) &&
        Number.isInteger(entry[1]) &&
        entry[1] >= 1 &&
        entry[1] <= PORTAL_ORDER_QUANTITY_MAX
    )
    .sort(
      (left, right) =>
        (order.get(left[0]) ?? Number.MAX_SAFE_INTEGER) - (order.get(right[0]) ?? Number.MAX_SAFE_INTEGER)
    )
    .map(([commerceAgeBucketKey, requestedQuantity]) => ({
      commerceAgeBucketKey,
      requestedQuantity,
    }));
}

export function portalLineQuantityTotal(lines: readonly PortalOrderLineDraft[]): number {
  return lines.reduce((sum, line) => sum + line.requestedQuantity, 0);
}

export function portalOrderCommercialSignature(input: {
  nicheKey: string;
  states: readonly string[];
  shortfallPolicy: string | null;
  lines: readonly PortalOrderLineDraft[];
}): string {
  const lines = [...input.lines]
    .map((line) => `${line.commerceAgeBucketKey}:${line.requestedQuantity}`)
    .join(",");
  return [
    input.nicheKey.trim(),
    [...input.states].map((state) => state.trim().toUpperCase()).sort().join(","),
    input.shortfallPolicy ?? "",
    lines,
  ].join("|");
}

export type PortalLineEstimateRow = {
  commerceAgeBucketKey: string;
  label: string;
  requestedQuantity: number;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  unitPriceLabel: string;
  lineTotalLabel: string;
};

export function estimatePortalOrderLines(lines: readonly PortalOrderLineDraft[]): {
  rows: PortalLineEstimateRow[];
  quantity: number;
  totalCents: number | null;
  pending: boolean;
} {
  let pending = false;
  let totalCents = 0;
  const rows = lines.map((line) => {
    const estimate = estimatePortalAgedOrder({
      campaignType: PORTAL_AGED_CAMPAIGN_TYPE,
      requestedAgeBucket: line.commerceAgeBucketKey,
      leadVolume: line.requestedQuantity,
    });
    if (!estimate.resolved) {
      pending = true;
      return {
        commerceAgeBucketKey: line.commerceAgeBucketKey,
        label: portalAgedBucketLabel(line.commerceAgeBucketKey) ?? line.commerceAgeBucketKey,
        requestedQuantity: line.requestedQuantity,
        unitPriceCents: null,
        lineTotalCents: null,
        unitPriceLabel: "Price confirmed during review",
        lineTotalLabel: "Price confirmed during review",
      };
    }
    totalCents += estimate.lineTotalCents;
    return {
      commerceAgeBucketKey: line.commerceAgeBucketKey,
      label: estimate.bucketLabel,
      requestedQuantity: line.requestedQuantity,
      unitPriceCents: estimate.unitPriceCents,
      lineTotalCents: estimate.lineTotalCents,
      unitPriceLabel: `${formatPortalUsdFromCents(estimate.unitPriceCents)} / lead`,
      lineTotalLabel: formatPortalUsdFromCents(estimate.lineTotalCents),
    };
  });
  return {
    rows,
    quantity: portalLineQuantityTotal(lines),
    totalCents: pending ? null : totalCents,
    pending,
  };
}

export function readPortalOrderDraftPersistence(): PortalOrderDraftPersistence | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PORTAL_ORDER_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Partial<PortalOrderDraftPersistence>;
    if (!row.lineQuantities || typeof row.lineQuantities !== "object") return null;
    const lineQuantities: Record<string, number> = {};
    for (const [key, value] of Object.entries(row.lineQuantities)) {
      if (isPurchasablePplAgedBucket(key) && typeof value === "number" && Number.isInteger(value)) {
        lineQuantities[key] = value;
      }
    }
    return {
      lineQuantities,
      inspectAgeBucket: typeof row.inspectAgeBucket === "string" ? row.inspectAgeBucket : null,
      idempotencyKey: typeof row.idempotencyKey === "string" ? row.idempotencyKey : "",
      commercialSignature:
        typeof row.commercialSignature === "string" ? row.commercialSignature : "",
    };
  } catch {
    return null;
  }
}

export function writePortalOrderDraftPersistence(value: PortalOrderDraftPersistence): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PORTAL_ORDER_DRAFT_STORAGE_KEY, JSON.stringify(value));
}

export function clearPortalOrderDraftPersistence(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PORTAL_ORDER_DRAFT_STORAGE_KEY);
}
