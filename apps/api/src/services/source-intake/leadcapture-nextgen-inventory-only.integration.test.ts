import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { evaluateLeadInventoryAvailability } from "../lead-inventory/lead-inventory-availability.service.js";
import { DEFAULT_AGE_BANDS_V1 } from "../lead-inventory/lead-inventory.constants.js";
import {
  isPurchasableInventoryCommerceLifecycle,
  resolveInventoryCommerceLifecycle,
} from "../ppl-fulfillment/commerce-lifecycle.js";
import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const ANDRU_FUNNEL_ID = "18c28feb-5c3d-4bd0-94d8-1ed33a6fa718";
const ALEX_FUNNEL_ID = "22ac7ad2-97a3-4fce-bd4d-02124b6e4520";

function nextgenPayload(input: {
  leadId: string;
  funnelId: string;
  funnelName: string;
  routeKey?: string;
  email: string;
  phone: string;
}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    sa360_route_key: input.routeKey ?? "LCIO_NG_NURSE_ANDRU_DURANSO",
    campaign_id: input.routeKey ?? "LCIO_NG_NURSE_ANDRU_DURANSO",
    funnel_id: input.funnelId,
    funnel_name: input.funnelName,
    lead_id: input.leadId,
    submitted_at: "2026-01-01T00:00:00.000Z",
    first_name: "Inventory",
    last_name: "Only",
    email: input.email,
    phone: input.phone,
    state: "NC",
  };
}

describe("NextGen inventory_only canonical inventory", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db?.$disconnect();
  });

  it("captures Alex identity, one inventory item, and no fulfillment outbox", async () => {
    const first = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555501",
        funnelId: ALEX_FUNNEL_ID,
        funnelName: "Life Insurance For Nurses- Alex Feuerstein",
        email: "alex.inventory.only@example.test",
        phone: "5550109001",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(first.sourceEventId);
    const replay = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555501",
        funnelId: ALEX_FUNNEL_ID,
        funnelName: "Life Insurance For Nurses- Alex Feuerstein",
        email: "alex.inventory.only@example.test",
        phone: "5550109001",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(replay.sourceEventId);

    assert.equal(first.intakeStage, "inventory_only");
    assert.equal(first.matched, false);
    assert.equal(first.shadowOutboxEnsured, false);
    assert.equal(replay.sourceEventId, first.sourceEventId);
    assert.equal(replay.duplicate, true);

    const event = await db.sourceLeadEvent.findUnique({
      where: { id: first.sourceEventId },
      include: { leadInventoryItem: true, fulfillmentOutboxItems: true },
    });
    assert.ok(event);
    assert.equal(event?.sourceProvider, "leadcapture_io");
    assert.equal(event?.sourceSystem, "leadcapture_io_nextgen");
    assert.equal(event?.sourceCampaignId, ALEX_FUNNEL_ID);
    assert.equal(event?.clientAccountIdResolved, null);
    assert.equal(event?.fulfillmentOutboxItems.length, 0);
    assert.ok(event?.leadInventoryItem);
    assert.equal(event?.leadInventoryItem?.sourceLane, "leadcapture_io");
    assert.notEqual(event?.leadInventoryItem?.sourceLane, "lal_master_vet");
    assert.doesNotMatch(JSON.stringify(event), /lal_master_vet/);

    const items = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: first.sourceEventId },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.nicheKey, "nurse_life");
    assert.equal(items[0]?.status, "available");
    assert.equal(items[0]?.generatedAt.toISOString(), "2026-01-01T00:00:00.000Z");
  });

  it("reuses canonical inventory when the same phone arrives on a second funnel", async () => {
    const andru = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555502",
        funnelId: ANDRU_FUNNEL_ID,
        funnelName: "Life Insurance For Nurses- Andru Duranso",
        email: "shared.inventory.only@example.test",
        phone: "5550109002",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(andru.sourceEventId);
    const alex = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555503",
        funnelId: ALEX_FUNNEL_ID,
        funnelName: "Life Insurance For Nurses- Alex Feuerstein",
        email: "shared.inventory.only@example.test",
        phone: "5550109002",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(alex.sourceEventId);

    assert.notEqual(andru.sourceEventId, alex.sourceEventId);
    assert.equal(andru.inventoryTracking && "inventoryItemId" in andru.inventoryTracking
      ? andru.inventoryTracking.inventoryItemId
      : null, alex.inventoryTracking && "inventoryItemId" in alex.inventoryTracking
      ? alex.inventoryTracking.inventoryItemId
      : "missing");
    const reuseOutcome =
      alex.inventoryTracking && "outcome" in alex.inventoryTracking
        ? alex.inventoryTracking.outcome
        : null;
    assert.ok(
      reuseOutcome === "reused_phone" || reuseOutcome === "reused_email",
      `expected phone/email canonical reuse, got ${reuseOutcome}`
    );
  });

  it("keeps an aged unknown-niche funnel pending_review and non-sellable", async () => {
    const unknownFunnelId = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
    const submittedAt = "2026-07-01T00:00:00.000Z";
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        sa360_source_platform: "leadcapture_io",
        funnel_id: unknownFunnelId,
        funnel_name: "Matt Test Campaign 123",
        lead_id: "d1111111-2222-4333-8444-555555555504",
        submitted_at: submittedAt,
        first_name: "Matt",
        last_name: "Test",
        email: "matt.unknown.inventory.only@example.test",
        phone: "5550109004",
        state: "NC",
      },
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    assert.equal(result.intakeStage, "inventory_only");
    assert.equal(result.matched, false);
    assert.equal(result.shadowOutboxEnsured, false);
    assert.notEqual(result.destinationClientAccountId, "lal_master_vet");

    const event = await db.sourceLeadEvent.findUnique({
      where: { id: result.sourceEventId },
      include: { leadInventoryItem: { include: { inventoryLot: true } }, fulfillmentOutboxItems: true },
    });
    assert.ok(event);
    assert.equal(event?.sourceCampaignId, unknownFunnelId);
    assert.equal(event?.sourceProvider, "leadcapture_io");
    assert.equal(event?.sourceSystem, "leadcapture_io_nextgen");
    assert.equal(event?.clientAccountIdResolved, null);
    assert.equal(event?.fulfillmentOutboxItems.length, 0);
    assert.ok(event?.leadInventoryItem);
    assert.equal(event?.leadInventoryItem?.sourceLane, "leadcapture_io");
    assert.equal(event?.leadInventoryItem?.nicheKey, "unspecified");
    assert.equal(event?.leadInventoryItem?.status, "pending_review");
    assert.equal(event?.leadInventoryItem?.availableAt, null);
    assert.doesNotMatch(JSON.stringify(event), /lal_master_vet/);

    const item = event?.leadInventoryItem;
    assert.ok(item);
    const ageDays = calculateInventoryAgeDays(item.generatedAt, new Date("2026-08-26T00:00:00.000Z"));
    assert.ok(ageDays > 30, `expected aged lead, got ${ageDays} days`);
    assert.equal(
      isPurchasableInventoryCommerceLifecycle(resolveInventoryCommerceLifecycle(ageDays)),
      true
    );
    const availability = evaluateLeadInventoryAvailability({
      item,
      lot: item.inventoryLot,
      sourceLeadEvent: event,
      leadProof: null,
      verification: null,
      activeAllocations: [],
      ageBands: DEFAULT_AGE_BANDS_V1,
      evaluatedAt: new Date("2026-08-26T00:00:00.000Z"),
    });
    assert.equal(availability.available, false);
    assert.ok(availability.blockers.includes("item_not_available"));
  });
});
