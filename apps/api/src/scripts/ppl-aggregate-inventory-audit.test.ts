import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { PrismaClient, type Prisma } from "@prisma/client";

import { fingerprintIdentityValue } from "../lib/identity-fingerprint.js";
import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import {
  PPL_AGGREGATE_AUDIT_BUCKETS,
  PPL_AGGREGATE_AUDIT_TRANSACTION_TIMEOUT_MS,
  buildPplAggregateInventoryAudit,
  executePplAggregateInventoryAudit,
} from "./ppl-aggregate-inventory-audit.js";
import { queryEligibleInventoryCandidatesBounded } from "../services/ppl-fulfillment/inventory-selection.service.js";

const AS_OF = new Date("2026-10-12T13:30:04.000Z");
const BUYER = "client_vanessa_powell";
const STATES = ["TX", "FL", "AL", "GA", "MO", "MS", "WI", "UT", "VA", "SC", "NC"];
const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() ?? "";

type FixtureRow = {
  id: string;
  generatedAt: Date;
  status: string;
  inventoryClass: string;
  nicheKey: string;
  normalizedState: string;
  commerceExcludedAt: Date | null;
  originClientAccountId: string | null;
  metadataJson: Record<string, unknown>;
  inventoryLot: { supplierAccountId: string | null; status: string };
  sourceLeadEvent: {
    id: string;
    normalizedPayloadJson: Record<string, unknown>;
    rawPayloadJson: Record<string, unknown>;
    enrichmentMetadataJson: Record<string, unknown>;
  };
};

function daysAgo(days: number): Date {
  return new Date(AS_OF.getTime() - days * 86_400_000);
}

function fixtureRow(input: {
  id: string;
  days: number;
  state: string;
  phone?: string;
  email?: string;
  consumerAge?: number;
  status?: string;
  inventoryClass?: string;
  lotStatus?: string;
  supplier?: string;
  commerceExcluded?: boolean;
  originClientAccountId?: string | null;
}): FixtureRow {
  const phone = input.phone ?? `+1555${input.id.padStart(7, "0").slice(-7)}`;
  const email = input.email ?? `${input.id}@fixture.invalid`;
  return {
    id: input.id,
    generatedAt: daysAgo(input.days),
    status: input.status ?? "available",
    inventoryClass: input.inventoryClass ?? "aged",
    nicheKey: "trucker",
    normalizedState: input.state,
    commerceExcludedAt: input.commerceExcluded ? AS_OF : null,
    originClientAccountId: input.originClientAccountId ?? null,
    metadataJson: {},
    inventoryLot: {
      supplierAccountId: input.supplier ?? "supplier_allowed",
      status: input.lotStatus ?? "active",
    },
    sourceLeadEvent: {
      id: `event-${input.id}`,
      normalizedPayloadJson: {
        contact: {
          first_name: "Jo",
          last_name: "Lane",
          phone_e164: phone,
          email,
          state: input.state,
        },
        lead_details:
          input.consumerAge === undefined ? {} : { consumer_age: input.consumerAge },
      },
      rawPayloadJson: {},
      enrichmentMetadataJson: {},
    },
  };
}

function rowsForAudit(): FixtureRow[] {
  const duplicatePhone = "+15550001111";
  return [
    fixtureRow({ id: "secret-item-01", days: 500, state: "TX", phone: duplicatePhone, consumerAge: 55 }),
    fixtureRow({ id: "secret-item-02", days: 300, state: "GA", consumerAge: 60 }),
    fixtureRow({ id: "secret-item-03", days: 200, state: "FL", phone: duplicatePhone, consumerAge: 55 }),
    fixtureRow({ id: "secret-item-04", days: 400, state: "MS", consumerAge: 55 }),
    fixtureRow({ id: "secret-item-05", days: 400, state: "WI", consumerAge: 55, supplier: "supplier_blocked" }),
    fixtureRow({ id: "secret-item-06", days: 400, state: "UT", consumerAge: 55, status: "reserved" }),
    fixtureRow({ id: "secret-item-07", days: 400, state: "VA", consumerAge: 55, originClientAccountId: BUYER }),
    fixtureRow({ id: "secret-item-08", days: 400, state: "SC", consumerAge: 55, lotStatus: "paused" }),
    fixtureRow({ id: "secret-item-09", days: 400, state: "MO", consumerAge: 55, commerceExcluded: true }),
    fixtureRow({ id: "secret-item-10", days: 400, state: "NC" }),
    fixtureRow({ id: "secret-item-11", days: 400, state: "AL", consumerAge: 55, inventoryClass: "fresh" }),
    fixtureRow({ id: "secret-item-12", days: 400, state: "TX", consumerAge: 55, status: "reserved", commerceExcluded: true }),
    fixtureRow({ id: "secret-item-13", days: 400, state: "FL", consumerAge: 55, lotStatus: "paused", commerceExcluded: true }),
  ];
}

