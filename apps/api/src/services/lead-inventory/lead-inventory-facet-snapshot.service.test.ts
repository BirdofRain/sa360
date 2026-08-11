import assert from "node:assert/strict";
import { test } from "node:test";

import { LeadInventoryFacetBuildStatus } from "@prisma/client";

import {
  activateFacetSnapshotBuild,
  claimFacetSnapshotRebuild,
  cleanupFacetSnapshotBuilds,
  FACET_SNAPSHOT_IN_FLIGHT_STALE_MS,
  readActiveFacetSnapshotSupply,
  rebuildLeadInventoryFacetSupplySnapshot,
  __facetSnapshotTestUtils,
} from "./lead-inventory-facet-snapshot.service.js";

function flattenQueryRawSql(args: unknown[]): string {
  const parts: string[] = [];
  const walkSqlValue = (value: unknown): void => {
    if (value == null) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value === "object" && value !== null && "strings" in value) {
      const sql = value as { strings: ReadonlyArray<string>; values?: unknown[] };
      const nested = sql.values ?? [];
      for (let i = 0; i < sql.strings.length; i++) {
        parts.push(sql.strings[i] ?? "");
        if (i < nested.length) walkSqlValue(nested[i]);
      }
    }
  };
  const head = args[0];
  if (head && typeof head === "object" && "strings" in (head as object)) {
    walkSqlValue(head);
    return parts.join("");
  }
  return String(head ?? "");
}

test("snapshot helpers never invent inventory findMany materialization paths", () => {
  assert.equal(typeof __facetSnapshotTestUtils.newBuildId(), "string");
  assert.match(__facetSnapshotTestUtils.newBuildId(), /^lifb_/);
  assert.equal(typeof __facetSnapshotTestUtils.advisoryLockKey("v1"), "number");
});

test("atomic activation retires previous active and activates validated build", async () => {
  const builds = new Map<string, Record<string, unknown>>([
    [
      "build_a",
      {
        id: "build_a",
        ageBandVersion: "v1",
        status: LeadInventoryFacetBuildStatus.active,
        validationOk: true,
        activatedAt: new Date("2026-08-10T12:00:00.000Z"),
      },
    ],
    [
      "build_b",
      {
        id: "build_b",
        ageBandVersion: "v1",
        status: LeadInventoryFacetBuildStatus.validated,
        validationOk: true,
        activatedAt: null,
      },
    ],
  ]);

  const db: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    leadInventoryFacetBuild: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => builds.get(id) ?? null,
      findFirst: async ({
        where,
      }: {
        where: { ageBandVersion: string; status: LeadInventoryFacetBuildStatus };
      }) => {
        for (const build of builds.values()) {
          if (build.ageBandVersion === where.ageBandVersion && build.status === where.status) {
            return { id: build.id as string };
          }
        }
        return null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: LeadInventoryFacetBuildStatus; validationOk?: boolean };
        data: Record<string, unknown>;
      }) => {
        const build = builds.get(where.id);
        if (!build || build.status !== where.status) return { count: 0 };
        if (where.validationOk != null && build.validationOk !== where.validationOk) {
          return { count: 0 };
        }
        Object.assign(build, data);
        return { count: 1 };
      },
    },
  };

  const result = await activateFacetSnapshotBuild("build_b", db as never);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.previousBuildId, "build_a");
  assert.equal(builds.get("build_a")?.status, LeadInventoryFacetBuildStatus.retired);
  assert.equal(builds.get("build_b")?.status, LeadInventoryFacetBuildStatus.active);
  assert.ok(builds.get("build_b")?.activatedAt instanceof Date);
});

test("failed activation guard does not activate non-validated build", async () => {
  const builds = new Map<string, Record<string, unknown>>([
    [
      "build_c",
      {
        id: "build_c",
        ageBandVersion: "v1",
        status: LeadInventoryFacetBuildStatus.failed,
        validationOk: false,
        activatedAt: null,
      },
    ],
    [
      "build_b",
      {
        id: "build_b",
        ageBandVersion: "v1",
        status: LeadInventoryFacetBuildStatus.active,
        validationOk: true,
        activatedAt: new Date(),
      },
    ],
  ]);

  const db: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    leadInventoryFacetBuild: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => builds.get(id) ?? null,
      findFirst: async () => ({ id: "build_b" }),
      updateMany: async () => ({ count: 0 }),
    },
  };

  const result = await activateFacetSnapshotBuild("build_c", db as never);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /invalid_status/);
  assert.equal(builds.get("build_b")?.status, LeadInventoryFacetBuildStatus.active);
});

