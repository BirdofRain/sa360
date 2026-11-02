import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { adminClientOnboardingV2ConfigRoutes } from "./admin-client-onboarding-v2-config.js";

const ADMIN_KEY = "admin-key-column-maps";

async function withFlag(flag: string | undefined) {
  const previousFlag = process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED;
  const previousAdmin = process.env.ADMIN_API_KEY;
  const previousAlias = process.env.SA360_ADMIN_KEY;
  if (flag === undefined) delete process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED;
  else process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED = flag;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  delete process.env.SA360_ADMIN_KEY;
  let reads = 0;
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingV2ConfigRoutes, {
    prefix: "/admin/v1",
    env: process.env,
    readExistingWorksheet: async () => {
      reads += 1;
      throw new Error("worksheet read should not run for an invalid body");
    },
  });
  return {
    app,
    reads: () => reads,
    async restore() {
      if (previousFlag === undefined) delete process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED;
      else process.env.SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED = previousFlag;
      if (previousAdmin === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previousAdmin;
      if (previousAlias === undefined) delete process.env.SA360_ADMIN_KEY;
      else process.env.SA360_ADMIN_KEY = previousAlias;
      await app.close();
    },
  };
}

test("column map routes stay hidden when the config flag is off", async () => {
  const ctx = await withFlag(undefined);
  try {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/admin/v1/clients/client_one/onboarding/column-maps",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {},
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "onboarding_config_disabled");
    assert.equal(ctx.reads(), 0);
  } finally {
    await ctx.restore();
  }
});

test("column map routes reject a body before reading a worksheet when config is on", async () => {
  const ctx = await withFlag("true");
  try {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/admin/v1/clients/client_one/onboarding/column-maps",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {},
    });
    assert.equal(created.statusCode, 400);
    assert.equal(created.json().error, "invalid_body");
    const target = await ctx.app.inject({
      method: "PUT",
      url: "/admin/v1/clients/client_one/onboarding/sheets-target",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {},
    });
    assert.equal(target.statusCode, 400);
    assert.equal(target.json().error, "invalid_body");
    assert.equal(ctx.reads(), 0);
  } finally {
    await ctx.restore();
  }
});

test("stored-lead preview stays hidden when the config flag is off and never reads a worksheet", async () => {
  const ctx = await withFlag(undefined);
  try {
    const listed = await ctx.app.inject({
      method: "GET",
      url: "/admin/v1/clients/client_one/onboarding/column-map-preview/leads",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(listed.statusCode, 404);
    assert.equal(listed.json().error, "onboarding_config_disabled");
    const preview = await ctx.app.inject({
      method: "POST",
      url: "/admin/v1/clients/client_one/onboarding/column-map-preview",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: {},
    });
    assert.equal(preview.statusCode, 404);
    assert.equal(ctx.reads(), 0);
  } finally {
    await ctx.restore();
  }
});

test("stored-lead preview rejects an invalid body before any worksheet read", async () => {
  const ctx = await withFlag("true");
  try {
    const preview = await ctx.app.inject({
      method: "POST",
      url: "/admin/v1/clients/client_one/onboarding/column-map-preview",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { requestId: "not-a-preview" },
    });
    assert.equal(preview.statusCode, 400);
    assert.equal(preview.json().error, "invalid_body");
    const listed = await ctx.app.inject({
      method: "GET",
      url: "/admin/v1/clients/client_one/onboarding/column-map-preview/leads?limit=0",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(listed.statusCode, 400);
    assert.equal(listed.json().error, "invalid_body");
    assert.equal(ctx.reads(), 0);
  } finally {
    await ctx.restore();
  }
});

test("stored-lead preview refuses a missing key, portal, workspace, and observer", async () => {
  const ctx = await withFlag("true");
  try {
    const missing = await ctx.app.inject({
      method: "GET",
      url: "/admin/v1/clients/client_one/onboarding/column-map-preview/leads",
    });
    assert.equal(missing.statusCode, 401);
    const portal = await ctx.app.inject({
      method: "POST",
      url: "/admin/v1/clients/client_one/onboarding/column-map-preview",
      headers: { "x-sa360-admin-key": ADMIN_KEY, "x-sa360-client-portal-key": "portal-secret" },
      payload: {},
    });
    assert.equal(portal.statusCode, 403);
    assert.equal(portal.json().error, "forbidden");
    const workspace = await ctx.app.inject({
      method: "GET",
      url: "/admin/v1/clients/client_one/onboarding/column-map-preview/leads",
      headers: { "x-sa360-admin-key": ADMIN_KEY, "x-sa360-workspace-key": "workspace-secret" },
    });
    assert.equal(workspace.statusCode, 403);
    const observer = await ctx.app.inject({
      method: "GET",
      url: "/admin/v1/clients/client_one/onboarding/column-map-preview/leads",
      headers: { "x-sa360-admin-key": ADMIN_KEY, cookie: "sa360_admin_session=observer" },
    });
    assert.equal(observer.statusCode, 403);
    assert.equal(observer.json().error, "forbidden");
    assert.equal(ctx.reads(), 0);
  } finally {
    await ctx.restore();
  }
});
