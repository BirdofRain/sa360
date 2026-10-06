/**
 * Bounded historical consumer-age maintenance for life-insurance inventory.
 *
 * Three operations, all scoped to the canonical life-insurance commerce niches:
 *   1. `previewConsumerAgeInventory`  — read-only. Writes nothing, ever.
 *   2. `commitConsumerAgeBackfill`    — promotes recovered ages onto the
 *      canonical normalized destination when that destination is blank.
 *   3. `commitConsumerAgeOverMaximumClassification` — marks UNALLOCATED
 *      inventory above the maximum sellable age as commercially dead.
 *
 * Both commit paths require an explicit confirmation phrase and a verified
 * database host, are capped by `limit`, and are idempotent: a second run over
 * the same scope finds nothing left to do.
 *
 * Deliberately never done here: creating inventory, touching identity,
 * `generatedAt`, lead commerce age, allocation ownership, or any allocation at
 * all. Missing-age inventory is reported as recoverable and is never
 * commerce-excluded — incomplete enrichment is not a permanent defect.
 *
 * Reports are aggregate-only. No names, phones, emails, or payloads leave this
 * module; inventory ids appear only in commit outcomes so an operator can audit
 * exactly which rows were written.
 */

import type { LeadInventoryItemStatus, Prisma, PrismaClient } from "@prisma/client";
import { commerceNicheMatchKeys, CANONICAL_COMMERCE_NICHE_KEYS } from "@sa360/shared";

import { prisma as defaultPrisma } from "../../lib/db.js";
import { assertExpectedDbHost } from "../aged-inventory-bulk/aged-inventory-bulk-db-guard.js";
import { backfillStoredConsumerAges } from "../aged-inventory-import/aged-inventory-import-consumer-age.js";
import {
  CONSUMER_AGE_DEAD_BLOCKED_STATUSES,
  classifyConsumerAgeOverMaximumBatch,
  type ConsumerAgeDeadClassificationSkipReason,
} from "./consumer-age-dead-classification.js";
import {
  CONSUMER_AGE_OVER_MAXIMUM_CATEGORY,
  CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON,
  CONSUMER_AGE_POLICY_VERSION,
  CONSUMER_AGE_REQUIRED_CATEGORY,
  MAX_SELLABLE_CONSUMER_AGE,
  readNormalizedConsumerAgeCell,
  readNormalizedDateOfBirthCell,
  resolveConsumerAgeForFulfillment,
  type ConsumerAgeResolutionSource,
  type ConsumerAgeResolutionStatus,
  type ResolvedConsumerAge,
} from "./consumer-age-policy.js";

export { CONSUMER_AGE_DEAD_BLOCKED_STATUSES };
export type { ConsumerAgeDeadClassificationSkipReason };

export const CONSUMER_AGE_INVENTORY_REPORT_SCHEMA = "consumer_age_inventory_report_v1" as const;

export const CONSUMER_AGE_MAINTENANCE_PAGE_SIZE = 400;
export const CONSUMER_AGE_MAINTENANCE_MAX_SCAN_ROWS = 50_000;

/** Statuses that still represent live, recoverable, unsold inventory. */
export const CONSUMER_AGE_MAINTENANCE_DEFAULT_STATUSES = [
  "available",
  "pending_review",
] as const satisfies readonly LeadInventoryItemStatus[];

export const CONSUMER_AGE_BACKFILL_CONFIRMATION =
  "BACKFILL HISTORICAL CONSUMER AGE" as const;

export const CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION =
  "CLASSIFY CONSUMER AGE OVER 86 AS DEAD" as const;

/**
 * Deterministic resume point for the `(generatedAt, id)` keyset traversal.
 *
 * Production inventory is far larger than one invocation may scan, so the
 * 50k per-invocation ceiling stays and operators chain invocations instead:
 * feed the previous result's `nextCursor` back in as `cursor`.
 */
export type ConsumerAgeMaintenanceCursor = {
  /** ISO instant of the last row the previous invocation processed. */
  afterGeneratedAt: string;
  afterId: string;
};

/**
 * `complete` means the scope was traversed to exhaustion — there is nothing
 * left to do. `partial` means the per-invocation scan ceiling stopped the
 * traversal and `nextCursor` must be chained. Never treat a candidate count of
 * zero as completion.
 */
export type ConsumerAgeMaintenanceCoverage = "complete" | "partial";

/** Explicit operator input error. Maintenance input never fails open. */
export class ConsumerAgeMaintenanceInputError extends Error {
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string) {
    super(`${field}:${reason}`);
    this.name = "ConsumerAgeMaintenanceInputError";
    this.field = field;
    this.reason = reason;
  }
}

/**
 * Positive-integer row bound, at most `max`.
 *
 * Fails closed on anything non-numeric. A NaN row bound previously flowed
 * straight into the scan ceiling and produced a truthful-looking zero-row
 * report, which reads as "nothing to do" when nothing was actually examined.
 */
export function parseMaintenanceRowBound(
  field: string,
  raw: string | number | null | undefined,
  max: number
): number | undefined {
  if (raw == null || raw === "") return undefined;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new ConsumerAgeMaintenanceInputError(field, "expected_positive_integer");
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConsumerAgeMaintenanceInputError(field, "expected_positive_integer");
  }
  if (value > max) {
    throw new ConsumerAgeMaintenanceInputError(field, `exceeds_maximum_${max}`);
  }
  return value;
}

export function parseMaintenanceInstant(
  field: string,
  raw: Date | string | null | undefined
): Date | undefined {
  if (raw == null) return undefined;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new ConsumerAgeMaintenanceInputError(field, "expected_iso_instant");
    }
    return raw;
  }
  const text = String(raw).trim();
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new ConsumerAgeMaintenanceInputError(field, "expected_iso_instant");
  }
  return parsed;
}

