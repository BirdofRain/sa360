import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Fastify from "fastify";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminRoutes } from "../../routes/admin.js";
import { trackCampaignInventoryFromSourceEvent } from "../lead-inventory/campaign-inventory-tracking.service.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import { getSourceIntakeTrace } from "./source-intake-trace.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const HEADER = "x-sa360-admin-key";

const CONTACT_LEAK =
  /5550177|hidden\.xsource|first_name|rawPayload|phoneFingerprint|emailFingerprint|normalizedPayload|client-unrelated-xsource/i;

function assertFailure(
  result: { ok: boolean; status?: number; code?: string; error?: string },
  status: number,
  code: string,
  errorIncludes?: string
) {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, status);
  assert.equal(result.code, code);
  if (errorIncludes) assert.match(result.error, new RegExp(errorIncludes));
  assert.equal(CONTACT_LEAK.test(JSON.stringify(result)), false);
}

describe("source intake trace cross-source inventory", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdLotIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.fulfillmentOutbox.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.leadAllocation.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    if (createdLotIds.length > 0) {
      await db.inventoryLot.deleteMany({ where: { id: { in: createdLotIds } } });
    }
    await db?.$disconnect();
  });

  async function insertEvent(data: {
    sourceProvider: "leadcapture_io" | "facebook" | "manual_import";
    sourceSystem: "leadcapture_io_nextgen" | "leadcapture_io_legacy" | "meta_lead_ads" | "csv_import";
    sourceType?: "webhook" | "bulk_import";
    sourceLeadId?: string;
    normalizedPayloadJson?: Record<string, unknown>;
    enrichmentMetadataJson?: Record<string, unknown>;
    clientAccountIdResolved?: string;
    receivedAt?: Date;
  }) {
    const row = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: data.sourceProvider,
        sourceSystem: data.sourceSystem,
        sourceType: data.sourceType ?? "webhook",
        status: "normalized",
        sourceLeadId: data.sourceLeadId,
        clientAccountIdResolved: data.clientAccountIdResolved,
        rawPayloadJson: { marker: "fixture-not-for-trace" },
        normalizedPayloadJson: data.normalizedPayloadJson as Prisma.InputJsonValue | undefined,
        enrichmentMetadataJson: data.enrichmentMetadataJson as Prisma.InputJsonValue | undefined,
        receivedAt: data.receivedAt,
      },
    });
    createdEventIds.push(row.id);
    return row;
  }

  async function canonicalNextGen(input: { leadId: string; phone: string; email: string }) {
    const created = await processLeadCaptureNextGenLeadCreated({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        sa360_source_platform: "leadcapture_io",
        funnel_id: "a1770001-5c3d-4bd0-94d8-1ed33a6fa718",
        funnel_name: "Cross Source Trace",
        lead_id: input.leadId,
        first_name: "Hidden",
        last_name: "Xsource",
        email: input.email,
        phone: input.phone,
        state: "NC",
        submitted_at: "2026-01-01T00:00:00.000Z",
      },
      stageOverride: "inventory_only",
    });
    createdEventIds.push(created.sourceEventId);
    const item = await db.leadInventoryItem.findUniqueOrThrow({
      where: { sourceLeadEventId: created.sourceEventId },
    });
    const event = await db.sourceLeadEvent.findUniqueOrThrow({
      where: { id: created.sourceEventId },
      select: { normalizedPayloadJson: true },
    });
    const payload = event.normalizedPayloadJson as { contact?: { phone_e164?: string; email?: string } };
    return {
      created,
      item,
      phoneE164: payload.contact?.phone_e164 ?? "",
      email: payload.contact?.email ?? "",
    };
  }

  it("reuses canonical inventory for a later event from the same source", async () => {
    const phone = "5550177001";
    const email = "same.xsource@example.test";
    const first = await canonicalNextGen({
      leadId: "e1770001-2222-4333-8444-555555555701",
      phone,
      email,
    });
    const second = await processLeadCaptureNextGenLeadCreated({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        sa360_source_platform: "leadcapture_io",
        funnel_id: "a1770002-5c3d-4bd0-94d8-1ed33a6fa718",
        funnel_name: "Cross Source Trace",
        lead_id: "e1770001-2222-4333-8444-555555555702",
        first_name: "Hidden",
        last_name: "Xsource",
        email,
        phone,
        state: "NC",
        submitted_at: "2026-01-02T00:00:00.000Z",
      },
      stageOverride: "inventory_only",
    });
    createdEventIds.push(second.sourceEventId);

    const trace = await getSourceIntakeTrace({ sourceLeadId: second.sourceLeadId }, db);
    assert.equal(trace.ok, true);
    if (!trace.ok) return;
    assert.equal(trace.readOnly, true);
    assert.equal(trace.sourceLeadEvent?.id, second.sourceEventId);
    assert.equal(trace.inventoryTracking.outcome, "reused_phone");
    assert.equal(trace.inventoryItem?.id, first.item.id);
    assert.equal(trace.inventoryItem?.onOtherSourceEvent, true);
    assert.equal(trace.inventoryItem?.sourceLeadEventId, first.created.sourceEventId);
    assert.equal(CONTACT_LEAK.test(JSON.stringify(trace)), false);
  });

  it("accepts legitimate cross-source phone fingerprint reuse from persisted tracking", async () => {
    const canonical = await canonicalNextGen({
      leadId: "e1770001-2222-4333-8444-555555555703",
      phone: "5550177003",
      email: "phone.xsource@example.test",
    });
    assert.ok(canonical.phoneE164);
    await db.sourceLeadEvent.update({
      where: { id: canonical.created.sourceEventId },
      data: { clientAccountIdResolved: "client-unrelated-xsource" },
    });

    const cross = await insertEvent({
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceType: "bulk_import",
      sourceLeadId: "e1770001-2222-4333-8444-555555555704",
      normalizedPayloadJson: {
        contact: { phone_e164: canonical.phoneE164 },
        submitted_at: "2026-02-01T00:00:00.000Z",
      },
    });
    const tracked = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: cross.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(tracked.ok, true);
    if (!tracked.ok) return;
    assert.equal(tracked.outcome, "reused_phone");
    assert.equal(tracked.inventoryItemId, canonical.item.id);

    const beforeEvent = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: cross.id } });
    const beforeOwner = await db.sourceLeadEvent.findUniqueOrThrow({
      where: { id: canonical.created.sourceEventId },
    });
    const beforeItem = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: canonical.item.id } });

    const trace = await getSourceIntakeTrace({ sourceLeadId: cross.sourceLeadId ?? "" }, db);

    const afterEvent = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: cross.id } });
    const afterOwner = await db.sourceLeadEvent.findUniqueOrThrow({
      where: { id: canonical.created.sourceEventId },
    });
    const afterItem = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: canonical.item.id } });
    assert.equal(afterEvent.updatedAt.toISOString(), beforeEvent.updatedAt.toISOString());
    assert.equal(afterOwner.updatedAt.toISOString(), beforeOwner.updatedAt.toISOString());
    assert.equal(afterItem.updatedAt.toISOString(), beforeItem.updatedAt.toISOString());

    assert.equal(trace.ok, true);
    if (!trace.ok) return;
    assert.equal(trace.readOnly, true);
    assert.equal(trace.inventoryTracking.outcome, "reused_phone");
    assert.equal(trace.inventoryTracking.detail, "Existing item on another source event");
    assert.equal(trace.inventoryItem?.id, canonical.item.id);
    assert.equal(trace.inventoryItem?.onOtherSourceEvent, true);
    assert.equal(trace.inventoryItem?.sourceLeadEventId, canonical.created.sourceEventId);
    assert.equal(trace.relatedSourceEventIds.includes(canonical.created.sourceEventId), false);
    assert.equal(trace.destinationClientAccountId, null);
    const encoded = JSON.stringify(trace);
    assert.equal(encoded.includes(canonical.phoneE164), false);
    assert.equal(encoded.includes("phone.xsource@example.test"), false);
    assert.equal(encoded.includes("client-unrelated-xsource"), false);
    assert.equal(encoded.includes("fixture-not-for-trace"), false);
    assert.equal(CONTACT_LEAK.test(encoded), false);

    const outbox = await db.fulfillmentOutbox.count({
      where: { sourceLeadEventId: { in: [cross.id, canonical.created.sourceEventId] } },
    });
    const allocations = await db.leadAllocation.count({
      where: { sourceLeadEventId: { in: [cross.id, canonical.created.sourceEventId] } },
    });
    assert.equal(outbox, 0);
    assert.equal(allocations, 0);
  });

  it("accepts legitimate cross-source email fingerprint reuse", async () => {
    const canonical = await canonicalNextGen({
      leadId: "e1770001-2222-4333-8444-555555555705",
      phone: "5550177005",
      email: "email.xsource@example.test",
    });
    assert.ok(canonical.email);
    const cross = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_legacy",
      sourceLeadId: "e1770001-2222-4333-8444-555555555706",
      normalizedPayloadJson: {
        contact: { email: canonical.email, phone_e164: "+15550177006" },
        submitted_at: "2026-02-02T00:00:00.000Z",
      },
    });
    const tracked = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: cross.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(tracked.ok, true);
    if (!tracked.ok) return;
    assert.equal(tracked.outcome, "reused_email");
    assert.equal(tracked.inventoryItemId, canonical.item.id);

    const trace = await getSourceIntakeTrace({ sourceLeadEventId: cross.id }, db);
    assert.equal(trace.ok, true);
    if (!trace.ok) return;
    assert.equal(trace.inventoryTracking.outcome, "reused_email");
    assert.equal(trace.inventoryItem?.id, canonical.item.id);
    assert.equal(trace.inventoryItem?.onOtherSourceEvent, true);
    assert.equal(JSON.stringify(trace).includes(canonical.email), false);
  });

  it("accepts historical cross-source reuse after fingerprint backfill", async () => {
    const phoneE164 = "+15550177007";
    const owner = await insertEvent({
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceType: "bulk_import",
      sourceLeadId: "hist-owner-xsource-7007",
      clientAccountIdResolved: "client-unrelated-xsource",
      normalizedPayloadJson: { contact: { phone_e164: phoneE164 } },
    });
    const lot = await db.inventoryLot.create({
      data: {
        lotKey: "campaign:test:xsource-historical-7007",
        displayName: "Historical cross-source fixture",
        sourceProvider: "manual_import",
        sourceLane: "csv_import",
        nicheKey: "unspecified",
        inventoryClass: "aged",
        status: "active",
        activatedAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    });
    createdLotIds.push(lot.id);
    const item = await db.leadInventoryItem.create({
      data: {
        inventoryLotId: lot.id,
        sourceLeadEventId: owner.id,
        generatedAt: new Date("2025-01-01T00:00:00.000Z"),
        normalizedState: "NC",
        nicheKey: "unspecified",
        sourceProvider: "manual_import",
        sourceLane: "csv_import",
        inventoryClass: "aged",
        phoneFingerprint: null,
        emailFingerprint: null,
      },
    });
    const cross = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "e1770001-2222-4333-8444-555555555707",
      normalizedPayloadJson: {
        contact: { phone_e164: phoneE164 },
        submitted_at: "2026-03-01T00:00:00.000Z",
      },
    });
    const tracked = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: cross.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(tracked.ok, true);
    if (!tracked.ok) return;
    assert.equal(tracked.outcome, "reused_historical");
    assert.equal(tracked.inventoryItemId, item.id);
    const backfilled = await db.leadInventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.ok(backfilled.phoneFingerprint);

    const trace = await getSourceIntakeTrace({ sourceLeadId: cross.sourceLeadId ?? "" }, db);
    assert.equal(trace.ok, true);
    if (!trace.ok) return;
    assert.equal(trace.inventoryTracking.outcome, "reused_historical");
    assert.equal(trace.inventoryItem?.id, item.id);
    assert.equal(trace.inventoryItem?.onOtherSourceEvent, true);
    assert.equal(JSON.stringify(trace).includes(phoneE164), false);
    assert.equal(JSON.stringify(trace).includes(backfilled.phoneFingerprint ?? "missing-fp"), false);
    assert.equal(JSON.stringify(trace).includes("client-unrelated-xsource"), false);
  });

  it("keeps 409 for a cross-provider source lead id collision", async () => {
    const canonical = await canonicalNextGen({
      leadId: "e1770001-2222-4333-8444-555555555708",
      phone: "5550177008",
      email: "collision.xsource@example.test",
    });
    const cross = await insertEvent({
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: canonical.created.sourceLeadId,
      normalizedPayloadJson: {
        contact: { phone_e164: canonical.phoneE164, email: canonical.email },
      },
      enrichmentMetadataJson: {
        inventoryTracking: {
          outcome: "reused_source_lead_id",
          inventoryItemId: canonical.item.id,
        },
      },
    });
    assertFailure(
      await getSourceIntakeTrace({ sourceLeadEventId: cross.id }, db),
      409,
      "association_conflict",
      "Inventory item does not belong to this source intake"
    );
  });

  it("keeps 409 for an incorrect stored inventory reference", async () => {
    const canonical = await canonicalNextGen({
      leadId: "e1770001-2222-4333-8444-555555555709",
      phone: "5550177009",
      email: "wrongref.xsource@example.test",
    });
    const other = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "e1770001-2222-4333-8444-555555555710",
      normalizedPayloadJson: { contact: { phone_e164: "+15550177010" } },
      enrichmentMetadataJson: {
        inventoryTracking: { outcome: "reused_phone", inventoryItemId: canonical.item.id },
      },
    });
    assertFailure(
      await getSourceIntakeTrace({ sourceLeadEventId: other.id }, db),
      409,
      "association_conflict",
      "Inventory item does not belong to this source intake"
    );
  });

  it("reports missing canonical inventory without inventing an item", async () => {
    const event = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "e1770001-2222-4333-8444-555555555711",
      normalizedPayloadJson: { contact: { phone_e164: "+15550177011" } },
      enrichmentMetadataJson: {
        inventoryTracking: { outcome: "reused_phone", inventoryItemId: "missingcanonicalitem01" },
      },
    });
    const before = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: event.id } });
    const trace = await getSourceIntakeTrace({ sourceLeadEventId: event.id }, db);
    const after = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
    assert.equal(trace.ok, true);
    if (!trace.ok) return;
    assert.equal(trace.inventoryItem, null);
    assert.equal(trace.inventoryTracking.diagnostic, "reused");
    assert.equal(trace.inventoryTracking.outcome, "reused_phone");
    assert.equal(trace.inventoryTracking.inventoryItemId, null);
    assert.equal(JSON.stringify(trace).includes("missingcanonicalitem01"), false);
  });

  it("keeps 409 when reused_source_lead_id does not match the owner lead", async () => {
    const canonical = await canonicalNextGen({
      leadId: "e1770001-2222-4333-8444-555555555712",
      phone: "5550177012",
      email: "mismatch.xsource@example.test",
    });
    const other = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "e1770001-2222-4333-8444-555555555713",
      enrichmentMetadataJson: {
        inventoryTracking: {
          outcome: "reused_source_lead_id",
          inventoryItemId: canonical.item.id,
        },
      },
    });
    assertFailure(
      await getSourceIntakeTrace({ sourceLeadEventId: other.id }, db),
      409,
      "association_conflict",
      "Inventory item does not belong to this source lead"
    );
  });

  it("serves an observer-readable GET trace without contact data or a write method", async () => {
    const canonical = await canonicalNextGen({
      leadId: "e1770001-2222-4333-8444-555555555714",
      phone: "5550177014",
      email: "observer.xsource@example.test",
    });
    const cross = await insertEvent({
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceType: "bulk_import",
      sourceLeadId: "e1770001-2222-4333-8444-555555555715",
      normalizedPayloadJson: {
        contact: { phone_e164: canonical.phoneE164, email: "observer.xsource@example.test" },
        submitted_at: "2026-04-01T00:00:00.000Z",
      },
    });
    const tracked = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: cross.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(tracked.ok, true);

    const prev = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "secret-admin-key";
    const app = Fastify({ logger: false });
    await app.register(adminRoutes, { prefix: "/admin/v1" });
    const response = await app.inject({
      method: "GET",
      url: `/admin/v1/coc/source-intake-trace?sourceLeadId=${encodeURIComponent(cross.sourceLeadId ?? "")}`,
      headers: { [HEADER]: "secret-admin-key" },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.readOnly, true);
    assert.equal(body.inventoryTracking.outcome, "reused_phone");
    assert.equal(body.inventoryItem.id, canonical.item.id);
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes(canonical.phoneE164), false);
    assert.equal(encoded.includes("observer.xsource@example.test"), false);
    assert.equal(encoded.includes("Hidden"), false);
    assert.equal(CONTACT_LEAK.test(encoded), false);

    const posted = await app.inject({
      method: "POST",
      url: "/admin/v1/coc/source-intake-trace",
      headers: { [HEADER]: "secret-admin-key" },
      payload: { sourceLeadId: cross.sourceLeadId },
    });
    assert.equal(posted.statusCode, 404);
    await app.close();
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
    else delete process.env.ADMIN_API_KEY;
  });
});
