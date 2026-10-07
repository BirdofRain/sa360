/**
 * Automatic dead classification at inventory creation and activation.
 *
 * Business rule: a known consumer age above the maximum sellable age is a
 * permanent defect, so such inventory must never appear operationally as
 * available. A missing or unusable age is a different thing entirely — it is
 * recoverable enrichment and stays live.
 *
 * Every assertion here runs against the real local database so the lifecycle
 * stamp, the transaction boundary, and the row lock are all exercised.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient, type LeadInventoryItemStatus, type Prisma } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { trackCampaignInventoryFromSourceEvent } from "../lead-inventory/campaign-inventory-tracking.service.js";
import { classifyConsumerAgeOverMaximumTransactionally } from "./consumer-age-dead-classification.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);

const LOT_KEY = "cage-activate-lot";
const SCOPE_LANE = "aged_inventory_csv_cage_activate";

/** Fixed clock: 1939-06-14 is 87 on this date, 1939-06-16 is still 86. */
const NOW = new Date("2026-06-15T00:00:00.000Z");
const DOB_AGE_87 = "1939-06-14";
const DOB_AGE_86 = "1939-06-16";

/**
 * Creation and activation paths stamp against the real wall clock, not a test
 * clock, so those fixtures derive their date of birth from today.
 */
function dobForAgeToday(age: number): string {
  const today = new Date();
  const birth = new Date(
    Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), today.getUTCDate())
  );
  return birth.toISOString().slice(0, 10);
}

type LeadDetails = { consumer_age?: string; date_of_birth?: string };

