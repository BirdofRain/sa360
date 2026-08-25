import assert from "node:assert/strict";
import { test } from "node:test";

import { FACETS_SUPPLY_REBUILD_JOB } from "@sa360/shared";

import { processFacetsSupplyRebuildJob } from "./facets-supply-rebuild.processor.js";

function jobFixture() {
  return {
    id: "job_1",
    name: FACETS_SUPPLY_REBUILD_JOB,
    data: { ageBandVersion: "v1", requestedBy: "schedule" as const },
  } as never;
}

async function withAdminFetch(respond: () => Response, run: () => Promise<void>) {
  const prevUrl = process.env.SA360_API_INTERNAL_URL;
  const prevKey = process.env.ADMIN_API_KEY;
  process.env.SA360_API_INTERNAL_URL = "http://facets-rebuild.test";
  process.env.ADMIN_API_KEY = "worker-admin-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => respond()) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.SA360_API_INTERNAL_URL;
    else process.env.SA360_API_INTERNAL_URL = prevUrl;
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
  }
}

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
    const result = await processFacetsSupplyRebuildJob(jobFixture());
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

test("facets supply rebuild processor fails when HTTP 200 body has ok:false", async () => {
  await withAdminFetch(
    () =>
      new Response(
        JSON.stringify({
          ok: false,
          buildId: "build_failed",
          status: "failed",
          failureCode: "validation_failed",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    async () => {
      await assert.rejects(
        () => processFacetsSupplyRebuildJob(jobFixture()),
        /facets_supply_rebuild_failed:validation_failed/
      );
    }
  );
});

test("facets supply rebuild processor fails when HTTP 200 body omits ok", async () => {
  await withAdminFetch(
    () =>
      new Response(JSON.stringify({ buildId: "build_partial", status: "failed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    async () => {
      await assert.rejects(
        () => processFacetsSupplyRebuildJob(jobFixture()),
        /facets_supply_rebuild_failed:rebuild_not_ok/
      );
    }
  );
});

test("facets supply rebuild processor still fails on non-2xx HTTP", async () => {
  await withAdminFetch(
    () =>
      new Response(JSON.stringify({ ok: false, error: "rebuild_exception" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    async () => {
      await assert.rejects(
        () => processFacetsSupplyRebuildJob(jobFixture()),
        /facets_supply_rebuild_failed:500/
      );
    }
  );
});

test("facets supply rebuild processor fails on HTTP 200 with malformed JSON", async () => {
  await withAdminFetch(
    () => new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } }),
    async () => {
      await assert.rejects(
        () => processFacetsSupplyRebuildJob(jobFixture()),
        /facets_supply_rebuild_failed:invalid_json/
      );
    }
  );
});
