import test from "node:test";
import assert from "node:assert/strict";
import type { LeadOrder, PrismaClient } from "@prisma/client";

import { planDeliveryInstructionsForAllocation } from "./delivery-planning.service.js";
import { createShadowLeadAllocationIdempotent } from "../../repositories/lead-allocation.repository.js";
import {
  processShadowFulfillmentOutboxItem,
  reconcileMissingFulfillmentOutbox,
} from "./shadow-processor.service.js";

test("planDeliveryInstructionsForAllocation rejects cross-tenant targets", async () => {
  const db = {
    leadAllocation: {
      findUnique: async () => ({
        id: "alloc_1",
        clientAccountId: "client_a",
      }),
    },
    deliveryTarget: {
      findMany: async () => [
        {
          id: "target_1",
          clientAccountId: "client_b",
          adapterKey: "ghl.crm.v1",
          enabled: true,
          isPrimary: true,
          isRequired: true,
          configMetadataJson: {},
        },
      ],
    },
    deliveryInstruction: {
      createMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
  } as unknown as PrismaClient;

  const result = await planDeliveryInstructionsForAllocation(
    {
      leadAllocationId: "alloc_1",
      clientAccountId: "client_a",
    },
    db
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "tenant_mismatch");
});

test("createShadowLeadAllocationIdempotent replays without incrementing proposedQuantity", async () => {
  let proposedQuantity = 0;
  const existingAllocation = {
    id: "alloc_existing",
    idempotencyKey: "allocation:shadow:evt_1:1.0.0",
    sourceLeadEventId: "evt_1",
    leadOrderId: "order_1",
    clientAccountId: "client_a",
    status: "shadow",
    allocationPolicyVersion: "1.0.0",
    decisionReasonsJson: [],
    candidateCount: 1,
    proposedAt: new Date(),
    deliveryInstructions: [],
    leadOrder: { id: "order_1", proposedQuantity: 1 } as LeadOrder,
  };

  const db = {
    leadAllocation: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        where.idempotencyKey === existingAllocation.idempotencyKey ? existingAllocation : null,
      create: async () => {
        throw new Error("should_not_create_on_replay");
      },
    },
    $transaction: async () => {
      throw new Error("should_not_transaction_on_replay");
    },
    leadOrder: {
      update: async () => {
        proposedQuantity += 1;
        return { id: "order_1", proposedQuantity };
      },
    },
  } as unknown as PrismaClient;

  const replay = await createShadowLeadAllocationIdempotent(
    {
      sourceLeadEventId: "evt_1",
      leadOrderId: "order_1",
      clientAccountId: "client_a",
      allocationPolicyVersion: "1.0.0",
      decisionReasonsJson: [],
      candidateCount: 1,
      idempotencyKey: "allocation:shadow:evt_1:1.0.0",
    },
    db
  );

  assert.equal(replay.created, false);
  assert.equal(replay.allocation.id, "alloc_existing");
  assert.equal(proposedQuantity, 0);
});

test("reconcileMissingFulfillmentOutbox does not duplicate existing outbox rows", async () => {
  const outboxRows = new Map<string, { idempotencyKey: string; sourceLeadEventId: string }>([
    ["fulfillment:shadow:evt_1", { idempotencyKey: "fulfillment:shadow:evt_1", sourceLeadEventId: "evt_1" }],
  ]);

  const db = {
    sourceLeadEvent: {
      findMany: async () => [{ id: "evt_1" }, { id: "evt_2" }],
    },
    fulfillmentOutbox: {
      upsert: async ({
        where,
        create,
      }: {
        where: { idempotencyKey: string };
        create: { idempotencyKey: string; sourceLeadEventId: string };
      }) => {
        if (outboxRows.has(where.idempotencyKey)) {
          return outboxRows.get(where.idempotencyKey);
        }
        outboxRows.set(where.idempotencyKey, create);
        return create;
      },
    },
  } as unknown as PrismaClient;

  const first = await reconcileMissingFulfillmentOutbox({ limit: 10 }, db);
  const second = await reconcileMissingFulfillmentOutbox({ limit: 10 }, db);

  assert.equal(first.reconciledCount, 2);
  assert.equal(second.reconciledCount, 2);
  assert.equal(outboxRows.size, 2);
});

test("processShadowFulfillmentOutboxItem skips completed outbox without side effects", async () => {
  let allocationCreates = 0;
  const db = {
    fulfillmentOutbox: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => ({
        id: "outbox_1",
        status: "completed",
        sourceLeadEventId: "evt_1",
      }),
    },
    leadAllocation: {
      findUnique: async () => {
        allocationCreates += 1;
        return null;
      },
      create: async () => {
        allocationCreates += 1;
        throw new Error("should_not_create");
      },
    },
  } as unknown as PrismaClient;

  const result = await processShadowFulfillmentOutboxItem("outbox_1", db);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.status, "skipped_existing");
  assert.equal(allocationCreates, 0);
});
