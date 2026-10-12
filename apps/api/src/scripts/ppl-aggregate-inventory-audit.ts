/**
 * Aggregate-only, read-only PPL inventory audit.
 *
 * This operator script deliberately has no write mode. It traverses one stable
 * PostgreSQL snapshot, applies the same pure row classifier as production PPL
 * selection, and emits counts only. Lead payloads and identifiers never enter
 * the report.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNamespace, PrismaClient } from "@prisma/client";
import {
  PPL_AGED_PRICING_VERSION,
  computePplLineTotalCents,
  isCanonicalUsStateCode,
  resolvePplAgedUnitPriceCents,
  sanitizeCanonicalUsStates,
} from "@sa360/shared";

import { assertExpectedDbHost } from "../services/aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import { prismaCommerceNicheWhere } from "../services/commerce/commerce-niche-match.js";
import {
  buildCommerceGeneratedAtWhere,
  classifyPplInventoryCandidate,
  loadBuyerSeenFingerprints,
  type PplInventoryScanRow,
} from "../services/ppl-fulfillment/inventory-selection.service.js";
import {
  type CommerceAgeBucketKey,
  type CommerceAgeBucketRequestKey,
} from "../services/ppl-fulfillment/commerce-age-buckets.js";
import {
  listActiveExclusions,
  type ProtectedAgentExclusionRecord,
} from "../services/ppl-fulfillment/protected-agent-exclusion.service.js";
import type { PplBuyerReadyRejectionReason } from "../services/ppl-fulfillment/ppl-buyer-ready-eligibility.js";

export const PPL_AGGREGATE_AUDIT_SCHEMA = "ppl_aggregate_inventory_audit_v1" as const;
export const PPL_AGGREGATE_AUDIT_DEFAULT_PAGE_SIZE = 250;
export const PPL_AGGREGATE_AUDIT_MAX_PAGE_SIZE = 1_000;
export const PPL_AGGREGATE_AUDIT_BATCH_SIZE = 300;
export const PPL_AGGREGATE_AUDIT_STATEMENT_TIMEOUT_MS = 120_000;
export const PPL_AGGREGATE_AUDIT_TRANSACTION_TIMEOUT_MS = 30 * 60_000;
export const PPL_AGGREGATE_AUDIT_MAX_WAIT_MS = 30_000;
export const PPL_AGGREGATE_AUDIT_IDLE_TIMEOUT_MS = 300_000;

export const PPL_AGGREGATE_AUDIT_BUCKETS = [
  "COMMERCE_6_9_MO",
  "COMMERCE_9_12_MO",
  "COMMERCE_12_MO_PLUS",
] as const satisfies readonly CommerceAgeBucketKey[];

export type PplAggregateAuditBucket = (typeof PPL_AGGREGATE_AUDIT_BUCKETS)[number];
export type PplAggregateAuditCoverage = "complete";

export const VANESSA_AUDIT_DEFAULTS = {
  clientAccountId: "client_vanessa_powell",
  nicheKey: "trucker",
  states: ["TX", "FL", "AL", "GA", "MO", "MS", "WI", "UT", "VA", "SC", "NC"],
} as const;

type AuditDb = Prisma.TransactionClient;

type AuditCursor = { generatedAt: Date; id: string };

type AuditStatusBreakdown = {
  pending_review: number;
  reserved: number;
  committed: number;
  fulfilled: number;
  quarantined: number;
  rejected: number;
  expired: number;
  withdrawn: number;
  other: number;
};

export type PplAggregateAuditInput = {
  clientAccountId: string;
  nicheKey: string;
  states: string[];
  pageSize?: number;
  /**
   * Fixed UTC instant for commerce age buckets. Distinct from the
   * repeatable-read transaction snapshot. Omit only in programmatic callers
   * that intentionally age against transaction_timestamp().
   */
  ageAsOf?: Date;
  /** Test/safety hook. Reaching this bound fails without returning a report. */
  maxPages?: number;
};

