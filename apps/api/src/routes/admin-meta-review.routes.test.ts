import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import type { MetaReviewConfig } from "../services/meta-review/meta-review.service.js";
import {
  adminMetaReviewRoutes,
  type AdminMetaReviewRoutesOptions,
} from "./admin-meta-review.js";

const ADMIN_KEY = "meta-review-admin-key";

function config(overrides: Partial<MetaReviewConfig> = {}): MetaReviewConfig {
  return {
    enabled: true,
    writesEnabled: false,
    graphApiVersion: "v25.0",
    userAccessToken: "user-token",
    pageAccessToken: "page-token",
    pageAccessTokenPageId: "10001",
    appId: "1641287293781686",
    appSecret: null,
    allowedPageIds: new Set(["10001"]),
    allowedAdAccountIds: new Set(["20001"]),
    callbackConfigured: true,
    intakeEnabled: false,
    graphFetchEnabled: false,
    routingEnabled: false,
    legacyDirectIntakeEnabled: false,
    ...overrides,
  };
}

async function build(opts: AdminMetaReviewRoutesOptions) {
  const app = Fastify({ logger: false });
  await app.register(adminMetaReviewRoutes, { prefix: "/admin/v1", ...opts });
  return app;
}

async function withAdminKey<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
}

test("all Meta review routes require the existing admin API key", async () => {
  await withAdminKey(async () => {
    const app = await build({ getConfigImpl: () => config() });
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/meta-review/preflight",
    });
    assert.equal(response.statusCode, 401);
    await app.close();
  });
});

test("disabled feature returns 404 without calling Meta", async () => {
  await withAdminKey(async () => {
    let calls = 0;
    const app = await build({
      getConfigImpl: () => config({ enabled: false }),
      fetchImpl: (async () => {
        calls += 1;
        return new Response("{}");
      }) as typeof fetch,
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/meta-review/pages",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "feature_disabled");
    assert.equal(calls, 0);
    await app.close();
  });
});

test("preflight is credential-safe and reports disabled writes plus inert intake", async () => {
  await withAdminKey(async () => {
    const app = await build({ getConfigImpl: () => config() });
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/meta-review/preflight",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.preflight.writesEnabled, false);
    assert.equal(body.preflight.productionSafety.safeForReview, true);
    assert.equal(response.body.includes("user-token"), false);
    assert.equal(response.body.includes("page-token"), false);
    await app.close();
  });
});

test("Page reads enforce the API allowlist before calling Graph", async () => {
  await withAdminKey(async () => {
    let calls = 0;
    const app = await build({
      getConfigImpl: () => config(),
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch,
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/meta-review/pages/99999/posts",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "not_allowlisted");
    assert.equal(calls, 0);
    await app.close();
  });
});

test("subscription POST requires body confirmation and remains write-flag gated", async () => {
  await withAdminKey(async () => {
    let calls = 0;
    const app = await build({
      getConfigImpl: () => config(),
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }) as typeof fetch,
    });
    const missingConfirmation = await app.inject({
      method: "POST",
      url: "/admin/v1/meta-review/pages/10001/subscribe-leadgen",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {},
    });
    assert.equal(missingConfirmation.statusCode, 400);

    const disabled = await app.inject({
      method: "POST",
      url: "/admin/v1/meta-review/pages/10001/subscribe-leadgen",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { confirmed: true, confirmationText: "SUBSCRIBE LEADGEN" },
    });
    assert.equal(disabled.statusCode, 409);
    assert.equal(disabled.json().error, "writes_disabled");
    assert.equal(calls, 0);
    await app.close();
  });
});

test("insights endpoint validates date input before Graph", async () => {
  await withAdminKey(async () => {
    let calls = 0;
    const app = await build({
      getConfigImpl: () => config(),
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch,
    });
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/meta-review/ad-accounts/20001/insights?since=not-a-date&until=2026-10-08",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_input");
    assert.equal(calls, 0);
    await app.close();
  });
});
