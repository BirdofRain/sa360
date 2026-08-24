import { createHash, randomBytes } from "node:crypto";

import {
  LeadInventoryFacetBuildStatus,
  Prisma,
  type LeadInventoryFacetBuild,
  type PrismaClient,
} from "@prisma/client";

import {
  getLeadInventoryFacetSnapshotMaxAgeMinutes,
  getLeadInventoryFacetSnapshotStaleWarnMinutes,
} from "../../lib/lead-inventory-facet-snapshot-env.js";
import { prisma as defaultPrisma } from "../../lib/db.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import {
  LEAD_INVENTORY_CLOCK_TOLERANCE_MS,
  LEAD_INVENTORY_DEFAULT_AGE_BAND_VERSION,
  type LeadInventoryAgeBand,
} from "./lead-inventory.constants.js";
import { FACETS_PROOF_REQUIRED_LANES } from "./lead-inventory-facets-proof-lane.js";

export type FacetSnapshotReadFilters = {
  nicheKey?: string;
  productType?: string;
  inventoryClass?: string;
  sourceLane?: string;
  lotId?: string;
  status?: string;
  ageBandVersion?: string;
};

/** Retention: active + N prior successful builds + recent failed metadata. */
export const FACET_SNAPSHOT_SUCCESSFUL_BUILD_RETENTION = 3;
export const FACET_SNAPSHOT_FAILED_BUILD_RETENTION = 5;

/**
 * In-flight building/validated rows older than this are treated as abandoned.
 * Shared by claim recovery and cleanup eligibility.
 */
export const FACET_SNAPSHOT_IN_FLIGHT_STALE_MS = 60 * 60 * 1000;

/** Postgres advisory lock key namespace for short claim-serialization only. */
const FACET_SNAPSHOT_ADVISORY_LOCK_NAMESPACE = 0x53413630; // "SA60"

const IN_FLIGHT_BUILD_STATUSES: LeadInventoryFacetBuildStatus[] = [
  LeadInventoryFacetBuildStatus.building,
  LeadInventoryFacetBuildStatus.validated,
];

export type FacetSnapshotSupplyCell = {
  state: string;
  ageBandKey: string;
  total: number;
  available: number;
  reserved: number;
  blocked: number;
};

export type FacetSnapshotBuildResult =
  | {
      ok: true;
      buildId: string;
      ageBandVersion: string;
      evaluatedAt: string;
      activatedAt: string;
      inventoryCount: number;
      aggregateRowCount: number;
      buildDurationMs: number;
      validationOk: true;
      status: "active";
    }
  | {
      ok: false;
      buildId: string | null;
      ageBandVersion: string;
      status: "failed" | "skipped";
      failureCode: string;
      failureDetail: Record<string, unknown>;
      buildDurationMs: number;
    };

export type FacetSnapshotReadResult =
  | {
      ok: true;
      buildId: string;
      ageBandVersion: string;
      evaluatedAt: string;
      activatedAt: string | null;
      ageSeconds: number;
      isStale: boolean;
      staleWarning: boolean;
      queryDurationMs: number;
      rows: FacetSnapshotSupplyCell[];
      inventoryCount: number;
      aggregateRowCount: number;
    }
  | {
      ok: false;
      reason:
        | "missing_active_build"
        | "stale_beyond_max_age"
        | "invalid_active_build"
        | "query_failed";
      ageBandVersion: string;
      buildId?: string;
      ageSeconds?: number;
      detail?: string;
    };

export type FacetSnapshotBuildDiagnostics = {
  buildId: string;
  status: LeadInventoryFacetBuildStatus;
  ageBandVersion: string;
  evaluatedAt: string | null;
  startedAt: string;
  durationMs: number | null;
  inventoryCount: number;
  aggregateRowCount: number;
  validationOk: boolean;
  failureCode: string | null;
};

export type FacetSnapshotClaimResult =
  | {
      claimed: true;
      buildId: string;
      recoveredStaleBuildIds: string[];
    }
  | {
      claimed: false;
      reason: "rebuild_already_running";
      existingBuildId: string | null;
    };

function newBuildId(): string {
  return `lifb_${randomBytes(12).toString("hex")}`;
}

function newAggregateId(): string {
  return `lifa_${randomBytes(12).toString("hex")}`;
}

