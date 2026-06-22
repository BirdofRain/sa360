import test from "node:test";
import assert from "node:assert/strict";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import {
  isOpportunityDeliveryExpected,
  validateLiveOpportunityPreflight,
} from "./ghl-delivery-request-builders.js";

function makeCtx(
  rule?: Partial<NonNullable<GhlAdapterPlanContext["rule"]>>,
  plan?: Partial<GhlAdapterPlanContext["plan"]>
): GhlAdapterPlanContext {
  return {
    plan: {
      id: "plan_1",
      destinationSubaccountIdGhl: "loc_dest",
      destinationClientAccountId: "client_dest",
      sourceLeadUid: "lead_1",
      sourceEmail: "lead@example.test",
      sourcePhoneE164: "+15551234567",
      sourceContactIdGhl: null,
      nicheKey: "vet",
      steps: [],
      ...plan,
    } as unknown as GhlAdapterPlanContext["plan"],
    rule: {
      id: "rule_1",
      destinationPipelineIdGhl: "pipe_1",
      destinationPipelineStageIdGhl: "stage_1",
      opportunityCreationEnabled: true,
      nicheKey: "vet",
      ...rule,
    } as unknown as GhlAdapterPlanContext["rule"],
  };
}

test("preflight passes when location, pipeline, stage, contact, and name are present", () => {
  const result = validateLiveOpportunityPreflight(makeCtx(), "contact_123");
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("preflight blocks when pipeline/stage are missing", () => {
  const result = validateLiveOpportunityPreflight(
    makeCtx({ destinationPipelineIdGhl: null, destinationPipelineStageIdGhl: null }),
    "contact_123"
  );
  assert.equal(result.ok, false);
  assert.ok(result.missingConfig.includes("destinationPipelineIdGhl"));
  assert.ok(result.missingConfig.includes("destinationPipelineStageIdGhl"));
});

test("preflight blocks when contact ID is missing after upsert", () => {
  const result = validateLiveOpportunityPreflight(makeCtx(), null);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("Contact ID is missing")));
});

test("preflight blocks when location is missing", () => {
  const result = validateLiveOpportunityPreflight(
    makeCtx(undefined, { destinationSubaccountIdGhl: "" }),
    "contact_123"
  );
  assert.equal(result.ok, false);
  assert.ok(result.missingConfig.includes("destinationSubaccountIdGhl"));
});

test("preflight flags pipeline/stage that do not belong to known destination config", () => {
  const known = {
    pipelineIds: new Set(["pipe_other"]),
    stageIdsByPipeline: new Map([["pipe_1", new Set(["stage_other"])]]),
  };
  const result = validateLiveOpportunityPreflight(makeCtx(), "contact_123", known);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes("does not belong")));
});

test("preflight accepts pipeline/stage that belong to known destination config", () => {
  const known = {
    pipelineIds: new Set(["pipe_1"]),
    stageIdsByPipeline: new Map([["pipe_1", new Set(["stage_1"])]]),
  };
  const result = validateLiveOpportunityPreflight(makeCtx(), "contact_123", known);
  assert.equal(result.ok, true);
});

test("isOpportunityDeliveryExpected reflects rule configuration", () => {
  assert.equal(isOpportunityDeliveryExpected(makeCtx({ opportunityCreationEnabled: true })), true);
  assert.equal(
    isOpportunityDeliveryExpected(makeCtx({ opportunityCreationEnabled: false })),
    false
  );
  // Undefined enablement but a configured pipeline → expected.
  assert.equal(
    isOpportunityDeliveryExpected(
      makeCtx({ opportunityCreationEnabled: undefined, destinationPipelineStageIdGhl: null })
    ),
    true
  );
  // Undefined enablement and no pipeline/stage → not expected (contact-only).
  assert.equal(
    isOpportunityDeliveryExpected(
      makeCtx({
        opportunityCreationEnabled: undefined,
        destinationPipelineIdGhl: null,
        destinationPipelineStageIdGhl: null,
      })
    ),
    false
  );
});
