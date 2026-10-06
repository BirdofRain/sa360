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
  CONSUMER_AGE_OVER_MAXIMUM_CATEGORY,
  CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON,
  CONSUMER_AGE_POLICY_VERSION,
  CONSUMER_AGE_REQUIRED_CATEGORY,
  MAX_SELLABLE_CONSUMER_AGE,
  readNormalizedConsumerAgeCell,
  readNormalizedDateOfBirthCell,
  resolveConsumerAgeForFulfillment,
  type ResolvedConsumerAge,
} from "./consumer-age-policy.js";

export const CONSUMER_AGE_INVENTORY_REPORT_SCHEMA = "consumer_age_inventory_report_v1" as const;

export const CONSUMER_AGE_MAINTENANCE_PAGE_SIZE = 400;
export const CONSUMER_AGE_MAINTENANCE_MAX_SCAN_ROWS = 50_000;

/** Statuses that still represent live, recoverable, unsold inventory. */
export const CONSUMER_AGE_MAINTENANCE_DEFAULT_STATUSES = [
  "available",
  "pending_review",
] as const satisfies readonly LeadInventoryItemStatus[];

/** Statuses whose age must never be reclassified by maintenance. */
export const CONSUMER_AGE_DEAD_BLOCKED_STATUSES = [
  "reserved",
  "committed",
  "fulfilled",
] as const satisfies readonly LeadInventoryItemStatus[];

export const CONSUMER_AGE_BACKFILL_CONFIRMATION =
  "BACKFILL HISTORICAL CONSUMER AGE" as const;

export const CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION =
  "CLASSIFY CONSUMER AGE OVER 86 AS DEAD" as const;

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
  maxScanRows?: number;
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
  maxScanRows: number;
};

/** Per-dimension aggregate counts. Dimension keys are never consumer data. */
export type ConsumerAgeBreakdownBucket = {
  key: string;
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
  scan: {
    matchingRows: number;
    rowsScanned: number;
    pagesRead: number;
    scanCeilingHit: boolean;
    /** True when every matching row was classified. */
    exact: boolean;
  };
  summary: string;
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
  alreadyNormalized: boolean;
  recoverable: boolean;
  conflict: boolean;
  backfillCandidate: boolean;
  deadCandidate: boolean;
  deadBlockedByAllocation: boolean;
  deadBlockedByStatus: boolean;
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
  classification: RowClassification
) {
  const bucket = buckets.get(key) ?? emptyBucket(key);
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
  const maxScanRows = Math.max(
    1,
    Math.min(input.maxScanRows ?? CONSUMER_AGE_MAINTENANCE_MAX_SCAN_ROWS, CONSUMER_AGE_MAINTENANCE_MAX_SCAN_ROWS)
  );
  return {
    nicheKeys,
    nicheAliases: [...aliases],
    statuses,
    inventoryLotId: input.inventoryLotId?.trim() || null,
    sourceLane: input.sourceLane?.trim() || null,
    activeLotOnly: input.activeLotOnly ?? true,
    includeCommerceExcluded: input.includeCommerceExcluded ?? false,
    maxScanRows,
  };
}

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
  return { AND: clauses };
}

function cursorWhere(
  cursor: { generatedAt: Date; id: string } | null
): Prisma.LeadInventoryItemWhereInput | null {
  if (!cursor) return null;
  return {
    OR: [
      { generatedAt: { gt: cursor.generatedAt } },
      { generatedAt: cursor.generatedAt, id: { gt: cursor.id } },
    ],
  };
}

function classifyRow(row: MaintenanceScanRow, evaluatedAt: Date): RowClassification {
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

  const overMaximum = resolved.status === "over_maximum_age";
  const blockedByStatus = (CONSUMER_AGE_DEAD_BLOCKED_STATUSES as readonly string[]).includes(
    row.status
  );
  const blockedByAllocation = row._count.leadAllocations > 0;

  return {
    resolved,
    canonicalAge,
    alreadyNormalized,
    recoverable,
    conflict,
    backfillCandidate: needsAge || needsDob,
    deadCandidate:
      overMaximum && !blockedByAllocation && !blockedByStatus && row.commerceExcludedAt == null,
    deadBlockedByAllocation: overMaximum && blockedByAllocation,
    deadBlockedByStatus: overMaximum && !blockedByAllocation && blockedByStatus,
  };
}