function toInt(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function advisoryLockKey(ageBandVersion: string): number {
  const digest = createHash("sha256")
    .update(`${FACET_SNAPSHOT_ADVISORY_LOCK_NAMESPACE}:${ageBandVersion}`)
    .digest();
  return digest.readInt32BE(0);
}

function buildAgeBandCaseSql(ageBands: LeadInventoryAgeBand[]): Prisma.Sql {
  if (ageBands.length === 0) {
    return Prisma.sql`NULL`;
  }
  const parts: Prisma.Sql[] = [];
  for (const band of ageBands) {
    if (band.maxDaysExclusive == null) {
      parts.push(Prisma.sql`WHEN age_days >= ${band.minDaysInclusive} THEN ${band.key}`);
    } else {
      parts.push(
        Prisma.sql`WHEN age_days >= ${band.minDaysInclusive} AND age_days < ${band.maxDaysExclusive} THEN ${band.key}`
      );
    }
  }
  return Prisma.sql`CASE ${Prisma.join(parts, " ")} ELSE NULL END`;
}

function buildSnapshotFilterSql(filters: FacetSnapshotReadFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (filters.nicheKey) clauses.push(Prisma.sql`a."nicheKey" = ${filters.nicheKey}`);
  if (filters.productType != null && filters.productType !== "") {
    clauses.push(Prisma.sql`a."productType" = ${filters.productType}`);
  }
  if (filters.inventoryClass) {
    clauses.push(Prisma.sql`a."inventoryClass" = ${filters.inventoryClass}`);
  }
  if (filters.sourceLane) clauses.push(Prisma.sql`a."sourceLane" = ${filters.sourceLane}`);
  if (filters.lotId) clauses.push(Prisma.sql`a."lotId" = ${filters.lotId}`);
  if (filters.status) clauses.push(Prisma.sql`a."itemStatus" = ${filters.status}`);
  if (clauses.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(clauses, " AND ");
}

function sanitizeFailureDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (value == null) continue;
    if (typeof value === "string") {
      out[key] = value.slice(0, 240);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) {
      out[key] = value.slice(0, 20);
    }
  }
  return out;
}

async function markBuildFailed(
  db: PrismaClient,
  buildId: string,
  failureCode: string,
  failureDetail: Record<string, unknown>,
  buildDurationMs: number
): Promise<void> {
  await db.leadInventoryFacetBuild.update({
    where: { id: buildId },
    data: {
      status: LeadInventoryFacetBuildStatus.failed,
      validationOk: false,
      buildDurationMs,
      failureCode,
      failureDetailJson: sanitizeFailureDetail(failureDetail) as Prisma.InputJsonValue,
    },
  });
}

type ValidationOk = {
  ok: true;
  inventoryCount: number;
  aggregateRowCount: number;
};

type ValidationFail = {
  ok: false;
  failureCode: string;
  failureDetail: Record<string, unknown>;
};