function cursorFromWhere(where: Record<string, unknown>): { generatedAt: Date; id: string } | null {
  const clauses = (where.AND as Array<Record<string, unknown>> | undefined) ?? [];
  for (const clause of clauses) {
    const alternatives = clause.OR as Array<Record<string, unknown>> | undefined;
    if (!alternatives) continue;
    const sameTime = alternatives.find((entry) => entry.id != null);
    const id = (sameTime?.id as { gt?: string } | undefined)?.gt;
    const generatedAt = sameTime?.generatedAt as Date | undefined;
    if (id && generatedAt instanceof Date) return { generatedAt, id };
  }
  return null;
}

function createFixtureDb(rows = rowsForAudit()) {
  let countCall = 0;
  const countValues = [rows.length, rows.length, rows.length, rows.length, rows.filter((r) => r.inventoryClass === "aged").length];
  const priorPhone = (
    rows.find((row) => row.id === "secret-item-04")!.sourceLeadEvent.normalizedPayloadJson.contact as {
      phone_e164: string;
    }
  ).phone_e164;

  const db = {
    clientAccount: {
      findUnique: async () => ({ clientAccountId: BUYER }),
    },
    protectedAgentExclusion: {
      findMany: async () => [
        {
          id: "protected-rule",
          matchType: "supplier_account_id" as const,
          matchValue: "supplier_blocked",
          active: true,
          note: null,
          createdAt: AS_OF,
          updatedAt: AS_OF,
        },
      ],
    },
    buyerDeliveredIdentity: {
      findMany: async () => [
        {
          phoneFingerprint: fingerprintIdentityValue("phone", priorPhone),
          emailFingerprint: null,
        },
      ],
    },
    leadAllocation: {
      groupBy: async () => [
        { status: "committed", _count: { _all: 4 } },
        { status: "released", _count: { _all: 1 } },
      ],
    },
    leadInventoryItem: {
      count: async () => countValues[countCall++] ?? countValues.at(-1)!,
      findMany: async (args: { where: Record<string, unknown>; take: number }) => {
        const cursor = cursorFromWhere(args.where);
        return rows
          .filter((row) => row.inventoryClass === "aged")
          .sort((a, b) => {
            const time = a.generatedAt.getTime() - b.generatedAt.getTime();
            return time || a.id.localeCompare(b.id);
          })
          .filter((row) => {
            if (!cursor) return true;
            const time = row.generatedAt.getTime() - cursor.generatedAt.getTime();
            return time > 0 || (time === 0 && row.id > cursor.id);
          })
          .slice(0, args.take);
      },
    },
  };
  return {
    db: db as unknown as PrismaClient,
    resetCounts: () => {
      countCall = 0;
    },
  };
}

test("aggregate audit paginates to exhaustion, deduplicates globally, and prices totals", async () => {
  const fixture = createFixtureDb();
  const report = await buildPplAggregateInventoryAudit(
    {
      clientAccountId: BUYER,
      nicheKey: "trucker",
      states: STATES,
      pageSize: 2,
    },
    AS_OF,
    fixture.db as never
  );

  assert.equal(report.coverage, "complete");
  assert.equal(report.pagination.rowsVisited, 12);
  assert.equal(report.pagination.pagesRead, 7);
  assert.equal(report.stages.finalEligible, 2);
  assert.equal(report.stages.availableAgedInventory, 10);
  assert.equal(report.stages.unavailableByStatus.reserved, 2);
  assert.equal(report.stages.activeLot, 8);
  assert.equal(report.stages.inactiveLot, 2);
  assert.equal(report.stages.commerceIncluded, 7);
  assert.equal(report.exclusions.unavailableInventory, 2);
  assert.equal(report.exclusions.commerceExcluded, 3);
  assert.equal(report.exclusions.protectedAgent, 1);
  assert.equal(report.exclusions.buyerOrigin, 1);
  assert.equal(report.exclusions.notBuyerReady, 1);
  assert.equal(report.exclusions.previousBuyerDeliveryIdentity, 1);
  assert.equal(report.exclusions.crossBucketOrStateDuplicate, 1);
  assert.equal(report.tierSubtotals.COMMERCE_12_MO_PLUS, 1);
  assert.equal(report.tierSubtotals.COMMERCE_9_12_MO, 1);
  assert.equal(report.tierSubtotals.COMMERCE_6_9_MO, 0);
  assert.equal(report.quote.grandTotalCents, 300);
  assert.equal(report.fulfillmentBatches.COMMERCE_12_MO_PLUS.estimatedOrderCount, 1);
  assert.ok(Object.values(report.invariants).every(Boolean));

  const serialized = JSON.stringify(report);
  for (const row of rowsForAudit()) {
    assert.equal(serialized.includes(row.id), false);
    const contact = row.sourceLeadEvent.normalizedPayloadJson.contact as {
      phone_e164: string;
      email: string;
    };
    assert.equal(serialized.includes(contact.phone_e164), false);
    assert.equal(serialized.includes(contact.email), false);
  }
  assert.doesNotMatch(serialized, /normalizedPayloadJson|rawPayloadJson|phoneFingerprint|emailFingerprint/);
});

