import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDestinationReadiness,
  type DestinationReadinessInput,
} from "./destination-readiness.service.js";
import { GHL_CONNECTION_CONNECTED } from "../lib/delivery-readiness-status.js";

function baseInput(overrides: Partial<DestinationReadinessInput> = {}): DestinationReadinessInput {
  return {
    clientAccountId: "vet_life_james_torrey",
    clientDisplayName: "Vet Life — James Torrey",
    destinationSubaccountIdGhl: "9xSNvQCbGaPE9YNxgl4B",
    destinationWorkflowIdGhl: "wf_1",
    destinationPipelineIdGhl: "pipe_1",
    destinationPipelineStageIdGhl: "stage_1",
    defaultAssignedUserIdGhl: "user_1",
    ghlConnectionStatus: GHL_CONNECTION_CONNECTED,
    snapshotInstalled: true,
    requiredFieldsInstalled: true,
    opportunityCreationEnabled: true,
    connectionStatus: "connected",
    lastProbeAt: new Date().toISOString(),
    workflowTriggerMode: "tag_trigger",
    ...overrides,
  };
}

test("destination readiness does not reference masterClientAccountId", () => {
  const assessment = evaluateDestinationReadiness(baseInput());
  assert.ok(!JSON.stringify(assessment).includes("lal_master_vet"));
  assert.ok(!JSON.stringify(assessment).includes("masterClientAccountId"));
});

test("destination checklist excludes routing-specific items", () => {
  const assessment = evaluateDestinationReadiness(baseInput());
  const keys = assessment.checklist.map((c) => c.key);
  assert.ok(!keys.includes("campaign_mapping"));
  assert.ok(!keys.includes("test_lead_matched"));
  assert.ok(!keys.includes("shadow_plan"));
  assert.ok(!keys.includes("legacy_validated"));
  assert.ok(keys.includes("oauth_connected"));
  assert.ok(keys.includes("client_linked"));
  assert.ok(keys.includes("direct_canary"));
});

test("destination readiness works without routing rule context", () => {
  const assessment = evaluateDestinationReadiness(
    baseInput({
      destinationPipelineIdGhl: null,
      destinationPipelineStageIdGhl: null,
    })
  );
  assert.equal(assessment.readyForSimulation, false);
  assert.ok(assessment.missingConfig.includes("destinationPipelineIdGhl"));
});

test("buildDestinationOnboardingChecklist marks probe required when no lastProbeAt", () => {
  const input = baseInput({ lastProbeAt: null, connectionStatus: "connected" });
  const assessment = evaluateDestinationReadiness(input);
  const probeItem = assessment.checklist.find((c) => c.key === "probe_healthy");
  assert.equal(probeItem?.complete, false);
});

test("oauth revoked surfaces recovery issue code", () => {
  const assessment = evaluateDestinationReadiness(
    baseInput({ connectionStatus: "revoked", ghlConnectionStatus: "revoked" })
  );
  assert.ok(assessment.issueCodes.includes("oauth_revoked"));
  assert.ok(assessment.blockers.some((b) => /revoked/i.test(b)));
});
