import assert from "node:assert/strict";
import { test } from "node:test";

import {
  labelForAllocation,
  labelForAttempt,
  labelForEligibility,
  labelForInventoryStatus,
} from "./status.ts";

test("eligibility labels", () => {
  assert.equal(labelForEligibility("eligible").label, "ELIGIBLE");
  assert.equal(labelForEligibility("ineligible").label, "INELIGIBLE");
});

test("inventory and allocation labels", () => {
  assert.equal(labelForInventoryStatus("pending_review").label, "PENDING REVIEW");
  assert.equal(labelForInventoryStatus("available").label, "ACTIVE");
  assert.equal(labelForAllocation("reserved").label, "RESERVED");
  assert.equal(labelForAllocation("shadow").label, "SIMULATION READY");
});

test("attempt labels never treat live as simulated success", () => {
  const live = labelForAttempt("succeeded", "live");
  assert.equal(live.label, "LIVE ATTEMPT");
  assert.equal(live.tone, "danger");
  const sim = labelForAttempt("succeeded", "simulation");
  assert.equal(sim.label, "SIMULATED");
  assert.equal(sim.tone, "success");
});
