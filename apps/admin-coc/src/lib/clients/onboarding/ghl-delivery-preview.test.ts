import assert from "node:assert/strict";
import test from "node:test";

import { describeGhlDeliveryPreview } from "./ghl-delivery-preview.ts";

const WORKFLOW_ID = "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd";

test("preview names contact upsert, enrollment by id, omissions, and opportunity", () => {
  const facts = describeGhlDeliveryPreview({
    adapterRunId: "run_sim_1",
    workflowId: WORKFLOW_ID,
    workflowName: "New Lead",
    opportunityCreationEnabled: true,
    fieldMapping: {
      coreRequiredMapped: ["email", "phone"],
      coreRequiredMissing: ["state"],
      optionalMissing: ["beneficiary"],
    },
    steps: [
      {
        stepType: "create_or_update_contact",
        status: "simulated",
        targetId: null,
        title: "Contact",
        requestPreviewJson: { path: "/contacts/upsert" },
        validationErrors: [],
        warnings: [],
      },
      {
        stepType: "stamp_custom_fields",
        status: "simulated",
        targetId: null,
        title: "Fields",
        requestPreviewJson: { customFields: { email: "a@example.com", dob: null } },
        validationErrors: [],
        warnings: [],
      },
      {
        stepType: "start_workflow",
        status: "simulated",
        targetId: WORKFLOW_ID,
        title: "Workflow",
        requestPreviewJson: { path: "/contacts/:contactId/workflow/:workflowId", workflowId: WORKFLOW_ID },
        validationErrors: [],
        warnings: [],
      },
      {
        stepType: "create_or_update_opportunity",
        status: "failed_validation",
        targetId: null,
        title: "Opportunity",
        requestPreviewJson: null,
        validationErrors: ["Pipeline/stage not configured."],
        warnings: [],
      },
    ],
  });

  assert.match(facts.contact, /Create or update/);
  assert.match(facts.contact, /\/contacts\/upsert/);
  assert.match(facts.workflow, new RegExp(WORKFLOW_ID));
  assert.match(facts.workflow, /New Lead/);
  assert.doesNotMatch(facts.workflow, /must be named/i);
  assert.match(facts.fieldMapping, /email, phone/);
  assert.deepEqual(facts.omissions.sort(), ["beneficiary", "dob", "state"]);
  assert.match(facts.opportunity, /blocked/);
  assert.match(facts.opportunity, /Pipeline\/stage not configured/);
  assert.match(facts.persistedSimulation, /run_sim_1/);
  assert.equal(facts.ongoingDeliveryChanged, false);
});

test("direct_api says the live test enrolls the selected id", () => {
  const facts = describeGhlDeliveryPreview({
    adapterRunId: "run_sim_2",
    workflowId: WORKFLOW_ID,
    workflowTriggerMode: "direct_api",
    steps: [
      {
        stepType: "start_workflow",
        status: "simulated",
        targetId: WORKFLOW_ID,
        title: "Workflow",
        requestPreviewJson: { workflowId: WORKFLOW_ID },
        validationErrors: [],
        warnings: [],
      },
    ],
  });
  assert.match(facts.workflow, /enrolls this workflow id/);
  assert.match(facts.workflow, new RegExp(WORKFLOW_ID));
});

test("tag_trigger does not describe a call to the workflow id", () => {
  const facts = describeGhlDeliveryPreview({
    adapterRunId: "run_sim_3",
    workflowId: WORKFLOW_ID,
    workflowTriggerMode: "tag_trigger",
    steps: [
      {
        stepType: "start_workflow",
        status: "simulated",
        targetId: WORKFLOW_ID,
        title: "Workflow",
        requestPreviewJson: { workflowId: WORKFLOW_ID },
        validationErrors: [],
        warnings: [],
      },
    ],
  });
  assert.match(facts.workflow, /tag trigger/);
  assert.match(facts.workflow, /does not call this workflow id/);
});

test("a missing workflow id blocks enrollment without requiring a name", () => {
  const facts = describeGhlDeliveryPreview({
    adapterRunId: null,
    steps: [
      {
        stepType: "start_workflow",
        status: "failed_validation",
        targetId: null,
        title: "Workflow",
        requestPreviewJson: null,
        validationErrors: ["Workflow ID not configured."],
        warnings: [],
      },
    ],
    opportunityCreationEnabled: false,
  });
  assert.match(facts.workflow, /No workflow id/);
  assert.match(facts.opportunity, /creation is off/);
  assert.equal(facts.persistedSimulation, "This preview was not stored.");
});
