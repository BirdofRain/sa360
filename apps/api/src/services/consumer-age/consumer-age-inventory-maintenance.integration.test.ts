/**
 * Historical consumer-age maintenance against a real local database.
 *
 * The cohort is PII-free synthetic inventory shaped like the LO-1055 /
 * LO-1057 aged-Veteran orders: most rows carry an age only outside the
 * canonical normalized destination, some carry none at all, and a few resolve
 * above the maximum sellable age. One over-maximum row is already allocated
 * and committed — it stands in for a delivered historical package and must
 * survive every maintenance operation untouched.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient, type LeadInventoryItemStatus, type Prisma } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  CONSUMER_AGE_BACKFILL_CONFIRMATION,
  CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
  commitConsumerAgeBackfill,
  commitConsumerAgeOverMaximumClassification,
  previewConsumerAgeInventory,
} from "./consumer-age-inventory-maintenance.service.js";
import {
  readNormalizedConsumerAgeCell,
  readNormalizedDateOfBirthCell,
} from "./consumer-age-policy.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);

const LOT_KEY = "cage-maint-lot";
const CLIENT_ID = "client_cage_maint";
const ORDER_ID = "ord_cage_maint";
const ALLOCATION_ID = "alloc_cage_maint_committed";
const SCOPE_LANE = "aged_inventory_csv_cage_maint";
const EVALUATED_AT = new Date("2026-06-15T00:00:00.000Z");

type RowSpec = {
  id: string;
  status?: LeadInventoryItemStatus;
  nicheKey?: string;
  canonicalAge?: string;
  rawAge?: string;
  rawDob?: string;
  metadataAge?: string;
  enrichmentAge?: string;
  allocate?: boolean;
};

const SPECS: RowSpec[] = [
  { id: "cage-canonical-62", canonicalAge: "62" },
  { id: "cage-canonical-70", canonicalAge: "70" },
  { id: "cage-raw-84", rawAge: "84" },
  { id: "cage-raw-dob", rawDob: "1952-03-04" },
  { id: "cage-metadata-64", metadataAge: "64" },
  { id: "cage-enrichment-58", enrichmentAge: "58" },
  { id: "cage-no-age-1" },
  { id: "cage-no-age-2" },
  { id: "cage-no-age-pending", status: "pending_review" },
  { id: "cage-invalid-age", rawAge: "unknown" },
  { id: "cage-dead-87", canonicalAge: "87" },
  { id: "cage-dead-raw-91", rawAge: "91" },
  { id: "cage-dead-committed", canonicalAge: "93", status: "committed", allocate: true },
  { id: "cage-conflict", canonicalAge: "55", rawDob: "1951-07-08" },
];

function normalizedPayload(spec: RowSpec): Prisma.InputJsonValue {
  const payload: Record<string, unknown> = {
    firstName: "Ada",
    lastName: "Stone",
    phone_e164: null,
    state: "GA",
    niche_key: spec.nicheKey ?? "veteran",
  };
  if (spec.canonicalAge) payload.lead_details = { consumer_age: spec.canonicalAge };
  return payload as Prisma.InputJsonValue;
}

function rawPayload(spec: RowSpec): Prisma.InputJsonValue {
  const payload: Record<string, unknown> = { importRequestId: "cage-maint", rowNumber: 1 };
  if (spec.rawAge) payload.master = { dob_age_raw: spec.rawAge };
  if (spec.rawDob) payload.master = { ...(payload.master as object), date_of_birth: spec.rawDob };
  return payload as Prisma.InputJsonValue;
}

describe("consumer age inventory maintenance", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let lotId: string;
  const itemIds = SPECS.map((spec) => spec.id);
  const eventIds = SPECS.map((spec) => `evt-${spec.id}`);

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });

    await db.clientAccount.upsert({
      where: { clientAccountId: CLIENT_ID },
      create: {
        clientAccountId: CLIENT_ID,
        clientDisplayName: "Consumer age maintenance buyer",
        status: "active",
        portalEnabled: false,
        primaryNicheKeys: ["vet"],
      },
      update: { status: "active" },
    });
    await db.leadOrder.upsert({
      where: { id: ORDER_ID },
      create: {
        id: ORDER_ID,
        orderNumber: "LO-CAGE-MAINT",
        clientAccountId: CLIENT_ID,
        clientDisplayName: "Consumer age maintenance buyer",
        status: "active",
        nicheKey: "vet",
        statesJson: ["GA"],
        leadVolume: 10,
        deliveryCadence: "manual_ops_workbench",
        campaignType: "aged_leads",
        crmPackage: "simulation_only",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 10,
      },
      update: { status: "active" },
    });
    const lot = await db.inventoryLot.upsert({
      where: { lotKey: LOT_KEY },
      create: {
        lotKey: LOT_KEY,
        displayName: "Consumer age maintenance lot",
        sourceProvider: "manual_import",
        sourceLane: SCOPE_LANE,
        nicheKey: "vet",
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status: "active",
        activatedAt: new Date(),
      },
      update: { status: "active" },
    });
    lotId = lot.id;
    await seed();
  });

  after(async () => {
    if (!db) return;
    await db.leadAllocation.deleteMany({ where: { id: ALLOCATION_ID } });
    await db.leadInventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.leadOrder.deleteMany({ where: { id: ORDER_ID } });
    await db.inventoryLot.deleteMany({ where: { lotKey: LOT_KEY } });
    await db.$disconnect();
  });

  async function seed(): Promise<void> {
    for (const spec of SPECS) {
      const eventId = `evt-${spec.id}`;
      const event = {
        sourceProvider: "manual_import" as const,
        sourceSystem: "csv_import" as const,
        sourceType: "bulk_import" as const,
        sourceLeadId: spec.id,
        status: "normalized" as const,
        rawPayloadJson: rawPayload(spec),
        normalizedPayloadJson: normalizedPayload(spec),
        enrichmentMetadataJson: (spec.enrichmentAge
          ? { sourceLane: SCOPE_LANE, sourceAttributes: { consumer_age: spec.enrichmentAge } }
          : { sourceLane: SCOPE_LANE }) as Prisma.InputJsonValue,
        receivedAt: new Date(),
      };
      await db.sourceLeadEvent.upsert({
        where: { id: eventId },
        create: { id: eventId, ...event },
        update: {
          rawPayloadJson: event.rawPayloadJson,
          normalizedPayloadJson: event.normalizedPayloadJson,
          enrichmentMetadataJson: event.enrichmentMetadataJson,
        },
      });

      const status = spec.status ?? "available";
      const item = {
        inventoryLotId: lotId,
        sourceLeadEventId: eventId,
        generatedAt: new Date("2026-05-01T00:00:00.000Z"),
        normalizedState: "GA",
        nicheKey: spec.nicheKey ?? "veteran",
        sourceProvider: "manual_import" as const,
        sourceLane: SCOPE_LANE,
        inventoryClass: "aged" as const,
        exclusivityMode: "exclusive" as const,
        status,
        availableAt: status === "available" ? new Date() : null,
        committedAt: status === "committed" ? new Date() : null,
        commerceExcludedAt: null,
        commerceExcludedReason: null,
        commerceExcludedBy: null,
        expiredAt: null,
        metadataJson: (spec.metadataAge
          ? { consumer_age: spec.metadataAge }
          : { importRequestId: "cage-maint" }) as Prisma.InputJsonValue,
      };
      await db.leadInventoryItem.upsert({
        where: { id: spec.id },
        create: { id: spec.id, ...item },
        update: item,
      });

      if (spec.allocate) {
        await db.leadAllocation.upsert({
          where: { id: ALLOCATION_ID },
          create: {
            id: ALLOCATION_ID,
            sourceLeadEventId: eventId,
            leadOrderId: ORDER_ID,
            leadInventoryItemId: spec.id,
            clientAccountId: CLIENT_ID,
            status: "committed",
            allocationPolicyVersion: "test",
            idempotencyKey: ALLOCATION_ID,
            committedAt: new Date(),
          },
          update: { status: "committed" },
        });
      }
    }
  }

  function scope() {
    return { sourceLane: SCOPE_LANE, evaluatedAt: EVALUATED_AT };
  }

  function localGuard(limit: number, confirm: string) {
    return {
      expectedDbHost: "127.0.0.1:5432",
      databaseUrl: process.env.DATABASE_URL!,
      operator: "integration_test",
      confirm,
      limit,
    };
  }

  it("previews the cohort without writing anything", async () => {
    const report = await previewConsumerAgeInventory(scope(), db);

    // The committed over-maximum row is out of the default status scope.
    assert.equal(report.totals.activeSellableInventory, SPECS.length - 1);
    assert.equal(report.totals.ageAlreadyNormalized, 4);
    assert.equal(report.totals.recoverableFromRawPayload, 4);
    assert.equal(report.totals.recoverableFromMetadata, 1);
    assert.equal(report.totals.recoverableFromEnrichment, 1);
    assert.equal(report.totals.noAgeSource, 3);
    assert.equal(report.totals.invalidAgeSource, 1);
    assert.equal(report.totals.ageOverMaximum, 2);
    assert.equal(report.totals.canonicalConflicts, 1);
    // The conflicting row is held back from automatic repair, so it is not a
    // backfill candidate even though its date of birth is recoverable.
    assert.equal(report.totals.conflictHolds, 1);
    assert.equal(report.totals.backfillCandidates, 5);
    assert.equal(report.totals.deadClassificationCandidates, 2);
    assert.equal(report.coverage, "complete");
    assert.equal(report.nextCursor, null);
    assert.deepEqual(
      report.breakdown.bySourceLane.map((bucket) => bucket.key),
      [SCOPE_LANE]
    );
    assert.deepEqual(
      report.breakdown.byGeneratedMonth.map((bucket) => bucket.key),
      ["2026-05"]
    );

    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("Ada"), false);
    assert.equal(serialized.includes("Stone"), false);

    // Nothing moved.
    const stillBlank = await db.sourceLeadEvent.findUnique({
      where: { id: "evt-cage-raw-84" },
      select: { normalizedPayloadJson: true },
    });
    assert.equal(readNormalizedConsumerAgeCell(stillBlank?.normalizedPayloadJson), "");
  });

  it("chains a bounded cursor through the whole cohort against the real database", async () => {
    const full = await previewConsumerAgeInventory(scope(), db);
    const expected = full.scan.matchingRows;
    assert.equal(expected > 4, true, "cohort must be larger than the test ceiling");

    let cursor: { afterGeneratedAt: string; afterId: string } | null = null;
    let totalScanned = 0;
    let invocations = 0;
    let coverage = "partial";

    // All fixture rows share one `generatedAt`, so this also proves the id tie
    // breaker alone keeps the traversal moving.
    while (invocations < 20) {
      const page = await previewConsumerAgeInventory({ ...scope(), maxScanRows: 4, cursor }, db);
      invocations += 1;
      totalScanned += page.scan.rowsScanned;
      coverage = page.coverage;
      if (page.coverage === "complete") {
        assert.equal(page.nextCursor, null);
        break;
      }
      assert.notEqual(page.nextCursor, null);
      cursor = page.nextCursor;
    }

    assert.equal(coverage, "complete");
    assert.equal(totalScanned, expected);
    assert.equal(invocations, Math.floor(expected / 4) + 1);
  });

  it("backfills recovered ages, respects the limit, and is idempotent", async () => {
    const first = await commitConsumerAgeBackfill(
      { ...localGuard(2, CONSUMER_AGE_BACKFILL_CONFIRMATION), scope: scope() },
      db
    );
    assert.equal(first.outcome, "BACKFILLED");
    assert.equal(first.updatedIds?.length, 2);
    assert.equal(first.candidatesWritten, 2);
    // The window was fully traversed, so there is nothing left to resume — the
    // write limit, not the scan, is what left candidates behind.
    assert.equal(first.coverage, "complete");
    assert.equal(first.nextCursor, null);
    assert.equal(first.candidatesInScannedWindow, 5);

    const second = await commitConsumerAgeBackfill(
      { ...localGuard(100, CONSUMER_AGE_BACKFILL_CONFIRMATION), scope: scope() },
      db
    );
    assert.equal(second.outcome, "BACKFILLED");
    assert.equal(second.candidatesWritten, 3);
    assert.equal(second.coverage, "complete");

    const third = await commitConsumerAgeBackfill(
      { ...localGuard(100, CONSUMER_AGE_BACKFILL_CONFIRMATION), scope: scope() },
      db
    );
    assert.equal(third.outcome, "NOOP");
    assert.deepEqual(third.updatedIds, []);
    assert.equal(third.totals?.backfillCandidates, 0);

    const promoted = await db.sourceLeadEvent.findMany({
      where: {
        id: {
          in: [
            "evt-cage-raw-84",
            "evt-cage-raw-dob",
            "evt-cage-metadata-64",
            "evt-cage-enrichment-58",
            "evt-cage-dead-raw-91",
          ],
        },
      },
      select: { id: true, normalizedPayloadJson: true },
    });
    const ageById = new Map(
      promoted.map((row) => [row.id, readNormalizedConsumerAgeCell(row.normalizedPayloadJson)])
    );
    assert.equal(ageById.get("evt-cage-raw-84"), "84");
    assert.equal(ageById.get("evt-cage-raw-dob"), "74");
    assert.equal(ageById.get("evt-cage-metadata-64"), "64");
    assert.equal(ageById.get("evt-cage-enrichment-58"), "58");
    // Over-maximum ages are promoted; classification is a separate decision.
    assert.equal(ageById.get("evt-cage-dead-raw-91"), "91");

    // A conflicting canonical age is reported, never overwritten, and its date
    // of birth is not written either — that would have changed the row's
    // effective commercial age behind the operator's back.
    const conflict = await db.sourceLeadEvent.findUnique({
      where: { id: "evt-cage-conflict" },
      select: { normalizedPayloadJson: true },
    });
    assert.equal(readNormalizedConsumerAgeCell(conflict?.normalizedPayloadJson), "55");
    assert.equal(readNormalizedDateOfBirthCell(conflict?.normalizedPayloadJson), "");
    assert.equal(
      third.conflicts?.some((hold) => hold.id === "cage-conflict"),
      true
    );

    // Rows with no age source anywhere stay blank and stay sellable-eligible.
    const noAge = await db.leadInventoryItem.findMany({
      where: { id: { in: ["cage-no-age-1", "cage-no-age-2", "cage-no-age-pending"] } },
      select: { id: true, status: true, commerceExcludedAt: true },
    });
    for (const row of noAge) {
      assert.equal(row.commerceExcludedAt, null);
      assert.notEqual(row.status, "expired");
    }
  });

  it("classifies unallocated over-maximum inventory as dead and leaves everything else alone", async () => {
    const result = await commitConsumerAgeOverMaximumClassification(
      { ...localGuard(100, CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION), scope: scope() },
      db
    );
    assert.equal(result.outcome, "CLASSIFIED");
    assert.deepEqual(result.classifiedIds?.sort(), ["cage-dead-87", "cage-dead-raw-91"]);

    const dead = await db.leadInventoryItem.findMany({
      where: { id: { in: ["cage-dead-87", "cage-dead-raw-91"] } },
      select: {
        id: true,
        status: true,
        expiredAt: true,
        commerceExcludedAt: true,
        commerceExcludedReason: true,
        commerceExcludedBy: true,
      },
    });
    assert.equal(dead.length, 2);
    for (const row of dead) {
      assert.equal(row.status, "expired");
      assert.notEqual(row.expiredAt, null);
      assert.notEqual(row.commerceExcludedAt, null);
      assert.equal(row.commerceExcludedReason, "consumer_age_over_86");
      assert.equal(row.commerceExcludedBy, "consumer_age_policy_v1");
    }

    // The committed, allocated over-maximum row is untouched.
    const committed = await db.leadInventoryItem.findUnique({
      where: { id: "cage-dead-committed" },
      select: { status: true, commerceExcludedAt: true, expiredAt: true },
    });
    assert.equal(committed?.status, "committed");
    assert.equal(committed?.commerceExcludedAt, null);
    assert.equal(committed?.expiredAt, null);

    // An 86-year-old is still sellable; a missing age is still recoverable.
    const survivors = await db.leadInventoryItem.findMany({
      where: { id: { in: ["cage-canonical-70", "cage-no-age-1", "cage-invalid-age"] } },
      select: { id: true, status: true, commerceExcludedAt: true },
    });
    assert.equal(survivors.length, 3);
    for (const row of survivors) {
      assert.equal(row.commerceExcludedAt, null);
      assert.notEqual(row.status, "expired");
    }

    const replay = await commitConsumerAgeOverMaximumClassification(
      { ...localGuard(100, CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION), scope: scope() },
      db
    );
    assert.equal(replay.outcome, "NOOP");
    assert.deepEqual(replay.classifiedIds, []);
    assert.equal(replay.totals?.deadClassificationCandidates, 0);
    assert.equal((replay.totals?.alreadyClassifiedDead ?? 0) >= 2, true);
  });
});
