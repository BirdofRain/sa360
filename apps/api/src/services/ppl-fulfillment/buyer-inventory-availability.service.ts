/**
 * Read-only buyer-specific inventory availability.
 *
 * Reuses canonical PPL selection predicates (buyer-ready, commerce age windows,
 * available/active-lot, commerce exclusion, protected agents, buyer delivery
 * fingerprints, in-result identity dedupe). It does not create orders,
 * reservations, deliveries, or CSV files, and it does not mutate source data.
 *
 * Diverges from selection in three deliberate ways:
 * 1. Selection may stop after a requested quantity or 5,000 scanned rows and
 *    report that window as eligibleQuantity. This lookup counts the cohort.
 *    When classification cannot finish, eligible numbers are lower bounds.
 * 2. Selection treats a null origin stamp as eligible. This lookup does not.
 *    A missing stamp is buyer-eligible only when the canonical confirmed
 *    LeadCapture source association reconciles exactly one origin that is not
 *    the buyer. Unresolved origin is reported separately.
 * 3. Selection's SQL predicate is `status = available` and does not exclude an
 *    open allocation until reservation flips that status. This lookup also
 *    excludes open allocations (shadow, reserved, delivering, committed,
 *    review_required) so an in-flight claim is not counted as takeable.
 *
 * Counts and the classification scan share one REPEATABLE READ, READ ONLY
 * transaction. Exact means exact for that snapshot, not for writes that commit
 * after the transaction starts. PostgreSQL read committed cannot make the
 * parallel counts and later pages one snapshot.
 */

import type { Prisma, PrismaClient, SourceLeadProvider } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import {
  COMMERCE_AGE_BUCKETS,
  canonicalizeCommerceNicheKey,
  isCanonicalUsStateCode,
  sanitizeCanonicalUsStates,
  type CommerceAgeBucketKey,
  type CommerceAgeBucketRequestKey,
} from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import { companySheetsInternalPilotLeadExclusion } from "../company-sheets-dispatch/company-sheets-pilot-isolation.js";
import { anyPhoneFingerprintHit } from "../../lib/identity-fingerprint.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { prismaCommerceNicheWhere } from "../commerce/commerce-niche-match.js";
import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import {
  EMPTY_LEADCAPTURE_SOURCE_IDENTITY_SIGNALS,
  leadCaptureSourceIdentitySignalsFromLifecyclePayload,
  withLeadCaptureSourceCampaignIdFallback,
  type LeadCaptureSourceIdentitySignals,
} from "../source-intake/leadcapture-source-identity-signals.js";
import { resolveConfirmedLeadCaptureSourceAssociation } from "../source-intake/leadcapture-source-association.service.js";
import { SOURCE_FUNNEL_LEADCAPTURE_PROVIDER } from "../source-intake/source-funnel.service.js";
import {
  buildCommerceGeneratedAtWhere,
  buildIdentityFingerprints,
  loadBuyerSeenFingerprints,
  matchesCommerceAgeBucketFilter,
  PPL_SELECTION_MAX_SCANNED_ROWS,
} from "./inventory-selection.service.js";
import { resolveCommerceAgeBucketKey } from "./commerce-age-buckets.js";
import { isOriginClientBuyerIneligible } from "./origin-client-exclusion.js";
import {
  evaluatePplBuyerReadyEligibility,
  type PplBuyerReadyRejectionReason as BuyerReadyReason,
} from "./ppl-buyer-ready-eligibility.js";
import {
  isItemExcludedByProtectedAgents,
  listActiveExclusions,
} from "./protected-agent-exclusion.service.js";

export const BUYER_INVENTORY_AVAILABILITY_POLICY = "buyer-inventory-availability-v1";
export const BUYER_AVAILABILITY_PAGE_SIZE = 250;
/** Safety ceiling for payload classification. Not a reported total. */
export const BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS = 100_000;
/** One admin lookup may hold a single pooled connection for the snapshot. */
export const BUYER_AVAILABILITY_SNAPSHOT_TIMEOUT_MS = 300_000;
export const BUYER_AVAILABILITY_SNAPSHOT_MAX_WAIT_MS = 10_000;

const OPEN_ALLOCATION_STATUSES = [
  "shadow",
  "reserved",
  "delivering",
  "committed",
  "review_required",
] as const;

const BUYER_READY_REASONS = [
  "first_name_too_short",
  "last_name_too_short",
  "first_name_multipart",
  "last_name_multipart",
  "first_name_has_digits",
  "last_name_has_digits",
  "phone_missing",
  "phone_truncated",
  "phone_overlong",
  "phone_structurally_invalid",
  "consumer_age_missing",
  "consumer_age_invalid",
  "consumer_age_over_maximum",
] as const satisfies readonly BuyerReadyReason[];

