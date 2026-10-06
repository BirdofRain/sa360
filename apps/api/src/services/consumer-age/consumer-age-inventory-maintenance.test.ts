import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  CONSUMER_AGE_BACKFILL_CONFIRMATION,
  CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
  CONSUMER_AGE_INVENTORY_REPORT_SCHEMA,
  commitConsumerAgeBackfill,
  commitConsumerAgeOverMaximumClassification,
  previewConsumerAgeInventory,
  resolveConsumerAgeMaintenanceScope,
} from "./consumer-age-inventory-maintenance.service.js";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/sa360_test";

type FakeRow = {
  id: string;
  generatedAt: Date;
  status: string;
  nicheKey: string;
  sourceProvider: string;
  sourceLane: string;
  commerceExcludedAt: Date | null;
  metadataJson: unknown;
  lotKey: string;
  sourceSystem: string;
  normalizedPayloadJson: unknown;
  rawPayloadJson: unknown;
  enrichmentMetadataJson?: unknown;
  allocations?: number;
};

type ScanRow = ReturnType<typeof toScanRow>;

function toScanRow(row: FakeRow) {
  return {
    id: row.id,
    generatedAt: row.generatedAt,
    status: row.status,
    nicheKey: row.nicheKey,
    sourceProvider: row.sourceProvider,
    sourceLane: row.sourceLane,
    commerceExcludedAt: row.commerceExcludedAt,
    metadataJson: row.metadataJson,
    inventoryLotId: `lot_${row.lotKey}`,
    inventoryLot: { lotKey: row.lotKey },
    sourceLeadEvent: {
      id: `evt-${row.id}`,
      sourceSystem: row.sourceSystem,
      normalizedPayloadJson: row.normalizedPayloadJson,
      rawPayloadJson: row.rawPayloadJson,
      enrichmentMetadataJson: row.enrichmentMetadataJson ?? {},
    },
    _count: { leadAllocations: row.allocations ?? 0 },
  };
}

type CursorOr = Array<{ generatedAt?: { gt?: Date } | Date; id?: { gt?: string } }>;

/** Keyset `(generatedAt, id)` predicate the service builds for its traversal. */
function isCursorOr(or: unknown): or is CursorOr {
  return (
    Array.isArray(or) &&
    or.some((entry) => entry && typeof entry === "object" && "generatedAt" in entry)
  );
}

function afterCursor(rows: ScanRow[], or: CursorOr): ScanRow[] {
  const gt = or.find((entry) => entry.generatedAt && typeof entry.generatedAt === "object");
  const cursorGen = (gt?.generatedAt as { gt?: Date } | undefined)?.gt;
  const tie = or.find((entry) => entry.id != null);
  const cursorId = (tie?.id as { gt?: string } | undefined)?.gt;
  if (!cursorGen) return rows;
  return rows.filter((row) => {
    if (row.generatedAt.getTime() > cursorGen.getTime()) return true;
    return Boolean(
      cursorId && row.generatedAt.getTime() === cursorGen.getTime() && row.id > cursorId
    );
  });
}

/**
 * Apply the predicate dimensions the traversal actually depends on: the keyset
 * cursor (seeded on the scope and advanced per page) and the `generatedAt`
 * shard bounds. Niche/status/lot clauses are satisfied by the fixtures.
 */
function applyWhere(rows: ScanRow[], where: unknown): ScanRow[] {
  if (!where || typeof where !== "object") return rows;
  const node = where as Record<string, unknown>;
  let out = rows;
  if (Array.isArray(node.AND)) {
    for (const entry of node.AND) out = applyWhere(out, entry);
  }
  if (isCursorOr(node.OR)) out = afterCursor(out, node.OR as CursorOr);
  const generatedAt = node.generatedAt as { gte?: Date; lte?: Date } | undefined;
  if (generatedAt && typeof generatedAt === "object") {
    if (generatedAt.gte instanceof Date) {
      const from = generatedAt.gte.getTime();
      out = out.filter((row) => row.generatedAt.getTime() >= from);
    }
    if (generatedAt.lte instanceof Date) {
      const to = generatedAt.lte.getTime();
      out = out.filter((row) => row.generatedAt.getTime() <= to);
    }
  }
  return out;
}

