import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  buildLeadInventoryFacets,
  LEAD_INVENTORY_FACETS_MAX_PRISMA_OPS,
  LEAD_INVENTORY_FACETS_TIMEOUT_MS,
  LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY,
} from "./lead-inventory-facets.service.js";
import { buildLeadInventoryDemandOverlay } from "./lead-inventory-demand.service.js";
import {
  facetsSingleFlightSizeForTests,
  resetFacetsSingleFlightForTests,
} from "./lead-inventory-facets-single-flight.js";

const AGE_BANDS = [
  {
    key: "FRESH_0_7",
    label: "0–7 days",
    minDaysInclusive: 0,
    maxDaysExclusive: 8,
    sortOrder: 10,
  },
  {
    key: "RECENT_8_30",
    label: "8–30 days",
    minDaysInclusive: 8,
    maxDaysExclusive: 31,
    sortOrder: 20,
  },
];

function createFacetsDbMock(opts?: {
  aggregateDelayMs?: number;
  aggregateRows?: Array<{
    state: string;
    age_band_key: string;
    total: number;
    available: number;
    reserved: number;
    blocked: number;
  }>;
  onInventoryFindMany?: () => void;
  onProofFindUnique?: () => void;
  onVerificationFindUnique?: () => void;
  queryRawImpl?: (sql: unknown) => Promise<unknown>;
}) {
  let inventoryFindMany = 0;
  let proofFindUnique = 0;
  let verificationFindUnique = 0;
  let queryRawCalls = 0;
  let orderLineFindMany = 0;
  let ageBandFindMany = 0;

  const aggregateRows = opts?.aggregateRows ?? [
    {
      state: "NC",
      age_band_key: "FRESH_0_7",
      total: 3,
      available: 1,
      reserved: 1,
      blocked: 1,
    },
    {
      state: "SC",
      age_band_key: "RECENT_8_30",
      total: 2,
      available: 2,
      reserved: 0,
      blocked: 0,
    },
  ];

  const db = {
    leadAgeBandDefinition: {
      findMany: async () => {
        ageBandFindMany += 1;
        return AGE_BANDS;
      },
    },
    leadOrderLine: {
      findMany: async () => {
        orderLineFindMany += 1;
        return [];
      },
    },
    leadInventoryItem: {
      findMany: async () => {
        inventoryFindMany += 1;
        opts?.onInventoryFindMany?.();
        throw new Error("unbounded_inventory_findMany_forbidden");
      },
    },
    leadProof: {
      findUnique: async () => {
        proofFindUnique += 1;
        opts?.onProofFindUnique?.();
        throw new Error("per_item_proof_query_forbidden");
      },
    },
    leadVerificationResult: {
      findUnique: async () => {
        verificationFindUnique += 1;
        opts?.onVerificationFindUnique?.();
        throw new Error("per_item_verification_query_forbidden");
      },
    },
    $queryRaw: async (sql: unknown) => {
      queryRawCalls += 1;
      if (opts?.queryRawImpl) return opts.queryRawImpl(sql);
      if (opts?.aggregateDelayMs) await sleep(opts.aggregateDelayMs);
      return aggregateRows;
    },
  };

  return {
    db,
    counts: () => ({
      inventoryFindMany,
      proofFindUnique,
      verificationFindUnique,
      queryRawCalls,
      orderLineFindMany,
      ageBandFindMany,
    }),
  };
}

test("legacy unbounded facets patterns are documented for regression", () => {
  assert.equal(LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY.fullInventoryFindMany, true);
  assert.equal(LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY.jsonPayloadSelected, true);
  assert.equal(LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY.perItemProofQueries, true);
  assert.equal(LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY.perItemVerificationQueries, true);
  assert.equal(LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY.demandSupplyFullScan, true);
  assert.equal(LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY.timeoutMs, null);
  assert.equal(LEAD_INVENTORY_FACETS_UNBOUNDED_LEGACY.abortSupport, false);
  assert.ok(LEAD_INVENTORY_FACETS_TIMEOUT_MS >= 5_000);
  assert.ok(LEAD_INVENTORY_FACETS_TIMEOUT_MS <= 8_000);
  assert.ok(LEAD_INVENTORY_FACETS_MAX_PRISMA_OPS <= 50);
});

test("facets contract: matrix cells, totals, demand fields, sorting", async () => {
  resetFacetsSingleFlightForTests();
  const mock = createFacetsDbMock();
  const result = await buildLeadInventoryFacets({}, mock.db as never, {
    singleFlight: false,
    timeoutMs: 2_000,
  });

  assert.equal(result.degraded, false);
  assert.equal(result.partial, false);
  assert.equal(result.rowsMaterialized, 0);
  assert.ok(result.queryCount <= LEAD_INVENTORY_FACETS_MAX_PRISMA_OPS);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]?.state, "NC");
  assert.equal(result.rows[1]?.state, "SC");
  assert.equal(result.rows[0]?.total, 3);
  assert.equal(result.rows[0]?.available, 1);
  assert.equal(result.rows[0]?.reserved, 1);
  assert.equal(result.rows[0]?.blocked, 1);
  assert.equal(result.rows[0]?.supply, 2);
  assert.equal(result.totals.overall, 5);
  assert.equal(result.totals.byState.NC, 3);
  assert.equal(result.ageBands.length, 2);
  assert.equal(typeof result.evaluatedAt, "string");
  assert.equal(result.flexibleDemandTotal, 0);
  assert.deepEqual(result.unavailableSections, []);
  assert.equal(mock.counts().inventoryFindMany, 0);
  assert.equal(mock.counts().proofFindUnique, 0);
  assert.equal(mock.counts().verificationFindUnique, 0);
});