export type BuyerAvailabilityCountSemantics = "exact" | "lower_bound" | "not_reached";

export type BuyerAvailabilityCounted = {
  count: number;
  countSemantics: "exact" | "lower_bound";
};

export type BuyerAvailabilityTierCount = {
  commerceAgeBucketKey: CommerceAgeBucketKey;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  /** Null when this tier was not reached. A zero here would be a fake total. */
  eligible: number | null;
  classified: number;
  countSemantics: BuyerAvailabilityCountSemantics;
};

export type BuyerInventoryAvailabilityReport = {
  ok: true;
  policyVersion: typeof BUYER_INVENTORY_AVAILABILITY_POLICY;
  readOnly: true;
  effects: {
    orderCreated: false;
    reservationCreated: false;
    deliveryRecorded: false;
    csvGenerated: false;
    sourceDataMutated: false;
  };
  evaluatedAt: string;
  /**
   * Exact structural and eligible counts describe this snapshot only.
   * `consistent` is true only after the read-only repeatable-read transaction
   * has started. A torn read committed scan never returns this report.
   */
  snapshot: {
    isolation: "repeatable_read";
    consistent: true;
    readOnly: true;
    scope: "transaction_start";
  };
  buyer: { clientAccountId: string; clientDisplayName: string };
  nicheKey: string;
  states: string[];
  requestedCommerceAgeBucketKeys: CommerceAgeBucketRequestKey[];
  allAgedTiers: boolean;
  queryCompleteness: "complete" | "incomplete";
  eligibleCountSemantics: "exact" | "lower_bound";
  eligibleTotal: number;
  ageTiers: BuyerAvailabilityTierCount[];
  structuralCohort: {
    countSemantics: "exact";
    rows: number;
    availableActiveLot: number;
    reserved: number;
    committed: number;
    commerceExcluded: number;
    openAllocationOnAvailable: number;
    stampedSameOrigin: number;
    stampedOtherOrigin: number;
    unstampedSelectable: number;
    unstampedNotReconcilable: number;
  };
  exclusionReasons: {
    originClientStamped: BuyerAvailabilityCounted;
    originClientReconciled: BuyerAvailabilityCounted;
    originUnresolved: BuyerAvailabilityCounted;
    existingAllocation: BuyerAvailabilityCounted;
    reserved: BuyerAvailabilityCounted;
    committed: BuyerAvailabilityCounted;
    commerceExcluded: BuyerAvailabilityCounted;
    protectedAgent: BuyerAvailabilityCounted;
    notBuyerReady: BuyerAvailabilityCounted;
    buyerReadyRejections: Record<BuyerReadyReason, number>;
    sameBuyerPriorDelivery: BuyerAvailabilityCounted;
    currentBatchDuplicate: BuyerAvailabilityCounted;
    invalidIdentity: BuyerAvailabilityCounted;
    ageBucketMismatch: BuyerAvailabilityCounted;
    nameReviewFlagged: BuyerAvailabilityCounted;
  };
  provenance: {
    stampedConfirmed: number;
    reconciledFromSourceFunnel: number;
    unresolvedOrigin: number;
    unresolvedReasons: Record<string, number>;
    unstampedNotClassified: number;
    coverageNote: string;
  };
  scan: {
    rowsClassified: number;
    pagesRead: number;
    selectableRowsExact: number;
    rowsUnclassified: number;
    classificationCeiling: number;
    ceilingHit: boolean;
    /** Present so operators do not confuse this lookup with selection preview. */
    selectionScanCeiling: typeof PPL_SELECTION_MAX_SCANNED_ROWS;
    usesSelectionRowCap: false;
  };
  summary: string;
};

export type BuyerInventoryAvailabilityFailure = {
  ok: false;
  code:
    | "buyer_not_found"
    | "invalid_niche"
    | "invalid_states"
    | "invalid_age_buckets"
    | "historical_delivery_suppression_unavailable"
    | "availability_snapshot_unavailable";
  reasons: string[];
};

export type BuyerInventoryAvailabilityResult =
  | BuyerInventoryAvailabilityReport
  | BuyerInventoryAvailabilityFailure;

type AvailabilityDb = PrismaClient | Prisma.TransactionClient;

function isAvailabilitySnapshotError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code === "P2028" || code === "availability_snapshot_unavailable") return true;
  const message = error instanceof Error ? error.message : "";
  return /Transaction already closed|transaction timeout|Unable to start a transaction|current transaction is aborted/i.test(
    message
  );
}

/**
 * One snapshot for every count, fingerprint load, source-funnel read, and page.
 * Read only so a bug cannot insert an order, reservation, delivery, or stamp.
 * Callers without `$transaction` fail closed instead of returning torn counts.
 */
