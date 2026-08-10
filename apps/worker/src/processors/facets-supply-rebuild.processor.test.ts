import assert from "node:assert/strict";
import { test } from "node:test";

import { FACETS_SUPPLY_REBUILD_JOB } from "@sa360/shared";

import { processFacetsSupplyRebuildJob } from "./facets-supply-rebuild.processor.js";

test("facets supply rebuild processor posts to internal rebuild endpoint", async () => {
  const prevUrl = process.env.SA360_API_INTERNAL_URL;
  const prevKey = process.env.ADMIN_API_KEY;
  process.env.SA360_API_INTERNAL_URL = "http://facets-rebuild.test";
  process.env.ADMIN_API_KEY = "worker-admin-key";

  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody: unknown = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input);
    calledBody = init?.body ? JSON.parse(String(init.body)) : null;
    assert.equal((init?.headers as Record<string, string>)?.["x-sa360-admin-key"], "worker-admin-key");
    return new Response(
      JSON.stringify({
        ok: true,
        buildId: "build_x",
        status: "active",
        inventoryCount: 10,
        aggregateRowCount: 3,
        buildDurationMs: 12,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await processFacetsSupplyRebuildJob({
      id: "job_1",
      name: FACETS_SUPPLY_REBUILD_JOB,
      data: { ageBandVersion: "v1", requestedBy: "schedule" },
    } as never);
    assert.equal(result.ok, true);
    assert.match(calledUrl, /\/admin\/v1\/lead-inventory\/facets\/snapshot\/internal\/rebuild$/);
    assert.equal((calledBody as { ageBandVersion: string }).ageBandVersion, "v1");
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.SA360_API_INTERNAL_URL;
    else process.env.SA360_API_INTERNAL_URL = prevUrl;
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
  }
});
