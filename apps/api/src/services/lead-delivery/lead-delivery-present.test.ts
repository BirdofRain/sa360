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
