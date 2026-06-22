import test from "node:test";
import assert from "node:assert/strict";
import { summarizeLiveCanaryStepsFromRun } from "./ghl-live-canary-steps.present.js";
import type { GhlLiveDeliveryRunItem } from "./ghl-live-canary.present.js";

function makeRun(): GhlLiveDeliveryRunItem {
  return {
    id: "live_1",
    leadDeliveryPlanId: "plan_1",
    routingDryRunDecisionId: "dec_1",
    campaignRoutingRuleId: "rule_1",
    masterClientAccountId: "master",
    destinationClientAccountId: "smart_agent_360_demo",
    destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
    mode: "live_canary",
    status: "partial_success",
    idempotencyKey: "idem",
    operatorConfirmationText: "DELIVER ONE LEAD",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 100,
    executedBy: "admin",
    summary: "partial",
    warnings: ["Opportunity creation failed after contact was created."],
    errors: [],
    contactIdGhl: "contact_abc",
    opportunityIdGhl: null,
    workflowStarted: false,
    stepRuns: [
      {
        id: "s1",
        stepOrder: 1,
        stepType: "create_or_update_contact",
        targetSystem: "ghl",
        targetId: "VPuMIhN6JpxdoXvvlekZ",
        status: "succeeded",
        externalId: "contact_abc",
        errorCode: null,
        errorSummary: null,
        warnings: [],
        requestRedactedJson: { method: "POST", url: "https://api.example.com/contacts/upsert", body: { email: "a@b.test" } },
        responseRedactedJson: { externalCallExecuted: true },
        externalCallExecuted: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        id: "s4",
        stepOrder: 4,
        stepType: "create_or_update_opportunity",
        targetSystem: "ghl",
        targetId: "VPuMIhN6JpxdoXvvlekZ",
        status: "failed",
        externalId: null,
        errorCode: "http_422",
        errorSummary: "name is required",
        warnings: [],
        requestRedactedJson: {
          method: "POST",
          url: "https://api.example.com/opportunities/",
          body: {
            locationId: "VPuMIhN6JpxdoXvvlekZ",
            pipelineId: "pipe_1",
            pipelineStageId: "stage_1",
            contactId: "contact_abc",
          },
        },
        responseRedactedJson: { externalCallExecuted: true },
        externalCallExecuted: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
      {
        id: "s5",
        stepOrder: 5,
        stepType: "assign_owner",
        targetSystem: "ghl",
        targetId: "user_bad",
        status: "failed",
        externalId: null,
        errorCode: "http_400",
        errorSummary: "Invalid user id",
        warnings: [],
        requestRedactedJson: {
          method: "PUT",
          url: "https://api.example.com/contacts/contact_abc",
          body: { assignedTo: "user_bad" },
        },
        responseRedactedJson: { externalCallExecuted: true },
        externalCallExecuted: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ],
  };
}

test("summarizeLiveCanaryStepsFromRun includes custom field partial_success summary", () => {
  const run = makeRun();
  run.stepRuns.unshift({
    id: "s2",
    stepOrder: 2,
    stepType: "stamp_custom_fields",
    targetSystem: "ghl",
    targetId: "contact_abc",
    status: "partial_success",
    externalId: null,
    errorCode: null,
    errorSummary: "Option fields skipped until dropdown options are mapped/validated.",
    warnings: [],
    requestRedactedJson: {
      attemptedTextFields: ["sa360_lead_uid"],
      skippedFields: [
        {
          logicalKey: "sa360_routing_status",
          message: "Skipped option field sa360_routing_status — allowed options not available for validation.",
        },
      ],
    },
    responseRedactedJson: { externalCallExecuted: true },
    externalCallExecuted: true,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  const steps = summarizeLiveCanaryStepsFromRun(run);
  const stamp = steps.find((s) => s.stepType === "stamp_custom_fields");
  assert.ok(stamp?.customFieldStampSummary?.includes("TEXT stamped: sa360_lead_uid"));
  assert.ok(stamp?.customFieldStampSummary?.includes("sa360_routing_status"));
});

test("summarizeLiveCanaryStepsFromRun separates TEXT and option custom field stamps", () => {
  const run = makeRun();
  run.status = "succeeded";
  run.stepRuns.unshift({
    id: "s2",
    stepOrder: 2,
    stepType: "stamp_custom_fields",
    targetSystem: "ghl",
    targetId: "contact_abc",
    status: "succeeded",
    externalId: null,
    errorCode: null,
    errorSummary: null,
    warnings: [],
    requestRedactedJson: {
      stampPhases: {
        text: { attemptedFields: ["sa360_lead_uid", "sa360_event_uuid"] },
        option: {
          attemptedFields: [
            "sa360_lifecycle_stage",
            "sa360_routing_status",
            "sa360_niche_key",
          ],
        },
      },
      skippedFields: [],
    },
    responseRedactedJson: { externalCallExecuted: true },
    externalCallExecuted: true,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
  const stamp = summarizeLiveCanaryStepsFromRun(run).find(
    (s) => s.stepType === "stamp_custom_fields"
  );
  assert.ok(stamp?.customFieldStampSummary?.includes("TEXT stamped: sa360_lead_uid"));
  assert.ok(
    stamp?.customFieldStampSummary?.includes(
      "Option fields stamped: sa360_lifecycle_stage, sa360_routing_status, sa360_niche_key"
    )
  );
  assert.ok(stamp?.customFieldStampSummary?.includes("Skipped: none"));
});

test("summarizeLiveCanaryStepsFromRun carries externalCallExecuted per step", () => {
  const steps = summarizeLiveCanaryStepsFromRun(makeRun());
  const contact = steps.find((s) => s.stepType === "create_or_update_contact");
  assert.equal(contact?.externalCallExecuted, true);
  assert.equal(contact?.status, "succeeded");
  assert.equal(contact?.externalId, "contact_abc");
});

test("summarizeLiveCanaryStepsFromRun includes HTTP meta and request body keys", () => {
  const steps = summarizeLiveCanaryStepsFromRun(makeRun());
  const opp = steps.find((s) => s.stepType === "create_or_update_opportunity");
  assert.ok(opp);
  assert.equal(opp!.errorMessage, "name is required");
  assert.equal(opp!.httpMethod, "POST");
  assert.ok(opp!.httpPath?.includes("/opportunities"));
  assert.deepEqual(opp!.requestBodyKeys, [
    "locationId",
    "pipelineId",
    "pipelineStageId",
    "contactId",
  ]);
  assert.equal(opp!.requestBodyPreview?.namePresent, false);
  assert.equal(opp!.requestBodyPreview?.statusPresent, false);
  assert.equal(opp!.requestBodyPreview?.contactId, "contact_abc");
});
