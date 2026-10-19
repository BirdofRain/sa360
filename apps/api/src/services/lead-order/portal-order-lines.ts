import { isPurchasablePplAgedBucket, type CommerceAgeBucketKey } from "@sa360/shared";

export const PORTAL_ORDER_LINE_MAX = 5;
export const PORTAL_ORDER_QUANTITY_MAX = 1_000_000;

export type PortalOrderLineInput = {
  commerceAgeBucketKey: CommerceAgeBucketKey;
  requestedQuantity: number;
};

export type PortalOrderLineValidation =
  | { ok: true; lines: PortalOrderLineInput[]; totalQuantity: number }
  | { ok: false; code: string; error: string };

function invalidQuantity(value: unknown): boolean {
  return typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > PORTAL_ORDER_QUANTITY_MAX;
}

export function validatePortalOrderLines(input: {
  lines: ReadonlyArray<{ commerceAgeBucketKey?: unknown; requestedQuantity?: unknown }>;
  leadVolume: number;
}): PortalOrderLineValidation {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, code: "lines_required", error: "Choose at least one age bucket." };
  }
  if (input.lines.length > PORTAL_ORDER_LINE_MAX) {
    return {
      ok: false,
      code: "too_many_lines",
      error: "Choose at most one quantity for each supported age bucket.",
    };
  }
  const seen = new Set<string>();
  const lines: PortalOrderLineInput[] = [];
  for (const line of input.lines) {
    const bucket = typeof line.commerceAgeBucketKey === "string" ? line.commerceAgeBucketKey.trim() : "";
    if (!isPurchasablePplAgedBucket(bucket)) {
      return {
        ok: false,
        code: "unsupported_age_bucket",
        error: "Choose a supported age bucket.",
      };
    }
    if (seen.has(bucket)) {
      return {
        ok: false,
        code: "duplicate_age_bucket",
        error: "Each age bucket can appear once on an order.",
      };
    }
    if (invalidQuantity(line.requestedQuantity)) {
      return {
        ok: false,
        code: "invalid_quantity",
        error: "Each age bucket needs a whole-number quantity between 1 and 1,000,000.",
      };
    }
    seen.add(bucket);
    lines.push({
      commerceAgeBucketKey: bucket,
      requestedQuantity: line.requestedQuantity as number,
    });
  }
  const totalQuantity = lines.reduce((sum, line) => sum + line.requestedQuantity, 0);
  if (!Number.isInteger(input.leadVolume) || input.leadVolume < 1 || input.leadVolume > PORTAL_ORDER_QUANTITY_MAX) {
    return {
      ok: false,
      code: "invalid_quantity",
      error: "Enter a whole-number quantity between 1 and 1,000,000.",
    };
  }
  if (totalQuantity > PORTAL_ORDER_QUANTITY_MAX) {
    return {
      ok: false,
      code: "excessive_quantity",
      error: "The combined quantity must be 1,000,000 or less.",
    };
  }
  if (input.leadVolume !== totalQuantity) {
    return {
      ok: false,
      code: "quantity_mismatch",
      error: "The order quantity must equal the sum of the age-bucket quantities.",
    };
  }
  return { ok: true, lines, totalQuantity };
}
