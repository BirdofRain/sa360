import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

import {
  commitFulfillmentSuccess,
  recordRetryableAttemptFailure,
  safeReleaseReservation,
} from "./fulfillment-outcome.service.js";
import { recordAttemptUnknownOutcome } from "./delivery-attempt.service.js";

test("unknown outcome holds reservation and blocks automatic retry semantics", async () => {
  let allocationStatus = "delivering";
  const db = {
    deliveryAttempt: {
      findUnique: async () => ({
        id: "attempt_1",
        deliveryInstructionId: "instr_1",
        deliveryInstruction: { leadAllocationId: "alloc_1", leadAllocation: { id: "alloc_1" } },
      }),
      update: async ({ data }: { data: { status: string; retryable: boolean } }) => {
        assert.equal(data.status, "unknown_outcome");
        assert.equal(data.retryable, false);
        return { id: "attempt_1" };
      },
    },
    $transaction: async (fn: (tx: PrismaClient) => Promise<void>) => {
      const tx = {
        deliveryAttempt: {
          update: async ({ data }: { data: { status: string; retryable: boolean } }) => {
            assert.equal(data.status, "unknown_outcome");
            assert.equal(data.retryable, false);
          },
        },
        leadAllocation: {
          update: async ({ data }: { data: { status: string } }) => {
            allocationStatus = data.status;
          },
        },
        deliveryInstruction: { updateMany: async () => ({ count: 1 }) },
      } as unknown as PrismaClient;
      await fn(tx);
    },
  } as unknown as PrismaClient;

  const result = await recordAttemptUnknownOutcome(
    "attempt_1",
    { errorSummary: "provider timeout" },
    db
  );
  assert.equal(result.ok, true);
  assert.equal(allocationStatus, "review_required");
});

test("retryable failure preserves prior attempt row immutability contract", async () => {
  let status = "claimed";
  const db = {
    deliveryAttempt: {
      update: async ({ data }: { data: { status: string; retryable: boolean } }) => {
        status = data.status;
        assert.equal(data.retryable, true);
        return { id: "attempt_1" };
      },
    },
  } as unknown as PrismaClient;

  await recordRetryableAttemptFailure(
    "attempt_1",
    { errorCode: "simulated", errorSummary: "retry later" },
    db
  );
  assert.equal(status, "retryable_failure");
});

test("safeReleaseReservation releases reserved allocation when no active attempts", async () => {
  let released = false;
  const db = {
    leadAllocation: {
      findUnique: async () => ({
        id: "alloc_1",
        status: "reserved",
        leadOrderId: "order_1",
        leadOrder: { id: "order_1" },
        deliveryInstructions: [{ deliveryAttempts: [] }],
      }),
      updateMany: async () => {
        released = true;
        return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        leadAllocation: {
          updateMany: async () => {
            released = true;
            return { count: 1 };
          },
        },
        $executeRaw: async () => 1,
      });
    },
  } as unknown as PrismaClient;

  const result = await safeReleaseReservation(
    "alloc_1",
    { reasonCode: "payload_invalid", detail: "bad payload" },
    db
  );
  assert.equal(result.ok, true);
  assert.equal(released, true);
});

test("commitFulfillmentSuccess replays without changing counters when already succeeded", async () => {
  const db = {
    deliveryInstruction: {
      findUnique: async () => ({
        id: "instr_1",
        leadAllocationId: "alloc_1",
        leadAllocation: {
          id: "alloc_1",
          leadOrder: { id: "order_1" },
          deliveryInstructions: [{ id: "instr_1", isRequired: true, status: "planned" }],
        },
        deliveryAttempts: [{ id: "attempt_1", status: "succeeded" }],
      }),
    },
  } as unknown as PrismaClient;

  const result = await commitFulfillmentSuccess(
    "instr_1",
    { attemptId: "attempt_1", externalReference: "sim:1" },
    db
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.status, "already_committed");
});
