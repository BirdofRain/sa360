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
