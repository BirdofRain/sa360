import test from "node:test";
import assert from "node:assert/strict";
import { DIRECT_DEMO_LIVE_CONFIRMATION_TEXT } from "./types.ts";
import {
  directDemoDeliveryTierSummary,
  directDemoOutcomeLabel,
  liveCanarySuccessDeliveryLines,
  normalizeDirectDemoResult,
} from "./normalize-result.ts";
import { formatDeployVersionsLine } from "../build-version.ts";
import { DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY } from "./types.ts";

const DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE =
  "No duplicate risk detected — safe to continue direct canary review.";

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
    reason: "Required delivery completed. Optional enrichment needs config.",
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
  assert.ok(view.reason?.includes("Optional enrichment needs config"));
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

test("directDemoDeliveryTierSummary treats custom field partial_success as optional needs config", () => {
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
        status: "partial_success",
        customFieldStampSummary:
          "TEXT stamped: sa360_lead_uid — Skipped: sa360_routing_status: Skipped option field sa360_routing_status — allowed options not available for validation.",
      },
    ],
  });
  const tiers = directDemoDeliveryTierSummary(view);
  assert.equal(tiers!.requiredDelivery, "succeeded");
  assert.equal(tiers!.optionalEnrichment, "needs_config");
  assert.equal(view.liveRunStepSummary[3]?.customFieldStampSummary?.includes("sa360_routing_status"), true);
});

test("normalizeDirectDemoResult maps duplicate risk to direct canary review copy", () => {
  const view = normalizeDirectDemoResult({
    ok: true,
    mode: "live_canary",
    duplicateRisk: {
      riskLevel: "none",
      blocksLiveDelivery: false,
      recommendedAction: DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE,
    },
  });
  assert.equal(view.duplicateRisk?.recommendedAction, DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE);
  assert.ok(!view.duplicateRisk?.recommendedAction?.includes("shadow delivery review"));
});

test("normalizeDirectDemoResult includes source lane labels", () => {
  const meta = normalizeDirectDemoResult({
    ok: true,
    mode: "simulate",
    sourceLane: "meta_lead_ads",
    sourceLaneLabel: "Meta Lead Ads",
  });
  assert.equal(meta.sourceLane, "meta_lead_ads");
  assert.equal(meta.sourceLaneLabel, "Meta Lead Ads");

  const lc = normalizeDirectDemoResult({
    ok: true,
    mode: "simulate",
    sourceLane: "leadcapture_io",
    sourceLaneLabel: "LeadCapture.io",
  });
  assert.equal(lc.sourceLaneLabel, "LeadCapture.io");

  const leadConduit = normalizeDirectDemoResult({
    ok: true,
    mode: "simulate",
    sourceLane: "leadconduit_facebook",
    sourceLaneLabel: "LeadConduit Facebook",
  });
  assert.equal(leadConduit.sourceLane, "leadconduit_facebook");
  assert.equal(leadConduit.sourceLaneLabel, "LeadConduit Facebook");
});

test("directDemoDeliveryTierSummary reports succeeded tiers on full live canary success", () => {
  const view = normalizeDirectDemoResult({
    ok: true,
    mode: "live_canary",
    liveRunStatus: "succeeded",
    summary: DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY,
    liveRunStepSummary: [
      { stepType: "create_or_update_contact", label: "Contact", status: "succeeded" },
      { stepType: "stamp_custom_fields", label: "Custom fields", status: "succeeded" },
      { stepType: "add_tags", label: "Tags", status: "succeeded" },
      { stepType: "create_or_update_opportunity", label: "Opportunity", status: "succeeded" },
      { stepType: "assign_owner", label: "Owner", status: "skipped" },
      { stepType: "start_workflow", label: "Workflow", status: "succeeded" },
    ],
  });
  const tiers = directDemoDeliveryTierSummary(view);
  assert.equal(tiers?.requiredDelivery, "succeeded");
  assert.equal(tiers?.optionalEnrichment, "ok");
  const lines = liveCanarySuccessDeliveryLines(view);
  assert.equal(lines?.length, 6);
  assert.equal(lines?.[4]?.status, "skipped");
});

test("formatDeployVersionsLine is safe for deploy bar rendering", () => {
  assert.equal(
    formatDeployVersionsLine(
      { commitShort: "608c761", commitSha: null, buildLabel: null },
      { commitShort: "608c761", commitSha: null, buildLabel: "2026-06-01T12:00:00Z" }
    ),
    "Deploy versions: Admin 608c761 · API 608c761 · 2026-06-01T12:00:00Z"
  );
});
