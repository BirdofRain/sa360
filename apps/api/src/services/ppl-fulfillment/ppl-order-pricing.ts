import type { Prisma, PrismaClient } from "@prisma/client";

import {
  COMMERCE_AGE_BUCKETS,
  type CommerceAgeBucketKey,
  isCommerceAgeBucketKey,
} from "./commerce-age-buckets.js";
import {
  computePplLineTotalCents,
  PPL_AGED_PRICING_VERSION,
  resolvePplAgedUnitPriceCents,
} from "./ppl-aged-pricing.registry.js";

export type PplOrderLinePricingSnapshot = {
  lineId: string;
  nicheKey: string;
  commerceAgeBucketKey: CommerceAgeBucketKey;
  pricingVersion: string;
  unitPriceCents: number;
  lineTotalCents: number;
  requestedQuantity: number;
  states: string[];
  label: string;
};

export type PplOrderLineMetadata = {
  schema: "ppl_order_line_pricing_v1";
  pricingVersion: string;
  commerceAgeBucketKey: CommerceAgeBucketKey;
  unitPriceCents: number;
  quotedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseStates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim().toUpperCase()).filter(Boolean);
}

export function parseCommerceBucketFromAgeBandKeysJson(
  value: unknown
): CommerceAgeBucketKey | null {
  if (!Array.isArray(value)) return null;
  const commerce = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(isCommerceAgeBucketKey);
  if (commerce.length !== 1) return null;
  return commerce[0]!;
}

export function readPplOrderLineMetadata(
  metadataJson: unknown
): PplOrderLineMetadata | null {
  const record = asRecord(metadataJson);
  if (!record || record.schema !== "ppl_order_line_pricing_v1") return null;
  if (!isCommerceAgeBucketKey(record.commerceAgeBucketKey)) return null;
  if (typeof record.pricingVersion !== "string" || !record.pricingVersion.trim()) {
    return null;
  }
  if (typeof record.unitPriceCents !== "number" || !Number.isInteger(record.unitPriceCents)) {
    return null;
  }
  return {
    schema: "ppl_order_line_pricing_v1",
    pricingVersion: record.pricingVersion.trim(),
    commerceAgeBucketKey: record.commerceAgeBucketKey,
    unitPriceCents: record.unitPriceCents,
    quotedAt: typeof record.quotedAt === "string" ? record.quotedAt : "",
  };
}

export function buildPplOrderLineCreateData(input: {
  nicheKey: string;
  states: string[];
  requestedQuantity: number;
  commerceAgeBucketKey: string;
  lineNumber?: number;
  shortfallPolicy?: string | null;
}):
  | {
      ok: true;
      data: Prisma.LeadOrderLineCreateWithoutLeadOrderInput;
      snapshot: Omit<PplOrderLinePricingSnapshot, "lineId">;
    }
  | { ok: false; code: string } {
  const priced = resolvePplAgedUnitPriceCents({
    commerceAgeBucketKey: input.commerceAgeBucketKey,
    nicheKey: input.nicheKey,
  });
  if (!priced.ok) return { ok: false, code: priced.code };

  const commerceKey = input.commerceAgeBucketKey.trim();
  if (!isCommerceAgeBucketKey(commerceKey)) {
    return { ok: false, code: "unknown_bucket" };
  }

  const band = COMMERCE_AGE_BUCKETS.find((row) => row.key === commerceKey);
  if (!band) return { ok: false, code: "unknown_bucket" };

  const unitPriceCents = priced.unitPriceCents;
  const lineTotalCents = computePplLineTotalCents(input.requestedQuantity, unitPriceCents);
  const lineNumber = input.lineNumber ?? 1;
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    return { ok: false, code: "invalid_line_number" };
  }
  const metadata: PplOrderLineMetadata & { shortfallPolicy?: string } = {
    schema: "ppl_order_line_pricing_v1",
    pricingVersion: priced.pricingVersion,
    commerceAgeBucketKey: commerceKey,
    unitPriceCents,
    quotedAt: new Date().toISOString(),
    ...(input.shortfallPolicy ? { shortfallPolicy: input.shortfallPolicy } : {}),
  };

  return {
    ok: true,
    data: {
      lineNumber,
      displayName: `Aged PPL · ${priced.label}`,
      nicheKey: input.nicheKey.trim(),
      requestedQuantity: input.requestedQuantity,
      normalizedStatesJson: input.states,
      ageBandKeysJson: [commerceKey],
      minAgeDays: band.minDaysInclusive,
      maxAgeDays: band.maxDaysExclusive == null ? null : band.maxDaysExclusive - 1,
      inventoryClassesJson: ["aged"],
      unitPriceCents,
      lineTotalCents,
      status: "active",
      metadataJson: metadata,
    },
    snapshot: {
      nicheKey: input.nicheKey.trim(),
      commerceAgeBucketKey: commerceKey,
      pricingVersion: priced.pricingVersion,
      unitPriceCents,
      lineTotalCents,
      requestedQuantity: input.requestedQuantity,
      states: input.states,
      label: priced.label,
    },
  };
}