async function withRepeatableReadSnapshot<T>(
  db: AvailabilityDb,
  run: (db: PrismaClient) => Promise<T>
): Promise<T> {
  const client = db as PrismaClient;
  if (typeof client.$transaction !== "function") {
    throw Object.assign(new Error("availability_snapshot_unavailable"), {
      code: "availability_snapshot_unavailable",
    });
  }
  return client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return run(tx as PrismaClient);
    },
    {
      isolationLevel: PrismaNamespace.TransactionIsolationLevel.RepeatableRead,
      maxWait: BUYER_AVAILABILITY_SNAPSHOT_MAX_WAIT_MS,
      timeout: BUYER_AVAILABILITY_SNAPSHOT_TIMEOUT_MS,
    }
  );
}

type ScanRow = {
  id: string;
  generatedAt: Date;
  normalizedState: string;
  originClientAccountId: string | null;
  metadataJson: Prisma.JsonValue;
  status: string;
  commerceExcludedAt: Date | null;
  inventoryLot: { supplierAccountId: string | null; status: string };
  sourceLeadEvent: {
    id: string;
    sourceProvider: SourceLeadProvider | string;
    sourceCampaignId: string | null;
    normalizedPayloadJson: Prisma.JsonValue;
    rawPayloadJson: Prisma.JsonValue;
    enrichmentMetadataJson: Prisma.JsonValue;
  };
  leadAllocations: Array<{ id: string }>;
};

function counted(count: number, countSemantics: "exact" | "lower_bound"): BuyerAvailabilityCounted {
  return { count, countSemantics };
}

function emptyBuyerReadyRejections(): Record<BuyerReadyReason, number> {
  return Object.fromEntries(BUYER_READY_REASONS.map((reason) => [reason, 0])) as Record<
    BuyerReadyReason,
    number
  >;
}

export function parseBuyerAvailabilityStates(
  states: readonly string[]
): { ok: true; states: string[] } | { ok: false } {
  const normalized = states.map((state) => state.trim().toUpperCase()).filter(Boolean);
  if (normalized.length === 0) return { ok: false };
  const sanitized = sanitizeCanonicalUsStates(normalized);
  if (sanitized.length !== new Set(normalized).size) return { ok: false };
  if (sanitized.some((state) => !isCanonicalUsStateCode(state))) return { ok: false };
  return { ok: true, states: sanitized };
}

export function parseBuyerAvailabilityBuckets(
  value: unknown
): { ok: true; keys: CommerceAgeBucketRequestKey[] } | { ok: false } {
  if (value == null) return { ok: true, keys: [] };
  if (!Array.isArray(value)) return { ok: false };
  const keys: CommerceAgeBucketRequestKey[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false };
    const trimmed = entry.trim();
    if (
      trimmed !== "COMMERCE_1_3_MO" &&
      trimmed !== "COMMERCE_3_6_MO" &&
      trimmed !== "COMMERCE_6_9_MO" &&
      trimmed !== "COMMERCE_9_12_MO" &&
      trimmed !== "COMMERCE_12_MO_PLUS" &&
      trimmed !== "COMMERCE_6_12_MO"
    ) {
      return { ok: false };
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    keys.push(trimmed);
  }
  return { ok: true, keys };
}

export function concreteAvailabilityTierKeys(
  requested: readonly CommerceAgeBucketRequestKey[]
): CommerceAgeBucketKey[] {
  if (requested.length === 0) return COMMERCE_AGE_BUCKETS.map((bucket) => bucket.key);
  const wanted = new Set<CommerceAgeBucketKey>();
  for (const key of requested) {
    // Historical portal union orders still lock selection to COMMERCE_6_12_MO.
    // New lookups pass one of the five priced keys and count that range only.
    if (key === "COMMERCE_6_12_MO") {
      wanted.add("COMMERCE_6_9_MO");
      wanted.add("COMMERCE_9_12_MO");
      continue;
    }
    wanted.add(key);
  }
  return COMMERCE_AGE_BUCKETS.map((bucket) => bucket.key).filter((key) => wanted.has(key));
}

/**
 * Oldest-first scan. A tier is exact once a younger row has been classified,
 * a lower bound while the cursor is still inside it, and not reached before
 * the cursor enters it.
 */
export function resolveAvailabilityTierSemantics(input: {
  queryComplete: boolean;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  lastClassifiedAgeDays: number | null;
}): BuyerAvailabilityCountSemantics {
  if (input.queryComplete) return "exact";
  if (input.lastClassifiedAgeDays == null) return "not_reached";
  if (input.lastClassifiedAgeDays < input.minDaysInclusive) return "exact";
  if (input.maxDaysExclusive != null && input.lastClassifiedAgeDays >= input.maxDaysExclusive) {
    return "not_reached";
  }
  return "lower_bound";
}

