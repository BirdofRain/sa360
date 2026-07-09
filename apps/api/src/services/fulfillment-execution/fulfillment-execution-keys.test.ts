import test from "node:test";
import assert from "node:assert/strict";

import { buildDeliveryAttemptIdempotencyKey } from "./fulfillment-execution-keys.js";

test("delivery attempt idempotency keys are distinct by execution mode", () => {
  const simulation = buildDeliveryAttemptIdempotencyKey("instr_1", 1, "simulation");
  const live = buildDeliveryAttemptIdempotencyKey("instr_1", 1, "live");
  assert.notEqual(simulation, live);
  assert.match(simulation, /:simulation:/);
  assert.match(live, /:live:/);
});
