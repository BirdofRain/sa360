import assert from "node:assert/strict";
import { test } from "node:test";

import { CONSUMER_AGE_BIRTHDAY_SWEEP_JOB } from "@sa360/shared";

import { processConsumerAgeBirthdaySweepJob } from "./consumer-age-birthday-sweep.processor.js";

function jobFixture(
  data: Record<string, unknown> = { requestedBy: "schedule" as const }
) {
  return { id: "job_1", name: CONSUMER_AGE_BIRTHDAY_SWEEP_JOB, data } as never;
}

type Call = { url: string; body: Record<string, unknown> | null };

async function withAdminFetch(
  respond: (call: Call, index: number) => Response,
  run: (calls: Call[]) => Promise<void>
) {
  const prevUrl = process.env.SA360_API_INTERNAL_URL;
  const prevKey = process.env.ADMIN_API_KEY;
  const prevBatches = process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_MAX_BATCHES;
  process.env.SA360_API_INTERNAL_URL = "http://consumer-age-sweep.test";
  process.env.ADMIN_API_KEY = "worker-admin-key";

  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    };
    assert.equal(
      (init?.headers as Record<string, string>)?.["x-sa360-admin-key"],
      "worker-admin-key"
    );
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as typeof fetch;

  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.SA360_API_INTERNAL_URL;
    else process.env.SA360_API_INTERNAL_URL = prevUrl;
    if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prevKey;
    if (prevBatches === undefined) delete process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_MAX_BATCHES;
    else process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_MAX_BATCHES = prevBatches;
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("birthday sweep processor posts to the internal sweep endpoint", async () => {
  await withAdminFetch(
    () =>
      json({
        ok: true,
        enabled: true,
        outcome: "CLASSIFIED",
        coverage: "complete",
        nextCursor: null,
        rowsScanned: 12,
        candidatesWritten: 2,
      }),
    async (calls) => {
      const result = await processConsumerAgeBirthdaySweepJob(jobFixture());
      assert.equal(result.ok, true);
      assert.equal(result.batches, 1);
      assert.equal(result.candidatesWritten, 2);
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, /\/admin\/v1\/consumer-age\/internal\/birthday-sweep$/);
      assert.equal(calls[0]!.body?.cursor, null);
    }
  );
});

test("birthday sweep processor chains the returned cursor until coverage is complete", async () => {
  const pages = [
    {
      ok: true,
      enabled: true,
      outcome: "CLASSIFIED",
      coverage: "partial",
      nextCursor: { afterGeneratedAt: "2026-04-05T00:00:00.000Z", afterId: "row-04" },
      rowsScanned: 5,
      candidatesWritten: 1,
    },
    {
      ok: true,
      enabled: true,
      outcome: "CLASSIFIED",
      coverage: "partial",
      nextCursor: { afterGeneratedAt: "2026-04-10T00:00:00.000Z", afterId: "row-09" },
      rowsScanned: 5,
      candidatesWritten: 2,
    },
    {
      ok: true,
      enabled: true,
      outcome: "NOOP",
      coverage: "complete",
      nextCursor: null,
      rowsScanned: 2,
      candidatesWritten: 0,
    },
  ];

  await withAdminFetch(
    (_call, index) => json(pages[index]),
    async (calls) => {
      const result = await processConsumerAgeBirthdaySweepJob(jobFixture());
      assert.equal(calls.length, 3);
      assert.equal(calls[0]!.body?.cursor, null);
      assert.deepEqual(calls[1]!.body?.cursor, pages[0]!.nextCursor);
      assert.deepEqual(calls[2]!.body?.cursor, pages[1]!.nextCursor);
      assert.equal(result.batches, 3);
      assert.equal(result.rowsScanned, 12);
      assert.equal(result.candidatesWritten, 3);
      assert.equal(result.coverage, "complete");
      assert.equal(result.nextCursor, null);
    }
  );
});

test("birthday sweep processor stops at the continuation budget", async () => {
  await withAdminFetch(
    () =>
      json({
        ok: true,
        enabled: true,
        outcome: "CLASSIFIED",
        coverage: "partial",
        nextCursor: { afterGeneratedAt: "2026-04-05T00:00:00.000Z", afterId: "row-04" },
        rowsScanned: 5,
        candidatesWritten: 1,
      }),
    async (calls) => {
      const result = await processConsumerAgeBirthdaySweepJob(
        jobFixture({ requestedBy: "schedule", maxBatches: 3 })
      );
      // A never-ending partial window must not loop forever.
      assert.equal(calls.length, 3);
      assert.equal(result.batches, 3);
      assert.equal(result.coverage, "partial");
      assert.notEqual(result.nextCursor, null);
    }
  );
});

test("birthday sweep processor does not chain a disabled sweep", async () => {
  await withAdminFetch(
    () => json({ ok: true, enabled: false, outcome: "DISABLED", reasonCode: "sweep_disabled" }),
    async (calls) => {
      const result = await processConsumerAgeBirthdaySweepJob(jobFixture());
      assert.equal(calls.length, 1);
      assert.equal(result.enabled, false);
      assert.equal(result.outcome, "DISABLED");
    }
  );
});

test("birthday sweep processor fails when HTTP 200 body has ok:false", async () => {
  await withAdminFetch(
    () => json({ ok: false, outcome: "REFUSED", reasonCode: "db_host_mismatch" }),
    async () => {
      await assert.rejects(
        () => processConsumerAgeBirthdaySweepJob(jobFixture()),
        /consumer_age_birthday_sweep_failed:db_host_mismatch/
      );
    }
  );
});

test("birthday sweep processor fails on non-2xx HTTP", async () => {
  await withAdminFetch(
    () => json({ ok: false }, 500),
    async () => {
      await assert.rejects(
        () => processConsumerAgeBirthdaySweepJob(jobFixture()),
        /consumer_age_birthday_sweep_failed:500/
      );
    }
  );
});

test("birthday sweep processor fails on malformed JSON", async () => {
  await withAdminFetch(
    () => new Response("{not-json", { status: 200 }),
    async () => {
      await assert.rejects(
        () => processConsumerAgeBirthdaySweepJob(jobFixture()),
        /consumer_age_birthday_sweep_failed:invalid_json/
      );
    }
  );
});

test("birthday sweep processor refuses an unexpected job name", async () => {
  await assert.rejects(
    () => processConsumerAgeBirthdaySweepJob({ id: "x", name: "other", data: {} } as never),
    /unexpected_job_name:other/
  );
});

test("birthday sweep processor requires an admin key", async () => {
  const prevKey = process.env.ADMIN_API_KEY;
  delete process.env.ADMIN_API_KEY;
  try {
    await assert.rejects(
      () => processConsumerAgeBirthdaySweepJob(jobFixture()),
      /ADMIN_API_KEY missing/
    );
  } finally {
    if (prevKey !== undefined) process.env.ADMIN_API_KEY = prevKey;
  }
});