function buildFakeDb(fakeRows: FakeRow[]) {
  const sorted = fakeRows
    .map(toScanRow)
    .sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime() || a.id.localeCompare(b.id));
  const updatedEventIds: string[] = [];
  const classifiedIds: string[] = [];
  let findManyCalls = 0;

  const db = {
    leadInventoryItem: {
      count: async (args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        if (where.commerceExcludedReason != null) return 0;
        return applyWhere(sorted, where).length;
      },
      findMany: async (args: { where: Record<string, unknown>; take: number }) => {
        findManyCalls += 1;
        return applyWhere(sorted, args.where).slice(0, args.take);
      },
      update: async () => {
        throw new Error("unconditional_update_not_allowed");
      },
      updateMany: async ({ where }: { where: { id: string } }) => {
        classifiedIds.push(where.id);
        return { count: 1 };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = sorted.find((candidate) => candidate.id === where.id);
        if (!row) return null;
        return {
          id: row.id,
          metadataJson: row.metadataJson,
          sourceLeadEvent: row.sourceLeadEvent,
        };
      },
    },
    leadAllocation: {
      count: async ({ where }: { where: { leadInventoryItemId: string } }) => {
        const row = sorted.find((candidate) => candidate.id === where.leadInventoryItemId);
        return row?._count.leadAllocations ?? 0;
      },
    },
    sourceLeadEvent: {
      update: async ({ where }: { where: { id: string } }) => {
        updatedEventIds.push(where.id);
        return {};
      },
    },
    $queryRaw: async (_strings: unknown, itemId: string) => {
      const row = sorted.find((candidate) => candidate.id === itemId);
      if (!row) return [];
      return [
        {
          id: row.id,
          status: row.status,
          commerceExcludedAt: row.commerceExcludedAt,
          metadataJson: row.metadataJson,
          normalizedPayloadJson: row.sourceLeadEvent.normalizedPayloadJson,
          rawPayloadJson: row.sourceLeadEvent.rawPayloadJson,
          enrichmentMetadataJson: row.sourceLeadEvent.enrichmentMetadataJson,
        },
      ];
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  // backfillStoredConsumerAges reads via leadInventoryItem.findMany with an id filter.
  const originalFindMany = db.leadInventoryItem.findMany;
  db.leadInventoryItem.findMany = async (args: {
    where: Record<string, unknown>;
    take?: number;
  }) => {
    const idFilter = (args.where as { id?: { in?: string[] } }).id?.in;
    if (idFilter) {
      return sorted
        .filter((row) => idFilter.includes(row.id))
        .map((row) => ({
          id: row.id,
          metadataJson: row.metadataJson,
          sourceLeadEvent: row.sourceLeadEvent,
        })) as never;
    }
    return originalFindMany(args as { where: Record<string, unknown>; take: number });
  };

  return {
    db: db as unknown as PrismaClient,
    getUpdatedEventIds: () => updatedEventIds,
    getClassifiedIds: () => classifiedIds,
    getFindManyCalls: () => findManyCalls,
    /** Mark a row commerce-excluded so a repeat pass sees what Postgres would. */
    excludeRow: (id: string, at: Date) => {
      const row = sorted.find((candidate) => candidate.id === id);
      if (row) row.commerceExcludedAt = at;
    },
  };
}

function vetRow(input: Partial<FakeRow> & { id: string }): FakeRow {
  return {
    generatedAt: new Date("2026-05-01T00:00:00.000Z"),
    status: "available",
    nicheKey: "veteran",
    sourceProvider: "manual_import",
    sourceLane: "aged_inventory_csv",
    commerceExcludedAt: null,
    metadataJson: {},
    lotKey: "lot-a",
    sourceSystem: "csv_import",
    normalizedPayloadJson: {},
    rawPayloadJson: {},
    ...input,
  };
}

const EVALUATED_AT = new Date("2026-06-15T00:00:00.000Z");

describe("consumer age maintenance scope", () => {
  it("defaults to the canonical life-insurance niches and expands every alias", () => {
    const scope = resolveConsumerAgeMaintenanceScope();
    assert.deepEqual(scope.nicheKeys, ["vet", "nurse", "trucker"]);
    assert.equal(scope.nicheAliases.includes("veteran"), true);
    assert.equal(scope.nicheAliases.includes("vet_fex"), true);
    assert.equal(scope.nicheAliases.includes("nurse"), true);
    assert.equal(scope.nicheAliases.includes("trucker"), true);
    assert.deepEqual(scope.statuses, ["available", "pending_review"]);
    assert.equal(scope.activeLotOnly, true);
    assert.equal(scope.includeCommerceExcluded, false);
  });

  it("defaults maxScanRows to the module ceiling and honours a smaller bound", () => {
    assert.equal(resolveConsumerAgeMaintenanceScope().maxScanRows, 50_000);
    assert.equal(resolveConsumerAgeMaintenanceScope({ maxScanRows: 10 }).maxScanRows, 10);
    assert.equal(resolveConsumerAgeMaintenanceScope({ maxScanRows: "250" }).maxScanRows, 250);
  });
});

describe("consumer age inventory preview", () => {
  const rows = [
    vetRow({
      id: "canonical-62",
      normalizedPayloadJson: { lead_details: { consumer_age: "62" } },
      generatedAt: new Date("2026-04-02T00:00:00.000Z"),
    }),
    vetRow({
      id: "raw-70",
      rawPayloadJson: { master: { dob_age_raw: "70" } },
      generatedAt: new Date("2026-04-03T00:00:00.000Z"),
    }),
    vetRow({
      id: "metadata-64",
      metadataJson: { consumer_age: "64" },
      generatedAt: new Date("2026-05-04T00:00:00.000Z"),
    }),
    vetRow({
      id: "enrichment-dob",
      enrichmentMetadataJson: { sourceAttributes: { date_of_birth: "1950-01-02" } },
      generatedAt: new Date("2026-05-05T00:00:00.000Z"),
    }),
    vetRow({ id: "no-age", generatedAt: new Date("2026-05-06T00:00:00.000Z") }),
    vetRow({
      id: "invalid-age",
      rawPayloadJson: { consumer_age: "not-an-age" },
      generatedAt: new Date("2026-05-07T00:00:00.000Z"),
    }),
    vetRow({
      id: "over-max-87",
      normalizedPayloadJson: { lead_details: { consumer_age: "87" } },
      generatedAt: new Date("2026-05-08T00:00:00.000Z"),
    }),
    vetRow({
      id: "over-max-allocated",
      normalizedPayloadJson: { lead_details: { consumer_age: "90" } },
      allocations: 1,
      generatedAt: new Date("2026-05-09T00:00:00.000Z"),
    }),
    vetRow({
      id: "conflict",
      normalizedPayloadJson: { lead_details: { consumer_age: "55" } },
      rawPayloadJson: { date_of_birth: "1950-01-02" },
      generatedAt: new Date("2026-05-10T00:00:00.000Z"),
    }),
  ];

  it("classifies every recovery source, conflict, and dead candidate", async () => {
    const { db, getUpdatedEventIds } = buildFakeDb(rows);
    const report = await previewConsumerAgeInventory({ evaluatedAt: EVALUATED_AT }, db);

    assert.equal(report.schema, CONSUMER_AGE_INVENTORY_REPORT_SCHEMA);
    assert.equal(report.mode, "preview");
    assert.equal(report.totals.activeSellableInventory, rows.length);
    assert.equal(report.totals.ageAlreadyNormalized, 4);
    assert.equal(report.totals.recoverableFromRawPayload, 2);
    assert.equal(report.totals.recoverableFromMetadata, 1);
    assert.equal(report.totals.recoverableFromEnrichment, 1);
    assert.equal(report.totals.recoverableTotal, 4);
    assert.equal(report.totals.noAgeSource, 1);
    assert.equal(report.totals.invalidAgeSource, 1);
    assert.equal(report.totals.ageOverMaximum, 2);
    assert.equal(report.totals.dateOfBirthRecoverable, 2);
    assert.equal(report.totals.canonicalConflicts, 1);
    assert.equal(report.totals.deadClassificationCandidates, 1);
    assert.equal(report.totals.deadClassificationBlockedByAllocation, 1);
    assert.equal(report.policy.maximumSellableAge, 86);
    assert.equal(report.policy.consumerAgeDerivedFromLeadGeneratedAt, false);
    assert.equal(report.coverage, "complete");
    assert.equal(report.nextCursor, null);
    assert.deepEqual(getUpdatedEventIds(), []);
  });

  it("reports only ages the backfill would actually write", async () => {
    const { db } = buildFakeDb(rows);
    const report = await previewConsumerAgeInventory({ evaluatedAt: EVALUATED_AT }, db);
    // raw-70, metadata-64, enrichment-dob need an age. The conflict row has a
    // recoverable DOB but is held back, so it is not a backfill candidate.
    assert.equal(report.totals.backfillCandidates, 3);
    assert.equal(report.totals.conflictHolds, 1);
  });

  it("breaks totals down by niche, provider, system, lane, lot, and generated month", async () => {
    const mixed = [
      vetRow({ id: "a", nicheKey: "vet", lotKey: "lot-a", generatedAt: new Date("2026-04-02T00:00:00.000Z") }),
      vetRow({
        id: "b",
        nicheKey: "nurse",
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceLane: "leadcapture_io",
        lotKey: "lot-b",
        generatedAt: new Date("2026-05-02T00:00:00.000Z"),
      }),
    ];
    const { db } = buildFakeDb(mixed);
    const report = await previewConsumerAgeInventory({ evaluatedAt: EVALUATED_AT }, db);
    assert.deepEqual(
      report.breakdown.byNiche.map((bucket) => bucket.key).sort(),
      ["nurse", "vet"]
    );
    assert.deepEqual(
      report.breakdown.bySourceProvider.map((bucket) => bucket.key).sort(),
      ["facebook", "manual_import"]
    );
    assert.deepEqual(
      report.breakdown.bySourceSystem.map((bucket) => bucket.key).sort(),
      ["csv_import", "meta_lead_ads"]
    );
    assert.deepEqual(
      report.breakdown.bySourceLane.map((bucket) => bucket.key).sort(),
      ["aged_inventory_csv", "leadcapture_io"]
    );
    // The lot dimension carries both identifiers so an operator can feed
    // `--inventory-lot-id` straight back in without translating anything.
    assert.deepEqual(
      report.breakdown.byInventoryLot
        .map((bucket) => [bucket.key, bucket.inventoryLotId, bucket.lotKey])
        .sort(),
      [
        ["lot_lot-a", "lot_lot-a", "lot-a"],
        ["lot_lot-b", "lot_lot-b", "lot-b"],
      ]
    );
    assert.deepEqual(
      report.breakdown.byGeneratedMonth.map((bucket) => bucket.key),
      ["2026-04", "2026-05"]
    );
  });

  it("never emits consumer payload values", async () => {
    const { db } = buildFakeDb([
      vetRow({
        id: "pii",
        normalizedPayloadJson: {
          contact: {
            first_name: "Jonathon",
            last_name: "Cruz",
            email: "jonathon.cruz@example.test",
            phone_e164: "+15550001234",
          },
          lead_details: { consumer_age: "62" },
        },
      }),
    ]);
    const report = await previewConsumerAgeInventory({ evaluatedAt: EVALUATED_AT }, db);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("Jonathon"), false);
    assert.equal(serialized.includes("Cruz"), false);
    assert.equal(serialized.includes("@example.test"), false);
    assert.equal(serialized.includes("+1555"), false);
  });

  it("flags a truncated scan instead of silently reporting partial totals", async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      vetRow({
        id: `row-${String(index).padStart(2, "0")}`,
        generatedAt: new Date(Date.UTC(2026, 3, index + 1)),
      })
    );
    const { db } = buildFakeDb(many);
    const report = await previewConsumerAgeInventory(
      { evaluatedAt: EVALUATED_AT, maxScanRows: 5 },
      db
    );
    assert.equal(report.scan.matchingRows, 12);
    assert.equal(report.scan.rowsScanned, 5);
    assert.equal(report.scan.scanCeilingHit, true);
    assert.equal(report.coverage, "partial");
    assert.notEqual(report.nextCursor, null);
    assert.equal(report.summary.startsWith("Scan safety cap reached"), true);
  });
});