export type PricedPplOrderLineRecord = {
  id?: string;
  lineNumber?: number;
  metadataJson?: unknown;
  ageBandKeysJson?: unknown;
  unitPriceCents?: number | null;
  lineTotalCents?: number | null;
  requestedQuantity?: number;
  reservedQuantity?: number;
  fulfilledQuantity?: number;
  nicheKey?: string;
  normalizedStatesJson?: unknown;
  status?: string;
};

export type SelectionPricedLineResolution =
  | { ok: true; line: PplOrderLinePricingSnapshot | null }
  | {
      ok: false;
      code: "order_line_required" | "order_line_not_found";
      reasons: string[];
    };

function snapshotOnePricedLine(
  line: PricedPplOrderLineRecord
): PplOrderLinePricingSnapshot | null {
  const meta = readPplOrderLineMetadata(line.metadataJson);
  const fromBands = parseCommerceBucketFromAgeBandKeysJson(line.ageBandKeysJson);
  const commerceAgeBucketKey = meta?.commerceAgeBucketKey ?? fromBands;
  if (!commerceAgeBucketKey) return null;
  if (line.unitPriceCents == null || line.lineTotalCents == null) return null;
  if (line.status === "canceled") return null;

  const priced = resolvePplAgedUnitPriceCents({ commerceAgeBucketKey });
  return {
    lineId: line.id?.trim() || "",
    nicheKey: typeof line.nicheKey === "string" ? line.nicheKey : "",
    commerceAgeBucketKey,
    pricingVersion: meta?.pricingVersion ?? PPL_AGED_PRICING_VERSION,
    unitPriceCents: line.unitPriceCents,
    lineTotalCents: line.lineTotalCents,
    requestedQuantity:
      typeof line.requestedQuantity === "number" && Number.isInteger(line.requestedQuantity)
        ? line.requestedQuantity
        : 0,
    states: parseStates(line.normalizedStatesJson),
    label: priced.ok ? priced.label : commerceAgeBucketKey,
  };
}

