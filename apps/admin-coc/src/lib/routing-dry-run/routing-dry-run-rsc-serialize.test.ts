import test from "node:test";
import assert from "node:assert/strict";
import { safeNormalizeRoutingDryRunDecisionList } from "./routing-dry-run-safe.ts";
import { serializeRoutingDryRunRowsForRsc } from "./routing-dry-run-rsc-serialize.ts";

test("serializeRoutingDryRunRowsForRsc produces JSON-safe rows", () => {
  const rows = safeNormalizeRoutingDryRunDecisionList([
    {
      id: "d1",
      createdAt: "2026-05-19T12:00:00.000Z",
      sourceLeadUid: "lead_1",
      matched: true,
      confidence: "high",
      reason: "ok",
      deliveryMode: "dry_run",
      routingEventNameInternal: "lead_matched",
      masterClientAccountId: "lal_master_vet",
      attributionSnapshot: { nested: { x: 1 } },
    },
  ]);
  const serialized = serializeRoutingDryRunRowsForRsc(rows);
  assert.doesNotThrow(() => JSON.stringify(serialized));
  assert.equal(serialized[0]?.rowPresentable, true);
});
