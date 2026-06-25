import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRoutingDryRunDecisionItem,
  normalizeRoutingDryRunDecisionList,
  ROUTING_DRY_RUN_ACTION_FAILED,
  ROUTING_DRY_RUN_ROW_UNAVAILABLE,
  safeNormalizeRoutingDryRunDecisionList,
} from "./routing-dry-run-safe.ts";
import { routingDryRunDecisionFixture } from "./routing-dry-run-suggestion-fixture.ts";

test("normalizeRoutingDryRunDecisionItem fills missing suggestion and lifecycle arrays", () => {
  const item = normalizeRoutingDryRunDecisionItem({
    id: "d1",
    createdAt: "2026-05-19T12:00:00.000Z",
    sourceLeadUid: "lead_1",
    matched: true,
    confidence: "high",
    reason: "ok",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    masterClientAccountId: "master_1",
  } as never);
  assert.ok(item.suggestedValidation.suggestedValidationReason);
  assert.deepEqual(item.lifecycleEventsEmitted, []);
});

test("normalizeRoutingDryRunDecisionList tolerates null input", () => {
  assert.deepEqual(normalizeRoutingDryRunDecisionList(null), []);
});

test("partial row with null readiness renders-safe after normalize", () => {
  const item = normalizeRoutingDryRunDecisionItem(
    routingDryRunDecisionFixture({
      deliveryReadiness: null,
      suggestedValidation: undefined as never,
      lifecycleEventsEmitted: undefined as never,
    })
  );
  assert.equal(item.deliveryReadiness, null);
  assert.ok(item.suggestedValidation);
  assert.deepEqual(item.lifecycleEventsEmitted, []);
});

test("safeNormalizeRoutingDryRunDecisionList tolerates null entries", () => {
  const rows = safeNormalizeRoutingDryRunDecisionList([
    null,
    {
      id: "ok",
      createdAt: "2026-05-19T12:00:00.000Z",
      sourceLeadUid: "lead_ok",
      matched: true,
      confidence: "high",
      reason: "ok",
      deliveryMode: "dry_run",
      routingEventNameInternal: "lead_matched",
      masterClientAccountId: "lal_master_vet",
    },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.rowPresentable, false);
  assert.match(rows[0]?.reason ?? "", new RegExp(ROUTING_DRY_RUN_ROW_UNAVAILABLE));
  assert.equal(rows[1]?.rowPresentable, true);
});

test("ROUTING_DRY_RUN_ACTION_FAILED message is stable", () => {
  assert.match(ROUTING_DRY_RUN_ACTION_FAILED, /Check server logs/i);
});

test("Bre-like partial matched legacy_unknown row normalizes without crash fields", () => {
  const item = normalizeRoutingDryRunDecisionItem({
    id: "dec_bre",
    createdAt: "2026-05-19T12:00:00.000Z",
    sourceLeadUid: "lead_bre",
    matched: true,
    confidence: "high",
    matchType: "campaign_id",
    matchedRuleId: "rule_bre",
    matchedRuleSummary: {
      id: "rule_bre",
      clientAccountId: "client_demo",
      clientDisplayName: "SA360 Demo",
      nicheKey: null,
      productType: null,
      matchType: "campaign_id",
    },
    destinationClientAccountId: "client_demo",
    destinationSubaccountIdGhl: null,
    reason: "Matched routing rule (campaign_id)",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    masterClientAccountId: "lal_master_vet",
    validationStatus: "legacy_unknown",
    deliveryReadiness: {
      readinessStatus: "needs_config",
      missingConfig: [
        "destinationWorkflowIdGhl",
        "destinationPipelineIdGhl",
        "destinationPipelineStageIdGhl",
        "requiredFieldsInstalled",
      ],
      blockers: ["GHL delivery IDs incomplete"],
      warnings: null,
      checklist: null,
    },
    duplicateRisk: null,
    deliveryPlanSummary: null,
    suggestedValidation: null,
    suggestedLegacyPrefill: null,
    lifecycleEventsEmitted: null,
  } as never);

  assert.equal(item.validationStatus, "legacy_unknown");
  assert.ok(item.suggestedValidation);
  assert.deepEqual(item.lifecycleEventsEmitted, []);
  assert.equal(item.duplicateRisk, null);
  assert.ok(item.deliveryReadiness);
  assert.deepEqual(item.deliveryReadiness?.warnings, []);
  assert.deepEqual(item.deliveryReadiness?.missingConfig, [
    "destinationWorkflowIdGhl",
    "destinationPipelineIdGhl",
    "destinationPipelineStageIdGhl",
    "requiredFieldsInstalled",
  ]);
});
