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
});
