import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecision } from "@prisma/client";
import {
  fallbackRoutingDryRunDecisionItem,
  parseMatchTypeFromReason,
} from "./routing-dry-run-admin.present.js";

test("parseMatchTypeFromReason extracts tier from match reason", () => {
  assert.equal(
    parseMatchTypeFromReason("Matched routing rule (campaign_id) → Agent A"),
    "campaign_id"
  );
  assert.equal(parseMatchTypeFromReason("No active routing rule matched"), null);
});

test("fallbackRoutingDryRunDecisionItem serializes partial row safely", () => {
  const row = {
    id: "dec_partial",
    createdAt: new Date("2026-05-19T12:00:00.000Z"),
    sourceEventUuid: null,
    sourceLeadUid: "lead_1",
    matched: true,
    confidence: "high",
    matchType: null,
    matchedRuleId: "rule_missing",
    destinationClientAccountId: "client_1",
    destinationSubaccountIdGhl: null,
    matchReason: "Matched routing rule (campaign_id)",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    attributionSnapshot: null,
    masterClientAccountId: "lal_master_vet",
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: "legacy_unknown",
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
  } as RoutingDryRunDecision;

  const item = fallbackRoutingDryRunDecisionItem(row);
  assert.equal(item.id, "dec_partial");
  assert.equal(item.validationStatus, "legacy_unknown");
  assert.equal(item.deliveryReadiness, null);
  assert.equal(item.duplicateRisk, null);
  assert.ok(item.suggestedValidation.suggestedValidationReason);
  assert.deepEqual(item.lifecycleEventsEmitted, ["lead_matched", "lead_routed_dry_run"]);
});
