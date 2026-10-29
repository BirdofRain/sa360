import assert from "node:assert/strict";
import test from "node:test";

import { DELIVERY_RUNTIME_GATES, liveCanaryEnablesOngoingDrain } from "./delivery-runtime-gates.js";

test("live_canary documents the ongoing drain separately from Sheets and one-lead gates", () => {
  assert.equal(DELIVERY_RUNTIME_GATES.liveWriteRequiresEffectiveMode, "live_canary");
  const ongoing = DELIVERY_RUNTIME_GATES.pathsEnabledWhenLiveCanary.find(
    (row) => row.id === "ongoing_association_drain"
  );
  assert.ok(ongoing);
  if (!ongoing || !("doesNotUse" in ongoing)) return;
  assert.ok(ongoing.doesNotUse.includes("SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS"));
  assert.ok(ongoing.doesNotUse.includes("DELIVER ONE LEAD"));
  assert.ok(ongoing.doesNotUse.includes("SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED"));
  assert.ok(
    DELIVERY_RUNTIME_GATES.unchangedByLiveCanary.includes("SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED")
  );
  assert.equal(liveCanaryEnablesOngoingDrain(), true);
  const ids = DELIVERY_RUNTIME_GATES.pathsEnabledWhenLiveCanary.map((row) => row.id);
  assert.deepEqual(ids, [
    "ongoing_association_drain",
    "one_lead_canary",
    "approve_source_lead",
    "direct_demo_and_bulk_live",
    "fulfillment_deliver_live",
  ]);
});