async function validateFacetSnapshotBuild(
  db: PrismaClient,
  buildId: string,
  ageBandVersion: string,
  ageBandKeys: Set<string>
): Promise<ValidationOk | ValidationFail> {
  const summary = await db.$queryRaw<
    Array<{
      row_count: bigint | number;
      sum_total: bigint | number | null;
      sum_available: bigint | number | null;
      sum_reserved: bigint | number | null;
      sum_blocked: bigint | number | null;
      negative_rows: bigint | number;
      partition_violations: bigint | number;
      blank_state_rows: bigint | number;
      bad_age_rows: bigint | number;
    }>
  >`
    SELECT
      COUNT(*)::bigint AS row_count,
      COALESCE(SUM(a.total), 0)::bigint AS sum_total,
      COALESCE(SUM(a.available), 0)::bigint AS sum_available,
      COALESCE(SUM(a.reserved), 0)::bigint AS sum_reserved,
      COALESCE(SUM(a.blocked), 0)::bigint AS sum_blocked,
      COUNT(*) FILTER (
        WHERE a.total < 0 OR a.available < 0 OR a.reserved < 0 OR a.blocked < 0
      )::bigint AS negative_rows,
      COUNT(*) FILTER (
        WHERE a.total <> (a.available + a.reserved + a.blocked)
      )::bigint AS partition_violations,
      COUNT(*) FILTER (
        WHERE a."normalizedState" IS NULL OR TRIM(a."normalizedState") = ''
      )::bigint AS blank_state_rows,
      COUNT(*) FILTER (
        WHERE a."ageBandKey" IS NULL OR TRIM(a."ageBandKey") = ''
      )::bigint AS bad_age_rows
    FROM "LeadInventoryFacetSupplyAggregate" a
    WHERE a."buildId" = ${buildId}
  `;

  const row = summary[0];
  if (!row) {
    return { ok: false, failureCode: "validation_summary_missing", failureDetail: {} };
  }

  const aggregateRowCount = toInt(row.row_count);
  const sumTotal = toInt(row.sum_total ?? 0);
  const sumAvailable = toInt(row.sum_available ?? 0);
  const sumReserved = toInt(row.sum_reserved ?? 0);
  const sumBlocked = toInt(row.sum_blocked ?? 0);

  if (toInt(row.negative_rows) > 0) {
    return {
      ok: false,
      failureCode: "negative_metrics",
      failureDetail: { negativeRows: toInt(row.negative_rows) },
    };
  }
  if (toInt(row.partition_violations) > 0) {
    return {
      ok: false,
      failureCode: "row_partition_invariant",
      failureDetail: { violations: toInt(row.partition_violations) },
    };
  }
  if (sumTotal !== sumAvailable + sumReserved + sumBlocked) {
    return {
      ok: false,
      failureCode: "aggregate_partition_invariant",
      failureDetail: { sumTotal, sumAvailable, sumReserved, sumBlocked },
    };
  }
  if (toInt(row.blank_state_rows) > 0) {
    return {
      ok: false,
      failureCode: "blank_state",
      failureDetail: { blankStateRows: toInt(row.blank_state_rows) },
    };
  }
  if (toInt(row.bad_age_rows) > 0) {
    return {
      ok: false,
      failureCode: "blank_age_band",
      failureDetail: { badAgeRows: toInt(row.bad_age_rows) },
    };
  }

  const distinctAgeKeys = await db.$queryRaw<Array<{ ageBandKey: string }>>`
    SELECT DISTINCT a."ageBandKey" AS "ageBandKey"
    FROM "LeadInventoryFacetSupplyAggregate" a
    WHERE a."buildId" = ${buildId}
  `;
  const unknownAge = distinctAgeKeys
    .map((r) => r.ageBandKey)
    .filter((key) => !ageBandKeys.has(key));
  if (unknownAge.length > 0) {
    return {
      ok: false,
      failureCode: "age_band_version_mismatch",
      failureDetail: { unknownAgeBandKeys: unknownAge.slice(0, 10) },
    };
  }

  const grainDupes = await db.$queryRaw<Array<{ dupe_count: bigint | number }>>`
    SELECT COUNT(*)::bigint AS dupe_count
    FROM (
      SELECT 1
      FROM "LeadInventoryFacetSupplyAggregate" a
      WHERE a."buildId" = ${buildId}
      GROUP BY
        a."ageBandVersion",
        a."nicheKey",
        a."productType",
        a."inventoryClass",
        a."sourceLane",
        a."lotId",
        a."itemStatus",
        a."normalizedState",
        a."ageBandKey"
      HAVING COUNT(*) > 1
    ) d
  `;
  if (toInt(grainDupes[0]?.dupe_count ?? 0) > 0) {
    return {
      ok: false,
      failureCode: "duplicate_grain",
      failureDetail: { duplicateGroups: toInt(grainDupes[0]!.dupe_count) },
    };
  }

  // Recompute matrix-eligible inventory with the same age CASE as the build.
  const ageBands = await listActiveAgeBandDefinitions(ageBandVersion, db);
  const ageBandCase = buildAgeBandCaseSql(ageBands);
  const eligibleExact = await db.$queryRaw<Array<{ inventory_count: bigint | number }>>`
    SELECT COUNT(*)::bigint AS inventory_count
    FROM (
      SELECT
        ${ageBandCase} AS age_band_key
      FROM (
        SELECT
          FLOOR(
            EXTRACT(
              EPOCH FROM (
                (SELECT b."evaluatedAt" FROM "LeadInventoryFacetBuild" b WHERE b.id = ${buildId})
                - i."generatedAt"
              )
            ) / 86400
          )::int AS age_days
        FROM "LeadInventoryItem" i
        WHERE i."normalizedState" IS NOT NULL
          AND TRIM(i."normalizedState") <> ''
      ) aged
    ) classified
    WHERE age_band_key IS NOT NULL
  `;

  const inventoryCount = toInt(eligibleExact[0]?.inventory_count ?? 0);
  if (sumTotal !== inventoryCount) {
    return {
      ok: false,
      failureCode: "inventory_count_mismatch",
      failureDetail: { sumTotal, inventoryCount },
    };
  }

  const build = await db.leadInventoryFacetBuild.findUnique({ where: { id: buildId } });
  if (!build) {
    return { ok: false, failureCode: "build_missing", failureDetail: {} };
  }
  if (build.aggregateRowCount !== aggregateRowCount) {
    return {
      ok: false,
      failureCode: "aggregate_row_count_mismatch",
      failureDetail: {
        recorded: build.aggregateRowCount,
        actual: aggregateRowCount,
      },
    };
  }

  return { ok: true, inventoryCount, aggregateRowCount };
}

/**
 * Atomically retire the previous active build and activate a validated build
 * for the same ageBandVersion. Outside readers never observe a building/validated
 * snapshot; failed activation leaves the prior active build untouched (rollback).
 */