describe("consumer age dead classification at creation and activation", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let lotId: string;
  const createdEventIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });

    const lot = await db.inventoryLot.upsert({
      where: { lotKey: LOT_KEY },
      create: {
        lotKey: LOT_KEY,
        displayName: "Consumer age activation lot",
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
  });

  after(async () => {
    if (!db) return;
    await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    await db.inventoryLot.deleteMany({ where: { lotKey: LOT_KEY } });
    await db.$disconnect();
  });

  /** Seed one source event plus one inventory row directly, as an import would. */
  async function seedItem(input: {
    suffix: string;
    leadDetails: LeadDetails;
    status?: LeadInventoryItemStatus;
  }) {
    const stamp = `${Date.now()}-${input.suffix}`;
    const event = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "manual_import",
        sourceSystem: "csv_import",
        sourceType: "bulk_import",
        sourceLeadId: `cage-activate-${stamp}`,
        status: "normalized",
        rawPayloadJson: { importRequestId: "cage-activate" },
        normalizedPayloadJson: {
          contact: { first_name: "Ada", last_name: "Stone", state: "GA" },
          niche_key: "veteran",
          lead_details: input.leadDetails as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
        enrichmentMetadataJson: { sourceLane: SCOPE_LANE } as Prisma.InputJsonValue,
        receivedAt: new Date(),
      },
    });
    createdEventIds.push(event.id);

    const status = input.status ?? "available";
    const item = await db.leadInventoryItem.create({
      data: {
        inventoryLotId: lotId,
        sourceLeadEventId: event.id,
        generatedAt: new Date("2026-05-01T00:00:00.000Z"),
        normalizedState: "GA",
        nicheKey: "veteran",
        sourceProvider: "manual_import",
        sourceLane: SCOPE_LANE,
        inventoryClass: "aged",
        exclusivityMode: "exclusive",
        status,
        availableAt: status === "available" ? new Date() : null,
        reservedAt: status === "reserved" ? new Date() : null,
        metadataJson: { importRequestId: "cage-activate" } as Prisma.InputJsonValue,
      },
    });
    return item;
  }

  function readItem(id: string) {
    return db.leadInventoryItem.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        status: true,
        expiredAt: true,
        commerceExcludedAt: true,
        commerceExcludedReason: true,
        commerceExcludedBy: true,
      },
    });
  }

  it("stamps a date-of-birth lead that is already over the maximum age as dead", async () => {
    const item = await seedItem({ suffix: "dob87", leadDetails: { date_of_birth: DOB_AGE_87 } });
    const outcome = await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW);
    assert.equal(outcome, "classified");

    const row = await readItem(item.id);
    assert.equal(row.status, "expired");
    assert.notEqual(row.expiredAt, null);
    assert.notEqual(row.commerceExcludedAt, null);
    assert.equal(row.commerceExcludedReason, "consumer_age_over_86");
    assert.equal(row.commerceExcludedBy, "consumer_age_policy_v1");
  });

  it("holds an over-maximum row whose canonical age disagrees with its date of birth", async () => {
    // The resolver prefers the date of birth, so this row reads as 87 even
    // though a human recorded 55. Stamping it permanently dead is as automatic
    // a mutation as rewriting the value, and the date of birth may be the wrong
    // one. Reservation refuses it either way, so the writer holds it.
    const item = await seedItem({
      suffix: "conflict87",
      leadDetails: { consumer_age: "55", date_of_birth: DOB_AGE_87 },
    });
    const outcome = await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW);
    assert.equal(outcome, "canonical_age_conflict");

    const row = await readItem(item.id);
    assert.equal(row.status, "available");
    assert.equal(row.commerceExcludedAt, null);
    assert.equal(row.commerceExcludedReason, null);
    assert.equal(row.expiredAt, null);
  });

  it("still stamps an over-maximum row whose canonical age agrees with its date of birth", async () => {
    const item = await seedItem({
      suffix: "agree87",
      leadDetails: { consumer_age: "87", date_of_birth: DOB_AGE_87 },
    });
    assert.equal(await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW), "classified");
    assert.equal((await readItem(item.id)).status, "expired");
  });

  it("stamps an over-maximum stored age that has no date of birth to disagree with", async () => {
    const item = await seedItem({ suffix: "stored90", leadDetails: { consumer_age: "90" } });
    assert.equal(await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW), "classified");
    assert.equal((await readItem(item.id)).status, "expired");
  });

  it("leaves a lead who is still 86 today live", async () => {
    const item = await seedItem({ suffix: "dob86", leadDetails: { date_of_birth: DOB_AGE_86 } });
    const outcome = await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW);
    assert.equal(outcome, "age_no_longer_over_maximum");

    const row = await readItem(item.id);
    assert.equal(row.status, "available");
    assert.equal(row.commerceExcludedAt, null);
    assert.equal(row.expiredAt, null);
  });

  it("picks up a date-of-birth lead the day after it crosses the maximum", async () => {
    const item = await seedItem({ suffix: "crossing", leadDetails: { date_of_birth: DOB_AGE_86 } });

    // On the 15th the lead is 86 and stays live.
    assert.equal(
      await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW),
      "age_no_longer_over_maximum"
    );
    assert.equal((await readItem(item.id)).status, "available");

    // The sweep runs again on the 16th, the lead's 87th birthday.
    const tomorrow = new Date("2026-06-16T00:00:00.000Z");
    assert.equal(
      await classifyConsumerAgeOverMaximumTransactionally(db, item.id, tomorrow),
      "classified"
    );
    const row = await readItem(item.id);
    assert.equal(row.status, "expired");
    assert.equal(row.commerceExcludedReason, "consumer_age_over_86");
  });

  it("keeps a missing age recoverable rather than dead", async () => {
    const item = await seedItem({ suffix: "noage", leadDetails: {} });
    const outcome = await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW);
    assert.equal(outcome, "age_no_longer_over_maximum");

    const row = await readItem(item.id);
    assert.equal(row.status, "available");
    assert.equal(row.commerceExcludedAt, null);
  });

  it("keeps an unusable age recoverable rather than dead", async () => {
    const item = await seedItem({
      suffix: "badage",
      leadDetails: { consumer_age: "not-an-age" },
    });
    const outcome = await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW);
    assert.equal(outcome, "age_no_longer_over_maximum");

    const row = await readItem(item.id);
    assert.equal(row.status, "available");
    assert.equal(row.commerceExcludedAt, null);
  });

  it("never modifies reserved, committed, or fulfilled inventory", async () => {
    for (const status of ["reserved", "committed", "fulfilled"] as const) {
      const item = await seedItem({
        suffix: `held-${status}`,
        leadDetails: { consumer_age: "92" },
        status,
      });
      const outcome = await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW);
      assert.equal(outcome, "blocked_status", status);

      const row = await readItem(item.id);
      assert.equal(row.status, status);
      assert.equal(row.commerceExcludedAt, null, status);
      assert.equal(row.expiredAt, null, status);
    }
  });

  it("is idempotent: a second classification writes nothing new", async () => {
    const item = await seedItem({ suffix: "idem", leadDetails: { consumer_age: "95" } });
    assert.equal(await classifyConsumerAgeOverMaximumTransactionally(db, item.id, NOW), "classified");
    const first = await readItem(item.id);

    const later = new Date("2026-07-01T00:00:00.000Z");
    assert.equal(
      await classifyConsumerAgeOverMaximumTransactionally(db, item.id, later),
      "already_excluded"
    );
    const second = await readItem(item.id);
    assert.deepEqual(second, first);
  });

  it("refuses to classify an inventory id that does not exist", async () => {
    const outcome = await classifyConsumerAgeOverMaximumTransactionally(
      db,
      "cage-activate-missing-id",
      NOW
    );
    assert.equal(outcome, "item_not_found");
  });

  it("classifies a newly created campaign inventory row inside the creation transaction", async () => {
    const stamp = `${Date.now()}-create`;
    const event = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `22222222-3333-4444-8555-${stamp.slice(-12).padStart(12, "0")}`,
        sourceLeadUid: `cage-create-${stamp}`,
        sourceCampaignId: "camp_cage_create",
        sourceCampaignName: "Consumer age creation",
        status: "received",
        rawPayloadJson: { id: `cage-create-${stamp}` },
        normalizedPayloadJson: {
          contact: {
            first_name: "Pat",
            last_name: "Lead",
            phone_e164: `+1555300${String(Date.now()).slice(-4)}`,
            email: `cage-create-${stamp}@example.test`,
            state: "NC",
          },
          lead_details: { date_of_birth: dobForAgeToday(90) },
          routing: {
            niche_key: "vet",
            source_intake: {
              submitted_at: "2026-05-01T00:00:00.000Z",
              generated_at: "2026-05-01T00:00:00.000Z",
            },
          },
        } as Prisma.InputJsonValue,
      },
    });
    createdEventIds.push(event.id);

    const result = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: event.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(result.ok, true);

    const created = await db.leadInventoryItem.findFirstOrThrow({
      where: { sourceLeadEventId: event.id },
      select: {
        id: true,
        status: true,
        expiredAt: true,
        commerceExcludedAt: true,
        commerceExcludedReason: true,
        commerceExcludedBy: true,
      },
    });
    // The row never had an operationally available moment.
    assert.equal(created.status, "expired");
    assert.notEqual(created.expiredAt, null);
    assert.equal(created.commerceExcludedReason, "consumer_age_over_86");
    assert.equal(created.commerceExcludedBy, "consumer_age_policy_v1");
    assert.equal(result.ok && result.inventoryStatus, null);
  });

  it("leaves a newly created campaign inventory row with a sellable age alone", async () => {
    const stamp = `${Date.now()}-create-ok`;
    const event = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceLeadId: `33333333-4444-4555-8666-${stamp.slice(-12).padStart(12, "0")}`,
        sourceLeadUid: `cage-create-ok-${stamp}`,
        sourceCampaignId: "camp_cage_create",
        sourceCampaignName: "Consumer age creation",
        status: "received",
        rawPayloadJson: { id: `cage-create-ok-${stamp}` },
        normalizedPayloadJson: {
          contact: {
            first_name: "Pat",
            last_name: "Lead",
            phone_e164: `+1555400${String(Date.now()).slice(-4)}`,
            email: `cage-create-ok-${stamp}@example.test`,
            state: "NC",
          },
          lead_details: { date_of_birth: dobForAgeToday(70) },
          routing: {
            niche_key: "vet",
            source_intake: {
              submitted_at: "2026-05-01T00:00:00.000Z",
              generated_at: "2026-05-01T00:00:00.000Z",
            },
          },
        } as Prisma.InputJsonValue,
      },
    });
    createdEventIds.push(event.id);

    const result = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: event.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(result.ok, true);

    const created = await db.leadInventoryItem.findFirstOrThrow({
      where: { sourceLeadEventId: event.id },
      select: { status: true, commerceExcludedAt: true, expiredAt: true },
    });
    assert.notEqual(created.status, "expired");
    assert.equal(created.commerceExcludedAt, null);
    assert.equal(created.expiredAt, null);
  });
});
