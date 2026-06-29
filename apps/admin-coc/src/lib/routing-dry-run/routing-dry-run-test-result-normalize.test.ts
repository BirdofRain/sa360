import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRoutingDryRunTestResult } from "./routing-dry-run-safe.ts";

test("normalizeRoutingDryRunTestResult fills missing lifecycleEventsEmitted with empty array", () => {
  const result = normalizeRoutingDryRunTestResult({
    matched: true,
    confidence: "high",
    reason: "Matched routing rule (campaign_id)",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    decisionId: "dec_1",
  });
  assert.deepEqual(result.lifecycleEventsEmitted, []);
});

test("normalizeRoutingDryRunTestResult tolerates null/undefined and non-object input", () => {
  for (const raw of [null, undefined, 42, "nope", []]) {
    const result = normalizeRoutingDryRunTestResult(raw as never);
    assert.equal(result.matched, false);
    assert.equal(result.confidence, "unknown");
    assert.equal(result.deliveryMode, "dry_run");
    assert.equal(result.routingEventNameInternal, "routing_review_required");
    assert.deepEqual(result.lifecycleEventsEmitted, []);
  }
});

test("normalizeRoutingDryRunTestResult filters non-string lifecycle events", () => {
  const result = normalizeRoutingDryRunTestResult({
    matched: false,
    lifecycleEventsEmitted: ["lead_created", 5, null, "routing_review_required"],
  });
  assert.deepEqual(result.lifecycleEventsEmitted, [
    "lead_created",
    "routing_review_required",
  ]);
});

test("normalizeRoutingDryRunTestResult preserves matched-rule and destination fields", () => {
  const result = normalizeRoutingDryRunTestResult({
    matched: true,
    confidence: "high",
    matchType: "campaign_id",
    matchedRuleId: "rule_42",
    destinationClientAccountId: "client_demo",
    destinationSubaccountIdGhl: "sub_demo",
    reason: "Matched routing rule (campaign_id)",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    decisionId: "dec_42",
    lifecycleEventsEmitted: ["lead_matched"],
  });
  assert.equal(result.matchedRuleId, "rule_42");
  assert.equal(result.matchType, "campaign_id");
  assert.equal(result.destinationClientAccountId, "client_demo");
  assert.equal(result.destinationSubaccountIdGhl, "sub_demo");
  assert.equal(result.decisionId, "dec_42");
});

test("normalizeRoutingDryRunTestResult omits blank optional fields rather than emitting empty strings", () => {
  const result = normalizeRoutingDryRunTestResult({
    matched: false,
    matchedRuleId: "",
    destinationClientAccountId: "   ",
  });
  assert.equal(result.matchedRuleId, undefined);
  assert.equal(result.destinationClientAccountId, undefined);
});
