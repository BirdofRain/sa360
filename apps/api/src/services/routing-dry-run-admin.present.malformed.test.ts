import test from "node:test";
import assert from "node:assert/strict";
import type { RoutingDryRunDecision } from "@prisma/client";
import { mergeDuplicateRiskIntoReadiness } from "./lead-identity/lead-identity-correlation.service.js";
import { fallbackRoutingDryRunDecisionItem } from "./routing-dry-run-admin.present.js";

test("mergeDuplicateRiskIntoReadiness tolerates missing blockers array", () => {
  const merged = mergeDuplicateRiskIntoReadiness(null, {
    canDeliverLive: true,
    blockers: undefined as unknown as string[],
    warnings: [],
  });
  assert.equal(merged.canDeliverLive, true);
});

test("fallbackRoutingDryRunDecisionItem handles null matchReason and confidence", () => {
  const row = {
    id: "dec_demo",
    createdAt: new Date("2026-05-19T12:00:00.000Z"),
    sourceEventUuid: "demo_evt_rehearsal_001",
    sourceLeadUid: "sa360-demo-test-001",
    matched: true,
    confidence: null,
    matchType: null,
    matchedRuleId: "rule_x",
    destinationClientAccountId: "sa360_demo",
    destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
    matchReason: null,
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    attributionSnapshot: { partial: true },
    masterClientAccountId: "lal_master_vet",
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    validationStatus: "legacy_unknown",
    validationNotes: null,
    validatedAt: null,
    validatedBy: null,
  } as unknown as RoutingDryRunDecision;

  const item = fallbackRoutingDryRunDecisionItem(row);
  assert.equal(item.sourceLeadUid, "sa360-demo-test-001");
  assert.equal(item.confidence, "unknown");
  assert.equal(item.reason, "");
  assert.ok(item.suggestedValidation);
});
