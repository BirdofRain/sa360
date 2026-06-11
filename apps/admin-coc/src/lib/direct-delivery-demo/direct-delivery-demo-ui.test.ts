import test from "node:test";
import assert from "node:assert/strict";
import { DIRECT_DEMO_LIVE_CONFIRMATION_TEXT } from "./types.ts";
import {
  directDemoDeliveryTierSummary,
  directDemoOutcomeLabel,
  normalizeDirectDemoResult,
} from "./normalize-result.ts";

test("live confirmation gate requires exact phrase", () => {
  assert.notEqual("deliver one lead", DIRECT_DEMO_LIVE_CONFIRMATION_TEXT);
  assert.equal(DIRECT_DEMO_LIVE_CONFIRMATION_TEXT, "DELIVER ONE LEAD");
});

test("partial success live canary is not labeled full success", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    matched: true,
    externalCallExecuted: true,
    liveRunStatus: "partial_success",
    contactIdGhl: "contact_1",
    reason:
      "Partial success — required delivery completed; optional post-contact steps need config.",
    liveRunStepSummary: [
      { stepType: "add_tags", label: "Tags", status: "succeeded" },
      {
        stepType: "assign_owner",
        label: "Owner assignment",
        status: "optional_failed",
        errorMessage: "Invalid user id",
      },
    ],
  });
  assert.equal(directDemoOutcomeLabel(view), "partial_success");
  assert.notEqual(directDemoOutcomeLabel(view), "success");
  assert.ok(view.reason?.includes("required delivery completed"));
});

test("directDemoDeliveryTierSummary separates required and optional on partial success", () => {
  const view = normalizeDirectDemoResult({
    ok: false,
    mode: "live_canary",
    liveRunStatus: "partial_success",
    liveRunStepSummary: [
      { stepType: "create_or_update_contact", label: "Contact", status: "succeeded" },
      { stepType: "add_tags", label: "Tags", status: "succeeded" },
      { stepType: "create_or_update_opportunity", label: "Opportunity", status: "succeeded" },
      {
        stepType: "stamp_custom_fields",
        label: "Custom fields",
        status: "optional_failed",
        errorMessage: "HTTP 422",
      },
      { stepType: "start_workflow", label: "Workflow", status: "skipped" },
    ],
  });
  const tiers = directDemoDeliveryTierSummary(view);
  assert.ok(tiers);
  assert.equal(tiers!.requiredDelivery, "succeeded");
  assert.equal(tiers!.optionalEnrichment, "needs_config");
});