function andWhere(
  ...clauses: Prisma.LeadInventoryItemWhereInput[]
): Prisma.LeadInventoryItemWhereInput {
  return { AND: clauses };
}

function structuralWhere(
  nicheKey: string,
  states: string[],
  buckets: CommerceAgeBucketRequestKey[],
  evaluatedAt: Date
): Prisma.LeadInventoryItemWhereInput {
  return andWhere(
    { inventoryClass: "aged" },
    { normalizedState: { in: states } },
    prismaCommerceNicheWhere(nicheKey),
    buildCommerceGeneratedAtWhere(buckets, evaluatedAt)
  );
}

function availableActiveWhere(
  structural: Prisma.LeadInventoryItemWhereInput
): Prisma.LeadInventoryItemWhereInput {
  return andWhere(structural, {
    status: "available",
    commerceExcludedAt: null,
    inventoryLot: { status: "active" },
    sourceLeadEvent: companySheetsInternalPilotLeadExclusion(),
  });
}

function withoutOpenAllocation(
  where: Prisma.LeadInventoryItemWhereInput
): Prisma.LeadInventoryItemWhereInput {
  return andWhere(where, {
    leadAllocations: { none: { status: { in: [...OPEN_ALLOCATION_STATUSES] } } },
  });
}

function cursorWhere(
  cursor: { generatedAt: Date; id: string }
): Prisma.LeadInventoryItemWhereInput {
  return {
    OR: [
      { generatedAt: { gt: cursor.generatedAt } },
      { generatedAt: cursor.generatedAt, id: { gt: cursor.id } },
    ],
  };
}

function originSignalCacheKey(
  sourceCampaignId: string | null,
  signals: LeadCaptureSourceIdentitySignals
): string {
  return JSON.stringify([
    sourceCampaignId,
    signals.providerFormIds,
    signals.parentUrlKey,
    signals.hostedPageSlug,
  ]);
}

type ReconciledOrigin =
  | { kind: "reconciled"; originClientAccountId: string }
  | { kind: "unresolved"; reason: string };

