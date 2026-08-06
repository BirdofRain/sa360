import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createAdminRouteDiagnostics,
  logAdminRouteDiagnostics,
  runWithDependencyTimeout,
} from "../../lib/admin-route-diagnostics.js";
import { prisma as defaultPrisma } from "../../lib/db.js";
import { listActiveAgeBandDefinitions } from "../../repositories/lead-inventory.repository.js";
import { LEAD_INVENTORY_CLOCK_TOLERANCE_MS, type LeadInventoryAgeBand } from "./lead-inventory.constants.js";
import { buildLeadInventoryDemandOverlay } from "./lead-inventory-demand.service.js";
import { computeCellCoverage } from "./lead-inventory-demand.logic.js";
import { assertFacetCellInvariants } from "./lead-inventory-facet-classification.js";
import {
  normalizeFacetsFlightKey,
  runFacetsSingleFlight,
} from "./lead-inventory-facets-single-flight.js";

/** Hard route budget — must complete or degrade within this window. */
export const LEAD_INVENTORY_FACETS_TIMEOUT_MS = 8_000;

/** Soft ceiling for Prisma operations per facets request (aggregates only). */
export const LEAD_INVENTORY_FACETS_MAX_PRISMA_OPS = 50;

/**
 * Documented pre-patch unbounded behavior (removed).
 * Regression tests assert the new path does not reintroduce these patterns.
 */
export const LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY = {
  fullInventoryFindMany: true,
  jsonPayloadSelected: true,
  perItemProofQueries: true,
  perItemVerificationQueries: true,
  demandSupplyFullScan: true,
  timeoutMs: null as number | null,
  abortSupport: false,
} as const;

export type LeadInventoryFacetFilters = {
  nicheKey?: string;
  productType?: string;
  inventoryClass?: string;
  sourceLane?: string;
  lotId?: string;
  status?: string;
  availableOnly?: boolean;
  ageBandVersion?: string;
};

export type FacetWarning = {
  code: string;
  message: string;
};

export type FacetCell = {
  state: string;
  ageBandKey: string;
  ageBandLabel: string;
  total: number;
  available: number;
  reserved: number;
  blocked: number;
  exactCellDemand: number;
  supply: number;
  unmet: number;
  coverageRatio: number | null;
};

export type LeadInventoryFacetsResult = {
  rows: FacetCell[];
  ageBands: Array<{ key: string; label: string }>;
  evaluatedAt: string;
  totals: {
    overall: number;
    byState: Record<string, number>;
    byAgeBand: Record<string, number>;
  };
  flexibleDemandTotal: number;
  flexibleDemandLineCount: number;
  flexibleDemandLines: unknown[];
  partial: boolean;
  degraded: boolean;
  unavailableSections: string[];
  warnings: FacetWarning[];
  queryCount: number;
  rowsMaterialized: number;
};

export type BuildLeadInventoryFacetsOpts = {
  signal?: AbortSignal;
  requestId?: string;
  /** When false, skip single-flight (tests). Default true. */
  singleFlight?: boolean;
  timeoutMs?: number;
};

type AggregateRow = {
  state: string;
  age_band_key: string;
  total: bigint | number;
  available: bigint | number;
  reserved: bigint | number;
  blocked: bigint | number;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("inventory_facets_aborted");
    err.name = "AbortError";
    throw err;
  }
}