test("claim skips when transaction advisory try-lock is held", async () => {
  const db = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    $queryRaw: async (...args: unknown[]) => {
      const sql = flattenQueryRawSql(args);
      if (sql.includes("pg_try_advisory_xact_lock")) return [{ locked: false }];
      if (/pg_try_advisory_lock(?!_xact)|pg_advisory_lock\(|pg_advisory_unlock/.test(sql)) {
        throw new Error("session_advisory_lock_must_not_be_used");
      }
      return [];
    },
    leadInventoryFacetBuild: {
      findMany: async () => {
        throw new Error("should_not_query_builds_when_lock_missed");
      },
      create: async () => {
        throw new Error("should_not_create_when_locked");
      },
    },
  };

  const result = await claimFacetSnapshotRebuild({
    db: db as never,
    ageBandVersion: "v1",
    buildId: "lifb_claim_skip",
    evaluatedAt: new Date(),
    skipIfLocked: true,
  });
  assert.equal(result.claimed, false);
  if (result.claimed) return;
  assert.equal(result.reason, "rebuild_already_running");
});

test("rebuild skips when a fresh in-flight build already claimed the version", async () => {
  const ageBands = [
    {
      key: "FRESH_0_7",
      label: "0–7 days",
      minDaysInclusive: 0,
      maxDaysExclusive: 8,
      sortOrder: 10,
    },
  ];
  const db = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    $queryRaw: async (...args: unknown[]) => {
      const sql = flattenQueryRawSql(args);
      if (sql.includes("pg_try_advisory_xact_lock")) return [{ locked: true }];
      return [];
    },
    leadAgeBandDefinition: { findMany: async () => ageBands },
    leadInventoryFacetBuild: {
      findMany: async () => [
        {
          id: "lifb_existing",
          createdAt: new Date(),
          status: LeadInventoryFacetBuildStatus.building,
        },
      ],
      create: async () => {
        throw new Error("should_not_create_when_inflight");
      },
    },
  };

  const result = await rebuildLeadInventoryFacetSupplySnapshot({
    db: db as never,
    ageBandVersion: "v1",
    skipIfLocked: true,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "skipped");
  assert.equal(result.failureCode, "rebuild_already_running");
});

test("claim recovers stale in-flight build and creates a new building row", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const createdRows: Array<Record<string, unknown>> = [];
  const staleCreatedAt = new Date(Date.now() - FACET_SNAPSHOT_IN_FLIGHT_STALE_MS - 1_000);
  const db = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    $queryRaw: async (...args: unknown[]) => {
      const sql = flattenQueryRawSql(args);
      if (sql.includes("pg_try_advisory_xact_lock")) return [{ locked: true }];
      return [];
    },
    leadInventoryFacetBuild: {
      findMany: async () => [
        {
          id: "lifb_stale",
          createdAt: staleCreatedAt,
          status: LeadInventoryFacetBuildStatus.building,
        },
      ],
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        updates.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data };
        createdRows.push(row);
        return row;
      },
    },
  };

  const result = await claimFacetSnapshotRebuild({
    db: db as never,
    ageBandVersion: "v1",
    buildId: "lifb_new",
    evaluatedAt: new Date(),
  });
  assert.equal(result.claimed, true);
  if (!result.claimed) return;
  assert.equal(result.buildId, "lifb_new");
  assert.deepEqual(result.recoveredStaleBuildIds, ["lifb_stale"]);
  assert.equal(updates[0]?.failureCode, "stale_build_recovered");
  assert.equal(updates[0]?.status, LeadInventoryFacetBuildStatus.failed);
  assert.equal(createdRows[0]?.status, LeadInventoryFacetBuildStatus.building);
  assert.equal(createdRows[0]?.id, "lifb_new");
});

