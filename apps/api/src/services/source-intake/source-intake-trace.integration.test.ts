import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { requireResolvedCorrelationKeys } from "../lead-timeline-correlation.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import { getSourceIntakeTrace } from "./source-intake-trace.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const SENSITIVE = /alex\.trace|5550109|first_name|rawPayload|phoneFingerprint|emailFingerprint|@example\.test/i;

function payload(input: {
  leadId: string;
  email: string;
  phone: string;
  funnelId: string;
  submittedAt?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    funnel_id: input.funnelId,
    funnel_name: "Life Insurance For Nurses- Trace",
    lead_id: input.leadId,
    first_name: "Trace",
    last_name: "Only",
    email: input.email,
    phone: input.phone,
    state: "NC",
  };
  if (input.submittedAt) body.submitted_at = input.submittedAt;
  return body;
}

describe("source intake trace", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdWebhookIds: string[] = [];

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
    await db?.$disconnect();
  });

  it("loads a clientless NextGen trace for created, reused, missing date, and failed tracking", async () => {
    assert.equal(
      requireResolvedCorrelationKeys({ leadUid: "leadcaptureio-clientless", phoneE164: "+15550109111" }),
      null
    );

    const webhook = await db.webhookRequestLog.create({
      data: {
        requestId: "trace-req-created",
        source: "leadcapture_io",
        route: "/sources/leadcapture-nextgen",
        processingStatus: "stored",
        httpStatus: 200,
      },
    });
    createdWebhookIds.push(webhook.id);

    const created = await processLeadCaptureNextGenLeadCreated({
      rawPayload: payload({
        leadId: "e1111111-2222-4333-8444-555555555511",
        email: "created.trace@example.test",
        phone: "5550109111",
        funnelId: "18c28feb-5c3d-4bd0-94d8-1ed33a6fa718",
        submittedAt: "2026-01-01T00:00:00.000Z",
      }),
      stageOverride: "inventory_only",
      webhookRequestLogId: webhook.id,
    });
    createdEventIds.push(created.sourceEventId);
    await db.webhookRequestLog.update({
      where: { id: webhook.id },
      data: { sourceLeadEventId: created.sourceEventId },
    });

    const before = await db.sourceLeadEvent.findUnique({ where: { id: created.sourceEventId } });
    const trace = await getSourceIntakeTrace({ webhookRequestLogId: webhook.id }, db);
    const after = await db.sourceLeadEvent.findUnique({ where: { id: created.sourceEventId } });
    assert.equal(after?.updatedAt.toISOString(), before?.updatedAt.toISOString());
    assert.ok(trace);
    assert.equal(trace?.readOnly, true);
    assert.equal(trace?.hasDestinationClient, false);
    assert.equal(trace?.destinationClientAccountId, null);
    assert.equal(trace?.sourceLeadEvent?.id, created.sourceEventId);
    assert.equal(trace?.sourceLeadEvent?.sourceLeadId, "e1111111-2222-4333-8444-555555555511");
    assert.equal(trace?.webhookRequestLog?.id, webhook.id);
    assert.equal(trace?.inventoryTracking.diagnostic, "created");
    assert.ok(trace?.inventoryItem);
    assert.equal(trace?.inventoryItem?.onOtherSourceEvent, false);
    assert.equal(SENSITIVE.test(JSON.stringify(trace)), false);

    const reused = await processLeadCaptureNextGenLeadCreated({
      rawPayload: payload({
        leadId: "e1111111-2222-4333-8444-555555555512",
        email: "created.trace@example.test",
        phone: "5550109111",
        funnelId: "22ac7ad2-97a3-4fce-bd4d-02124b6e4520",
        submittedAt: "2026-01-01T00:00:00.000Z",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(reused.sourceEventId);
    const reusedTrace = await getSourceIntakeTrace({ sourceLeadEventId: reused.sourceEventId }, db);
    assert.equal(reusedTrace?.inventoryTracking.diagnostic, "reused");
    assert.equal(reusedTrace?.inventoryItem?.onOtherSourceEvent, true);
    assert.notEqual(reusedTrace?.inventoryTracking.label, "INTAKE ONLY");
    assert.equal(reusedTrace?.hasDestinationClient, false);

    const missing = await processLeadCaptureNextGenLeadCreated({
      rawPayload: payload({
        leadId: "e1111111-2222-4333-8444-555555555513",
        email: "missing.trace@example.test",
        phone: "5550109113",
        funnelId: "33333333-4444-4555-8666-777777777777",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(missing.sourceEventId);
    const missingTrace = await getSourceIntakeTrace({ sourceLeadId: missing.sourceLeadId }, db);
    assert.equal(missingTrace?.inventoryTracking.diagnostic, "generated_at_missing");
    assert.equal(missingTrace?.inventoryItem, null);

    const failed = await processLeadCaptureNextGenLeadCreated({
      rawPayload: payload({
        leadId: "e1111111-2222-4333-8444-555555555514",
        email: "failed.trace@example.test",
        phone: "5550109114",
        funnelId: "44444444-5555-4666-8777-888888888888",
        submittedAt: "2026-01-01T00:00:00.000Z",
      }),
      stageOverride: "capture_only",
    });
    createdEventIds.push(failed.sourceEventId);
    await db.sourceLeadEvent.update({
      where: { id: failed.sourceEventId },
      data: {
        enrichmentMetadataJson: {
          inventoryTracking: { outcome: "inventory_tracking_failed", ok: false },
        },
      },
    });
    const failedTrace = await getSourceIntakeTrace({ sourceLeadUid: failed.normalizedLeadUid ?? "" }, db);
    assert.equal(failedTrace?.inventoryTracking.diagnostic, "failed");
    assert.equal(failedTrace?.inventoryTracking.label, "Tracking failed");
    assert.equal(failedTrace?.hasDestinationClient, false);

    const outbox = await db.fulfillmentOutbox.count({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    const allocations = await db.leadAllocation.count({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    assert.equal(outbox, 0);
    assert.equal(allocations, 0);
    assert.equal(created.matched, false);
    assert.equal(created.shadowOutboxEnsured, false);
    assert.equal(reused.intakeStage, "inventory_only");
  });
});
