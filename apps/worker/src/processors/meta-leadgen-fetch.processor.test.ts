import assert from "node:assert/strict";
import { test } from "node:test";
import { UnrecoverableError } from "bullmq";
import { META_LEADGEN_FETCH_JOB } from "@sa360/shared";
import { processMetaLeadgenFetchJob } from "./meta-leadgen-fetch.processor.js";

function jobFixture(overrides: { leadgenId?: string; fixture?: boolean } = {}) {
  return {
    id: "meta-leadgen-fetch-lead_1",
    name: META_LEADGEN_FETCH_JOB,
    attemptsMade: 0,
    data: {
      leadgenId: overrides.leadgenId ?? "lead_1",
      sourceLeadEventId: "evt_1",
      fixture: overrides.fixture,
    },
  } as never;
}

async function withAdminFetch(respond: () => Response, run: () => Promise<void>) {
  const prevUrl = process.env.SA360_API_INTERNAL_URL;
  const prevKey = process.env.ADMIN_API_KEY;
  process.env.SA360_API_INTERNAL_URL = "http://meta-leadgen.test";
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

test("meta-leadgen-fetch processor posts to the API internal process-fetch route", async () => {
  const prevUrl = process.env.SA360_API_INTERNAL_URL;
  const prevKey = process.env.ADMIN_API_KEY;
  process.env.SA360_API_INTERNAL_URL = "http://meta-leadgen.test";
  process.env.ADMIN_API_KEY = "worker-admin-key";
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody: unknown = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input);
    calledBody = init?.body ? JSON.parse(String(init.body)) : null;
    assert.equal((init?.headers as Record<string, string>)?.["x-sa360-admin-key"], "worker-admin-key");
    return new Response(JSON.stringify({ ok: true, result: { skipped: "already_processed" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await processMetaLeadgenFetchJob(jobFixture());
    assert.equal(result.ok, true);
    assert.match(calledUrl, /\/admin\/v1\/meta-leadgen\/internal\/process-fetch$/);
    assert.equal((calledBody as { leadgenId: string }).leadgenId, "lead_1");
    assert.equal(calledUrl.includes("meta-dispatch"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.SA360_API_INTERNAL_URL;
    else process.env.SA360_API_INTERNAL_URL = prevUrl;
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
  }
});

test("terminal Graph failure becomes UnrecoverableError", async () => {
  await withAdminFetch(
    () =>
      new Response(JSON.stringify({ ok: false, retryable: false, error: "graph_auth_failure" }), {
        status: 422,
      }),
    async () => {
      await assert.rejects(
        () => processMetaLeadgenFetchJob(jobFixture()),
        (err: unknown) => err instanceof UnrecoverableError
      );
    }
  );
});

test("retryable Graph failure throws a plain Error", async () => {
  await withAdminFetch(
    () =>
      new Response(JSON.stringify({ ok: false, retryable: true, error: "graph_retryable_failure" }), {
        status: 500,
      }),
    async () => {
      await assert.rejects(
        () => processMetaLeadgenFetchJob(jobFixture()),
        (err: unknown) => err instanceof Error && !(err instanceof UnrecoverableError)
      );
    }
  );
});