describe("consumer age resumable cursor traversal", () => {
  const twelveRows = Array.from({ length: 12 }, (_, index) =>
    vetRow({
      id: `row-${String(index).padStart(2, "0")}`,
      generatedAt: new Date(Date.UTC(2026, 3, index + 1)),
    })
  );

  it("chains three invocations across 12 rows without skipping or repeating one", async () => {
    const { db } = buildFakeDb(twelveRows);
    const seen: string[][] = [];
    let cursor: { afterGeneratedAt: string; afterId: string } | null = null;
    const coverages: string[] = [];

    for (let invocation = 0; invocation < 3; invocation += 1) {
      const report = await previewConsumerAgeInventory(
        { evaluatedAt: EVALUATED_AT, maxScanRows: 5, cursor },
        db
      );
      coverages.push(report.coverage);
      seen.push(
        twelveRows
          .filter((row) => {
            const from = cursor ? new Date(cursor.afterGeneratedAt).getTime() : -Infinity;
            return row.generatedAt.getTime() > from;
          })
          .slice(0, report.scan.rowsScanned)
          .map((row) => row.id)
      );
      cursor = report.nextCursor;
      if (invocation === 0) {
        assert.equal(report.scan.rowsScanned, 5);
        assert.equal(report.scan.matchingRows, 12);
      }
      if (invocation === 1) {
        assert.equal(report.scan.rowsScanned, 5);
        // Only the rows still ahead of the seed cursor are counted as matching.
        assert.equal(report.scan.matchingRows, 7);
      }
      if (invocation === 2) {
        assert.equal(report.scan.rowsScanned, 2);
        assert.equal(report.scan.matchingRows, 2);
      }
    }

    assert.deepEqual(coverages, ["partial", "partial", "complete"]);
    assert.equal(cursor, null);

    const processed = seen.flat();
    assert.equal(processed.length, 12);
    assert.equal(new Set(processed).size, 12);
    assert.deepEqual(
      processed,
      twelveRows.map((row) => row.id)
    );
  });

  it("reports complete coverage with a null cursor when the scope fits in one pass", async () => {
    const { db } = buildFakeDb(twelveRows);
    const report = await previewConsumerAgeInventory(
      { evaluatedAt: EVALUATED_AT, maxScanRows: 50 },
      db
    );
    assert.equal(report.scan.rowsScanned, 12);
    assert.equal(report.scan.scanCeilingHit, false);
    assert.equal(report.coverage, "complete");
    assert.equal(report.nextCursor, null);
  });

  it("never reports complete when the ceiling exactly equals the matching rows", async () => {
    const { db } = buildFakeDb(twelveRows);
    const report = await previewConsumerAgeInventory(
      { evaluatedAt: EVALUATED_AT, maxScanRows: 12 },
      db
    );
    // Twelve rows read under a twelve-row ceiling proves nothing about row 13,
    // so the window stays partial and the cursor must be chained.
    assert.equal(report.scan.rowsScanned, 12);
    assert.equal(report.coverage, "partial");
    assert.deepEqual(report.nextCursor, {
      afterGeneratedAt: twelveRows[11]!.generatedAt.toISOString(),
      afterId: "row-11",
    });
  });

  it("shards by generatedAt without raising the row cap", async () => {
    const spread = [
      vetRow({ id: "jan", generatedAt: new Date("2026-01-10T00:00:00.000Z") }),
      vetRow({ id: "feb", generatedAt: new Date("2026-02-10T00:00:00.000Z") }),
      vetRow({ id: "mar", generatedAt: new Date("2026-03-10T00:00:00.000Z") }),
    ];
    const { db } = buildFakeDb(spread);
    const february = await previewConsumerAgeInventory(
      {
        evaluatedAt: EVALUATED_AT,
        generatedAtFrom: "2026-02-01T00:00:00.000Z",
        generatedAtTo: "2026-02-28T23:59:59.999Z",
      },
      db
    );
    assert.equal(february.scan.matchingRows, 1);
    assert.equal(february.scan.rowsScanned, 1);
    assert.equal(february.coverage, "complete");
    assert.deepEqual(february.breakdown.byGeneratedMonth.map((b) => b.key), ["2026-02"]);
    assert.equal(february.scope.generatedAtFrom, "2026-02-01T00:00:00.000Z");
    assert.equal(february.scope.generatedAtTo, "2026-02-28T23:59:59.999Z");
  });
});

