import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

import {
  countCommittedAllocationsByOrderIds,
  listCommittedAllocationsForOrder,
} from "./lead-order.repository.js";

test("countCommittedAllocationsByOrderIds only groups committed allocations", async () => {
  let captured: unknown;
  const db = {
    leadAllocation: {
      groupBy: async (args: unknown) => {
        captured = args;
        return [{ leadOrderId: "ord_a", _count: { _all: 3 } }];
      },
    },
  } as unknown as PrismaClient;

  const counts = await countCommittedAllocationsByOrderIds(["ord_a", "ord_a"], db);
  assert.deepEqual(counts, new Map([["ord_a", 3]]));
  assert.deepEqual(captured, {
    by: ["leadOrderId"],
    where: { leadOrderId: { in: ["ord_a"] }, status: "committed" },
    _count: { _all: true },
  });
});

test("listCommittedAllocationsForOrder is tenant and committed scoped", async () => {
  let captured: unknown;
  const db = {
    leadAllocation: {
      findMany: async (args: unknown) => {
        captured = args;
        return [{ id: "alloc_1", sourceLeadEventId: "evt_1", committedAt: new Date("2026-07-01T00:00:00.000Z") }];
      },
    },
  } as unknown as PrismaClient;

  const result = await listCommittedAllocationsForOrder(
    { leadOrderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    db
  );
  assert.equal(result.items.length, 1);
  assert.deepEqual(captured, {
    where: {
      leadOrderId: "ord_a",
      clientAccountId: "acct_a",
      status: "committed",
    },
    orderBy: [{ committedAt: "desc" }, { id: "desc" }],
    take: 51,
    select: { id: true, sourceLeadEventId: true, committedAt: true },
  });
});
