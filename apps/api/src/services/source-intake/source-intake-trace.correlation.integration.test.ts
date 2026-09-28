import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Fastify from "fastify";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminRoutes } from "../../routes/admin.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import { getSourceIntakeTrace } from "./source-intake-trace.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const HEADER = "x-sa360-admin-key";
const SECRET = "buyer@secret.example +15551212999";

function assertFailure(
  result: { ok: boolean; status?: number; code?: string },
  status: number,
  code: string
) {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, status);
  assert.equal(result.code, code);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
}

describe("source intake trace correlation", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdWebhookIds: string[] = [];
  const createdFunnelIds: string[] = [];

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
    if (createdWebhookIds.length > 0) {
      await db.webhookRequestLog.deleteMany({ where: { id: { in: createdWebhookIds } } });
    }
    if (createdFunnelIds.length > 0) {
      await db.sourceFunnel.deleteMany({ where: { id: { in: createdFunnelIds } } });
    }
    await db?.$disconnect();
  });

  async function insertWebhook(data: {
    requestId: string;
    source?: "leadcapture_io" | "ghl_lifecycle" | "facebook_lead_ads";
    sourceLeadEventId?: string;
  }) {
    const row = await db.webhookRequestLog.create({
      data: {
        requestId: data.requestId,
        source: data.source ?? "leadcapture_io",
        route: "/sources/leadcapture-nextgen",
        processingStatus: "stored",
        httpStatus: 200,
        sourceLeadEventId: data.sourceLeadEventId,
      },
    });
    createdWebhookIds.push(row.id);
    return row;
  }

  async function insertEvent(data: {
    sourceProvider: "leadcapture_io" | "facebook";
    sourceSystem: "leadcapture_io_nextgen" | "meta_lead_ads";
    sourceLeadId?: string;
    sourceLeadUid?: string;
    webhookRequestLogId?: string;
    enrichmentMetadataJson?: Record<string, unknown>;
    receivedAt?: Date;
  }) {
    const row = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: data.sourceProvider,
        sourceSystem: data.sourceSystem,
        sourceType: "webhook",
        status: "normalized",
        sourceLeadId: data.sourceLeadId,
        sourceLeadUid: data.sourceLeadUid,
        webhookRequestLogId: data.webhookRequestLogId,
        rawPayloadJson: {},
        enrichmentMetadataJson: data.enrichmentMetadataJson as Prisma.InputJsonValue | undefined,
        receivedAt: data.receivedAt,
      },
    });
    createdEventIds.push(row.id);
    return row;
  }

  it("rejects cross-provider identities, conflicts, unknown anchors, and duplicate request ids", async () => {
    const sharedLeadId = "sec027d-shared-lead";
    const leadcapture = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: sharedLeadId,
      receivedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const facebook = await insertEvent({
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: sharedLeadId,
      receivedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    const beforeLeadcapture = await db.sourceLeadEvent.findUnique({ where: { id: leadcapture.id } });
    const collision = await getSourceIntakeTrace({ sourceLeadId: sharedLeadId }, db);
    assertFailure(collision, 409, "ambiguous_source_identity");
    const afterLeadcapture = await db.sourceLeadEvent.findUnique({ where: { id: leadcapture.id } });
    assert.equal(afterLeadcapture?.updatedAt.toISOString(), beforeLeadcapture?.updatedAt.toISOString());

    const scoped = await getSourceIntakeTrace({ sourceLeadEventId: leadcapture.id }, db);
    assert.equal(scoped.ok, true);
    if (!scoped.ok) return;
    assert.equal(scoped.sourceLeadEvent?.id, leadcapture.id);
    assert.equal(scoped.relatedSourceEventIds.includes(facebook.id), false);

    const sibling = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: sharedLeadId,
      receivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const withSibling = await getSourceIntakeTrace({ sourceLeadEventId: leadcapture.id }, db);
    assert.equal(withSibling.ok, true);
    if (!withSibling.ok) return;
    assert.equal(withSibling.relatedSourceEventIds.includes(sibling.id), true);
    assert.equal(withSibling.relatedSourceEventIds.includes(facebook.id), false);

    assertFailure(
      await getSourceIntakeTrace(
        { webhookRequestLogId: "missing-sec027d-log", sourceLeadEventId: leadcapture.id },
        db
      ),
      400,
      "multiple_anchors"
    );
    assertFailure(
      await getSourceIntakeTrace({ webhookRequestLogId: "missing-sec027d-log" }, db),
      404,
      "not_found"
    );
    assertFailure(
      await getSourceIntakeTrace({ sourceLeadId: "missing-sec027d-lead" }, db),
      404,
      "not_found"
    );
    assertFailure(await getSourceIntakeTrace({}, db), 400, "missing_anchor");

    const dupA = await insertWebhook({ requestId: "sec027d-dup-request" });
    const dupB = await insertWebhook({ requestId: "sec027d-dup-request" });
    const ambiguous = await getSourceIntakeTrace({ requestId: "sec027d-dup-request" }, db);
    assertFailure(ambiguous, 409, "ambiguous_request_id");
    assert.equal(JSON.stringify(ambiguous).includes(dupA.id), false);
    assert.equal(JSON.stringify(ambiguous).includes(dupB.id), false);

    const webhookB = await insertWebhook({ requestId: "sec027d-webhook-b" });
    const event1 = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "sec027d-paired-lead",
      webhookRequestLogId: webhookB.id,
    });
    const webhookA = await insertWebhook({
      requestId: "sec027d-webhook-a",
      sourceLeadEventId: event1.id,
    });
    assertFailure(
      await getSourceIntakeTrace({ webhookRequestLogId: webhookA.id }, db),
      409,
      "association_conflict"
    );
    await db.webhookRequestLog.update({
      where: { id: webhookB.id },
      data: { sourceLeadEventId: facebook.id },
    });
    assertFailure(
      await getSourceIntakeTrace({ sourceLeadEventId: event1.id }, db),
      409,
      "association_conflict"
    );

    const outbox = await db.fulfillmentOutbox.count({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    const allocations = await db.leadAllocation.count({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    assert.equal(outbox, 0);
    assert.equal(allocations, 0);
  });

  it("does not attach unrelated inventory and hides unknown sensitive outcomes", async () => {
    const created = await processLeadCaptureNextGenLeadCreated({
      rawPayload: {
        provider: "leadcapture_io",
        sa360_source_system: "leadcapture_io_nextgen",
        sa360_source_platform: "leadcapture_io",
        funnel_id: "18c28feb-5c3d-4bd0-94d8-1ed33a6fa718",
        funnel_name: "Security Trace",
        lead_id: "e2222222-3333-4444-8555-666666666661",
        first_name: "Hidden",
        last_name: "Name",
        email: "created.sec027d@example.test",
        phone: "5550109222",
        state: "NC",
        submitted_at: "2026-01-01T00:00:00.000Z",
      },
      stageOverride: "inventory_only",
    });
    createdEventIds.push(created.sourceEventId);
    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: created.sourceEventId },
    });
    assert.ok(item);

    const otherProvider = await insertEvent({
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceLeadId: "sec027d-other-provider",
      enrichmentMetadataJson: {
        inventoryTracking: { outcome: "reused_phone", inventoryItemId: item!.id },
      },
    });
    assertFailure(
      await getSourceIntakeTrace({ sourceLeadEventId: otherProvider.id }, db),
      409,
      "association_conflict"
    );

    const sameProvider = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "sec027d-phone-reuse",
      enrichmentMetadataJson: {
        inventoryTracking: { outcome: "reused_phone", inventoryItemId: item!.id },
      },
    });
    const reused = await getSourceIntakeTrace({ sourceLeadEventId: sameProvider.id }, db);
    assert.equal(reused.ok, true);
    if (!reused.ok) return;
    assert.equal(reused.sourceLeadEvent?.id, sameProvider.id);
    assert.notEqual(reused.sourceLeadEvent?.id, created.sourceEventId);
    assert.equal(reused.inventoryItem?.id, item!.id);
    assert.equal(reused.inventoryItem?.onOtherSourceEvent, true);
    assert.equal(reused.inventoryItem?.sourceLeadEventId, created.sourceEventId);

    const wrongLead = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "sec027d-different-lead",
      enrichmentMetadataJson: {
        inventoryTracking: { outcome: "reused_source_lead_id", inventoryItemId: item!.id },
      },
    });
    assertFailure(
      await getSourceIntakeTrace({ sourceLeadEventId: wrongLead.id }, db),
      409,
      "association_conflict"
    );

    const poisoned = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "sec027d-poison-lead",
      enrichmentMetadataJson: {
        inventoryTracking: {
          outcome: SECRET,
          inventoryItemId: item!.id,
          note: "first_name Hidden",
        },
      },
    });
    const hidden = await getSourceIntakeTrace({ sourceLeadEventId: poisoned.id }, db);
    assert.equal(hidden.ok, true);
    if (!hidden.ok) return;
    assert.equal(hidden.inventoryTracking.diagnostic, "unrecognized");
    assert.equal(hidden.inventoryTracking.outcome, null);
    assert.equal(hidden.inventoryTracking.label, "Unrecognized tracking outcome");
    assert.equal(hidden.inventoryItem, null);
    assert.equal(hidden.inventoryTracking.inventoryItemId, null);
    const encoded = JSON.stringify(hidden);
    assert.equal(encoded.includes("buyer@secret.example"), false);
    assert.equal(encoded.includes("+15551212999"), false);
    assert.equal(encoded.includes(item!.id), false);

    const funnel = await db.sourceFunnel.create({
      data: {
        provider: "facebook",
        providerFunnelId: "sec027d-facebook-funnel",
      },
    });
    createdFunnelIds.push(funnel.id);
    const mismatchedFunnel = await insertEvent({
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceLeadId: "sec027d-funnel-mismatch",
      enrichmentMetadataJson: { sourceFunnelId: funnel.id },
    });
    assertFailure(
      await getSourceIntakeTrace({ sourceLeadEventId: mismatchedFunnel.id }, db),
      409,
      "association_conflict"
    );

    const outbox = await db.fulfillmentOutbox.count({
      where: { sourceLeadEventId: { in: [created.sourceEventId, sameProvider.id, poisoned.id] } },
    });
    const allocations = await db.leadAllocation.count({
      where: { sourceLeadEventId: { in: [created.sourceEventId, sameProvider.id, poisoned.id] } },
    });
    assert.equal(outbox, 0);
    assert.equal(allocations, 0);
    assert.equal(created.intakeStage, "inventory_only");
    assert.equal(created.shadowOutboxEnsured, false);
  });

  it("maps correlation failures on the admin route without a write method", async () => {
    const prev = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "secret-admin-key";
    const app = Fastify({ logger: false });
    await app.register(adminRoutes, { prefix: "/admin/v1" });

    const missing = await app.inject({
      method: "GET",
      url: "/admin/v1/coc/source-intake-trace?sourceLeadEventId=missing-sec027d-event",
      headers: { [HEADER]: "secret-admin-key" },
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().code, "not_found");
    assert.equal(missing.json().ok, false);

    const dupA = await insertWebhook({ requestId: "sec027d-http-dup" });
    await insertWebhook({ requestId: "sec027d-http-dup" });
    const ambiguous = await app.inject({
      method: "GET",
      url: "/admin/v1/coc/source-intake-trace?requestId=sec027d-http-dup",
      headers: { [HEADER]: "secret-admin-key" },
    });
    assert.equal(ambiguous.statusCode, 409);
    assert.equal(ambiguous.json().code, "ambiguous_request_id");
    assert.equal(JSON.stringify(ambiguous.json()).includes(dupA.id), false);

    const posted = await app.inject({
      method: "POST",
      url: "/admin/v1/coc/source-intake-trace",
      headers: { [HEADER]: "secret-admin-key" },
      payload: { requestId: "sec027d-http-dup" },
    });
    assert.equal(posted.statusCode, 404);

    await app.close();
    if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
    else delete process.env.ADMIN_API_KEY;
  });
});