describe("consumer age maintenance input validation", () => {
  it("refuses a non-numeric row bound instead of scanning zero rows", () => {
    for (const bad of ["abc", "0", "-5", "1.5", "1e3"]) {
      assert.throws(
        () => resolveConsumerAgeMaintenanceScope({ maxScanRows: bad }),
        /maxScanRows:expected_positive_integer/,
        `expected ${bad} to be refused`
      );
    }
  });

  it("refuses a row bound above the per-invocation ceiling", () => {
    assert.throws(
      () => resolveConsumerAgeMaintenanceScope({ maxScanRows: "50001" }),
      /maxScanRows:exceeds_maximum_50000/
    );
  });

  it("refuses a half-specified cursor and a malformed instant", () => {
    assert.throws(
      () =>
        resolveConsumerAgeMaintenanceScope({
          cursor: { afterGeneratedAt: "2026-04-01T00:00:00.000Z", afterId: "" },
        }),
      /cursor:requires_after_generated_at_and_after_id/
    );
    assert.throws(
      () => resolveConsumerAgeMaintenanceScope({ generatedAtFrom: "not-a-date" }),
      /generatedAtFrom:expected_iso_instant/
    );
  });

  it("refuses an inverted shard window", () => {
    assert.throws(
      () =>
        resolveConsumerAgeMaintenanceScope({
          generatedAtFrom: "2026-03-01T00:00:00.000Z",
          generatedAtTo: "2026-02-01T00:00:00.000Z",
        }),
      /generatedAtFrom:after_generated_at_to/
    );
  });

  it("refuses a commit whose scope is malformed rather than writing an unintended window", async () => {
    const { db, getUpdatedEventIds } = buildFakeDb([
      vetRow({ id: "raw-70", rawPayloadJson: { consumer_age: "70" } }),
    ]);
    const result = await commitConsumerAgeBackfill(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
        limit: 10,
        scope: { maxScanRows: "abc" },
      },
      db
    );
    assert.equal(result.outcome, "REFUSED");
    assert.equal(result.reasonCode, "scope_invalid");
    assert.equal(result.writesAttempted, false);
    assert.deepEqual(getUpdatedEventIds(), []);
  });
});