export type ConsumerAgeMaintenanceScopeInput = {
  /** Defaults to every canonical life-insurance commerce niche. */
  nicheKeys?: readonly string[];
  statuses?: readonly LeadInventoryItemStatus[];
  inventoryLotId?: string | null;
  sourceLane?: string | null;
  /** Restrict to lots an operator has activated. Defaults to true. */
  activeLotOnly?: boolean;
  /** Include rows already commerce-excluded. Defaults to false. */
  includeCommerceExcluded?: boolean;
  /**
   * Restrict dead-classification candidates to rows whose age came from an
   * explicit date of birth. Only a DOB-derived age changes on its own, so the
   * recurring birthday sweep narrows its write population this way.
   */
  dateOfBirthOnly?: boolean;
  maxScanRows?: number | string;
  /** Resume point from the previous invocation's `nextCursor`. */
  cursor?: { afterGeneratedAt: Date | string; afterId: string } | null;
  /** Inclusive `generatedAt` shard bounds, for month-at-a-time processing. */
  generatedAtFrom?: Date | string | null;
  generatedAtTo?: Date | string | null;
  evaluatedAt?: Date;
};

export type ConsumerAgeMaintenanceScope = {
  nicheKeys: string[];
  nicheAliases: string[];
  statuses: LeadInventoryItemStatus[];
  inventoryLotId: string | null;
  sourceLane: string | null;
  activeLotOnly: boolean;
  includeCommerceExcluded: boolean;
  dateOfBirthOnly: boolean;
  maxScanRows: number;
  cursor: ConsumerAgeMaintenanceCursor | null;
  generatedAtFrom: string | null;
  generatedAtTo: string | null;
};

/** Per-dimension aggregate counts. Dimension keys are never consumer data. */
export type ConsumerAgeBreakdownBucket = {
  key: string;
  /** Present on the inventory-lot dimension so the CLI id needs no translation. */
  inventoryLotId?: string;
  /** Operator-readable lot label, present on the inventory-lot dimension. */
  lotKey?: string;
  total: number;
  ageAlreadyNormalized: number;
  recoverable: number;
  dateOfBirthRecoverable: number;
  noAgeSource: number;
  invalidAgeSource: number;
  ageEligible: number;
  ageOverMaximum: number;
  canonicalConflicts: number;
  backfillCandidates: number;
};

export type ConsumerAgeInventoryTotals = {
  /** Rows matching the scope that were classified. */
  activeSellableInventory: number;
  /** Age already readable from the canonical normalized destination. */
  ageAlreadyNormalized: number;
  recoverableFromRawPayload: number;
  recoverableFromMetadata: number;
  recoverableFromEnrichment: number;
  /** Age resolvable only outside the canonical destination. */
  recoverableTotal: number;
  /** Rows whose resolved age came from an explicit recognized date of birth. */
  dateOfBirthRecoverable: number;
  /** No explicit age or DOB cell anywhere. Recoverable, never dead. */
  noAgeSource: number;
  /** An explicit cell exists but does not parse to a plausible age. */
  invalidAgeSource: number;
  ageEligible: number;
  ageOverMaximum: number;
  /** Canonical destination holds a different age than the resolver chose. */
  canonicalConflicts: number;
  /**
   * Rows withheld from automatic backfill because the canonical age disagrees
   * with an explicit date of birth. Repairing them would also change the
   * effective commercial age, so they need manual review.
   */
  conflictHolds: number;
  /** Rows the backfill would write (blank canonical destination only). */
  backfillCandidates: number;
  deadClassificationCandidates: number;
  /** Over-maximum rows left alone because an allocation exists. */
  deadClassificationBlockedByAllocation: number;
  /** Over-maximum rows left alone because the row is reserved/committed/fulfilled. */
  deadClassificationBlockedByStatus: number;
  /** Rows already carrying the consumer-age dead exclusion, in or out of scope. */
  alreadyClassifiedDead: number;
};

export type ConsumerAgeInventoryReport = {
  schema: typeof CONSUMER_AGE_INVENTORY_REPORT_SCHEMA;
  mode: "preview";
  evaluatedAt: string;
  policy: {
    maximumSellableAge: number;
    policyVersion: string;
    deadCategory: string;
    ageRequiredCategory: string;
    overMaximumExclusionReason: string;
    consumerAgeDerivedFromLeadGeneratedAt: false;
  };
  scope: ConsumerAgeMaintenanceScope;
  totals: ConsumerAgeInventoryTotals;
  breakdown: {
    byNiche: ConsumerAgeBreakdownBucket[];
    bySourceProvider: ConsumerAgeBreakdownBucket[];
    bySourceSystem: ConsumerAgeBreakdownBucket[];
    bySourceLane: ConsumerAgeBreakdownBucket[];
    byInventoryLot: ConsumerAgeBreakdownBucket[];
    byGeneratedMonth: ConsumerAgeBreakdownBucket[];
  };
  scan: ConsumerAgeMaintenanceScanStats;
  /** Authoritative completion signal. `partial` means more work remains. */
  coverage: ConsumerAgeMaintenanceCoverage;
  /** Non-null exactly when `coverage` is `partial`. Chain it to continue. */
  nextCursor: ConsumerAgeMaintenanceCursor | null;
  summary: string;
};

export type ConsumerAgeMaintenanceScanStats = {
  /** Rows matching the scope and shard that remained ahead of `scope.cursor`. */
  matchingRows: number;
  /** Rows classified by this invocation. */
  rowsScanned: number;
  pagesRead: number;
  /** The per-invocation ceiling stopped the traversal before exhaustion. */
  scanCeilingHit: boolean;
};