async function reconcileMissingOrigin(
  row: ScanRow,
  db: AvailabilityDb,
  cache: Map<string, ReconciledOrigin>
): Promise<ReconciledOrigin> {
  if (row.sourceLeadEvent.sourceProvider !== SOURCE_FUNNEL_LEADCAPTURE_PROVIDER) {
    return { kind: "unresolved", reason: "provider_not_reconcilable" };
  }
  const parsed = lifecycleEventSchema.safeParse(row.sourceLeadEvent.normalizedPayloadJson);
  const signals = withLeadCaptureSourceCampaignIdFallback(
    parsed.success
      ? leadCaptureSourceIdentitySignalsFromLifecyclePayload(parsed.data)
      : EMPTY_LEADCAPTURE_SOURCE_IDENTITY_SIGNALS,
    row.sourceLeadEvent.sourceCampaignId
  );
  const cacheKey = originSignalCacheKey(row.sourceLeadEvent.sourceCampaignId, signals);
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const association = await resolveConfirmedLeadCaptureSourceAssociation(signals, db);
  const resolved: ReconciledOrigin = association.matched
    ? { kind: "reconciled", originClientAccountId: association.match.originClientAccountId }
    : { kind: "unresolved", reason: association.reason };
  cache.set(cacheKey, resolved);
  return resolved;
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

export async function lookupBuyerInventoryAvailability(
  input: {
    clientAccountId: string;
    nicheKey: string;
    states: readonly string[];
    commerceAgeBucketKeys?: unknown;
    evaluatedAt?: Date;
    /** Test seam. Clamped to the production ceiling. Not accepted on HTTP. */
    maxClassifiedRows?: number;
    pageSize?: number;
    /**
     * Test seam. Runs inside the snapshot after each classified page, so a
     * second connection can commit inventory changes the snapshot must ignore.
     * Not accepted on HTTP.
     */
    afterClassificationPage?: (progress: {
      pagesRead: number;
      rowsClassified: number;
    }) => Promise<void>;
  },
  db: AvailabilityDb = prisma
): Promise<BuyerInventoryAvailabilityResult> {
  const nicheKey = canonicalizeCommerceNicheKey(input.nicheKey);
  if (!nicheKey) return { ok: false, code: "invalid_niche", reasons: ["invalid_niche"] };
  const states = parseBuyerAvailabilityStates(input.states);
  if (!states.ok) return { ok: false, code: "invalid_states", reasons: ["invalid_states"] };
  const buckets = parseBuyerAvailabilityBuckets(input.commerceAgeBucketKeys);
  if (!buckets.ok) {
    return { ok: false, code: "invalid_age_buckets", reasons: ["invalid_age_buckets"] };
  }
  try {
    return await withRepeatableReadSnapshot(db, (snapshotDb) =>
      lookupBuyerInventoryAvailabilityOnSnapshot(input, snapshotDb)
    );
  } catch (error) {
    if (isAvailabilitySnapshotError(error)) {
      return {
        ok: false,
        code: "availability_snapshot_unavailable",
        reasons: ["availability_snapshot_unavailable"],
      };
    }
    throw error;
  }
}

async function lookupBuyerInventoryAvailabilityOnSnapshot(
  input: {
    clientAccountId: string;
    nicheKey: string;
    states: readonly string[];
    commerceAgeBucketKeys?: unknown;
    evaluatedAt?: Date;
    maxClassifiedRows?: number;
    pageSize?: number;
    afterClassificationPage?: (progress: {
      pagesRead: number;
      rowsClassified: number;
    }) => Promise<void>;
  },
  db: PrismaClient
): Promise<BuyerInventoryAvailabilityResult> {
  const clientAccountId = input.clientAccountId.trim();
  const nicheKey = canonicalizeCommerceNicheKey(input.nicheKey);
  if (!nicheKey) return { ok: false, code: "invalid_niche", reasons: ["invalid_niche"] };
  const states = parseBuyerAvailabilityStates(input.states);
  if (!states.ok) return { ok: false, code: "invalid_states", reasons: ["invalid_states"] };
  const buckets = parseBuyerAvailabilityBuckets(input.commerceAgeBucketKeys);
  if (!buckets.ok) {
    return { ok: false, code: "invalid_age_buckets", reasons: ["invalid_age_buckets"] };
  }

  const buyer = await db.clientAccount.findUnique({
    where: { clientAccountId },
    select: { clientAccountId: true, clientDisplayName: true },
  });
  if (!buyer) return { ok: false, code: "buyer_not_found", reasons: ["buyer_not_found"] };

  const evaluatedAt = input.evaluatedAt ?? new Date();
  const ceiling = Math.min(
    BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS,
    Math.max(1, input.maxClassifiedRows ?? BUYER_AVAILABILITY_MAX_CLASSIFIED_ROWS)
  );
  const pageSize = Math.min(
    BUYER_AVAILABILITY_PAGE_SIZE,
    Math.max(1, input.pageSize ?? BUYER_AVAILABILITY_PAGE_SIZE)
  );
  const tierKeys = concreteAvailabilityTierKeys(buckets.keys);
  const structural = structuralWhere(nicheKey, states.states, buckets.keys, evaluatedAt);
  const availableActive = availableActiveWhere(structural);
  const pool = withoutOpenAllocation(availableActive);
  const scanPool = andWhere(pool, {
    OR: [
      {
        AND: [
          { originClientAccountId: { not: null } },
          { NOT: { originClientAccountId: buyer.clientAccountId } },
        ],
      },
      {
        originClientAccountId: null,
        // Inventory sourceProvider is stamped with the event provider at intake.
        // Reconciliation still rechecks the event before a null origin can match.
        sourceProvider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
      },
    ],
  });

  const exclusions = await listActiveExclusions(db);
  let seenPhones: Set<string>;
  let seenEmails: Set<string>;
  try {
    const seen = await loadBuyerSeenFingerprints(buyer.clientAccountId, db);
    seenPhones = seen.phoneFingerprints;
    seenEmails = seen.emailFingerprints;
  } catch {
    return {
      ok: false,
      code: "historical_delivery_suppression_unavailable",
      reasons: ["historical_delivery_suppression_unavailable"],
    };
  }

  // Sequential on the single transaction connection. Promise.all is not safe
  // inside a Prisma interactive transaction, and separate read-committed
  // statements would not share this snapshot.
  const cohortRows = await db.leadInventoryItem.count({ where: structural });
  const availableActiveLot = await db.leadInventoryItem.count({ where: availableActive });
  const reserved = await db.leadInventoryItem.count({
    where: andWhere(structural, { status: "reserved" }),
  });
  const committed = await db.leadInventoryItem.count({
    where: andWhere(structural, { status: "committed" }),
  });
  const commerceExcluded = await db.leadInventoryItem.count({
    where: andWhere(structural, { commerceExcludedAt: { not: null } }),
  });
  const openAllocationOnAvailable = await db.leadInventoryItem.count({
    where: andWhere(availableActive, {
      leadAllocations: { some: { status: { in: [...OPEN_ALLOCATION_STATUSES] } } },
    }),
  });
  const stampedSameOrigin = await db.leadInventoryItem.count({
    where: andWhere(pool, { originClientAccountId: buyer.clientAccountId }),
  });
  const stampedOtherOrigin = await db.leadInventoryItem.count({
    where: andWhere(pool, {
      originClientAccountId: { not: null },
      NOT: { originClientAccountId: buyer.clientAccountId },
    }),
  });
  const unstampedSelectable = await db.leadInventoryItem.count({
    where: andWhere(pool, { originClientAccountId: null }),
  });
  const unstampedNotReconcilable = await db.leadInventoryItem.count({
    where: andWhere(pool, {
      originClientAccountId: null,
      NOT: { sourceProvider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER },
    }),
  });
  const selectableRowsExact = await db.leadInventoryItem.count({ where: scanPool });

  const scanSemantics = (complete: boolean): "exact" | "lower_bound" =>
    complete ? "exact" : "lower_bound";

  const classifiedByTier = new Map<CommerceAgeBucketKey, number>(tierKeys.map((key) => [key, 0]));
  const eligibleByTier = new Map<CommerceAgeBucketKey, number>(tierKeys.map((key) => [key, 0]));
  const buyerReadyRejections = emptyBuyerReadyRejections();
  const unresolvedReasons: Record<string, number> = {};
  let protectedAgent = 0;
  let invalidIdentity = 0;
  let notBuyerReady = 0;
  let sameBuyerPriorDelivery = 0;
  let currentBatchDuplicate = 0;
  let originClientReconciled = 0;
  let originUnresolved = 0;
  let unstampedClassified = 0;
  let reconciledFromSourceFunnel = 0;
  let ageBucketMismatch = 0;
  let nameReviewFlagged = 0;
  let openAllocationLeak = 0;
  let rowsClassified = 0;
  let pagesRead = 0;
  let lastClassifiedAgeDays: number | null = null;
  const batchPhones = new Set<string>();
  const batchEmails = new Set<string>();
  const originCache = new Map<string, ReconciledOrigin>();
  let cursor: { generatedAt: Date; id: string } | null = null;

  while (rowsClassified < ceiling && rowsClassified < selectableRowsExact) {
    const take = Math.min(pageSize, ceiling - rowsClassified);
    // Keyset the item rows first. Payload joins stay on this page so a
    // 100,000-row ceiling does not pull every source event before LIMIT.
    const idRows: Array<{ id: string; generatedAt: Date }> = await db.leadInventoryItem.findMany({
      where: cursor ? andWhere(scanPool, cursorWhere(cursor)) : scanPool,
      select: { id: true, generatedAt: true },
      orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
      take,
    });
    pagesRead += 1;
    if (idRows.length === 0) break;
    const loaded = (await db.leadInventoryItem.findMany({
      where: { id: { in: idRows.map((row) => row.id) } },
      select: {
        id: true,
        generatedAt: true,
        normalizedState: true,
        originClientAccountId: true,
        metadataJson: true,
        status: true,
        commerceExcludedAt: true,
        inventoryLot: { select: { supplierAccountId: true, status: true } },
        sourceLeadEvent: {
          select: {
            id: true,
            sourceProvider: true,
            sourceCampaignId: true,
            normalizedPayloadJson: true,
            rawPayloadJson: true,
            enrichmentMetadataJson: true,
          },
        },
        leadAllocations: {
          where: { status: { in: [...OPEN_ALLOCATION_STATUSES] } },
          select: { id: true },
          take: 1,
        },
      },
    })) as ScanRow[];
    const loadedById = new Map(loaded.map((row) => [row.id, row]));

    for (const idRow of idRows) {
      const row = loadedById.get(idRow.id);
      rowsClassified += 1;
      cursor = { generatedAt: idRow.generatedAt, id: idRow.id };
      if (!row) {
        if (rowsClassified >= ceiling) break;
        continue;
      }
      const ageDays = calculateInventoryAgeDays(row.generatedAt, evaluatedAt);
      lastClassifiedAgeDays = ageDays;
      const tierKey = resolveCommerceAgeBucketKey(ageDays);
      if (
        !matchesCommerceAgeBucketFilter(tierKey, buckets.keys, ageDays) ||
        !tierKey ||
        !classifiedByTier.has(tierKey)
      ) {
        ageBucketMismatch += 1;
        if (rowsClassified >= ceiling) break;
        continue;
      }
      classifiedByTier.set(tierKey, (classifiedByTier.get(tierKey) ?? 0) + 1);

      if (
        row.commerceExcludedAt != null ||
        row.status !== "available" ||
        row.inventoryLot.status !== "active" ||
        !isCanonicalUsStateCode(row.normalizedState)
      ) {
        if (rowsClassified >= ceiling) break;
        continue;
      }
      if (row.leadAllocations.length > 0) {
        openAllocationLeak += 1;
        if (rowsClassified >= ceiling) break;
        continue;
      }
      if (
        isItemExcludedByProtectedAgents(
          { inventoryLot: row.inventoryLot, sourceLeadEvent: row.sourceLeadEvent },
          exclusions
        )
      ) {
        protectedAgent += 1;
        if (rowsClassified >= ceiling) break;
        continue;
      }

      let originClientAccountId = row.originClientAccountId?.trim() || null;
      if (!originClientAccountId) {
        unstampedClassified += 1;
        const reconciled = await reconcileMissingOrigin(row, db, originCache);
        if (reconciled.kind === "unresolved") {
          originUnresolved += 1;
          bump(unresolvedReasons, reconciled.reason);
          if (rowsClassified >= ceiling) break;
          continue;
        }
        reconciledFromSourceFunnel += 1;
        originClientAccountId = reconciled.originClientAccountId;
        if (isOriginClientBuyerIneligible(originClientAccountId, buyer.clientAccountId)) {
          originClientReconciled += 1;
          if (rowsClassified >= ceiling) break;
          continue;
        }
      } else if (isOriginClientBuyerIneligible(originClientAccountId, buyer.clientAccountId)) {
        if (rowsClassified >= ceiling) break;
        continue;
      }

      const fingerprints = buildIdentityFingerprints(row.sourceLeadEvent.normalizedPayloadJson);
      if (!fingerprints.phoneFingerprint && !fingerprints.emailFingerprint) {
        invalidIdentity += 1;
        if (rowsClassified >= ceiling) break;
        continue;
      }
      const buyerReady = evaluatePplBuyerReadyEligibility(
        row.sourceLeadEvent.normalizedPayloadJson,
        {
          rawPayloadJson: row.sourceLeadEvent.rawPayloadJson,
          metadataJson: row.metadataJson,
          enrichmentMetadataJson: row.sourceLeadEvent.enrichmentMetadataJson,
          evaluatedAt,
          nicheKey,
        }
      );
      if (!buyerReady.ok) {
        notBuyerReady += 1;
        for (const reason of buyerReady.reasons) {
          buyerReadyRejections[reason] += 1;
        }
        if (rowsClassified >= ceiling) break;
        continue;
      }
      if (buyerReady.reviewFlags.length > 0) nameReviewFlagged += 1;

      const phoneLookups = fingerprints.phoneFingerprintLookups;
      if (
        anyPhoneFingerprintHit(phoneLookups, seenPhones) ||
        (fingerprints.emailFingerprint != null && seenEmails.has(fingerprints.emailFingerprint))
      ) {
        sameBuyerPriorDelivery += 1;
        if (rowsClassified >= ceiling) break;
        continue;
      }
      if (
        anyPhoneFingerprintHit(phoneLookups, batchPhones) ||
        (fingerprints.emailFingerprint != null && batchEmails.has(fingerprints.emailFingerprint))
      ) {
        currentBatchDuplicate += 1;
        if (rowsClassified >= ceiling) break;
        continue;
      }
      for (const fingerprint of phoneLookups) batchPhones.add(fingerprint);
      if (fingerprints.emailFingerprint) batchEmails.add(fingerprints.emailFingerprint);
      eligibleByTier.set(tierKey, (eligibleByTier.get(tierKey) ?? 0) + 1);
      if (rowsClassified >= ceiling) break;
    }

    if (input.afterClassificationPage) {
      await input.afterClassificationPage({ pagesRead, rowsClassified });
    }
    if (idRows.length < take) break;
  }

  const queryComplete = rowsClassified === selectableRowsExact;
  const nodeSemantics = scanSemantics(queryComplete);
  const ageTiers: BuyerAvailabilityTierCount[] = COMMERCE_AGE_BUCKETS.filter((bucket) =>
    tierKeys.includes(bucket.key)
  ).map((bucket) => {
    const countSemantics = resolveAvailabilityTierSemantics({
      queryComplete,
      minDaysInclusive: bucket.minDaysInclusive,
      maxDaysExclusive: bucket.maxDaysExclusive,
      lastClassifiedAgeDays,
    });
    const eligibleCount = eligibleByTier.get(bucket.key) ?? 0;
    return {
      commerceAgeBucketKey: bucket.key,
      minDaysInclusive: bucket.minDaysInclusive,
      maxDaysExclusive: bucket.maxDaysExclusive,
      eligible: countSemantics === "not_reached" ? null : eligibleCount,
      classified: classifiedByTier.get(bucket.key) ?? 0,
      countSemantics,
    };
  });
  const eligibleTotal = ageTiers.reduce((sum, tier) => sum + (tier.eligible ?? 0), 0);
  const eligibleCountSemantics: "exact" | "lower_bound" = ageTiers.every(
    (tier) => tier.countSemantics === "exact"
  )
    ? "exact"
    : "lower_bound";
  const rowsUnclassified = queryComplete
    ? 0
    : Math.max(0, selectableRowsExact - rowsClassified);
  const unresolvedTotal = originUnresolved + unstampedNotReconcilable;
  const notReached = ageTiers
    .filter((tier) => tier.countSemantics === "not_reached")
    .map((tier) => tier.commerceAgeBucketKey);

  let summary: string;
  if (queryComplete && eligibleCountSemantics === "exact") {
    summary =
      eligibleTotal === 0
        ? "No definitively buyer-eligible leads. Unresolved origin is excluded and is not treated as independently sourced."
        : `Exact buyer-eligible count is ${eligibleTotal}.`;
  } else {
    summary = `Buyer-eligible count ${eligibleTotal} is a lower bound from ${rowsClassified} classified rows, not a catalog total. ${rowsUnclassified} selectable rows were not classified.${
      notReached.length > 0 ? ` Tiers not reached: ${notReached.join(", ")}.` : ""
    } The ${PPL_SELECTION_MAX_SCANNED_ROWS.toLocaleString("en-US")}-row selection cap is not this total.`;
  }
  if (openAllocationLeak > 0) {
    summary += ` ${openAllocationLeak} rows with an open allocation were excluded during classification.`;
  }

  const scanNode = nodeSemantics;
  return {
    ok: true,
    policyVersion: BUYER_INVENTORY_AVAILABILITY_POLICY,
    readOnly: true,
    effects: {
      orderCreated: false,
      reservationCreated: false,
      deliveryRecorded: false,
      csvGenerated: false,
      sourceDataMutated: false,
    },
    evaluatedAt: evaluatedAt.toISOString(),
    snapshot: {
      isolation: "repeatable_read",
      consistent: true,
      readOnly: true,
      scope: "transaction_start",
    },
    buyer: {
      clientAccountId: buyer.clientAccountId,
      clientDisplayName: buyer.clientDisplayName,
    },
    nicheKey,
    states: states.states,
    requestedCommerceAgeBucketKeys: buckets.keys.length > 0 ? buckets.keys : tierKeys,
    allAgedTiers: buckets.keys.length === 0,
    queryCompleteness: queryComplete ? "complete" : "incomplete",
    eligibleCountSemantics,
    eligibleTotal,
    ageTiers,
    structuralCohort: {
      countSemantics: "exact",
      rows: cohortRows,
      availableActiveLot,
      reserved,
      committed,
      commerceExcluded,
      openAllocationOnAvailable,
      stampedSameOrigin,
      stampedOtherOrigin,
      unstampedSelectable,
      unstampedNotReconcilable,
    },
    exclusionReasons: {
      originClientStamped: counted(stampedSameOrigin, "exact"),
      originClientReconciled: counted(originClientReconciled, scanNode),
      originUnresolved: counted(unresolvedTotal, queryComplete ? "exact" : "lower_bound"),
      existingAllocation: counted(openAllocationOnAvailable + openAllocationLeak, "exact"),
      reserved: counted(reserved, "exact"),
      committed: counted(committed, "exact"),
      commerceExcluded: counted(commerceExcluded, "exact"),
      protectedAgent: counted(protectedAgent, scanNode),
      notBuyerReady: counted(notBuyerReady, scanNode),
      buyerReadyRejections,
      sameBuyerPriorDelivery: counted(sameBuyerPriorDelivery, scanNode),
      currentBatchDuplicate: counted(currentBatchDuplicate, scanNode),
      invalidIdentity: counted(invalidIdentity, scanNode),
      ageBucketMismatch: counted(ageBucketMismatch, scanNode),
      nameReviewFlagged: counted(nameReviewFlagged, scanNode),
    },
    provenance: {
      stampedConfirmed: stampedSameOrigin + stampedOtherOrigin,
      reconciledFromSourceFunnel,
      unresolvedOrigin: unresolvedTotal,
      unresolvedReasons: {
        ...unresolvedReasons,
        ...(unstampedNotReconcilable > 0
          ? { provider_not_reconcilable: unstampedNotReconcilable }
          : {}),
      },
      unstampedNotClassified: queryComplete
        ? 0
        : Math.max(0, unstampedSelectable - unstampedNotReconcilable - unstampedClassified),
      coverageNote:
        "Confirmed stamps and reconciled confirmed source funnels are ownership evidence. A missing origin is unresolved and is not counted as buyer-eligible.",
    },
    scan: {
      rowsClassified,
      pagesRead,
      selectableRowsExact,
      rowsUnclassified,
      classificationCeiling: ceiling,
      ceilingHit: !queryComplete && rowsClassified >= ceiling,
      selectionScanCeiling: PPL_SELECTION_MAX_SCANNED_ROWS,
      usesSelectionRowCap: false,
    },
    summary,
  };
}