describe("consumer age commit guards", () => {
  const rows = [vetRow({ id: "raw-70", rawPayloadJson: { consumer_age: "70" } })];

  it("refuses a backfill without the exact confirmation phrase", async () => {
    const { db, getUpdatedEventIds } = buildFakeDb(rows);
    const result = await commitConsumerAgeBackfill(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: "backfill please",
        limit: 10,
      },
      db
    );
    assert.equal(result.outcome, "REFUSED");
    assert.equal(result.reasonCode, "confirmation_mismatch");
    assert.equal(result.writesAttempted, false);
    assert.deepEqual(getUpdatedEventIds(), []);
  });

  it("refuses when the database host does not match the operator's expectation", async () => {
    const { db, getUpdatedEventIds } = buildFakeDb(rows);
    const result = await commitConsumerAgeBackfill(
      {
        expectedDbHost: "db.production.example",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
        limit: 10,
      },
      db
    );
    assert.equal(result.outcome, "REFUSED");
    assert.equal(result.reasonCode, "db_host_mismatch");
    assert.deepEqual(getUpdatedEventIds(), []);
  });

  it("refuses an unbounded backfill", async () => {
    const { db } = buildFakeDb(rows);
    for (const limit of [0, -1, 1.5]) {
      const result = await commitConsumerAgeBackfill(
        {
          expectedDbHost: "127.0.0.1:5432",
          databaseUrl: LOCAL_DB_URL,
          operator: "ops",
          confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
          limit,
        },
        db
      );
      assert.equal(result.reasonCode, "limit_required");
    }
  });

  it("refuses a dead classification that uses the backfill confirmation phrase", async () => {
    const { db, getClassifiedIds } = buildFakeDb(rows);
    const result = await commitConsumerAgeOverMaximumClassification(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
        limit: 10,
      },
      db
    );
    assert.equal(result.outcome, "REFUSED");
    assert.equal(result.reasonCode, "confirmation_mismatch");
    assert.deepEqual(getClassifiedIds(), []);
  });
});

