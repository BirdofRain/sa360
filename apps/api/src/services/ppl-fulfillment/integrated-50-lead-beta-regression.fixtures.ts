/**
 * Local sa360_test-only fixture for the combined #105 + #106 50-lead beta regression.
 * Synthetic PII only. Does not change product behavior.
 */
import type { PrismaClient } from "@prisma/client";

import { evaluatePplBuyerReadyEligibility } from "./ppl-buyer-ready-eligibility.js";

export const REGRESSION_PREFIX = "ppl-50beta-20260831";
export const BUYER_A_CLIENT_ID = "client_50beta_a_20260831";
export const BUYER_B_CLIENT_ID = "client_50beta_b_20260831";
export const BUYER_A_EMAIL = "buyer-50beta-a-20260831@example.test";
export const BUYER_B_EMAIL = "buyer-50beta-b-20260831@example.test";
export const LOT_KEY = "ppl-50beta-lot-20260831";
export const STATE = "NC";
export const NICHE = "vet";
export const COMMERCE_BUCKET = "COMMERCE_3_6_MO" as const;
export const REQUESTED_QUANTITY = 50;
export const VALID_COUNT = 50;
export const INVALID_COUNT = 16;
export const CANDIDATE_COUNT = VALID_COUNT + INVALID_COUNT;

let isolatedItemIds: string[] = [];

export type InvalidReason =
  | "missing_consumer_age"
  | "first_name_too_short"
  | "last_name_too_short"
  | "first_name_multipart"
  | "last_name_multipart";

export type CandidateSpec = {
  tag: string;
  itemId: string;
  eventId: string;
  ageDays: number;
  generatedAt: Date;
  buyerReady: boolean;
  invalidReason: InvalidReason | null;
  first: string;
  last: string;
  phone: string;
  email: string;
  consumerAge: number | null;
  branchOfService: string;
  disabilityRating: string;
  primaryConcern: string;
  beneficiary: string;
};

const INVALID_REASONS: InvalidReason[] = [
  "missing_consumer_age",
  "first_name_too_short",
  "last_name_too_short",
  "first_name_multipart",
  "last_name_multipart",
];

const BRANCHES = ["Army", "Navy", "Air Force", "Marines", "Coast Guard"] as const;
const RATINGS = ["10%", "30%", "50%", "70%", "100%"] as const;
const CONCERNS = ["Income protection", "Burial", "Mortgage protection"] as const;

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 66 NC vet aged candidates in COMMERCE_3_6_MO.
 * Scan order is oldest generatedAt first (index 0). Invalids are mixed through
 * the first 46 scanned rows so the selector must walk past them.
 * Insertion later uses this same oldest-first order (not newest-first).
 */
export function buildCandidateSpecs(now: Date): CandidateSpec[] {
  const invalidScanIndexes = new Set<number>();
  for (let i = 0; i < INVALID_COUNT; i += 1) {
    invalidScanIndexes.add(i * 3);
  }

  const specs: CandidateSpec[] = [];
  let validN = 0;
  let invalidN = 0;
  for (let scanIndex = 0; scanIndex < CANDIDATE_COUNT; scanIndex += 1) {
    const ageDays = 155 - scanIndex;
    const generatedAt = daysAgo(ageDays, now);
    const isInvalid = invalidScanIndexes.has(scanIndex);
    if (isInvalid) {
      const reason = INVALID_REASONS[invalidN % INVALID_REASONS.length]!;
      const tag = `invalid-${reason}-${pad(invalidN)}`;
      specs.push({
        tag,
        itemId: `${REGRESSION_PREFIX}-item-${tag}`,
        eventId: `${REGRESSION_PREFIX}-evt-${tag}`,
        ageDays,
        generatedAt,
        buyerReady: false,
        invalidReason: reason,
        first:
          reason === "first_name_too_short"
            ? "A"
            : reason === "first_name_multipart"
              ? "Mary Ann"
              : "BadFirst",
        last:
          reason === "last_name_too_short"
            ? "Z"
            : reason === "last_name_multipart"
              ? "Van Dyke"
              : "BadLast",
        phone: `+1555711${String(1000 + invalidN).slice(-4)}`,
        email: `fifty.invalid.${invalidN}@example.test`,
        consumerAge: reason === "missing_consumer_age" ? null : 61,
        branchOfService: BRANCHES[invalidN % BRANCHES.length]!,
        disabilityRating: RATINGS[invalidN % RATINGS.length]!,
        primaryConcern: CONCERNS[invalidN % CONCERNS.length]!,
        beneficiary: "Spouse",
      });
      invalidN += 1;
    } else {
      const tag = `valid-${pad(validN)}`;
      specs.push({
        tag,
        itemId: `${REGRESSION_PREFIX}-item-${tag}`,
        eventId: `${REGRESSION_PREFIX}-evt-${tag}`,
        ageDays,
        generatedAt,
        buyerReady: true,
        invalidReason: null,
        first: `ValidFirst${pad(validN)}`,
        last: `ValidLast${pad(validN)}`,
        phone: `+1555710${String(1000 + validN).slice(-4)}`,
        email: `fifty.valid.${validN}@example.test`,
        consumerAge: 45 + (validN % 28),
        branchOfService: BRANCHES[validN % BRANCHES.length]!,
        disabilityRating: RATINGS[validN % RATINGS.length]!,
        primaryConcern: CONCERNS[validN % CONCERNS.length]!,
        beneficiary: "Spouse",
      });
      validN += 1;
    }
  }
  return specs;
}