function toInt(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function emptyFacetsResult(evaluatedAt: Date, extras?: Partial<LeadInventoryFacetsResult>): LeadInventoryFacetsResult {
  return {
    rows: [],
    ageBands: [],
    evaluatedAt: evaluatedAt.toISOString(),
    totals: { overall: 0, byState: {}, byAgeBand: {} },
    flexibleDemandTotal: 0,
    flexibleDemandLineCount: 0,
    flexibleDemandLines: [],
    partial: true,
    degraded: true,
    unavailableSections: [],
    warnings: [],
    queryCount: 0,
    rowsMaterialized: 0,
    ...extras,
  };
}

function summarizeFacetRows(rows: FacetCell[]) {
  const byState = new Map<string, number>();
  const byAgeBand = new Map<string, number>();
  let overall = 0;
  for (const row of rows) {
    overall += row.total;
    byState.set(row.state, (byState.get(row.state) ?? 0) + row.total);
    byAgeBand.set(row.ageBandKey, (byAgeBand.get(row.ageBandKey) ?? 0) + row.total);
  }
  return {
    overall,
    byState: Object.fromEntries(byState),
    byAgeBand: Object.fromEntries(byAgeBand),
  };
}

function buildAgeBandCaseSql(ageBands: LeadInventoryAgeBand[]): Prisma.Sql {
  if (ageBands.length === 0) {
    return Prisma.sql`NULL`;
  }
  const parts: Prisma.Sql[] = [];
  for (const band of ageBands) {
    if (band.maxDaysExclusive == null) {
      parts.push(
        Prisma.sql`WHEN age_days >= ${band.minDaysInclusive} THEN ${band.key}`
      );
    } else {
      parts.push(
        Prisma.sql`WHEN age_days >= ${band.minDaysInclusive} AND age_days < ${band.maxDaysExclusive} THEN ${band.key}`
      );
    }
  }
  return Prisma.sql`CASE ${Prisma.join(parts, " ")} ELSE NULL END`;
}

function buildFilterSql(filters: LeadInventoryFacetFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (filters.nicheKey) clauses.push(Prisma.sql`i."nicheKey" = ${filters.nicheKey}`);
  if (filters.productType) clauses.push(Prisma.sql`i."productType" = ${filters.productType}`);
  if (filters.inventoryClass) {
    clauses.push(Prisma.sql`i."inventoryClass" = ${filters.inventoryClass}::"LeadInventoryClass"`);
  }
  if (filters.sourceLane) clauses.push(Prisma.sql`i."sourceLane" = ${filters.sourceLane}`);
  if (filters.lotId) clauses.push(Prisma.sql`i."inventoryLotId" = ${filters.lotId}`);
  if (filters.status) {
    clauses.push(Prisma.sql`i.status = ${filters.status}::"LeadInventoryItemStatus"`);
  }
  if (clauses.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(clauses, " AND ");
}

/**
 * Single aggregate query: state × age-band totals with reserved/available/blocked.
 * Joins proof/verification for evidence rules without loading inventory rows into Node.
 * Does not select JSON payload columns.
 */
export async function aggregateLeadInventoryFacetCells(
  db: PrismaClient,
  filters: LeadInventoryFacetFilters,
  ageBands: LeadInventoryAgeBand[],
  evaluatedAt: Date,
  signal?: AbortSignal
): Promise<{ rows: AggregateRow[]; queryCount: number }> {
  throwIfAborted(signal);
  if (ageBands.length === 0) return { rows: [], queryCount: 0 };

  const ageBandCase = buildAgeBandCaseSql(ageBands);
  const filterSql = buildFilterSql(filters);
  const clockToleranceMs = LEAD_INVENTORY_CLOCK_TOLERANCE_MS;

  // Active holds are pre-aggregated once (DISTINCT item ids) then left-joined.
  // Avoids correlated EXISTS / SubPlans that force Sorted Aggregate over all inventory rows.
  const rows = await db.$queryRaw<AggregateRow[]>`
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
        i.status,
        i."quarantineReason",
        i."withdrawnAt",
        i."expiredAt",
        i."generatedAt",
        i."fulfillmentCount",
        i."maxFulfillments",
        lot.status AS lot_status,
        FLOOR(EXTRACT(EPOCH FROM (${evaluatedAt}::timestamptz - i."generatedAt")) / 86400)::int AS age_days,
        COALESCE(p."proofStatus"::text, 'UNREVIEWED') AS proof_status,
        COALESCE(v."verificationStatus"::text, 'UNCHECKED') AS verification_status,
        COALESCE(v."duplicateStatus"::text, 'UNCHECKED') AS duplicate_status,
        CASE
          WHEN LOWER(TRIM(BOTH FROM COALESCE(
            NULLIF(e."enrichmentMetadataJson"->>'sourceLane', ''),
            CONCAT(e."sourceProvider"::text, '_', e."sourceSystem"::text)
          ))) = 'facebook_meta_lead_ads' THEN 'meta_lead_ads'
          WHEN LOWER(TRIM(BOTH FROM COALESCE(
            NULLIF(e."enrichmentMetadataJson"->>'sourceLane', ''),
            CONCAT(e."sourceProvider"::text, '_', e."sourceSystem"::text)
          ))) = 'google_sheets_google_sheet_import' THEN 'google_sheet_import'
          ELSE LOWER(TRIM(BOTH FROM COALESCE(
            NULLIF(e."enrichmentMetadataJson"->>'sourceLane', ''),
            CONCAT(e."sourceProvider"::text, '_', e."sourceSystem"::text)
          )))
        END AS proof_lane,
        (active_hold.item_id IS NOT NULL) AS has_hold
      FROM "LeadInventoryItem" i
      INNER JOIN "InventoryLot" lot ON lot.id = i."inventoryLotId"
      INNER JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
      LEFT JOIN "LeadProof" p ON p."leadUid" = e."sourceLeadUid"
      LEFT JOIN "LeadVerificationResult" v ON v."leadUid" = e."sourceLeadUid"
      LEFT JOIN active_holds active_hold ON active_hold.item_id = i.id
      WHERE ${filterSql}
        AND i."normalizedState" IS NOT NULL
        AND TRIM(i."normalizedState") <> ''
    ),
    classified AS (
      SELECT
        state,
        ${ageBandCase} AS age_band_key,
        has_hold,
        (
          NOT has_hold
          AND lot_status = 'active'
          AND status = 'available'
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
    )
    SELECT
      state,
      age_band_key,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE has_hold)::bigint AS reserved,
      COUNT(*) FILTER (WHERE is_available)::bigint AS available,
      COUNT(*) FILTER (WHERE NOT has_hold AND NOT is_available)::bigint AS blocked
    FROM classified
    WHERE age_band_key IS NOT NULL
    GROUP BY state, age_band_key
  `;

  throwIfAborted(signal);
  return { rows, queryCount: 1 };
}

async function computeFacetsCore(
  filters: LeadInventoryFacetFilters,
  db: PrismaClient,
  signal: AbortSignal | undefined,
  diag: ReturnType<typeof createAdminRouteDiagnostics>
): Promise<LeadInventoryFacetsResult> {
  const evaluatedAt = new Date();
  let queryCount = 0;
  const unavailableSections: string[] = [];
  const warnings: FacetWarning[] = [];

  throwIfAborted(signal);
  const ageBandsStarted = Date.now();
  const ageBands = await listActiveAgeBandDefinitions(filters.ageBandVersion, db);
  queryCount += 1;
  diag.record({
    dependency: "age_bands",
    outcome: "success",
    durationMs: Date.now() - ageBandsStarted,
    rowsReturned: ageBands.length,
    queryCount: 1,
  });
  throwIfAborted(signal);

  const aggStarted = Date.now();
  let aggregateRows: AggregateRow[] = [];
  try {
    const agg = await aggregateLeadInventoryFacetCells(db, filters, ageBands, evaluatedAt, signal);
    aggregateRows = agg.rows;
    queryCount += agg.queryCount;
    diag.record({
      dependency: "facet_aggregates",
      outcome: "success",
      durationMs: Date.now() - aggStarted,
      rowsReturned: aggregateRows.length,
      queryCount: agg.queryCount,
      summary: "state×ageBand aggregate (no inventory row materialization)",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    unavailableSections.push("matrix");
    warnings.push({
      code: "facets_aggregate_failed",
      message: "Inventory matrix aggregates were temporarily unavailable.",
    });
    diag.record({
      dependency: "facet_aggregates",
      outcome: "error",
      durationMs: Date.now() - aggStarted,
      code: "facets_aggregate_failed",
      summary: err instanceof Error ? err.message.slice(0, 120) : "aggregate_failed",
    });
  }

  throwIfAborted(signal);

  const demandStarted = Date.now();
  let demandOverlay: Awaited<ReturnType<typeof buildLeadInventoryDemandOverlay>> | null = null;
  try {
    demandOverlay = await buildLeadInventoryDemandOverlay(
      { ...filters, evaluatedAt },
      db,
      { signal }
    );
    queryCount += demandOverlay.queryCount;
    diag.record({
      dependency: "demand_overlay",
      outcome: "success",
      durationMs: Date.now() - demandStarted,
      rowsReturned: demandOverlay.cells.length,
      queryCount: demandOverlay.queryCount,
      summary: "order-line demand only (no inventory supply scan)",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    unavailableSections.push("demandOverlay");
    warnings.push({
      code: "facets_demand_unavailable",
      message: "Demand overlay was temporarily unavailable.",
    });
    diag.record({
      dependency: "demand_overlay",
      outcome: "error",
      durationMs: Date.now() - demandStarted,
      code: "facets_demand_unavailable",
    });
  }

  throwIfAborted(signal);

  const bandLabel = new Map(ageBands.map((b) => [b.key, b.label]));
  const demandByKey = new Map<string, number>(
    (demandOverlay?.cells ?? []).map((c) => [`${c.state}::${c.ageBandKey}`, c.exactCellDemand])
  );

  const cellMap = new Map<string, FacetCell>();
  for (const row of aggregateRows) {
    const state = row.state;
    const ageBandKey = row.age_band_key;
    if (!state || !ageBandKey) continue;
    const key = `${state}::${ageBandKey}`;
    const total = toInt(row.total);
    const available = toInt(row.available);
    const reserved = toInt(row.reserved);
    const blocked = toInt(row.blocked);
    const exactCellDemand = demandByKey.get(key) ?? 0;
    const supply = available + reserved;
    const coverage = computeCellCoverage({ exactCellDemand, supply });
    cellMap.set(key, {
      state,
      ageBandKey,
      ageBandLabel: bandLabel.get(ageBandKey) ?? ageBandKey,
      total,
      available,
      reserved,
      blocked,
      exactCellDemand,
      supply,
      unmet: coverage.unmet,
      coverageRatio: coverage.coverageRatio,
    });
  }

  // Ensure demand-only cells appear (zero supply).
  for (const [key, exactCellDemand] of demandByKey) {
    if (cellMap.has(key)) continue;
    const [state, ageBandKey] = key.split("::");
    if (!state || !ageBandKey) continue;
    const coverage = computeCellCoverage({ exactCellDemand, supply: 0 });
    cellMap.set(key, {
      state,
      ageBandKey,
      ageBandLabel: bandLabel.get(ageBandKey) ?? ageBandKey,
      total: 0,
      available: 0,
      reserved: 0,
      blocked: 0,
      exactCellDemand,
      supply: 0,
      unmet: coverage.unmet,
      coverageRatio: coverage.coverageRatio,
    });
  }

  let rows = [...cellMap.values()].sort((a, b) => {
    if (a.state !== b.state) return a.state.localeCompare(b.state);
    return a.ageBandKey.localeCompare(b.ageBandKey);
  });

  for (const row of rows) {
    if (!assertFacetCellInvariants(row)) {
      throw new Error(`facet_invariant_violation:${row.state}:${row.ageBandKey}`);
    }
  }

  const totalsSource = rows;
  if (filters.availableOnly) {
    rows = rows.filter((row) => row.available > 0);
  }

  if (queryCount > LEAD_INVENTORY_FACETS_MAX_PRISMA_OPS) {
    warnings.push({
      code: "facets_query_budget_high",
      message: "Facets query count exceeded the expected budget; investigate regressions.",
    });
  }

  const partial = unavailableSections.length > 0;
  return {
    rows,
    ageBands: ageBands.map((b) => ({ key: b.key, label: b.label })),
    evaluatedAt: evaluatedAt.toISOString(),
    totals: summarizeFacetRows(filters.availableOnly ? totalsSource : rows),
    flexibleDemandTotal: demandOverlay?.flexibleDemandTotal ?? 0,
    flexibleDemandLineCount: demandOverlay?.flexibleDemandLineCount ?? 0,
    flexibleDemandLines: demandOverlay?.flexibleDemandLines ?? [],
    partial,
    degraded: partial,
    unavailableSections,
    warnings,
    queryCount,
    rowsMaterialized: 0,
  };
}

function degradedFacetsResult(
  evaluatedAt: Date,
  code: "facets_time_budget_exceeded" | "facets_aborted"
): LeadInventoryFacetsResult {
  return emptyFacetsResult(evaluatedAt, {
    partial: true,
    degraded: true,
    unavailableSections: ["matrix", "demandOverlay"],
    warnings: [
      {
        code,
        message:
          code === "facets_time_budget_exceeded"
            ? "Some inventory facets are temporarily unavailable."
            : "Inventory facets request was aborted.",
      },
    ],
  });
}

/**
 * Shared computation uses a timeout-only AbortSignal so one abandoned client
 * cannot cancel in-flight work for other waiters. Per-request abort races
 * against the shared promise and returns a structured degraded payload.
 */
export async function buildLeadInventoryFacets(
  filters: LeadInventoryFacetFilters = {},
  db: PrismaClient = defaultPrisma,
  opts?: BuildLeadInventoryFacetsOpts
): Promise<LeadInventoryFacetsResult> {
  const timeoutMs = opts?.timeoutMs ?? LEAD_INVENTORY_FACETS_TIMEOUT_MS;
  const diag = createAdminRouteDiagnostics("/admin/v1/lead-inventory/facets", opts?.requestId);
  const evaluatedAt = new Date();
  const useFlight = opts?.singleFlight !== false;
  const flightKey = normalizeFacetsFlightKey({
    nicheKey: filters.nicheKey,
    productType: filters.productType,
    inventoryClass: filters.inventoryClass,
    sourceLane: filters.sourceLane,
    lotId: filters.lotId,
    status: filters.status,
    availableOnly: filters.availableOnly === true,
    ageBandVersion: filters.ageBandVersion,
  });

  const executeShared = async (): Promise<LeadInventoryFacetsResult> => {
    // Intentionally omit parentSignal — timeout bounds shared work only.
    const timed = await runWithDependencyTimeout(
      "lead_inventory_facets",
      timeoutMs,
      (signal) => computeFacetsCore(filters, db, signal, diag)
    );

    if (timed.ok) {
      const result = timed.value;
      diag.record({
        dependency: "lead_inventory_facets",
        outcome: result.partial ? "partial" : "success",
        durationMs: timed.durationMs,
        queryCount: result.queryCount,
        rowsReturned: result.rows.length,
        rowsRead: 0,
      });
      logAdminRouteDiagnostics(diag.finish());
      return result;
    }

    const code =
      timed.code === "dependency_timeout" ? "facets_time_budget_exceeded" : "facets_aborted";
    const degraded = degradedFacetsResult(evaluatedAt, code);
    diag.record({
      dependency: "lead_inventory_facets",
      outcome: timed.code === "dependency_timeout" ? "timeout" : "aborted",
      durationMs: timed.durationMs,
      code: timed.code,
    });
    logAdminRouteDiagnostics(diag.finish());
    return degraded;
  };

  const sharedPromise = useFlight
    ? runFacetsSingleFlight(flightKey, executeShared)
    : executeShared();

  const parentSignal = opts?.signal;
  if (!parentSignal) return sharedPromise;
  if (parentSignal.aborted) return degradedFacetsResult(evaluatedAt, "facets_aborted");

  return new Promise<LeadInventoryFacetsResult>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      resolve(degradedFacetsResult(evaluatedAt, "facets_aborted"));
    };
    const cleanup = () => parentSignal.removeEventListener("abort", onAbort);
    parentSignal.addEventListener("abort", onAbort, { once: true });
    sharedPromise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err) => {
        cleanup();
        reject(err);
      }
    );
  });
}