describe("consumer age backfill commit", () => {
  it("writes only recovered ages, stays bounded, and reports conflicts", async () => {
    const rows = [
      vetRow({
        id: "raw-70",
        rawPayloadJson: { consumer_age: "70" },
        generatedAt: new Date("2026-04-01T00:00:00.000Z"),
      }),
      vetRow({
        id: "metadata-64",
        metadataJson: { consumer_age: "64" },
        generatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
      vetRow({
        id: "no-age",
        generatedAt: new Date("2026-04-03T00:00:00.000Z"),
      }),
      vetRow({
        id: "already",
        normalizedPayloadJson: { lead_details: { consumer_age: "62" } },
        generatedAt: new Date("2026-04-04T00:00:00.000Z"),
      }),
    ];
    const { db, getUpdatedEventIds } = buildFakeDb(rows);
    const result = await commitConsumerAgeBackfill(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
        limit: 1,
        scope: { evaluatedAt: EVALUATED_AT },
      },
      db
    );
    assert.equal(result.outcome, "BACKFILLED");
    assert.equal(result.ok, true);
    assert.deepEqual(result.updatedIds, ["raw-70"]);
    assert.equal(result.candidatesWritten, 1);
    assert.equal(result.candidatesInScannedWindow, 2);
    assert.equal(result.totals?.backfillCandidates, 2);
    // The whole window was traversed, so the workload itself is complete even
    // though the per-invocation write limit only repaired one row.
    assert.equal(result.coverage, "complete");
    assert.equal(result.nextCursor, null);
    assert.deepEqual(getUpdatedEventIds(), ["evt-raw-70"]);
  });

  it("resumes after the previous cohort instead of re-reading page one", async () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      vetRow({
        id: `raw-${String(index).padStart(2, "0")}`,
        rawPayloadJson: { consumer_age: "70" },
        generatedAt: new Date(Date.UTC(2026, 3, index + 1)),
      })
    );
    const { db, getUpdatedEventIds } = buildFakeDb(rows);

    const guard = {
      expectedDbHost: "127.0.0.1:5432",
      databaseUrl: LOCAL_DB_URL,
      operator: "ops",
      confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
      limit: 2,
    };

    const first = await commitConsumerAgeBackfill(
      { ...guard, scope: { evaluatedAt: EVALUATED_AT, maxScanRows: 2 } },
      db
    );
    assert.deepEqual(first.updatedIds, ["raw-00", "raw-01"]);
    assert.equal(first.coverage, "partial");
    assert.notEqual(first.nextCursor, null);

    const second = await commitConsumerAgeBackfill(
      {
        ...guard,
        scope: { evaluatedAt: EVALUATED_AT, maxScanRows: 2, cursor: first.nextCursor },
      },
      db
    );
    assert.deepEqual(second.updatedIds, ["raw-02", "raw-03"]);
    assert.equal(second.coverage, "partial");

    const third = await commitConsumerAgeBackfill(
      {
        ...guard,
        scope: { evaluatedAt: EVALUATED_AT, maxScanRows: 2, cursor: second.nextCursor },
      },
      db
    );
    assert.deepEqual(third.updatedIds, ["raw-04", "raw-05"]);

    const fourth = await commitConsumerAgeBackfill(
      {
        ...guard,
        scope: { evaluatedAt: EVALUATED_AT, maxScanRows: 2, cursor: third.nextCursor },
      },
      db
    );
    assert.equal(fourth.coverage, "complete");
    assert.equal(fourth.nextCursor, null);
    assert.equal(fourth.candidatesWritten, 0);

    // Six distinct rows repaired across a ceiling of two rows per invocation —
    // traversal continues past the cap and no row is written twice.
    assert.deepEqual(getUpdatedEventIds(), [
      "evt-raw-00",
      "evt-raw-01",
      "evt-raw-02",
      "evt-raw-03",
      "evt-raw-04",
      "evt-raw-05",
    ]);
  });

  it("holds a canonical age that conflicts with an explicit date of birth", async () => {
    const rows = [
      vetRow({
        id: "conflict-55-vs-87",
        normalizedPayloadJson: { lead_details: { consumer_age: "55" } },
        rawPayloadJson: { date_of_birth: "1939-02-01" },
        generatedAt: new Date("2026-04-01T00:00:00.000Z"),
      }),
      vetRow({
        id: "clean-raw-70",
        rawPayloadJson: { consumer_age: "70" },
        generatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
    ];
    const { db, getUpdatedEventIds } = buildFakeDb(rows);
    const result = await commitConsumerAgeBackfill(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
        limit: 100,
        scope: { evaluatedAt: EVALUATED_AT },
      },
      db
    );

    // Writing the DOB would have moved the row's effective commercial age from
    // 55 to 87 — sellable to dead — during an ordinary backfill.
    assert.deepEqual(result.updatedIds, ["clean-raw-70"]);
    assert.equal(result.updatedIds?.includes("conflict-55-vs-87"), false);
    assert.deepEqual(getUpdatedEventIds(), ["evt-clean-raw-70"]);

    assert.equal(result.totals?.conflictHolds, 1);
    assert.equal(result.conflicts?.length, 1);
    const held = result.conflicts![0]!;
    assert.equal(held.id, "conflict-55-vs-87");
    assert.equal(held.existingCanonicalAge, "55");
    assert.equal(held.resolvedDobAge, "87");
    assert.equal(held.resolvedStatus, "over_maximum_age");
    assert.equal(held.resolvedSource, "raw_dob");
  });

  it("keeps the held conflict out of scope mutation on a repeat run", async () => {
    const rows = [
      vetRow({
        id: "conflict-55-vs-87",
        normalizedPayloadJson: { lead_details: { consumer_age: "55" } },
        rawPayloadJson: { date_of_birth: "1939-02-01" },
      }),
    ];
    const { db, getUpdatedEventIds } = buildFakeDb(rows);
    const guard = {
      expectedDbHost: "127.0.0.1:5432",
      databaseUrl: LOCAL_DB_URL,
      operator: "ops",
      confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
      limit: 100,
      scope: { evaluatedAt: EVALUATED_AT },
    };
    for (const pass of [1, 2]) {
      const result = await commitConsumerAgeBackfill(guard, db);
      assert.equal(result.outcome, "NOOP", `pass ${pass}`);
      assert.equal(result.writesAttempted, false, `pass ${pass}`);
      assert.equal(result.conflicts?.length, 1, `pass ${pass}`);
    }
    assert.deepEqual(getUpdatedEventIds(), []);
  });

  it("is a no-op when nothing is recoverable", async () => {
    const { db, getUpdatedEventIds } = buildFakeDb([vetRow({ id: "no-age" })]);
    const result = await commitConsumerAgeBackfill(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_BACKFILL_CONFIRMATION,
        limit: 100,
        scope: { evaluatedAt: EVALUATED_AT },
      },
      db
    );
    assert.equal(result.outcome, "NOOP");
    assert.equal(result.ok, true);
    assert.equal(result.writesAttempted, false);
    assert.deepEqual(getUpdatedEventIds(), []);
  });
});

