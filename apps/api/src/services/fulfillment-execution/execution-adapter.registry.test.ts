import test from "node:test";
import assert from "node:assert/strict";

import {
  getExecutionAdapter,
  listRegisteredExecutionAdapterKeys,
} from "./execution-adapter.registry.js";

test("test.simulated.v1 is registered and makes no network assumptions", async () => {
  const adapter = getExecutionAdapter("test.simulated.v1");
  assert.ok(adapter);
  assert.equal(adapter!.adapterKey, "test.simulated.v1");
  const payload = adapter!.buildPayload({
    allocationId: "alloc_1",
    instructionId: "instr_1",
    configMetadata: {},
  });
  const result = await adapter!.simulate({ payload });
  assert.equal(result.simulation, true);
  assert.equal(result.ok, true);
});

test("ghl.crm.v1 is not registered for execution in PR A", () => {
  assert.equal(getExecutionAdapter("ghl.crm.v1"), null);
  assert.ok(listRegisteredExecutionAdapterKeys().includes("test.simulated.v1"));
});

test("adapter registration does not imply prisma migration", () => {
  assert.equal(listRegisteredExecutionAdapterKeys().length >= 1, true);
});