test("facets never issues unbounded inventory findMany or per-item proof loops", async () => {
  resetFacetsSingleFlightForTests();
  const mock = createFacetsDbMock();
  await buildLeadInventoryFacets({ nicheKey: "vet" }, mock.db as never, {
    singleFlight: false,
  });
  const c = mock.counts();
  assert.equal(c.inventoryFindMany, 0);
  assert.equal(c.proofFindUnique, 0);
  assert.equal(c.verificationFindUnique, 0);
  assert.ok(c.queryRawCalls >= 1);
  assert.ok(c.orderLineFindMany >= 1);
});

test("demand overlay does not scan inventory supply rows", async () => {
  const mock = createFacetsDbMock();
  const overlay = await buildLeadInventoryDemandOverlay({}, mock.db as never);
  assert.equal(mock.counts().inventoryFindMany, 0);
  assert.ok(Array.isArray(overlay.cells));
  assert.equal(overlay.queryCount, 2);
});

test("facets timeout returns structured degraded JSON without throwing", async () => {
  resetFacetsSingleFlightForTests();
  const mock = createFacetsDbMock({ aggregateDelayMs: 80 });
  const result = await buildLeadInventoryFacets({}, mock.db as never, {
    singleFlight: false,
    timeoutMs: 15,
  });
  assert.equal(result.degraded, true);
  assert.equal(result.partial, true);
  assert.ok(result.unavailableSections.includes("matrix"));
  assert.ok(result.warnings.some((w) => w.code === "facets_time_budget_exceeded"));
  assert.deepEqual(result.rows, []);
});

test("client abort returns degraded facets and does not throw", async () => {
  resetFacetsSingleFlightForTests();
  const mock = createFacetsDbMock({ aggregateDelayMs: 100 });
  const controller = new AbortController();
  const pending = buildLeadInventoryFacets({}, mock.db as never, {
    singleFlight: false,
    timeoutMs: 2_000,
    signal: controller.signal,
  });
  controller.abort();
  const result = await pending;
  assert.equal(result.degraded, true);
  assert.ok(result.warnings.some((w) => w.code === "facets_aborted"));
});

test("identical concurrent facets calls share single-flight work", async () => {
  resetFacetsSingleFlightForTests();
  let queryRawCalls = 0;
  const mock = createFacetsDbMock({
    aggregateDelayMs: 40,
    queryRawImpl: async () => {
      queryRawCalls += 1;
      await sleep(40);
      return [
        {
          state: "TX",
          age_band_key: "FRESH_0_7",
          total: 1,
          available: 1,
          reserved: 0,
          blocked: 0,
        },
      ];
    },
  });

  const [a, b] = await Promise.all([
    buildLeadInventoryFacets({}, mock.db as never, { timeoutMs: 2_000 }),
    buildLeadInventoryFacets({}, mock.db as never, { timeoutMs: 2_000 }),
  ]);

  assert.equal(a.rows[0]?.state, "TX");
  assert.equal(b.rows[0]?.state, "TX");
  assert.equal(queryRawCalls, 1);
  assert.equal(facetsSingleFlightSizeForTests(), 0);
});

test("failed single-flight clears so later requests recover", async () => {
  resetFacetsSingleFlightForTests();
  let calls = 0;
  const failing = createFacetsDbMock({
    queryRawImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient_aggregate_failure");
      return [
        {
          state: "GA",
          age_band_key: "FRESH_0_7",
          total: 4,
          available: 2,
          reserved: 1,
          blocked: 1,
        },
      ];
    },
  });

  const first = await buildLeadInventoryFacets({}, failing.db as never, {
    singleFlight: true,
    timeoutMs: 2_000,
  });
  assert.equal(first.degraded, true);
  assert.ok(first.unavailableSections.includes("matrix"));
  assert.equal(facetsSingleFlightSizeForTests(), 0);

  const second = await buildLeadInventoryFacets({}, failing.db as never, {
    singleFlight: true,
    timeoutMs: 2_000,
  });
  assert.equal(second.degraded, false);
  assert.equal(second.rows[0]?.state, "GA");
  assert.equal(second.rows[0]?.total, 4);
});

test("health probe stays responsive while facets await deferred aggregate", async () => {
  resetFacetsSingleFlightForTests();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const mock = createFacetsDbMock({
    queryRawImpl: async () => {
      await gate;
      return [
        {
          state: "FL",
          age_band_key: "FRESH_0_7",
          total: 1,
          available: 1,
          reserved: 0,
          blocked: 0,
        },
      ];
    },
  });

  const facetsPromise = buildLeadInventoryFacets({}, mock.db as never, {
    singleFlight: false,
    timeoutMs: 2_000,
  });

  // Controlled deferred workload — not wall-clock fragile.
  let healthHits = 0;
  const healthLoop = (async () => {
    for (let i = 0; i < 5; i++) {
      healthHits += 1;
      await sleep(5);
    }
  })();

  await healthLoop;
  assert.equal(healthHits, 5);
  release();
  const facets = await facetsPromise;
  assert.equal(facets.rows[0]?.state, "FL");
});

test("availableOnly filters rows but keeps total inventory in totals", async () => {
  resetFacetsSingleFlightForTests();
  const mock = createFacetsDbMock({
    aggregateRows: [
      {
        state: "NC",
        age_band_key: "FRESH_0_7",
        total: 5,
        available: 0,
        reserved: 2,
        blocked: 3,
      },
      {
        state: "VA",
        age_band_key: "FRESH_0_7",
        total: 2,
        available: 2,
        reserved: 0,
        blocked: 0,
      },
    ],
  });
  const result = await buildLeadInventoryFacets({ availableOnly: true }, mock.db as never, {
    singleFlight: false,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.state, "VA");
  assert.equal(result.totals.overall, 7);
});
