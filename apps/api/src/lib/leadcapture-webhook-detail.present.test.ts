import test from "node:test";
import assert from "node:assert/strict";
import type { SourceLeadEvent, WebhookRequestLog } from "@prisma/client";
import {
  buildLeadCaptureSourceIntakeDebug,
  presentLeadCaptureRoutingNiche,
} from "./leadcapture-webhook-detail.present.js";

test("capture-only Nurse source niche is source-only, not fake VET routing", () => {
  const presented = presentLeadCaptureRoutingNiche({
    normalizedRouting: null,
    rawPayload: { niche_key: "NURSE", niche: "NURSE" },
  });
  assert.equal(presented.niche_key, "NURSE");
  assert.equal(presented.niche_label, "source-only");
  assert.equal(presented.product_type, "—");
  assert.notEqual(presented.niche_key, "VET");
  assert.notEqual(presented.niche_label, "Veteran");
  assert.notEqual(presented.product_type, "Final Expense");
});

test("capture-only missing niche is Unresolved, not VET", () => {
  const presented = presentLeadCaptureRoutingNiche({
    normalizedRouting: null,
    rawPayload: { first_name: "Casey" },
  });
  assert.equal(presented.niche_key, "Unresolved");
  assert.equal(presented.niche_label, "—");
  assert.equal(presented.product_type, "—");
  assert.notEqual(presented.niche_key, "VET");
});

test("normalized VET keeps genuine resolved Veteran / Final Expense", () => {
  const presented = presentLeadCaptureRoutingNiche({
    normalizedRouting: {
      niche_key: "VET",
      niche_label: "Veteran",
      product_type: "Final Expense",
    },
    rawPayload: { niche_key: "VET" },
  });
  assert.equal(presented.niche_key, "VET");
  assert.equal(presented.niche_label, "Veteran");
  assert.equal(presented.product_type, "Final Expense");
});

test("normalized NURSE does not invent Veteran or Final Expense", () => {
  const presented = presentLeadCaptureRoutingNiche({
    normalizedRouting: { niche_key: "NURSE" },
    rawPayload: { niche_key: "NURSE" },
  });
  assert.equal(presented.niche_key, "NURSE");
  assert.notEqual(presented.niche_label, "Veteran");
  assert.notEqual(presented.product_type, "Final Expense");
});

function baseRow(overrides: Partial<WebhookRequestLog> = {}): WebhookRequestLog {
  const now = new Date("2026-08-18T15:16:48.000Z");
  return {
    id: "log-nurse",
    requestId: "req-nurse",
    source: "leadcapture_io",
    route: "/webhooks/leadcaptureio/nextgen",
    receivedAt: now,
    completedAt: now,
    durationMs: 12,
    processingStatus: "stored",
    httpStatus: 200,
    clientAccountId: null,
    subaccountIdGhl: null,
    contactIdGhl: null,
    eventUuid: null,
    eventNameInternal: null,
    errorCode: null,
    errorSummary: null,
    requestBodyRedacted: {
      niche_key: "NURSE",
      niche: "NURSE",
      sa360_route_key: "LCIO_NG_NURSE_ANDRU_DURANSO",
    },
    responseBodyRedacted: { ok: true, matched: false },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as WebhookRequestLog;
}

test("capture-only source intake debug surfaces Nurse as source-only", () => {
  const debug = buildLeadCaptureSourceIntakeDebug({
    row: baseRow(),
    sourceEvent: {
      id: "evt-nurse",
      sourceLeadId: "9f3a2c10-4b21-4d88-8a77-6c1e0b2d9e11",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      sourceRouteKey: "LCIO_NG_NURSE_ANDRU_DURANSO",
      sourceCampaignId: "LCIO_NG_NURSE_ANDRU_DURANSO",
      sourceCampaignName: "Life Insurance For Nurses - Andru Duranso",
      sourceFunnelName: "Nurse Coverage NextGen Canary",
      rawPayloadJson: {
        niche_key: "NURSE",
        niche: "NURSE",
      },
      normalizedPayloadJson: null,
      routingResultJson: null,
      enrichmentMetadataJson: { captureOnly: true, intakeStage: "capture_only" },
      status: "received",
    } as unknown as SourceLeadEvent,
    responseBody: { ok: true, matched: false },
  });
  assert.equal(debug.routing.niche_key, "NURSE");
  assert.equal(debug.routing.niche_label, "source-only");
  assert.equal(debug.routing.product_type, "—");
  assert.notEqual(debug.routing.niche_key, "VET");
  assert.notEqual(debug.routing.niche_label, "Veteran");
  assert.notEqual(debug.routing.product_type, "Final Expense");
});
