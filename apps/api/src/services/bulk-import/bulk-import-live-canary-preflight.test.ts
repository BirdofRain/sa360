import assert from "node:assert/strict";
import test from "node:test";
import { BULK_IMPORT_INITIAL_CANARY_MAX_ROWS } from "@sa360/shared";
import { resolveBulkImportCanaryApprovalSources } from "./bulk-import-canary-approval-state.js";

test("routing rule approved but client destination not_reviewed shows explicit mismatch", () => {
  const sources = resolveBulkImportCanaryApprovalSources({
    batchId: "batch_1",
    destinationClientAccountId: "smart_agent_360_demo_2",
    importOptionsJson: {},
    clientGhlDestinationId: "dest_1",
    clientCutoverApproved: false,
    clientInternalApprovalStatus: "not_reviewed",
    expectedDemoClientAccountId: "smart_agent_360_demo_2",
    readyForDirectCanary: true,
    activeRoutingRules: [{ id: "rule_1", clientCutoverApproved: true, internalApprovalStatus: "approved" }],
  });

  assert.equal(sources.deliveryConfigReadyForDirectCanary, true);
  assert.equal(sources.clientCutoverApproved, false);
  assert.equal(sources.configReadyButCutoverPending, true);
  assert.equal(sources.routingRuleCutoverApproved, true);
  assert.equal(sources.routingRuleInternalApprovalMismatch, true);
});
