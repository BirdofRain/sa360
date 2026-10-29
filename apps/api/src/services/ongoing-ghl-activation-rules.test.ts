import assert from "node:assert/strict";
import test from "node:test";

import {
  activationSnapshotMatches,
  discoveredResourcesMatchDestination,
  ongoingActivationInvalidationPatch,
} from "./ongoing-ghl-activation-rules.js";

const armed = {
  destinationSubaccountIdGhl: "loc-1",
  destinationWorkflowIdGhl: "wf-1",
  destinationPipelineIdGhl: "pipe-1",
  destinationPipelineStageIdGhl: "stage-1",
  deliveryEnabled: true,
  activationLocationIdGhl: "loc-1",
  activationWorkflowIdGhl: "wf-1",
  activationPipelineIdGhl: "pipe-1",
  activationStageIdGhl: "stage-1",
};

test("changing a saved workflow clears activation and an unchanged edit does not", () => {
  const cleared = ongoingActivationInvalidationPatch(armed, { destinationWorkflowIdGhl: "wf-2" });
  assert.equal(cleared?.deliveryEnabled, false);
  assert.equal(cleared?.deliveryMode, "shadow");
  assert.equal(cleared?.activationWorkflowIdGhl, null);
  assert.equal(ongoingActivationInvalidationPatch(armed, { destinationWorkflowIdGhl: "wf-1" }), null);
  assert.equal(
    ongoingActivationInvalidationPatch({ ...armed, deliveryEnabled: false, activationLocationIdGhl: null }, {
      destinationWorkflowIdGhl: "wf-2",
    }),
    null
  );
});

test("discovery requires the workflow, pipeline, and stage on that location", () => {
  const workflowsJson = [{ id: "wf-1", name: "Welcome" }];
  const pipelinesJson = [{ id: "pipe-1", name: "Leads", stages: [{ id: "stage-1", name: "New" }] }];
  assert.equal(
    discoveredResourcesMatchDestination({
      workflowTriggerMode: "direct_api",
      destinationWorkflowIdGhl: "wf-1",
      opportunityCreationEnabled: true,
      destinationPipelineIdGhl: "pipe-1",
      destinationPipelineStageIdGhl: "stage-1",
      workflowsJson,
      pipelinesJson,
    }).ok,
    true
  );
  const missingStage = discoveredResourcesMatchDestination({
    workflowTriggerMode: "direct_api",
    destinationWorkflowIdGhl: "wf-1",
    opportunityCreationEnabled: true,
    destinationPipelineIdGhl: "pipe-1",
    destinationPipelineStageIdGhl: "other",
    workflowsJson,
    pipelinesJson,
  });
  assert.equal(missingStage.ok, false);
  if (missingStage.ok) return;
  assert.equal(missingStage.code, "STAGE_NOT_ON_PIPELINE");
});

test("authorization matches only the activated resources", () => {
  const boundary = new Date("2026-10-29T16:00:00.000Z");
  assert.equal(
    activationSnapshotMatches({
      ...armed,
      workflowTriggerMode: "direct_api",
      opportunityCreationEnabled: true,
      ongoingDeliveryNotBefore: boundary,
    }),
    true
  );
  assert.equal(
    activationSnapshotMatches({
      ...armed,
      destinationPipelineStageIdGhl: "other",
      workflowTriggerMode: "direct_api",
      opportunityCreationEnabled: true,
      ongoingDeliveryNotBefore: boundary,
    }),
    false
  );
});