describe("consumer age dead classification commit", () => {
  it("classifies unallocated over-maximum inventory and skips allocated rows", async () => {
    const rows = [
      vetRow({
        id: "dead-87",
        normalizedPayloadJson: { lead_details: { consumer_age: "87" } },
        generatedAt: new Date("2026-04-01T00:00:00.000Z"),
      }),
      vetRow({
        id: "dead-allocated",
        normalizedPayloadJson: { lead_details: { consumer_age: "92" } },
        allocations: 2,
        generatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
      vetRow({
        id: "sellable-86",
        normalizedPayloadJson: { lead_details: { consumer_age: "86" } },
        generatedAt: new Date("2026-04-03T00:00:00.000Z"),
      }),
      vetRow({ id: "no-age", generatedAt: new Date("2026-04-04T00:00:00.000Z") }),
    ];
    const { db, getClassifiedIds } = buildFakeDb(rows);
    const result = await commitConsumerAgeOverMaximumClassification(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
        limit: 100,
        scope: { evaluatedAt: EVALUATED_AT },
      },
      db
    );
    assert.equal(result.outcome, "CLASSIFIED");
    assert.deepEqual(result.classifiedIds, ["dead-87"]);
    assert.deepEqual(getClassifiedIds(), ["dead-87"]);
    assert.equal(result.totals?.deadClassificationBlockedByAllocation, 1);
    assert.equal(result.exclusion?.commerceExcludedReason, "consumer_age_over_86");
    assert.equal(result.exclusion?.commerceExcludedBy, "consumer_age_policy_v1");
    assert.equal(result.exclusion?.status, "expired");
    assert.equal(result.exclusion?.displayCategory, "Dead — Age over 86");
  });

  it("never classifies missing-age inventory as dead", async () => {
    const { db, getClassifiedIds } = buildFakeDb([
      vetRow({ id: "no-age" }),
      vetRow({ id: "invalid-age", rawPayloadJson: { consumer_age: "unknown" } }),
    ]);
    const result = await commitConsumerAgeOverMaximumClassification(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
        limit: 100,
        scope: { evaluatedAt: EVALUATED_AT },
      },
      db
    );
    assert.equal(result.outcome, "NOOP");
    assert.deepEqual(result.classifiedIds, []);
    assert.deepEqual(getClassifiedIds(), []);
    assert.equal(result.totals?.noAgeSource, 1);
    assert.equal(result.totals?.invalidAgeSource, 1);
  });

  it("skips a row whose age is no longer over the maximum when locked", async () => {
    const rows = [
      vetRow({
        id: "stale-over-max",
        normalizedPayloadJson: { lead_details: { consumer_age: "87" } },
      }),
    ];
    const fake = buildFakeDb(rows);
    // Simulate the locked read seeing a corrected, sellable age.
    (fake.db as unknown as { $queryRaw: unknown }).$queryRaw = async () => [
      {
        id: "stale-over-max",
        status: "available",
        commerceExcludedAt: null,
        metadataJson: {},
        normalizedPayloadJson: { lead_details: { consumer_age: "71" } },
        rawPayloadJson: {},
        enrichmentMetadataJson: {},
      },
    ];
    const result = await commitConsumerAgeOverMaximumClassification(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
        limit: 10,
        scope: { evaluatedAt: EVALUATED_AT },
      },
      fake.db
    );
    assert.equal(result.outcome, "NOOP");
    assert.deepEqual(result.classifiedIds, []);
    assert.deepEqual(result.skipped, [
      { id: "stale-over-max", reason: "age_no_longer_over_maximum" },
    ]);
    assert.deepEqual(fake.getClassifiedIds(), []);
  });

  it("holds an over-maximum row whose canonical age disagrees with its date of birth", async () => {
    const { db, getClassifiedIds } = buildFakeDb([
      vetRow({
        id: "conflict-55-vs-87",
        normalizedPayloadJson: { lead_details: { consumer_age: "55" } },
        rawPayloadJson: { date_of_birth: "1939-02-01" },
      }),
    ]);
    const result = await commitConsumerAgeOverMaximumClassification(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
        limit: 100,
        scope: { evaluatedAt: EVALUATED_AT },
      },
      db
    );
    assert.equal(result.outcome, "NOOP");
    assert.deepEqual(result.classifiedIds, []);
    assert.deepEqual(getClassifiedIds(), []);
    assert.equal(result.totals?.conflictHolds, 1);
    assert.equal(result.conflicts?.[0]?.id, "conflict-55-vs-87");
  });

  it("is idempotent: a second run over the same scope writes nothing", async () => {
    const fake = buildFakeDb([
      vetRow({
        id: "dead-87",
        normalizedPayloadJson: { lead_details: { consumer_age: "87" } },
      }),
      vetRow({
        id: "sellable-86",
        normalizedPayloadJson: { lead_details: { consumer_age: "86" } },
      }),
    ]);
    const guard = {
      expectedDbHost: "127.0.0.1:5432",
      databaseUrl: LOCAL_DB_URL,
      operator: "ops",
      confirm: CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
      limit: 100,
      scope: { evaluatedAt: EVALUATED_AT },
    };

    const first = await commitConsumerAgeOverMaximumClassification(guard, fake.db);
    assert.deepEqual(first.classifiedIds, ["dead-87"]);
    assert.equal(first.candidatesWritten, 1);

    // The commerce exclusion stamp takes the row out of the default scope,
    // exactly as the real `commerceExcludedAt: null` predicate would.
    fake.excludeRow("dead-87", EVALUATED_AT);

    const second = await commitConsumerAgeOverMaximumClassification(guard, fake.db);
    assert.equal(second.outcome, "NOOP");
    assert.deepEqual(second.classifiedIds, []);
    assert.equal(second.candidatesWritten, 0);
    // Age 86 is still sellable on both passes and was never touched.
    assert.deepEqual(fake.getClassifiedIds(), ["dead-87"]);
  });

  it("restricts candidates to date-of-birth rows when the sweep narrows the scope", async () => {
    const { db, getClassifiedIds } = buildFakeDb([
      vetRow({
        id: "stored-age-90",
        normalizedPayloadJson: { lead_details: { consumer_age: "90" } },
        generatedAt: new Date("2026-04-01T00:00:00.000Z"),
      }),
      vetRow({
        id: "dob-crossed-87",
        normalizedPayloadJson: { lead_details: { date_of_birth: "1939-02-01" } },
        generatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
    ]);
    const result = await commitConsumerAgeOverMaximumClassification(
      {
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        operator: "ops",
        confirm: CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
        limit: 100,
        scope: { evaluatedAt: EVALUATED_AT, dateOfBirthOnly: true },
      },
      db
    );
    assert.deepEqual(result.classifiedIds, ["dob-crossed-87"]);
    assert.deepEqual(getClassifiedIds(), ["dob-crossed-87"]);
    assert.equal(result.totals?.ageOverMaximum, 2);
    assert.equal(result.totals?.deadClassificationCandidates, 1);
  });
});
