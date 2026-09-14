import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { processFacebookSourceLead } from "./facebook-lead-intake.service.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import { processLeadCaptureIoWebhookIntake } from "./source-lead-intake.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const PREFIX = "meta_inv_safety";

function uniqueStamp(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

describe("Meta Lead Ads intake creates zero resale inventory", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdLeadUids: string[] = [];

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
      await db.fulfillmentOutbox.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    if (createdLeadUids.length > 0) {
      await db.leadProof.deleteMany({ where: { leadUid: { in: createdLeadUids } } });
      await db.metaDispatchAttempt.deleteMany({ where: { eventUuid: { in: createdLeadUids } } });
    }
    await db?.$disconnect();
  });

  async function assertZeroInventoryAndNoLiveSideEffects(eventId: string, leadUid: string) {
    const event = await db.sourceLeadEvent.findUnique({
      where: { id: eventId },
      include: { leadInventoryItem: true, fulfillmentOutboxItems: true },
    });
    assert.ok(event);
    assert.equal(event?.sourceProvider, "facebook");
    assert.equal(event?.sourceSystem, "meta_lead_ads");
    assert.equal(event?.leadInventoryItem, null);
    const items = await db.leadInventoryItem.findMany({ where: { sourceLeadEventId: eventId } });
    assert.equal(items.length, 0);
    assert.equal(event?.fulfillmentOutboxItems.length, 0);
    assert.equal(event?.deliveryResultJson, null);

    const payload = event?.normalizedPayloadJson as {
      event?: { send_to_meta?: boolean; event_uuid?: string };
      attribution?: { source_platform?: string; source_type?: string };
    } | null;
    assert.equal(payload?.event?.send_to_meta, false);
    assert.equal(payload?.attribution?.source_platform, "facebook");
    assert.equal(payload?.attribution?.source_type, "facebook_lead_form");

    const dispatchCount = await db.metaDispatchAttempt.count({
      where: {
        OR: [
          { eventUuid: leadUid },
          ...(payload?.event?.event_uuid ? [{ eventUuid: payload.event.event_uuid }] : []),
        ],
      },
    });
    assert.equal(dispatchCount, 0);

    if (event?.routingDryRunDecisionId) {
      const liveRuns = await db.ghlLiveDeliveryRun.count({
        where: { routingDryRunDecisionId: event.routingDryRunDecisionId },
      });
      assert.equal(liveRuns, 0);
    }
  }

  it("A. direct Meta intake creates zero LeadInventoryItem rows", async () => {
    const stamp = uniqueStamp();
    const leadgenId = `${PREFIX}-a-${stamp}`;
    const result = await processFacebookSourceLead({
      fields: {
        leadgenId,
        formId: `form-${PREFIX}-a`,
        campaignId: `camp-${PREFIX}-a`,
        campaignName: "Meta Safety Direct",
        firstName: "Meta",
        lastName: "Direct",
        email: `meta.direct.${stamp}@example.test`,
        phone: `+1555010${stamp.slice(-4)}`,
        state: "TX",
        createdTime: "2026-03-15T12:00:00.000Z",
      },
      rawPayloadJson: { leadgenId, safety: "direct" },
      masterClientAccountId: "lal_master_vet",
    });
    createdEventIds.push(result.sourceEventId);
    createdLeadUids.push(result.normalizedLeadUid);
    assert.equal(result.ok, true);
    assert.equal(result.provider, "facebook");
    assert.equal("inventoryTracking" in result, false);
    await assertZeroInventoryAndNoLiveSideEffects(result.sourceEventId, result.normalizedLeadUid);
    const stored = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.ok(stored?.rawPayloadJson);
    assert.ok(stored?.normalizedPayloadJson);
  });

  it("B. repeated Meta intake creates zero LeadInventoryItem rows", async () => {
    const stamp = uniqueStamp();
    const sharedFields = {
      formId: `form-${PREFIX}-b`,
      campaignId: `camp-${PREFIX}-b`,
      campaignName: "Meta Safety Repeat",
      firstName: "Meta",
      lastName: "Repeat",
      email: `meta.repeat.${stamp}@example.test`,
      phone: `+1555011${stamp.slice(-4)}`,
      state: "NC",
      createdTime: "2026-03-15T12:00:00.000Z",
    };
    const first = await processFacebookSourceLead({
      fields: { ...sharedFields, leadgenId: `${PREFIX}-b1-${stamp}` },
      rawPayloadJson: { safety: "repeat-1" },
      masterClientAccountId: "lal_master_vet",
    });
    const replay = await processFacebookSourceLead({
      fields: { ...sharedFields, leadgenId: `${PREFIX}-b1-${stamp}` },
      rawPayloadJson: { safety: "repeat-1-replay" },
      masterClientAccountId: "lal_master_vet",
    });
    const second = await processFacebookSourceLead({
      fields: { ...sharedFields, leadgenId: `${PREFIX}-b2-${stamp}` },
      rawPayloadJson: { safety: "repeat-2" },
      masterClientAccountId: "lal_master_vet",
    });
    createdEventIds.push(first.sourceEventId, replay.sourceEventId, second.sourceEventId);
    createdLeadUids.push(first.normalizedLeadUid, replay.normalizedLeadUid, second.normalizedLeadUid);

    const items = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { in: [first.sourceEventId, replay.sourceEventId, second.sourceEventId] } },
    });
    assert.equal(items.length, 0);
    await assertZeroInventoryAndNoLiveSideEffects(first.sourceEventId, first.normalizedLeadUid);
    await assertZeroInventoryAndNoLiveSideEffects(replay.sourceEventId, replay.normalizedLeadUid);
    await assertZeroInventoryAndNoLiveSideEffects(second.sourceEventId, second.normalizedLeadUid);
  });

  it("C. unmatched Meta intake creates zero LeadInventoryItem rows", async () => {
    const stamp = uniqueStamp();
    const result = await processFacebookSourceLead({
      fields: {
        leadgenId: `${PREFIX}-c-${stamp}`,
        formId: `form-${PREFIX}-unmatched-${stamp}`,
        campaignId: `camp-${PREFIX}-unmatched-${stamp}`,
        campaignName: "Meta Safety Unmatched",
        firstName: "Meta",
        lastName: "Unmatched",
        email: `meta.unmatched.${stamp}@example.test`,
        phone: `+1555012${stamp.slice(-4)}`,
        state: "FL",
      },
      rawPayloadJson: { safety: "unmatched" },
      masterClientAccountId: "lal_master_vet",
    });
    createdEventIds.push(result.sourceEventId);
    createdLeadUids.push(result.normalizedLeadUid);
    assert.equal(result.matched, false);
    assert.equal(result.status === "routing_unmatched" || result.status === "needs_review", true);
    await assertZeroInventoryAndNoLiveSideEffects(result.sourceEventId, result.normalizedLeadUid);
  });

  it("D. LeadCapture legacy inventory still creates a LeadInventoryItem", async () => {
    const stamp = uniqueStamp();
    const leadId = `lc_legacy_${stamp}`;
    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_route_key: `LC_SAFETY_LEGACY_${stamp}`,
        sa360_source_system: "leadcapture_io_legacy",
        sa360_source_platform: "leadcapture_io",
        sa360_source_type: "leadcapture_form",
        niche_key: "VET",
        lead_id: leadId,
        submitted_at: "2026-06-12T14:30:00.000Z",
        first_name: "Legacy",
        last_name: "Safety",
        email: `legacy.safety.${stamp}@example.test`,
        phone: `+1555013${stamp.slice(-4)}`,
        state: "TN",
      },
    });
    createdEventIds.push(result.sourceEventId);
    createdLeadUids.push(result.normalizedLeadUid);
    assert.equal(result.ok, true);
    assert.equal(result.provider, "leadcapture_io");
    assert.equal(result.inventoryTracking?.ok, true);
    if (result.inventoryTracking?.ok) {
      assert.equal(result.inventoryTracking.outcome, "created");
      assert.ok(result.inventoryTracking.inventoryItemId);
      assert.equal(result.inventoryTracking.sourceLane, "leadcapture_io");
    }
    const items = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]?.sourceLane, "leadcapture_io");
    assert.notEqual(items[0]?.sourceLane, "meta_lead_ads");
  });

  it("E. LeadCapture NextGen inventory_only still creates a LeadInventoryItem", async () => {
    const stamp = uniqueStamp();
    const funnelId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee9901";
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        sa360_source_platform: "leadcapture_io",
        sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
        campaign_id: "LCIO_NG_NURSE_ANDRU_DURANSO",
        funnel_id: funnelId,
        funnel_name: "Life Insurance For Nurses- Safety Canary",
        lead_id: randomUUID(),
        submitted_at: "2026-01-01T00:00:00.000Z",
        first_name: "Nextgen",
        last_name: "Safety",
        email: `nextgen.safety.${stamp}@example.test`,
        phone: `+1555014${stamp.slice(-4)}`,
        state: "NC",
      },
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);
    if (result.normalizedLeadUid) createdLeadUids.push(result.normalizedLeadUid);
    assert.equal(result.ok, true);
    assert.equal(result.intakeStage, "inventory_only");
    assert.equal(result.shadowOutboxEnsured, false);
    assert.equal(result.inventoryTracking?.ok, true);
    if (result.inventoryTracking?.ok) {
      assert.equal(result.inventoryTracking.outcome, "created");
      assert.ok(result.inventoryTracking.inventoryItemId);
      assert.equal(result.inventoryTracking.sourceLane, "leadcapture_io");
    }
    const event = await db.sourceLeadEvent.findUnique({
      where: { id: result.sourceEventId },
      include: { leadInventoryItem: true, fulfillmentOutboxItems: true },
    });
    assert.ok(event?.leadInventoryItem);
    assert.equal(event?.leadInventoryItem?.sourceLane, "leadcapture_io");
    assert.equal(event?.fulfillmentOutboxItems.length, 0);
  });
});
