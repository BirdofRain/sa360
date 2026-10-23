import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  PORTAL_6_12_CONSTITUENT_KEYS,
  isPortal6To12ConstituentSet,
} from "@sa360/shared";

import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import {
  COMMERCE_AGE_BUCKETS,
  LEGACY_COMMERCE_6_12_MO,
  resolveCommerceAgeBucketKey,
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
  minAgeDays?: number | null;
  maxAgeDays?: number | null;
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
    const rawMeta = asRecord(line.metadataJson);
    if (rawMeta?.schema === PORTAL_AGE_UNION_SCHEMA) continue;
    if (isPortal6To12ConstituentSet(
      Array.isArray(line.ageBandKeysJson)
        ? line.ageBandKeysJson.filter((entry): entry is string => typeof entry === "string")
        : []
    )) {
      continue;
    }
    if (
      typeof line.unitPriceCents !== "number" ||
      typeof line.lineTotalCents !== "number" ||
      !Number.isInteger(line.unitPriceCents) ||
      !Number.isInteger(line.lineTotalCents) ||
      line.unitPriceCents < 1 ||
      line.lineTotalCents < 1
    ) {
      continue;
    }

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

export type PortalAgeUnionPersistedLine = {
  lineId: string;
  nicheKey: string;
  states: string[];
  requestedQuantity: number;
  minAgeDays: number | null;
  maxAgeDays: number | null;
  ageBandKeys: string[];
  constituentUnitPriceCents: Record<string, number> | null;
  priceReviewedAt: string | null;
  priceReviewedBy: string | null;
  priceReviewFingerprint: string | null;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  metadata: Record<string, unknown>;
};

export type PortalAgeUnionReleaseAssessment =
  | { status: "not_union" }
  | { status: "invalid_price"; code: "union_price_invalid"; line: PortalAgeUnionPersistedLine }
  | {
      status: "review_required";
      code: "reviewed_price_required";
      /** True when a stamp exists but no longer matches the order details or rates. */
      stale: boolean;
      line: PortalAgeUnionPersistedLine;
    }
  | {
      status: "reviewed";
      code: "reviewed";
      commerceAgeBucketKey: "COMMERCE_6_12_MO";
      constituentUnitPriceCents: Record<string, number>;
      priceReviewedAt: string;
      priceReviewedBy: string;
      priceReviewFingerprint: string;
      line: PortalAgeUnionPersistedLine;
    };

export const PORTAL_AGE_UNION_CHARGE_BASIS =
  "delivered_quantity_times_reviewed_constituent_rate" as const;

export type PortalAgeUnionDeliveredCharge =
  | {
      ok: true;
      deliveredConstituentCounts: { COMMERCE_6_9_MO: number; COMMERCE_9_12_MO: number };
      deliveredChargeCents: number;
      chargeBasis: typeof PORTAL_AGE_UNION_CHARGE_BASIS;
    }
  | { ok: false; code: "union_delivered_age_mismatch"; outsideCount: number };

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function readConstituentUnitPrices(metadata: Record<string, unknown>): Record<string, number> | null {
  const raw = metadata.constituentUnitPriceCents;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const prices: Record<string, number> = {};
  for (const key of PORTAL_6_12_CONSTITUENT_KEYS) {
    if (!positiveInt(record[key])) return null;
    prices[key] = record[key];
  }
  return prices;
}

function reviewedStamp(metadata: Record<string, unknown>): { at: string; by: string } | null {
  const at = typeof metadata.priceReviewedAt === "string" ? metadata.priceReviewedAt.trim() : "";
  const by = typeof metadata.priceReviewedBy === "string" ? metadata.priceReviewedBy.trim() : "";
  if (!at || !by || Number.isNaN(Date.parse(at))) return null;
  return { at, by };
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

const UNION_MIN_AGE_DAYS = LEGACY_COMMERCE_6_12_MO.minDaysInclusive;
const UNION_MAX_AGE_DAYS = LEGACY_COMMERCE_6_12_MO.maxDaysExclusive - 1;

/**
 * Binds a review to the commercial inputs that determine a 6–12 charge.
 * Quantity, niche, states, age window, constituent bands, and both rates
 * are included. Shortfall consent is not: discounts, refunds, and older-lead
 * substitution stay manual and do not change these rates.
 */
export function portalAgeUnionPriceReviewFingerprint(input: {
  nicheKey: string;
  requestedQuantity: number;
  states: string[];
  minAgeDays: number;
  maxAgeDays: number;
  ageBandKeys: readonly string[];
  constituentUnitPriceCents: Record<string, number>;
}): string {
  const states = [...new Set(input.states.map((state) => state.trim().toUpperCase()).filter(Boolean))].sort();
  const bands = [...input.ageBandKeys].sort();
  const canonical = [
    input.nicheKey.trim(),
    String(input.requestedQuantity),
    states.join(","),
    String(input.minAgeDays),
    String(input.maxAgeDays),
    bands.join(","),
    `COMMERCE_6_9_MO=${input.constituentUnitPriceCents.COMMERCE_6_9_MO}`,
    `COMMERCE_9_12_MO=${input.constituentUnitPriceCents.COMMERCE_9_12_MO}`,
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function expectedPriceReviewFingerprint(line: PortalAgeUnionPersistedLine): string | null {
  if (!line.constituentUnitPriceCents) return null;
  if (line.minAgeDays == null || line.maxAgeDays == null) return null;
  return portalAgeUnionPriceReviewFingerprint({
    nicheKey: line.nicheKey,
    requestedQuantity: line.requestedQuantity,
    states: line.states,
    minAgeDays: line.minAgeDays,
    maxAgeDays: line.maxAgeDays,
    ageBandKeys: line.ageBandKeys,
    constituentUnitPriceCents: line.constituentUnitPriceCents,
  });
}

function unionShapeInvalid(line: PortalAgeUnionPersistedLine): boolean {
  if (line.unitPriceCents != null || line.lineTotalCents != null) return true;
  if (!line.constituentUnitPriceCents) return true;
  if (!isPortal6To12ConstituentSet(line.ageBandKeys)) return true;
  if (line.minAgeDays !== UNION_MIN_AGE_DAYS || line.maxAgeDays !== UNION_MAX_AGE_DAYS) return true;
  if (line.requestedQuantity < 1) return true;
  return false;
}

export function readPortalAgeUnionPersistedLine(
  lines: PricedPplOrderLineRecord[] | null | undefined
): PortalAgeUnionPersistedLine | null {
  if (!lines?.length) return null;
  for (const line of lines) {
    const metadata = asRecord(line.metadataJson);
    const bands = Array.isArray(line.ageBandKeysJson)
      ? line.ageBandKeysJson.filter((entry): entry is string => typeof entry === "string")
      : [];
    const unionMetadata =
      metadata?.schema === PORTAL_AGE_UNION_SCHEMA &&
      metadata.portalAgeChoice === LEGACY_COMMERCE_6_12_MO.key;
    if (!unionMetadata || !metadata) continue;
    const lineId = line.id?.trim() ?? "";
    if (!lineId) continue;
    const stamp = reviewedStamp(metadata);
    const storedFingerprint =
      typeof metadata.priceReviewFingerprint === "string" ? metadata.priceReviewFingerprint.trim() : "";
    return {
      lineId,
      nicheKey: typeof line.nicheKey === "string" ? line.nicheKey : "",
      states: parseStates(line.normalizedStatesJson),
      requestedQuantity: integerOrNull(line.requestedQuantity) ?? 0,
      minAgeDays: integerOrNull(line.minAgeDays),
      maxAgeDays: integerOrNull(line.maxAgeDays),
      ageBandKeys: bands,
      constituentUnitPriceCents: readConstituentUnitPrices(metadata),
      priceReviewedAt: stamp?.at ?? null,
      priceReviewedBy: stamp?.by ?? null,
      priceReviewFingerprint: storedFingerprint || null,
      unitPriceCents: typeof line.unitPriceCents === "number" ? line.unitPriceCents : null,
      lineTotalCents: typeof line.lineTotalCents === "number" ? line.lineTotalCents : null,
      metadata,
    };
  }
  return null;
}

/**
 * A portal 6–12 line has no single unit price. Release is allowed only after an
 * operator records that the current order details and both constituent rates
 * were reviewed together. A later change to quantity, niche, states, age
 * window, or either rate makes that stamp stale. A stored 0 or any other
 * numeric unit or line total is an incorrectly priced line.
 */
export function assessPortalAgeUnionRelease(
  lines: PricedPplOrderLineRecord[] | null | undefined
): PortalAgeUnionReleaseAssessment {
  const line = readPortalAgeUnionPersistedLine(lines);
  if (!line) return { status: "not_union" };
  if (unionShapeInvalid(line) || !line.constituentUnitPriceCents) {
    return { status: "invalid_price", code: "union_price_invalid", line };
  }
  const expected = expectedPriceReviewFingerprint(line);
  const stampMatches =
    Boolean(line.priceReviewedAt && line.priceReviewedBy) &&
    expected != null &&
    line.priceReviewFingerprint === expected;
  if (!stampMatches) {
    return {
      status: "review_required",
      code: "reviewed_price_required",
      stale: Boolean(line.priceReviewedAt && line.priceReviewedBy),
      line,
    };
  }
  return {
    status: "reviewed",
    code: "reviewed",
    commerceAgeBucketKey: "COMMERCE_6_12_MO",
    constituentUnitPriceCents: line.constituentUnitPriceCents,
    priceReviewedAt: line.priceReviewedAt!,
    priceReviewedBy: line.priceReviewedBy!,
    priceReviewFingerprint: expected!,
    line,
  };
}

/**
 * Final 6–12 charge from the leads actually released.
 * Each row is aged with calculateInventoryAgeDays at the CSV evaluatedAt and
 * priced at the reviewed 6–9 or 9–12 rate. A row outside both buckets fails
 * the release. This does not apply the charge to a payment, discount, refund,
 * or shortfall credit.
 */
export function quotePortalAgeUnionDeliveredCharge(input: {
  generatedAts: Array<Date | null>;
  constituentUnitPriceCents: Record<string, number>;
  evaluatedAt: Date;
}): PortalAgeUnionDeliveredCharge {
  const rate69 = input.constituentUnitPriceCents.COMMERCE_6_9_MO;
  const rate912 = input.constituentUnitPriceCents.COMMERCE_9_12_MO;
  if (!positiveInt(rate69) || !positiveInt(rate912)) {
    return { ok: false, code: "union_delivered_age_mismatch", outsideCount: input.generatedAts.length };
  }
  let count69 = 0;
  let count912 = 0;
  let outsideCount = 0;
  for (const generatedAt of input.generatedAts) {
    if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
      outsideCount += 1;
      continue;
    }
    const ageDays = calculateInventoryAgeDays(generatedAt, input.evaluatedAt);
    const bucket = resolveCommerceAgeBucketKey(ageDays);
    if (bucket === "COMMERCE_6_9_MO") count69 += 1;
    else if (bucket === "COMMERCE_9_12_MO") count912 += 1;
    else outsideCount += 1;
  }
  if (outsideCount > 0) {
    return { ok: false, code: "union_delivered_age_mismatch", outsideCount };
  }
  const deliveredChargeCents = count69 * rate69 + count912 * rate912;
  if (!Number.isSafeInteger(deliveredChargeCents)) {
    return { ok: false, code: "union_delivered_age_mismatch", outsideCount: input.generatedAts.length };
  }
  return {
    ok: true,
    deliveredConstituentCounts: {
      COMMERCE_6_9_MO: count69,
      COMMERCE_9_12_MO: count912,
    },
    deliveredChargeCents,
    chargeBasis: PORTAL_AGE_UNION_CHARGE_BASIS,
  };
}

export type PortalAgeUnionPriceReviewResult =
  | {
      ok: true;
      alreadyReviewed: boolean;
      priceReviewedAt: string;
      priceReviewedBy: string;
      unitPriceCents: null;
    }
  | {
      ok: false;
      code: "order_not_found" | "not_portal_age_union" | "union_price_invalid" | "reviewer_required";
    };

export async function loadPortalAgeUnionPersistedLine(
  orderId: string,
  db: PrismaClient
): Promise<PortalAgeUnionPersistedLine | null> {
  if (!db.leadOrderLine?.findMany) return null;
  const lines = await db.leadOrderLine.findMany({
    where: { leadOrderId: orderId.trim() },
    orderBy: { lineNumber: "asc" },
  });
  return readPortalAgeUnionPersistedLine(lines);
}

export async function recordPortalAgeUnionPriceReview(
  orderId: string,
  reviewedBy: string,
  db: PrismaClient
): Promise<PortalAgeUnionPriceReviewResult> {
  const actor = reviewedBy.trim();
  if (!actor) return { ok: false, code: "reviewer_required" };
  const id = orderId.trim();
  if (!id || !db.leadOrder?.findUnique || !db.leadOrderLine?.findMany || !db.leadOrderLine?.update) {
    return { ok: false, code: "not_portal_age_union" };
  }
  const order = await db.leadOrder.findUnique({ where: { id }, select: { id: true } });
  if (!order) return { ok: false, code: "order_not_found" };
  const lines = await db.leadOrderLine.findMany({
    where: { leadOrderId: id },
    orderBy: { lineNumber: "asc" },
  });
  const assessment = assessPortalAgeUnionRelease(lines);
  if (assessment.status === "not_union") return { ok: false, code: "not_portal_age_union" };
  if (assessment.status === "invalid_price") return { ok: false, code: "union_price_invalid" };
  if (assessment.status === "reviewed") {
    return {
      ok: true,
      alreadyReviewed: true,
      priceReviewedAt: assessment.priceReviewedAt,
      priceReviewedBy: assessment.priceReviewedBy,
      unitPriceCents: null,
    };
  }
  const priceReviewFingerprint = expectedPriceReviewFingerprint(assessment.line);
  if (!priceReviewFingerprint) return { ok: false, code: "union_price_invalid" };
  const priceReviewedAt = new Date().toISOString();
  await db.leadOrderLine.update({
    where: { id: assessment.line.lineId },
    data: {
      metadataJson: {
        ...assessment.line.metadata,
        priceReviewedAt,
        priceReviewedBy: actor,
        priceReviewFingerprint,
      },
    },
  });
  return {
    ok: true,
    alreadyReviewed: false,
    priceReviewedAt,
    priceReviewedBy: actor,
    unitPriceCents: null,
  };
}

export async function loadPortalAgeUnionAssessment(
  orderId: string,
  db: PrismaClient
): Promise<PortalAgeUnionReleaseAssessment> {
  if (!db.leadOrderLine?.findMany) return { status: "not_union" };
  const lines = await db.leadOrderLine.findMany({
    where: { leadOrderId: orderId.trim() },
    orderBy: { lineNumber: "asc" },
  });
  return assessPortalAgeUnionRelease(lines);
}
