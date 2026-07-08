import test from "node:test";
import assert from "node:assert/strict";
import type { SourceLeadEvent } from "@prisma/client";
import { processLeadConduitFacebookIntake } from "./leadconduit-facebook-intake.service.js";

const MASTER = "smart_agent_360_demo_2";

function fakeEvent(
  overrides: Partial<SourceLeadEvent> = {}
): SourceLeadEvent {
  return {
    id: "sle_existing_1",
    sourceProvider: "facebook",
    sourceSystem: "external_vendor",
    sourceType: "webhook",
    sourceRouteKey: "form_123",
    sourceCampaignId: "cmp_1",
    sourceCampaignName: "Campaign 1",
    sourceFunnelName: "Form 123",
    sourceLeadId: "leadgen_001",
    sourceLeadUid: "leadconduit-facebook-replay",
    clientAccountIdResolved: "smart_agent_360_demo_2",
    destinationLocationIdResolved: "VPuMIhN6JpxdoXvvlekZ",
    routingRuleIdResolved: "rule_1",
    status: "routing_matched",
    rawPayloadJson: {
      delivery_id: "delivery_123",
      leadgen_id: "leadgen_001",
      form_id: "form_123",
    },
    normalizedPayloadJson: {},
    routingResultJson: {
      matched: true,
      matchedRuleId: "rule_1",
      destinationClientAccountId: "smart_agent_360_demo_2",
      destinationLocationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
      routingDryRunDecisionId: "rdr_1",
    },
    duplicateRiskJson: null,
    deliveryResultJson: null,
    enrichmentMetadataJson: null,
    routingDryRunDecisionId: "rdr_1",
    errorSummary: null,
    webhookRequestLogId: "wrl_1",
    receivedAt: new Date("2026-07-08T13:00:00.000Z"),
    normalizedAt: new Date("2026-07-08T13:01:00.000Z"),
    routedAt: new Date("2026-07-08T13:02:00.000Z"),
    approvedAt: null,
    deliveredAt: null,
    approvedBy: null,
    bulkImportId: null,
    bulkImportRowId: null,
    cleanupStatus: null,
    cleanupReason: null,
    cleanupMarkedAt: null,
    createdAt: new Date("2026-07-08T13:00:00.000Z"),
    updatedAt: new Date("2026-07-08T13:02:00.000Z"),
    ...overrides,
  } as SourceLeadEvent;
}

test("terminal replay returns existing source event without duplicate persistence", async () => {
  let createCalls = 0;
  let updateCalls = 0;
  let persistCalls = 0;
  const result = await processLeadConduitFacebookIntake(
    {
      rawPayload: {
        delivery_id: "delivery_123",
        leadgen_id: "leadgen_001",
        form_id: "form_123",
      },
      masterClientAccountId: MASTER,
    },
    {
      findReplayEventImpl: async () => fakeEvent(),
      createSourceLeadEventImpl: async () => {
        createCalls += 1;
        return fakeEvent({ id: "should_not_happen" });
      },
      updateSourceLeadEventImpl: async () => {
        updateCalls += 1;
        return fakeEvent();
      },
      persistRoutingAndDuplicateImpl: async () => {
        persistCalls += 1;
        return {
          routing: {
            matched: true,
            matchedRuleId: "rule_1",
            destinationClientAccountId: "smart_agent_360_demo_2",
            destinationLocationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
            reason: "matched",
            matchType: "form_id",
            routingDryRunDecisionId: "rdr_1",
          },
          duplicateRiskJson: null,
          status: "routing_matched",
          normalizedWithEnrichment: {} as never,
        };
      },
    }
  );

  assert.equal(result.replayed, true);
  assert.equal(result.sourceEventId, "sle_existing_1");
  assert.equal(createCalls, 0);
  assert.equal(updateCalls, 0);
  assert.equal(persistCalls, 0);
});

test("new LeadConduit intake creates source event and runs shared routing/proof pipeline once", async () => {
  let createCalls = 0;
  let persistCalls = 0;
  const result = await processLeadConduitFacebookIntake(
    {
      rawPayload: {
        delivery_id: "delivery_789",
        leadgen_id: "leadgen_789",
        form_id: "form_789",
        trustedform_cert_url: "https://cert.trustedform.com/789",
      },
      masterClientAccountId: MASTER,
    },
    {
      findReplayEventImpl: async () => null,
      createSourceLeadEventImpl: async () => {
        createCalls += 1;
        return fakeEvent({
          id: "sle_created_1",
          sourceLeadId: "leadgen_789",
          sourceRouteKey: "form_789",
          status: "received",
        });
      },
      updateSourceLeadEventImpl: async (_id, data) =>
        fakeEvent({
          id: "sle_created_1",
          status: (data.status as SourceLeadEvent["status"]) ?? "normalized",
          normalizedPayloadJson: (data.normalizedPayloadJson as SourceLeadEvent["normalizedPayloadJson"]) ?? {},
        }),
      persistRoutingAndDuplicateImpl: async () => {
        persistCalls += 1;
        return {
          routing: {
            matched: true,
            matchedRuleId: "rule_789",
            destinationClientAccountId: "smart_agent_360_demo_2",
            destinationLocationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
            reason: "matched",
            matchType: "form_id",
            routingDryRunDecisionId: "rdr_789",
          },
          duplicateRiskJson: null,
          status: "routing_matched",
          normalizedWithEnrichment: {} as never,
        };
      },
    }
  );

  assert.equal(result.sourceEventId, "sle_created_1");
  assert.equal(result.replayed, false);
  assert.equal(result.matched, true);
  assert.equal(createCalls, 1);
  assert.equal(persistCalls, 1);
});
