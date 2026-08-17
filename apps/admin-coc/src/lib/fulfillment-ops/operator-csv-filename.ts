/**
 * Operator-safe buyer CSV filename helper for Admin C.O.C. tests / display.
 * Must stay aligned with API `buildOperatorBuyerCsvFilename`.
 * Filename never alters immutable CSV content or SHA.
 */

const MAX_FILENAME_BASE_LENGTH = 160;
const MAX_PART_LENGTH = 40;
const UNSAFE_CHARS = /[^A-Za-z0-9._-]+/g;

const BUCKET_SLUGS: Record<string, string> = {
  COMMERCE_1_3_MO: "1-3mo",
  COMMERCE_3_6_MO: "3-6mo",
  COMMERCE_6_9_MO: "6-9mo",
  COMMERCE_9_12_MO: "9-12mo",
  COMMERCE_12_MO_PLUS: "12mo-plus",
};

export function sanitizeFilenamePart(value: string, fallback = "unknown"): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, "-")
    .replace(UNSAFE_CHARS, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, MAX_PART_LENGTH);
  return cleaned || fallback;
}

export function formatFilenameStates(states: string[]): string {
  const unique = [
    ...new Set(states.map((state) => state.trim().toUpperCase()).filter(Boolean)),
  ];
  if (unique.length === 0) return "NA";
  if (unique.length === 1) return unique[0]!;
  if (unique.length <= 3) return unique.join("-");
  return `${unique.slice(0, 2).join("-")}-plus${unique.length - 2}`;
}

export function formatFilenameBucket(commerceAgeBucketKey: string | null | undefined): string {
  const key = commerceAgeBucketKey?.trim() ?? "";
  if (!key) return "bucket";
  return BUCKET_SLUGS[key] ?? sanitizeFilenamePart(key, "bucket");
}

export function buildOperatorBuyerCsvFilename(input: {
  clientDisplayName?: string | null;
  clientAccountId?: string | null;
  orderNumber: string;
  nicheKey: string;
  states: string[];
  commerceAgeBucketKey?: string | null;
  rowCount: number;
}): string {
  const client = sanitizeFilenamePart(
    input.clientDisplayName?.trim() || input.clientAccountId?.trim() || "client",
    "client"
  );
  const order = sanitizeFilenamePart(input.orderNumber, "order");
  const niche = sanitizeFilenamePart(input.nicheKey.trim().toUpperCase(), "NICHE");
  const states = formatFilenameStates(input.states);
  const bucket = formatFilenameBucket(input.commerceAgeBucketKey);
  const count =
    Number.isFinite(input.rowCount) && input.rowCount >= 0 ? Math.floor(input.rowCount) : 0;
  const leadWord = count === 1 ? "lead" : "leads";
  const base = `${client}_${order}_${niche}_${states}_${bucket}_${count}-${leadWord}`;
  return `${base.slice(0, MAX_FILENAME_BASE_LENGTH)}.csv`;
}