function payloadFor(spec: CandidateSpec): Record<string, unknown> {
  const leadDetails: Record<string, unknown> = {
    beneficiary: spec.beneficiary,
    niche: {
      branch_of_service: spec.branchOfService,
      disability_rating: spec.disabilityRating,
      primary_concern: spec.primaryConcern,
    },
  };
  if (spec.consumerAge != null) {
    leadDetails.consumer_age = spec.consumerAge;
  }
  return {
    contact: {
      first_name: spec.first,
      last_name: spec.last,
      phone_e164: spec.phone,
      email: spec.email,
      state: STATE,
    },
    lead_details: leadDetails,
  };
}

export async function cleanupFiftyLeadRegression(db: PrismaClient): Promise<void> {
  const clientIds = [BUYER_A_CLIENT_ID, BUYER_B_CLIENT_ID];
  const items = await db.leadInventoryItem.findMany({
    where: { id: { startsWith: `${REGRESSION_PREFIX}-item-` } },
    select: { id: true },
  });
  const events = await db.sourceLeadEvent.findMany({
    where: { id: { startsWith: `${REGRESSION_PREFIX}-evt-` } },
    select: { id: true },
  });
  const itemIds = items.map((row) => row.id);
  const eventIds = events.map((row) => row.id);
  const orders = await db.leadOrder.findMany({
    where: { clientAccountId: { in: clientIds } },
    select: { id: true },
  });
  const orderIds = orders.map((row) => row.id);
  const allocations = await db.leadAllocation.findMany({
    where: {
      OR: [
        ...(itemIds.length > 0 ? [{ leadInventoryItemId: { in: itemIds } }] : []),
        ...(eventIds.length > 0 ? [{ sourceLeadEventId: { in: eventIds } }] : []),
        ...(orderIds.length > 0 ? [{ leadOrderId: { in: orderIds } }] : []),
        { clientAccountId: { in: clientIds } },
      ],
    },
    select: { id: true },
  });
  const allocationIds = allocations.map((row) => row.id);

  if (allocationIds.length > 0 || orderIds.length > 0) {
    await db.leadReplacementRequest.deleteMany({
      where: {
        OR: [
          ...(allocationIds.length > 0
            ? [
                { originalAllocationId: { in: allocationIds } },
                { replacementAllocationId: { in: allocationIds } },
              ]
            : []),
          ...(orderIds.length > 0 ? [{ leadOrderId: { in: orderIds } }] : []),
          { clientAccountId: { in: clientIds } },
        ],
      },
    });
  }
  await db.leadDeliveryExportPackage.deleteMany({
    where: { clientAccountId: { in: clientIds } },
  });
  await db.buyerDeliveredIdentity.deleteMany({
    where: { clientAccountId: { in: clientIds } },
  });
  if (allocationIds.length > 0) {
    await db.leadAllocation.deleteMany({ where: { id: { in: allocationIds } } });
  }
  if (orderIds.length > 0) {
    await db.leadOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (itemIds.length > 0) {
    await db.leadInventoryItem.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (eventIds.length > 0) {
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
  }
  await db.inventoryLot.deleteMany({ where: { lotKey: LOT_KEY } });
  await db.clientAccount.deleteMany({
    where: { clientAccountId: { in: clientIds } },
  });
  if (isolatedItemIds.length > 0) {
    await db.leadInventoryItem.updateMany({
      where: { id: { in: isolatedItemIds }, status: "withdrawn" },
      data: { status: "available", withdrawnAt: null },
    });
    isolatedItemIds = [];
  }
}

export async function seedFiftyLeadRegressionFixture(db: PrismaClient): Promise<{
  now: Date;
  lotId: string;
  specs: CandidateSpec[];
  validSpecs: CandidateSpec[];
  invalidSpecs: CandidateSpec[];
  invalidReasonCounts: Record<InvalidReason, number>;
  newestValidGeneratedAt: Date;
  oldestValidGeneratedAt: Date;
}> {
  await cleanupFiftyLeadRegression(db);

  const now = new Date();
  const specs = buildCandidateSpecs(now);
  const validSpecs = specs.filter((row) => row.buyerReady);
  const invalidSpecs = specs.filter((row) => !row.buyerReady);
  if (validSpecs.length !== VALID_COUNT) {
    throw new Error(`fixture_valid_count:${validSpecs.length}`);
  }
  if (invalidSpecs.length !== INVALID_COUNT) {
    throw new Error(`fixture_invalid_count:${invalidSpecs.length}`);
  }
  for (const spec of validSpecs) {
    const eligibility = evaluatePplBuyerReadyEligibility(payloadFor(spec));
    if (!eligibility.ok) {
      throw new Error(`fixture_valid_not_buyer_ready:${spec.tag}:${eligibility.reasons.join(",")}`);
    }
  }
  for (const spec of invalidSpecs) {
    const eligibility = evaluatePplBuyerReadyEligibility(payloadFor(spec));
    if (eligibility.ok) {
      throw new Error(`fixture_invalid_is_buyer_ready:${spec.tag}`);
    }
  }

  const invalidReasonCounts = {
    missing_consumer_age: 0,
    first_name_too_short: 0,
    last_name_too_short: 0,
    first_name_multipart: 0,
    last_name_multipart: 0,
  } satisfies Record<InvalidReason, number>;
  for (const spec of invalidSpecs) {
    if (spec.invalidReason) invalidReasonCounts[spec.invalidReason] += 1;
  }

  await db.clientAccount.create({
    data: {
      clientAccountId: BUYER_A_CLIENT_ID,
      clientDisplayName: "Fifty Lead Beta Buyer",
      status: "active",
      portalEnabled: true,
      portalDisplayName: "Fifty Lead Beta Portal",
      portalLoginEmail: BUYER_A_EMAIL,
      primaryNicheKeys: [NICHE],
      primaryProductTypes: ["aged_leads"],
      notes: "Localhost-only combined #105+#106 50-lead regression buyer",
    },
  });
  await db.clientAccount.create({
    data: {
      clientAccountId: BUYER_B_CLIENT_ID,
      clientDisplayName: "Fifty Lead Beta Other Buyer",
      status: "active",
      portalEnabled: true,
      portalDisplayName: "Other Buyer Portal",
      portalLoginEmail: BUYER_B_EMAIL,
      primaryNicheKeys: [NICHE],
      primaryProductTypes: ["aged_leads"],
      notes: "Localhost-only tenant B isolation buyer",
    },
  });

  const lot = await db.inventoryLot.create({
    data: {
      lotKey: LOT_KEY,
      displayName: "50-lead beta regression aged lot",
      sourceProvider: "manual_import",
      sourceLane: "aged_csv_beta",
      nicheKey: NICHE,
      inventoryClass: "aged",
      exclusivityMode: "exclusive",
      status: "active",
      supplierAccountId: "supplier_50beta_clean",
      activatedAt: now,
    },
  });

  // Oldest-first insert — deliberately not newest-first.
  for (const spec of specs) {
    const payload = payloadFor(spec);
    await db.sourceLeadEvent.create({
      data: {
        id: spec.eventId,
        sourceProvider: "manual_import",
        sourceSystem: "leadcapture_io_legacy",
        sourceType: "manual_entry",
        sourceLeadId: `src-${spec.tag}`,
        status: "approved",
        rawPayloadJson: payload,
        normalizedPayloadJson: payload,
        enrichmentMetadataJson: {},
        receivedAt: spec.generatedAt,
        normalizedAt: spec.generatedAt,
        approvedAt: now,
      },
    });
    await db.leadInventoryItem.create({
      data: {
        id: spec.itemId,
        inventoryLotId: lot.id,
        sourceLeadEventId: spec.eventId,
        generatedAt: spec.generatedAt,
        normalizedState: STATE,
        nicheKey: NICHE,
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status: "available",
        availableAt: now,
      },
    });
  }

  // Isolate this package from leftover sa360_test inventory.
  const leftover = await db.leadInventoryItem.findMany({
    where: {
      nicheKey: NICHE,
      normalizedState: STATE,
      inventoryClass: "aged",
      status: "available",
      id: { not: { startsWith: `${REGRESSION_PREFIX}-item-` } },
    },
    select: { id: true },
  });
  isolatedItemIds = leftover.map((row) => row.id);
  if (isolatedItemIds.length > 0) {
    await db.leadInventoryItem.updateMany({
      where: { id: { in: isolatedItemIds } },
      data: { status: "withdrawn", withdrawnAt: now },
    });
  }

  const validGenerated = validSpecs.map((row) => row.generatedAt.getTime());
  return {
    now,
    lotId: lot.id,
    specs,
    validSpecs,
    invalidSpecs,
    invalidReasonCounts,
    newestValidGeneratedAt: new Date(Math.max(...validGenerated)),
    oldestValidGeneratedAt: new Date(Math.min(...validGenerated)),
  };
}

export async function seedSameBuyerRedeliveryCandidates(
  db: PrismaClient,
  input: {
    clonedFrom: CandidateSpec;
    lotId: string;
    now: Date;
  }
): Promise<{ cloneItemId: string; freshItemId: string }> {
  const cloneTag = "same-buyer-clone";
  const freshTag = "same-buyer-fresh";
  const clone: CandidateSpec = {
    ...input.clonedFrom,
    tag: cloneTag,
    itemId: `${REGRESSION_PREFIX}-item-${cloneTag}`,
    eventId: `${REGRESSION_PREFIX}-evt-${cloneTag}`,
    ageDays: 120,
    generatedAt: daysAgo(120, input.now),
  };
  const fresh: CandidateSpec = {
    ...input.clonedFrom,
    tag: freshTag,
    itemId: `${REGRESSION_PREFIX}-item-${freshTag}`,
    eventId: `${REGRESSION_PREFIX}-evt-${freshTag}`,
    ageDays: 110,
    generatedAt: daysAgo(110, input.now),
    first: "FreshFirst",
    last: "FreshLast",
    phone: "+15557109999",
    email: "fifty.fresh.redelivery@example.test",
    consumerAge: 58,
  };
  for (const spec of [clone, fresh]) {
    const payload = payloadFor(spec);
    await db.sourceLeadEvent.create({
      data: {
        id: spec.eventId,
        sourceProvider: "manual_import",
        sourceSystem: "leadcapture_io_legacy",
        sourceType: "manual_entry",
        sourceLeadId: `src-${spec.tag}`,
        status: "approved",
        rawPayloadJson: payload,
        normalizedPayloadJson: payload,
        enrichmentMetadataJson: {},
        receivedAt: spec.generatedAt,
        normalizedAt: spec.generatedAt,
        approvedAt: input.now,
      },
    });
    await db.leadInventoryItem.create({
      data: {
        id: spec.itemId,
        inventoryLotId: input.lotId,
        sourceLeadEventId: spec.eventId,
        generatedAt: spec.generatedAt,
        normalizedState: STATE,
        nicheKey: NICHE,
        sourceProvider: "manual_import",
        sourceLane: "aged_csv_beta",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status: "available",
        availableAt: input.now,
      },
    });
  }
  return { cloneItemId: clone.itemId, freshItemId: fresh.itemId };
}
