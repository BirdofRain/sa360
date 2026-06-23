import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeBatchInternalApprovalApproved,
  mergeBatchInternalApprovalCleared,
  readBatchInternalApprovalStatus,
  resolveBulkImportCanaryApprovalSources,
} from "./bulk-import-canary-approval-state.js";

test("internal approval prefers ClientGhlDestination over batch importOptions", () => {
  const sources = resolveBulkImportCanaryApprovalSources({
    batchId: "batch_1",
    destinationClientAccountId: "smart_agent_360_demo_2",
    importOptionsJson: { sourceIntakeCanInternalApprovalStatus: "approved" },
    clientGhlDestinationId: "dest_1",
    clientCutoverApproved: true,
    clientInternalApprovalStatus: "approved",
    expectedDemoClientAccountId: "smart_agent_360_demo_2",
    readyForDirectCanary: true,
    activeRoutingRules: [],
  });
  assert.equal(sources.internalApprovalSource, "ClientGhlDestination");
  assert.equal(sources.internalApprovalRecordId, "dest_1");
  assert.equal(sources.internalApprovalSatisfied, true);
});

test("routing rule internal approval mismatch when client destination pending", () => {
  const sources = resolveBulkImportCanaryApprovalSources({
    batchId: "batch_1",
    destinationClientAccountId: "smart_agent_360_demo_2",
    importOptionsJson: {},
    clientGhlDestinationId: "dest_1",
    clientCutoverApproved: true,
    clientInternalApprovalStatus: "not_reviewed",
    expectedDemoClientAccountId: "smart_agent_360_demo_2",
    readyForDirectCanary: true,
    activeRoutingRules: [{ id: "rule_1", clientCutoverApproved: true, internalApprovalStatus: "approved" }],
  });
  assert.equal(sources.routingRuleInternalApprovalMismatch, true);
  assert.equal(sources.internalApprovalSatisfied, false);
});

test("internal approval falls back to batch when client destination not approved", () => {
  const sources = resolveBulkImportCanaryApprovalSources({
    batchId: "batch_1",
    destinationClientAccountId: "smart_agent_360_demo_2",
    importOptionsJson: { sourceIntakeCanInternalApprovalStatus: "approved" },
    clientGhlDestinationId: "dest_1",
    clientCutoverApproved: true,
    clientInternalApprovalStatus: "not_reviewed",
    expectedDemoClientAccountId: "smart_agent_360_demo_2",
    readyForDirectCanary: true,
    activeRoutingRules: [],
  });
  assert.equal(sources.internalApprovalSource, "BulkLeadImport.importOptionsJson");
  assert.equal(sources.internalApprovalSatisfied, true);
});

test("client destination internal approval is authoritative when set", () => {
  const sources = resolveBulkImportCanaryApprovalSources({
    batchId: "batch_1",
    destinationClientAccountId: "smart_agent_360_demo_2",
    importOptionsJson: {},
    clientGhlDestinationId: "dest_1",
    clientCutoverApproved: true,
    clientInternalApprovalStatus: "approved",
    expectedDemoClientAccountId: "smart_agent_360_demo_2",
    readyForDirectCanary: true,
    activeRoutingRules: [],
  });
  assert.equal(sources.internalApprovalSource, "ClientGhlDestination");
  assert.equal(sources.internalApprovalRecordId, "dest_1");
  assert.equal(sources.internalApprovalSatisfied, true);
});

test("cutover approval always reads ClientGhlDestination", () => {
  const sources = resolveBulkImportCanaryApprovalSources({
    batchId: "batch_1",
    destinationClientAccountId: "smart_agent_360_demo_2",
    importOptionsJson: { sourceIntakeCanInternalApprovalStatus: "approved" },
    clientGhlDestinationId: "dest_1",
    clientCutoverApproved: false,
    clientInternalApprovalStatus: "approved",
    expectedDemoClientAccountId: "smart_agent_360_demo_2",
    readyForDirectCanary: true,
    activeRoutingRules: [{ id: "rule_1", clientCutoverApproved: true, internalApprovalStatus: "approved" }],
  });
  assert.equal(sources.cutoverApprovalSource, "ClientGhlDestination");
  assert.equal(sources.clientCutoverApproved, false);
  assert.equal(sources.configReadyButCutoverPending, true);
  assert.equal(sources.routingRuleCutoverApproved, true);
});

test("stale destination client id surfaces mismatch message", () => {
  const sources = resolveBulkImportCanaryApprovalSources({
    batchId: "batch_1",
    destinationClientAccountId: "smart_agent_360_demo",
    importOptionsJson: {},
    clientGhlDestinationId: "dest_1",
    clientCutoverApproved: true,
    clientInternalApprovalStatus: "approved",
    expectedDemoClientAccountId: "smart_agent_360_demo_2",
    readyForDirectCanary: true,
    activeRoutingRules: [],
  });
  assert.match(sources.destinationClientIdMismatch ?? "", /smart_agent_360_demo_2/);
});

test("mergeBatchInternalApprovalApproved preserves existing import options", () => {
  const merged = mergeBatchInternalApprovalApproved({
    workflowStrategy: "source_tag_only",
    vendorLabel: "demo",
  });
  assert.equal(merged.workflowStrategy, "source_tag_only");
  assert.equal(merged.vendorLabel, "demo");
  assert.equal(merged.sourceIntakeCanInternalApprovalStatus, "approved");
  assert.ok(merged.sourceIntakeCanInternalApprovedAt);
});

test("mergeBatchInternalApprovalCleared removes batch internal approval fields", () => {
  const cleared = mergeBatchInternalApprovalCleared({
    workflowStrategy: "source_tag_only",
    sourceIntakeCanInternalApprovalStatus: "approved",
    sourceIntakeCanInternalApprovedAt: "2026-06-17T12:00:00.000Z",
  });
  assert.equal(cleared.workflowStrategy, "source_tag_only");
  assert.equal(cleared.sourceIntakeCanInternalApprovalStatus, undefined);
  assert.equal(cleared.sourceIntakeCanInternalApprovedAt, undefined);
});

test("readBatchInternalApprovalStatus returns not_set when absent", () => {
  assert.equal(readBatchInternalApprovalStatus({}), "not_set");
});
