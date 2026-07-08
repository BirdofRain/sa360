import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE,
  DUPLICATE_RISK_SHADOW_REVIEW_MESSAGE,
  inferDirectDemoSourceLane,
  presentDuplicateRiskForDirectDemo,
  recommendedActionForDirectDemo,
} from "./direct-demo-delivery.present.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sa360-demo-lead-created.json"
);

test("inferDirectDemoSourceLane maps facebook lead form to meta_lead_ads", () => {
  const payload = JSON.parse(readFileSync(fixturePath, "utf8"));
  const lane = inferDirectDemoSourceLane(payload);
  assert.equal(lane.sourceLane, "meta_lead_ads");
  assert.equal(lane.sourceLaneLabel, "Meta Lead Ads");
});

test("inferDirectDemoSourceLane maps leadconduit marker to leadconduit_facebook", () => {
  const lane = inferDirectDemoSourceLane({
    attribution: {
      source_platform: "facebook",
      source_type: "leadconduit_facebook_lead_form",
    },
  });
  assert.equal(lane.sourceLane, "leadconduit_facebook");
  assert.equal(lane.sourceLaneLabel, "LeadConduit Facebook");
});

test("inferDirectDemoSourceLane maps leadcapture.io attribution", () => {
  const lane = inferDirectDemoSourceLane({
    attribution: { source_platform: "leadcapture.io", source_type: "landing_page_form" },
  });
  assert.equal(lane.sourceLane, "leadcapture_io");
  assert.equal(lane.sourceLaneLabel, "LeadCapture.io");
});

test("inferDirectDemoSourceLane maps preserved LeadCapture attribution", () => {
  const lane = inferDirectDemoSourceLane({
    routing: {
      source_intake: {
        sourceAttributes: {
          source_platform: "leadcapture_io",
          source_type: "landing_page_form",
        },
      },
    },
  });
  assert.equal(lane.sourceLane, "leadcapture_io");
  assert.equal(lane.sourceLaneLabel, "LeadCapture.io");
});

test("inferDirectDemoSourceLane falls back to manual lane for direct demo payload marker", () => {
  const lane = inferDirectDemoSourceLane({
    contact: { lead_uid: "demo_sa360_direct_delivery_custom" },
  });
  assert.equal(lane.sourceLane, "manual_direct_demo");
  assert.equal(lane.sourceLaneLabel, "Manual direct demo");
});

test("inferDirectDemoSourceLane returns unknown when no source signals are present", () => {
  const lane = inferDirectDemoSourceLane({
    event: { event_name_internal: "lead_created" },
  });
  assert.equal(lane.sourceLane, "unknown");
  assert.equal(lane.sourceLaneLabel, "Unknown");
});

test("recommendedActionForDirectDemo uses direct canary review wording", () => {
  assert.equal(
    recommendedActionForDirectDemo(DUPLICATE_RISK_SHADOW_REVIEW_MESSAGE),
    DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE
  );
});

test("presentDuplicateRiskForDirectDemo transforms shadow review copy only for direct demo", () => {
  const presented = presentDuplicateRiskForDirectDemo({
    id: "dup_1",
    riskLevel: "none",
    confidence: "high",
    blocksLiveDelivery: false,
    isWarningOnly: false,
    recommendedAction: DUPLICATE_RISK_SHADOW_REVIEW_MESSAGE,
    reasons: [],
    candidateMatches: [],
    identityStatus: "linked",
    masterClientAccountId: "lal_master_vet",
    destinationClientAccountId: "smart_agent_360_demo",
    destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
    sourceEventUuid: null,
    sourceLeadUid: null,
    routingDryRunDecisionId: "dec_1",
    leadDeliveryPlanId: null,
    operatorOverrideStatus: null,
    operatorNotes: null,
    operatorUpdatedAt: null,
    operatorUpdatedBy: null,
    evaluatedAt: new Date().toISOString(),
    identitySnapshot: {},
  } as never);
  assert.equal(presented?.recommendedAction, DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE);
});