export async function activateFacetSnapshotBuild(
  buildId: string,
  db: PrismaClient = defaultPrisma
): Promise<{ ok: true; activatedAt: Date; previousBuildId: string | null } | { ok: false; reason: string }> {
  try {
    return await db.$transaction(async (tx) => {
      const build = await tx.leadInventoryFacetBuild.findUnique({ where: { id: buildId } });
      if (!build) return { ok: false as const, reason: "build_missing" };
      if (build.status !== LeadInventoryFacetBuildStatus.validated) {
        return { ok: false as const, reason: `invalid_status:${build.status}` };
      }
      if (!build.validationOk) {
        return { ok: false as const, reason: "validation_not_ok" };
      }

      const previous = await tx.leadInventoryFacetBuild.findFirst({
        where: {
          ageBandVersion: build.ageBandVersion,
          status: LeadInventoryFacetBuildStatus.active,
        },
        select: { id: true },
      });

      if (previous) {
        const retired = await tx.leadInventoryFacetBuild.updateMany({
          where: {
            id: previous.id,
            status: LeadInventoryFacetBuildStatus.active,
          },
          data: { status: LeadInventoryFacetBuildStatus.retired },
        });
        if (retired.count !== 1) {
          throw new Error("retire_active_failed");
        }
      }

      const activatedAt = new Date();
      const activated = await tx.leadInventoryFacetBuild.updateMany({
        where: {
          id: buildId,
          status: LeadInventoryFacetBuildStatus.validated,
          validationOk: true,
        },
        data: {
          status: LeadInventoryFacetBuildStatus.active,
          activatedAt,
        },
      });
      if (activated.count !== 1) {
        throw new Error("activate_validated_failed");
      }

      return {
        ok: true as const,
        activatedAt,
        previousBuildId: previous?.id ?? null,
      };
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message.slice(0, 120) : "activate_failed",
    };
  }
}

/**
 * Short transaction-scoped claim for a facet snapshot rebuild.
 *
 * Uses pg_advisory_xact_lock / pg_try_advisory_xact_lock only to serialize
 * competing CLAIM attempts. The durable ownership marker after COMMIT is the
 * building LeadInventoryFacetBuild row — not a session advisory lock.
 */
export async function claimFacetSnapshotRebuild(opts: {
  ageBandVersion: string;
  buildId: string;
  evaluatedAt: Date;
  db?: PrismaClient;
  /** When true, use try-lock and skip if another claim holds the xact lock. Default true. */
  skipIfLocked?: boolean;
  now?: Date;
}): Promise<FacetSnapshotClaimResult> {
  const db = opts.db ?? defaultPrisma;
  const skipIfLocked = opts.skipIfLocked !== false;
  const now = opts.now ?? new Date();
  const lockKey = advisoryLockKey(opts.ageBandVersion);
  const staleBefore = new Date(now.getTime() - FACET_SNAPSHOT_IN_FLIGHT_STALE_MS);
  const proofRequired = [...FACETS_PROOF_REQUIRED_LANES];

  return db.$transaction(async (tx) => {
    if (skipIfLocked) {
      const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${lockKey}) AS locked
      `;
      if (!lockRows[0]?.locked) {
        return {
          claimed: false as const,
          reason: "rebuild_already_running" as const,
          existingBuildId: null,
        };
      }
    } else {
      // Cast void-returning lock to text so Prisma can deserialize the row.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})::text AS locked`;
    }

    const inFlight = await tx.leadInventoryFacetBuild.findMany({
      where: {
        ageBandVersion: opts.ageBandVersion,
        status: { in: IN_FLIGHT_BUILD_STATUSES },
      },
      select: { id: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
    });

    const freshInFlight = inFlight.filter((row) => row.createdAt >= staleBefore);
    if (freshInFlight.length > 0) {
      return {
        claimed: false as const,
        reason: "rebuild_already_running" as const,
        existingBuildId: freshInFlight[0]!.id,
      };
    }

    const recoveredStaleBuildIds: string[] = [];
    for (const stale of inFlight) {
      if (stale.createdAt >= staleBefore) continue;
      await tx.leadInventoryFacetBuild.update({
        where: { id: stale.id },
        data: {
          status: LeadInventoryFacetBuildStatus.failed,
          validationOk: false,
          failureCode: "stale_build_recovered",
          failureDetailJson: sanitizeFailureDetail({
            previousStatus: stale.status,
            recoveredByBuildId: opts.buildId,
          }) as Prisma.InputJsonValue,
        },
      });
      recoveredStaleBuildIds.push(stale.id);
    }

    await tx.leadInventoryFacetBuild.create({
      data: {
        id: opts.buildId,
        ageBandVersion: opts.ageBandVersion,
        evaluatedAt: opts.evaluatedAt,
        status: LeadInventoryFacetBuildStatus.building,
        inventoryCount: 0,
        aggregateRowCount: 0,
        validationOk: false,
        metadataJson: {
          proofLaneSource: "inventory_sourceLane",
          proofRequiredLanes: proofRequired,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      claimed: true as const,
      buildId: opts.buildId,
      recoveredStaleBuildIds,
    };
  });
}

/**
 * Authoritative SQL-side supply snapshot rebuild.
 * Never materializes inventory rows in Node — INSERT…SELECT aggregates only.
 *
 * Lifecycle: short claim transaction → durable building row → long aggregate
 * outside any interactive transaction → validate → activate → cleanup.
 */
export async function rebuildLeadInventoryFacetSupplySnapshot(
  opts: {
    ageBandVersion?: string;
    db?: PrismaClient;
    /** When true, skip if another rebuild already claimed this ageBandVersion. Default true. */
    skipIfLocked?: boolean;
  } = {}
): Promise<FacetSnapshotBuildResult> {
  const db = opts.db ?? defaultPrisma;
  const ageBandVersion = opts.ageBandVersion ?? LEAD_INVENTORY_DEFAULT_AGE_BAND_VERSION;
  const skipIfLocked = opts.skipIfLocked !== false;
  const startedAt = Date.now();
  const evaluatedAt = new Date();
  const buildId = newBuildId();

  const ageBands = await listActiveAgeBandDefinitions(ageBandVersion, db);
  if (ageBands.length === 0) {
    return {
      ok: false,
      buildId: null,
      ageBandVersion,
      status: "failed",
      failureCode: "age_bands_missing",
      failureDetail: { ageBandVersion },
      buildDurationMs: Date.now() - startedAt,
    };
  }

  const claim = await claimFacetSnapshotRebuild({
    ageBandVersion,
    buildId,
    evaluatedAt,
    db,
    skipIfLocked,
  });
  if (!claim.claimed) {
    return {
      ok: false,
      buildId: null,
      ageBandVersion,
      status: "skipped",
      failureCode: "rebuild_already_running",
      failureDetail: {
        ageBandVersion,
        existingBuildId: claim.existingBuildId,
      },
      buildDurationMs: Date.now() - startedAt,
    };
  }

  try {
    const ageBandKeys = new Set(ageBands.map((b) => b.key));
    const ageBandCase = buildAgeBandCaseSql(ageBands);
    const clockToleranceMs = LEAD_INVENTORY_CLOCK_TOLERANCE_MS;

    // SQL-side aggregate only. proof_lane from inventory sourceLane (clone-verified parity).
    // Runs outside the claim transaction — no session advisory lock is held.
    const inserted = await db.$executeRaw`
      INSERT INTO "LeadInventoryFacetSupplyAggregate" (
        "id",
        "buildId",
        "ageBandVersion",
        "nicheKey",
        "productType",
        "inventoryClass",
        "sourceLane",
        "lotId",
        "itemStatus",
        "normalizedState",
        "ageBandKey",
        "total",
        "available",
        "reserved",
        "blocked",
        "createdAt"
      )
      WITH active_holds AS (
        SELECT DISTINCT
          a."leadInventoryItemId" AS item_id
        FROM "LeadAllocation" a
        WHERE a."leadInventoryItemId" IS NOT NULL
          AND a.status IN ('reserved', 'committed', 'delivering', 'review_required')
      ),
      base AS (
        SELECT
          i.id,
          i."normalizedState" AS state,
          i."nicheKey" AS niche_key,
          COALESCE(i."productType", '') AS product_type,
          i."inventoryClass"::text AS inventory_class,
          i."sourceLane" AS source_lane,
          i."inventoryLotId" AS lot_id,
          i.status::text AS item_status,
          i.status,
          i."quarantineReason",
          i."withdrawnAt",
          i."expiredAt",
          i."commerceExcludedAt",
          i."generatedAt",
          i."fulfillmentCount",
          i."maxFulfillments",
          lot.status AS lot_status,
          FLOOR(EXTRACT(EPOCH FROM (${evaluatedAt}::timestamptz - i."generatedAt")) / 86400)::int AS age_days,
          COALESCE(p."proofStatus"::text, 'UNREVIEWED') AS proof_status,
          COALESCE(v."verificationStatus"::text, 'UNCHECKED') AS verification_status,
          COALESCE(v."duplicateStatus"::text, 'UNCHECKED') AS duplicate_status,
          CASE
            WHEN LOWER(TRIM(BOTH FROM i."sourceLane")) = 'facebook_meta_lead_ads'
              THEN 'meta_lead_ads'
            WHEN LOWER(TRIM(BOTH FROM i."sourceLane")) = 'google_sheets_google_sheet_import'
              THEN 'google_sheet_import'
            ELSE LOWER(TRIM(BOTH FROM i."sourceLane"))
          END AS proof_lane,
          (active_hold.item_id IS NOT NULL) AS has_hold
        FROM "LeadInventoryItem" i
        INNER JOIN "InventoryLot" lot ON lot.id = i."inventoryLotId"
        INNER JOIN "SourceLeadEvent" source_event
          ON source_event.id = i."sourceLeadEventId"
        LEFT JOIN "LeadProof" p ON p."leadUid" = source_event."sourceLeadUid"
        LEFT JOIN "LeadVerificationResult" v ON v."leadUid" = source_event."sourceLeadUid"
        LEFT JOIN active_holds active_hold ON active_hold.item_id = i.id
        WHERE i."normalizedState" IS NOT NULL
          AND TRIM(i."normalizedState") <> ''
      ),
      classified AS (
        SELECT
          state,
          niche_key,
          product_type,
          inventory_class,
          source_lane,
          lot_id,
          item_status,
          ${ageBandCase} AS age_band_key,
          has_hold,
          (
            NOT has_hold
            AND lot_status = 'active'
            AND status = 'available'
            AND "commerceExcludedAt" IS NULL
            AND "quarantineReason" IS NULL
            AND "withdrawnAt" IS NULL
            AND ("expiredAt" IS NULL OR "expiredAt" > ${evaluatedAt}::timestamptz)
            AND "generatedAt" IS NOT NULL
            AND "generatedAt" <= (${evaluatedAt}::timestamptz + (${clockToleranceMs}::double precision * INTERVAL '1 millisecond'))
            AND "fulfillmentCount" < "maxFulfillments"
            AND proof_status NOT IN ('REJECTED', 'PROOF_MISSING')
            AND (
              proof_status = 'PROOF_ATTACHED'
              OR proof_lane NOT IN ('leadcapture_io', 'leadconduit_facebook')
            )
            AND verification_status = 'PASSED'
            AND duplicate_status = 'UNIQUE'
          ) AS is_available
        FROM base
      ),
      grain AS (
        SELECT
          state AS normalized_state,
          niche_key,
          product_type,
          inventory_class,
          source_lane,
          lot_id,
          item_status,
          age_band_key,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE has_hold)::int AS reserved,
          COUNT(*) FILTER (WHERE is_available)::int AS available,
          COUNT(*) FILTER (WHERE NOT has_hold AND NOT is_available)::int AS blocked
        FROM classified
        WHERE age_band_key IS NOT NULL
        GROUP BY
          state,
          niche_key,
          product_type,
          inventory_class,
          source_lane,
          lot_id,
          item_status,
          age_band_key
      )
      SELECT
        md5(${buildId} || ':' || g.normalized_state || ':' || g.niche_key || ':' || g.product_type || ':' ||
            g.inventory_class || ':' || g.source_lane || ':' || g.lot_id || ':' || g.item_status || ':' ||
            g.age_band_key || ':' || random()::text),
        ${buildId},
        ${ageBandVersion},
        g.niche_key,
        g.product_type,
        g.inventory_class,
        g.source_lane,
        g.lot_id,
        g.item_status,
        g.normalized_state,
        g.age_band_key,
        g.total,
        g.available,
        g.reserved,
        g.blocked,
        NOW()
      FROM grain g
    `;

    const aggregateRowCount = typeof inserted === "number" ? inserted : Number(inserted);
    await db.leadInventoryFacetBuild.update({
      where: { id: buildId },
      data: { aggregateRowCount },
    });

    const validation = await validateFacetSnapshotBuild(db, buildId, ageBandVersion, ageBandKeys);
    if (!validation.ok) {
      const durationMs = Date.now() - startedAt;
      await markBuildFailed(db, buildId, validation.failureCode, validation.failureDetail, durationMs);
      return {
        ok: false,
        buildId,
        ageBandVersion,
        status: "failed",
        failureCode: validation.failureCode,
        failureDetail: validation.failureDetail,
        buildDurationMs: durationMs,
      };
    }

    const durationMs = Date.now() - startedAt;
    await db.leadInventoryFacetBuild.update({
      where: { id: buildId },
      data: {
        status: LeadInventoryFacetBuildStatus.validated,
        validationOk: true,
        inventoryCount: validation.inventoryCount,
        aggregateRowCount: validation.aggregateRowCount,
        buildDurationMs: durationMs,
      },
    });

    const activation = await activateFacetSnapshotBuild(buildId, db);
    if (!activation.ok) {
      await markBuildFailed(
        db,
        buildId,
        "activation_failed",
        { reason: activation.reason },
        Date.now() - startedAt
      );
      return {
        ok: false,
        buildId,
        ageBandVersion,
        status: "failed",
        failureCode: "activation_failed",
        failureDetail: { reason: activation.reason },
        buildDurationMs: Date.now() - startedAt,
      };
    }

    // Bounded cleanup after successful activation (best-effort; never fails the rebuild).
    try {
      await cleanupFacetSnapshotBuilds({ ageBandVersion, db });
    } catch {
      // ignore cleanup errors
    }

    return {
      ok: true,
      buildId,
      ageBandVersion,
      evaluatedAt: evaluatedAt.toISOString(),
      activatedAt: activation.activatedAt.toISOString(),
      inventoryCount: validation.inventoryCount,
      aggregateRowCount: validation.aggregateRowCount,
      buildDurationMs: durationMs,
      validationOk: true,
      status: "active",
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const failureCode = "rebuild_exception";
    const failureDetail = {
      message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    };
    try {
      const existing = await db.leadInventoryFacetBuild.findUnique({ where: { id: buildId } });
      if (existing) {
        await markBuildFailed(db, buildId, failureCode, failureDetail, durationMs);
      }
    } catch {
      // ignore secondary failure
    }
    return {
      ok: false,
      buildId,
      ageBandVersion,
      status: "failed",
      failureCode,
      failureDetail,
      buildDurationMs: durationMs,
    };
  }
}

/**
 * Delete old retired/failed builds beyond retention. Never deletes the active build
 * or the immediately previous successful builds still within retention.
 */
export async function cleanupFacetSnapshotBuilds(opts: {
  ageBandVersion?: string;
  db?: PrismaClient;
  successfulRetention?: number;
  failedRetention?: number;
} = {}): Promise<{ deletedBuilds: number }> {
  const db = opts.db ?? defaultPrisma;
  const ageBandVersion = opts.ageBandVersion;
  const successfulRetention = opts.successfulRetention ?? FACET_SNAPSHOT_SUCCESSFUL_BUILD_RETENTION;
  const failedRetention = opts.failedRetention ?? FACET_SNAPSHOT_FAILED_BUILD_RETENTION;

  const whereVersion = ageBandVersion ? { ageBandVersion } : {};

  const successful = await db.leadInventoryFacetBuild.findMany({
    where: {
      ...whereVersion,
      status: {
        in: [LeadInventoryFacetBuildStatus.active, LeadInventoryFacetBuildStatus.retired],
      },
      validationOk: true,
    },
    orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, status: true },
  });

  const keepSuccessful = new Set(
    successful.slice(0, Math.max(successfulRetention, 1)).map((b) => b.id)
  );
  // Always keep active.
  for (const build of successful) {
    if (build.status === LeadInventoryFacetBuildStatus.active) keepSuccessful.add(build.id);
  }

  const failed = await db.leadInventoryFacetBuild.findMany({
    where: {
      ...whereVersion,
      status: LeadInventoryFacetBuildStatus.failed,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const keepFailed = new Set(failed.slice(0, failedRetention).map((b) => b.id));

  const obsolete = await db.leadInventoryFacetBuild.findMany({
    where: {
      ...whereVersion,
      status: {
        in: [
          LeadInventoryFacetBuildStatus.retired,
          LeadInventoryFacetBuildStatus.failed,
          LeadInventoryFacetBuildStatus.validated,
          LeadInventoryFacetBuildStatus.building,
        ],
      },
      // Never delete fresh in-flight building/validated rows; stale threshold matches claim recovery.
      OR: [
        {
          status: {
            in: [LeadInventoryFacetBuildStatus.retired, LeadInventoryFacetBuildStatus.failed],
          },
        },
        {
          status: {
            in: IN_FLIGHT_BUILD_STATUSES,
          },
          createdAt: { lt: new Date(Date.now() - FACET_SNAPSHOT_IN_FLIGHT_STALE_MS) },
        },
      ],
    },
    select: { id: true },
  });

  const toDelete = obsolete
    .map((b) => b.id)
    .filter((id) => !keepSuccessful.has(id) && !keepFailed.has(id));

  if (toDelete.length === 0) return { deletedBuilds: 0 };

  const deleted = await db.leadInventoryFacetBuild.deleteMany({
    where: { id: { in: toDelete } },
  });
  return { deletedBuilds: deleted.count };
}

export async function resolveActiveFacetSnapshotBuild(
  ageBandVersion: string,
  db: PrismaClient = defaultPrisma
): Promise<LeadInventoryFacetBuild | null> {
  return db.leadInventoryFacetBuild.findFirst({
    where: {
      ageBandVersion,
      status: LeadInventoryFacetBuildStatus.active,
      validationOk: true,
    },
    orderBy: { activatedAt: "desc" },
  });
}

/**
 * Bounded snapshot reader: SQL WHERE on grain dimensions + SUM GROUP BY state×age.
 * Does not load full grain into Node for filtering.
 */
export async function readActiveFacetSnapshotSupply(
  filters: FacetSnapshotReadFilters = {},
  db: PrismaClient = defaultPrisma,
  opts?: { now?: Date }
): Promise<FacetSnapshotReadResult> {
  const ageBandVersion = filters.ageBandVersion ?? LEAD_INVENTORY_DEFAULT_AGE_BAND_VERSION;
  const now = opts?.now ?? new Date();
  const maxAgeMs = getLeadInventoryFacetSnapshotMaxAgeMinutes() * 60_000;
  const warnAgeMs = getLeadInventoryFacetSnapshotStaleWarnMinutes() * 60_000;

  const build = await resolveActiveFacetSnapshotBuild(ageBandVersion, db);
  if (!build || !build.activatedAt) {
    return { ok: false, reason: "missing_active_build", ageBandVersion };
  }
  if (!build.validationOk || build.status !== LeadInventoryFacetBuildStatus.active) {
    return {
      ok: false,
      reason: "invalid_active_build",
      ageBandVersion,
      buildId: build.id,
    };
  }

  const ageMs = Math.max(0, now.getTime() - build.evaluatedAt.getTime());
  const ageSeconds = Math.floor(ageMs / 1000);
  if (ageMs > maxAgeMs) {
    return {
      ok: false,
      reason: "stale_beyond_max_age",
      ageBandVersion,
      buildId: build.id,
      ageSeconds,
    };
  }

  const filterSql = buildSnapshotFilterSql(filters);
  const started = Date.now();
  try {
    const rows = await db.$queryRaw<
      Array<{
        state: string;
        age_band_key: string;
        total: bigint | number;
        available: bigint | number;
        reserved: bigint | number;
        blocked: bigint | number;
      }>
    >`
      SELECT
        a."normalizedState" AS state,
        a."ageBandKey" AS age_band_key,
        SUM(a.total)::bigint AS total,
        SUM(a.available)::bigint AS available,
        SUM(a.reserved)::bigint AS reserved,
        SUM(a.blocked)::bigint AS blocked
      FROM "LeadInventoryFacetSupplyAggregate" a
      WHERE a."buildId" = ${build.id}
        AND a."ageBandVersion" = ${ageBandVersion}
        AND ${filterSql}
      GROUP BY a."normalizedState", a."ageBandKey"
      ORDER BY a."normalizedState", a."ageBandKey"
    `;

    return {
      ok: true,
      buildId: build.id,
      ageBandVersion,
      evaluatedAt: build.evaluatedAt.toISOString(),
      activatedAt: build.activatedAt.toISOString(),
      ageSeconds,
      isStale: ageMs > warnAgeMs,
      staleWarning: ageMs > warnAgeMs,
      queryDurationMs: Date.now() - started,
      rows: rows.map((row) => ({
        state: row.state,
        ageBandKey: row.age_band_key,
        total: toInt(row.total),
        available: toInt(row.available),
        reserved: toInt(row.reserved),
        blocked: toInt(row.blocked),
      })),
      inventoryCount: build.inventoryCount,
      aggregateRowCount: build.aggregateRowCount,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "query_failed",
      ageBandVersion,
      buildId: build.id,
      ageSeconds,
      detail: err instanceof Error ? err.message.slice(0, 120) : "query_failed",
    };
  }
}

export function toFacetSnapshotBuildDiagnostics(
  build: LeadInventoryFacetBuild
): FacetSnapshotBuildDiagnostics {
  return {
    buildId: build.id,
    status: build.status,
    ageBandVersion: build.ageBandVersion,
    evaluatedAt: build.evaluatedAt?.toISOString() ?? null,
    startedAt: build.createdAt.toISOString(),
    durationMs: build.buildDurationMs,
    inventoryCount: build.inventoryCount,
    aggregateRowCount: build.aggregateRowCount,
    validationOk: build.validationOk,
    failureCode: build.failureCode,
  };
}

/** Test helper — exposes id generators without inventory materialization. */
export const __facetSnapshotTestUtils = {
  newBuildId,
  newAggregateId,
  advisoryLockKey,
  buildAgeBandCaseSql,
  buildSnapshotFilterSql,
  FACET_SNAPSHOT_IN_FLIGHT_STALE_MS,
};
