import type { Prisma, PrismaClient } from "@prisma/client";

import {
  PORTAL_6_12_CONSTITUENT_KEYS,
  isPortal6To12ConstituentSet,
} from "@sa360/shared";

import {
  COMMERCE_AGE_BUCKETS,
  LEGACY_COMMERCE_6_12_MO,
  type CommerceAgeBucketKey,
  isCommerceAgeBucketKey,
} from "./commerce-age-buckets.js";
import {
  computePplLineTotalCents,
  PPL_AGED_PRICING_VERSION,
  resolvePplAgedUnitPriceCents,
} from "./ppl-aged-pricing.registry.js";

export const PORTAL_AGE_UNION_SCHEMA = "portal_age_union_v1";

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
  const metadata: PplOrderLineMetadata = {
    schema: "ppl_order_line_pricing_v1",
    pricingVersion: priced.pricingVersion,
    commerceAgeBucketKey: commerceKey,
    unitPriceCents,
    quotedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    data: {
      lineNumber: 1,
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

export type PortalAgeUnionOrderLine = {
  ok: true;
  data: Prisma.LeadOrderLineCreateWithoutLeadOrderInput;
  selectionKeys: ["COMMERCE_6_12_MO"];
  constituentKeys: readonly ["COMMERCE_6_9_MO", "COMMERCE_9_12_MO"];
  requestedQuantity: number;
};

/**
 * Portal 6–12 months. One order line covers both stored buckets. No single
 * unit price is stamped, because 6–9 and 9–12 have different catalog rates.
 */
export function buildPortalAgeUnionOrderLine(input: {
  nicheKey: string;
  states: string[];
  requestedQuantity: number;
}): PortalAgeUnionOrderLine | { ok: false; code: string } {
  const constituentPrices: Record<string, number> = {};
  for (const key of PORTAL_6_12_CONSTITUENT_KEYS) {
    const priced = resolvePplAgedUnitPriceCents({
      commerceAgeBucketKey: key,
      nicheKey: input.nicheKey,
    });
    if (!priced.ok) return { ok: false, code: priced.code };
    constituentPrices[key] = priced.unitPriceCents;
  }
  if (
    !Number.isInteger(input.requestedQuantity) ||
    input.requestedQuantity < 1
  ) {
    return { ok: false, code: "requested_quantity_invalid" };
  }

  const metadata = {
    schema: PORTAL_AGE_UNION_SCHEMA,
    portalAgeChoice: LEGACY_COMMERCE_6_12_MO.key,
    constituentCommerceAgeBucketKeys: [...PORTAL_6_12_CONSTITUENT_KEYS],
    minDaysInclusive: LEGACY_COMMERCE_6_12_MO.minDaysInclusive,
    maxDaysExclusive: LEGACY_COMMERCE_6_12_MO.maxDaysExclusive,
    constituentUnitPriceCents: constituentPrices,
    pricingNote: "constituent_catalog_prices_differ",
    quotedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    selectionKeys: ["COMMERCE_6_12_MO"],
    constituentKeys: PORTAL_6_12_CONSTITUENT_KEYS,
    requestedQuantity: input.requestedQuantity,
    data: {
      lineNumber: 1,
      displayName: "Aged PPL · 6–12 months",
      nicheKey: input.nicheKey.trim(),
      requestedQuantity: input.requestedQuantity,
      normalizedStatesJson: input.states,
      ageBandKeysJson: [...PORTAL_6_12_CONSTITUENT_KEYS],
      minAgeDays: LEGACY_COMMERCE_6_12_MO.minDaysInclusive,
      maxAgeDays: LEGACY_COMMERCE_6_12_MO.maxDaysExclusive - 1,
      inventoryClassesJson: ["aged"],
      unitPriceCents: null,
      lineTotalCents: null,
      status: "active",
      metadataJson: metadata,
    },
  };
}

export type PortalAgeSelectionLock = {
  commerceAgeBucketKeys: ["COMMERCE_6_12_MO"];
  requestedQuantity: number;
};

export function readPortalAgeSelectionLockFromLines(
  lines: PricedPplOrderLineRecord[] | null | undefined
): PortalAgeSelectionLock | null {
  if (!lines?.length) return null;
  for (const line of lines) {
    const meta = asRecord(line.metadataJson);
    const bands = Array.isArray(line.ageBandKeysJson)
      ? line.ageBandKeysJson.filter((entry): entry is string => typeof entry === "string")
      : [];
    const unionMetadata =
      meta?.schema === PORTAL_AGE_UNION_SCHEMA &&
      meta.portalAgeChoice === LEGACY_COMMERCE_6_12_MO.key;
    if (!unionMetadata || !isPortal6To12ConstituentSet(bands)) continue;
    const requestedQuantity =
      typeof line.requestedQuantity === "number" && Number.isInteger(line.requestedQuantity)
        ? line.requestedQuantity
        : null;
    if (requestedQuantity == null || requestedQuantity < 1) continue;
    return {
      commerceAgeBucketKeys: ["COMMERCE_6_12_MO"],
      requestedQuantity,
    };
  }
  return null;
}

export async function loadPortalAgeSelectionLock(
  orderId: string,
  db: PrismaClient
): Promise<PortalAgeSelectionLock | null> {
  if (!db.leadOrderLine?.findMany) return null;
  const lines = await db.leadOrderLine.findMany({
    where: { leadOrderId: orderId.trim() },
    orderBy: { lineNumber: "asc" },
  });
  return readPortalAgeSelectionLockFromLines(lines);
}

export type PricedPplOrderLineRecord = {
  id?: string;
  metadataJson?: unknown;
  ageBandKeysJson?: unknown;
  unitPriceCents?: number | null;
  lineTotalCents?: number | null;
  requestedQuantity?: number;
  nicheKey?: string;
  normalizedStatesJson?: unknown;
};

export function snapshotPricedPplFromOrderLines(
  lines: PricedPplOrderLineRecord[] | null | undefined
): PplOrderLinePricingSnapshot | null {
  if (!lines?.length) return null;
  for (const line of lines) {
    const meta = readPplOrderLineMetadata(line.metadataJson);
    const fromBands = parseCommerceBucketFromAgeBandKeysJson(line.ageBandKeysJson);
    const commerceAgeBucketKey = meta?.commerceAgeBucketKey ?? fromBands;
    if (!commerceAgeBucketKey) continue;
    if (line.unitPriceCents == null || line.lineTotalCents == null) continue;

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
  return null;
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