type MaintenanceScanRow = {
  id: string;
  generatedAt: Date;
  status: LeadInventoryItemStatus;
  nicheKey: string;
  sourceProvider: string;
  sourceLane: string;
  commerceExcludedAt: Date | null;
  metadataJson: Prisma.JsonValue;
  inventoryLotId: string;
  inventoryLot: { lotKey: string };
  sourceLeadEvent: {
    id: string;
    sourceSystem: string;
    normalizedPayloadJson: Prisma.JsonValue;
    rawPayloadJson: Prisma.JsonValue;
    enrichmentMetadataJson: Prisma.JsonValue;
  };
  _count: { leadAllocations: number };
};

/** One row's consumer-age classification, derived only from explicit cells. */
type RowClassification = {
  resolved: ResolvedConsumerAge;
  canonicalAge: string;
  resolvedAgeText: string;
  alreadyNormalized: boolean;
  recoverable: boolean;
  conflict: boolean;
  /** Canonical age disagrees with an explicit DOB — never auto-repaired. */
  conflictHold: boolean;
  backfillCandidate: boolean;
  deadCandidate: boolean;
  deadBlockedByAllocation: boolean;
  deadBlockedByStatus: boolean;
};

/**
 * A row the backfill refuses to touch because repairing it would also change
 * the row's effective commercial age (for example canonical 55 against a date
 * of birth that resolves to 87). Ages and a source category only — no PII.
 */
export type ConsumerAgeBackfillConflictHold = {
  id: string;
  existingCanonicalAge: string;
  resolvedDobAge: string;
  resolvedSource: ConsumerAgeResolutionSource | null;
  resolvedStatus: ConsumerAgeResolutionStatus;
};

function emptyBucket(key: string): ConsumerAgeBreakdownBucket {
  return {
    key,
    total: 0,
    ageAlreadyNormalized: 0,
    recoverable: 0,
    dateOfBirthRecoverable: 0,
    noAgeSource: 0,
    invalidAgeSource: 0,
    ageEligible: 0,
    ageOverMaximum: 0,
    canonicalConflicts: 0,
    backfillCandidates: 0,
  };
}

function addToBucket(
  buckets: Map<string, ConsumerAgeBreakdownBucket>,
  key: string,
  classification: RowClassification,
  labels?: Pick<ConsumerAgeBreakdownBucket, "inventoryLotId" | "lotKey">
) {
  const bucket = buckets.get(key) ?? { ...emptyBucket(key), ...labels };
  bucket.total += 1;
  if (classification.alreadyNormalized) bucket.ageAlreadyNormalized += 1;
  if (classification.recoverable) bucket.recoverable += 1;
  if (classification.resolved.dateOfBirth) bucket.dateOfBirthRecoverable += 1;
  if (classification.resolved.status === "missing") bucket.noAgeSource += 1;
  if (classification.resolved.status === "invalid") bucket.invalidAgeSource += 1;
  if (classification.resolved.status === "eligible") bucket.ageEligible += 1;
  if (classification.resolved.status === "over_maximum_age") bucket.ageOverMaximum += 1;
  if (classification.conflict) bucket.canonicalConflicts += 1;
  if (classification.backfillCandidate) bucket.backfillCandidates += 1;
  buckets.set(key, bucket);
}

function sortedBuckets(
  buckets: Map<string, ConsumerAgeBreakdownBucket>
): ConsumerAgeBreakdownBucket[] {
  return [...buckets.values()].sort(
    (a, b) => b.total - a.total || a.key.localeCompare(b.key)
  );
}

