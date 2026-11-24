import test from "node:test";
import assert from "node:assert/strict";
import type { SourceLeadEvent } from "@prisma/client";
import { buildLeadDeliveryTimeline } from "./lead-delivery-timeline.service.js";
import { presentLeadDeliveryDetail, presentLeadDeliveryListRow } from "./lead-delivery-present.service.js";
import type { LeadDeliveryJoinContext } from "./lead-delivery-read.service.js";

function baseSourceLead(overrides: Partial<SourceLeadEvent> = {}): SourceLeadEvent {
  return {
    id: "evt_1",
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    sourceType: "lead_form",
    sourceRouteKey: "camp_a",
    sourceCampaignId: "camp_1",
    sourceCampaignName: "Spring Promo",
    sourceFunnelName: null,
    sourceLeadId: "sl_1",
    sourceLeadUid: "uid_1",
    clientAccountIdResolved: "client_a",
    destinationLocationIdResolved: "loc_1",
    routingRuleIdResolved: "rule_1",
    status: "routing_matched",
    rawPayloadJson: {},
    normalizedPayloadJson: {
      contact: {
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
        phone_e164: "+15551234567",
      },
    },
    routingResultJson: { matched: true },
    duplicateRiskJson: null,
    deliveryResultJson: null,
    enrichmentMetadataJson: {
      intakeStatus: "routing_matched",
      enrichmentStatus: "complete",
      automationReadiness: "ready",
      sourceAttributes: { ad_id: "ad_1", ad_name: "Ad One" },
      deliveryEligible: true,
      deliveryBlockers: [],
      deliveryWarnings: [],
      mappedFieldCount: 3,
      missingOptionalFields: [],
      missingAiContextFields: [],
      unmappedSourceFieldKeys: [],
      unmappedSourceFields: [],
    },
    routingDryRunDecisionId: "dec_1",
    errorSummary: null,
    webhookRequestLogId: "wh_1",
    receivedAt: new Date("2026-06-01T10:00:00.000Z"),
    normalizedAt: new Date("2026-06-01T10:01:00.000Z"),
    routedAt: new Date("2026-06-01T10:02:00.000Z"),
    approvedAt: null,
    deliveredAt: null,
    approvedBy: null,
    bulkImportId: null,
    bulkImportRowId: null,
    cleanupStatus: null,
    cleanupReason: null,
    cleanupMarkedAt: null,
    createdAt: new Date("2026-06-01T10:00:00.000Z"),
    updatedAt: new Date("2026-06-01T10:02:00.000Z"),
    ...overrides,
  };
}

function baseContext(overrides: Partial<LeadDeliveryJoinContext> = {}): LeadDeliveryJoinContext {
  return {
    sourceLead: baseSourceLead(),
    decision: null,
    plan: null,
    adapterRun: null,
    liveRun: null,
    clientDisplayName: "Summit Insurance",
    timeline: null,
    ...overrides,
  };
}

test("presentLeadDeliveryListRow returns safe partial row", () => {
  const row = presentLeadDeliveryListRow(baseContext(), "admin");
  assert.equal(row.id, "evt_1");
  assert.equal(row.leadName, "Jane Doe");
  assert.equal(row.routingStatus, "matched");
  assert.equal(row.dataSource, "partial_live");
  assert.ok(row.phoneE164);
});

test("client output masks phone and email", () => {
  const row = presentLeadDeliveryListRow(baseContext(), "client");
  assert.match(row.phoneMasked ?? "", /\*\*\*/);
  assert.equal(row.emailMasked, "j***@example.com");
  assert.equal(row.phoneE164, undefined);
  assert.equal(row.email, undefined);
});

test("detail timeline includes only real milestones", () => {
  const detail = presentLeadDeliveryDetail(baseContext(), "admin");
  const milestones = detail.timeline.map((m) => m.milestone);
  assert.deepEqual(milestones, [
    "source_lead_received",
    "lead_created",
    "lead_matched",
    "lead_routed",
  ]);
  assert.ok(!milestones.includes("sold" as never));
});

test("buildLeadDeliveryTimeline omits fake sold milestone", () => {
  const timeline = buildLeadDeliveryTimeline({
    sourceLead: baseSourceLead(),
    timeline: null,
    contactIdGhl: null,
  });
  assert.ok(!timeline.some((m) => m.milestone === "sold"));
});