export type PplAggregateInventoryAuditReport = {
  schema: typeof PPL_AGGREGATE_AUDIT_SCHEMA;
  pricingVersion: typeof PPL_AGED_PRICING_VERSION;
  buyer: string;
  nicheKey: string;
  states: string[];
  /** Commerce age evaluation instant. Not the database snapshot clock. */
  asOf: string;
  ageEvaluation?: {
    source: "explicit_age_as_of" | "transaction_snapshot";
    asOf: string;
  };
  transaction: {
    isolationLevel: "REPEATABLE READ";
    readOnly: true;
    statementTimeoutMs: number;
    transactionTimeoutMs: number;
    /** transaction_timestamp() of the repeatable-read snapshot. */
    snapshotAt?: string;
  };
  coverage: PplAggregateAuditCoverage;
  pagination: {
    method: "keyset_generatedAt_id";
    pageSize: number;
    pagesRead: number;
    rowsVisited: number;
    finalPageShort: true;
    nextCursor: null;
  };
  stages: {
    rawCanonicalInventory: number;
    matchingNiche: number;
    matchingRequestedStates: number;
    matchingAgeTier: number;
    agedInventory: number;
    availableAgedInventory: number;
    unavailableByStatus: AuditStatusBreakdown;
    activeLot: number;
    inactiveLot: number;
    commerceIncluded: number;
    afterProtectedAgent: number;
    afterBuyerOrigin: number;
    validIdentity: number;
    buyerReady: number;
    afterPreviousBuyerDelivery: number;
    finalEligible: number;
  };
  exclusions: {
    nonAgedInventory: number;
    unavailableInventory: number;
    commerceExcluded: number;
    protectedAgent: number;
    buyerOrigin: number;
    invalidIdentity: number;
    notBuyerReady: number;
    buyerReadyReasons: Record<PplBuyerReadyRejectionReason, number>;
    previousBuyerDeliveryIdentity: number;
    crossBucketOrStateDuplicate: number;
  };
  matrix: Array<{
    state: string;
    quantities: Record<PplAggregateAuditBucket, number>;
    subtotal: number;
  }>;
  tierSubtotals: Record<PplAggregateAuditBucket, number>;
  quote: {
    currency: "USD";
    tiers: Record<
      PplAggregateAuditBucket,
      { quantity: number; unitPriceCents: number; totalCents: number }
    >;
    grandTotalCents: number;
  };
  fulfillmentBatches: Record<
    PplAggregateAuditBucket,
    {
      quantity: number;
      maximumBatchSize: typeof PPL_AGGREGATE_AUDIT_BATCH_SIZE;
      estimatedOrderCount: number;
      fullSizeOrderCount: number;
      remainderQuantity: number;
    }
  >;
  informational: {
    priorBuyerAllocationsByStatus: Record<string, number>;
    concernsNotAppliedByCurrentSelector: string[];
  };
  invariants: {
    readOnlyTransaction: true;
    snapshotTimestampFixed: true;
    strictKeysetOrder: true;
    scanCountMatchesCohort: true;
    waterfallReconciles: true;
    matrixReconciles: true;
    tierSubtotalsReconcile: true;
    noPartialScanReportedComplete: true;
    aggregateOnlyOutput: true;
  };
};

const BUYER_READY_REASONS: readonly PplBuyerReadyRejectionReason[] = [
  "first_name_too_short",
  "last_name_too_short",
  "first_name_multipart",
  "last_name_multipart",
  "consumer_age_missing",
  "consumer_age_invalid",
  "consumer_age_over_maximum",
];

function emptyStatusBreakdown(): AuditStatusBreakdown {
  return {
    pending_review: 0,
    reserved: 0,
    committed: 0,
    fulfilled: 0,
    quarantined: 0,
    rejected: 0,
    expired: 0,
    withdrawn: 0,
    other: 0,
  };
}

function emptyBuyerReadyReasons(): Record<PplBuyerReadyRejectionReason, number> {
  return Object.fromEntries(BUYER_READY_REASONS.map((reason) => [reason, 0])) as Record<
    PplBuyerReadyRejectionReason,
    number
  >;
}