export function snapshotAllPricedPplOrderLines(
  lines: PricedPplOrderLineRecord[] | null | undefined
): PplOrderLinePricingSnapshot[] {
  if (!lines?.length) return [];
  const snapshots: PplOrderLinePricingSnapshot[] = [];
  for (const line of lines) {
    const snapshot = snapshotOnePricedLine(line);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}

export function snapshotPricedPplFromOrderLines(
  lines: PricedPplOrderLineRecord[] | null | undefined
): PplOrderLinePricingSnapshot | null {
  return snapshotAllPricedPplOrderLines(lines)[0] ?? null;
}

/**
 * Single priced line keeps the historical selection contract.
 * Multiple priced lines must name one line so a later bucket cannot be filled
 * from an earlier line's quantity or price.
 */
export function resolveSelectionPricedLine(
  lines: PricedPplOrderLineRecord[] | null | undefined,
  leadOrderLineId?: string | null
): SelectionPricedLineResolution {
  const snapshots = snapshotAllPricedPplOrderLines(lines);
  const requestedId = leadOrderLineId?.trim() ?? "";
  if (snapshots.length === 0) {
    if (requestedId) {
      return { ok: false, code: "order_line_not_found", reasons: ["order_line_not_found"] };
    }
    return { ok: true, line: null };
  }
  if (snapshots.length === 1) {
    const only = snapshots[0]!;
    if (requestedId && only.lineId && only.lineId !== requestedId) {
      return { ok: false, code: "order_line_not_found", reasons: ["order_line_not_found"] };
    }
    return { ok: true, line: only };
  }
  if (!requestedId) {
    return {
      ok: false,
      code: "order_line_required",
      reasons: ["multi_line_order_requires_line_scope", `line_count:${snapshots.length}`],
    };
  }
  const match = snapshots.find((line) => line.lineId === requestedId);
  if (!match) {
    return { ok: false, code: "order_line_not_found", reasons: ["order_line_not_found"] };
  }
  return { ok: true, line: match };
}

export async function loadSelectionPricedLine(
  orderId: string,
  db: PrismaClient,
  leadOrderLineId?: string | null
): Promise<SelectionPricedLineResolution> {
  if (!db.leadOrderLine?.findMany) {
    const line = await loadPricedPplOrderLine(orderId, db);
    const requestedId = leadOrderLineId?.trim() ?? "";
    if (requestedId && line?.lineId && line.lineId !== requestedId) {
      return { ok: false, code: "order_line_not_found", reasons: ["order_line_not_found"] };
    }
    return { ok: true, line };
  }
  const lines = await db.leadOrderLine.findMany({
    where: { leadOrderId: orderId.trim() },
    orderBy: { lineNumber: "asc" },
  });
  return resolveSelectionPricedLine(lines, leadOrderLineId);
}

export async function loadPricedPplOrderLine(
  orderId: string,
  db: PrismaClient
): Promise<PplOrderLinePricingSnapshot | null> {
  if (!db.leadOrderLine?.findMany) {
    // Test fakes / legacy callers without order-line delegate → unpriced path.
    return null;
  }
  const lines = await db.leadOrderLine.findMany({
    where: { leadOrderId: orderId.trim() },
    orderBy: { lineNumber: "asc" },
  });
  return snapshotPricedPplFromOrderLines(lines);
}

export const BUYER_CSV_EXPORT_LINE_PRICING_SCHEMA = "buyer_csv_export_line_pricing_v1" as const;

export type ExportAllocationRef = {
  id: string;
  leadOrderLineId?: string | null;
};

export type ExportLinePricingFailureCode =
  | "export_line_required"
  | "export_line_not_found"
  | "export_line_canceled"
  | "export_line_total_mismatch";

export type ExportAllocationPrice = {
  allocationId: string;
  leadOrderLineId: string | null;
  commerceAgeBucketKey: CommerceAgeBucketKey | null;
  pricingVersion: string | null;
  unitPriceCents: number | null;
};

export type ExportLinePrice = {
  lineId: string;
  commerceAgeBucketKey: CommerceAgeBucketKey;
  pricingVersion: string;
  unitPriceCents: number;
  requestedQuantity: number;
  lineTotalCents: number;
  exportedQuantity: number;
  exportedTotalCents: number;
};

export type ExportAllocationPricing = {
  schema: typeof BUYER_CSV_EXPORT_LINE_PRICING_SCHEMA;
  mode: "unpriced" | "single_line" | "multi_line";
  allocations: ExportAllocationPrice[];
  lines: ExportLinePrice[];
  commerceAgeBucketKey: CommerceAgeBucketKey | null;
  pricingVersion: string | null;
  unitPriceCents: number | null;
  requestedQuantity: number | null;
  requestedTotalCents: number | null;
  exportedQuantity: number;
  exportedTotalCents: number | null;
};

export type ExportAllocationPricingResult =
  | { ok: true; pricing: ExportAllocationPricing }
  | {
      ok: false;
      code: ExportLinePricingFailureCode;
      reasons: string[];
      allocationId?: string;
    };

/**
 * Price each export allocation from its own order line.
 * One priced line keeps the legacy contract when the allocation has no line id.
 * A multi-line allocation with a missing, unknown, or canceled line fails closed.
 * Package-level unit price stays set only when every exported row shares that price.
 */
export function resolveExportAllocationPricing(
  lines: PricedPplOrderLineRecord[] | null | undefined,
  allocations: readonly ExportAllocationRef[]
): ExportAllocationPricingResult {
  const rawLines = lines ?? [];
  const rawById = new Map(
    rawLines.flatMap((line) => (line.id ? [[line.id, line] as const] : []))
  );
  const snapshots = snapshotAllPricedPplOrderLines(rawLines);
  const pricedById = new Map(snapshots.map((line) => [line.lineId, line]));

  if (snapshots.length === 0) {
    return {
      ok: true,
      pricing: emptyExportPricing(
        "unpriced",
        allocations.map((allocation) => ({
          allocationId: allocation.id,
          leadOrderLineId: allocation.leadOrderLineId?.trim() || null,
          commerceAgeBucketKey: null,
          pricingVersion: null,
          unitPriceCents: null,
        }))
      ),
    };
  }

  const priced: ExportAllocationPrice[] = [];
  for (const allocation of allocations) {
    const requestedId = allocation.leadOrderLineId?.trim() || "";
    const resolved = resolveExportedLine(snapshots, rawById, requestedId, allocation.id);
    if (!resolved.ok) return resolved;
    const line = resolved.line;
    priced.push({
      allocationId: allocation.id,
      leadOrderLineId: line.lineId || null,
      commerceAgeBucketKey: line.commerceAgeBucketKey,
      pricingVersion: line.pricingVersion,
      unitPriceCents: line.unitPriceCents,
    });
  }

  const exportedByLine = new Map<string, number>();
  for (const row of priced) {
    if (!row.leadOrderLineId) continue;
    exportedByLine.set(row.leadOrderLineId, (exportedByLine.get(row.leadOrderLineId) ?? 0) + 1);
  }

  const linePrices: ExportLinePrice[] = [];
  for (const line of snapshots) {
    if (line.lineTotalCents !== line.requestedQuantity * line.unitPriceCents) {
      return {
        ok: false,
        code: "export_line_total_mismatch",
        reasons: [
          "line_total_does_not_match_quantity_times_unit_price",
          `line:${line.lineId}`,
        ],
      };
    }
    const exportedQuantity = exportedByLine.get(line.lineId) ?? 0;
    linePrices.push({
      lineId: line.lineId,
      commerceAgeBucketKey: line.commerceAgeBucketKey,
      pricingVersion: line.pricingVersion,
      unitPriceCents: line.unitPriceCents,
      requestedQuantity: line.requestedQuantity,
      lineTotalCents: line.lineTotalCents,
      exportedQuantity,
      exportedTotalCents: exportedQuantity * line.unitPriceCents,
    });
  }

  const requestedTotalCents = linePrices.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const exportedTotalCents = linePrices.reduce((sum, line) => sum + line.exportedTotalCents, 0);
  const allocationTotal = priced.reduce((sum, row) => sum + (row.unitPriceCents ?? 0), 0);
  if (allocationTotal !== exportedTotalCents) {
    return {
      ok: false,
      code: "export_line_total_mismatch",
      reasons: ["allocation_prices_do_not_reconcile_with_line_totals"],
    };
  }

  const distinctPrices = new Set(priced.map((row) => row.unitPriceCents));
  const distinctBuckets = new Set(priced.map((row) => row.commerceAgeBucketKey));
  const distinctVersions = new Set(priced.map((row) => row.pricingVersion));
  const uniform = priced.length > 0 && distinctPrices.size === 1 && distinctBuckets.size === 1;

  return {
    ok: true,
    pricing: {
      schema: BUYER_CSV_EXPORT_LINE_PRICING_SCHEMA,
      mode: snapshots.length === 1 ? "single_line" : "multi_line",
      allocations: priced,
      lines: linePrices,
      commerceAgeBucketKey: uniform ? (priced[0]?.commerceAgeBucketKey ?? null) : null,
      pricingVersion:
        priced.length > 0 && distinctVersions.size === 1 ? (priced[0]?.pricingVersion ?? null) : null,
      unitPriceCents: uniform ? (priced[0]?.unitPriceCents ?? null) : null,
      requestedQuantity: linePrices.reduce((sum, line) => sum + line.requestedQuantity, 0),
      requestedTotalCents,
      exportedQuantity: priced.length,
      exportedTotalCents,
    },
  };
}

function resolveExportedLine(
  snapshots: PplOrderLinePricingSnapshot[],
  rawById: Map<string, PricedPplOrderLineRecord>,
  requestedId: string,
  allocationId: string
):
  | { ok: true; line: PplOrderLinePricingSnapshot }
  | Extract<ExportAllocationPricingResult, { ok: false }> {
  if (snapshots.length === 1) {
    const only = snapshots[0]!;
    if (requestedId && only.lineId && only.lineId !== requestedId) {
      return lineAssociationFailure(rawById, requestedId, allocationId);
    }
    return { ok: true, line: only };
  }
  if (!requestedId) {
    return {
      ok: false,
      code: "export_line_required",
      allocationId,
      reasons: ["multi_line_allocation_requires_line", `allocation:${allocationId}`],
    };
  }
  const match = snapshots.find((line) => line.lineId === requestedId);
  if (!match) return lineAssociationFailure(rawById, requestedId, allocationId);
  return { ok: true, line: match };
}

function lineAssociationFailure(
  rawById: Map<string, PricedPplOrderLineRecord>,
  requestedId: string,
  allocationId: string
): Extract<ExportAllocationPricingResult, { ok: false }> {
  const raw = rawById.get(requestedId);
  if (raw?.status === "canceled") {
    return {
      ok: false,
      code: "export_line_canceled",
      allocationId,
      reasons: ["allocation_line_canceled", `allocation:${allocationId}`, `line:${requestedId}`],
    };
  }
  return {
    ok: false,
    code: "export_line_not_found",
    allocationId,
    reasons: ["allocation_line_not_found", `allocation:${allocationId}`, `line:${requestedId}`],
  };
}

function emptyExportPricing(
  mode: ExportAllocationPricing["mode"],
  allocations: ExportAllocationPrice[]
): ExportAllocationPricing {
  return {
    schema: BUYER_CSV_EXPORT_LINE_PRICING_SCHEMA,
    mode,
    allocations,
    lines: [],
    commerceAgeBucketKey: null,
    pricingVersion: null,
    unitPriceCents: null,
    requestedQuantity: null,
    requestedTotalCents: null,
    exportedQuantity: allocations.length,
    exportedTotalCents: null,
  };
}
