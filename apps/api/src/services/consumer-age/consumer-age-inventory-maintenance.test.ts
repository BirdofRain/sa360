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

type CursorClause = {
  OR?: Array<{ generatedAt?: { gt?: Date } | Date; id?: { gt?: string } }>;
};

function applyCursor(rows: ScanRow[], where: Record<string, unknown>): ScanRow[] {
  const and = where.AND as unknown[] | undefined;
  const clause = Array.isArray(and)
    ? (and.find(
        (entry) => entry && typeof entry === "object" && "OR" in (entry as object)
      ) as CursorClause | undefined)
    : undefined;
  const or = clause?.OR;
  if (!or) return rows;
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
        return sorted.length;
      },
      findMany: async (args: { where: Record<string, unknown>; take: number }) => {
        findManyCalls += 1;
        return applyCursor(sorted, args.where).slice(0, args.take);
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

  it("caps maxScanRows at the module ceiling", () => {
    assert.equal(resolveConsumerAgeMaintenanceScope({ maxScanRows: 10_000_000 }).maxScanRows, 50_000);
    assert.equal(resolveConsumerAgeMaintenanceScope({ maxScanRows: 10 }).maxScanRows, 10);
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
    assert.equal(report.scan.exact, true);
    assert.deepEqual(getUpdatedEventIds(), []);
  });

  it("reports only ages the backfill would actually write", async () => {
    const { db } = buildFakeDb(rows);
    const report = await previewConsumerAgeInventory({ evaluatedAt: EVALUATED_AT }, db);
    // raw-70, metadata-64, enrichment-dob need an age; conflict needs only a DOB.
    assert.equal(report.totals.backfillCandidates, 4);
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
    assert.deepEqual(
      report.breakdown.byInventoryLot.map((bucket) => bucket.key).sort(),
      ["lot-a", "lot-b"]
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
    assert.equal(report.scan.exact, false);
    assert.equal(report.summary.startsWith("Scan safety cap reached"), true);
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
    assert.equal(result.moreCandidatesRemain, true);
    assert.equal(result.totals?.backfillCandidates, 2);
    assert.deepEqual(getUpdatedEventIds(), ["evt-raw-70"]);
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
});
