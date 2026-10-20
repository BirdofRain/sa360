import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTimelineFromSourceLeadAndTimeline } from "./timeline-mapper";

describe("buildTimelineFromSourceLeadAndTimeline", () => {
  it("omits milestones without evidence", () => {
    const entries = buildTimelineFromSourceLeadAndTimeline(
      {
        id: "sl-1",
        receivedAt: "2026-06-01T10:00:00.000Z",
        sourceProvider: "test",
        sourceSystem: "webhook",
        sourceType: "fresh",
        sourceRouteKey: null,
        sourceLeadId: null,
        leadName: "Test",
        email: null,
        phone: null,
        status: "received",
        matched: false,
        matchedRuleId: null,
        destinationClientAccountId: null,
        destinationLocationIdGhl: null,
        errorSummary: null,
        sourceCampaignId: null,
        sourceCampaignName: null,
        sourceFunnelName: null,
        sourceLeadUid: null,
        rawPayloadJson: null,
        normalizedPayloadJson: null,
        routingResultJson: null,
        duplicateRiskJson: null,
        deliveryResultJson: null,
        enrichmentMetadataJson: null,
        enrichmentPreview: null,
        routingDryRunDecisionId: null,
        normalizedAt: null,
        routedAt: null,
        approvedAt: null,
        deliveredAt: null,
        approvedBy: null,
      },
      null
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.milestone, "source_lead_received");
    assert.equal(entries[0]?.status, "complete");
  });

  it("does not fabricate sold milestone without timeline evidence", () => {
    const entries = buildTimelineFromSourceLeadAndTimeline(null, {
      ok: true,
      identity: {
        leadUid: "L-1",
        contactIdGhl: null,
        displayName: "Test",
        phoneE164: null,
        email: null,
        clientAccountId: "client-1",
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
      timeline: [],
      missingMilestones: ["sold"],
      warnings: [],
    });
    assert.ok(!entries.some((e) => e.milestone === "sold"));
  });

  it("does not treat a LeadCapture routing_matched webhook as lifecycle or delivery", () => {
    const entries = buildTimelineFromSourceLeadAndTimeline(null, {
      ok: true,
      identity: {
        leadUid: "leadcaptureio-leadcapture_io_nextgen-6e4bfbf9-940e-49e7-87dc-d07661d592da",
        contactIdGhl: null,
        displayName: "Larry Hughes",
        phoneE164: "+15550109621",
        email: "larry.hughes.timeline@example.test",
        clientAccountId: "madison_pimentel",
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
          id: "wh-madison",
          source: "leadcapture_io",
          sourceTable: "WebhookRequestLog",
          requestId: "req-madison",
          eventUuid: null,
          eventNameInternal: "lead_created",
          eventNameMeta: null,
          receivedAt: "2026-10-20T12:05:05.810Z",
          validity: "valid",
          processingStatus: "routing_matched",
          httpStatus: "200",
          leadName: "Larry Hughes",
          phoneE164: "+15550109621",
          email: "larry.hughes.timeline@example.test",
          summary: "LeadCapture intake webhook status routing_matched.",
          errorSummary: null,
          webhookLogId: "wh-madison",
        },
      ],
      missingMilestones: ["lead_created", "sold"],
      warnings: ["No InboundContactIndex snapshot found for this lead scope."],
    });
    assert.equal(entries.some((entry) => entry.milestone === "lead_created"), false);
    assert.equal(entries.some((entry) => entry.milestone === "lead_delivered"), false);
    assert.equal(entries.some((entry) => entry.milestone === "client_contact_created"), false);
  });
});
