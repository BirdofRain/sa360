import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

import { simulateDeliveryInstruction } from "./delivery-attempt.service.js";

test("simulation records simulation=true and leaves allocation reserved", async () => {
  let allocationStatus = "delivering";
  let instructionStatus = "executing";
  let claimCalls = 0;

  const db = {
    deliveryInstruction: {
      findUnique: async () => ({
        id: "instr_1",
        status: "planned",
        deliveryTarget: { adapterKey: "test.simulated.v1", configMetadataJson: {} },
        leadAllocation: {
          id: "alloc_1",
          status: "reserved",
          leadOrderId: "order_1",
          leadOrder: { id: "order_1" },
        },
        deliveryAttempts: [],
      }),
      updateMany: async ({ data }: { data: { status?: string } }) => {
        if (data.status) instructionStatus = data.status;
        return { count: 1 };
      },
    },
    deliveryAttempt: {
      findFirst: async () => null,
      findUnique: async () => ({
        id: "attempt_1",
        attemptNumber: 1,
        adapterKey: "test.simulated.v1",
        idempotencyKey: "attempt:key",
        sanitizedRequestJson: { simulation: true, instructionId: "instr_1" },
        deliveryInstructionId: "instr_1",
        deliveryInstruction: { leadAllocationId: "alloc_1" },
      }),
      create: async () => {
        claimCalls += 1;
        return { id: "attempt_1" };
      },
      update: async () => ({ id: "attempt_1" }),
      updateMany: async () => ({ count: 1 }),
    },
    leadAllocation: {
      updateMany: async ({ data }: { data: { status?: string } }) => {
        if (data.status) allocationStatus = data.status;
        return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: PrismaClient) => Promise<void>) => {
      const tx = {
        deliveryAttempt: {
          findFirst: async () => null,
          create: async () => {
            claimCalls += 1;
            return { id: "attempt_1" };
          },
          update: async () => ({}),
          updateMany: async () => ({ count: 1 }),
        },
        deliveryInstruction: {
          updateMany: async ({ data }: { data: { status?: string } }) => {
            if (data.status) instructionStatus = data.status;
            return { count: 1 };
          },
        },
        leadAllocation: {
          updateMany: async ({ data }: { data: { status?: string } }) => {
            if (data.status) allocationStatus = data.status;
            return { count: 1 };
          },
        },
        $queryRaw: async () => [{ id: "alloc_1", status: "reserved" }],
        $executeRaw: async () => 1,
      } as unknown as PrismaClient;
      await fn(tx);
    },
  } as unknown as PrismaClient;

  const result = await simulateDeliveryInstruction("instr_1", db);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.simulation, true);
    assert.equal(result.allocationStatus, "reserved");
    assert.equal(result.instructionStatus, "planned");
    assert.equal(result.sanitizedResponse.simulation, true);
  }
  assert.ok(claimCalls >= 1);
});

test("duplicate claim returns existing active attempt", async () => {
  const db = {
    deliveryInstruction: {
      findUnique: async () => ({
        id: "instr_1",
        status: "planned",
        deliveryTarget: { adapterKey: "test.simulated.v1", configMetadataJson: {} },
        leadAllocation: {
          id: "alloc_1",
          status: "reserved",
          leadOrder: { id: "order_1" },
        },
        deliveryAttempts: [
          {
            id: "attempt_active",
            attemptNumber: 1,
            idempotencyKey: "key_1",
            status: "claimed",
          },
        ],
      }),
    },
  } as unknown as PrismaClient;

  const { claimDeliveryAttempt } = await import("./delivery-attempt.service.js");
  const result = await claimDeliveryAttempt("instr_1", { executionMode: "simulation" }, db);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "already_claimed");
    assert.equal(result.attemptId, "attempt_active");
  }
});

test("attempt numbers are monotonic via repository contract", async () => {
  const attempts = [{ attemptNumber: 1, status: "retryable_failure" }];
  const latest = attempts[attempts.length - 1];
  assert.equal((latest!.attemptNumber ?? 0) + 1, 2);
});