type ScanOutcome = {
  totals: ConsumerAgeInventoryTotals;
  breakdown: ConsumerAgeInventoryReport["breakdown"];
  scan: ConsumerAgeInventoryReport["scan"];
  backfillCandidateIds: string[];
  deadCandidateIds: string[];
};

/**
 * Bounded keyset scan over the scope. `collectLimit` caps how many candidate
 * ids are retained for a later commit; classification counting continues past
 * it so the report stays complete.
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

  let cursor: { generatedAt: Date; id: string } | null = null;
  let rowsScanned = 0;
  let pagesRead = 0;
  let scanCeilingHit = false;

  while (rowsScanned < scope.maxScanRows) {
    const take = Math.min(CONSUMER_AGE_MAINTENANCE_PAGE_SIZE, scope.maxScanRows - rowsScanned);
    const cursorClause = cursorWhere(cursor);
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

    if (rows.length === 0) break;
    pagesRead += 1;

    for (const row of rows) {
      rowsScanned += 1;
      cursor = { generatedAt: row.generatedAt, id: row.id };
      const classification = classifyRow(row, evaluatedAt);

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
      addToBucket(byInventoryLot, row.inventoryLot.lotKey, classification);
      addToBucket(byGeneratedMonth, generatedMonthKey(row.generatedAt), classification);

      if (rowsScanned >= scope.maxScanRows) {
        scanCeilingHit = rowsScanned < matchingRows;
        break;
      }
    }

    if (scanCeilingHit || rows.length < take) break;
  }

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
      scanCeilingHit,
      exact: !scanCeilingHit && rowsScanned === matchingRows,
    },
    backfillCandidateIds,
    deadCandidateIds,
  };
}

function buildSummary(totals: ConsumerAgeInventoryTotals, exact: boolean): string {
  const prefix = exact
    ? ""
    : "Scan safety cap reached before every matching row was classified. ";
  return (
    `${prefix}${totals.activeSellableInventory} scoped inventory rows: ` +
    `${totals.ageAlreadyNormalized} already carry a canonical consumer age, ` +
    `${totals.recoverableTotal} are recoverable from a retained source cell, ` +
    `${totals.noAgeSource} have no age source at all, ` +
    `${totals.invalidAgeSource} hold an unusable age cell, and ` +
    `${totals.ageOverMaximum} resolve above age ${MAX_SELLABLE_CONSUMER_AGE}. ` +
    `Backfill would write ${totals.backfillCandidates} rows; dead classification would ` +
    `mark ${totals.deadClassificationCandidates} unallocated rows.`
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
    summary: buildSummary(outcome.totals, outcome.scan.exact),
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
  | "limit_required";

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
  scan?: ConsumerAgeInventoryReport["scan"];
  /** Rows whose canonical consumer age (and DOB when known) was promoted. */
  updatedIds?: string[];
  unchangedIds?: string[];
  /** Canonical value present and different — reported, never overwritten. */
  conflictIds?: string[];
  overMaximumAgeIds?: string[];
  /** True when candidates remained beyond `limit`. */
  moreCandidatesRemain?: boolean;
};

