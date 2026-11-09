import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { adminFacebookAssociationCorrectionPreviewRoutes } from "./admin-facebook-association-correction-preview.js";
import type { CorrectionPreviewQuery } from "../services/source-intake/facebook-association-correction-preview.service.js";

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("association correction preview rejects a missing admin key and has no write route", async () => {
  const envSnapshot = {
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    SA360_ADMIN_KEY: process.env.SA360_ADMIN_KEY,
  };
  process.env.ADMIN_API_KEY = "admin-test-key";
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  let calls = 0;
  await app.register(adminFacebookAssociationCorrectionPreviewRoutes, {
    prefix: "/admin/v1",
    loadPreviewImpl: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  try {
    const missing = await app.inject({
      method: "GET",
      url: "/admin/v1/facebook-source-resolution/association-correction-preview",
    });
    const wrong = await app.inject({
      method: "GET",
      url: "/admin/v1/facebook-source-resolution/association-correction-preview",
      headers: { "x-sa360-admin-key": "wrong" },
    });
    const post = await app.inject({
      method: "POST",
      url: "/admin/v1/facebook-source-resolution/association-correction-preview",
      headers: { "x-sa360-admin-key": "admin-test-key", "content-type": "application/json" },
      payload: { confirm: true },
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(wrong.statusCode, 401);
    assert.equal(post.statusCode, 404);
    assert.equal(calls, 0);
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});

test("association correction preview validates the cohort query and stays read-only", async () => {
  const envSnapshot = {
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    SA360_ADMIN_KEY: process.env.SA360_ADMIN_KEY,
  };
  process.env.ADMIN_API_KEY = "admin-test-key";
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  const seen: { query: CorrectionPreviewQuery | null } = { query: null };
  await app.register(adminFacebookAssociationCorrectionPreviewRoutes, {
    prefix: "/admin/v1",
    loadPreviewImpl: async (query: CorrectionPreviewQuery) => {
      seen.query = query;
      return { ok: true, readOnly: true, writesPerformed: false, correctionEnabled: false };
    },
  });
  try {
    const bad = await app.inject({
      method: "GET",
      url: "/admin/v1/facebook-source-resolution/association-correction-preview?sourceFunnelId=funnel_1",
      headers: { "x-sa360-admin-key": "admin-test-key" },
    });
    const ok = await app.inject({
      method: "GET",
      url:
        "/admin/v1/facebook-source-resolution/association-correction-preview" +
        "?sourceFunnelId=funnel_1&pageId=222591640945329&formId=1977370106440985" +
        "&originClientAccountId=jr_laird&confirmedAt=2026-10-27T14:25:02.000Z&includeAllowList=1",
      headers: { "x-sa360-admin-key": "admin-test-key" },
    });
    assert.equal(bad.statusCode, 400);
    assert.equal(ok.statusCode, 200);
    const body = ok.json() as { writesPerformed: boolean; correctionEnabled: boolean };
    assert.equal(body.writesPerformed, false);
    assert.equal(body.correctionEnabled, false);
    assert.ok(seen.query);
    assert.equal(seen.query.pageId, "222591640945329");
    assert.equal(seen.query.includeAllowList, true);
    assert.equal(seen.query.decision, "all");
    assert.equal(seen.query.confirmedAt.toISOString(), "2026-10-27T14:25:02.000Z");
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});