function normalizeInput(input: PplAggregateAuditInput) {
  const clientAccountId = input.clientAccountId.trim();
  const nicheKey = input.nicheKey.trim();
  if (!clientAccountId) throw new Error("client_account_id_required");
  if (!nicheKey) throw new Error("niche_key_required");

  const rawStates = input.states.map((state) => state.trim().toUpperCase()).filter(Boolean);
  if (rawStates.length === 0 || rawStates.some((state) => !isCanonicalUsStateCode(state))) {
    throw new Error("canonical_states_required");
  }
  const states = sanitizeCanonicalUsStates(rawStates);
  if (states.length !== new Set(rawStates).size) throw new Error("duplicate_states_not_allowed");

  const pageSize = input.pageSize ?? PPL_AGGREGATE_AUDIT_DEFAULT_PAGE_SIZE;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > PPL_AGGREGATE_AUDIT_MAX_PAGE_SIZE
  ) {
    throw new Error("page_size_invalid");
  }
  if (
    input.maxPages != null &&
    (!Number.isSafeInteger(input.maxPages) || input.maxPages < 1)
  ) {
    throw new Error("max_pages_invalid");
  }
  return { clientAccountId, nicheKey, states, pageSize, maxPages: input.maxPages };
}

function cursorWhere(cursor: AuditCursor | null): Prisma.LeadInventoryItemWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { generatedAt: { gt: cursor.generatedAt } },
      { generatedAt: cursor.generatedAt, id: { gt: cursor.id } },
    ],
  };
}

function compareCursor(row: AuditCursor, previous: AuditCursor | null): boolean {
  if (!previous) return true;
  const timeDiff = row.generatedAt.getTime() - previous.generatedAt.getTime();
  return timeDiff > 0 || (timeDiff === 0 && row.id > previous.id);
}

function tierForCandidate(key: CommerceAgeBucketKey | null): PplAggregateAuditBucket {
  if (
    key === "COMMERCE_6_9_MO" ||
    key === "COMMERCE_9_12_MO" ||
    key === "COMMERCE_12_MO_PLUS"
  ) {
    return key;
  }
  throw new Error("candidate_tier_invariant_failed");
}

function incrementUnavailableStatus(status: string, counts: AuditStatusBreakdown): void {
  if (status in counts && status !== "other") {
    counts[status as Exclude<keyof AuditStatusBreakdown, "other">] += 1;
  } else {
    counts.other += 1;
  }
}

function sumRecord(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, count) => sum + count, 0);
}

async function loadPriorAllocationCounts(
  clientAccountId: string,
  db: AuditDb
): Promise<Record<string, number>> {
  const grouped = await db.leadAllocation.groupBy({
    by: ["status"],
    where: { clientAccountId },
    _count: { _all: true },
  });
  return Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
}

async function countStages(
  input: { nicheKey: string; states: string[]; evaluatedAt: Date },
  db: AuditDb
) {
  const nicheWhere = prismaCommerceNicheWhere(input.nicheKey);
  const stateWhere: Prisma.LeadInventoryItemWhereInput = {
    normalizedState: { in: input.states },
  };
  const ageWhere = buildCommerceGeneratedAtWhere(
    [...PPL_AGGREGATE_AUDIT_BUCKETS] as CommerceAgeBucketRequestKey[],
    input.evaluatedAt
  );
  const agedWhere: Prisma.LeadInventoryItemWhereInput = { inventoryClass: "aged" };
  const stageStates: Prisma.LeadInventoryItemWhereInput = {
    AND: [nicheWhere, stateWhere],
  };
  const stageAge: Prisma.LeadInventoryItemWhereInput = {
    AND: [nicheWhere, stateWhere, ageWhere],
  };
  const stageAged: Prisma.LeadInventoryItemWhereInput = {
    AND: [nicheWhere, stateWhere, ageWhere, agedWhere],
  };

  const [rawCanonicalInventory, matchingNiche, matchingRequestedStates, matchingAgeTier, aged] =
    await Promise.all([
      db.leadInventoryItem.count(),
      db.leadInventoryItem.count({ where: nicheWhere }),
      db.leadInventoryItem.count({ where: stageStates }),
      db.leadInventoryItem.count({ where: stageAge }),
      db.leadInventoryItem.count({ where: stageAged }),
    ]);

  return {
    rawCanonicalInventory,
    matchingNiche,
    matchingRequestedStates,
    matchingAgeTier,
    aged,
    stageAged,
  };
}

async function readAuditPage(
  db: AuditDb,
  where: Prisma.LeadInventoryItemWhereInput,
  cursor: AuditCursor | null,
  pageSize: number
): Promise<PplInventoryScanRow[]> {
  const after = cursorWhere(cursor);
  return db.leadInventoryItem.findMany({
    where: { AND: [where, ...(after ? [after] : [])] },
    orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
    take: pageSize,
    include: {
      inventoryLot: { select: { supplierAccountId: true, status: true } },
      sourceLeadEvent: {
        select: {
          id: true,
          normalizedPayloadJson: true,
          rawPayloadJson: true,
          enrichmentMetadataJson: true,
        },
      },
    },
  }) as Promise<PplInventoryScanRow[]>;
}

