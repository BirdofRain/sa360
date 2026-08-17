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

  it("same Meta source lead ID concurrently creates one inventory item", async () => {
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
    const inventoryIds = new Set([first.ok && first.inventoryItemId, second.ok && second.inventoryItemId]);
    assert.equal(inventoryIds.size, 1);
    const { byFingerprint } = await assertSingleInventory([a.id, b.id]);
    const unique = new Set(byFingerprint.map((row) => row.id));
    assert.equal(unique.size, 1);
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

  it("same phone across two events concurrently creates one inventory item", async () => {
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
    const ids = new Set(results.map((row) => (row.ok ? row.inventoryItemId : null)));
    assert.equal(ids.size, 1);
    assert.equal(results.every((row) => row.ok), true);
  });

  it("same email across two events concurrently creates one inventory item", async () => {
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
    const ids = new Set(results.map((row) => (row.ok ? row.inventoryItemId : null)));
    assert.equal(ids.size, 1);
  });

  it("Meta + LeadCapture same consumer concurrently creates one inventory item", async () => {
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
    const ids = new Set(results.map((row) => (row.ok ? row.inventoryItemId : null)));
    assert.equal(ids.size, 1);
    const events = await db.sourceLeadEvent.findMany({ where: { id: { in: [meta.id, lc.id] } } });
    assert.equal(events.length, 2);
    const tracked = events.map((event) => {
      const enrichment = event.enrichmentMetadataJson as { inventoryTracking?: { inventoryItemId?: string } } | null;
      return enrichment?.inventoryTracking?.inventoryItemId ?? null;
    });
    assert.ok(tracked.every((id) => id && id === [...ids][0]));
  });

  it("retries after a transaction conflict still yield one inventory item", async () => {
    const stamp = `${Date.now()}-retry`;
    const phone = `+1555600${String(Date.now()).slice(-4)}`;
    const event = await createCampaignEvent(db, {
      idSuffix: stamp,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: `retry-${stamp}`,
      phone,
      email: `retry-${stamp}@example.test`,
    });
    const first = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
      db
    );
    const replay = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: event.id, sourceLane: "meta_lead_ads" },
      db
    );
    assert.equal(first.ok && first.outcome === "created", true);
    assert.equal(replay.ok && replay.outcome === "reused_same_event", true);
    assert.equal(first.ok && replay.ok && first.inventoryItemId === replay.inventoryItemId, true);
  });
});
