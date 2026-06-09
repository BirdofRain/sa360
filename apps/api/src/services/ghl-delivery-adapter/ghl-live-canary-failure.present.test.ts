import test from "node:test";
import assert from "node:assert/strict";
import { summarizeLiveCanaryFailureFromRun } from "./ghl-live-canary-failure.present.js";
import type { GhlLiveDeliveryRunItem } from "./ghl-live-canary.present.js";

function failedContactRun(): GhlLiveDeliveryRunItem {
  return {
    id: "live_1",
    leadDeliveryPlanId: "plan_1",
    routingDryRunDecisionId: "dec_1",
    campaignRoutingRuleId: null,
    masterClientAccountId: "master_1",
    destinationClientAccountId: "client_dest",
    destinationSubaccountIdGhl: "loc_dest",
    mode: "live_canary",
    status: "failed",
    idempotencyKey: "idem_1",
    operatorConfirmationText: "DELIVER ONE LEAD",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 10,
    executedBy: "test",
    summary: "Contact creation failed; remaining GHL write steps were not executed.",
    warnings: [],
    errors: ["Contact upsert failed."],
    contactIdGhl: null,
    opportunityIdGhl: null,
    workflowStarted: false,
    stepRuns: [
      {
        id: "step_1",
        stepOrder: 1,
        stepType: "create_or_update_contact",
        targetSystem: "ghl",
        targetId: "loc_dest",
        status: "failed",
        externalId: null,
        errorCode: "http_400",
        errorSummary: "customFields must be an array",
        warnings: [],
        requestRedactedJson: {
          method: "POST",
          url: "https://services.leadconnectorhq.com/contacts/upsert",
          body: { locationId: "loc_dest", email: "a@example.test", phone: "+15551234567" },
        },
        responseRedactedJson: { externalCallExecuted: true },
        externalCallExecuted: true,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ],
  };
}

test("summarizeLiveCanaryFailureFromRun extracts contact step failure", () => {
  const summary = summarizeLiveCanaryFailureFromRun(failedContactRun());
  assert.ok(summary);
  assert.equal(summary!.failedStepType, "create_or_update_contact");
  assert.equal(summary!.httpStatus, 400);
  assert.equal(summary!.errorMessage, "customFields must be an array");
  assert.deepEqual(summary!.requestBodyKeys, ["locationId", "email", "phone"]);
  assert.equal(summary!.partialContactCreated, false);
});
