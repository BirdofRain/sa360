import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyInstance } from "fastify";

import { ADMIN_KEY_HEADER } from "../lib/admin-auth.js";
import {
  createConcurrencyGate,
  createFixedWindowRateLimiter,
} from "../services/delivery-diagnostics/limits.js";
import { adminDeliveryDiagnosticsRoutes, type AdminDeliveryDiagnosticsRouteOptions } from "./admin-delivery-diagnostics.js";

const KEY = "delivery-diagnostics-route-test";
const PATHS = [
  "/delivery-diagnostics/summary",
  "/delivery-diagnostics/ghl-runs?status=failed",
  "/delivery-diagnostics/ghl-runs/run_1",
];

let previousKey: string | undefined;
let previousAlias: string | undefined;

before(() => {
  previousKey = process.env.ADMIN_API_KEY;
  previousAlias = process.env.SA360_ADMIN_KEY;
  process.env.ADMIN_API_KEY = KEY;
  delete process.env.SA360_ADMIN_KEY;
});

after(() => {
  if (previousKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = previousKey;
  if (previousAlias !== undefined) process.env.SA360_ADMIN_KEY = previousAlias;
});

const dbThatMustNotBeUsed = new Proxy(
  {},
  {
    get() {
      throw new Error("db must not be touched");
    },
  }
) as unknown as PrismaClient;

async function build(opts: AdminDeliveryDiagnosticsRouteOptions = {}): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(adminDeliveryDiagnosticsRoutes, {
    db: dbThatMustNotBeUsed,
    redis: { ping: async () => "PONG" },
    readQueue: async () => {
      throw new Error("queue must not be read");
    },
    env: {},
    ...opts,
  });
  return app;
}

test("every route rejects a missing or wrong admin key before any read", async () => {
  const app = await build();
  for (const url of PATHS) {
    const missing = await app.inject({ method: "GET", url });
    assert.equal(missing.statusCode, 401, url);
    const wrong = await app.inject({ method: "GET", url, headers: { [ADMIN_KEY_HEADER]: "nope" } });
    assert.equal(wrong.statusCode, 401, url);
    for (const header of ["x-sa360-client-key", "x-sa360-workspace-key", "authorization", "cookie"]) {
      const other = await app.inject({ method: "GET", url, headers: { [header]: KEY } });
      assert.equal(other.statusCode, 401, `${url} via ${header}`);
    }
  }
  await app.close();
});

test("the admin API is disabled, not open, when no key is configured", async () => {
  delete process.env.ADMIN_API_KEY;
  try {
    const app = await build();
    const response = await app.inject({ method: "GET", url: PATHS[0]! });
    assert.equal(response.statusCode, 503);
    await app.close();
  } finally {
    process.env.ADMIN_API_KEY = KEY;
  }
});

test("only GET routes exist and mutating methods are not routed", async () => {
  const app = Fastify();
  const seen: Array<{ method: string; url: string }> = [];
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) seen.push({ method: String(method), url: route.url });
  });
  await app.register(adminDeliveryDiagnosticsRoutes, {
    db: dbThatMustNotBeUsed,
    redis: { ping: async () => "PONG" },
    readQueue: async () => {
      throw new Error("unused");
    },
    env: {},
  });
  await app.ready();
  assert.ok(seen.length >= 3);
  for (const route of seen) assert.ok(["GET", "HEAD"].includes(route.method), `${route.method} ${route.url}`);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    for (const url of PATHS) {
      const response = await app.inject({ method, url: url.split("?")[0]!, headers: { [ADMIN_KEY_HEADER]: KEY } });
      assert.equal(response.statusCode, 404, `${method} ${url}`);
    }
  }
  await app.close();
});

test("invalid queries return 400 without touching the database", async () => {
  const app = await build();
  const headers = { [ADMIN_KEY_HEADER]: KEY };
  const cases = [
    "/delivery-diagnostics/summary?window=30d",
    "/delivery-diagnostics/summary?from=2020-01-01",
    "/delivery-diagnostics/summary?clientAccountId=a%20b",
    "/delivery-diagnostics/summary?clientAccountId=%27%3B%20drop%20table",
    "/delivery-diagnostics/ghl-runs?status=failed&limit=500",
    "/delivery-diagnostics/ghl-runs?status=failed&cursor=garbage",
    "/delivery-diagnostics/ghl-runs?status=bogus",
    "/delivery-diagnostics/ghl-runs",
    "/delivery-diagnostics/ghl-runs/bad%20id",
  ];
  for (const url of cases) {
    const response = await app.inject({ method: "GET", url, headers });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.headers["cache-control"], "no-store", url);
  }
  await app.close();
});

test("the rate limit and the concurrency gate answer 429 with retry-after", async () => {
  const limited = await build({ limiter: createFixedWindowRateLimiter({ max: 1, windowMs: 60_000 }) });
  const headers = { [ADMIN_KEY_HEADER]: KEY };
  const url = "/delivery-diagnostics/summary?window=30d";
  assert.equal((await limited.inject({ method: "GET", url, headers })).statusCode, 400);
  const second = await limited.inject({ method: "GET", url, headers });
  assert.equal(second.statusCode, 429);
  assert.ok(Number(second.headers["retry-after"]) >= 1);
  await limited.close();

  const gate = createConcurrencyGate(1);
  const held = gate.tryEnter();
  assert.ok(held);
  const busy = await build({ gate });
  const response = await busy.inject({ method: "GET", url, headers });
  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error, "diagnostics_busy");
  held();
  await busy.close();
});

test("an unknown run is a 404 and a failing read returns a stable error with no detail", async () => {
  const notFoundDb = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw: async () => 0, ghlLiveDeliveryRun: { findUnique: async () => null } }),
  } as unknown as PrismaClient;
  const notFound = await build({ db: notFoundDb });
  const headers = { [ADMIN_KEY_HEADER]: KEY };
  const missing = await notFound.inject({ method: "GET", url: "/delivery-diagnostics/ghl-runs/run_missing", headers });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error, "run_not_found");
  await notFound.close();

  const failingDb = {
    $transaction: async () => {
      throw new Error(`password=hunter2 for ${"jane.consumer@example.com"}`);
    },
  } as unknown as PrismaClient;
  const failing = await build({ db: failingDb });
  const failed = await failing.inject({ method: "GET", url: "/delivery-diagnostics/ghl-runs/run_1", headers });
  assert.equal(failed.statusCode, 500);
  assert.deepEqual(failed.json(), { ok: false, error: "diagnostics_failed" });
  await failing.close();
});