test("aggregate audit and production bounded selector classify the same eligible fixture rows", async () => {
  const fixture = createFixtureDb();
  const report = await buildPplAggregateInventoryAudit(
    {
      clientAccountId: BUYER,
      nicheKey: "trucker",
      states: STATES,
      pageSize: 3,
    },
    AS_OF,
    fixture.db as never
  );

  const selected = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "trucker",
      states: STATES,
      commerceAgeBucketKeys: [...PPL_AGGREGATE_AUDIT_BUCKETS],
      clientAccountId: BUYER,
      exclusions: (await fixture.db.protectedAgentExclusion.findMany()) as never,
      evaluatedAt: AS_OF,
      targetEligible: 100,
      pageSize: 3,
      maxScannedRows: 100,
    },
    fixture.db
  );

  assert.equal(selected.scanCeilingHit, false);
  assert.equal(selected.candidates.length, report.stages.finalEligible);
  assert.deepEqual(
    Object.fromEntries(
      PPL_AGGREGATE_AUDIT_BUCKETS.map((tier) => [
        tier,
        selected.candidates.filter((candidate) => candidate.commerceAgeBucketKey === tier).length,
      ])
    ),
    report.tierSubtotals
  );
  assert.equal(selected.exclusionCounts.commerceExcluded, report.exclusions.commerceExcluded);
  assert.equal(
    selected.exclusionCounts.unavailableInventory,
    report.exclusions.unavailableInventory
  );
});

test("aggregate audit fails closed when a page bound interrupts traversal", async () => {
  const fixture = createFixtureDb();
  await assert.rejects(
    buildPplAggregateInventoryAudit(
      {
        clientAccountId: BUYER,
        nicheKey: "trucker",
        states: STATES,
        pageSize: 2,
        maxPages: 1,
      },
      AS_OF,
      fixture.db as never
    ),
    /audit_scan_incomplete:max_pages_reached/
  );
});

test("execution starts a repeatable-read read-only transaction with bounded timeouts", async () => {
  const fixture = createFixtureDb();
  const statements: string[] = [];
  let transactionOptions: Record<string, unknown> | undefined;
  const tx = {
    ...(fixture.db as unknown as Record<string, unknown>),
    $executeRawUnsafe: async (sql: string) => {
      statements.push(sql);
      return 0;
    },
    $queryRaw: async () => [
      {
        asOf: AS_OF,
        readOnly: "on",
        isolationLevel: "repeatable read",
      },
    ],
  };
  const db = {
    $transaction: async (
      run: (transaction: unknown) => Promise<unknown>,
      options: Record<string, unknown>
    ) => {
      transactionOptions = options;
      return run(tx);
    },
  } as unknown as PrismaClient;

  const report = await executePplAggregateInventoryAudit(
    {
      clientAccountId: BUYER,
      nicheKey: "trucker",
      states: STATES,
      pageSize: 20,
    },
    db
  );

  assert.equal(report.asOf, AS_OF.toISOString());
  assert.equal(statements[0], "SET TRANSACTION READ ONLY");
  assert.match(statements[1] ?? "", /statement_timeout/);
  assert.match(statements[2] ?? "", /idle_in_transaction_session_timeout/);
  assert.equal(transactionOptions?.timeout, PPL_AGGREGATE_AUDIT_TRANSACTION_TIMEOUT_MS);
  assert.equal(String(transactionOptions?.isolationLevel), "RepeatableRead");
});

test("execution refuses a transaction that PostgreSQL does not report read-only", async () => {
  const db = {
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) =>
      run({
        $executeRawUnsafe: async () => 0,
        $queryRaw: async () => [
          { asOf: AS_OF, readOnly: "off", isolationLevel: "repeatable read" },
        ],
      }),
  } as unknown as PrismaClient;

  await assert.rejects(
    executePplAggregateInventoryAudit(
      { clientAccountId: BUYER, nicheKey: "trucker", states: STATES },
      db
    ),
    /database_transaction_not_read_only/
  );
});

