import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ONGOING_GHL_DISPATCH_JOB } from "@sa360/shared";

import { CompanySheetsDrainTimeoutError } from "../lib/company-sheets-drain-http.js";
import { processOngoingGhlDispatchJob } from "./ongoing-ghl-dispatch.processor.js";

function jobFixture() {
  return { id: "ongoing_ghl_1", name: ONGOING_GHL_DISPATCH_JOB, data: {} } as never;
}

async function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) previous.set(key, process.env[key]);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("ongoing GHL dispatch posts once and a timeout does not post again", async () => {
  const source = readFileSync(new URL("./ongoing-ghl-dispatch.processor.ts", import.meta.url), "utf8");
  const schedule = readFileSync(new URL("../lib/ongoing-ghl-dispatch-schedule.ts", import.meta.url), "utf8");
  assert.match(source, /\/admin\/v1\/ghl-ongoing-delivery\/internal\/process-dispatch/);
  assert.match(schedule, /attempts:\s*1/);
  assert.equal(source.includes("googleapis.com"), false);

  let calls = 0;
  await withEnv({ ADMIN_API_KEY: "test-admin" }, async () => {
    const ok = await processOngoingGhlDispatchJob(jobFixture(), {
      postImpl: async () => {
        calls += 1;
        return { status: 200, body: "{}" };
      },
    });
    assert.equal(ok.ok, true);
    assert.equal(calls, 1);
    await assert.rejects(
      () =>
        processOngoingGhlDispatchJob(jobFixture(), {
          postImpl: async () => {
            calls += 1;
            throw new CompanySheetsDrainTimeoutError();
          },
        }),
      (err: unknown) => err instanceof CompanySheetsDrainTimeoutError
    );
    assert.equal(calls, 2);
  });
});

test("ongoing GHL dispatch skips a missing admin key without throwing", async () => {
  let calls = 0;
  await withEnv({ ADMIN_API_KEY: undefined }, async () => {
    const result = await processOngoingGhlDispatchJob(jobFixture(), {
      postImpl: async () => {
        calls += 1;
        return { status: 200, body: "{}" };
      },
    });
    assert.equal(result.skipped, "admin_key_missing");
    assert.equal(calls, 0);
  });
});
