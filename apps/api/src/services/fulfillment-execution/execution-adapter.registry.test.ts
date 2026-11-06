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

test("ghl.crm.v1 is registered for LF2 guarded execution", async () => {
  const adapter = getExecutionAdapter("ghl.crm.v1");
  assert.ok(adapter);
  assert.equal(adapter!.adapterKey, "ghl.crm.v1");
  assert.equal(typeof adapter!.deliverLive, "function");
  const result = await adapter!.simulate({
    payload: { instructionId: "instr_1", adapterKey: "ghl.crm.v1" },
  });
  assert.equal(result.simulation, true);
  assert.equal(result.ok, true);
});

test("adapter registration does not imply prisma migration", () => {
  assert.equal(listRegisteredExecutionAdapterKeys().length >= 1, true);
});

test("google_sheets.v1 has no execution adapter and cannot deliverLive", () => {
  assert.equal(getExecutionAdapter("google_sheets.v1"), null);
  assert.equal(listRegisteredExecutionAdapterKeys().includes("google_sheets.v1"), false);
});

test("webhook.generic.v1 is simulate-only and existing execution adapters stay", () => {
  const keys = listRegisteredExecutionAdapterKeys();
  assert.equal(keys.includes("webhook.generic.v1"), true);
  assert.equal(keys.includes("ghl.crm.v1"), true);
  assert.equal(keys.includes("file_export.csv.v1"), true);
  assert.equal(keys.includes("test.simulated.v1"), true);
  assert.equal(keys.includes("google_sheets.v1"), false);
  assert.equal(keys.includes("google_sheets.company.v1"), false);

  const webhook = getExecutionAdapter("webhook.generic.v1");
  assert.ok(webhook);
  assert.equal(Object.hasOwn(webhook, "deliverLive"), false);
  assert.equal(typeof getExecutionAdapter("ghl.crm.v1")?.deliverLive, "function");
  assert.equal(getExecutionAdapter("file_export.csv.v1")?.deliverLive, undefined);
  assert.equal(getExecutionAdapter("google_sheets.v1"), null);
  assert.equal(getExecutionAdapter("google_sheets.company.v1"), null);
});