test("admin detail includes adminDetail and redacts bearer tokens in errors", () => {
  const ctx = baseContext({
    sourceLead: baseSourceLead({
      errorSummary: "Failed Bearer sk_live_secret123",
      status: "delivery_failed",
      approvedAt: new Date("2026-06-01T11:00:00.000Z"),
    }),
  });
  const detail = presentLeadDeliveryDetail(ctx, "admin");
  assert.ok(detail.adminDetail);
  assert.match(detail.errorSummary ?? "", /\[redacted\]/);
  assert.ok(!detail.errorSummary?.includes("sk_live_secret123"));
});

test("client detail strips adminDetail", () => {
  const detail = presentLeadDeliveryDetail(baseContext(), "client");
  assert.equal(detail.adminDetail, undefined);
});

test("detail copies canonical consumer age only when source attributes have none", () => {
  const ctx = baseContext({
    sourceLead: baseSourceLead({
      enrichmentMetadataJson: {
        intakeStatus: "routing_matched",
        enrichmentStatus: "complete",
        automationReadiness: "ready",
        sourceAttributes: { state: "OH", date_of_birth: "03/13/1955" },
        deliveryEligible: true,
        deliveryBlockers: [],
        deliveryWarnings: [],
        mappedFieldCount: 1,
        missingOptionalFields: [],
        missingAiContextFields: [],
        unmappedSourceFieldKeys: [],
        unmappedSourceFields: [],
      },
      normalizedPayloadJson: {
        contact: { first_name: "Pat", last_name: "Sample" },
        lead_details: { consumer_age: "71", date_of_birth: "1955-03-13" },
      },
    }),
  });
  const before = JSON.stringify(ctx.sourceLead.enrichmentMetadataJson);
  const detail = presentLeadDeliveryDetail(ctx, "admin");
  assert.equal(detail.attribution.sourceAttributes.consumer_age, "71");
  assert.equal(detail.attribution.sourceAttributes.date_of_birth, "03/13/1955");
  assert.equal(JSON.stringify(ctx.sourceLead.enrichmentMetadataJson), before);

  const explicit = presentLeadDeliveryDetail(
    baseContext({
      sourceLead: baseSourceLead({
        enrichmentMetadataJson: {
          ...(ctx.sourceLead.enrichmentMetadataJson as object),
          sourceAttributes: { age: "80" },
        },
      }),
    }),
    "admin"
  );
  assert.equal(explicit.attribution.sourceAttributes.age, "80");
  assert.equal(explicit.attribution.sourceAttributes.consumer_age, undefined);
});

test("client badge and delivery text follow a canonical partial_success without a timeline event", () => {
  const ctx = baseContext({
    portalGhlDelivery: {
      evaluated: true,
      canonical: true,
      at: "2026-11-23T18:05:00.000Z",
      reasons: [],
      liveRunId: "run_1",
      liveRunStatus: "partial_success",
      optionalStepFailures: [{ stepType: "assign_owner", status: "optional_failed", errorCode: "http_500" }],
    },
    liveRun: {
      id: "run_1",
      status: "partial_success",
      completedAt: new Date("2026-11-23T18:05:00.000Z"),
      summary: "partial",
    },
  });
  const row = presentLeadDeliveryListRow(ctx, "client");
  assert.equal(row.deliveryStatus, "delivered");
  assert.equal(row.lastEventName, "lead_delivered");
  const clientDetail = presentLeadDeliveryDetail(ctx, "client");
  assert.equal(clientDetail.deliveryStatus, "delivered");
  assert.equal(clientDetail.delivery.deliveredAt, "2026-11-23T18:05:00.000Z");
  assert.equal(clientDetail.adminDetail, undefined);
  const admin = presentLeadDeliveryDetail(ctx, "admin");
  assert.equal(admin.deliveryStatus, "not_started");
  assert.equal(admin.delivery.liveRunStatus, "partial_success");
  assert.equal(admin.lastEventName, "lead_routed");
  assert.equal(admin.adminDetail?.ghlRunStatus, "partial_success");
  assert.deepEqual(admin.adminDetail?.ghlOptionalStepFailures, [
    { stepType: "assign_owner", status: "optional_failed", errorCode: "http_500" },
  ]);
});