function generatedMonthKey(generatedAt: Date): string {
  const year = generatedAt.getUTCFullYear();
  const month = String(generatedAt.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function resolveCursorInput(
  input: ConsumerAgeMaintenanceScopeInput["cursor"]
): ConsumerAgeMaintenanceCursor | null {
  if (input == null) return null;
  const afterId = String(input.afterId ?? "").trim();
  const afterGeneratedAt = parseMaintenanceInstant(
    "cursor.afterGeneratedAt",
    input.afterGeneratedAt
  );
  if (!afterGeneratedAt || !afterId) {
    throw new ConsumerAgeMaintenanceInputError(
      "cursor",
      "requires_after_generated_at_and_after_id"
    );
  }
  return { afterGeneratedAt: afterGeneratedAt.toISOString(), afterId };
}

export function resolveConsumerAgeMaintenanceScope(
  input: ConsumerAgeMaintenanceScopeInput = {}
): ConsumerAgeMaintenanceScope {
  const requested = (input.nicheKeys ?? CANONICAL_COMMERCE_NICHE_KEYS)
    .map((key) => key.trim())
    .filter(Boolean);
  const nicheKeys = [...new Set(requested)];
  const aliases = new Set<string>();
  for (const key of nicheKeys) {
    for (const alias of commerceNicheMatchKeys(key)) aliases.add(alias);
  }
  const statuses = [
    ...new Set(input.statuses ?? CONSUMER_AGE_MAINTENANCE_DEFAULT_STATUSES),
  ];
  const maxScanRows =
    parseMaintenanceRowBound(
      "maxScanRows",
      input.maxScanRows,
      CONSUMER_AGE_MAINTENANCE_MAX_SCAN_ROWS
    ) ?? CONSUMER_AGE_MAINTENANCE_MAX_SCAN_ROWS;
  const generatedAtFrom = parseMaintenanceInstant("generatedAtFrom", input.generatedAtFrom);
  const generatedAtTo = parseMaintenanceInstant("generatedAtTo", input.generatedAtTo);
  if (generatedAtFrom && generatedAtTo && generatedAtFrom.getTime() > generatedAtTo.getTime()) {
    throw new ConsumerAgeMaintenanceInputError("generatedAtFrom", "after_generated_at_to");
  }
  return {
    nicheKeys,
    nicheAliases: [...aliases],
    statuses,
    inventoryLotId: input.inventoryLotId?.trim() || null,
    sourceLane: input.sourceLane?.trim() || null,
    activeLotOnly: input.activeLotOnly ?? true,
    includeCommerceExcluded: input.includeCommerceExcluded ?? false,
    dateOfBirthOnly: input.dateOfBirthOnly ?? false,
    maxScanRows,
    cursor: resolveCursorInput(input.cursor),
    generatedAtFrom: generatedAtFrom?.toISOString() ?? null,
    generatedAtTo: generatedAtTo?.toISOString() ?? null,
  };
}

function cursorWhere(cursor: {
  generatedAt: Date;
  id: string;
}): Prisma.LeadInventoryItemWhereInput {
  return {
    OR: [
      { generatedAt: { gt: cursor.generatedAt } },
      { generatedAt: cursor.generatedAt, id: { gt: cursor.id } },
    ],
  };
}

/**
 * Scope predicate including the shard bounds and the seed cursor, so the
 * matching-row count reflects what is still ahead of this invocation.
 */
function scopeWhere(scope: ConsumerAgeMaintenanceScope): Prisma.LeadInventoryItemWhereInput {
  const clauses: Prisma.LeadInventoryItemWhereInput[] = [
    { status: { in: scope.statuses } },
  ];
  if (scope.nicheAliases.length > 0) {
    clauses.push({
      OR: scope.nicheAliases.map((alias) => ({
        nicheKey: { equals: alias, mode: "insensitive" as const },
      })),
    });
  }
  if (scope.activeLotOnly) clauses.push({ inventoryLot: { status: "active" } });
  if (!scope.includeCommerceExcluded) clauses.push({ commerceExcludedAt: null });
  if (scope.inventoryLotId) clauses.push({ inventoryLotId: scope.inventoryLotId });
  if (scope.sourceLane) clauses.push({ sourceLane: scope.sourceLane });
  if (scope.generatedAtFrom) {
    clauses.push({ generatedAt: { gte: new Date(scope.generatedAtFrom) } });
  }
  if (scope.generatedAtTo) {
    clauses.push({ generatedAt: { lte: new Date(scope.generatedAtTo) } });
  }
  if (scope.cursor) {
    clauses.push(
      cursorWhere({
        generatedAt: new Date(scope.cursor.afterGeneratedAt),
        id: scope.cursor.afterId,
      })
    );
  }
  return { AND: clauses };
}

function classifyRow(
  row: MaintenanceScanRow,
  evaluatedAt: Date,
  scope: ConsumerAgeMaintenanceScope
): RowClassification {
  const resolved = resolveConsumerAgeForFulfillment({
    normalizedPayloadJson: row.sourceLeadEvent.normalizedPayloadJson,
    rawPayloadJson: row.sourceLeadEvent.rawPayloadJson,
    metadataJson: row.metadataJson,
    enrichmentMetadataJson: row.sourceLeadEvent.enrichmentMetadataJson,
    evaluatedAt,
  });

  const canonicalAge = readNormalizedConsumerAgeCell(row.sourceLeadEvent.normalizedPayloadJson);
  const canonicalDob = readNormalizedDateOfBirthCell(row.sourceLeadEvent.normalizedPayloadJson);
  const alreadyNormalized = canonicalAge !== "";
  const resolvedAgeText = resolved.age == null ? "" : String(resolved.age);
  const recoverable =
    resolved.age != null &&
    resolved.source !== "normalized_consumer_age" &&
    resolved.source !== "normalized_dob";
  const conflict = alreadyNormalized && resolvedAgeText !== "" && canonicalAge !== resolvedAgeText;
  const needsAge = resolved.age != null && !alreadyNormalized;
  const needsDob = Boolean(resolved.dateOfBirth) && canonicalDob === "";
  // Writing the date of birth onto a row whose canonical age disagrees with it
  // would silently change the row's effective commercial age — canonical 55
  // against a DOB that resolves to 87 would flip it from sellable to dead in
  // the same breath as calling it a conflict. Hold it for manual review.
  const conflictHold = conflict && resolved.dateOfBirth != null;

  const overMaximum = resolved.status === "over_maximum_age";
  const blockedByStatus = (CONSUMER_AGE_DEAD_BLOCKED_STATUSES as readonly string[]).includes(
    row.status
  );
  const blockedByAllocation = row._count.leadAllocations > 0;
  const deadEligible =
    overMaximum && !blockedByAllocation && !blockedByStatus && row.commerceExcludedAt == null;

  return {
    resolved,
    canonicalAge,
    resolvedAgeText,
    alreadyNormalized,
    recoverable,
    conflict,
    conflictHold,
    backfillCandidate: !conflictHold && (needsAge || needsDob),
    // A held conflict is not classified dead either: stamping it permanently
    // dead is just as automatic a mutation as writing the date of birth, and
    // the disagreement might be the date of birth that is wrong. Reservation
    // still refuses the row, so leaving it unstamped costs nothing.
    deadCandidate:
      deadEligible &&
      !conflictHold &&
      (!scope.dateOfBirthOnly || resolved.dateOfBirth != null),
    deadBlockedByAllocation: overMaximum && blockedByAllocation,
    deadBlockedByStatus: overMaximum && !blockedByAllocation && blockedByStatus,
  };
}

type ScanOutcome = {
  totals: ConsumerAgeInventoryTotals;
  breakdown: ConsumerAgeInventoryReport["breakdown"];
  scan: ConsumerAgeMaintenanceScanStats;
  coverage: ConsumerAgeMaintenanceCoverage;
  nextCursor: ConsumerAgeMaintenanceCursor | null;
  backfillCandidateIds: string[];
  deadCandidateIds: string[];
  conflictHolds: ConsumerAgeBackfillConflictHold[];
};

/**
 * Bounded, resumable keyset scan over the scope.
 *
 * The traversal starts after `scope.cursor` and orders deterministically by
 * `(generatedAt, id)`, so chained invocations neither skip nor re-process a
 * row. `collectLimit` caps how many candidate ids are retained for a later
 * commit; classification counting continues past it so the window report stays
 * complete.
 *
 * Coverage is decided structurally, not by comparing counts: the scope is
 * `complete` only when a page came back short or empty before the ceiling was
 * reached. A racing insert therefore cannot make a partial scan look finished.
 */
async function scanConsumerAgeInventory(
  scope: ConsumerAgeMaintenanceScope,
  evaluatedAt: Date,
  db: PrismaClient,
  collectLimit: number
): Promise<ScanOutcome> {
  const where = scopeWhere(scope);

  const [matchingRows, alreadyClassifiedDead] = await Promise.all([
    db.leadInventoryItem.count({ where }),
    db.leadInventoryItem.count({
      where: { commerceExcludedReason: CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON },
    }),
  ]);

  const totals: ConsumerAgeInventoryTotals = {
    activeSellableInventory: 0,
    ageAlreadyNormalized: 0,
    recoverableFromRawPayload: 0,
    recoverableFromMetadata: 0,
    recoverableFromEnrichment: 0,
    recoverableTotal: 0,
    dateOfBirthRecoverable: 0,
    noAgeSource: 0,
    invalidAgeSource: 0,
    ageEligible: 0,
    ageOverMaximum: 0,
    canonicalConflicts: 0,
    conflictHolds: 0,
    backfillCandidates: 0,
    deadClassificationCandidates: 0,
    deadClassificationBlockedByAllocation: 0,
    deadClassificationBlockedByStatus: 0,
    alreadyClassifiedDead,
  };

  const byNiche = new Map<string, ConsumerAgeBreakdownBucket>();
  const bySourceProvider = new Map<string, ConsumerAgeBreakdownBucket>();
  const bySourceSystem = new Map<string, ConsumerAgeBreakdownBucket>();
  const bySourceLane = new Map<string, ConsumerAgeBreakdownBucket>();
  const byInventoryLot = new Map<string, ConsumerAgeBreakdownBucket>();
  const byGeneratedMonth = new Map<string, ConsumerAgeBreakdownBucket>();

  const backfillCandidateIds: string[] = [];
  const deadCandidateIds: string[] = [];
  const conflictHolds: ConsumerAgeBackfillConflictHold[] = [];

  let cursor: { generatedAt: Date; id: string } | null = null;
  let rowsScanned = 0;
  let pagesRead = 0;
  let exhausted = false;

  while (rowsScanned < scope.maxScanRows) {
    const take = Math.min(CONSUMER_AGE_MAINTENANCE_PAGE_SIZE, scope.maxScanRows - rowsScanned);
    const cursorClause = cursor ? cursorWhere(cursor) : null;
    const rows = (await db.leadInventoryItem.findMany({
      where: cursorClause ? { AND: [where, cursorClause] } : where,
      select: {
        id: true,
        generatedAt: true,
        status: true,
        nicheKey: true,
        sourceProvider: true,
        sourceLane: true,
        commerceExcludedAt: true,
        metadataJson: true,
        inventoryLotId: true,
        inventoryLot: { select: { lotKey: true } },
        sourceLeadEvent: {
          select: {
            id: true,
            sourceSystem: true,
            normalizedPayloadJson: true,
            rawPayloadJson: true,
            enrichmentMetadataJson: true,
          },
        },
        _count: { select: { leadAllocations: true } },
      },
      orderBy: [{ generatedAt: "asc" }, { id: "asc" }],
      take,
    })) as unknown as MaintenanceScanRow[];

    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    pagesRead += 1;

    for (const row of rows) {
      rowsScanned += 1;
      cursor = { generatedAt: row.generatedAt, id: row.id };
      const classification = classifyRow(row, evaluatedAt, scope);

      totals.activeSellableInventory += 1;
      if (classification.alreadyNormalized) totals.ageAlreadyNormalized += 1;
      if (classification.recoverable) {
        totals.recoverableTotal += 1;
        if (classification.resolved.source === "raw_consumer_age" || classification.resolved.source === "raw_dob") {
          totals.recoverableFromRawPayload += 1;
        } else if (classification.resolved.source === "metadata") {
          totals.recoverableFromMetadata += 1;
        } else if (classification.resolved.source === "enrichment") {
          totals.recoverableFromEnrichment += 1;
        }
      }
      if (classification.resolved.dateOfBirth) totals.dateOfBirthRecoverable += 1;
      if (classification.resolved.status === "missing") totals.noAgeSource += 1;
      if (classification.resolved.status === "invalid") totals.invalidAgeSource += 1;
      if (classification.resolved.status === "eligible") totals.ageEligible += 1;
      if (classification.resolved.status === "over_maximum_age") totals.ageOverMaximum += 1;
      if (classification.conflict) totals.canonicalConflicts += 1;
      if (classification.conflictHold) {
        totals.conflictHolds += 1;
        if (conflictHolds.length < collectLimit) {
          conflictHolds.push({
            id: row.id,
            existingCanonicalAge: classification.canonicalAge,
            resolvedDobAge: classification.resolvedAgeText,
            resolvedSource: classification.resolved.source,
            resolvedStatus: classification.resolved.status,
          });
        }
      }
      if (classification.backfillCandidate) {
        totals.backfillCandidates += 1;
        if (backfillCandidateIds.length < collectLimit) backfillCandidateIds.push(row.id);
      }
      if (classification.deadCandidate) {
        totals.deadClassificationCandidates += 1;
        if (deadCandidateIds.length < collectLimit) deadCandidateIds.push(row.id);
      }
      if (classification.deadBlockedByAllocation) {
        totals.deadClassificationBlockedByAllocation += 1;
      }
      if (classification.deadBlockedByStatus) totals.deadClassificationBlockedByStatus += 1;

      addToBucket(byNiche, row.nicheKey.toLowerCase(), classification);
      addToBucket(bySourceProvider, row.sourceProvider, classification);
      addToBucket(bySourceSystem, row.sourceLeadEvent.sourceSystem, classification);
      addToBucket(bySourceLane, row.sourceLane, classification);
      addToBucket(byInventoryLot, row.inventoryLotId, classification, {
        inventoryLotId: row.inventoryLotId,
        lotKey: row.inventoryLot.lotKey,
      });
      addToBucket(byGeneratedMonth, generatedMonthKey(row.generatedAt), classification);

      if (rowsScanned >= scope.maxScanRows) break;
    }

    // A short page means the scope ran out, which is the only safe proof of
    // exhaustion. Falling out of the while loop on the ceiling is not.
    if (rows.length < take) {
      exhausted = true;
      break;
    }
  }

  const coverage: ConsumerAgeMaintenanceCoverage = exhausted ? "complete" : "partial";
  const nextCursor =
    coverage === "partial" && cursor
      ? { afterGeneratedAt: cursor.generatedAt.toISOString(), afterId: cursor.id }
      : null;

  return {
    totals,
    breakdown: {
      byNiche: sortedBuckets(byNiche),
      bySourceProvider: sortedBuckets(bySourceProvider),
      bySourceSystem: sortedBuckets(bySourceSystem),
      bySourceLane: sortedBuckets(bySourceLane),
      byInventoryLot: sortedBuckets(byInventoryLot),
      byGeneratedMonth: sortedBuckets(byGeneratedMonth).sort((a, b) =>
        a.key.localeCompare(b.key)
      ),
    },
    scan: {
      matchingRows,
      rowsScanned,
      pagesRead,
      scanCeilingHit: coverage === "partial",
    },
    coverage,
    nextCursor,
    backfillCandidateIds,
    deadCandidateIds,
    conflictHolds,
  };
}

function buildSummary(
  totals: ConsumerAgeInventoryTotals,
  coverage: ConsumerAgeMaintenanceCoverage
): string {
  const prefix =
    coverage === "complete"
      ? ""
      : "Scan safety cap reached — this window is partial; chain nextCursor to continue. ";
  return (
    `${prefix}${totals.activeSellableInventory} scoped inventory rows in this window: ` +
    `${totals.ageAlreadyNormalized} already carry a canonical consumer age, ` +
    `${totals.recoverableTotal} are recoverable from a retained source cell, ` +
    `${totals.noAgeSource} have no age source at all, ` +
    `${totals.invalidAgeSource} hold an unusable age cell, and ` +
    `${totals.ageOverMaximum} resolve above age ${MAX_SELLABLE_CONSUMER_AGE}. ` +
    `Backfill would write ${totals.backfillCandidates} rows; ${totals.conflictHolds} are held ` +
    `for manual conflict review; dead classification would mark ` +
    `${totals.deadClassificationCandidates} unallocated rows.`
  );
}

/**
 * Read-only consumer-age and enrichment integrity report. Safe to run against
 * any database, including production: it issues only SELECT/COUNT queries.
 */
export async function previewConsumerAgeInventory(
  input: ConsumerAgeMaintenanceScopeInput = {},
  db: PrismaClient = defaultPrisma
): Promise<ConsumerAgeInventoryReport> {
  const scope = resolveConsumerAgeMaintenanceScope(input);
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const outcome = await scanConsumerAgeInventory(scope, evaluatedAt, db, 0);

  return {
    schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
    mode: "preview",
    evaluatedAt: evaluatedAt.toISOString(),
    policy: {
      maximumSellableAge: MAX_SELLABLE_CONSUMER_AGE,
      policyVersion: CONSUMER_AGE_POLICY_VERSION,
      deadCategory: CONSUMER_AGE_OVER_MAXIMUM_CATEGORY,
      ageRequiredCategory: CONSUMER_AGE_REQUIRED_CATEGORY,
      overMaximumExclusionReason: CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON,
      consumerAgeDerivedFromLeadGeneratedAt: false,
    },
    scope,
    totals: outcome.totals,
    breakdown: outcome.breakdown,
    scan: outcome.scan,
    coverage: outcome.coverage,
    nextCursor: outcome.nextCursor,
    summary: buildSummary(outcome.totals, outcome.coverage),
  };
}

export type ConsumerAgeCommitGuardArgs = {
  expectedDbHost: string;
  databaseUrl: string;
  operator: string;
  confirm: string;
  /** Maximum rows this invocation may write. */
  limit: number;
};

export type ConsumerAgeCommitRefusalCode =
  | "confirmation_mismatch"
  | "operator_required"
  | "database_url_required"
  | "db_host_mismatch"
  | "limit_required"
  | "scope_invalid";

type GuardResult =
  | { ok: true; dbHostVerified: string; operator: string; limit: number }
  | { ok: false; reasonCode: ConsumerAgeCommitRefusalCode; reason: string };

function guardCommit(args: ConsumerAgeCommitGuardArgs, confirmation: string): GuardResult {
  const databaseUrl = args.databaseUrl.trim();
  if (!databaseUrl) {
    return { ok: false, reasonCode: "database_url_required", reason: "DATABASE_URL_required" };
  }
  if (args.confirm.trim() !== confirmation) {
    return { ok: false, reasonCode: "confirmation_mismatch", reason: "confirmation_phrase_mismatch" };
  }
  const operator = args.operator.trim();
  if (!operator) {
    return { ok: false, reasonCode: "operator_required", reason: "operator_required" };
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) {
    return { ok: false, reasonCode: "limit_required", reason: "positive_integer_limit_required" };
  }
  try {
    const identity = assertExpectedDbHost({
      databaseUrl,
      expectedDbHost: args.expectedDbHost,
    });
    const dbHostVerified = identity.port ? `${identity.host}:${identity.port}` : identity.host;
    return { ok: true, dbHostVerified, operator, limit: args.limit };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "db_host_mismatch";
    return { ok: false, reasonCode: "db_host_mismatch", reason };
  }
}

/**
 * Resolve the scope without throwing, so a malformed cursor, shard bound, or
 * row bound refuses the commit explicitly instead of silently scanning an
 * unintended window.
 */
function resolveScopeOrRefuse(
  input: ConsumerAgeMaintenanceScopeInput | undefined
):
  | { ok: true; scope: ConsumerAgeMaintenanceScope }
  | { ok: false; reasonCode: ConsumerAgeCommitRefusalCode; reason: string } {
  try {
    return { ok: true, scope: resolveConsumerAgeMaintenanceScope(input ?? {}) };
  } catch (err) {
    return {
      ok: false,
      reasonCode: "scope_invalid",
      reason: err instanceof Error ? err.message : "scope_invalid",
    };
  }
}

export type ConsumerAgeBackfillResult = {
  schema: typeof CONSUMER_AGE_INVENTORY_REPORT_SCHEMA;
  mode: "backfill";
  outcome: "BACKFILLED" | "NOOP" | "REFUSED" | "FAILED";
  ok: boolean;
  writesAttempted: boolean;
  reasonCode?: ConsumerAgeCommitRefusalCode;
  reason?: string;
  evaluatedAt?: string;
  dbHostVerified?: string;
  operator?: string;
  scope?: ConsumerAgeMaintenanceScope;
  limit?: number;
  totals?: ConsumerAgeInventoryTotals;
  scan?: ConsumerAgeMaintenanceScanStats;
  /** Authoritative completion signal for the whole workload. */
  coverage?: ConsumerAgeMaintenanceCoverage;
  /** Non-null exactly when `coverage` is `partial`. */
  nextCursor?: ConsumerAgeMaintenanceCursor | null;
  /** Backfill candidates counted in the rows this invocation actually scanned. */
  candidatesInScannedWindow?: number;
  /** Rows this invocation wrote. */
  candidatesWritten?: number;
  /** Rows whose canonical consumer age (and DOB when known) was promoted. */
  updatedIds?: string[];
  unchangedIds?: string[];
  /** Canonical value present and different — reported, never overwritten. */
  conflictIds?: string[];
  /** Rows held back from automatic repair because of a material DOB conflict. */
  conflicts?: ConsumerAgeBackfillConflictHold[];
  overMaximumAgeIds?: string[];
};

/**
 * Promote recovered consumer ages onto the canonical normalized destination.
 *
 * Blank destinations only. A canonical age that materially disagrees with an
 * explicit date of birth is reported in `conflicts` and never written, because
 * repairing it would also change the row's effective fulfillment eligibility.
 * Bounded by `limit`, resumable through `nextCursor`, and idempotent.
 */
export async function commitConsumerAgeBackfill(
  args: ConsumerAgeCommitGuardArgs & { scope?: ConsumerAgeMaintenanceScopeInput },
  db: PrismaClient = defaultPrisma
): Promise<ConsumerAgeBackfillResult> {
  const guard = guardCommit(args, CONSUMER_AGE_BACKFILL_CONFIRMATION);
  if (!guard.ok) {
    return {
      schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
      mode: "backfill",
      outcome: "REFUSED",
      ok: false,
      writesAttempted: false,
      reasonCode: guard.reasonCode,
      reason: guard.reason,
    };
  }

  const resolvedScope = resolveScopeOrRefuse(args.scope);
  if (!resolvedScope.ok) {
    return {
      schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
      mode: "backfill",
      outcome: "REFUSED",
      ok: false,
      writesAttempted: false,
      reasonCode: resolvedScope.reasonCode,
      reason: resolvedScope.reason,
    };
  }
  const scope = resolvedScope.scope;
  const evaluatedAt = args.scope?.evaluatedAt ?? new Date();

  try {
    const scanned = await scanConsumerAgeInventory(scope, evaluatedAt, db, guard.limit);
    const base = {
      schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
      mode: "backfill" as const,
      evaluatedAt: evaluatedAt.toISOString(),
      dbHostVerified: guard.dbHostVerified,
      operator: guard.operator,
      scope,
      limit: guard.limit,
      totals: scanned.totals,
      scan: scanned.scan,
      coverage: scanned.coverage,
      nextCursor: scanned.nextCursor,
      candidatesInScannedWindow: scanned.totals.backfillCandidates,
      conflicts: scanned.conflictHolds,
    };

    if (scanned.backfillCandidateIds.length === 0) {
      return {
        ...base,
        outcome: "NOOP",
        ok: true,
        writesAttempted: false,
        candidatesWritten: 0,
        updatedIds: [],
        unchangedIds: [],
        conflictIds: [],
        overMaximumAgeIds: [],
      };
    }

    const result = await backfillStoredConsumerAges(
      scanned.backfillCandidateIds,
      db,
      evaluatedAt
    );
    return {
      ...base,
      outcome: result.updatedIds.length > 0 ? "BACKFILLED" : "NOOP",
      ok: true,
      writesAttempted: true,
      candidatesWritten: result.updatedIds.length,
      updatedIds: result.updatedIds,
      unchangedIds: result.unchangedIds,
      conflictIds: result.conflictIds,
      overMaximumAgeIds: result.overMaximumAgeIds,
    };
  } catch (err) {
    return {
      schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
      mode: "backfill",
      outcome: "FAILED",
      ok: false,
      writesAttempted: true,
      reason: err instanceof Error ? err.message : "backfill_failed",
      dbHostVerified: guard.dbHostVerified,
      operator: guard.operator,
      scope,
    };
  }
}

export type ConsumerAgeDeadClassificationResult = {
  schema: typeof CONSUMER_AGE_INVENTORY_REPORT_SCHEMA;
  mode: "classify_dead";
  outcome: "CLASSIFIED" | "NOOP" | "REFUSED" | "FAILED";
  ok: boolean;
  writesAttempted: boolean;
  reasonCode?: ConsumerAgeCommitRefusalCode;
  reason?: string;
  evaluatedAt?: string;
  dbHostVerified?: string;
  operator?: string;
  scope?: ConsumerAgeMaintenanceScope;
  limit?: number;
  totals?: ConsumerAgeInventoryTotals;
  scan?: ConsumerAgeMaintenanceScanStats;
  /** Authoritative completion signal for the whole workload. */
  coverage?: ConsumerAgeMaintenanceCoverage;
  /** Non-null exactly when `coverage` is `partial`. */
  nextCursor?: ConsumerAgeMaintenanceCursor | null;
  /** Dead candidates counted in the rows this invocation actually scanned. */
  candidatesInScannedWindow?: number;
  /** Rows this invocation wrote. */
  candidatesWritten?: number;
  exclusion?: {
    status: "expired";
    commerceExcludedReason: string;
    commerceExcludedBy: string;
    displayCategory: string;
  };
  classifiedIds?: string[];
  skipped?: Array<{ id: string; reason: ConsumerAgeDeadClassificationSkipReason }>;
  /** Over-maximum rows withheld because the canonical age disagrees with the DOB. */
  conflicts?: ConsumerAgeBackfillConflictHold[];
};

/**
 * Mark UNALLOCATED inventory above the maximum sellable age as commercially
 * dead: `status = expired` plus the commerce-exclusion kill switch, stamped
 * with the policy version. Age is re-resolved under row lock, so a row whose
 * age changed between preview and commit is skipped rather than written.
 *
 * Any item with an allocation of any status — including delivered historical
 * packages — is skipped. Missing-age inventory is never touched.
 */
export async function commitConsumerAgeOverMaximumClassification(
  args: ConsumerAgeCommitGuardArgs & { scope?: ConsumerAgeMaintenanceScopeInput },
  db: PrismaClient = defaultPrisma
): Promise<ConsumerAgeDeadClassificationResult> {
  const guard = guardCommit(args, CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION);
  if (!guard.ok) {
    return {
      schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
      mode: "classify_dead",
      outcome: "REFUSED",
      ok: false,
      writesAttempted: false,
      reasonCode: guard.reasonCode,
      reason: guard.reason,
    };
  }

  const resolvedScope = resolveScopeOrRefuse(args.scope);
  if (!resolvedScope.ok) {
    return {
      schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
      mode: "classify_dead",
      outcome: "REFUSED",
      ok: false,
      writesAttempted: false,
      reasonCode: resolvedScope.reasonCode,
      reason: resolvedScope.reason,
    };
  }
  const scope = resolvedScope.scope;
  const evaluatedAt = args.scope?.evaluatedAt ?? new Date();

  try {
    const scanned = await scanConsumerAgeInventory(scope, evaluatedAt, db, guard.limit);
    const base = {
      schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
      mode: "classify_dead" as const,
      evaluatedAt: evaluatedAt.toISOString(),
      dbHostVerified: guard.dbHostVerified,
      operator: guard.operator,
      scope,
      limit: guard.limit,
      totals: scanned.totals,
      scan: scanned.scan,
      coverage: scanned.coverage,
      nextCursor: scanned.nextCursor,
      candidatesInScannedWindow: scanned.totals.deadClassificationCandidates,
      conflicts: scanned.conflictHolds,
      exclusion: {
        status: "expired" as const,
        commerceExcludedReason: CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON,
        commerceExcludedBy: CONSUMER_AGE_POLICY_VERSION,
        displayCategory: CONSUMER_AGE_OVER_MAXIMUM_CATEGORY,
      },
    };

    if (scanned.deadCandidateIds.length === 0) {
      return {
        ...base,
        outcome: "NOOP",
        ok: true,
        writesAttempted: false,
        candidatesWritten: 0,
        classifiedIds: [],
        skipped: [],
      };
    }

    const batch = await classifyConsumerAgeOverMaximumBatch(
      db,
      scanned.deadCandidateIds,
      evaluatedAt
    );

    return {
      ...base,
      outcome: batch.classifiedIds.length > 0 ? "CLASSIFIED" : "NOOP",
      ok: true,
      writesAttempted: true,
      candidatesWritten: batch.classifiedIds.length,
      classifiedIds: batch.classifiedIds,
      skipped: batch.skipped,
    };
  } catch (err) {
    return {
      schema: CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
      mode: "classify_dead",
      outcome: "FAILED",
      ok: false,
      writesAttempted: true,
      reason: err instanceof Error ? err.message : "classification_failed",
      dbHostVerified: guard.dbHostVerified,
      operator: guard.operator,
      scope,
    };
  }
}