/**
 * Promote recovered consumer ages onto the canonical normalized destination.
 * Blank destinations only; a conflicting non-blank canonical value is reported
 * and left untouched. Bounded by `limit` and idempotent.
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

  const scope = resolveConsumerAgeMaintenanceScope(args.scope ?? {});
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
      moreCandidatesRemain: scanned.totals.backfillCandidates > scanned.backfillCandidateIds.length,
    };

    if (scanned.backfillCandidateIds.length === 0) {
      return {
        ...base,
        outcome: "NOOP",
        ok: true,
        writesAttempted: false,
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

export type ConsumerAgeDeadClassificationSkipReason =
  | "item_not_found"
  | "already_excluded"
  | "allocation_exists"
  | "blocked_status"
  | "age_no_longer_over_maximum"
  | "update_race";

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
  scan?: ConsumerAgeInventoryReport["scan"];
  exclusion?: {
    status: "expired";
    commerceExcludedReason: string;
    commerceExcludedBy: string;
    displayCategory: string;
  };
  classifiedIds?: string[];
  skipped?: Array<{ id: string; reason: ConsumerAgeDeadClassificationSkipReason }>;
  moreCandidatesRemain?: boolean;
};

type LockedDeadRow = {
  id: string;
  status: string;
  commerceExcludedAt: Date | null;
  metadataJson: Prisma.JsonValue;
  normalizedPayloadJson: Prisma.JsonValue;
  rawPayloadJson: Prisma.JsonValue;
  enrichmentMetadataJson: Prisma.JsonValue;
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

  const scope = resolveConsumerAgeMaintenanceScope(args.scope ?? {});
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
      exclusion: {
        status: "expired" as const,
        commerceExcludedReason: CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON,
        commerceExcludedBy: CONSUMER_AGE_POLICY_VERSION,
        displayCategory: CONSUMER_AGE_OVER_MAXIMUM_CATEGORY,
      },
      moreCandidatesRemain:
        scanned.totals.deadClassificationCandidates > scanned.deadCandidateIds.length,
    };

    if (scanned.deadCandidateIds.length === 0) {
      return {
        ...base,
        outcome: "NOOP",
        ok: true,
        writesAttempted: false,
        classifiedIds: [],
        skipped: [],
      };
    }

    const classifiedIds: string[] = [];
    const skipped: Array<{ id: string; reason: ConsumerAgeDeadClassificationSkipReason }> = [];

    for (const itemId of scanned.deadCandidateIds) {
      const outcome = await classifyOneOverMaximumItem(itemId, evaluatedAt, db);
      if (outcome === "classified") classifiedIds.push(itemId);
      else skipped.push({ id: itemId, reason: outcome });
    }

    return {
      ...base,
      outcome: classifiedIds.length > 0 ? "CLASSIFIED" : "NOOP",
      ok: true,
      writesAttempted: true,
      classifiedIds,
      skipped,
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

async function classifyOneOverMaximumItem(
  itemId: string,
  evaluatedAt: Date,
  db: PrismaClient
): Promise<"classified" | ConsumerAgeDeadClassificationSkipReason> {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<LockedDeadRow[]>`
      SELECT
        i.id,
        i.status::text AS status,
        i."commerceExcludedAt",
        i."metadataJson",
        e."normalizedPayloadJson",
        e."rawPayloadJson",
        e."enrichmentMetadataJson"
      FROM "LeadInventoryItem" i
      JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      WHERE i.id = ${itemId}
      FOR UPDATE OF i
    `;
    const row = locked[0];
    if (!row) return "item_not_found";
    if (row.commerceExcludedAt != null) return "already_excluded";
    if ((CONSUMER_AGE_DEAD_BLOCKED_STATUSES as readonly string[]).includes(row.status)) {
      return "blocked_status";
    }

    const allocationCount = await tx.leadAllocation.count({
      where: { leadInventoryItemId: itemId },
    });
    if (allocationCount > 0) return "allocation_exists";

    const resolved = resolveConsumerAgeForFulfillment({
      normalizedPayloadJson: row.normalizedPayloadJson,
      rawPayloadJson: row.rawPayloadJson,
      metadataJson: row.metadataJson,
      enrichmentMetadataJson: row.enrichmentMetadataJson,
      evaluatedAt,
    });
    if (resolved.status !== "over_maximum_age") return "age_no_longer_over_maximum";

    const now = new Date();
    const updated = await tx.leadInventoryItem.updateMany({
      where: {
        id: itemId,
        commerceExcludedAt: null,
        status: { notIn: [...CONSUMER_AGE_DEAD_BLOCKED_STATUSES] },
      },
      data: {
        status: "expired",
        expiredAt: now,
        commerceExcludedAt: now,
        commerceExcludedReason: CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON,
        commerceExcludedBy: CONSUMER_AGE_POLICY_VERSION,
      },
    });
    if (updated.count !== 1) return "update_race";
    return "classified";
  });
}