test("a later customer event stays on the subline when required delivery is canonical", () => {
  const ctx = baseContext({
    portalGhlDelivery: {
      evaluated: true,
      canonical: true,
      at: "2026-11-23T18:05:00.000Z",
      reasons: [],
      liveRunId: "run_1",
      liveRunStatus: "succeeded",
      optionalStepFailures: [],
    },
    timeline: {
      ok: true,
      identity: {
        leadUid: "uid_1",
        contactIdGhl: null,
        displayName: null,
        phoneE164: null,
        email: null,
        clientAccountId: "client_a",
        subaccountIdGhl: null,
      },
      currentState: {
        lifecycleStage: null,
        appointmentStatus: "set",
        agentDisposition: null,
        policyStatus: null,
        aiStatus: null,
        routingStatus: null,
        lastSeenAt: null,
      },
      timeline: [
        {
          id: "evt_appt",
          source: "lifecycle_event",
          sourceTable: "LifecycleEvent",
          requestId: null,
          eventUuid: null,
          eventNameInternal: "appointment_set",
          eventNameMeta: null,
          receivedAt: "2026-11-23T19:00:00.000Z",
          validity: "valid",
          processingStatus: "received",
          httpStatus: null,
          leadName: null,
          phoneE164: null,
          email: null,
          summary: null,
          errorSummary: null,
        },
      ],
      missingMilestones: [],
      warnings: [],
    },
  });
  const row = presentLeadDeliveryListRow(ctx, "client");
  assert.equal(row.deliveryStatus, "delivered");
  assert.equal(row.lastEventName, "appointment_set");
});

test("a completed contact does not present Delivered when required enrollment is not canonical", () => {
  const ctx = baseContext({
    sourceLead: baseSourceLead({
      deliveryResultJson: { contactIdGhl: "contact_1", status: "created" },
    }),
    liveRun: {
      id: "run_failed",
      status: "failed",
      completedAt: new Date("2026-11-23T18:05:00.000Z"),
      summary: "failed",
    },
    portalGhlDelivery: {
      evaluated: true,
      canonical: false,
      at: null,
      reasons: ["workflow_not_enrolled", "operation_outcome_ambiguous"],
      liveRunId: "run_failed",
      liveRunStatus: "failed",
      optionalStepFailures: [],
    },
    timeline: {
      ok: true,
      identity: {
        leadUid: "uid_1",
        contactIdGhl: "contact_1",
        displayName: "Jane Doe",
        phoneE164: null,
        email: null,
        clientAccountId: "client_a",
        subaccountIdGhl: null,
      },
      currentState: {
        lifecycleStage: null,
        appointmentStatus: null,
        agentDisposition: null,
        policyStatus: null,
        aiStatus: null,
        routingStatus: null,
        lastSeenAt: null,
      },
      timeline: [
        {
          id: "evt_delivered",
          source: "lifecycle_event",
          sourceTable: "LifecycleEvent",
          requestId: null,
          eventUuid: "evt_delivered",
          eventNameInternal: "lead_delivered",
          eventNameMeta: "lead_delivered",
          receivedAt: "2026-11-23T18:05:01.000Z",
          validity: "valid",
          processingStatus: "received",
          httpStatus: null,
          leadName: null,
          phoneE164: null,
          email: null,
          summary: null,
          errorSummary: null,
        },
      ],
      missingMilestones: [],
      warnings: [],
    },
  });
  const client = presentLeadDeliveryDetail(ctx, "client");
  assert.notEqual(client.deliveryStatus, "delivered");
  assert.notEqual(client.lastEventName, "lead_delivered");
  assert.equal(client.delivery.deliveredAt, null);
  const admin = presentLeadDeliveryDetail(ctx, "admin");
  assert.equal(admin.delivery.liveRunStatus, "failed");
  assert.equal(admin.lastEventName, "lead_delivered");
  assert.ok(admin.adminDetail?.ghlCanonicalReasons?.includes("workflow_not_enrolled"));
});

test("missing routing/delivery data does not crash presenter", () => {
  const ctx = baseContext({
    sourceLead: baseSourceLead({
      routingResultJson: null,
      routingRuleIdResolved: null,
      clientAccountIdResolved: null,
      status: "received",
      normalizedPayloadJson: null,
    }),
    clientDisplayName: null,
  });
  const row = presentLeadDeliveryListRow(ctx, "admin");
  assert.equal(row.routingStatus, "unmatched");
  assert.equal(row.deliveryStatus, "not_started");
});