test("rebuild SQL path uses INSERT aggregate and inventory sourceLane proof_lane", async () => {
  const sqlCalls: string[] = [];
  let created: Record<string, unknown> | null = null;
  let statusUpdates: Array<Record<string, unknown>> = [];

  const ageBands = [
    {
      key: "FRESH_0_7",
      label: "0–7 days",
      minDaysInclusive: 0,
      maxDaysExclusive: 8,
      sortOrder: 10,
    },
  ];

  const db: any = {
    $queryRaw: async (...args: unknown[]) => {
      const sql = flattenQueryRawSql(args);
      sqlCalls.push(sql);
      if (sql.includes("pg_try_advisory_xact_lock")) return [{ locked: true }];
      if (/pg_try_advisory_lock(?!_xact)|pg_advisory_lock\(|pg_advisory_unlock/.test(sql)) {
        throw new Error("session_advisory_lock_must_not_be_used");
      }
      if (sql.includes("COUNT(*)") && sql.includes("sum_total")) {
        return [
          {
            row_count: 1,
            sum_total: 2,
            sum_available: 1,
            sum_reserved: 0,
            sum_blocked: 1,
            negative_rows: 0,
            partition_violations: 0,
            blank_state_rows: 0,
            bad_age_rows: 0,
          },
        ];
      }
      if (sql.includes("DISTINCT") && sql.includes("ageBandKey")) {
        return [{ ageBandKey: "FRESH_0_7" }];
      }
      if (sql.includes("HAVING COUNT(*) > 1")) return [{ dupe_count: 0 }];
      if (sql.includes("inventory_count")) return [{ inventory_count: 2 }];
      return [];
    },
    $executeRaw: async (...args: unknown[]) => {
      sqlCalls.push(flattenQueryRawSql(args));
      return 1;
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    leadAgeBandDefinition: {
      findMany: async () => ageBands,
    },
    leadInventoryFacetBuild: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = { ...data, aggregateRowCount: 0 };
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        statusUpdates.push({ id: where.id, ...data });
        if (created && created.id === where.id) Object.assign(created, data);
        return created;
      },
      findUnique: async ({ where: { id } }: { where: { id: string } }) => {
        if (created && created.id === id) return created;
        return null;
      },
      findFirst: async ({
        where,
      }: {
        where: { ageBandVersion?: string; status?: LeadInventoryFacetBuildStatus };
      }) => {
        if (
          created &&
          created.status === LeadInventoryFacetBuildStatus.active &&
          (!where.ageBandVersion || created.ageBandVersion === where.ageBandVersion)
        ) {
          return { id: created.id as string };
        }
        // After validation, activate path looks for previous active — none.
        if (where.status === LeadInventoryFacetBuildStatus.active) return null;
        return null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: LeadInventoryFacetBuildStatus; validationOk?: boolean };
        data: Record<string, unknown>;
      }) => {
        if (!created || created.id !== where.id) return { count: 0 };
        if (created.status !== where.status) return { count: 0 };
        Object.assign(created, data);
        statusUpdates.push({ id: where.id, ...data });
        return { count: 1 };
      },
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
  };

  const result = await rebuildLeadInventoryFacetSupplySnapshot({
    db: db as never,
    ageBandVersion: "v1",
    skipIfLocked: true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "active");
  assert.equal(result.inventoryCount, 2);
  assert.equal(result.aggregateRowCount, 1);
  assert.ok(result.buildDurationMs >= 0);

  const insertSql = sqlCalls.find((s) => s.includes("INSERT INTO") && s.includes("LeadInventoryFacetSupplyAggregate"));
  assert.ok(insertSql);
  assert.match(insertSql!, /LOWER\(TRIM\(BOTH FROM i\."sourceLane"\)\)/i);
  assert.match(insertSql!, /leadcapture_io/);
  assert.equal(/enrichmentMetadataJson/i.test(insertSql!), false);
  assert.equal(/findMany/i.test(insertSql!), false);
  assert.ok(sqlCalls.some((s) => s.includes("pg_try_advisory_xact_lock")));
  assert.equal(
    sqlCalls.some((s) =>
      /pg_try_advisory_lock(?!_xact)|pg_advisory_lock\(|pg_advisory_unlock/.test(s)
    ),
    false
  );
  assert.ok(statusUpdates.some((u) => u.status === LeadInventoryFacetBuildStatus.validated));
  assert.ok(statusUpdates.some((u) => u.status === LeadInventoryFacetBuildStatus.active));
});

test("invalid build validation failure does not activate", async () => {
  const sqlCalls: string[] = [];
  let created: Record<string, unknown> | null = null;

  const db: any = {
    $queryRaw: async (...args: unknown[]) => {
      const sql = flattenQueryRawSql(args);
      sqlCalls.push(sql);
      if (sql.includes("pg_try_advisory_xact_lock")) return [{ locked: true }];
      if (sql.includes("sum_total")) {
        return [
          {
            row_count: 1,
            sum_total: 5,
            sum_available: 1,
            sum_reserved: 1,
            sum_blocked: 1, // 1+1+1 != 5 → aggregate invariant fail
            negative_rows: 0,
            partition_violations: 0,
            blank_state_rows: 0,
            bad_age_rows: 0,
          },
        ];
      }
      return [];
    },
    $executeRaw: async () => 1,
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    leadAgeBandDefinition: {
      findMany: async () => [
        {
          key: "FRESH_0_7",
          label: "0–7",
          minDaysInclusive: 0,
          maxDaysExclusive: 8,
          sortOrder: 10,
        },
      ],
    },
    leadInventoryFacetBuild: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = { ...data };
        return created;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(created!, data);
        return created;
      },
      findUnique: async () => created,
    },
  };

  const result = await rebuildLeadInventoryFacetSupplySnapshot({
    db: db as never,
    skipIfLocked: true,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "failed");
  assert.equal(result.failureCode, "aggregate_partition_invariant");
  assert.equal((created as { status?: string } | null)?.status, LeadInventoryFacetBuildStatus.failed);
  assert.equal((created as { validationOk?: boolean } | null)?.validationOk, false);
});

