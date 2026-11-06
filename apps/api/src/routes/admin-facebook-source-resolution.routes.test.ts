import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { adminFacebookSourceResolutionRoutes } from "./admin-facebook-source-resolution.js";
import type { SourceResolutionReviewQuery } from "../services/source-intake/facebook-source-resolution-review.service.js";
import type { SourceResolutionReview } from "../services/source-intake/facebook-source-resolution-review.service.js";

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function emptyReview(): SourceResolutionReview {
  return {
    ok: true,
    readOnly: true,
    writesPerformed: false,
    summary: {
      events: 0,
      byStatus: [],
      settledCaptureOnly: 0,
      unresolvedClient: 0,
      unstampedDespiteConfirmedOwner: 0,
      cannotIdentify: 0,
      invalidSourceIdentifiers: 0,
      unresolvedWithPageFormAndCampaign: 0,
    },
    associations: { items: [], total: 0, limit: 25, offset: 0, truncated: false },
    groups: { items: [], total: 0, limit: 25, offset: 0 },
  };
}

test("source resolution review rejects a missing admin key and has no write route", async () => {
  const envSnapshot = {
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    SA360_ADMIN_KEY: process.env.SA360_ADMIN_KEY,
  };
  process.env.ADMIN_API_KEY = "admin-test-key";
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  let calls = 0;
  await app.register(adminFacebookSourceResolutionRoutes, {
    prefix: "/admin/v1",
    loadReviewImpl: async () => {
      calls += 1;
      return emptyReview();
    },
  });
  try {
    const missing = await app.inject({ method: "GET", url: "/admin/v1/facebook-source-resolution" });
    const wrong = await app.inject({
      method: "GET",
      url: "/admin/v1/facebook-source-resolution",
      headers: { "x-sa360-admin-key": "wrong" },
    });
    const post = await app.inject({
      method: "POST",
      url: "/admin/v1/facebook-source-resolution",
      headers: { "x-sa360-admin-key": "admin-test-key", "content-type": "application/json" },
      payload: { clientAccountId: "client_should_not_write" },
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

test("source resolution review returns the read-only payload and rejects a bad filter", async () => {
  const envSnapshot = {
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    SA360_ADMIN_KEY: process.env.SA360_ADMIN_KEY,
  };
  process.env.ADMIN_API_KEY = "admin-test-key";
  delete process.env.SA360_ADMIN_KEY;
  const app = Fastify({ logger: false });
  await app.register(adminFacebookSourceResolutionRoutes, {
    prefix: "/admin/v1",
    loadReviewImpl: async (query: SourceResolutionReviewQuery) => {
      assert.equal(query.pageId, "222591640945329");
      assert.equal(query.includeEvents, true);
      const review = emptyReview();
      review.summary.events = 1;
      review.groups.items.push({
        pageId: "222591640945329",
        formId: "1977370106440985",
        campaignId: null,
        unresolvedEvents: 1,
        classification: "unstamped_confirmed_owner",
        confirmedOriginClientAccountId: "jr_laird",
        confirmedSourceFunnelId: "funnel_1",
        sourceFunnelCreatedAt: null,
        sourceFunnelUpdatedAt: null,
        earliestReceivedAt: null,
        latestReceivedAt: null,
        earliestNormalizedAt: null,
        latestNormalizedAt: null,
        outcomes: {
          associated: 0,
          unassociated: 1,
          ambiguous: 0,
          missing_form_identity: 0,
          invalid_form_identity: 0,
          not_evaluated: 0,
          association_disabled: 0,
          absent: 0,
          other: 0,
        },
        explanation: "Settlement recorded unassociated.",
        events: [],
      });
      return review;
    },
  });
  try {
    const ok = await app.inject({
      method: "GET",
      url: "/admin/v1/facebook-source-resolution?pageId=222591640945329&includeEvents=1",
      headers: { "x-sa360-admin-key": "admin-test-key" },
    });
    assert.equal(ok.statusCode, 200);
    const body = ok.json() as { readOnly: boolean; writesPerformed: boolean; summary: { events: number } };
    assert.equal(body.readOnly, true);
    assert.equal(body.writesPerformed, false);
    assert.equal(body.summary.events, 1);
    assert.equal(ok.body.includes("rawPayload"), false);
    const bad = await app.inject({
      method: "GET",
      url: "/admin/v1/facebook-source-resolution?pageId=not-an-id",
      headers: { "x-sa360-admin-key": "admin-test-key" },
    });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error, "invalid_query");
  } finally {
    await app.close();
    restoreEnv(envSnapshot);
  }
});
