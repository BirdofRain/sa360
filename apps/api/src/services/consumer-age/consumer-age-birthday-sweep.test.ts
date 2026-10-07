import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  CONSUMER_AGE_BIRTHDAY_SWEEP_OPERATOR,
  runConsumerAgeBirthdaySweep,
} from "./consumer-age-birthday-sweep.service.js";

const LOCAL_DB_URL = "postgresql://sa360:sa360password@127.0.0.1:5432/sa360_test";

const FLAGS = [
  "SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED",
  "SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_BATCH_SIZE",
  "SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_MAX_SCAN_ROWS",
  "SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_EXPECTED_DB_HOST",
] as const;

const originals = new Map(FLAGS.map((flag) => [flag, process.env[flag]]));

afterEach(() => {
  for (const flag of FLAGS) {
    const value = originals.get(flag);
    if (value === undefined) delete process.env[flag];
    else process.env[flag] = value;
  }
});

/**
 * Minimal inventory row shaped like the maintenance scan projection. The sweep
 * only ever classifies, so a write is recorded rather than applied.
 */
function dobRow(input: { id: string; dateOfBirth?: string; age?: string; allocations?: number }) {
  const leadDetails: Record<string, string> = {};
  if (input.dateOfBirth) leadDetails.date_of_birth = input.dateOfBirth;
  if (input.age) leadDetails.consumer_age = input.age;
  return {
    id: input.id,
    generatedAt: new Date("2026-05-01T00:00:00.000Z"),
    status: "available",
    nicheKey: "vet",
    sourceProvider: "manual_import",
    sourceLane: "aged_inventory_csv",
    commerceExcludedAt: null as Date | null,
    metadataJson: {},
    inventoryLotId: "lot_a",
    inventoryLot: { lotKey: "lot-a" },
    sourceLeadEvent: {
      id: `evt-${input.id}`,
      sourceSystem: "csv_import",
      normalizedPayloadJson: { lead_details: leadDetails },
      rawPayloadJson: {},
      enrichmentMetadataJson: {},
    },
    _count: { leadAllocations: input.allocations ?? 0 },
  };
}