test("snapshot reader rolls up via SQL group by and respects freshness", async () => {
  const prevMax = process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_MAX_AGE_MINUTES;
  const prevWarn = process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_STALE_WARN_MINUTES;
  process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_MAX_AGE_MINUTES = "30";
  process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_STALE_WARN_MINUTES = "15";
  try {
    const evaluatedAt = new Date();
    const capturedSql: string[] = [];
    const db = {
      leadInventoryFacetBuild: {
        findFirst: async () => ({
          id: "active_1",
          ageBandVersion: "v1",
          evaluatedAt,
          activatedAt: evaluatedAt,
          status: LeadInventoryFacetBuildStatus.active,
          validationOk: true,
          inventoryCount: 3,
          aggregateRowCount: 2,
        }),
      },
      $queryRaw: async (...args: unknown[]) => {
        const sql = flattenQueryRawSql(args);
        capturedSql.push(sql);
        return [
          {
            state: "NC",
            age_band_key: "FRESH_0_7",
            total: 3,
            available: 2,
            reserved: 0,
            blocked: 1,
          },
        ];
      },
    };

    const ok = await readActiveFacetSnapshotSupply({ nicheKey: "vet" }, db as never);
    assert.equal(ok.ok, true, ok.ok ? "ok" : `reason=${ok.reason} detail=${ok.detail ?? ""} sql=${capturedSql[0] ?? ""}`);
    if (!ok.ok) return;
    assert.equal(ok.rows[0]?.total, 3);
    assert.equal(ok.isStale, false);
    assert.match(capturedSql[0] ?? "", /GROUP BY a\."normalizedState", a\."ageBandKey"/i);
    assert.match(capturedSql[0] ?? "", /SUM\(a\.total\)/i);
    const filterSql = flattenQueryRawSql([
      __facetSnapshotTestUtils.buildSnapshotFilterSql({ nicheKey: "vet" }),
    ]);
    assert.match(filterSql, /nicheKey/i);

    const staleDb = {
      leadInventoryFacetBuild: {
        findFirst: async () => ({
          id: "active_old",
          ageBandVersion: "v1",
          evaluatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          activatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          status: LeadInventoryFacetBuildStatus.active,
          validationOk: true,
          inventoryCount: 3,
          aggregateRowCount: 1,
        }),
      },
      $queryRaw: async () => [],
    };
    const stale = await readActiveFacetSnapshotSupply({}, staleDb as never);
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.reason, "stale_beyond_max_age");
  } finally {
    if (prevMax === undefined) delete process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_MAX_AGE_MINUTES;
    else process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_MAX_AGE_MINUTES = prevMax;
    if (prevWarn === undefined) delete process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_STALE_WARN_MINUTES;
    else process.env.SA360_LEAD_INVENTORY_FACET_SNAPSHOT_STALE_WARN_MINUTES = prevWarn;
  }
});

test("cleanup retains active and recent successful builds", async () => {
  const deleted: string[] = [];
  const db = {
    leadInventoryFacetBuild: {
      findMany: async ({
        where,
      }: {
        where: { status?: { in?: LeadInventoryFacetBuildStatus[] } | LeadInventoryFacetBuildStatus };
      }) => {
        const statusFilter = where.status;
        if (
          statusFilter &&
          typeof statusFilter === "object" &&
          "in" in statusFilter &&
          statusFilter.in?.includes(LeadInventoryFacetBuildStatus.active)
        ) {
          return [
            { id: "active", status: LeadInventoryFacetBuildStatus.active },
            { id: "retired_1", status: LeadInventoryFacetBuildStatus.retired },
            { id: "retired_2", status: LeadInventoryFacetBuildStatus.retired },
            { id: "retired_3", status: LeadInventoryFacetBuildStatus.retired },
            { id: "retired_4", status: LeadInventoryFacetBuildStatus.retired },
          ];
        }
        if (statusFilter === LeadInventoryFacetBuildStatus.failed) {
          return [{ id: "failed_1" }, { id: "failed_2" }, { id: "failed_old" }];
        }
        // obsolete candidates
        return [
          { id: "retired_4" },
          { id: "failed_old" },
          { id: "retired_3" },
        ];
      },
      deleteMany: async ({ where: { id } }: { where: { id: { in: string[] } } }) => {
        deleted.push(...id.in);
        return { count: id.in.length };
      },
    },
  };

  const result = await cleanupFacetSnapshotBuilds({
    db: db as never,
    successfulRetention: 3,
    failedRetention: 2,
  });
  assert.ok(result.deletedBuilds >= 1);
  assert.ok(!deleted.includes("active"));
  assert.ok(deleted.includes("retired_4") || deleted.includes("failed_old"));
});
