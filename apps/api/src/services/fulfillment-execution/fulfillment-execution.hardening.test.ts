import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

import { claimDeliveryAttempt } from "./delivery-attempt.service.js";
import { safeReleaseReservation } from "./fulfillment-outcome.service.js";
import { commitFulfillmentSuccess } from "./fulfillment-outcome.service.js";
import { EXECUTION_MODE_LIVE, EXECUTION_MODE_SIMULATION } from "./fulfillment-execution.constants.js";
import { buildDeliveryAttemptIdempotencyKey } from "./fulfillment-execution-keys.js";

test("commitFulfillmentSuccess rejects simulation attempts", async () => {
  const db = {
    deliveryInstruction: {
      findUnique: async () => ({
        id: "instr_1",
        leadAllocationId: "alloc_1",
        leadAllocation: { leadOrder: { id: "order_1" } },
        deliveryAttempts: [{ id: "attempt_1", status: "succeeded", executionMode: "simulation" }],
      }),
    },
  } as unknown as PrismaClient;

  const result = await commitFulfillmentSuccess(
    "instr_1",
    { attemptId: "attempt_1", externalReference: "sim:1" },
    db
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "simulation_attempt_not_committable");
});

test("successful simulation does not block a later live claim idempotency key", () => {
  const simulationKey = buildDeliveryAttemptIdempotencyKey("instr_1", 1, EXECUTION_MODE_SIMULATION);
  const liveKey = buildDeliveryAttemptIdempotencyKey("instr_1", 2, EXECUTION_MODE_LIVE);
  assert.notEqual(simulationKey, liveKey);
});

test("claim rejects review_required instruction", async () => {
  const db = {
    deliveryInstruction: {
      findUnique: async () => ({
        id: "instr_1",
        status: "review_required",
        deliveryTarget: { adapterKey: "test.simulated.v1", configMetadataJson: {} },
        leadAllocation: { id: "alloc_1", status: "review_required", leadOrder: { id: "order_1" } },
        deliveryAttempts: [],
      }),
    },
  } as unknown as PrismaClient;

  const result = await claimDeliveryAttempt(
    "instr_1",
    { executionMode: EXECUTION_MODE_SIMULATION },
    db
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "instruction_not_claimable");
});

test("claim rejects released allocation", async () => {
  const db = {
    deliveryInstruction: {
      findUnique: async () => ({
        id: "instr_1",
        status: "planned",
        deliveryTarget: { adapterKey: "test.simulated.v1", configMetadataJson: {} },
        leadAllocation: { id: "alloc_1", status: "released", leadOrder: { id: "order_1" } },
        deliveryAttempts: [],
      }),
    },
  } as unknown as PrismaClient;

  const result = await claimDeliveryAttempt(
    "instr_1",
    { executionMode: EXECUTION_MODE_SIMULATION },
    db
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid_allocation_status");
});
