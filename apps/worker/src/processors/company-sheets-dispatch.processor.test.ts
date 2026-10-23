import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS, COMPANY_SHEETS_DISPATCH_JOB } from "@sa360/shared";

import { CompanySheetsDrainTimeoutError } from "../lib/company-sheets-drain-http.js";
import { processCompanySheetsDispatchJob } from "./company-sheets-dispatch.processor.js";

function jobFixture() {
  return { id: "sheets_dispatch_1", name: COMPANY_SHEETS_DISPATCH_JOB, data: {} } as never;
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

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

test("company sheets dispatch processor does not read shared-drive settings or call Google", () => {
  const source = readFileSync(new URL("./company-sheets-dispatch.processor.ts", import.meta.url), "utf8");
  const httpSource = readFileSync(new URL("../lib/company-sheets-drain-http.ts", import.meta.url), "utf8");
  const schedule = readFileSync(new URL("../lib/company-sheets-dispatch-schedule.ts", import.meta.url), "utf8");
  assert.equal(source.includes("COMPANY_GOOGLE_APPROVED"), false);
  assert.equal(source.includes("googleapis.com"), false);
  assert.equal(httpSource.includes("googleapis.com"), false);
  assert.match(source, /\/admin\/v1\/company-sheets\/internal\/process-dispatch/);
  assert.match(source, /COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS/);
  assert.match(schedule, /attempts:\s*1/);
});

test("company sheets dispatch processor does not call the API while the flag is off", async () => {
  let calls = 0;
  await withEnv({ SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: undefined }, async () => {
    const result = await processCompanySheetsDispatchJob(jobFixture(), {
      postImpl: async () => {
        calls += 1;
        return { status: 200, body: "{}" };
      },
    });
    assert.equal(result.skipped, "dispatch_disabled");
    assert.equal(calls, 0);
  });
});

test("company sheets dispatch processor skips a missing admin key without throwing", async () => {
  let calls = 0;
  await withEnv(
    { SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true", ADMIN_API_KEY: undefined },
    async () => {
      const result = await processCompanySheetsDispatchJob(jobFixture(), {
        postImpl: async () => {
          calls += 1;
          return { status: 200, body: "{}" };
        },
      });
      assert.equal(result.skipped, "admin_key_missing");
      assert.equal(calls, 0);
    }
  );
});

test("company sheets dispatch processor posts once with the execution budget", async () => {
  let calls = 0;
  let timeoutMs = 0;
  await withEnv(
    {
      SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
      ADMIN_API_KEY: "worker-admin-key",
      SA360_API_INTERNAL_URL: "http://sheets-dispatch.test",
    },
    async () => {
      const result = await processCompanySheetsDispatchJob(jobFixture(), {
        postImpl: async (input) => {
          calls += 1;
          timeoutMs = input.timeoutMs;
          assert.equal(input.headers["x-sa360-admin-key"], "worker-admin-key");
          assert.match(input.url, /\/admin\/v1\/company-sheets\/internal\/process-dispatch$/);
          return { status: 200, body: JSON.stringify({ ok: true, processed: 0, executed: 0 }) };
        },
      });
      assert.equal(result.ok, true);
      assert.equal(calls, 1);
      assert.equal(timeoutMs, COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS);
    }
  );
});

test("a hung drain response times out without a second POST", { timeout: 5_000 }, async () => {
  let requests = 0;
  const server = http.createServer((_req, _res) => {
    requests += 1;
  });
  const port = await listen(server);
  try {
    await withEnv(
      {
        SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
        ADMIN_API_KEY: "worker-admin-key",
        SA360_API_INTERNAL_URL: `http://127.0.0.1:${port}`,
      },
      async () => {
        await assert.rejects(
          () => processCompanySheetsDispatchJob(jobFixture(), { timeoutMs: 80 }),
          (err: unknown) => err instanceof CompanySheetsDrainTimeoutError
        );
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(requests, 1);
  } finally {
    await close(server);
  }
});

test("a delayed successful drain response is accepted once", { timeout: 5_000 }, async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests += 1;
    setTimeout(() => {
      const body = JSON.stringify({ ok: true, processed: 1, executed: 1 });
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
    }, 40);
  });
  const port = await listen(server);
  try {
    await withEnv(
      {
        SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
        ADMIN_API_KEY: "worker-admin-key",
        SA360_API_INTERNAL_URL: `http://127.0.0.1:${port}`,
      },
      async () => {
        const result = await processCompanySheetsDispatchJob(jobFixture(), { timeoutMs: 500 });
        assert.equal(result.ok, true);
        assert.equal(requests, 1);
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(requests, 1);
  } finally {
    await close(server);
  }
});

test("a disconnect during the drain response is one POST and is not retried", { timeout: 5_000 }, async () => {
  let requests = 0;
  const server = http.createServer((req, _res) => {
    requests += 1;
    req.socket.destroy();
  });
  const port = await listen(server);
  try {
    await withEnv(
      {
        SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
        ADMIN_API_KEY: "worker-admin-key",
        SA360_API_INTERNAL_URL: `http://127.0.0.1:${port}`,
      },
      async () => {
        await assert.rejects(
          () => processCompanySheetsDispatchJob(jobFixture(), { timeoutMs: 500 }),
          (err: unknown) => {
            assert.equal(err instanceof CompanySheetsDrainTimeoutError, false);
            assert.equal(String(err instanceof Error ? err.message : err).includes("worker-admin-key"), false);
            return true;
          }
        );
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(requests, 1);
  } finally {
    await close(server);
  }
});

async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const write = (args: unknown[]) => {
    lines.push(args.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" "));
  };
  const original = {
    error: console.error,
    log: console.log,
    info: console.info,
    warn: console.warn,
  };
  console.error = (...args: unknown[]) => write(args);
  console.log = (...args: unknown[]) => write(args);
  console.info = (...args: unknown[]) => write(args);
  console.warn = (...args: unknown[]) => write(args);
  try {
    await fn();
  } finally {
    console.error = original.error;
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
  }
  return lines.join("\n");
}

test("a malformed 200 body is not logged as success and is not retried", { timeout: 5_000 }, async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{ secret-body-excerpt");
  });
  const port = await listen(server);
  try {
    const logged = await captureConsole(() =>
      withEnv(
        {
          SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
          ADMIN_API_KEY: "worker-admin-key",
          SA360_API_INTERNAL_URL: `http://127.0.0.1:${port}`,
        },
        async () => {
          await assert.rejects(
            () => processCompanySheetsDispatchJob(jobFixture(), { timeoutMs: 500 }),
            (err: unknown) => {
              assert.ok(err instanceof Error);
              assert.equal(err.message, "company_sheets_dispatch_malformed_response");
              return true;
            }
          );
        }
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(requests, 1);
    assert.match(logged, /malformed_response/);
    assert.equal(logged.includes('"outcome":"ok"'), false);
    assert.equal(logged.includes("secret-body-excerpt"), false);
  } finally {
    await close(server);
  }
});

test("a non-2xx drain response fails after one POST and logs only the status code", { timeout: 5_000 }, async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests += 1;
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("drain_unavailable secret-body-excerpt");
  });
  const port = await listen(server);
  try {
    const logged = await captureConsole(() =>
      withEnv(
        {
          SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: "true",
          ADMIN_API_KEY: "worker-admin-key",
          SA360_API_INTERNAL_URL: `http://127.0.0.1:${port}`,
        },
        async () => {
          await assert.rejects(
            () => processCompanySheetsDispatchJob(jobFixture(), { timeoutMs: 500 }),
            (err: unknown) => {
              assert.ok(err instanceof Error);
              assert.equal(err.message, "company_sheets_dispatch_http_error");
              assert.equal(err.message.includes("worker-admin-key"), false);
              assert.equal(err.message.includes("secret-body-excerpt"), false);
              return true;
            }
          );
        }
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(requests, 1);
    assert.match(logged, /http_error/);
    assert.match(logged, /"statusCode":503/);
    assert.equal(logged.includes("secret-body-excerpt"), false);
    assert.equal(logged.includes("worker-admin-key"), false);
  } finally {
    await close(server);
  }
});
