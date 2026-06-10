import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY,
  deriveLiveCanaryRunStatus,
  getLiveCanaryStepRequirementFlags,
  isRequiredDeliveryPathComplete,
  liveCanaryRunSummaryForStatus,
} from "./ghl-live-canary-step-requirements.js";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";

test("getLiveCanaryStepRequirementFlags defaults optional post-contact steps", () => {
  const flags = getLiveCanaryStepRequirementFlags({ plan: {} as never, rule: null });
  assert.equal(flags.ownerRequired, false);
  assert.equal(flags.workflowRequired, false);
  assert.equal(flags.stampRequired, false);
});

test("deriveLiveCanaryRunStatus fails when opportunity creation fails", () => {
  const flags = getLiveCanaryStepRequirementFlags({ plan: {} as never, rule: null });
  const status = deriveLiveCanaryRunStatus({
    stepOutcomes: [
      { stepType: "create_or_update_contact", status: "succeeded" },
      { stepType: "add_tags", status: "succeeded" },
      { stepType: "create_or_update_opportunity", status: "failed" },
    ],
    flags,
    contactIdGhl: "contact_1",
    opportunityConfigured: true,
  });
  assert.equal(status, "failed");
});

test("deriveLiveCanaryRunStatus partial success when required path ok and owner optional_failed", () => {
  const flags = getLiveCanaryStepRequirementFlags({ plan: {} as never, rule: null });
  const stepOutcomes = [
    { stepType: "create_or_update_contact", status: "succeeded" },
    { stepType: "stamp_custom_fields", status: "skipped" },
    { stepType: "add_tags", status: "succeeded" },
    { stepType: "create_or_update_opportunity", status: "succeeded" },
    { stepType: "assign_owner", status: "optional_failed" },
    { stepType: "start_workflow", status: "optional_failed" },
  ];
  assert.equal(
    deriveLiveCanaryRunStatus({
      stepOutcomes,
      flags,
      contactIdGhl: "contact_1",
      opportunityConfigured: true,
    }),
    "partial_success"
  );
  assert.equal(
    liveCanaryRunSummaryForStatus("partial_success", isRequiredDeliveryPathComplete(stepOutcomes, true)),
    DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY
  );
});

test("destination flags can require owner assignment failures", () => {
  const ctx = {
    plan: {} as GhlAdapterPlanContext["plan"],
    rule: null,
    destinationFieldMapping: {
      sa360CustomFieldIdMapJson: {},
      customFieldStampRequired: false,
      ownerAssignmentRequired: true,
      workflowStartRequired: false,
    },
  } satisfies GhlAdapterPlanContext;
  const flags = getLiveCanaryStepRequirementFlags(ctx);
  const status = deriveLiveCanaryRunStatus({
    stepOutcomes: [
      { stepType: "create_or_update_contact", status: "succeeded" },
      { stepType: "add_tags", status: "succeeded" },
      { stepType: "create_or_update_opportunity", status: "succeeded" },
      { stepType: "assign_owner", status: "failed" },
    ],
    flags,
    contactIdGhl: "contact_1",
    opportunityConfigured: true,
  });
  assert.equal(status, "failed");
});