test(
  "aggregate audit applies real Prisma niche, state, age, and keyset pagination filters",
  { skip: !integrationUrlRaw },
  async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    const db = new PrismaClient({ datasources: { db: { url } } });
    const token = randomUUID().replaceAll("-", "").slice(0, 12);
    const clientAccountId = `client_ppl_audit_it_${token}`;
    const lotKey = `ppl-audit-it-${token}`;
    const itemIds: string[] = [];
    const eventIds: string[] = [];

    const payload = (index: number, state: string): Prisma.InputJsonValue => ({
      contact: {
        first_name: "Test",
        last_name: "Driver",
        phone_e164: `+1555${token.replace(/\D/g, "").padEnd(7, "0").slice(0, 6)}${index}`,
        email: `ppl-audit-${token}-${index}@example.test`,
        state,
      },
      lead_details: { consumer_age: 55 },
    });

    try {
      await db.clientAccount.create({
        data: {
          clientAccountId,
          clientDisplayName: "PPL aggregate audit integration fixture",
          status: "active",
          primaryNicheKeys: ["trucker"],
        },
      });
      const lot = await db.inventoryLot.create({
        data: {
          lotKey,
          displayName: "PPL aggregate audit integration fixture",
          sourceProvider: "manual_import",
          sourceLane: "aged_inventory_csv",
          nicheKey: "trucker",
          inventoryClass: "aged",
          exclusivityMode: "exclusive",
          supplierAccountId: `supplier_ppl_audit_it_${token}`,
          status: "active",
          activatedAt: AS_OF,
        },
      });

      const auditInput = {
        clientAccountId,
        nicheKey: "trucker",
        states: ["WY"],
        pageSize: 2,
      };
      const before = await buildPplAggregateInventoryAudit(
        auditInput,
        AS_OF,
        db as never
      );
      const specs = [
        { nicheKey: "trucker", state: "WY", days: 200 },
        { nicheKey: "trucker_life", state: "WY", days: 300 },
        { nicheKey: "trucker", state: "WY", days: 400 },
        { nicheKey: "nurse", state: "WY", days: 400 },
        { nicheKey: "trucker", state: "ID", days: 400 },
        { nicheKey: "trucker", state: "WY", days: 100 },
      ] as const;

      for (const [index, spec] of specs.entries()) {
        const eventId = `evt-ppl-audit-it-${token}-${index}`;
        const itemId = `inv-ppl-audit-it-${token}-${index}`;
        const generatedAt = daysAgo(spec.days);
        await db.sourceLeadEvent.create({
          data: {
            id: eventId,
            sourceProvider: "manual_import",
            sourceSystem: "csv_import",
            sourceType: "bulk_import",
            sourceLeadId: itemId,
            status: "normalized",
            rawPayloadJson: {},
            normalizedPayloadJson: payload(index, spec.state),
            receivedAt: generatedAt,
          },
        });
        await db.leadInventoryItem.create({
          data: {
            id: itemId,
            inventoryLotId: lot.id,
            sourceLeadEventId: eventId,
            generatedAt,
            normalizedState: spec.state,
            nicheKey: spec.nicheKey,
            sourceProvider: "manual_import",
            sourceLane: "aged_inventory_csv",
            inventoryClass: "aged",
            exclusivityMode: "exclusive",
            status: "available",
            availableAt: AS_OF,
          },
        });
        eventIds.push(eventId);
        itemIds.push(itemId);
      }

      const after = await buildPplAggregateInventoryAudit(
        auditInput,
        AS_OF,
        db as never
      );
      type NumericStage = Exclude<keyof typeof after.stages, "unavailableByStatus">;
      const delta = (field: NumericStage) =>
        after.stages[field] - before.stages[field];

      assert.equal(delta("rawCanonicalInventory"), 6);
      assert.equal(delta("matchingNiche"), 5);
      assert.equal(delta("matchingRequestedStates"), 4);
      assert.equal(delta("matchingAgeTier"), 3);
      assert.equal(delta("agedInventory"), 3);
      assert.equal(delta("finalEligible"), 3);
      assert.equal(
        after.matrix[0]!.quantities.COMMERCE_6_9_MO -
          before.matrix[0]!.quantities.COMMERCE_6_9_MO,
        1
      );
      assert.equal(
        after.matrix[0]!.quantities.COMMERCE_9_12_MO -
          before.matrix[0]!.quantities.COMMERCE_9_12_MO,
        1
      );
      assert.equal(
        after.matrix[0]!.quantities.COMMERCE_12_MO_PLUS -
          before.matrix[0]!.quantities.COMMERCE_12_MO_PLUS,
        1
      );
      assert.equal(after.pagination.pageSize, 2);
      assert.equal(
        after.pagination.pagesRead,
        Math.floor(after.pagination.rowsVisited / 2) + 1
      );
      assert.equal(after.invariants.scanCountMatchesCohort, true);
      assert.equal(after.invariants.waterfallReconciles, true);
    } finally {
      await db.leadInventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
      await db.inventoryLot.deleteMany({ where: { lotKey } });
      await db.clientAccount.deleteMany({ where: { clientAccountId } });
      await db.$disconnect();
    }
  }
);
