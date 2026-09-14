import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { trackCampaignInventoryFromSourceEvent } from "./campaign-inventory-tracking.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

async function createCampaignEvent(
  db: PrismaClient,
  input: {
    idSuffix: string;
    sourceProvider: "facebook" | "leadcapture_io";
    sourceSystem: "meta_lead_ads" | "leadcapture_io_nextgen";
    sourceLeadId: string;
    phone: string;
    email: string;
  }
) {
  return db.sourceLeadEvent.create({
    data: {
      sourceProvider: input.sourceProvider,
      sourceSystem: input.sourceSystem,
      sourceType: "webhook",
      sourceLeadId: input.sourceLeadId,
      sourceLeadUid: `${input.sourceProvider}-${input.sourceSystem}-${input.sourceLeadId}-${input.idSuffix}`,
      sourceCampaignId: "camp_conc",
      sourceCampaignName: "Concurrency",
      status: "received",
      rawPayloadJson: { id: input.sourceLeadId },
      normalizedPayloadJson: {
        contact: {
          first_name: "Pat",
          last_name: "Lead",
          phone_e164: input.phone,
          email: input.email,
          state: "NC",
        },
        routing: {
          niche_key: "vet",
          source_intake: {
            submitted_at: "2026-01-01T00:00:00.000Z",
            generated_at: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    },
  });
}

describe("campaign inventory concurrent dedup", { skip: !runIntegration }, () => {
  let db: PrismaClient;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    await db?.$disconnect();
  });

  async function assertSingleInventory(eventIds: string[]) {
    const items = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { in: eventIds } },
    });
    const byFingerprint = await db.leadInventoryItem.findMany({
      where: {
        OR: items.flatMap((item) => [
          item.phoneFingerprint ? { phoneFingerprint: item.phoneFingerprint } : {},
          item.emailFingerprint ? { emailFingerprint: item.emailFingerprint } : {},
        ]).filter((clause) => Object.keys(clause).length > 0),
      },
    });
    return { items, byFingerprint };
  }

  it("same Meta source lead ID concurrently creates zero inventory items", async () => {
    const stamp = `${Date.now()}-meta`;
    const a = await createCampaignEvent(db, {
      idSuffix: `${stamp}-a`,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `meta-${stamp}`,
      phone: `+1555100${String(Date.now()).slice(-4)}`,
      email: `meta-${stamp}@example.test`,
    });
    const b = await createCampaignEvent(db, {
      idSuffix: `${stamp}-b`,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `meta-${stamp}`,
      phone: a.normalizedPayloadJson
        ? ((a.normalizedPayloadJson as { contact: { phone_e164: string } }).contact.phone_e164)
        : "+15551000001",
      email: `meta-${stamp}@example.test`,
    });

    const [first, second] = await Promise.all([
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: a.id, sourceLane: "meta_lead_ads" }, db),
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: b.id, sourceLane: "meta_lead_ads" }, db),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.ok && first.outcome === "skipped_not_resale_supply", true);
    assert.equal(second.ok && second.outcome === "skipped_not_resale_supply", true);
    assert.equal(first.ok && first.inventoryItemId, null);
    assert.equal(second.ok && second.inventoryItemId, null);
    const { items, byFingerprint } = await assertSingleInventory([a.id, b.id]);
    assert.equal(items.length, 0);
    assert.equal(byFingerprint.length, 0);
  });

  it("same LeadCapture source lead ID concurrently creates one inventory item", async () => {
    const stamp = `${Date.now()}-lc`;
    const phone = `+1555200${String(Date.now()).slice(-4)}`;
    const email = `lc-${stamp}@example.test`;
    const a = await createCampaignEvent(db, {
      idSuffix: `${stamp}-a`,
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: `11111111-2222-4333-8444-${stamp.slice(-12).padStart(12, "0")}`,
      phone,
      email,
    });
    const b = await createCampaignEvent(db, {
      idSuffix: `${stamp}-b`,
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: a.sourceLeadId ?? `lc-${stamp}`,
      phone,
      email,
    });
    const [first, second] = await Promise.all([
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: a.id, sourceLane: "leadcapture_io" }, db),
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: b.id, sourceLane: "leadcapture_io" }, db),
    ]);
    assert.equal(first.ok && second.ok, true);
    assert.equal(first.ok && second.ok && first.inventoryItemId === second.inventoryItemId, true);
  });

  it("same phone across two Meta events concurrently creates zero inventory items", async () => {
    const stamp = `${Date.now()}-phone`;
    const phone = `+1555300${String(Date.now()).slice(-4)}`;
    const a = await createCampaignEvent(db, {
      idSuffix: `${stamp}-a`,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `phone-a-${stamp}`,
      phone,
      email: `phone-a-${stamp}@example.test`,
    });
    const b = await createCampaignEvent(db, {
      idSuffix: `${stamp}-b`,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `phone-b-${stamp}`,
      phone,
      email: `phone-b-${stamp}@example.test`,
    });
    const results = await Promise.all([
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: a.id, sourceLane: "meta_lead_ads" }, db),
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: b.id, sourceLane: "meta_lead_ads" }, db),
    ]);
    assert.equal(results.every((row) => row.ok && row.outcome === "skipped_not_resale_supply"), true);
    const ids = new Set(results.map((row) => (row.ok ? row.inventoryItemId : "missing")));
    assert.equal(ids.size, 1);
    assert.equal([...ids][0], null);
    const { items } = await assertSingleInventory([a.id, b.id]);
    assert.equal(items.length, 0);
  });

  it("same email across two Meta events concurrently creates zero inventory items", async () => {
    const stamp = `${Date.now()}-email`;
    const email = `email-${stamp}@example.test`;
    const a = await createCampaignEvent(db, {
      idSuffix: `${stamp}-a`,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `email-a-${stamp}`,
      phone: `+1555400${String(Date.now()).slice(-4)}1`,
      email,
    });
    const b = await createCampaignEvent(db, {
      idSuffix: `${stamp}-b`,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `email-b-${stamp}`,
      phone: `+1555400${String(Date.now()).slice(-4)}2`,
      email,
    });
    const results = await Promise.all([
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: a.id, sourceLane: "meta_lead_ads" }, db),
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: b.id, sourceLane: "meta_lead_ads" }, db),
    ]);
    assert.equal(results.every((row) => row.ok && row.outcome === "skipped_not_resale_supply"), true);
    const ids = new Set(results.map((row) => (row.ok ? row.inventoryItemId : "missing")));
    assert.equal(ids.size, 1);
    assert.equal([...ids][0], null);
    const { items } = await assertSingleInventory([a.id, b.id]);
    assert.equal(items.length, 0);
  });

  it("Meta + LeadCapture same consumer creates inventory only for LeadCapture", async () => {
    const stamp = `${Date.now()}-xsrc`;
    const phone = `+1555500${String(Date.now()).slice(-4)}`;
    const email = `xsrc-${stamp}@example.test`;
    const meta = await createCampaignEvent(db, {
      idSuffix: `${stamp}-meta`,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `xsrc-meta-${stamp}`,
      phone,
      email,
    });
    const lc = await createCampaignEvent(db, {
      idSuffix: `${stamp}-lc`,
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: `22222222-3333-4444-8555-${stamp.slice(-12).padStart(12, "0")}`,
      phone,
      email,
    });
    const results = await Promise.all([
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: meta.id, sourceLane: "meta_lead_ads" }, db),
      trackCampaignInventoryFromSourceEvent({ sourceLeadEventId: lc.id, sourceLane: "leadcapture_io" }, db),
    ]);
    assert.equal(results.every((row) => row.ok), true);
    const metaResult = results[0];
    const lcResult = results[1];
    assert.equal(metaResult?.ok && metaResult.outcome === "skipped_not_resale_supply", true);
    assert.equal(metaResult?.ok && metaResult.inventoryItemId, null);
    assert.equal(lcResult?.ok && lcResult.outcome === "created", true);
    assert.ok(lcResult?.ok && lcResult.inventoryItemId);
    const items = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { in: [meta.id, lc.id] } },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.sourceLeadEventId, lc.id);
    assert.equal(items[0]?.sourceLane, "leadcapture_io");
    const events = await db.sourceLeadEvent.findMany({ where: { id: { in: [meta.id, lc.id] } } });
    assert.equal(events.length, 2);
    const metaEvent = events.find((event) => event.id === meta.id);
    const lcEvent = events.find((event) => event.id === lc.id);
    const metaTracking = metaEvent?.enrichmentMetadataJson as { inventoryTracking?: { inventoryItemId?: string } } | null;
    const lcTracking = lcEvent?.enrichmentMetadataJson as { inventoryTracking?: { inventoryItemId?: string } } | null;
    assert.equal(metaTracking?.inventoryTracking?.inventoryItemId ?? null, null);
    assert.equal(lcTracking?.inventoryTracking?.inventoryItemId, items[0]?.id);
  });

  it("retries after a transaction conflict still yield one LeadCapture inventory item", async () => {
    const stamp = `${Date.now()}-retry`;
    const phone = `+1555600${String(Date.now()).slice(-4)}`;
    const event = await createCampaignEvent(db, {
      idSuffix: stamp,
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: `11111111-2222-4333-8444-${stamp.slice(-12).padStart(12, "0")}`,
      phone,
      email: `retry-${stamp}@example.test`,
    });
    const first = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: event.id, sourceLane: "leadcapture_io" },
      db
    );
    const replay = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: event.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(first.ok && first.outcome === "created", true);
    assert.equal(replay.ok && replay.outcome === "reused_same_event", true);
    assert.equal(first.ok && replay.ok && first.inventoryItemId === replay.inventoryItemId, true);
  });

  it("repeated Meta tracking retries still create zero inventory items", async () => {
    const stamp = `${Date.now()}-meta-retry`;
    const phone = `+1555700${String(Date.now()).slice(-4)}`;
    const event = await createCampaignEvent(db, {
      idSuffix: stamp,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `retry-meta-${stamp}`,
      phone,
      email: `retry-meta-${stamp}@example.test`,
    });
    const first = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
      db
    );
    const replay = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
      db
    );
    assert.equal(first.ok && first.outcome === "skipped_not_resale_supply", true);
    assert.equal(replay.ok && replay.outcome === "skipped_not_resale_supply", true);
    assert.equal(first.ok && first.inventoryItemId, null);
    assert.equal(replay.ok && replay.inventoryItemId, null);
    const items = await db.leadInventoryItem.findMany({ where: { sourceLeadEventId: event.id } });
    assert.equal(items.length, 0);
  });
});