export async function buildPplAggregateInventoryAudit(
  rawInput: PplAggregateAuditInput,
  evaluatedAt: Date,
  db: AuditDb
): Promise<PplAggregateInventoryAuditReport> {
  const input = normalizeInput(rawInput);
  if (Number.isNaN(evaluatedAt.getTime())) throw new Error("audit_as_of_invalid");

  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: input.clientAccountId },
    select: { clientAccountId: true },
  });
  if (!client) throw new Error("client_account_not_found");

  const [stageCounts, exclusions, buyerSeen, priorBuyerAllocationsByStatus] = await Promise.all([
    countStages({ ...input, evaluatedAt }, db),
    listActiveExclusions(db as unknown as PrismaClient),
    loadBuyerSeenFingerprints(input.clientAccountId, db as unknown as PrismaClient),
    loadPriorAllocationCounts(input.clientAccountId, db),
  ]);

  const acceptedPhones = new Set<string>();
  const acceptedEmails = new Set<string>();
  const unavailableByStatus = emptyStatusBreakdown();
  const buyerReadyReasons = emptyBuyerReadyReasons();
  const matrixMap = new Map<
    string,
    Record<PplAggregateAuditBucket, number>
  >(
    input.states.map((state) => [
      state,
      {
        COMMERCE_6_9_MO: 0,
        COMMERCE_9_12_MO: 0,
        COMMERCE_12_MO_PLUS: 0,
      },
    ])
  );
  const tierSubtotals: Record<PplAggregateAuditBucket, number> = {
    COMMERCE_6_9_MO: 0,
    COMMERCE_9_12_MO: 0,
    COMMERCE_12_MO_PLUS: 0,
  };

  let pagesRead = 0;
  let rowsVisited = 0;
  let cursor: AuditCursor | null = null;
  let strictKeysetOrder = true;
  let finalPageShort = false;
  let availableAgedInventory = 0;
  let activeLot = 0;
  let commerceIncluded = 0;
  let inactiveLot = 0;
  let classifierUnavailableInventory = 0;
  let commerceExcluded = 0;
  let protectedAgent = 0;
  let buyerOrigin = 0;
  let invalidIdentity = 0;
  let notBuyerReady = 0;
  let previousBuyerDeliveryIdentity = 0;
  let crossBucketOrStateDuplicate = 0;
  let finalEligible = 0;

  for (;;) {
    if (input.maxPages != null && pagesRead >= input.maxPages) {
      throw new Error("audit_scan_incomplete:max_pages_reached");
    }
    const rows = await readAuditPage(db, stageCounts.stageAged, cursor, input.pageSize);
    pagesRead += 1;
    if (rows.length === 0) {
      finalPageShort = true;
      break;
    }

    for (const row of rows) {
      const nextCursor = { generatedAt: row.generatedAt, id: row.id };
      if (!compareCursor(nextCursor, cursor)) strictKeysetOrder = false;
      cursor = nextCursor;
      rowsVisited += 1;

      // Stage diagnostics intentionally remain a sequential funnel independent
      // of the mutually exclusive classifier outcome below.
      if (row.status === "available") {
        availableAgedInventory += 1;
        if (row.inventoryLot.status === "active") {
          activeLot += 1;
          if (row.commerceExcludedAt == null) commerceIncluded += 1;
        } else {
          inactiveLot += 1;
        }
      } else {
        incrementUnavailableStatus(row.status, unavailableByStatus);
      }

      const classified = classifyPplInventoryCandidate(row, {
        commerceAgeBucketKeys: [
          ...PPL_AGGREGATE_AUDIT_BUCKETS,
        ] as CommerceAgeBucketRequestKey[],
        clientAccountId: input.clientAccountId,
        exclusions: exclusions as ProtectedAgentExclusionRecord[],
        evaluatedAt,
        buyerPhoneFingerprints: buyerSeen.phoneFingerprints,
        buyerEmailFingerprints: buyerSeen.emailFingerprints,
        acceptedPhoneFingerprints: acceptedPhones,
        acceptedEmailFingerprints: acceptedEmails,
      });

      if (!classified.eligible) {
        switch (classified.reason) {
          case "commerceExcluded":
            commerceExcluded += 1;
            break;
          case "unavailableInventory":
            classifierUnavailableInventory += 1;
            if (row.status === "available" && row.inventoryLot.status === "active") {
              throw new Error("audit_classifier_prefilter_invariant_failed:unavailableInventory");
            }
            break;
          case "protectedAgent":
            protectedAgent += 1;
            break;
          case "originClient":
            buyerOrigin += 1;
            break;
          case "invalidIdentity":
            invalidIdentity += 1;
            break;
          case "notBuyerReady":
            notBuyerReady += 1;
            for (const reason of classified.buyerReadyReasons ?? []) {
              buyerReadyReasons[reason] += 1;
            }
            break;
          case "sameBuyerPriorDelivery":
            previousBuyerDeliveryIdentity += 1;
            break;
          case "currentBatchDuplicate":
            crossBucketOrStateDuplicate += 1;
            break;
          default:
            throw new Error(`audit_classifier_prefilter_invariant_failed:${classified.reason}`);
        }
        continue;
      }

      const candidate = classified.candidate;
      const tier = tierForCandidate(candidate.commerceAgeBucketKey);
      const stateCounts = matrixMap.get(row.normalizedState);
      if (!stateCounts) throw new Error("candidate_state_invariant_failed");
      stateCounts[tier] += 1;
      tierSubtotals[tier] += 1;
      finalEligible += 1;
      if (candidate.phoneFingerprint) acceptedPhones.add(candidate.phoneFingerprint);
      if (candidate.emailFingerprint) acceptedEmails.add(candidate.emailFingerprint);
    }

    if (rows.length < input.pageSize) {
      finalPageShort = true;
      break;
    }
  }

  const afterProtectedAgent = commerceIncluded - protectedAgent;
  const afterBuyerOrigin = afterProtectedAgent - buyerOrigin;
  const validIdentity = afterBuyerOrigin - invalidIdentity;
  const buyerReady = validIdentity - notBuyerReady;
  const afterPreviousBuyerDelivery = buyerReady - previousBuyerDeliveryIdentity;
  const matrix = input.states.map((state) => {
    const quantities = matrixMap.get(state)!;
    return { state, quantities, subtotal: sumRecord(quantities) };
  });

  const pricing = Object.fromEntries(
    PPL_AGGREGATE_AUDIT_BUCKETS.map((tier) => {
      const price = resolvePplAgedUnitPriceCents({
        commerceAgeBucketKey: tier,
        nicheKey: input.nicheKey,
        pricingVersion: PPL_AGED_PRICING_VERSION,
      });
      if (!price.ok) throw new Error(`audit_pricing_invariant_failed:${price.code}`);
      const quantity = tierSubtotals[tier];
      return [
        tier,
        {
          quantity,
          unitPriceCents: price.unitPriceCents,
          totalCents: computePplLineTotalCents(quantity, price.unitPriceCents),
        },
      ];
    })
  ) as PplAggregateInventoryAuditReport["quote"]["tiers"];
  const grandTotalCents = Object.values(pricing).reduce(
    (sum, tier) => sum + tier.totalCents,
    0
  );

  const fulfillmentBatches = Object.fromEntries(
    PPL_AGGREGATE_AUDIT_BUCKETS.map((tier) => {
      const quantity = tierSubtotals[tier];
      return [
        tier,
        {
          quantity,
          maximumBatchSize: PPL_AGGREGATE_AUDIT_BATCH_SIZE,
          estimatedOrderCount: Math.ceil(quantity / PPL_AGGREGATE_AUDIT_BATCH_SIZE),
          fullSizeOrderCount: Math.floor(quantity / PPL_AGGREGATE_AUDIT_BATCH_SIZE),
          remainderQuantity: quantity % PPL_AGGREGATE_AUDIT_BATCH_SIZE,
        },
      ];
    })
  ) as PplAggregateInventoryAuditReport["fulfillmentBatches"];

  const scanCountMatchesCohort = rowsVisited === stageCounts.aged;
  const waterfallReconciles =
    classifierUnavailableInventory +
      commerceExcluded +
      protectedAgent +
      buyerOrigin +
      invalidIdentity +
      notBuyerReady +
      previousBuyerDeliveryIdentity +
      crossBucketOrStateDuplicate +
      finalEligible ===
    stageCounts.aged;
  const matrixReconciles =
    matrix.reduce((sum, row) => sum + row.subtotal, 0) === finalEligible;
  const tierSubtotalsReconcile = sumRecord(tierSubtotals) === finalEligible;

  if (
    !finalPageShort ||
    !strictKeysetOrder ||
    !scanCountMatchesCohort ||
    !waterfallReconciles ||
    !matrixReconciles ||
    !tierSubtotalsReconcile
  ) {
    throw new Error("audit_completeness_invariant_failed");
  }

  return {
    schema: PPL_AGGREGATE_AUDIT_SCHEMA,
    pricingVersion: PPL_AGED_PRICING_VERSION,
    buyer: input.clientAccountId,
    nicheKey: input.nicheKey,
    states: input.states,
    asOf: evaluatedAt.toISOString(),
    transaction: {
      isolationLevel: "REPEATABLE READ",
      readOnly: true,
      statementTimeoutMs: PPL_AGGREGATE_AUDIT_STATEMENT_TIMEOUT_MS,
      transactionTimeoutMs: PPL_AGGREGATE_AUDIT_TRANSACTION_TIMEOUT_MS,
    },
    coverage: "complete",
    pagination: {
      method: "keyset_generatedAt_id",
      pageSize: input.pageSize,
      pagesRead,
      rowsVisited,
      finalPageShort: true,
      nextCursor: null,
    },
    stages: {
      rawCanonicalInventory: stageCounts.rawCanonicalInventory,
      matchingNiche: stageCounts.matchingNiche,
      matchingRequestedStates: stageCounts.matchingRequestedStates,
      matchingAgeTier: stageCounts.matchingAgeTier,
      agedInventory: stageCounts.aged,
      availableAgedInventory,
      unavailableByStatus,
      activeLot,
      inactiveLot,
      commerceIncluded,
      afterProtectedAgent,
      afterBuyerOrigin,
      validIdentity,
      buyerReady,
      afterPreviousBuyerDelivery,
      finalEligible,
    },
    exclusions: {
      nonAgedInventory: stageCounts.matchingAgeTier - stageCounts.aged,
      unavailableInventory: classifierUnavailableInventory,
      commerceExcluded,
      protectedAgent,
      buyerOrigin,
      invalidIdentity,
      notBuyerReady,
      buyerReadyReasons,
      previousBuyerDeliveryIdentity,
      crossBucketOrStateDuplicate,
    },
    matrix,
    tierSubtotals,
    quote: { currency: "USD", tiers: pricing, grandTotalCents },
    fulfillmentBatches,
    informational: {
      priorBuyerAllocationsByStatus,
      concernsNotAppliedByCurrentSelector: [
        "Generic proof and verification readiness are not PPL selector predicates.",
        "Order source-lane and campaign restrictions are not PPL selector predicates.",
        "Committed inventory remains globally unavailable; this audit assumes no shared-resale override.",
        "Consent and permissible-resale evidence require separate operator review.",
      ],
    },
    invariants: {
      readOnlyTransaction: true,
      snapshotTimestampFixed: true,
      strictKeysetOrder: true,
      scanCountMatchesCohort: true,
      waterfallReconciles: true,
      matrixReconciles: true,
      tierSubtotalsReconcile: true,
      noPartialScanReportedComplete: true,
      aggregateOnlyOutput: true,
    },
  };
}

