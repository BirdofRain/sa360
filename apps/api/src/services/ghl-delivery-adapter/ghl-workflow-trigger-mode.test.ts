import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkflowTriggerMode,
  resolveWorkflowTriggerMode,
  WORKFLOW_TRIGGER_MODE_DEFAULT,
  WORKFLOW_TRIGGER_TAG,
} from "./ghl-workflow-trigger-mode.js";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";

test("normalizeWorkflowTriggerMode defaults to tag_trigger", () => {
  assert.equal(normalizeWorkflowTriggerMode(undefined), WORKFLOW_TRIGGER_MODE_DEFAULT);
  assert.equal(normalizeWorkflowTriggerMode("direct_api"), "direct_api");
  assert.equal(normalizeWorkflowTriggerMode("bogus"), "tag_trigger");
});

test("resolveWorkflowTriggerMode reads destination config", () => {
  const ctx: GhlAdapterPlanContext = {
    plan: {} as GhlAdapterPlanContext["plan"],
    rule: null,
    destinationFieldMapping: {
      sa360CustomFieldIdMapJson: {},
      customFieldStampRequired: false,
      ownerAssignmentRequired: false,
      workflowStartRequired: false,
      workflowTriggerMode: "none",
    },
  };
  assert.equal(resolveWorkflowTriggerMode(ctx), "none");
  assert.equal(WORKFLOW_TRIGGER_TAG, "SA360::TRIGGER::NEW_LEAD");
});