function buildFakeDb(rows: ReturnType<typeof dobRow>[]) {
  const classifiedIds: string[] = [];
  const db = {
    leadInventoryItem: {
      count: async (args: { where?: Record<string, unknown> }) =>
        args.where?.commerceExcludedReason != null ? 0 : rows.length,
      findMany: async (args: { take: number }) => rows.slice(0, args.take),
      updateMany: async ({ where }: { where: { id: string } }) => {
        classifiedIds.push(where.id);
        return { count: 1 };
      },
    },
    leadAllocation: {
      count: async ({ where }: { where: { leadInventoryItemId: string } }) =>
        rows.find((row) => row.id === where.leadInventoryItemId)?._count.leadAllocations ?? 0,
    },
    $queryRaw: async (_strings: unknown, itemId: string) => {
      const row = rows.find((candidate) => candidate.id === itemId);
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
  return { db: db as unknown as PrismaClient, getClassifiedIds: () => classifiedIds };
}

const EVALUATED_AT = new Date("2026-06-15T00:00:00.000Z");

describe("consumer age birthday sweep", () => {
  it("is off by default and writes nothing", async () => {
    delete process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED;
    const { db, getClassifiedIds } = buildFakeDb([
      dobRow({ id: "crossed-87", dateOfBirth: "1939-02-01" }),
    ]);
    const result = await runConsumerAgeBirthdaySweep({ evaluatedAt: EVALUATED_AT }, db);
    assert.equal(result.outcome, "DISABLED");
    assert.equal(result.enabled, false);
    assert.equal(result.ok, true);
    assert.equal(result.writesAttempted, false);
    assert.equal(result.reasonCode, "sweep_disabled");
    assert.deepEqual(getClassifiedIds(), []);
  });

  it("refuses when no authorized database host is configured", async () => {
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED = "true";
    delete process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_EXPECTED_DB_HOST;
    const { db, getClassifiedIds } = buildFakeDb([
      dobRow({ id: "crossed-87", dateOfBirth: "1939-02-01" }),
    ]);
    const result = await runConsumerAgeBirthdaySweep({ evaluatedAt: EVALUATED_AT }, db);
    assert.equal(result.outcome, "REFUSED");
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, "expected_db_host_required");
    assert.deepEqual(getClassifiedIds(), []);
  });

  it("refuses when the database host is not the authorized one", async () => {
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED = "1";
    const { db, getClassifiedIds } = buildFakeDb([
      dobRow({ id: "crossed-87", dateOfBirth: "1939-02-01" }),
    ]);
    const result = await runConsumerAgeBirthdaySweep(
      {
        evaluatedAt: EVALUATED_AT,
        expectedDbHost: "db.production.example",
        databaseUrl: LOCAL_DB_URL,
      },
      db
    );
    assert.equal(result.outcome, "REFUSED");
    assert.equal(result.reasonCode, "db_host_mismatch");
    assert.deepEqual(getClassifiedIds(), []);
  });

  it("classifies a date-of-birth lead that crossed the maximum age", async () => {
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED = "true";
    // 1939-06-14 turns 87 on 2026-06-14; the sweep runs on the 15th.
    const { db, getClassifiedIds } = buildFakeDb([
      dobRow({ id: "crossed-87", dateOfBirth: "1939-06-14" }),
      dobRow({ id: "still-86", dateOfBirth: "1939-06-16" }),
    ]);
    const result = await runConsumerAgeBirthdaySweep(
      {
        evaluatedAt: EVALUATED_AT,
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
      },
      db
    );
    assert.equal(result.outcome, "CLASSIFIED");
    assert.equal(result.ok, true);
    assert.equal(result.enabled, true);
    assert.deepEqual(result.classifiedIds, ["crossed-87"]);
    assert.deepEqual(getClassifiedIds(), ["crossed-87"]);
    assert.equal(result.candidatesWritten, 1);
    assert.equal(result.coverage, "complete");
    assert.equal(result.nextCursor, null);
  });

  it("leaves a lead who is still 86 today alone", async () => {
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED = "true";
    const { db, getClassifiedIds } = buildFakeDb([
      dobRow({ id: "still-86", dateOfBirth: "1939-06-16" }),
    ]);
    const result = await runConsumerAgeBirthdaySweep(
      {
        evaluatedAt: EVALUATED_AT,
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
      },
      db
    );
    assert.equal(result.outcome, "NOOP");
    assert.equal(result.candidatesWritten, 0);
    assert.deepEqual(getClassifiedIds(), []);
  });

  it("ignores inventory without an explicit date of birth", async () => {
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED = "true";
    const { db, getClassifiedIds } = buildFakeDb([
      dobRow({ id: "stored-age-90", age: "90" }),
      dobRow({ id: "no-age" }),
    ]);
    const result = await runConsumerAgeBirthdaySweep(
      {
        evaluatedAt: EVALUATED_AT,
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
      },
      db
    );
    assert.equal(result.outcome, "NOOP");
    assert.deepEqual(getClassifiedIds(), []);
    assert.equal(result.candidatesInScannedWindow, 0);
  });

  it("never touches allocated inventory", async () => {
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED = "true";
    const { db, getClassifiedIds } = buildFakeDb([
      dobRow({ id: "allocated-crossed", dateOfBirth: "1930-01-01", allocations: 1 }),
    ]);
    const result = await runConsumerAgeBirthdaySweep(
      {
        evaluatedAt: EVALUATED_AT,
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
      },
      db
    );
    assert.equal(result.outcome, "NOOP");
    assert.deepEqual(getClassifiedIds(), []);
  });

  it("returns a chainable cursor when the scan ceiling truncates the window", async () => {
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED = "true";
    const rows = Array.from({ length: 6 }, (_, index) =>
      dobRow({ id: `row-${index}`, dateOfBirth: "1939-06-16" })
    );
    const { db } = buildFakeDb(rows);
    const result = await runConsumerAgeBirthdaySweep(
      {
        evaluatedAt: EVALUATED_AT,
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
        maxScanRows: 3,
      },
      db
    );
    assert.equal(result.coverage, "partial");
    assert.notEqual(result.nextCursor, null);
    assert.equal(result.rowsScanned, 3);
    assert.equal(result.maxScanRows, 3);
  });

  it("writes under its own operator identity and reuses the shared policy stamp", async () => {
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED = "true";
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_BATCH_SIZE = "7";
    const { db } = buildFakeDb([dobRow({ id: "crossed", dateOfBirth: "1930-01-01" })]);
    const result = await runConsumerAgeBirthdaySweep(
      {
        evaluatedAt: EVALUATED_AT,
        expectedDbHost: "127.0.0.1:5432",
        databaseUrl: LOCAL_DB_URL,
      },
      db
    );
    assert.equal(result.batchSize, 7);
    assert.equal(result.dbHostVerified, "127.0.0.1:5432");
    assert.equal(CONSUMER_AGE_BIRTHDAY_SWEEP_OPERATOR, "consumer_age_birthday_sweep");
  });
});
