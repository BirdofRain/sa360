import test from "node:test";
import assert from "node:assert/strict";

import { attachCommittedAllocationCounts } from "./lead-order.service.js";

test("mock list/find path uses row counts and does not query allocations", async () => {
  const hydrated = await attachCommittedAllocationCounts(
    [
      { id: "ord_a", committedAllocationCount: 5 },
      { id: "ord_b" },
    ],
    {
      listLeadOrdersImpl: async () => ({ items: [], nextCursor: null }),
    }
  );

  assert.deepEqual(hydrated, [
    { id: "ord_a", committedAllocationCount: 5 },
    { id: "ord_b", committedAllocationCount: 0 },
  ]);
});

test("production path overlays committed allocation counts", async () => {
  const hydrated = await attachCommittedAllocationCounts(
    [
      { id: "ord_a", committedAllocationCount: 0 },
      { id: "ord_b", committedAllocationCount: 0 },
    ],
    {
      countCommittedAllocationsByOrderIdsImpl: async () =>
        new Map([
          ["ord_a", 2],
          ["ord_b", 0],
        ]),
    }
  );

  assert.deepEqual(hydrated, [
    { id: "ord_a", committedAllocationCount: 2 },
    { id: "ord_b", committedAllocationCount: 0 },
  ]);
});
