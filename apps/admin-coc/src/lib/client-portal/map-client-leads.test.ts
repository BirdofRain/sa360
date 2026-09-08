import test from "node:test";
import assert from "node:assert/strict";

import {
  mapClientLeadDeliveryDetail,
  mapClientLeadDeliveryRow,
  mapClientLeadDeliveryRows,
  portalDeliveryStatusLabel,
  portalDeliveryStatusTone,
  portalLeadTimelineLabel,
  portalRoutingStatusLabel,
} from "./map-client-leads.ts";

test("maps client lead-delivery rows and ignores items without ids", () => {
  const rows = mapClientLeadDeliveryRows([
    {
      id: "lead_1",
      leadName: "Alex P.",
      phoneMasked: "(•••) •••-1212",
      campaignName: "Vet Q2",
      sourcePlatform: "meta",
      sourceType: "form",
      deliveryStatus: "delivered",
      receivedAt: "2026-08-20T10:00:00.000Z",
      lastEventName: "lead_delivered",
      appointmentStatus: "set",
    },
    { leadName: "Missing id" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].campaign, "Vet Q2");
  assert.equal(rows[0].sourceLabel, "meta · form");
  assert.equal(rows[0].deliveryLabel, "Delivered");
});

test("uses leadUid when id is absent", () => {
  const row = mapClientLeadDeliveryRow({
    leadUid: "uid_9",
    deliveryStatus: "failed",
  });
  assert.equal(row?.id, "uid_9");
  assert.equal(row?.leadName, "Lead");
  assert.equal(row?.deliveryLabel, "Failed");
});

test("campaign display does not fall back to campaign id or source platform", () => {
  const row = mapClientLeadDeliveryRow({
    id: "lead_x",
    campaignId: "camp_internal",
    sourcePlatform: "leadcapture_io",
    sourceType: "webhook",
  });
  assert.equal(row?.campaign, "—");
  assert.equal(row?.sourceLabel, "leadcapture_io · webhook");
});

test("delivery status labels stay customer-facing", () => {
  assert.equal(portalDeliveryStatusLabel("in_progress"), "In progress");
  assert.equal(portalDeliveryStatusTone("delivered"), "good");
  assert.equal(portalDeliveryStatusTone("failed"), "bad");
});

test("maps a customer-safe lead-delivery detail payload", () => {
  const detail = mapClientLeadDeliveryDetail({
    id: "lead_1",
    leadName: "Alex P.",
    phoneMasked: "(•••) •••-1212",
    emailMasked: "a***@example.com",
    phoneE164: "+1555121212",
    email: "alex@example.com",
    campaignName: "Vet Q2",
    sourcePlatform: "meta",
    sourceType: "form",
    adName: "Spring offer",
    deliveryStatus: "delivered",
    routingStatus: "matched",
    receivedAt: "2026-08-20T10:00:00.000Z",
    lastEventName: "lead_delivered",
    lastEventAt: "2026-08-20T11:00:00.000Z",
    appointmentStatus: "set",
    soldStatus: "open",
    matchedClient: "Your account",
    workflowStarted: true,
    warnings: ["Destination still syncing"],
    errorSummary: null,
    attribution: {
      sourceFunnelName: "Vet intake",
      sourceAttributes: { state: "TX", niche: "vet", email: "secret@example.com" },
    },
    delivery: {
      deliveredAt: "2026-08-20T11:00:00.000Z",
      approvedAt: "2026-08-20T10:30:00.000Z",
      planId: "plan_internal",
      adapterRunId: "run_internal",
      approvedBy: null,
    },
    lifecycle: {
      lifecycleStage: "appointment_set",
      agentDisposition: "internal_only",
      aiStatus: "scored",
    },
    adminDetail: { webhookRequestLogId: "wh_secret" },
    timeline: [
      { milestone: "source_lead_received", status: "complete", at: "2026-08-20T10:00:00.000Z" },
      { milestone: "lead_delivered", status: "complete", at: "2026-08-20T11:00:00.000Z" },
      { milestone: "sold", status: "pending" },
    ],
  });

  assert.equal(detail?.id, "lead_1");
  assert.equal(detail?.emailMasked, "a***@example.com");
  assert.equal(detail?.funnelName, "Vet intake");
  assert.equal(detail?.adName, "Spring offer");
  assert.equal(detail?.routingLabel, "Matched");
  assert.equal(detail?.deliveredAt, "2026-08-20T11:00:00.000Z");
  assert.equal(detail?.lifecycleStage, "appointment_set");
  assert.equal(detail?.warnings[0], "Destination still syncing");
  assert.equal(detail?.state, "TX");
  assert.equal(detail?.leadType, "vet");
  assert.equal(detail?.timeline.length, 2);
  assert.equal(detail?.timeline[1].milestoneLabel, "Delivered");
  assert.equal(Object.hasOwn(detail ?? {}, "phoneE164"), false);
  assert.equal(Object.hasOwn(detail ?? {}, "email"), false);
  assert.equal(Object.hasOwn(detail ?? {}, "adminDetail"), false);
  assert.equal(Object.hasOwn(detail ?? {}, "sourceAttributes"), false);
  assert.equal(Object.hasOwn(detail ?? {}, "planId"), false);
  assert.equal(Object.hasOwn(detail ?? {}, "agentDisposition"), false);
});

test("detail mapping requires the customer lead-delivery id", () => {
  assert.equal(mapClientLeadDeliveryDetail({ leadUid: "uid_only", deliveryStatus: "delivered" }), null);
  assert.equal(mapClientLeadDeliveryDetail(null), null);
});

test("partial detail payloads omit empty optional blocks", () => {
  const detail = mapClientLeadDeliveryDetail({
    id: "lead_partial",
    deliveryStatus: "pending",
    warnings: ["No InboundContactIndex snapshot found for this lead scope."],
  });
  assert.equal(detail?.id, "lead_partial");
  assert.equal(detail?.emailMasked, null);
  assert.equal(detail?.funnelName, null);
  assert.equal(detail?.deliveredAt, null);
  assert.equal(detail?.state, null);
  assert.equal(detail?.age, null);
  assert.equal(detail?.leadType, null);
  assert.equal(
    detail?.warnings[0],
    "No InboundContactIndex snapshot found for this lead scope."
  );
  assert.deepEqual(detail?.timeline, []);
});

test("routing and timeline labels stay customer-facing", () => {
  assert.equal(portalRoutingStatusLabel("review_required"), "Needs review");
  assert.equal(portalRoutingStatusLabel("dry_run"), "In review");
  assert.equal(portalLeadTimelineLabel("first_touch_sent"), "First outreach");
  assert.equal(portalLeadTimelineLabel("client_workflow_started"), "Follow-up started");
});