type SnapshotRow = {
  asOf: Date;
  readOnly: string;
  isolationLevel: string;
};

export async function executePplAggregateInventoryAudit(
  input: PplAggregateAuditInput,
  db: PrismaClient
): Promise<PplAggregateInventoryAuditReport> {
  return db.$transaction(
    async (tx) => {
      // Must be the first statement in the transaction. Any accidental write
      // added later is rejected by PostgreSQL itself.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${PPL_AGGREGATE_AUDIT_STATEMENT_TIMEOUT_MS}ms'`
      );
      await tx.$executeRawUnsafe(
        `SET LOCAL idle_in_transaction_session_timeout = '${PPL_AGGREGATE_AUDIT_IDLE_TIMEOUT_MS}ms'`
      );
      const rows = await tx.$queryRaw<SnapshotRow[]>`
        SELECT
          transaction_timestamp() AS "asOf",
          current_setting('transaction_read_only') AS "readOnly",
          current_setting('transaction_isolation') AS "isolationLevel"
      `;
      const snapshot = rows[0];
      if (!snapshot || snapshot.readOnly !== "on") {
        throw new Error("database_transaction_not_read_only");
      }
      if (snapshot.isolationLevel.toLowerCase() !== "repeatable read") {
        throw new Error("database_transaction_not_repeatable_read");
      }
      const snapshotAt = snapshot.asOf;
      if (!(snapshotAt instanceof Date) || Number.isNaN(snapshotAt.getTime())) {
        throw new Error("database_snapshot_timestamp_invalid");
      }
      const ageEvaluatedAt = input.ageAsOf ?? snapshotAt;
      if (Number.isNaN(ageEvaluatedAt.getTime())) throw new Error("audit_as_of_invalid");
      const report = await buildPplAggregateInventoryAudit(input, ageEvaluatedAt, tx);
      return {
        ...report,
        asOf: ageEvaluatedAt.toISOString(),
        ageEvaluation: {
          source: input.ageAsOf ? "explicit_age_as_of" : "transaction_snapshot",
          asOf: ageEvaluatedAt.toISOString(),
        },
        transaction: {
          ...report.transaction,
          snapshotAt: snapshotAt.toISOString(),
        },
      };
    },
    {
      isolationLevel: PrismaNamespace.TransactionIsolationLevel.RepeatableRead,
      maxWait: PPL_AGGREGATE_AUDIT_MAX_WAIT_MS,
      timeout: PPL_AGGREGATE_AUDIT_TRANSACTION_TIMEOUT_MS,
    }
  );
}

