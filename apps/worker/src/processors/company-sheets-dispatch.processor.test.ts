import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { COMPANY_SHEETS_DISPATCH_JOB } from "@sa360/shared";

import { processCompanySheetsDispatchJob } from "./company-sheets-dispatch.processor.js";

function jobFixture() {
  return { id: "sheets_dispatch_1", name: COMPANY_SHEETS_DISPATCH_JOB, data: {} } as never;
}

test("company sheets dispatch processor does not read shared-drive settings or call Google", () => {
  const source = readFileSync(new URL("./company-sheets-dispatch.processor.ts", import.meta.url), "utf8");
  assert.equal(source.includes("COMPANY_GOOGLE_APPROVED"), false);
  assert.equal(source.includes("googleapis.com"), false);
  assert.match(source, /\/admin\/v1\/company-sheets\/internal\/process-dispatch/);
});

test("company sheets dispatch processor does not call the API while the flag is off", async () => {
  const prev = process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;
  delete process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const result = await processCompanySheetsDispatchJob(jobFixture());
    assert.equal(result.skipped, "dispatch_disabled");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    if (prev === undefined) delete process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;
    else process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED = prev;
  }
});

test("company sheets dispatch processor skips a missing admin key without throwing", async () => {
  const prevFlag = process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;
  const prevKey = process.env.ADMIN_API_KEY;
  process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED = "true";
  delete process.env.ADMIN_API_KEY;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const result = await processCompanySheetsDispatchJob(jobFixture());
    assert.equal(result.skipped, "admin_key_missing");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    if (prevFlag === undefined) delete process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;
    else process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED = prevFlag;
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
  }
});

test("company sheets dispatch processor posts to the internal drain", async () => {
  const prevFlag = process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;
  const prevKey = process.env.ADMIN_API_KEY;
  const prevUrl = process.env.SA360_API_INTERNAL_URL;
  process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED = "true";
  process.env.ADMIN_API_KEY = "worker-admin-key";
  process.env.SA360_API_INTERNAL_URL = "http://sheets-dispatch.test";
  const original = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input);
    assert.equal((init?.headers as Record<string, string>)["x-sa360-admin-key"], "worker-admin-key");
    return new Response(JSON.stringify({ ok: true, processed: 0, executed: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await processCompanySheetsDispatchJob(jobFixture());
    assert.equal(result.ok, true);
    assert.match(calledUrl, /\/admin\/v1\/company-sheets\/internal\/process-dispatch$/);
  } finally {
    globalThis.fetch = original;
    if (prevFlag === undefined) delete process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;
    else process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED = prevFlag;
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.SA360_API_INTERNAL_URL;
    else process.env.SA360_API_INTERNAL_URL = prevUrl;
  }
});
