import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

import { reconcileLeadOrderCounters } from "./counter-reconciliation.service.js";

test("counter reconciliation reports drift without repairing", async () => {
  const db = {
    leadOrder: {
      findUnique: async () => ({
        id: "order_1",
        reservedQuantity: 2,
        fulfilledQuantity: 1,
      }),
    },
    leadAllocation: {
      groupBy: async () => [
        { status: "reserved", _count: { _all: 1 } },
        { status: "committed", _count: { _all: 1 } },
      ],
    },
  } as unknown as PrismaClient;

  const report = await reconcileLeadOrderCounters("order_1", db);
  assert.ok(report);
  assert.equal(report!.expectedReservedCount, 1);
  assert.equal(report!.expectedFulfilledCount, 1);
  assert.equal(report!.reservedDrift, 1);
  assert.equal(report!.fulfilledDrift, 0);
  assert.equal(report!.inSync, false);
});