type CliOptions = PplAggregateAuditInput & { expectedDbHost: string; ageAsOf: Date };

const UTC_AGE_AS_OF =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/;

/** Parse an explicit UTC age cutoff. Date-only values and non-zero offsets are rejected. */
export function parseUtcAgeAsOf(value: string): Date {
  const trimmed = value.trim();
  const match = UTC_AGE_AS_OF.exec(trimmed);
  if (!match) throw new Error("age_as_of_invalid");
  const fraction = (match[2] ?? "").padEnd(3, "0").slice(0, 3);
  const parsed = new Date(`${match[1]}.${fraction}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("age_as_of_invalid");
  return parsed;
}

export function parsePplAggregateAuditArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const separator = raw.indexOf("=");
    if (separator < 0) throw new Error(`argument_value_required:${raw.slice(2)}`);
    args.set(raw.slice(2, separator), raw.slice(separator + 1));
  }
  const ageAsOfRaw = args.get("age-as-of");
  if (ageAsOfRaw == null || ageAsOfRaw.trim() === "") throw new Error("age_as_of_required");
  const states = (args.get("states") ?? VANESSA_AUDIT_DEFAULTS.states.join(","))
    .split(",")
    .map((state) => state.trim());
  const pageSizeRaw = args.get("page-size");
  const pageSize = pageSizeRaw == null ? undefined : Number(pageSizeRaw);
  return {
    clientAccountId:
      args.get("client-account-id") ?? VANESSA_AUDIT_DEFAULTS.clientAccountId,
    nicheKey: args.get("niche") ?? VANESSA_AUDIT_DEFAULTS.nicheKey,
    states,
    pageSize,
    ageAsOf: parseUtcAgeAsOf(ageAsOfRaw),
    expectedDbHost: args.get("expected-db-host")?.trim() ?? "",
  };
}

function redactAuditError(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://[redacted]");
}

export async function runPplAggregateInventoryAuditCli(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  const options = parsePplAggregateAuditArgs(argv);
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) throw new Error("database_url_required");
  assertExpectedDbHost({
    databaseUrl,
    expectedDbHost: options.expectedDbHost,
  });

  const db = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    const report = await executePplAggregateInventoryAudit(options, db);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await db.$disconnect();
  }
}

function isDirectExecution(): boolean {
  const argvPath = process.argv[1];
  return Boolean(argvPath && resolve(argvPath) === resolve(fileURLToPath(import.meta.url)));
}

if (isDirectExecution()) {
  runPplAggregateInventoryAuditCli().catch((error) => {
    const message = error instanceof Error ? error.message : "audit_failed";
    process.stderr.write(`${JSON.stringify({ ok: false, error: redactAuditError(message) })}\n`);
    process.exitCode = 1;
  });
}
