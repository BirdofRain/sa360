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

  for (const line of lines) {
    const meta = readPplOrderLineMetadata(line.metadataJson);
    const fromBands = parseCommerceBucketFromAgeBandKeysJson(line.ageBandKeysJson);
    const commerceAgeBucketKey = meta?.commerceAgeBucketKey ?? fromBands;
    if (!commerceAgeBucketKey) continue;
    if (line.unitPriceCents == null || line.lineTotalCents == null) continue;

    const priced = resolvePplAgedUnitPriceCents({ commerceAgeBucketKey });
    return {
      lineId: line.id,
      nicheKey: line.nicheKey,
      commerceAgeBucketKey,
      pricingVersion: meta?.pricingVersion ?? PPL_AGED_PRICING_VERSION,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
      requestedQuantity: line.requestedQuantity,
      states: parseStates(line.normalizedStatesJson),
      label: priced.ok ? priced.label : commerceAgeBucketKey,
    };
  }
  return null;
}
