import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

test("loadLeadInventoryPageData returns empty state when admin API unconfigured", async () => {
  const prevUrl = process.env.ADMIN_API_BASE_URL;
  const prevKey = process.env.ADMIN_API_KEY;
  delete process.env.ADMIN_API_BASE_URL;
  delete process.env.ADMIN_API_KEY;
  try {
    const { loadLeadInventoryPageData } = await import("./lead-inventory-api.ts");
    const result = await loadLeadInventoryPageData();
    assert.equal(result.dataSource, "empty");
    assert.equal(result.facets.length, 0);
    assert.equal(result.facetsDegraded, false);
    assert.ok(result.loadError);
  } finally {
    if (prevUrl !== undefined) process.env.ADMIN_API_BASE_URL = prevUrl;
    if (prevKey !== undefined) process.env.ADMIN_API_KEY = prevKey;
  }
});

test("loadLeadInventoryPageData keeps summary/lots when facets degrade", async () => {
  const prevUrl = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  const prevKey = process.env.SA360_ADMIN_API_KEY;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://facets-test.local";
  process.env.SA360_ADMIN_API_KEY = "test-admin-key";

  const originalFetch = globalThis.fetch;
  let facetsCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/lead-inventory/summary")) {
      return new Response(
        JSON.stringify({
          ok: true,
          summary: {
            totalItems: 10,
            available: 4,
            reserved: 2,
            committed: 1,
            fulfilled: 0,
            quarantined: 0,
            expired: 0,
            lotsActive: 1,
            lotsPaused: 0,
            proofReady: 0,
            verificationReady: 0,
            evaluatedAt: "2026-08-04T00:00:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/lead-inventory/lots")) {
      return new Response(
        JSON.stringify({
          ok: true,
          lots: [
            {
              id: "lot_1",
              displayName: "Lot",
              status: "active",
              total: 10,
              available: 4,
              reserved: 2,
              blocked: 4,
            },
          ],
          evaluatedAt: "2026-08-04T00:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/lead-inventory/facets")) {
      facetsCalls += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          partial: true,
          degraded: true,
          unavailableSections: ["matrix"],
          warnings: [
            {
              code: "facets_time_budget_exceeded",
              message: "Some inventory facets are temporarily unavailable.",
            },
          ],
          facets: {
            rows: [],
            evaluatedAt: "2026-08-04T00:00:00.000Z",
            flexibleDemandTotal: 0,
            flexibleDemandLineCount: 0,
            degraded: true,
            partial: true,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const { loadLeadInventoryPageData } = await import(`./lead-inventory-api.ts?degraded=${Date.now()}`);
    const result = await loadLeadInventoryPageData();
    assert.equal(result.summary?.totalItems, 10);
    assert.equal(result.lots.length, 1);
    assert.equal(result.facets.length, 0);
    assert.equal(result.facetsDegraded, true);
    assert.ok(result.facetsWarning);
    assert.equal(result.dataSource, "partial");
    assert.equal(facetsCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevUrl;
    else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
    if (prevKey !== undefined) process.env.SA360_ADMIN_API_KEY = prevKey;
    else delete process.env.SA360_ADMIN_API_KEY;
  }
});
