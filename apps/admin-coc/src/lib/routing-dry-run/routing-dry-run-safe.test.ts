import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRoutingDryRunDecisionItem,
  normalizeRoutingDryRunDecisionList,
  ROUTING_DRY_RUN_ACTION_FAILED,
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

test("ROUTING_DRY_RUN_ACTION_FAILED message is stable", () => {
  assert.match(ROUTING_DRY_RUN_ACTION_FAILED, /Check server logs/i);
});
