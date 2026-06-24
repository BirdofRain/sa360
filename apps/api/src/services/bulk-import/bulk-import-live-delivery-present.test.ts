import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceTagOnlyWorkflowTriggerNote,
  parseBulkImportLiveDeliverySnapshot,
} from "./bulk-import-live-delivery-present.service.js";
import { WORKFLOW_TAG_TRIGGER_DETAIL, WORKFLOW_TRIGGER_TAG } from "../ghl-delivery-adapter/ghl-workflow-trigger-mode.js";

test("source_tag_only without start_workflow step notes no trigger tags", () => {
  const snapshot = parseBulkImportLiveDeliverySnapshot(
    {
      contactIdGhl: "contact_123",
      liveRunStepSummary: [
        {
          stepType: "add_tags",
          label: "Tags",
          status: "succeeded",
          detail: "source:goat",
          httpStatus: 200,
          httpMethod: "POST",
          httpPath: "/contacts/contact_123/tags",
          errorMessage: null,
          externalId: "contact_123",
          requestBodyKeys: [],
          requestBodyPreview: null,
          configuredOwnerId: null,
          customFieldStampSummary: null,
        },
      ],
    },
    "source_tag_only"
  );
  assert.equal(snapshot?.workflowTriggerNote, "No NEW_LEAD or AI_READY trigger tag was added.");
});

test("source_tag_only with tag_trigger start_workflow step notes trigger tag added", () => {
  const snapshot = parseBulkImportLiveDeliverySnapshot(
    {
      contactIdGhl: "contact_123",
      opportunityIdGhl: "opp_456",
      liveRunId: "run_789",
      liveRunStepSummary: [
        {
          stepType: "start_workflow",
          label: "Workflow",
          status: "succeeded",
          detail: WORKFLOW_TAG_TRIGGER_DETAIL,
          httpStatus: 200,
          httpMethod: "POST",
          httpPath: "/contacts/contact_123/tags",
          errorMessage: null,
          externalId: "contact_123",
          requestBodyKeys: [],
          requestBodyPreview: null,
          configuredOwnerId: null,
          customFieldStampSummary: null,
          externalCallExecuted: true,
        },
      ],
    },
    "source_tag_only",
    new Date("2026-06-17T12:00:00.000Z")
  );
  assert.match(snapshot?.workflowTriggerNote ?? "", /Trigger tag added: SA360::TRIGGER::NEW_LEAD/);
  assert.match(snapshot?.workflowTriggerNote ?? "", /No direct workflow start API call was made/);
});

test("buildSourceTagOnlyWorkflowTriggerNote matches adapter tag_trigger detail", () => {
  const note = buildSourceTagOnlyWorkflowTriggerNote({
    stepType: "start_workflow",
    label: "Workflow",
    status: "succeeded",
    detail: WORKFLOW_TAG_TRIGGER_DETAIL,
    httpStatus: 200,
    httpMethod: "POST",
    httpPath: "/contacts/contact_123/tags",
    errorMessage: null,
    externalId: "contact_123",
    requestBodyKeys: [],
    requestBodyPreview: null,
    configuredOwnerId: null,
    customFieldStampSummary: null,
    requestId: null,
    responseBody: null,
    externalCallExecuted: true,
  });
  assert.ok(note.includes(WORKFLOW_TRIGGER_TAG));
  assert.ok(note.includes("No direct workflow start API call was made"));
});
