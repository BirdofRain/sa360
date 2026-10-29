import test from "node:test";
import assert from "node:assert/strict";
import { GHL_SINGLE_PLAN_CANARY_ID_ENV } from "../../lib/ghl-single-plan-canary.js";
import { ghlCrmExecutionAdapter } from "./ghl-crm-execution.adapter.js";

test("fulfillment live GHL refuses before fetch while a single-plan canary pin is set", async () => {
  const prev = process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV];
  process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV] = "plan_pinned";
  let called = false;
  const deliverLive = ghlCrmExecutionAdapter.deliverLive;
  assert.equal(typeof deliverLive, "function");
  const result = await deliverLive!({
    idempotencyKey: "idem_pin",
    authoritativeLocationId: "loc_pin",
    instructionId: "instr_pin",
    allocationId: "alloc_pin",
    clientAccountId: "alex_gross",
    clientDisplayName: "Alex",
    destinationConfig: { destinationSubaccountIdGhl: "yCziKRW26eFg8IXAQZ73" },
    sourceLeadEvent: {
      sourceLeadUid: null,
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      normalizedPayloadJson: {},
    },
    deps: {
      fetch: async () => {
        called = true;
        throw new Error("network must not be called");
      },
    },
  });
  if (prev !== undefined) process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV] = prev;
  else delete process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV];

  assert.equal(result.status, "terminal_pre_send_failure");
  assert.equal(result.errorCode, "single_plan_canary_pin");
  assert.equal(result.externalCallExecuted, false);
  assert.equal(called, false);
});
